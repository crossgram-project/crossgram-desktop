import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

async function fixture(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "crossgram-desktop-reactions-"));
  roots.push(root);
  const files: Record<string, string> = {
    "Telegram/CMakeLists.txt": "set(SOURCES\n    mainwidget.cpp\n    main.cpp\n)\n",
    "Telegram/SourceFiles/mtproto/scheme/api.tl":
      "---functions---\nupload.getFile#be5335be flags:# precise:flags.0?true cdn_supported:flags.1?true location:InputFileLocation offset:long limit:int = upload.File;\n",
    "Telegram/SourceFiles/codegen/scheme/codegen_scheme.py":
      "builtin = [\n    'messageReplies#81834865',\n]\n",
    "Telegram/SourceFiles/data/data_peer_values.cpp": [
      "/*",
      "This file is part of Telegram Desktop.",
      "*/",
      '#include "data/data_peer_values.h"',
      "",
      '#include "data/data_chat.h"',
      '#include "data/data_channel.h"',
      '#include "data/data_peer.h"',
      '#include "base/unixtime.h"',
      "",
      "namespace Data {",
      "",
      "const AllowedReactions &PeerAllowedReactions(not_null<PeerData*> peer) {",
      "\tif (const auto chat = peer->asChat()) {",
      "\t\treturn chat->allowedReactions();",
      "\t} else if (const auto channel = peer->asChannel()) {",
      "\t\treturn channel->allowedReactions();",
      "\t} else {",
      "\t\tstatic const auto result = AllowedReactions{",
      "\t\t\t.type = AllowedReactionsType::All,",
      "\t\t};",
      "\t\treturn result;",
      "\t}",
      "}",
      "",
      "} // namespace Data",
      "",
    ].join("\n"),
    "Telegram/SourceFiles/window/window_peer_menu.cpp": [
      '#include "window/window_peer_menu.h"',
      '#include "apiwrap.h"',
      "",
      "void FillSenderUserpicMenu(",
      "\t\tnot_null<SessionController*> controller,",
      "\t\tnot_null<PeerData*> peer,",
      "\t\tPeerData *groupPeer,",
      "\t\tUi::InputField *fieldForMention,",
      "\t\tDialogs::Key searchInEntry,",
      "\t\tconst PeerMenuCallback &addAction) {",
      "\tif (searchInEntry) {",
      "\t\taddAction(tr::lng_context_search_from(tr::now), [=] {",
      "\t\t\tcontroller->searchInChat(searchInEntry, peer);",
      "\t\t}, &st::menuIconSearch);",
      "\t}",
      "}",
      "",
      "void Filler::fillHistoryActions() {",
      "\taddToggleMuteSubmenu(true);",
      "\taddInfo();",
      "}",
      "",
      "void Filler::fillProfileActions() {",
      "\taddTTLSubmenu(true);",
      "\taddSupportInfo();",
      "}",
      "",
    ].join("\n"),
    "Telegram/SourceFiles/window/window_session_controller.cpp": [
      '#include "window/window_session_controller.h"',
      '#include "apiwrap.h"',
      "",
      "void SessionNavigation::showPeerHistory(",
      "\t\tnot_null<PeerData*> peer,",
      "\t\tconst SectionShow &params,",
      "\t\tMsgId msgId) {",
      "\tshowPeerHistory(peer->id, params, msgId);",
      "}",
      "",
    ].join("\n"),
  };
  await Promise.all(Object.entries(files).map(async ([relative, content]) => {
    const file = path.join(root, relative);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, content, "utf8");
  }));
  return root;
}

const snapshotPaths = [
  "Telegram/CMakeLists.txt",
  "Telegram/SourceFiles/mtproto/scheme/api.tl",
  "Telegram/SourceFiles/codegen/scheme/codegen_scheme.py",
  "Telegram/SourceFiles/data/data_peer_values.cpp",
  "Telegram/SourceFiles/window/window_session_controller.cpp",
];

async function snapshot(root: string): Promise<Record<string, string>> {
  const entries = await Promise.all(snapshotPaths.map(async (relative) =>
    [relative, await readFile(path.join(root, relative), "utf8")] as const));
  return Object.fromEntries(entries);
}

describe("reaction support desktop patch", () => {
  it("installs the feature, folds the answer into allowed reactions, and is idempotent", async () => {
    const root = await fixture();
    const options = {
      root,
      target: targetById("ayugram"),
      featureRoot: path.resolve("features/reactions"),
    };
    await patchReactions(options);
    const first = await snapshot(root);

    expect(first["Telegram/CMakeLists.txt"]).toContain("crossgram/reactions.cpp");
    expect(first["Telegram/CMakeLists.txt"]).toContain("crossgram/reactions.h");
    expect(first["Telegram/SourceFiles/mtproto/scheme/api.tl"]).toContain(
      "crossgram.getFeatures#c3e6b915 peer:InputPeer = DataJSON;",
    );
    expect(first["Telegram/SourceFiles/codegen/scheme/codegen_scheme.py"]).toContain(
      "    'crossgram.getFeatures#c3e6b915',",
    );

    const peerValues = first["Telegram/SourceFiles/data/data_peer_values.cpp"] ?? "";
    expect(peerValues).toContain('#include "crossgram/reactions.h"');
    // An explicit refusal becomes an empty "some" list, which every reaction
    // entry point already renders as "no reactions available".
    expect(peerValues).toContain(
      "\tif (Crossgram::Reactions::Disabled(peer)) {\n"
      + "\t\tstatic const auto result = AllowedReactions{\n"
      + "\t\t\t.type = AllowedReactionsType::Some,\n",
    );
    // The unpatched branch stays intact for every other peer.
    expect(peerValues).toContain("\tif (const auto chat = peer->asChat()) {");

    const controller = first["Telegram/SourceFiles/window/window_session_controller.cpp"] ?? "";
    expect(controller).toContain('#include "crossgram/reactions.h"');
    expect(controller).toContain("\tCrossgram::Reactions::Warm(&peer->session(), peer);");

    const helper = await readFile(path.join(root, "Telegram/SourceFiles/crossgram/reactions.cpp"), "utf8");
    expect(helper).toContain("MTPcrossgram_GetFeatures(");
    expect(helper).toContain("Data::PeerUpdate::Flag::Reactions");
    expect(helper).toContain('u"reactions"_q');
    expect(helper).toContain('u"supported"_q');

    await patchReactions(options);
    expect(await snapshot(root)).toEqual(first);
  });

  it("coexists with the poke patch that shares the feature query", async () => {
    const root = await fixture();
    const target = targetById("ayugram");
    await patchPoke({ root, target, featureRoot: path.resolve("features/poke") });
    await patchReactions({ root, target, featureRoot: path.resolve("features/reactions") });
    const first = await snapshot(root);

    const schema = first["Telegram/SourceFiles/mtproto/scheme/api.tl"] ?? "";
    expect(schema.match(/crossgram\.getFeatures#c3e6b915/g) ?? []).toHaveLength(1);
    expect(schema).toContain("crossgram.sendPoke#9a2d47f0");
    expect(first["Telegram/CMakeLists.txt"]).toContain("crossgram/poke.cpp");
    expect(first["Telegram/CMakeLists.txt"]).toContain("crossgram/reactions.cpp");

    const controller = first["Telegram/SourceFiles/window/window_session_controller.cpp"] ?? "";
    expect(controller).toContain('#include "crossgram/poke.h"');
    expect(controller).toContain('#include "crossgram/reactions.h"');
    expect(controller.match(/Crossgram::Poke::Warm\(&peer->session\(\), peer\);/g) ?? []).toHaveLength(1);
    expect(controller.match(/Crossgram::Reactions::Warm\(&peer->session\(\), peer\);/g) ?? [])
      .toHaveLength(1);

    await patchReactions({ root, target, featureRoot: path.resolve("features/reactions") });
    await patchPoke({ root, target, featureRoot: path.resolve("features/poke") });
    expect(await snapshot(root)).toEqual(first);
  });

  it.each(["tdesktop", "materialgram"])("patches %s target", async (targetId) => {
    const root = await fixture();
    await patchReactions({
      root,
      target: targetById(targetId),
      featureRoot: path.resolve("features/reactions"),
    });
    const sources = await snapshot(root);
    expect(sources["Telegram/SourceFiles/mtproto/scheme/api.tl"]).toContain("crossgram.getFeatures#c3e6b915");
    expect(sources["Telegram/SourceFiles/data/data_peer_values.cpp"]).toContain("Crossgram::Reactions::Disabled");
    expect(sources["Telegram/SourceFiles/window/window_session_controller.cpp"]).toContain("Crossgram::Reactions::Warm");
  });
});
