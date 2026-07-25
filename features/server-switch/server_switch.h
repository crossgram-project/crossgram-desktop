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

[[nodiscard]] bool ApplyStored(
	const QString &path,
	not_null<MTP::DcOptions*> options,
	QString *error = nullptr);

void FillMenu(
	not_null<Ui::PopupMenu*> menu,
	not_null<Window::Controller*> controller,
	not_null<Main::Account*> account);

} // namespace Crossgram::ServerSwitch
