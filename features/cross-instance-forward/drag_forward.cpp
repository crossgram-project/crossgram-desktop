#include "crossgram/drag_forward.h"

#include "data/data_document.h"
#include "data/data_document_media.h"
#include "data/data_media_types.h"
#include "data/data_photo.h"
#include "data/data_photo_media.h"
#include "data/data_session.h"
#include "history/history_item.h"
#include "ui/image/image.h"

#include <QtCore/QCoreApplication>
#include <QtCore/QDir>
#include <QtCore/QFile>
#include <QtCore/QFileInfo>
#include <QtCore/QHash>
#include <QtCore/QMimeData>
#include <QtCore/QSet>
#include <QtCore/QString>
#include <QtCore/QTimer>
#include <QtCore/QUuid>
#include <QtCore/QUrl>

namespace Crossgram::DragForward {
namespace {

struct Entry {
	Data::Session *session = nullptr;
	MessageIdsList ids;
};

[[nodiscard]] const QString &MimeType() {
	static const auto result = QStringLiteral(
		"application/x-crossgram-forward-v1");
	return result;
}

[[nodiscard]] QByteArray ProcessPrefix() {
	static const auto result = QByteArray("1:")
		+ QByteArray::number(QCoreApplication::applicationPid())
		+ ':'
		+ QUuid::createUuid().toByteArray(QUuid::WithoutBraces)
		+ ':';
	return result;
}

[[nodiscard]] QHash<QByteArray, Entry> &Registry() {
	static auto result = QHash<QByteArray, Entry>();
	return result;
}

[[nodiscard]] QString SafeFileName(QString name, int index) {
	name = QFileInfo(name).fileName().trimmed();
	for (auto &ch : name) {
		if (ch.unicode() < 32 || QStringLiteral("<>:\"/\\|?*").contains(ch)) {
			ch = '_';
		}
	}
	while (name.endsWith('.') || name.endsWith(' ')) {
		name.chop(1);
	}
	if (name.isEmpty()) {
		name = QStringLiteral("file-%1.bin").arg(index + 1);
	}
	return name;
}

[[nodiscard]] QString UniqueFileName(
		QString name,
		QSet<QString> &used) {
	if (!used.contains(name)) {
		used.insert(name);
		return name;
	}
	const auto info = QFileInfo(name);
	const auto base = info.completeBaseName();
	const auto suffix = info.completeSuffix();
	for (auto counter = 2; ; ++counter) {
		auto candidate = base + '-' + QString::number(counter);
		if (!suffix.isEmpty()) {
			candidate += '.' + suffix;
		}
		if (!used.contains(candidate)) {
			used.insert(candidate);
			return candidate;
		}
	}
}

[[nodiscard]] bool WriteBytes(
		const QString &path,
		const QByteArray &bytes) {
	if (bytes.isEmpty()) {
		return false;
	}
	auto file = QFile(path);
	return file.open(QIODevice::WriteOnly)
		&& file.write(bytes) == bytes.size();
}

struct PreparedPath {
	QString path;
	bool temporary = false;
};

[[nodiscard]] PreparedPath PrepareDocument(
		DocumentData *document,
		const QString &directory,
		QSet<QString> &usedNames,
		int index) {
	if (!document) {
		return {};
	}
	if (const auto path = document->filepath(true); !path.isEmpty()) {
		return { path, false };
	}
	const auto media = document->activeMediaView();
	const auto bytes = media ? media->bytes() : QByteArray();
	const auto name = UniqueFileName(
		SafeFileName(document->filename(), index),
		usedNames);
	const auto path = QDir(directory).filePath(name);
	return WriteBytes(path, bytes)
		? PreparedPath{ path, true }
		: PreparedPath();
}

[[nodiscard]] PreparedPath PreparePhoto(
		PhotoData *photo,
		const QString &directory,
		QSet<QString> &usedNames,
		int index) {
	if (!photo || photo->isNull()) {
		return {};
	}
	const auto media = photo->activeMediaView();
	constexpr auto size = Data::PhotoSize::Large;
	if (!media || !media->loaded() || !media->videoContent(size).isEmpty()) {
		return {};
	}
	const auto name = UniqueFileName(
		usedNames.contains(QStringLiteral("photo.jpg"))
			? QStringLiteral("photo-%1.jpg").arg(index + 1)
			: QStringLiteral("photo.jpg"),
		usedNames);
	const auto path = QDir(directory).filePath(name);
	const auto bytes = media->imageBytes(size);
	if (!bytes.isEmpty()) {
		return WriteBytes(path, bytes)
			? PreparedPath{ path, true }
			: PreparedPath();
	}
	const auto image = media->image(size);
	return image && image->original().save(path, "JPG", 90)
		? PreparedPath{ path, true }
		: PreparedPath();
}

void ClearStandardMedia(QMimeData *data) {
	data->removeFormat(QStringLiteral("text/uri-list"));
	data->removeFormat(QStringLiteral("application/x-qt-image"));
	data->removeFormat(QStringLiteral("image/jpeg"));
	data->removeFormat(QStringLiteral("application/x-td-use-jpeg"));
}

void AddMultiMediaFiles(
		QMimeData *data,
		Data::Session *session,
		const MessageIdsList &ids) {
	if (!data || !session || ids.size() < 2) {
		return;
	}
	const auto directory = QDir(QDir::tempPath()).filePath(
		QStringLiteral("crossgram-drag-%1").arg(
			QUuid::createUuid().toString(QUuid::WithoutBraces)));
	if (!QDir().mkpath(directory)) {
		ClearStandardMedia(data);
		return;
	}
	auto urls = QList<QUrl>();
	auto usedNames = QSet<QString>();
	auto hasTemporary = false;
	for (auto index = 0; index != int(ids.size()); ++index) {
		const auto item = session->message(ids[index]);
		const auto media = item ? item->media() : nullptr;
		const auto prepared = !media
			? PreparedPath()
			: media->document()
			? PrepareDocument(
				media->document(), directory, usedNames, index)
			: PreparePhoto(
				media->photo(), directory, usedNames, index);
		if (prepared.path.isEmpty()) {
			QDir(directory).removeRecursively();
			ClearStandardMedia(data);
			return;
		}
		hasTemporary = hasTemporary || prepared.temporary;
		urls.push_back(QUrl::fromLocalFile(prepared.path));
	}
	if (!hasTemporary) {
		QDir(directory).removeRecursively();
	} else {
		QTimer::singleShot(2 * 60 * 60 * 1000, [directory] {
			QDir(directory).removeRecursively();
		});
	}
	data->setUrls(std::move(urls));
}

[[nodiscard]] std::optional<QByteArray> LocalToken(
		const QByteArray &payload) {
	const auto prefix = ProcessPrefix();
	if (!payload.startsWith(prefix)) {
		return std::nullopt;
	}
	const auto token = payload.mid(prefix.size());
	return token.isEmpty()
		? std::nullopt
		: std::optional<QByteArray>(token);
}

[[nodiscard]] std::optional<QByteArray> LocalToken(
		const QMimeData *data) {
	return data
		? LocalToken(data->data(MimeType()))
		: std::nullopt;
}

} // namespace

void Set(
		QMimeData *data,
		Data::Session *session,
		MessageIdsList ids) {
	if (!data || !session || ids.empty()) {
		return;
	}
	AddMultiMediaFiles(data, session, ids);
	const auto token = QUuid::createUuid().toByteArray(QUuid::WithoutBraces);
	Registry().insert(token, Entry{
		.session = session,
		.ids = std::move(ids),
	});
	QTimer::singleShot(5 * 60 * 1000, [token] {
		Registry().remove(token);
	});
	data->setData(MimeType(), ProcessPrefix() + token);
}

bool CanTake(
		const QMimeData *data,
		const Data::Session *session) {
	const auto token = LocalToken(data);
	if (!token || !session) {
		return false;
	}
	const auto i = Registry().constFind(*token);
	return i != Registry().cend() && i->session == session;
}

std::optional<MessageIdsList> Take(
		const QMimeData *data,
		const Data::Session *session) {
	const auto token = LocalToken(data);
	if (!token || !session) {
		return std::nullopt;
	}
	auto &registry = Registry();
	const auto i = registry.find(*token);
	if (i == registry.end() || i->session != session) {
		return std::nullopt;
	}
	auto result = std::move(i->ids);
	registry.erase(i);
	return result;
}

void CopyMarker(const QMimeData *source, QMimeData *destination) {
	if (source && destination && source->hasFormat(MimeType())) {
		destination->setData(MimeType(), source->data(MimeType()));
	}
}

} // namespace Crossgram::DragForward
