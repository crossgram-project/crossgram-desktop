import { PatchContext } from "../../src/core/patch-context.js";
import type { Target } from "../../src/targets.js";

interface PatchOptions {
  readonly root: string;
  readonly target: Target;
  readonly featureRoot: string;
}

const sourceRoot = "Telegram/SourceFiles";
const include = '#include "crossgram/poke.h"';

/**
 * QQ poke ("戳一戳") entry for the menus Telegram Desktop builds around an
 * avatar. The relay decides whether the entry exists at all: the patched client
 * asks `crossgram.getFeatures` for the conversation and shows the action only
 * when the answer advertises poke support, so official servers never see it.
 */
export async function patchPoke(options: PatchOptions): Promise<void> {
  const context = new PatchContext(options.root, options.target, options.featureRoot);
  await context.install("poke.h", `${sourceRoot}/crossgram/poke.h`);
  await context.install("poke.cpp", `${sourceRoot}/crossgram/poke.cpp`);

  await context.edit("Telegram/CMakeLists.txt", (file) => {
    file.insertAfter(
      "    mainwidget.cpp",
      "\n    crossgram/poke.cpp\n    crossgram/poke.h",
      "crossgram/poke.cpp",
    );
  });

  // The wire contract: ask before showing, then send the burst.
  await context.edit(`${sourceRoot}/mtproto/scheme/api.tl`, (file) => {
    file.insertAfter(
      "upload.getFile#be5335be flags:# precise:flags.0?true cdn_supported:flags.1?true location:InputFileLocation offset:long limit:int = upload.File;",
      "\ncrossgram.getFeatures#c3e6b915 peer:InputPeer = DataJSON;"
        + "\ncrossgram.sendPoke#9a2d47f0 peer:InputPeer user_id:InputUser count:int = Bool;",
      "crossgram.getFeatures#c3e6b915",
    );
  });

  await context.edit(`${sourceRoot}/codegen/scheme/codegen_scheme.py`, (file) => {
    file.insertAfter(
      "    'messageReplies#81834865',",
      "\n    'crossgram.getFeatures#c3e6b915',\n    'crossgram.sendPoke#9a2d47f0',",
      "crossgram.getFeatures#c3e6b915",
    );
  });

  await context.edit(`${sourceRoot}/window/window_peer_menu.cpp`, (file) => {
    file.insertAfter('#include "apiwrap.h"', `\n\n${include}`, include);
    // Message avatars: the entry pokes the message author in this chat.
    file.insertAfter(
      `	if (searchInEntry) {
		addAction(tr::lng_context_search_from(tr::now), [=] {
			controller->searchInChat(searchInEntry, peer);
		}, &st::menuIconSearch);
	}`,
      `
	Crossgram::Poke::AddMenuAction(
		controller,
		peer,
		groupPeer ? groupPeer : peer.get(),
		addAction);`,
      "Crossgram::Poke::AddMenuAction(\n\t\tcontroller,\n\t\tpeer,",
    );
    // Direct chats: the chat menu sits next to the peer avatar in the header.
    file.replace(
      `void Filler::fillHistoryActions() {
	addToggleMuteSubmenu(true);`,
      `void Filler::fillHistoryActions() {
	Crossgram::Poke::AddMenuAction(_controller, _peer, _peer, _addAction);
	addToggleMuteSubmenu(true);`,
      "Crossgram::Poke::AddMenuAction(_controller, _peer, _peer, _addAction);\n\taddToggleMuteSubmenu(true);",
    );
    // Peer profiles: the entry pokes the user whose profile is open.
    file.replace(
      `void Filler::fillProfileActions() {
	addTTLSubmenu(true);`,
      `void Filler::fillProfileActions() {
	Crossgram::Poke::AddMenuAction(_controller, _peer, _peer, _addAction);
	addTTLSubmenu(true);`,
      "Crossgram::Poke::AddMenuAction(_controller, _peer, _peer, _addAction);\n\taddTTLSubmenu(true);",
    );
  });

  // Ask as soon as a chat is opened, so the entry is ready for the first menu.
  await context.edit(`${sourceRoot}/window/window_session_controller.cpp`, (file) => {
    file.insertAfter('#include "window/window_session_controller.h"', `\n\n${include}`, include);
    file.insertAfter(
      `void SessionNavigation::showPeerHistory(
		not_null<PeerData*> peer,
		const SectionShow &params,
		MsgId msgId) {`,
      `
	Crossgram::Poke::Warm(&peer->session(), peer);`,
      "Crossgram::Poke::Warm(&peer->session(), peer);",
    );
  });
}
