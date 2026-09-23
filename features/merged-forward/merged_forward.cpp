#include "crossgram/merged_forward.h"

#include "crossgram/merged_forward_core.h"

#include <cstddef>

#include "data/data_peer.h"
#include "logs.h"

namespace Crossgram::MergedForward {
namespace {

base::flat_set<PeerId> &Peers() {
	static auto result = base::flat_set<PeerId>();
	return result;
}

} // namespace

bool IsUsername(const QString &username) {
	const auto utf8 = username.toUtf8();
	return IsSyntheticUsername(std::string_view(
		utf8.constData(),
		std::size_t(utf8.size())));
}

void Mark(PeerData *peer) {
	if (peer) {
		Peers().emplace(peer->id);
	}
}

bool IsPeer(const PeerData *peer) {
	return peer && Peers().contains(peer->id);
}

} // namespace Crossgram::MergedForward
