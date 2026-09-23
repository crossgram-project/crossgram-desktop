#pragma once

class PeerData;
class QString;

namespace Crossgram::MergedForward {

[[nodiscard]] bool IsUsername(const QString &username);
void Mark(PeerData *peer);
[[nodiscard]] bool IsPeer(const PeerData *peer);

// Synthetic chats address messages by hashed ids, so a history request
// anchored at id 1 cannot collide with a message of the bundle. The relay
// answers it with the oldest page of the transcript.
inline constexpr auto kFirstMessageOffsetId = 1;

} // namespace Crossgram::MergedForward
