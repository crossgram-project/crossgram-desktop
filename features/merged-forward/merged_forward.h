#pragma once

#include "data/data_msg_id.h"

#include <QtCore/QByteArray>

class PeerData;
class QString;

namespace Crossgram::MergedForward {

[[nodiscard]] bool IsUsername(const QString &username);
void Mark(PeerData *peer);
[[nodiscard]] bool IsPeer(const PeerData *peer);

/**
 * Message id the relay reports for the beginning of a synthetic merged-forward
 * transcript. A relay that cannot answer, or a malformed answer, keeps
 * `fallback` so the deep link anchor stays usable.
 */
[[nodiscard]] MsgId FirstMessageId(const QByteArray &json, MsgId fallback);

} // namespace Crossgram::MergedForward
