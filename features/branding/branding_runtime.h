#pragma once

#include <QString>

namespace Ui {
class PopupMenu;
}

namespace Crossgram::Branding {

// Initializes the persisted runtime brand and updates the Qt display name.
void Initialize();

// Adds runtime brand choices to an already-owned popup menu.
void FillMenu(Ui::PopupMenu *menu);

// Returns the selected display name.
QString CurrentTitle();

// Applies and persists a brand id. Returns false for unknown ids.
bool SetBrand(const QString &id);

} // namespace Crossgram::Branding
