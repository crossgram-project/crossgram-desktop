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

} // namespace Crossgram::DragForward
