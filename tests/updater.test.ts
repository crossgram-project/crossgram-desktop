import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  CONFIG_ROOT,
  CMAKE_ROOT,
  LOCALSTORAGE_ROOT,
  PACKER_ROOT,
  VERSION_ROOT,
  crossgramVersion,
  cppKeyLiteral,
  packerKeyHeaderRelative,
  packerKeyPatches,
  packerTargetPatch,
  patchUpdater,
  prefixFunction,
  updateKeyPatches,
  updatePrefix,
  versionPatch,
} from "../features/updater/patch.js";
import { targetById } from "../src/targets.js";

const configHeader = [
  'static const char *UpdatesPublicKey = "\\',
  "-----BEGIN RSA PUBLIC KEY-----\\n\\",
  "AAAA\\n\\",
  '-----END RSA PUBLIC KEY-----\\',
  '";',
  "",
  'static const char *UpdatesPublicBetaKey = "\\',
  "-----BEGIN RSA PUBLIC KEY-----\\n\\",
  "BBBB\\n\\",
  '-----END RSA PUBLIC KEY-----\\',
  '";',
  "",
].join("\n");

const packerSource = [
  'const char *PublicKey = "\\',
  "-----BEGIN RSA PUBLIC KEY-----\\n\\",
  "AAAA\\n\\",
  '-----END RSA PUBLIC KEY-----\\',
  '";',
  "",
  'const char *PublicBetaKey = "\\',
  "-----BEGIN RSA PUBLIC KEY-----\\n\\",
  "BBBB\\n\\",
  '-----END RSA PUBLIC KEY-----\\',
  '";',
  "",
  "extern const char *PrivateKey;",
  "extern const char *PrivateBetaKey;",
  '#include "../../../../DesktopPrivate/packer_private.h" // RSA PRIVATE KEYS for update signing',
  '#include "../../../../DesktopPrivate/alpha_private.h" // private key for alpha version file generation',
  "",
].join("\n");

const localstorage = [
  "const QString &readAutoupdatePrefixRaw() {",
  "\tExpects(!Core::UpdaterDisabled());",
  "",
  "\tconst auto &result = AutoupdatePrefix();",
  "\tif (!result.isEmpty()) {",
  "\t\treturn result;",
  "\t}",
  '\treturn AutoupdatePrefix("https://update.ayugram.one/");',
  "}",
  "",
  "void writeAutoupdatePrefix(const QString &prefix) {",
  "}",
  "",
].join("\n");

const cmakeLists = [
  "if (NOT DESKTOP_APP_DISABLE_AUTOUPDATE AND NOT build_macstore AND NOT build_winstore)",
  "    add_executable(Updater WIN32)",
  "",
  "    if (DESKTOP_APP_SPECIAL_TARGET)",
  "        add_executable(Packer)",
  "        init_target(Packer)",
  "    endif()",
  "endif()",
  "",
].join("\n");

const versionHeader = [
  "constexpr auto AppVersion = 7000009;",
  'constexpr auto AppVersionStr = "7.0.9";',
  "",
].join("\n");

const key = cppKeyLiteral(
  "-----BEGIN RSA PUBLIC KEY-----\nMIGJ\n-----END RSA PUBLIC KEY-----\n",
);

describe("desktop updater patch", () => {
  it("numbers Crossgram builds above every upstream AppVersion", () => {
    expect(crossgramVersion(242)).toBe(100_000_242);
    expect(() => crossgramVersion(0)).toThrow();
    expect(() => crossgramVersion(999_999_999)).toThrow();
  });

  it("renders keys as the upstream C++ string literals", () => {
    const literal = cppKeyLiteral("-----BEGIN RSA PUBLIC KEY-----\nAAAA\n-----END RSA PUBLIC KEY-----\n");
    expect(literal).toBe(
      "\\\n-----BEGIN RSA PUBLIC KEY-----\\n\\\nAAAA\\n\\\n-----END RSA PUBLIC KEY-----\\n\\\n",
    );
  });

  it("replaces the version header and the client update keys", () => {
    const version = versionPatch(versionHeader, 100_000_242);
    expect(versionHeader.replace(version.search, version.replacement)).toContain(
      "constexpr auto AppVersion = 100000242;",
    );
    expect(versionHeader.replace(version.search, version.replacement)).toContain('AppVersionStr = "7.0.9"');
    const patches = updateKeyPatches(configHeader, key);
    expect(patches).toHaveLength(2);
    const patched = patches.reduce((source, patch) => source.replace(patch.search, patch.replacement), configHeader);
    expect(patched.match(/MIGJ/g)).toHaveLength(2);
    expect(patched).not.toContain("AAAA");
    expect(patched).not.toContain("UpdatesPublicKey = \"\\\\\n-----BEGIN RSA PUBLIC KEY-----\\\\n\\\\\nAAAA");
  });

  it("replaces both packer keys and finds the private key include", () => {
    const patches = packerKeyPatches(packerSource, key);
    expect(patches).toHaveLength(2);
    const patched = patches.reduce((source, patch) => source.replace(patch.search, patch.replacement), packerSource);
    expect(patched.match(/MIGJ/g)).toHaveLength(2);
    expect(packerKeyHeaderRelative(packerSource)).toBe("../../../../DesktopPrivate/packer_private.h");
    expect(packerKeyHeaderRelative('#include "packer_private.h"')).toBe("packer_private.h");
    expect(packerKeyHeaderRelative("int main() {}")).toBeNull();
  });

  it("builds the upstream packer in every build", () => {
    const patch = packerTargetPatch(cmakeLists);
    const patched = cmakeLists.replace(patch.search, patch.replacement);
    expect(patched).toContain("if (DESKTOP_APP_SPECIAL_TARGET OR CROSSGRAM_BUILD_UPDATE_PACKER)\n        add_executable(Packer)");
    expect(() => packerTargetPatch("add_executable(Packer)")).toThrow();
  });

  it("points the updater at the Crossgram feed of its own brand", () => {
    expect(updatePrefix("ayugram", "runtime", "windows")).toBe(
      "https://raw.githubusercontent.com/crossgram-project/crossgram-desktop/updates/ayugram-runtime/windows",
    );
    const replacement = prefixFunction(updatePrefix("tdesktop-x64", "qq", "linux"));
    expect(replacement).toContain('return AutoupdatePrefix("https://raw.githubusercontent.com/crossgram-project/crossgram-desktop/updates/tdesktop-x64-qq/linux");');
    expect(replacement).toContain("Expects(!Core::UpdaterDisabled());");
  });
});

async function applyToTree(options: {
  platform: "windows" | "linux" | null;
  build: number | null;
  privateKey: string | null;
  brand?: string;
  target?: "ayugram" | "tdesktop";
}): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "crossgram-updater-"));
  const write = async (relative: string, contents: string) => {
    await mkdir(join(root, relative, ".."), { recursive: true });
    await writeFile(join(root, relative), contents, "utf8");
  };
  await write(VERSION_ROOT, versionHeader);
  await write(CONFIG_ROOT, configHeader);
  await write(PACKER_ROOT, packerSource);
  await write(LOCALSTORAGE_ROOT, localstorage);
  await write(CMAKE_ROOT, cmakeLists);
  await patchUpdater({
    root,
    target: targetById(options.target ?? "ayugram"),
    brand: options.brand ?? "runtime",
    platform: options.platform,
    build: options.build,
    featureRoot: join(process.cwd(), "features/updater"),
    privateKey: options.privateKey,
  });
  return root;
}

describe("desktop updater e2e", () => {
  const trees: string[] = [];

  afterEach(async () => {
    while (trees.length) {
      const tree = trees.pop();
      if (tree) await rm(tree, { recursive: true, force: true });
    }
  });

  it("patches a tree, stays inert without a build number, and is idempotent", async () => {
    const inert = await applyToTree({ platform: null, build: null, privateKey: null });
    trees.push(inert);
    expect(await readFile(join(inert, VERSION_ROOT), "utf8")).toBe(versionHeader);
    expect(await readFile(join(inert, LOCALSTORAGE_ROOT), "utf8")).toBe(localstorage);
    expect(await readFile(join(inert, CMAKE_ROOT), "utf8")).toContain("CROSSGRAM_BUILD_UPDATE_PACKER");

    const root = await applyToTree({
      platform: "windows",
      build: 242,
      privateKey: "-----BEGIN RSA PRIVATE KEY-----\nPRIVATE\n-----END RSA PRIVATE KEY-----\n",
    });
    trees.push(root);
    const version = await readFile(join(root, VERSION_ROOT), "utf8");
    expect(version).toContain("constexpr auto AppVersion = 100000242;");
    const storage = await readFile(join(root, LOCALSTORAGE_ROOT), "utf8");
    expect(storage).toContain("ayugram-runtime/windows");
    expect(storage).not.toContain("update.ayugram.one");
    expect(storage).toContain("void writeAutoupdatePrefix(const QString &prefix) {");
    const keys = await readFile(join(root, CONFIG_ROOT), "utf8");
    expect(keys.match(/MIGJ/g)).toHaveLength(2);
    const header = await readFile(join(root, "Telegram/SourceFiles/_other/../../../../DesktopPrivate/packer_private.h"), "utf8");
    expect(header).toContain("PrivateKey");
    expect(header).toContain("PRIVATE");
    const alpha = await readFile(join(root, "Telegram/SourceFiles/_other/../../../../DesktopPrivate/alpha_private.h"), "utf8");
    expect(alpha).toContain("AlphaPrivateKey");

    const before = await Promise.all(
      [VERSION_ROOT, CONFIG_ROOT, LOCALSTORAGE_ROOT, PACKER_ROOT, CMAKE_ROOT].map((relative) =>
        readFile(join(root, relative), "utf8"),
      ),
    );
    await patchUpdater({
      root,
      target: targetById("ayugram"),
      brand: "runtime",
      platform: "windows",
      build: 242,
      featureRoot: join(process.cwd(), "features/updater"),
      privateKey: "-----BEGIN RSA PRIVATE KEY-----\nPRIVATE\n-----END RSA PRIVATE KEY-----\n",
    });
    const after = await Promise.all(
      [VERSION_ROOT, CONFIG_ROOT, LOCALSTORAGE_ROOT, PACKER_ROOT, CMAKE_ROOT].map((relative) =>
        readFile(join(root, relative), "utf8"),
      ),
    );
    expect(after).toEqual(before);
  });

  it("moves a rerun of a different brand onto the new feed", async () => {
    const root = await applyToTree({ platform: "linux", build: 7, privateKey: null, brand: "qq" });
    trees.push(root);
    await patchUpdater({
      root,
      target: targetById("ayugram"),
      brand: "discord",
      platform: "linux",
      build: 7,
      featureRoot: join(process.cwd(), "features/updater"),
      privateKey: null,
    });
    const storage = await readFile(join(root, LOCALSTORAGE_ROOT), "utf8");
    expect(storage).toContain("ayugram-discord/linux");
    expect(storage).not.toContain("ayugram-qq/linux");
  });
});
