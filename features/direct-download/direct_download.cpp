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
		if (suffix.isEmpty() || suffix.front() == '0') return false;
		for (const auto value : suffix) {
			if (value < '0' || value > '9') return false;
		}
		return true;
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
	const auto range = object.value(u"supportsRange"_q).toBool();
	const auto parsed = QUrl(url);
	if (!parsed.isValid()
		|| (parsed.scheme() != u"https"_q && parsed.scheme() != u"http"_q)
		|| expiresAt <= 0
		|| !range) {
		return std::nullopt;
	}
	return ResolvedUrl{ url, expiresAt };
}

bool ValidateRangeResponse(
		int status,
		const QByteArray &contentRange,
		qint64 offset,
		const QByteArray &bytes) {
	if (status != 206 || bytes.isEmpty()) return false;
	const auto normalized = contentRange.toLower();
	const auto prefix = "bytes " + QByteArray::number(offset) + '-';
	if (!normalized.startsWith(prefix)) return false;
	const auto slash = normalized.indexOf('/', prefix.size());
	if (slash < 0) return false;
	bool endOk = false;
	bool totalOk = false;
	const auto end = normalized.mid(prefix.size(), slash - prefix.size()).toLongLong(&endOk);
	const auto total = normalized.mid(slash + 1).toLongLong(&totalOk);
	return endOk
		&& totalOk
		&& end == offset + bytes.size() - 1
		&& total > end;
}

void LogTransport(const QString &transport, const QString &reason) {
	LOG(("crossgram_download_transport=%1 reason=%2").arg(transport, reason));
}

} // namespace Crossgram::DirectDownload
