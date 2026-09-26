#include "crossgram/reactions.h"

#include "apiwrap.h"
#include "base/weak_ptr.h"
#include "data/data_changes.h"
#include "data/data_peer.h"
#include "data/data_session.h"
#include "logs.h"
#include "main/main_session.h"
#include "mtproto/facade.h"

#include <QtCore/QDateTime>
#include <QtCore/QJsonDocument>
#include <QtCore/QJsonObject>
#include <QtCore/QJsonValue>

#include <map>
#include <memory>
#include <optional>

namespace Crossgram::Reactions {
namespace {

/** Probes that never arrive are repeated no faster than this. */
constexpr auto kProbeDelayMs = qint64(60 * 60 * 1000);

enum class Support {
	Unknown,
	Supported,
	Unsupported,
};

struct ConversationState {
	Support support = Support::Unknown;
	qint64 requestedAt = 0;
};

struct SessionState {
	explicit SessionState(not_null<Main::Session*> session) : session(session) {
	}

	/** Identifies the owning session, so a recycled address never matches. */
	base::weak_ptr<Main::Session> session;

	/** The relay rejected the feature query: this server has no Crossgram API. */
	bool unavailable = false;

	std::map<uint64, ConversationState> conversations;
};

std::map<Main::Session*, std::unique_ptr<SessionState>> &States() {
	static auto result = std::map<Main::Session*, std::unique_ptr<SessionState>>();
	return result;
}

SessionState &StateFor(not_null<Main::Session*> session) {
	auto &states = States();
	const auto i = states.find(session);
	if (i != end(states) && i->second->session.get() == session) {
		return *i->second;
	}
	auto state = std::make_unique<SessionState>(session);
	const auto result = state.get();
	states[session] = std::move(state);
	return *result;
}

/** Read `{"reactions":{"supported":false}}` from the relay's feature payload. */
std::optional<bool> ParseSupported(const MTPDataJSON &result) {
	return result.match([](const MTPDdataJSON &data) {
		const auto document = QJsonDocument::fromJson(data.vdata().v.toUtf8());
		const auto reactions = document.isObject()
			? document.object().value(u"reactions"_q)
			: QJsonValue();
		const auto supported = reactions.isObject()
			? reactions.toObject().value(u"supported"_q)
			: QJsonValue();
		return supported.isBool()
			? std::make_optional(supported.toBool())
			: std::optional<bool>();
	});
}

void Apply(not_null<Main::Session*> session, PeerId peerId, std::optional<bool> supported) {
	auto &state = StateFor(session).conversations[peerId.value];
	state.support = (supported.has_value() && !*supported)
		? Support::Unsupported
		: Support::Supported;

	// Every reaction entry is derived from the peer's allowed reactions, so the
	// answer has to republish that flag for the already-open UI to refresh.
	session->changes().peerUpdated(
		session->data().peer(peerId),
		Data::PeerUpdate::Flag::Reactions);
}

void Probe(not_null<Main::Session*> session, PeerId peerId, not_null<PeerData*> conversation) {
	session->api().request(MTPcrossgram_GetFeatures(
		conversation->input()
	)).done([=](const MTPDataJSON &result) {
		Apply(session, peerId, ParseSupported(result));
	}).fail([=](const MTP::Error &error) {
		// A server without the Crossgram API answers an unknown method with an
		// error. Keep the client's own rules instead of hiding reactions that
		// an official Telegram server does support.
		LOG(("Crossgram reaction feature query failed: %1").arg(error.type()));
		auto &state = StateFor(session);
		state.unavailable = true;
		state.conversations[peerId.value].support = Support::Supported;
	}).send();
}

void EnsureProbed(not_null<Main::Session*> session, not_null<PeerData*> conversation) {
	auto &state = StateFor(session);
	if (state.unavailable) {
		return;
	}
	const auto now = QDateTime::currentMSecsSinceEpoch();
	auto &conversationState = state.conversations[conversation->id.value];
	if (conversationState.support != Support::Unknown) {
		return;
	} else if (conversationState.requestedAt
		&& (now - conversationState.requestedAt < kProbeDelayMs)) {
		return;
	}
	conversationState.requestedAt = now;
	Probe(session, conversation->id, conversation);
}

} // namespace

void Warm(not_null<Main::Session*> session, not_null<PeerData*> conversation) {
	// QQ reactions only exist in groups, so only one-to-one chats can need the
	// entry hidden.
	if (!conversation->isUser()) {
		return;
	}
	EnsureProbed(session, conversation);
}

bool Disabled(not_null<PeerData*> peer) {
	if (!peer->isUser()) {
		return false;
	}
	auto *session = &peer->session();
	auto &state = StateFor(session);
	if (state.unavailable) {
		return false;
	}
	EnsureProbed(session, peer);
	const auto i = state.conversations.find(peer->id.value);
	return (i != end(state.conversations))
		&& (i->second.support == Support::Unsupported);
}

} // namespace Crossgram::Reactions
