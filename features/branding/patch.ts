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
  readonly brand: ResolvedBrand;
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

async function replaceApplicationIcons(options: PatchOptions): Promise<void> {
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

  await replaceApplicationIcons(options);
}
