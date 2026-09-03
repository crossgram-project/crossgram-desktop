import { readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import pngToIco from "png-to-ico";
import sharp from "sharp";
import type { ResolvedBrand } from "../../src/brands.js";
import { PatchContext } from "../../src/core/patch-context.js";
import type { Target } from "../../src/targets.js";

interface PatchOptions {
  readonly root: string;
  readonly target: Target;
  readonly brand: ResolvedBrand | null;
  readonly featureRoot: string;
}

const versionRoot = "Telegram/SourceFiles/core/version.h";

async function replacePngs(source: string, directories: readonly string[]): Promise<void> {
  for (const directory of directories) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".png")) continue;
      const destination = join(directory, entry.name);
      const metadata = await sharp(destination).metadata();
      if (!metadata.width || !metadata.height) {
        throw new Error(`Could not read icon dimensions from ${destination}.`);
      }
      const output = await sharp(source)
        .resize(metadata.width, metadata.height, { fit: "fill" })
        .png()
        .toBuffer();
      await writeFile(destination, output);
    }
  }
}

async function replaceApplicationIcons(options: PatchOptions & { readonly brand: ResolvedBrand }): Promise<void> {
  if (!options.brand.icon) return;
  const source = join(options.featureRoot, "assets", options.brand.icon);
  const art = join(options.root, "Telegram", "Resources", "art");
  const artEntries = await readdir(art, { withFileTypes: true });
  const numericIcons = artEntries
    .filter((entry) => entry.isFile() && /^icon\d+(?:@2x)?\.png$/i.test(entry.name))
    .map((entry) => join(art, entry.name));
  for (const destination of numericIcons) {
    const metadata = await sharp(destination).metadata();
    if (!metadata.width || !metadata.height) throw new Error(`Invalid icon ${destination}.`);
    const output = await sharp(source).resize(metadata.width, metadata.height, { fit: "fill" }).png().toBuffer();
    await writeFile(destination, output);
  }

  await replacePngs(source, [
    join(options.root, "Telegram", "Telegram", "Images.xcassets", options.target.macIconSet),
    join(options.root, "Telegram", "Telegram", "Images.xcassets", "Icon.iconset"),
  ]);
  const icoSource = await sharp(source).resize(256, 256, { fit: "fill" }).png().toBuffer();
  await writeFile(join(art, "icon256.ico"), await pngToIco(icoSource));
}

export async function patchBranding(options: PatchOptions): Promise<void> {
  const context = new PatchContext(options.root, options.target, options.featureRoot);
  const { brand } = options;

  if (!brand) {
    await patchRuntimeBranding(options, context);
    return;
  }

  await context.edit(versionRoot, (file) => {
    file.replacePattern(/^constexpr auto AppId = "[^"]*"_cs;$/m, `constexpr auto AppId = "${brand.windowsAppId}"_cs;`);
    file.replacePattern(/^constexpr auto AppNameOld = "[^"]*"_cs;$/m, `constexpr auto AppNameOld = "${brand.title}"_cs;`);
    file.replacePattern(/^constexpr auto AppName = "[^"]*"_cs;$/m, `constexpr auto AppName = "${brand.title}"_cs;`);
    file.replacePattern(/^constexpr auto AppFile = "[^"]*"_cs;$/m, `constexpr auto AppFile = "${brand.executable}"_cs;`);
  });

  await context.edit("Telegram/CMakeLists.txt", (file) => {
    file.insertBefore(
      "if (CMAKE_GENERATOR STREQUAL Xcode)\n    set(bundle_identifier_plist",
      `# Crossgram branding\nset(output_name "${brand.executable}")\nset(crossgram_display_name "${brand.title}")\nstring(APPEND bundle_identifier ".${brand.packageSuffix}")\nset(crossgram_linux_id "${brand.linuxId}")\n\n`,
      "# Crossgram branding",
    );
    file.replacePattern(
      new RegExp(`install\\(FILES "\\.\\.\\/lib\\/xdg\\/${options.target.desktopFile.replaceAll(".", "\\.")}" DESTINATION ([^\\n]+)\\)`),
      `install(FILES "../lib/xdg/${options.target.desktopFile}" DESTINATION $1 RENAME "${brand.linuxId}.desktop")`,
      `RENAME "${brand.linuxId}.desktop"`,
    );
    file.replaceEvery(
      `RENAME "${options.target.linuxIconId}.png"`,
      'RENAME "${crossgram_linux_id}.png"',
    );
    for (const suffix of ["symbolic", "attention-symbolic", "mute-symbolic"]) {
      file.replaceEvery(
        `RENAME "${options.target.linuxIconId}-${suffix}.svg"`,
        `RENAME "\${crossgram_linux_id}-${suffix}.svg"`,
      );
    }
  });

  await context.edit("Telegram/Telegram.plist", (file) => {
    file.replace(
      "\t<key>CFBundleName</key>\n\t<string>@output_name@</string>",
      "\t<key>CFBundleDisplayName</key>\n\t<string>@crossgram_display_name@</string>\n\t<key>CFBundleName</key>\n\t<string>@crossgram_display_name@</string>",
      "<string>@crossgram_display_name@</string>",
    );
  });

  for (const resource of ["Telegram.rc", "Updater.rc"]) {
    await context.edit(`Telegram/Resources/winrc/${resource}`, (file) => {
      file.replace("#pragma code_page(1252)", "#pragma code_page(65001)");
      file.replacePattern(/^\s*VALUE "FileDescription", "[^"]*"$/m, `            VALUE "FileDescription", "${brand.title}${resource === "Updater.rc" ? " Updater" : ""}"`);
      file.replacePattern(/^\s*VALUE "ProductName", "[^"]*"$/m, `            VALUE "ProductName", "${brand.title}"`);
      file.normalizeLf();
    });
  }

  await context.edit(`lib/xdg/${options.target.desktopFile}`, (file) => {
    const keepsEnvironment = /^Exec=env DESKTOPINTEGRATION=1 /m.test(file.text());
    file.replacePattern(/^\[Desktop Entry\]\r?\nName=.*$/m, `[Desktop Entry]\nName=${brand.title}`);
    file.replacePattern(/^TryExec=.*$/m, `TryExec=${brand.executable}`);
    file.replacePattern(/^Exec=.* -- %U$/m, `Exec=${keepsEnvironment ? "env DESKTOPINTEGRATION=1 " : ""}${brand.executable} -- %U`);
    file.replacePattern(/^Icon=(?!application-exit).+$/m, `Icon=${brand.linuxId}`);
    file.replacePattern(/^StartupWMClass=.*$/m, `StartupWMClass=${brand.executable}`);
    file.replacePattern(/^Exec=.* -quit$/m, `Exec=${brand.executable} -quit`);
    file.replacePattern(/^Name=Quit .*$/m, `Name=Quit ${brand.title}`);
  });

  const linuxBaseId = options.target.desktopFile.slice(0, -".desktop".length);
  await context.edit("Telegram/Resources/qrc/telegram/telegram.qrc", (file) => {
    file.replace(
      `<file alias="${linuxBaseId}.desktop">../../../../lib/xdg/${options.target.desktopFile}</file>`,
      `<file alias="${brand.linuxId}.desktop">../../../../lib/xdg/${options.target.desktopFile}</file>`,
      `alias="${brand.linuxId}.desktop"`,
    );
  });
  await context.edit("Telegram/SourceFiles/platform/linux/specific_linux.cpp", (file) => {
    file.replaceEvery(linuxBaseId, brand.linuxId);
  });

  await replaceApplicationIcons(options as PatchOptions & { readonly brand: ResolvedBrand });
}

/**
 * Patch one universal binary. Unlike the legacy per-brand mode this keeps
 * platform metadata stable and stores the selected display brand in tdata.
 * The menu is available from the main menu and a restart applies the change.
 */
async function patchRuntimeBranding(
  options: PatchOptions,
  context: PatchContext,
): Promise<void> {
  const sourceRoot = "Telegram/SourceFiles";
  await context.install("branding_runtime.h", `${sourceRoot}/crossgram/branding_runtime.h`);
  await context.install("branding_runtime.cpp", `${sourceRoot}/crossgram/branding_runtime.cpp`);
  await context.edit(`${sourceRoot}/crossgram/branding_runtime.cpp`, (file) => {
    file.replace(
      '{ "cross", "Crossgram" },',
      `{ "cross", "${options.target.crossName}" },`,
      `{ "cross", "${options.target.crossName}" },`,
    );
  });

  await context.edit("Telegram/CMakeLists.txt", (file) => {
    file.insertBefore(
      "if (CMAKE_GENERATOR STREQUAL Xcode)",
      "# Crossgram runtime branding\nset(crossgram_runtime_branding ON)\n\n",
      "crossgram_runtime_branding",
    );
    file.insertAfter(
      "    countries/countries_manager.h",
      "\n    crossgram/branding_runtime.cpp\n    crossgram/branding_runtime.h",
      "crossgram/branding_runtime.cpp",
    );
  });

  await context.edit(`${sourceRoot}/core/application.cpp`, (file) => {
    file.insertAfter(
      '#include "core/application.h"',
      '\n#include "crossgram/branding_runtime.h"',
      '#include "crossgram/branding_runtime.h"',
    );
    file.insertAfter(
      "\tstartLocalStorage();",
      "\n\tCrossgram::Branding::Initialize();",
      "Crossgram::Branding::Initialize();",
    );
  });

  await context.edit(`${sourceRoot}/window/window_main_menu.cpp`, (file) => {
    file.insertAfter(
      '#include "settings/settings_common.h"',
      '\n#include "crossgram/branding_runtime.h"',
      '#include "crossgram/branding_runtime.h"',
    );
    file.insertBefore(
      '\taddAction(\n\t\ttr::lng_menu_settings(),',
      '\taddAction(\n\t\tQString::fromUtf8("Crossgram brand"),\n\t\t{ &st::menuIconSettings }\n\t)->setClickedCallback([=] {\n\t\t_contextMenu = base::make_unique_q<Ui::PopupMenu>(this, st::popupMenuExpandedSeparator);\n\t\tCrossgram::Branding::FillMenu(_contextMenu.get());\n\t\t_contextMenu->popup(QCursor::pos());\n\t});\n',
      'Crossgram::Branding::FillMenu(_contextMenu.get());',
    );
  });

  await context.edit(`${sourceRoot}/window/main_window.cpp`, (file) => {
    file.insertAfter(
      '#include "window/main_window.h"',
      '\n#include "crossgram/branding_runtime.h"',
      '#include "crossgram/branding_runtime.h"',
    );
    file.replace(
      'setTitle((user.isEmpty() ? u"Telegram"_q : user) + added + suffix);',
      'setTitle((user.isEmpty() ? Crossgram::Branding::CurrentTitle() : user) + added + suffix);',
      'Crossgram::Branding::CurrentTitle() : user',
    );
  });

  // Runtime mode deliberately leaves compile-time platform identifiers alone.
  // This makes a single package usable under every selectable brand.
}
