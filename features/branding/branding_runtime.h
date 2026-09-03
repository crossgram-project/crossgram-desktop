#pragma once

#include <QString>

class QIcon;

namespace Ui {
class PopupMenu;
}

namespace Crossgram::Branding {

// Initializes the persisted runtime brand and updates Qt application metadata.
void Initialize();

// Adds runtime brand choices to an already-owned popup menu.
void FillMenu(Ui::PopupMenu *menu);

// Returns the selected display name.
QString CurrentTitle();

// Applies and persists a brand id. Returns false for unknown ids.
bool SetBrand(const QString &id);

} // namespace Crossgram::Branding
