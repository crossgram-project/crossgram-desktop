import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { patchWinUnicodeInput } from "../features/win-unicode-input/patch.js";
import { targetById } from "../src/targets.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

// The harness links a real Qt against the sources the patch installs, so it
// only runs where both are available. Point CROSSGRAM_QT_ROOT at a Qt 6
// installation to enable it, for example:
//   CROSSGRAM_QT_ROOT=/c/Qt/6.9.3/msvc2022_64 yarn test tests/win-unicode-input.e2e.test.ts
const qtRoot = process.env.CROSSGRAM_QT_ROOT ?? process.env.QT_ROOT;
const cmakeExecutable = process.env.CMAKE ?? "cmake";
const compiler = process.env.CXX ?? "clang++";
const harnessRoot = path.resolve("tests/native/win-unicode-input");

const cmakeSource = [
  "    core/version.h",
  "    countries/countries_manager.cpp",
  "    countries/countries_manager.h",
  "    data/business/data_business_chatbots.cpp",
  "",
].join("\n");

const applicationSource = [
  '#include "core/application.h"',
  "",
  "void Application::run() {",
  "\tQCoreApplication::instance()->installEventFilter(this);",
  "}",
  "",
].join("\n");

interface HarnessResult {
  readonly mode: string;
  readonly results: readonly string[];
}

function parseHarnessOutput(stdout: string): HarnessResult {
  const mode = /^MODE=(\S+)$/m.exec(stdout)?.[1];
  const results = Array.from(stdout.matchAll(/^RESULT(\d)=(.*)$/gm))
    .sort((left, right) => Number(left[1]) - Number(right[1]))
    .map((match) => match[2] ?? "");
  if (!mode || !stdout.includes("DONE")) {
    throw new Error(`Harness did not finish: ${stdout}`);
  }
  return { mode, results };
}

async function patchedSourceRoot(): Promise<string> {
  const workRoot = path.resolve("../work/tests/win-unicode-input-e2e");
  await mkdir(workRoot, { recursive: true });
  const root = await mkdtemp(path.join(workRoot, "fixture-"));
  roots.push(root);
  await mkdir(path.join(root, "Telegram/SourceFiles/core"), { recursive: true });
  await writeFile(path.join(root, "Telegram/CMakeLists.txt"), cmakeSource, "utf8");
  await writeFile(
    path.join(root, "Telegram/SourceFiles/core/application.cpp"),
    applicationSource,
    "utf8",
  );
  await patchWinUnicodeInput({
    root,
    target: targetById("tdesktop"),
    featureRoot: path.resolve("features/win-unicode-input"),
  });
  return path.join(root, "Telegram/SourceFiles");
}

describe.skipIf(process.platform !== "win32" || !qtRoot)(
  "Windows injected Unicode input end to end",
  () => {
    it("reproduces the captured duplication and keeps the characters with the patch", async () => {
      const sourceRoot = await patchedSourceRoot();
      const workRoot = path.resolve("../work/tests/win-unicode-input-e2e");
      const buildRoot = await mkdtemp(path.join(workRoot, "build-"));
      roots.push(buildRoot);

      const run = promisify(execFile);
      await run(cmakeExecutable, [
        "-S", harnessRoot,
        "-B", buildRoot,
        "-G", "Ninja",
        `-DCMAKE_PREFIX_PATH=${qtRoot}`,
        `-DCMAKE_CXX_COMPILER=${compiler}`,
        `-DCROSSGRAM_SOURCE_ROOT=${sourceRoot}`,
      ], { timeout: 300_000 });
      await run(cmakeExecutable, ["--build", buildRoot], { timeout: 300_000 });

      const binary = path.join(buildRoot, "crossgram_win_unicode_input_harness.exe");
      const environment = {
        ...process.env,
        PATH: `${path.join(qtRoot!, "bin")}${path.delimiter}${process.env.PATH ?? ""}`,
      };
      const control = parseHarnessOutput(
        (await run(binary, ["--control"], { env: environment, timeout: 60_000 })).stdout,
      );
      const patched = parseHarnessOutput(
        (await run(binary, [], { env: environment, timeout: 60_000 })).stdout,
      );

      expect(control.mode).toBe("control");
      expect(patched.mode).toBe("patched");
      // Upstream: the packet without a key release replays ，and drops 这.
      expect(control.results).toEqual(["，，", "😀", "ab"]);
      // Patched: every character of the captured stream survives in order.
      expect(patched.results).toEqual(["，这", "😀", "ab"]);
    }, 300_000);
  },
);

