import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { patchServerSwitch } from "../features/server-switch/patch.js";
import { targetById } from "../src/targets.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })));
});

async function fixture(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "crossgram-desktop-server-switch-"));
  temporaryDirectories.push(root);
  const files: Record<string, string> = {
    "Telegram/CMakeLists.txt": `target_sources(Telegram PRIVATE
    countries/countries_manager.h
)
`,
    "Telegram/build/prepare/prepare.py": `    msbuild -m dump_syms.vcxproj /property:Configuration=Release /property:Platform="x64"
`,
    "Telegram/SourceFiles/mtproto/mtproto_dc_options.h": `class DcOptions {
public:
\t[[nodiscard]] bool isTestMode() const;
private:
\tbool _immutable = false;
};
`,
    "Telegram/SourceFiles/mtproto/mtproto_dc_options.cpp": `DcOptions::DcOptions(const DcOptions &other)
: _data(other._data)
, _immutable(other._immutable) {
}

bool DcOptions::isTestMode() const {
\treturn false;
}
`,
    "Telegram/SourceFiles/mtproto/config_loader.cpp": `void ConfigLoader::load() {
\tif (_proxyEnabled || _instance->isKeysDestroyer()) {
\t\treturn;
\t}
}
`,
    "Telegram/SourceFiles/storage/storage_account.h": `class Account {
public:
\t[[nodiscard]] QString tempDirectory() const;
};
`,
    "Telegram/SourceFiles/storage/storage_account.cpp": `QString Account::tempDirectory() const {
\treturn _tempPath;
}

base::flat_set<QString> Account::collectGoodNames() const {
\tauto result = base::flat_set<QString>{
\t\t"map0",
\t\t"configs",
\t};
\treturn result;
}
`,
    "Telegram/SourceFiles/main/main_account.h": `class Account {
public:
\tvoid destroyStaleAuthorizationKeys();
};
`,
    "Telegram/SourceFiles/main/main_account.cpp": `#include "core/application.h"

void Account::start(std::unique_ptr<MTP::Config> config) {
\tstartMtp(std::move(config));
}

void Account::destroyStaleAuthorizationKeys() {
}
`,
    "Telegram/SourceFiles/intro/intro_widget.h": `namespace Ui {
class FlatLabel;
}

class Widget {
\tobject_ptr<Ui::FadeWrap<Ui::RoundButton>> _settings;
};
`,
    "Telegram/SourceFiles/intro/intro_widget.cpp": `#include "countries/countries_instance.h"
#include "ui/widgets/labels.h"

Widget::Widget()
: _settings(
\tthis,
\tobject_ptr<Ui::RoundButton>(
\t\tthis,
\t\trpl::single(u"Settings"_q),
\t\tst::defaultBoxButton))
, _next(
\tthis) {
\t_settings->entity()->setTextTransform(Ui::RoundButtonTextTransform::ToUpper);
}

void Widget::showAnimated() {
\t_settings->toggle(!stepHasCover, anim::type::normal);
}

void Widget::fixOrder() {
\t_next->raise();
\tif (_update) _update->raise();
\tif (_changeLanguage) _changeLanguage->raise();
\t_settings->raise();
}

void Widget::append() {
\tappendStep(step);
\t_back->raise();
\t_settings->raise();
}

void Widget::showInstant() {
\t_settings->toggle(!hasCover, anim::type::instant);
}

void Widget::hideInstant() {
\t_settings->hide(anim::type::instant);
}

void Widget::resizeEvent() {
\t_settings->moveToRight(skip, controlsTop + skip);
\tif (_testModeLabel) {
\t\t_testModeLabel->moveToRight(
\t\t\tskip + _settings->width() + skip,
\t\t\tcontrolsTop);
\t}
\tif (_update) {
\t\t_update->moveToRight(
\t\t\tskip + _settings->width() + skip,
\t\t\tcontrolsTop);
\t}
}
`,
  };
  await Promise.all(Object.entries(files).map(async ([relative, source]) => {
    const destination = path.join(root, relative);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, source, "utf8");
  }));
  return root;
}

describe("server switch patch", () => {
  it("retains the saved configuration during account cleanup", async () => {
    const root = await fixture();
    const options = {
      root,
      target: targetById("ayugram"),
      featureRoot: path.resolve("features/server-switch"),
    };

    await patchServerSwitch(options);
    const storagePath = path.join(
      root,
      "Telegram/SourceFiles/storage/storage_account.cpp",
    );
    const first = await readFile(storagePath, "utf8");
    expect(first).toContain('return _basePath + u"server-switch.json"_q;');
    expect(first.match(/"server-switch\.json",/g)).toHaveLength(1);

    await patchServerSwitch(options);
    expect(await readFile(storagePath, "utf8")).toBe(first);
  });
});
