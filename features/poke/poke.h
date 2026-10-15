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
 * 打开会话时预查询并缓存服务端支持的特性，确保首次打开右键菜单时即可显示。
 */
void Warm(not_null<Main::Session*> session, not_null<PeerData*> conversation);

/**
 * 向会话或头像菜单追加“戳一戳”及连戳子菜单。
 * 仅在服务端明确返回支持时显示，官方 Telegram 等服务端不会展示该项。
 */
void AddMenuAction(
	not_null<Window::SessionController*> controller,
	PeerData *target,
	PeerData *conversation,
	const Ui::Menu::MenuCallback &addAction);

} // namespace Crossgram::Poke
