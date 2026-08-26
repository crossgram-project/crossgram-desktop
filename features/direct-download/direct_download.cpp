#include "crossgram/direct_download.h"

#include "logs.h"

#include <QtCore/QJsonDocument>
#include <QtCore/QJsonObject>
#include <QtCore/QUrl>

namespace Crossgram::DirectDownload {

bool IsCandidate(const QByteArray &fileReference) {
	constexpr char kMediaPrefix[] = "bridge-media:";
	if (fileReference.startsWith(kMediaPrefix)) {
		const auto suffix = fileReference.mid(sizeof(kMediaPrefix) - 1);
		const auto separator = suffix.indexOf(':');
		const auto validId = [](const QByteArray &value) {
			if (value.isEmpty() || value.front() == '0') return false;
			for (const auto digit : value) {
				if (digit < '0' || digit > '9') return false;
			}
			return true;
		};
		if (separator < 0) return validId(suffix);
		if (suffix.indexOf(':', separator + 1) >= 0) return false;
		return validId(suffix.left(separator))
			&& validId(suffix.mid(separator + 1));
	}
	constexpr char kStickerPrefix[] = "bridge-sticker:";
	constexpr char kReactionPrefix[] = "bridge-reaction-resource:";
	return (fileReference.startsWith(kStickerPrefix)
		&& fileReference.size() > int(sizeof(kStickerPrefix) - 1))
		|| (fileReference.startsWith(kReactionPrefix)
			&& fileReference.size() > int(sizeof(kReactionPrefix) - 1));
}

std::optional<ResolvedUrl> ParseResolvedUrl(const QByteArray &json) {
	QJsonParseError error;
	const auto document = QJsonDocument::fromJson(json, &error);
	if (error.error != QJsonParseError::NoError || !document.isObject()) return std::nullopt;
	const auto object = document.object();
	const auto url = object.value(u"url"_q).toString();
	const auto expiresAt = qint64(object.value(u"expiresAt"_q).toDouble());
	const auto parsed = QUrl(url);
	if (!parsed.isValid()
		|| (parsed.scheme() != u"https"_q && parsed.scheme() != u"http"_q)
		|| expiresAt <= 0) {
		return std::nullopt;
	}
	return ResolvedUrl{ url, expiresAt };
}

bool ValidateHttpResponse(
		int status,
		const QByteArray &contentRange,
		qint64 offset) {
	if (offset == 0 && status == 200) return true;
	if (status != 206) return false;
	const auto prefix = "bytes " + QByteArray::number(offset) + '-';
	return contentRange.toLower().startsWith(prefix);
}

void LogTransport(const QString &transport, const QString &reason) {
	LOG(("crossgram_download_transport=%1 reason=%2").arg(transport, reason));
}

} // namespace Crossgram::DirectDownload
