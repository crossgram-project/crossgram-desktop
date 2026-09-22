#pragma once

#include "ui/widgets/menu/menu_add_action_callback.h"

class PeerData;

namespace Main {
class Session;
} // namespace Main

namespace Window {
class SessionController;
} // namespace Window

namespace Crossgram::Poke {

/**
 * Ask the relay what this conversation supports and remember the answer for the
 * session. Called when a chat is opened, so the menu entry is usually ready
 * before the user opens any menu.
 */
void Warm(not_null<Main::Session*> session, not_null<PeerData*> conversation);

/**
 * Append the poke entry, including its burst submenu, to a peer or userpic menu.
 *
 * Nothing is added while the relay has not answered, and nothing is added once
 * it answered that this conversation cannot be poked; that is what keeps the
 * entry hidden on servers without the feature, such as official Telegram.
 */
void AddMenuAction(
	not_null<Window::SessionController*> controller,
	PeerData *target,
	PeerData *conversation,
	const Ui::Menu::MenuCallback &addAction);

} // namespace Crossgram::Poke
