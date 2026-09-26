import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { patchPoke } from "../features/poke/patch.js";
import { patchReactions } from "../features/reactions/patch.js";
import { targetById } from "../src/targets.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

// The unit suite pins every edit against synthetic anchors; this runs the same
// patch against what an upstream actually ships, because the include anchors
// and the reaction helper only exist there.
const reference = path.resolve("../work/references/AyuGramDesktop");
const configured = process.env.CROSSGRAM_DESKTOP_REACTIONS_SOURCE_ROOT;
const sourceRoot = configured
  ?? (existsSync(path.join(reference, "Telegram/SourceFiles/data/data_peer_values.cpp")) ? reference : undefined);

const relativePaths = [
  "Telegram/CMakeLists.txt",
  "Telegram/SourceFiles/mtproto/scheme/api.tl",
  "Telegram/SourceFiles/codegen/scheme/codegen_scheme.py",
  "Telegram/SourceFiles/data/data_peer_values.cpp",
  "Telegram/SourceFiles/window/window_session_controller.cpp",
  "Telegram/SourceFiles/window/window_peer_menu.cpp",
];

describe.skipIf(!sourceRoot)("real upstream reaction wiring", () => {
  it("patches the shipped sources idempotently", async () => {
    const temporaryRoot = path.resolve("../work/tests/reactions-e2e");
    await mkdir(temporaryRoot, { recursive: true });
    const fixture = await mkdtemp(path.join(temporaryRoot, "fixture-"));
    roots.push(fixture);
    const root = path.join(fixture, "ayugram");
    for (const relative of relativePaths) {
      await cp(path.join(sourceRoot!, relative), path.join(root, relative), { recursive: true });
    }
    const read = (relative: string) => readFile(path.join(root, relative), "utf8");
    const braceDelta = (source: string) =>
      (source.match(/{/g) ?? []).length - (source.match(/}/g) ?? []).length;
    const original = await Promise.all(relativePaths.map((relative) => read(relative)));

    const target = targetById("ayugram");
    await patchPoke({ root, target, featureRoot: path.resolve("features/poke") });
    await patchReactions({ root, target, featureRoot: path.resolve("features/reactions") });

    const patched = await Promise.all(relativePaths.map((relative) => read(relative)));
    const schema = patched[1] ?? "";
    const codegen = patched[2] ?? "";
    const peerValues = patched[3] ?? "";
    const controller = patched[4] ?? "";

    expect(patched[0]).toContain("crossgram/reactions.cpp");
    expect(patched[0]).toContain("crossgram/poke.cpp");
    expect(schema.match(/crossgram\.getFeatures#c3e6b915/g) ?? []).toHaveLength(1);
    expect(codegen).toContain("'crossgram.getFeatures#c3e6b915',");
    expect(peerValues).toContain('#include "crossgram/reactions.h"');
    expect(peerValues).toContain("Crossgram::Reactions::Disabled(peer)");
    expect(controller).toContain('#include "crossgram/reactions.h"');
    expect(controller.match(/Crossgram::Reactions::Warm\(&peer->session\(\), peer\);/g) ?? [])
      .toHaveLength(1);

    for (const [index, relative] of relativePaths.entries()) {
      if (!relative.endsWith(".cpp")) continue;
      expect(braceDelta(patched[index] ?? ""), relative).toBe(braceDelta(original[index] ?? ""));
    }

    const before = [...patched];
    await patchReactions({ root, target, featureRoot: path.resolve("features/reactions") });
    await patchPoke({ root, target, featureRoot: path.resolve("features/poke") });
    expect(await Promise.all(relativePaths.map((relative) => read(relative)))).toEqual(before);
  });
});
