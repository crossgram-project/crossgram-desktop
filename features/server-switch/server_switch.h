#pragma once

class QString;

namespace Main {
class Account;
} // namespace Main

namespace MTP {
class DcOptions;
} // namespace MTP

namespace Ui {
class PopupMenu;
} // namespace Ui

namespace Window {
class Controller;
} // namespace Window

namespace Crossgram::ServerSwitch {

// What an account without a stored server-switch.json asks for.
enum class MissingStoredConfiguration {
	// Keep the configuration built by the caller. Adding an account is the
	// case that matters: it is handed the MTProto configuration of an
	// existing account and inherits the stored server from the same account,
	// so the built-in servers are not what it asked for.
	Keep,

	// Rebuild the built-in official Telegram configuration. This is what the
	// "Official Telegram" menu entry asks for.
	Official,
};

[[nodiscard]] bool ApplyStored(
	const QString &path,
	not_null<MTP::DcOptions*> options,
	MissingStoredConfiguration missing,
	QString *error = nullptr);

// Gives an account that is being added the stored configuration of `source`,
// so that both accounts start on the same server. The file is only a starting
// point: later changes to one account leave the other one alone.
void InheritConfiguration(
	not_null<Main::Account*> account,
	Main::Account *source);

void FillMenu(
	not_null<Ui::PopupMenu*> menu,
	not_null<Window::Controller*> controller,
	not_null<Main::Account*> account);

} // namespace Crossgram::ServerSwitch
