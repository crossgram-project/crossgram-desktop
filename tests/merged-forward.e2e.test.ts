import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { patchMergedForward } from "../features/merged-forward/patch.js";
import { targetById } from "../src/targets.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "crossgram-desktop-merged-forward-"));
  roots.push(root);
  const source = path.join(root, "Telegram", "SourceFiles");
  await Promise.all([
    mkdir(path.join(source, "window"), { recursive: true }),
    mkdir(path.join(source, "data"), { recursive: true }),
  ]);
  await writeFile(path.join(root, "Telegram", "CMakeLists.txt"), `set(SOURCES
    mainwidget.cpp
)
`, "utf8");
  await writeFile(path.join(source, "window", "window_session_controller.cpp"), `#include "window/window_session_controller.h"

void SessionNavigation::showPeerByLink(const PeerByLinkInfo &info) {
	Core::App().hideMediaView();
	if (!info.phone.isEmpty()) {
		resolvePhone(info.phone, [=](not_null<PeerData*> peer) {
			showPeerByLinkResolved(peer, info);
		});
	} else if (const auto name = std::get_if<QString>(&info.usernameOrId)) {
		resolveUsername(*name, [=](not_null<PeerData*> peer) {
			showPeerByLinkResolved(peer, info);
		}, info.referral);
	}
}
`, "utf8");
  await writeFile(path.join(source, "data", "data_histories.cpp"), `#include "data/data_histories.h"

void Histories::requestDialogEntry(
		not_null<History*> history,
		Fn<void()> callback) {
	if (const auto channel = history->peer->asChannel()) {
		return;
	}
}
`, "utf8");
  await writeFile(path.join(source, "data", "data_session.cpp"), `#include "data/data_session.h"

void Session::refreshChatListEntry(Dialogs::Key key) {
	using namespace Dialogs;
	const auto entry = key.entry();
	const auto history = entry->asHistory();
	const auto topic = entry->asTopic();
	const auto mainList = chatsListFor(entry);
	const auto creating = !entry->inChatList();
}
`, "utf8");
  return root;
}

async function patched() {
  const root = await fixture();
  const options = {
    root,
    target: targetById("ayugram"),
    featureRoot: path.resolve("features/merged-forward"),
  };
  await patchMergedForward(options);
  await patchMergedForward(options);
  const read = (relative: string) => readFile(path.join(root, relative), "utf8");
  return {
    cmake: await read("Telegram/CMakeLists.txt"),
    helper: await read("Telegram/SourceFiles/crossgram/merged_forward.cpp"),
    header: await read("Telegram/SourceFiles/crossgram/merged_forward.h"),
    controller: await read("Telegram/SourceFiles/window/window_session_controller.cpp"),
    histories: await read("Telegram/SourceFiles/data/data_histories.cpp"),
    session: await read("Telegram/SourceFiles/data/data_session.cpp"),
  };
}

describe("Desktop merged-forward patch e2e", () => {
  it("installs one shared synthetic-peer registry", async () => {
    const { cmake, helper, header } = await patched();
    expect(cmake.match(/crossgram\/merged_forward\.cpp/g)).toHaveLength(1);
    expect(cmake.match(/crossgram\/merged_forward\.h/g)).toHaveLength(1);
    expect(helper).toContain('QStringLiteral("bridgechat_")');
    expect(helper).toContain("Qt::CaseInsensitive");
    expect(helper).toContain("!ch.isDigit()");
    expect(helper).toContain("Peers().emplace(peer->id)");
    expect(header).toContain("bool IsUsername(const QString &username)");
  });

  it("opens the synthetic basic chat at its message anchor before generic link routing", async () => {
    const { controller } = await patched();
    expect(controller).toContain("Crossgram::MergedForward::IsUsername(*name)");
    expect(controller).toContain("Crossgram::MergedForward::Mark(peer)");
    expect(controller).toContain("peer->owner().removeChatListEntry(history)");
    expect(controller).toContain("showPeerHistory(peer, params, info.messageId)");
    expect(controller.indexOf("Crossgram::MergedForward::IsUsername(*name)"))
      .toBeLessThan(controller.indexOf("if (!info.phone.isEmpty())"));
  });

  it("suppresses peer-dialog requests and future chat-list insertion for marked views", async () => {
    const { histories, session } = await patched();
    expect(histories).toContain("Crossgram::MergedForward::IsPeer(history->peer)");
    expect(histories).toContain("return;");
    expect(session).toContain("Crossgram::MergedForward::IsPeer(history->peer)");
    expect(session).toContain("removeChatListEntry(history)");
    expect(session.indexOf("Crossgram::MergedForward::IsPeer(history->peer)"))
      .toBeLessThan(session.indexOf("const auto mainList"));
  });
});
