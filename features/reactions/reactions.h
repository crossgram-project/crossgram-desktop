#pragma once

#include "base/basic_types.h"

class PeerData;

namespace Main {
class Session;
} // namespace Main

namespace Crossgram::Reactions {

/**
 * Ask the relay whether this conversation accepts reactions and remember the
 * answer for the session. Called when a chat is opened, so the answer is
 * usually ready before the reaction entry is first offered.
 */
void Warm(not_null<Main::Session*> session, not_null<PeerData*> conversation);

/**
 * Whether the relay answered that this conversation cannot react at all.
 *
 * A platform advertises reactions account-wide, so Telegram Desktop's own peer
 * rules keep offering the entry in one-to-one chats where the relay rejects it.
 * Unknown stays false, which keeps the entry for servers without the Crossgram
 * API and for the moment before the answer arrives.
 */
bool Disabled(not_null<PeerData*> peer);

} // namespace Crossgram::Reactions
