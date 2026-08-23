#pragma once

class PeerData;
class QString;

namespace Crossgram::MergedForward {

[[nodiscard]] bool IsUsername(const QString &username);
void Mark(PeerData *peer);
[[nodiscard]] bool IsPeer(const PeerData *peer);

} // namespace Crossgram::MergedForward
