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

// Telegram 优先读取私有 JPEG MIME 数据，且在其为空或非 JPEG 格式时不会回退到标准图片数据；
// 仅在字节确实为 JPEG 时保留该标记。
void SanitizeImageMime(QMimeData *data);

} // namespace Crossgram::DragForward
