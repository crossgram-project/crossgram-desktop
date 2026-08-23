#include "crossgram/merged_forward.h"

#include "data/data_peer.h"

namespace Crossgram::MergedForward {
namespace {

base::flat_set<PeerId> &Peers() {
	static auto result = base::flat_set<PeerId>();
	return result;
}

} // namespace

bool IsUsername(const QString &username) {
	const auto prefix = QStringLiteral("bridgechat_");
	if (!username.startsWith(prefix, Qt::CaseInsensitive)) {
		return false;
	}
	const auto suffix = username.mid(prefix.size());
	if (suffix.isEmpty()) {
		return false;
	}
	for (const auto ch : suffix) {
		if (!ch.isDigit()) {
			return false;
		}
	}
	auto ok = false;
	const auto id = suffix.toLongLong(&ok);
	return ok && id > 0;
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
