import { PatchContext } from "../../src/core/patch-context.js";
import type { Target } from "../../src/targets.js";

interface PatchOptions {
  readonly root: string;
  readonly target: Target;
  readonly featureRoot: string;
}

const sourceRoot = "Telegram/SourceFiles";
const include = '#include "crossgram/reactions.h"';

/**
 * Keep the reaction entry out of conversations the relay says cannot react.
 *
 * QQ has no reactions in one-to-one chats while its platform capability is
 * account-wide, and Telegram Desktop's own peer rules answer `All` for every
 * user, so an unpatched client keeps offering an entry the relay rejects. The
 * relay therefore answers `crossgram.getFeatures` per conversation, and the
 * patched client folds that answer into the peer's allowed reactions, which is
 * what every reaction entry point already consults.
 */
export async function patchReactions(options: PatchOptions): Promise<void> {
  const context = new PatchContext(options.root, options.target, options.featureRoot);
  await context.install("reactions.h", `${sourceRoot}/crossgram/reactions.h`);
  await context.install("reactions.cpp", `${sourceRoot}/crossgram/reactions.cpp`);

  await context.edit("Telegram/CMakeLists.txt", (file) => {
    file.insertAfter(
      "    mainwidget.cpp",
      "\n    crossgram/reactions.cpp\n    crossgram/reactions.h",
      "crossgram/reactions.cpp",
    );
  });

  // The wire contract: ask per conversation before offering the entry.
  await context.edit(`${sourceRoot}/mtproto/scheme/api.tl`, (file) => {
    file.insertAfter(
      "upload.getFile#be5335be flags:# precise:flags.0?true cdn_supported:flags.1?true location:InputFileLocation offset:long limit:int = upload.File;",
      "\ncrossgram.getFeatures#c3e6b915 peer:InputPeer = DataJSON;",
      "crossgram.getFeatures#c3e6b915",
    );
  });

  await context.edit(`${sourceRoot}/codegen/scheme/codegen_scheme.py`, (file) => {
    file.insertAfter(
      "    'messageReplies#81834865',",
      "\n    'crossgram.getFeatures#c3e6b915',",
      "crossgram.getFeatures#c3e6b915",
    );
  });

  // Every reaction entry point reads the peer's allowed reactions, so folding
  // the relay's answer in there hides the button, the selector and the menu
  // entry at once.
  await context.edit(`${sourceRoot}/data/data_peer_values.cpp`, (file) => {
    file.insertAfter('#include "base/unixtime.h"', `\n\n${include}`, include);
    file.replace(
      `const AllowedReactions &PeerAllowedReactions(not_null<PeerData*> peer) {
	if (const auto chat = peer->asChat()) {`,
      `const AllowedReactions &PeerAllowedReactions(not_null<PeerData*> peer) {
	if (Crossgram::Reactions::Disabled(peer)) {
		static const auto result = AllowedReactions{
			.type = AllowedReactionsType::Some,
		};
		return result;
	}
	if (const auto chat = peer->asChat()) {`,
      "Crossgram::Reactions::Disabled(peer)",
    );
  });

  // Ask as soon as a chat is opened, so the answer is ready for the first entry.
  await context.edit(`${sourceRoot}/window/window_session_controller.cpp`, (file) => {
    file.insertAfter('#include "window/window_session_controller.h"', `\n\n${include}`, include);
    file.insertAfter(
      `void SessionNavigation::showPeerHistory(
		not_null<PeerData*> peer,
		const SectionShow &params,
		MsgId msgId) {`,
      `
	Crossgram::Reactions::Warm(&peer->session(), peer);`,
      "Crossgram::Reactions::Warm(&peer->session(), peer);",
    );
  });
}
