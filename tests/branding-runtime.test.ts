import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { patchBranding } from "../features/branding/patch.js";
import { targets } from "../src/targets.js";

const featureRoot = join(process.cwd(), "features", "branding");

const temporaryDirectories: string[] = [];
afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

describe("runtime branding patch", () => {
  it.each(targets)("installs a universal $id binary with stable platform metadata", async (target) => {
    const temporaryRoot = join(process.cwd(), "../work/tests/branding-unit");
    await mkdir(temporaryRoot, { recursive: true });
    const root = await mkdtemp(join(temporaryRoot, "fixture-"));
    temporaryDirectories.push(root);
    const files = {
      "Telegram/CMakeLists.txt": `if (CMAKE_GENERATOR STREQUAL Xcode)
    set(bundle_identifier_plist example)
endif()
if (CMAKE_GENERATOR STREQUAL Xcode)
endif()
    countries/countries_manager.h
install(FILES "../lib/xdg/${target.desktopFile}" DESTINATION share)
RENAME "${target.linuxIconId}.png"
${["symbolic", "attention-symbolic", "mute-symbolic"].map(suffix => `RENAME "${target.linuxIconId}-${suffix}.svg"`).join("\n")}
`,
      "Telegram/SourceFiles/core/version.h": ["AppId", "AppNameOld", "AppName", "AppFile"].map(name => `constexpr auto ${name} = "upstream"_cs;`).join("\n"),
      "Telegram/Telegram.plist": '\t<key>CFBundleName</key>\n\t<string>@output_name@</string>',
      ...Object.fromEntries(["Telegram.rc", "Updater.rc"].map(name => [`Telegram/Resources/winrc/${name}`, '#pragma code_page(1252)\nVALUE "FileDescription", "upstream"\nVALUE "ProductName", "upstream"'])),
      [`lib/xdg/${target.desktopFile}`]: "[Desktop Entry]\nName=upstream\nTryExec=upstream\nExec=upstream -- %U\nIcon=upstream\nStartupWMClass=upstream\nExec=upstream -quit\nName=Quit upstream\n",
      "Telegram/Resources/qrc/telegram/telegram.qrc": `<file alias="${target.desktopFile}">../../../../lib/xdg/${target.desktopFile}</file>`,
      "Telegram/SourceFiles/platform/linux/specific_linux.cpp": target.desktopFile.slice(0, -".desktop".length),
      "Telegram/SourceFiles/core/application.cpp": '#include "core/application.h"\n\tstartLocalStorage();\n',
      "Telegram/SourceFiles/window/window_main_menu.cpp": '#include "settings/settings_common.h"\n\taddAction(\n\t\ttr::lng_menu_settings(),\n',
      "Telegram/SourceFiles/window/main_window.cpp": `#include "window/main_window.h"\n\tsetTitle((user.isEmpty() ? u"${target.executable}"_q : user) + added${target.id === "ayugram" ? "" : " + suffix"});\n`,
    };
    for (const [path, content] of Object.entries(files)) {
      const full = join(root, path);
      await mkdir(join(full, ".."), { recursive: true });
      await writeFile(full, content, "utf8");
    }

    await patchBranding({
      root,
      target,
      brand: null,
      featureRoot,
    });

    const runtime = await readFile(join(root, "Telegram/SourceFiles/crossgram/branding_runtime.cpp"), "utf8");
    expect(runtime).toContain('#include "settings.h"');
    expect(runtime).toContain("#include <QtGui/QAction>");
    expect(runtime).not.toContain("core/config.h");
    expect(runtime).not.toContain("base/qt_support.h");
    expect(runtime).not.toContain("setApplicationName(");
    expect(runtime).toContain("setApplicationDisplayName(");
    const cmake = await readFile(join(root, "Telegram/CMakeLists.txt"), "utf8");
    const application = await readFile(join(root, "Telegram/SourceFiles/core/application.cpp"), "utf8");
    const menu = await readFile(join(root, "Telegram/SourceFiles/window/window_main_menu.cpp"), "utf8");
    expect(cmake).toContain("crossgram/branding_runtime.cpp");
    expect(application).toContain("Crossgram::Branding::Initialize();");
    expect(menu).toContain("Crossgram::Branding::FillMenu(_contextMenu.get());");
    expect(await readFile(join(root, "Telegram/SourceFiles/crossgram/branding_runtime.cpp"), "utf8"))
      .toContain("QQ · Cross");

    expect(cmake).toContain(`set(output_name "${target.crossName}")`);
    expect(menu).toContain('rpl::single(QString::fromUtf8("Crossgram brand"))');
    const window = await readFile(join(root, "Telegram/SourceFiles/window/main_window.cpp"), "utf8");
    expect(window).toContain(`CurrentTitle() : user) + added${target.id === "ayugram" ? "" : " + suffix"});`);
    const paths = [...Object.keys(files), "Telegram/SourceFiles/crossgram/branding_runtime.cpp", "Telegram/SourceFiles/crossgram/branding_runtime.h"];
    const snapshot = () => Promise.all(paths.map(path => readFile(join(root, path), "utf8")));
    const once = await snapshot();
    await patchBranding({ root, target, brand: null, featureRoot });
    expect(await snapshot()).toEqual(once);
  });
});
