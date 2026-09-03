#include "crossgram/branding_runtime.h"

#include "core/application.h"
#include "core/config.h"
#include "ui/widgets/popup_menu.h"
#include "base/qt_support.h"

#include <QtCore/QFile>
#include <QtCore/QSaveFile>
#include <QtCore/QTextStream>
#include <QtGui/QGuiApplication>

namespace Crossgram::Branding {
namespace {

struct Brand {
	const char *id;
	const char *title;
};

constexpr Brand kBrands[] = {
	{ "cross", "Crossgram" },
	{ "qq", "QQ · Cross" },
	{ "wechat", "微信 · Cross" },
	{ "wecom", "企业微信 · Cross" },
	{ "dingtalk", "钉钉 · Cross" },
	{ "discord", "Discord · Cross" },
};

QString Path() {
	return cWorkingDir() + u"tdata/crossgram-brand"_q;
}

const Brand *Find(const QString &id) {
	for (const auto &brand : kBrands) {
		if (id == QString::fromUtf8(brand.id)) return &brand;
	}
	return &kBrands[0];
}

QString Read() {
	QFile file(Path());
	if (!file.open(QIODevice::ReadOnly)) return u"cross"_q;
	return QString::fromUtf8(file.readAll()).trimmed();
}

QString CurrentId;

} // namespace

void Initialize() {
	CurrentId = QString::fromUtf8(Find(Read())->id);
	const auto title = CurrentTitle();
	QCoreApplication::setApplicationName(title);
	QGuiApplication::setApplicationDisplayName(title);
}

QString CurrentTitle() {
	return QString::fromUtf8(Find(CurrentId.isEmpty() ? Read() : CurrentId)->title);
}

bool SetBrand(const QString &id) {
	const auto *brand = Find(id);
	if (QString::fromUtf8(brand->id) != id) return false;
	QSaveFile file(Path());
	if (!file.open(QIODevice::WriteOnly | QIODevice::Truncate)) return false;
	file.write(id.toUtf8());
	if (!file.commit()) return false;
	CurrentId = id;
	return true;
}

void FillMenu(Ui::PopupMenu *menu) {
	if (!menu) return;
	for (const auto &brand : kBrands) {
		const auto id = QString::fromUtf8(brand.id);
		const auto action = menu->addAction(
			QString::fromUtf8(brand.title), [id] {
				if (SetBrand(id)) Core::Restart();
			});
		action->setCheckable(true);
		action->setChecked(id == CurrentId);
	}
}

} // namespace Crossgram::Branding
