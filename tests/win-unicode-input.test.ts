import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { patchWinUnicodeInput } from "../features/win-unicode-input/patch.js";
import { targets, targetById } from "../src/targets.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

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
  "",
  "\tstartDomain();",
  "}",
  "",
].join("\n");

type FixtureAnchors = "all" | "without-cmake" | "without-application";

async function fixture(anchors: FixtureAnchors = "all"): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "crossgram-desktop-win-unicode-input-"));
  roots.push(root);
  const files: Record<string, string> = {
    "Telegram/CMakeLists.txt": anchors === "without-cmake"
      ? "    data/business/data_business_chatbots.cpp\n"
      : cmakeSource,
    "Telegram/SourceFiles/core/application.cpp": anchors === "without-application"
      ? "void Application::run() {\n}\n"
      : applicationSource,
  };
  await Promise.all(Object.entries(files).map(async ([relative, content]) => {
    const file = path.join(root, relative);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, content, "utf8");
  }));
  return root;
}

function options(root: string, target = "tdesktop") {
  return {
    root,
    target: targetById(target),
    featureRoot: path.resolve("features/win-unicode-input"),
  };
}

async function patchedSources(root: string): Promise<Record<string, string>> {
  const base = path.join(root, "Telegram/SourceFiles/crossgram");
  const [header, core, source] = await Promise.all([
    readFile(path.join(base, "win_unicode_input.h"), "utf8"),
    readFile(path.join(base, "win_unicode_input_core.h"), "utf8"),
    readFile(path.join(base, "win_unicode_input.cpp"), "utf8"),
  ]);
  return { header, core, source };
}

describe("Windows injected-Unicode input patch", () => {
  it.each(targets)("wires the filter into $id and is idempotent", async (target) => {
    const root = await fixture();
    const run = options(root, target.id);
    await patchWinUnicodeInput(run);
    const cmake = await readFile(path.join(root, "Telegram/CMakeLists.txt"), "utf8");
    const application = await readFile(
      path.join(root, "Telegram/SourceFiles/core/application.cpp"),
      "utf8",
    );
    const sources = await patchedSources(root);

    expect(cmake).toContain("crossgram/win_unicode_input.cpp");
    expect(cmake).toContain("crossgram/win_unicode_input.h");
    expect(cmake).toContain("crossgram/win_unicode_input_core.h");
    expect(cmake.indexOf("crossgram/win_unicode_input.cpp"))
      .toBeGreaterThan(cmake.indexOf("countries/countries_manager.h"));
    expect(application).toContain('#include "crossgram/win_unicode_input.h"');
    expect(application).toContain("\tCrossgram::WinUnicodeInput::Start();");
    expect(application.indexOf("Crossgram::WinUnicodeInput::Start();"))
      .toBeGreaterThan(application.indexOf("installEventFilter(this);"));
    expect(sources.header).toContain("void Start();");
    expect(sources.core).toContain("PacketKeyDown");
    expect(sources.core).toContain("commitSurrogatePair");
    expect(sources.source).toContain("VK_PACKET");
    expect(sources.source).toContain("installNativeEventFilter");
    // Non-Windows builds must still compile the shared source list entry.
    expect(sources.source).toContain("#if defined(_WIN32)");
    expect(sources.source).toContain("#else // _WIN32");

    const before = [cmake, application, ...Object.values(sources)].join("\0");
    await patchWinUnicodeInput(run);
    const after = [
      await readFile(path.join(root, "Telegram/CMakeLists.txt"), "utf8"),
      await readFile(path.join(root, "Telegram/SourceFiles/core/application.cpp"), "utf8"),
      ...Object.values(await patchedSources(root)),
    ].join("\0");
    expect(after).toBe(before);
  });

  it("keeps CRLF line endings of the upstream sources", async () => {
    const root = await fixture();
    const applicationPath = path.join(root, "Telegram/SourceFiles/core/application.cpp");
    await writeFile(applicationPath, applicationSource.replaceAll("\n", "\r\n"), "utf8");
    const cmakePath = path.join(root, "Telegram/CMakeLists.txt");
    await writeFile(cmakePath, cmakeSource.replaceAll("\n", "\r\n"), "utf8");
    await patchWinUnicodeInput(options(root));
    const application = await readFile(applicationPath, "utf8");
    const cmake = await readFile(cmakePath, "utf8");
    expect(application).toContain('core/application.h"\r\n#include "crossgram/win_unicode_input.h"');
    expect(application).toContain("installEventFilter(this);\r\n\tCrossgram::WinUnicodeInput::Start();");
    expect(cmake.includes("\r\n    crossgram/win_unicode_input.cpp")).toBe(true);
    expect(application.replaceAll("\r\n", "").includes("\n")).toBe(false);
  });

  it("fails instead of guessing when an anchor is missing", async () => {
    const withoutCmake = await fixture("without-cmake");
    await expect(patchWinUnicodeInput(options(withoutCmake)))
      .rejects.toThrow("countries/countries_manager.h");
    const withoutApplication = await fixture("without-application");
    await expect(patchWinUnicodeInput(options(withoutApplication)))
      .rejects.toThrow("core/application.h");
  });

  it("compiles and runs the installed state machine against the captured stream", async () => {
    const root = await fixture();
    await patchWinUnicodeInput(options(root));
    const sourceRoot = path.join(root, "Telegram/SourceFiles");
    const test = path.resolve("tests/fixtures/win-unicode-input/core_test.cpp");
    const binary = path.join(root, process.platform === "win32" ? "core-test.exe" : "core-test");
    const run = promisify(execFile);
    await run(
      process.env.CXX || "clang++",
      ["-std=c++20", "-O0", `-I${sourceRoot}`, test, "-o", binary],
      { timeout: 120_000 },
    );
    const result = await run(binary, [], { timeout: 60_000 });
    expect(result.stdout).toContain("win-unicode-input core checks passed");
  }, 180_000);
});
