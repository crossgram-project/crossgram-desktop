import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

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
    mkdir(path.join(source, "mtproto", "scheme"), { recursive: true }),
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
  await writeFile(path.join(source, "mtproto", "scheme", "api.tl"), `---functions---
upload.getFile#be5335be flags:# precise:flags.0?true cdn_supported:flags.1?true location:InputFileLocation offset:long limit:int = upload.File;
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
    api: await read("Telegram/SourceFiles/mtproto/scheme/api.tl"),
    cmake: await read("Telegram/CMakeLists.txt"),
    core: await read("Telegram/SourceFiles/crossgram/merged_forward_core.h"),
    helper: await read("Telegram/SourceFiles/crossgram/merged_forward.cpp"),
    header: await read("Telegram/SourceFiles/crossgram/merged_forward.h"),
    controller: await read("Telegram/SourceFiles/window/window_session_controller.cpp"),
    histories: await read("Telegram/SourceFiles/data/data_histories.cpp"),
    session: await read("Telegram/SourceFiles/data/data_session.cpp"),
  };
}

const usernameHarness = `#include "crossgram/merged_forward_core.h"

#include <cstdio>
#include <string_view>

int main() {
	using Crossgram::MergedForward::IsSyntheticUsername;
	struct Case {
		std::string_view username;
		bool accepted;
	};
	const auto cases = {
		Case{ "bridgebundle_1", true },
		Case{ "bridgebundle_42", true },
		Case{ "bridgechat_7", true },
		Case{ "BRIDGEBUNDLE_123", true },
		Case{ "BridgeChat_9", true },
		Case{ "bridgebundle_007", true },
		Case{ "bridgebundle_9223372036854775807", true },
		Case{ "bridgebundle_", false },
		Case{ "bridgechat_", false },
		Case{ "bridgebundle_0", false },
		Case{ "bridgebundle_9223372036854775808", false },
		Case{ "bridgebundle_1x", false },
		Case{ "bridgebundle_-1", false },
		Case{ "bridgebundle_+1", false },
		Case{ "bridgebundle_1.5", false },
		Case{ "bridgebundle_1/2", false },
		Case{ "bridgebundle", false },
		Case{ "bridgebundlex_1", false },
		Case{ "bridgefile_1", false },
		Case{ "user", false },
		Case{ "", false },
	};
	for (const auto &item : cases) {
		if (IsSyntheticUsername(item.username) != item.accepted) {
			std::printf(
				"unexpected result for %.*s\\n",
				int(item.username.size()),
				item.username.data());
			return 1;
		}
	}
	std::printf("all synthetic username cases passed\\n");
	return 0;
}
`;

async function runUsernameHarness(core: string): Promise<string> {
  const temporaryRoot = path.resolve("../work/tests/merged-forward-unit");
  await mkdir(temporaryRoot, { recursive: true });
  const root = await mkdtemp(path.join(temporaryRoot, "fixture-"));
  roots.push(root);
  const include = path.join(root, "crossgram");
  await mkdir(include, { recursive: true });
  await writeFile(path.join(include, "merged_forward_core.h"), core, "utf8");
  const cpp = path.join(root, "username-test.cpp");
  const binary = path.join(root, process.platform === "win32" ? "username-test.exe" : "username-test");
  await writeFile(cpp, usernameHarness, "utf8");
  const run = promisify(execFile);
  await run(process.env.CXX || "clang++", ["-std=c++20", "-O0", "-I", root, cpp, "-o", binary]);
  return (await run(binary)).stdout;
}

describe("Desktop merged-forward patch e2e", () => {
  it("installs one shared synthetic-peer registry", async () => {
    const { cmake, core, helper, header } = await patched();
    expect(cmake.match(/crossgram\/merged_forward\.cpp/g)).toHaveLength(1);
    expect(cmake.match(/crossgram\/merged_forward\.h/g)).toHaveLength(1);
    expect(cmake.match(/crossgram\/merged_forward_core\.h/g)).toHaveLength(1);
    expect(core).toContain('std::string_view("bridgebundle_")');
    expect(core).toContain('std::string_view("bridgechat_")');
    expect(helper).toContain("IsSyntheticUsername(std::string_view(");
    expect(helper).toContain("Peers().emplace(peer->id)");
    expect(header).toContain("bool IsUsername(const QString &username)");
  });

  it("accepts every synthetic username shape the relay issues", async () => {
    const { core } = await patched();
    expect(await runUsernameHarness(core)).toContain("all synthetic username cases passed");
  }, 30_000);

  it("asks the relay for the transcript start and keeps the link anchor as fallback", async () => {
    const { api, controller } = await patched();
    expect(api.match(/crossgram\.getMergedForwardAnchor#f4a571c7/g)).toHaveLength(1);
    expect(controller).toContain("MTPcrossgram_GetMergedForwardAnchor(");
    expect(controller).toContain("Crossgram::MergedForward::FirstMessageId(");
    expect(controller).toContain("crl::guard(this");
    expect(controller).toContain('#include "logs.h"');
    expect(controller.match(/showPeerHistory\(peer, params/g)).toHaveLength(2);
    expect(controller).toContain("showPeerHistory(peer, params, info.messageId);");
  });

  it("parses the relay answer in the shared helper", async () => {
    const { header, helper } = await patched();
    expect(header).toContain("MsgId FirstMessageId(const QByteArray &json, MsgId fallback)");
    expect(helper).toContain("QJsonDocument::fromJson(json)");
    expect(helper).toContain('u"messageId"_q');
    expect(helper).toContain("return (id > 0) ? MsgId(id) : fallback;");
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
