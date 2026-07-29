#include "crossgram/e2e.h"

#include <QtCore/QHash>
#include <QtCore/QJsonArray>
#include <QtCore/QJsonDocument>
#include <QtCore/QJsonObject>
#include <QtCore/QVector>
#include <QtGui/QAccessible>
#include <QtNetwork/QHostAddress>
#include <QtNetwork/QTcpServer>
#include <QtNetwork/QTcpSocket>
#include <QtWidgets/QApplication>

#include <algorithm>
#include <array>
#include <memory>
#include <utility>

namespace Crossgram::E2e {
namespace {

constexpr auto kMaximumRequestBytes = 1024 * 1024;
constexpr auto kMaximumNodes = 10000;
constexpr auto kMaximumDepth = 64;

struct LocatedNode {
	QAccessibleInterface *interface = nullptr;
	QString path;
};

QString RoleName(QAccessible::Role role) {
	switch (role) {
	case QAccessible::Window: return u"window"_q;
	case QAccessible::Dialog: return u"dialog"_q;
	case QAccessible::Button: return u"button"_q;
	case QAccessible::CheckBox: return u"checkbox"_q;
	case QAccessible::RadioButton: return u"radio"_q;
	case QAccessible::ComboBox: return u"combobox"_q;
	case QAccessible::EditableText: return u"textbox"_q;
	case QAccessible::StaticText: return u"text"_q;
	case QAccessible::List: return u"list"_q;
	case QAccessible::ListItem: return u"listitem"_q;
	case QAccessible::Table: return u"table"_q;
	case QAccessible::Cell: return u"cell"_q;
	case QAccessible::MenuBar: return u"menubar"_q;
	case QAccessible::PopupMenu: return u"menu"_q;
	case QAccessible::MenuItem: return u"menuitem"_q;
	case QAccessible::PageTab: return u"tab"_q;
	case QAccessible::PageTabList: return u"tablist"_q;
	default: return u"role-%1"_q.arg(int(role));
	}
}

QString ActionId(const QString &action) {
	using Action = QAccessibleActionInterface;
	static const auto kKnown = std::array{
		std::pair{ Action::pressAction(), u"press"_q },
		std::pair{ Action::increaseAction(), u"increase"_q },
		std::pair{ Action::decreaseAction(), u"decrease"_q },
		std::pair{ Action::showMenuAction(), u"showMenu"_q },
		std::pair{ Action::setFocusAction(), u"setFocus"_q },
		std::pair{ Action::toggleAction(), u"toggle"_q },
		std::pair{ Action::scrollLeftAction(), u"scrollLeft"_q },
		std::pair{ Action::scrollRightAction(), u"scrollRight"_q },
		std::pair{ Action::scrollUpAction(), u"scrollUp"_q },
		std::pair{ Action::scrollDownAction(), u"scrollDown"_q },
		std::pair{ Action::nextPageAction(), u"nextPage"_q },
		std::pair{ Action::previousPageAction(), u"previousPage"_q },
	};
	const auto found = std::find_if(
		kKnown.begin(),
		kKnown.end(),
		[&](const auto &entry) { return entry.first == action; });
	return (found == kKnown.end()) ? action : found->second;
}

QJsonObject StateJson(const QAccessible::State &state) {
	return {
		{ u"disabled"_q, bool(state.disabled) },
		{ u"focusable"_q, bool(state.focusable) },
		{ u"focused"_q, bool(state.focused) },
		{ u"invisible"_q, bool(state.invisible) },
		{ u"offscreen"_q, bool(state.offscreen) },
		{ u"checked"_q, bool(state.checked) },
		{ u"selected"_q, bool(state.selected) },
		{ u"password"_q, bool(state.passwordEdit) },
	};
}

QJsonObject NodeJson(
		QAccessibleInterface *interface,
		const QString &path,
		bool includeValues,
		int depth,
		int &nodes) {
	QJsonObject result;
	if (!interface || !interface->isValid() || nodes >= kMaximumNodes) {
		return result;
	}
	++nodes;
	const auto state = interface->state();
	const auto object = interface->object();
	const auto rectangle = interface->rect();
	result.insert(u"path"_q, path);
	result.insert(u"role"_q, RoleName(interface->role()));
	result.insert(u"roleId"_q, int(interface->role()));
	result.insert(u"name"_q, interface->text(QAccessible::Name));
	result.insert(u"description"_q, interface->text(QAccessible::Description));
	result.insert(u"objectName"_q, object ? object->objectName() : QString());
	result.insert(
		u"className"_q,
		object ? QString::fromLatin1(object->metaObject()->className()) : QString());
	result.insert(u"state"_q, StateJson(state));
	result.insert(u"rect"_q, QJsonObject{
		{ u"x"_q, rectangle.x() },
		{ u"y"_q, rectangle.y() },
		{ u"width"_q, rectangle.width() },
		{ u"height"_q, rectangle.height() },
	});
	if (includeValues) {
		result.insert(
			u"value"_q,
			state.passwordEdit
				? u"<redacted>"_q
				: interface->text(QAccessible::Value));
	}
	if (const auto actions = interface->actionInterface()) {
		QJsonArray names;
		for (const auto &name : actions->actionNames()) {
			names.append(ActionId(name));
		}
		result.insert(u"actions"_q, names);
	}
	if (depth >= kMaximumDepth) {
		result.insert(u"truncated"_q, true);
		return result;
	}
	QJsonArray children;
	for (auto index = 0; index != interface->childCount(); ++index) {
		const auto child = interface->child(index);
		const auto childPath = path.isEmpty()
			? QString::number(index)
			: path + u'/' + QString::number(index);
		const auto serialized = NodeJson(
			child,
			childPath,
			includeValues,
			depth + 1,
			nodes);
		if (!serialized.isEmpty()) {
			children.append(serialized);
		}
		if (nodes >= kMaximumNodes) {
			result.insert(u"truncated"_q, true);
			break;
		}
	}
	result.insert(u"children"_q, children);
	return result;
}

void CollectNodes(
		QAccessibleInterface *interface,
		const QString &path,
		QVector<LocatedNode> &result,
		int depth = 0) {
	if (!interface
		|| !interface->isValid()
		|| depth > kMaximumDepth
		|| result.size() >= kMaximumNodes) {
		return;
	}
	result.push_back({ interface, path });
	for (auto index = 0; index != interface->childCount(); ++index) {
		const auto childPath = path.isEmpty()
			? QString::number(index)
			: path + u'/' + QString::number(index);
		CollectNodes(interface->child(index), childPath, result, depth + 1);
	}
}

QVector<LocatedNode> SemanticNodes() {
	QVector<LocatedNode> result;
	const auto root = QAccessible::queryAccessibleInterface(qApp);
	CollectNodes(root, QString(), result);
	return result;
}

LocatedNode Locate(const QJsonObject &selector, QString &error) {
	const auto path = selector.value(u"path"_q).toString();
	const auto name = selector.value(u"name"_q).toString();
	const auto objectName = selector.value(u"objectName"_q).toString();
	const auto role = selector.value(u"role"_q).toString();
	const auto occurrence = selector.value(u"occurrence"_q).toInt(0);
	if (path.isEmpty() && name.isEmpty() && objectName.isEmpty() && role.isEmpty()) {
		error = u"selector must contain path, name, objectName, or role"_q;
		return {};
	}
	QVector<LocatedNode> matches;
	for (const auto &node : SemanticNodes()) {
		const auto interface = node.interface;
		const auto object = interface->object();
		if (!path.isEmpty() && node.path != path) continue;
		if (!name.isEmpty() && interface->text(QAccessible::Name) != name) continue;
		if (!objectName.isEmpty()
			&& (!object || object->objectName() != objectName)) continue;
		if (!role.isEmpty() && RoleName(interface->role()) != role) continue;
		matches.push_back(node);
	}
	if (occurrence < 0 || occurrence >= matches.size()) {
		error = u"selector matched %1 node(s); occurrence %2 is unavailable"_q
			.arg(matches.size())
			.arg(occurrence);
		return {};
	}
	return matches[occurrence];
}

class Server final : public QObject {
public:
	Server(quint16 port, QString token);

private:
	void acceptConnections();
	void read(QTcpSocket *socket);
	void handle(QTcpSocket *socket, const QByteArray &line);
	void respond(
		QTcpSocket *socket,
		const QJsonValue &id,
		bool ok,
		const QJsonValue &result,
		const QString &error = QString());

	QTcpServer _server;
	QHash<QTcpSocket*, QByteArray> _buffers;
	QString _token;

};

Server::Server(quint16 port, QString token)
: _token(std::move(token)) {
	connect(&_server, &QTcpServer::newConnection, this, [=] {
		acceptConnections();
	});
	if (!_server.listen(QHostAddress::LocalHost, port)) {
		qWarning(
			"Crossgram E2E failed to listen: %s",
			qUtf8Printable(_server.errorString()));
	} else {
		qInfo("Crossgram E2E listening on 127.0.0.1:%u", unsigned(port));
	}
}

void Server::acceptConnections() {
	while (const auto socket = _server.nextPendingConnection()) {
		_buffers.emplace(socket, QByteArray());
		connect(socket, &QTcpSocket::readyRead, this, [=] {
			read(socket);
		});
		connect(socket, &QTcpSocket::disconnected, this, [=] {
			_buffers.remove(socket);
			socket->deleteLater();
		});
	}
}

void Server::read(QTcpSocket *socket) {
	auto &buffer = _buffers[socket];
	buffer.append(socket->readAll());
	if (buffer.size() > kMaximumRequestBytes) {
		respond(socket, {}, false, {}, u"request exceeds 1 MiB"_q);
		socket->disconnectFromHost();
		return;
	}
	while (true) {
		const auto newline = buffer.indexOf('\n');
		if (newline < 0) break;
		const auto line = buffer.left(newline);
		buffer.remove(0, newline + 1);
		handle(socket, line);
	}
}

void Server::handle(QTcpSocket *socket, const QByteArray &line) {
	QJsonParseError parseError;
	const auto document = QJsonDocument::fromJson(line, &parseError);
	if (!document.isObject()) {
		respond(
			socket,
			{},
			false,
			{},
			u"invalid JSON object: %1"_q.arg(parseError.errorString()));
		return;
	}
	const auto request = document.object();
	const auto id = request.value(u"id"_q);
	if (request.value(u"token"_q).toString() != _token) {
		respond(socket, id, false, {}, u"unauthorized"_q);
		return;
	}
	const auto command = request.value(u"command"_q).toString();
	if (command == u"ping"_q) {
		respond(socket, id, true, QJsonObject{
			{ u"protocol"_q, 1 },
			{ u"service"_q, u"crossgram-desktop-e2e"_q },
		});
	} else if (command == u"snapshot"_q) {
		const auto root = QAccessible::queryAccessibleInterface(qApp);
		if (!root) {
			respond(
				socket,
				id,
				false,
				{},
				u"Qt accessibility root is unavailable"_q);
			return;
		}
		int nodes = 0;
		respond(socket, id, true, NodeJson(
			root,
			QString(),
			request.value(u"includeValues"_q).toBool(false),
			0,
			nodes));
	} else if (command == u"action"_q) {
		QString error;
		const auto node = Locate(
			request.value(u"selector"_q).toObject(),
			error);
		if (!node.interface) {
			respond(socket, id, false, {}, error);
			return;
		}
		const auto action = request.value(u"action"_q).toString();
		const auto actions = node.interface->actionInterface();
		const auto names = actions ? actions->actionNames() : QStringList();
		const auto found = std::find_if(
			names.begin(),
			names.end(),
			[&](const QString &name) { return ActionId(name) == action; });
		if (found == names.end()) {
			respond(
				socket,
				id,
				false,
				{},
				u"semantic action is not supported"_q);
			return;
		}
		actions->doAction(*found);
		respond(socket, id, true, QJsonObject{
			{ u"path"_q, node.path },
			{ u"action"_q, action },
		});
	} else if (command == u"setText"_q) {
		QString error;
		const auto node = Locate(
			request.value(u"selector"_q).toObject(),
			error);
		if (!node.interface) {
			respond(socket, id, false, {}, error);
			return;
		}
		const auto editable = node.interface->editableTextInterface();
		const auto text = node.interface->textInterface();
		if (!editable || !text) {
			respond(
				socket,
				id,
				false,
				{},
				u"selected node is not editable text"_q);
			return;
		}
		const auto value = request.value(u"text"_q).toString();
		editable->replaceText(0, text->characterCount(), value);
		respond(socket, id, true, QJsonObject{
			{ u"path"_q, node.path },
			{ u"length"_q, value.size() },
		});
	} else {
		respond(socket, id, false, {}, u"unknown command"_q);
	}
}

void Server::respond(
		QTcpSocket *socket,
		const QJsonValue &id,
		bool ok,
		const QJsonValue &result,
		const QString &error) {
	QJsonObject response{
		{ u"id"_q, id },
		{ u"ok"_q, ok },
	};
	if (ok) {
		response.insert(u"result"_q, result);
	} else {
		response.insert(u"error"_q, error);
	}
	socket->write(QJsonDocument(response).toJson(QJsonDocument::Compact));
	socket->write("\n");
}

std::unique_ptr<Server> Instance;

} // namespace

void Start() {
	if (Instance) return;
	bool validPort = false;
	const auto port = qEnvironmentVariableIntValue("CROSSGRAM_E2E_PORT", &validPort);
	const auto token = qEnvironmentVariable("CROSSGRAM_E2E_TOKEN");
	if (!validPort && token.isEmpty()) return;
	if (!validPort || port < 1 || port > 65535 || token.size() < 32) {
		qWarning(
			"Crossgram E2E requires a valid CROSSGRAM_E2E_PORT "
			"and a token of at least 32 characters");
		return;
	}
	Instance = std::make_unique<Server>(quint16(port), token);
}

} // namespace Crossgram::E2e
