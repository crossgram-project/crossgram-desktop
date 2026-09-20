import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { patchBranding } from "../features/branding/patch.js";
import { targets } from "../src/targets.js";
import { brandById, resolveBrand } from "../src/brands.js";

const run = promisify(execFile);
const repository = process.cwd();
describe("runtime branding CLI", () => {
  it.each(targets)("defaults $id metadata to the stable universal identity", async target => {
    const invoke = async (extra: string[]) => {
      const { stdout } = await run(process.execPath, [resolve("node_modules/tsx/dist/cli.mjs"), "src/cli.ts", "metadata", "--target", target.id, ...extra], { cwd: repository });
      return JSON.parse(stdout);
    };
    const metadata = await invoke([]);
    expect(metadata).toEqual(await invoke(["--brand", "runtime"]));
    const identity = resolveBrand(target, brandById("cross"));
    expect(metadata).toMatchObject({ brand: "runtime", executable: identity.executable, windowsAppId: identity.windowsAppId, linuxId: identity.linuxId });
  });
});

// Point this at clean release source snapshots, with one directory per target.
// The CI check workflow also applies the full CLI twice to every real upstream.
const sourceRoot = process.env.CROSSGRAM_BRANDING_SOURCE_ROOT;
describe.skipIf(!sourceRoot)("real upstream runtime branding", () => {
  it.each(targets)("patches $id release sources idempotently", async target => {
    const root = join(sourceRoot!, target.id);
    const options = { root, target, brand: null, featureRoot: resolve("features/branding") };
    await patchBranding(options);
    const paths = ["Telegram/CMakeLists.txt", "Telegram/SourceFiles/core/version.h", "Telegram/SourceFiles/core/application.cpp", "Telegram/SourceFiles/window/window_main_menu.cpp", "Telegram/SourceFiles/window/main_window.cpp", "Telegram/SourceFiles/crossgram/branding_runtime.cpp"];
    const snapshot = () => Promise.all(paths.map(path => readFile(join(root, path), "utf8")));
    const once = await snapshot();
    expect(once[0]).toContain('set(output_name "' + target.crossName + '")');
    expect(once[4]).toContain("Crossgram::Branding::CurrentTitle()");
    await patchBranding(options);
    expect(await snapshot()).toEqual(once);
  });
});
