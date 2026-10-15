#pragma once

#include <QString>

namespace Ui {
class PopupMenu;
}

namespace Crossgram::Branding {

// 读取持久化的运行时品牌并更新 Qt 应用显示名称。
void Initialize();

// 向已创建的弹出菜单追加运行时品牌切换项。
void FillMenu(Ui::PopupMenu *menu);

// 返回当前选中的品牌显示名称。
QString CurrentTitle();

// 切换并持久化品牌 ID，未知 ID 返回 false。
bool SetBrand(const QString &id);

} // namespace Crossgram::Branding
