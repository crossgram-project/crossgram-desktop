#include "crossgram/server_switch.h"

#include "base/bytes.h"
#include "base/flat_set.h"
#include "main/main_account.h"
#include "mtproto/details/mtproto_rsa_public_key.h"
#include "mtproto/mtproto_dc_options.h"
#include "storage/storage_account.h"
#include "ui/layers/generic_box.h"
#include "ui/widgets/fields/input_field.h"
#include "ui/widgets/popup_menu.h"
#include "window/window_controller.h"

#include "styles/style_boxes.h"
#include "styles/style_layers.h"

#include <QtCore/QDir>
#include <QtCore/QFile>
#include <QtCore/QFileInfo>
#include <QtCore/QJsonArray>
#include <QtCore/QJsonDocument>
#include <QtCore/QJsonObject>
#include <QtCore/QSaveFile>
#include <QtGui/QClipboard>
#include <QtGui/QGuiApplication>
#include <QtNetwork/QHostAddress>

namespace Crossgram::ServerSwitch {
namespace {

struct Configuration {
	QString name;
	QString host;
	int port = 0;
	QByteArray rsaKey;
	std::vector<MTP::DcOptions::Endpoint> endpoints;
	bool enableSpecialConfig = false;
};

[[nodiscard]] bool Fail(QString *error, QString text) {
	if (error) {
		*error = std::move(text);
	}
	return false;
}

[[nodiscard]] bool ReadPort(
		const QJsonValue &value,
		int *result) {
	if (!value.isDouble()) {
		return false;
	}
	const auto number = value.toDouble();
	const auto integer = int(number);
	if (number != integer || integer < 1 || integer > 65535) {
		return false;
	}
	*result = integer;
	return true;
}

[[nodiscard]] bool ReadAddress(
		const QJsonValue &value,
		QString *result) {
	if (!value.isString()) {
		return false;
	}
	const auto address = value.toString().trimmed();
	if (QHostAddress(address).isNull()) {
		return false;
	}
	*result = address;
	return true;
}

[[nodiscard]] bool Parse(
		const QByteArray &json,
		Configuration *result,
		QString *error) {
	auto parseError = QJsonParseError();
	const auto document = QJsonDocument::fromJson(json, &parseError);
	if (parseError.error != QJsonParseError::NoError || !document.isObject()) {
		return Fail(error, u"Configuration must be a JSON object: %1"_q
			.arg(parseError.errorString()));
	}

	const auto object = document.object();
	auto parsed = Configuration();
	parsed.name = object.value(u"name"_q).toString().trimmed();
	if (parsed.name.isEmpty()) {
		return Fail(error, u"name must be a non-empty string."_q);
	}
	if (!object.value(u"enable_special_config"_q).isBool()) {
		return Fail(error, u"enable_special_config must be a boolean."_q);
	}
	parsed.enableSpecialConfig = object.value(
		u"enable_special_config"_q).toBool();
	if (!ReadAddress(object.value(u"host"_q), &parsed.host)) {
		return Fail(error, u"host must be a valid IPv4 or IPv6 address."_q);
	}
	if (!ReadPort(object.value(u"port"_q), &parsed.port)) {
		return Fail(error, u"port must be an integer between 1 and 65535."_q);
	}
	if (!object.value(u"rsa_key"_q).isString()) {
		return Fail(error, u"rsa_key must be a PEM string."_q);
	}
	parsed.rsaKey = object.value(u"rsa_key"_q).toString().toUtf8();
	const auto rsa = MTP::details::RSAPublicKey(
		bytes::make_span(parsed.rsaKey));
	if (!rsa.valid()) {
		return Fail(error, u"rsa_key is not a valid RSA public key."_q);
	}

	const auto dcsValue = object.value(u"dcs"_q);
	if (!dcsValue.isArray() || dcsValue.toArray().isEmpty()) {
		return Fail(error, u"dcs must be a non-empty array."_q);
	}
	auto ids = base::flat_set<int>();
	for (const auto &value : dcsValue.toArray()) {
		if (!value.isObject()) {
			return Fail(error, u"Every dcs entry must be an object."_q);
		}
		const auto dc = value.toObject();
		const auto idValue = dc.value(u"id"_q);
		if (!idValue.isDouble()) {
			return Fail(error, u"Every dcs entry needs an integer id."_q);
		}
		const auto idNumber = idValue.toDouble();
		const auto id = int(idNumber);
		if (idNumber != id || id < 1 || id > 1000 || ids.contains(id)) {
			return Fail(error, u"DC ids must be unique integers from 1 to 1000."_q);
		}
		ids.emplace(id);
		auto address = QString();
		if (!ReadAddress(dc.value(u"ip"_q), &address)) {
			return Fail(error, u"Every dcs entry needs a valid ip address."_q);
		}
		auto port = 0;
		if (!ReadPort(dc.value(u"port"_q), &port)) {
			return Fail(error, u"Every dcs entry needs a valid port."_q);
		}
		parsed.endpoints.emplace_back(
			id,
			MTP::DcOptions::Flag::f_static,
			address.toStdString(),
			port,
			bytes::vector());
	}

	*result = std::move(parsed);
	return true;
}

[[nodiscard]] bool Load(
		const QString &path,
		Configuration *result,
		QString *error) {
	auto file = QFile(path);
	if (!file.open(QIODevice::ReadOnly)) {
		return Fail(error, u"Could not read %1: %2"_q
			.arg(path, file.errorString()));
	}
	return Parse(file.readAll(), result, error);
}

[[nodiscard]] bool Write(
		const QString &path,
		const QByteArray &json,
		QString *error) {
	const auto directory = QFileInfo(path).dir();
	if (!directory.exists() && !QDir().mkpath(directory.absolutePath())) {
		return Fail(error, u"Could not create %1."_q
			.arg(directory.absolutePath()));
	}
	auto file = QSaveFile(path);
	if (!file.open(QIODevice::WriteOnly)
		|| file.write(json) != json.size()
		|| !file.commit()) {
		return Fail(error, u"Could not write %1: %2"_q
			.arg(path, file.errorString()));
	}
	return true;
}

void ShowEditor(
		not_null<Ui::GenericBox*> box,
		not_null<Window::Controller*> controller,
		not_null<Main::Account*> account) {
	box->setWidth(st::boxWideWidth);
	box->setTitle(u"Add server configuration"_q);
	const auto field = box->addRow(object_ptr<Ui::InputField>(
		box,
		st::newGroupDescription,
		Ui::InputField::Mode::MultiLine,
		rpl::single(u"Paste the server JSON configuration"_q),
		QString()));
	field->setSubmitSettings(Ui::InputField::SubmitSettings::None);
	box->setFocusCallback([=] { field->setFocusFast(); });

	const auto submit = [=] {
		const auto json = field->getLastText().toUtf8();
		auto parsed = Configuration();
		auto error = QString();
		if (!Parse(json, &parsed, &error)
			|| !Write(account->local().serverSwitchConfigPath(), json, &error)
			|| !account->reloadServerSwitchConfiguration(&error)) {
			field->showErrorNoFocus();
			controller->showToast(error);
			return;
		}
		box->closeBox();
		controller->showToast(u"Server configuration applied to this account."_q);
	};

	box->addButton(u"Confirm"_q, submit);
	box->addButton(u"Read from clipboard"_q, [=] {
		field->setText(QGuiApplication::clipboard()->text());
		field->setFocusFast();
	});
	box->addButton(u"Cancel"_q, [=] { box->closeBox(); });
}

void UseOfficial(
		not_null<Window::Controller*> controller,
		not_null<Main::Account*> account) {
	const auto path = account->local().serverSwitchConfigPath();
	if (QFile::exists(path) && !QFile::remove(path)) {
		controller->showToast(u"Could not remove the custom configuration."_q);
		return;
	}
	auto error = QString();
	if (!account->reloadServerSwitchConfiguration(&error)) {
		controller->showToast(error);
		return;
	}
	controller->showToast(u"Official Telegram configuration applied."_q);
}

} // namespace

bool ApplyStored(
		const QString &path,
		not_null<MTP::DcOptions*> options,
		QString *error) {
	if (!QFile::exists(path)) {
		options->useBuiltInConfiguration();
		return true;
	}
	auto configuration = Configuration();
	if (!Load(path, &configuration, error)) {
		return false;
	}
	if (!options->useCustomConfiguration(
			configuration.endpoints,
			configuration.rsaKey,
			configuration.enableSpecialConfig)) {
		return Fail(error, u"The custom MTProto configuration is invalid."_q);
	}
	return true;
}

void FillMenu(
		not_null<Ui::PopupMenu*> menu,
		not_null<Window::Controller*> controller,
		not_null<Main::Account*> account) {
	menu->addAction(u"Official Telegram"_q, [=] {
		UseOfficial(controller, account);
	});
	const auto path = account->local().serverSwitchConfigPath();
	if (QFile::exists(path)) {
		auto configuration = Configuration();
		auto error = QString();
		const auto title = Load(path, &configuration, &error)
			? configuration.name
			: u"Invalid custom configuration"_q;
		menu->addAction(title, [=] {
			auto applyError = QString();
			if (!account->reloadServerSwitchConfiguration(&applyError)) {
				controller->showToast(applyError);
			}
		});
	}
	menu->addAction(u"Add custom configuration..."_q, [=] {
		controller->show(Box(ShowEditor, controller, account));
	});
}

} // namespace Crossgram::ServerSwitch
