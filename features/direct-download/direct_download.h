#pragma once

#include <QtCore/QByteArray>
#include <QtCore/QString>

#include <optional>

namespace Crossgram::DirectDownload {

struct ResolvedUrl {
	QString url;
	qint64 expiresAt = 0;
};

[[nodiscard]] bool IsCandidate(const QByteArray &fileReference);
[[nodiscard]] std::optional<ResolvedUrl> ParseResolvedUrl(const QByteArray &json);
[[nodiscard]] bool ValidateRangeResponse(
	int status,
	const QByteArray &contentRange,
	qint64 offset,
	const QByteArray &bytes);
void LogTransport(const QString &transport, const QString &reason);

} // namespace Crossgram::DirectDownload
