import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { patchE2e } from "../features/e2e/patch.js";
import { targetById } from "../src/targets.js";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })));
});

async function fixture(eol = "\n"): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "crossgram-desktop-e2e-feature-"));
  temporaryDirectories.push(root);
  await mkdir(path.join(root, "Telegram/SourceFiles/core"), { recursive: true });
  await writeFile(
    path.join(root, "Telegram/CMakeLists.txt"),
    ["target_sources(Telegram PRIVATE", "    countries/countries_manager.h", ")", ""].join(eol),
    "utf8",
  );
  await writeFile(
    path.join(root, "Telegram/SourceFiles/core/application.cpp"),
    [
      '#include "core/application.h"',
      "",
      "void Application::run() {",
      "\tprocessCreatedWindow(_lastActivePrimaryWindow);",
      "}",
      "",
    ].join(eol),
    "utf8",
  );
  return root;
}

describe("desktop semantic E2E source feature", () => {
  it("installs and wires the endpoint idempotently", async () => {
    const root = await fixture();
    const options = {
      root,
      target: targetById("tdesktop"),
      featureRoot: path.join(repositoryRoot, "features/e2e"),
    };
    await patchE2e(options);
    const firstCmake = await readFile(path.join(root, "Telegram/CMakeLists.txt"), "utf8");
    const firstApplication = await readFile(
      path.join(root, "Telegram/SourceFiles/core/application.cpp"),
      "utf8",
    );
    const endpoint = await readFile(
      path.join(root, "Telegram/SourceFiles/crossgram/e2e.cpp"),
      "utf8",
    );

    expect(firstCmake).toContain("crossgram/e2e.cpp");
    expect(firstApplication).toContain('#include "crossgram/e2e.h"');
    expect(firstApplication).toContain("Crossgram::E2e::Start();");
    expect(endpoint).toContain("QAccessible::queryAccessibleInterface(qApp)");
    expect(endpoint).toContain("QHostAddress::LocalHost");
    expect(endpoint).toContain("token.size() < 32");
    expect(endpoint).toContain('u"<redacted>"_q');

    await patchE2e(options);
    expect(await readFile(path.join(root, "Telegram/CMakeLists.txt"), "utf8"))
      .toBe(firstCmake);
    expect(await readFile(path.join(root, "Telegram/SourceFiles/core/application.cpp"), "utf8"))
      .toBe(firstApplication);
  });

  it("preserves CRLF in modified upstream files", async () => {
    const root = await fixture("\r\n");
    await patchE2e({
      root,
      target: targetById("materialgram"),
      featureRoot: path.join(repositoryRoot, "features/e2e"),
    });
    const application = await readFile(
      path.join(root, "Telegram/SourceFiles/core/application.cpp"),
      "utf8",
    );
    expect(application.replaceAll("\r\n", "")).not.toContain("\n");
  });
});
