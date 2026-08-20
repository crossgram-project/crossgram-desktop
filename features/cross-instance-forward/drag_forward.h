#pragma once

#include <QtCore/QByteArray>

#include <optional>
#include <vector>

class QMimeData;
struct FullMsgId;

using MessageIdsList = std::vector<FullMsgId>;

namespace Data {
class Session;
} // namespace Data

namespace Crossgram::DragForward {

void Set(
	QMimeData *data,
	Data::Session *session,
	MessageIdsList ids);

[[nodiscard]] bool CanTake(
	const QMimeData *data,
	const Data::Session *session);

[[nodiscard]] std::optional<MessageIdsList> Take(
	const QMimeData *data,
	const Data::Session *session);

void CopyMarker(const QMimeData *source, QMimeData *destination);

// Telegram prefers the private JPEG payload over the standard image data and
// does not fall back when that payload is empty or contains another format.
// Keep the optimization only when the advertised bytes really are JPEG.
void SanitizeImageMime(QMimeData *data);

} // namespace Crossgram::DragForward
