import { cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { patchPoke } from "../features/poke/patch.js";
import { targets } from "../src/targets.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

// One release of every supported upstream, one directory per target id, holding
// the files this patch reads and writes:
//
//   Telegram/CMakeLists.txt
//   Telegram/SourceFiles/mtproto/scheme/api.tl
//   Telegram/SourceFiles/codegen/scheme/codegen_scheme.py
//   Telegram/SourceFiles/window/window_peer_menu.cpp
//   Telegram/SourceFiles/window/window_session_controller.cpp
//
// The unit suite pins every edit against synthetic anchors; this runs the same
// patch against what the upstreams actually ship, because the menu helpers and
// the avatar menu builder only exist there.
const sourceRoot = process.env.CROSSGRAM_DESKTOP_POKE_SOURCE_ROOT;
const relativePaths = [
  "Telegram/CMakeLists.txt",
  "Telegram/SourceFiles/mtproto/scheme/api.tl",
  "Telegram/SourceFiles/codegen/scheme/codegen_scheme.py",
  "Telegram/SourceFiles/window/window_peer_menu.cpp",
  "Telegram/SourceFiles/window/window_session_controller.cpp",
];

describe.skipIf(!sourceRoot)("real upstream poke menus", () => {
  it.each(targets)("patches $id release sources idempotently", async (target) => {
    const temporaryRoot = path.resolve("../work/tests/poke-e2e");
    await mkdir(temporaryRoot, { recursive: true });
    const fixture = await mkdtemp(path.join(temporaryRoot, "fixture-"));
    roots.push(fixture);
    const root = path.join(fixture, target.id);
    for (const relative of relativePaths) {
      await cp(path.join(sourceRoot!, target.id, relative), path.join(root, relative), {
        recursive: true,
      });
    }
    const read = (relative: string) => readFile(path.join(root, relative), "utf8");
    const braceDelta = (source: string) =>
      (source.match(/{/g) ?? []).length - (source.match(/}/g) ?? []).length;
    const original = await Promise.all(relativePaths.map((relative) => read(relative)));

    await patchPoke({
      root,
      target,
      featureRoot: path.resolve("features/poke"),
    });

    const patched = await Promise.all(relativePaths.map((relative) => read(relative)));
    const schema = patched[1];
    const codegen = patched[2];
    const menu = patched[3];
    const controller = patched[4];

    expect(schema).toContain("crossgram.getFeatures#c3e6b915 peer:InputPeer = DataJSON;");
    expect(schema).toContain("crossgram.sendPoke#9a2d47f0 peer:InputPeer user_id:InputUser count:int = Bool;");
    expect(schema).not.toContain("crossgram.getFeatures#c3e6b915 flags:");
    expect(codegen).toContain("'crossgram.sendPoke#9a2d47f0',");
    expect(patched[0]).toContain("crossgram/poke.cpp");
    expect(menu).toContain('#include "crossgram/poke.h"');
    expect(menu.match(/Crossgram::Poke::AddMenuAction\(/g) ?? []).toHaveLength(3);
    expect(menu.match(/Crossgram::Poke::AddMenuAction\(_controller, _peer, _peer, _addAction\);/g) ?? [])
      .toHaveLength(2);
    expect(menu).toContain("groupPeer ? groupPeer : peer.get()");
    expect(menu).toContain("Crossgram::Poke::AddMenuAction(_controller, _peer, _peer, _addAction);");
    expect(controller.match(/Crossgram::Poke::Warm\(&peer->session\(\), peer\);/g) ?? []).toHaveLength(1);
    // The poke helper itself must be installed next to the patched callers.
    const helper = await readFile(
      path.join(root, "Telegram/SourceFiles/crossgram/poke.cpp"),
      "utf8",
    );
    expect(helper).toContain("MTPcrossgram_GetFeatures(");
    expect(helper).toContain("MTPcrossgram_SendPoke(");
    expect(helper).toContain("u\"戳一戳\"_q");

    for (const [index, relative] of relativePaths.entries()) {
      if (!relative.endsWith(".cpp")) continue;
      expect(braceDelta(patched[index]), relative).toBe(braceDelta(original[index]));
    }

    const before = [...patched];
    await patchPoke({ root, target, featureRoot: path.resolve("features/poke") });
    expect(await Promise.all(relativePaths.map((relative) => read(relative)))).toEqual(before);
  });
});
