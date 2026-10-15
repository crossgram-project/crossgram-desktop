#pragma once

class PeerData;
class QString;

namespace Crossgram::MergedForward {

[[nodiscard]] bool IsUsername(const QString &username);
void Mark(PeerData *peer);
[[nodiscard]] bool IsPeer(const PeerData *peer);

// 合成会话的消息 ID 均为哈希值，不会与 offsetId = 1 冲突；服务端收到该哨兵值时返回最早一页消息。
inline constexpr auto kFirstMessageOffsetId = 1;

} // namespace Crossgram::MergedForward
