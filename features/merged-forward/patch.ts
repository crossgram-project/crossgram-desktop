import { PatchContext } from "../../src/core/patch-context.js";
import type { Target } from "../../src/targets.js";

interface PatchOptions {
  readonly root: string;
  readonly target: Target;
  readonly featureRoot: string;
}

const sourceRoot = "Telegram/SourceFiles";
const include = '#include "crossgram/merged_forward.h"';

/**
 * Open Crossgram's synthetic basic chats without letting Telegram Desktop
 * materialize them as ordinary dialogs in the left-hand chat list.
 */
export async function patchMergedForward(options: PatchOptions): Promise<void> {
  const context = new PatchContext(options.root, options.target, options.featureRoot);
  await context.install("merged_forward.h", `${sourceRoot}/crossgram/merged_forward.h`);
  await context.install(
    "merged_forward_core.h",
    `${sourceRoot}/crossgram/merged_forward_core.h`,
  );
  await context.install("merged_forward.cpp", `${sourceRoot}/crossgram/merged_forward.cpp`);

  await context.edit("Telegram/CMakeLists.txt", (file) => {
    file.insertAfter(
      "    mainwidget.cpp",
      "\n    crossgram/merged_forward.cpp"
        + "\n    crossgram/merged_forward.h"
        + "\n    crossgram/merged_forward_core.h",
      "crossgram/merged_forward.cpp",
    );
  });

  // The desktop client asks the relay which message a synthetic transcript
  // starts with, because the deep link stored in its local storage may still
  // anchor at the newest message of the bundle.  The constructor id matches
  // CROSSGRAM_API_SCHEMA in the relay's mtproto package.
  await context.edit(`${sourceRoot}/mtproto/scheme/api.tl`, (file) => {
    file.insertAfter(
      "upload.getFile#be5335be flags:# precise:flags.0?true cdn_supported:flags.1?true location:InputFileLocation offset:long limit:int = upload.File;",
      "\ncrossgram.getMergedForwardAnchor#f4a571c7 peer:InputPeer = DataJSON;",
      "crossgram.getMergedForwardAnchor#f4a571c7",
    );
  });

  await context.edit(`${sourceRoot}/window/window_session_controller.cpp`, (file) => {
    file.insertAfter(
      '#include "window/window_session_controller.h"',
      `\n\n#include "logs.h"\n${include}`,
      include,
    );
    file.insertAfter(
      `void SessionNavigation::showPeerByLink(const PeerByLinkInfo &info) {
\tCore::App().hideMediaView();`,
      `
\tif (const auto name = std::get_if<QString>(&info.usernameOrId);
\t\tname && Crossgram::MergedForward::IsUsername(*name)) {
\t\tresolveUsername(*name, [=](not_null<PeerData*> peer) {
\t\t\tCrossgram::MergedForward::Mark(peer);
\t\t\tconst auto history = peer->owner().history(peer);
\t\t\tpeer->owner().removeChatListEntry(history);
\t\t\tauto params = SectionShow{ SectionShow::Way::Forward };
\t\t\tparams.origin = SectionShow::OriginMessage{
\t\t\t\tinfo.clickFromMessageId
\t\t\t};
\t\t\tparams.highlight.pollOption = info.pollOption;
\t\t\t// The relay answers with the message a synthetic transcript starts
\t\t\t// with; the link anchor is only the fallback for older relays.
\t\t\t_api.request(MTPcrossgram_GetMergedForwardAnchor(
\t\t\t\tpeer->input()
\t\t\t)).done(crl::guard(this, [=](const MTPDataJSON &result) {
\t\t\t\tshowPeerHistory(peer, params, result.match([&](const MTPDdataJSON &data) {
\t\t\t\t\treturn Crossgram::MergedForward::FirstMessageId(
\t\t\t\t\t\tdata.vdata().v,
\t\t\t\t\t\tinfo.messageId);
\t\t\t\t}));
\t\t\t})).fail(crl::guard(this, [=](const MTP::Error &error) {
\t\t\t\tLOG(("Crossgram merged-forward anchor lookup failed: %1"
\t\t\t\t\t).arg(error.type()));
\t\t\t\tshowPeerHistory(peer, params, info.messageId);
\t\t\t})).send();
\t\t});
\t\treturn;
\t}`,
      "Crossgram::MergedForward::IsUsername(*name)",
    );
  });

  await context.edit(`${sourceRoot}/data/data_histories.cpp`, (file) => {
    file.insertAfter('#include "data/data_histories.h"', `\n\n${include}`, include);
    file.insertAfter(
      `void Histories::requestDialogEntry(
\t\tnot_null<History*> history,
\t\tFn<void()> callback) {`,
      `
\tif (Crossgram::MergedForward::IsPeer(history->peer)) {
\t\treturn;
\t}`,
      "Crossgram::MergedForward::IsPeer(history->peer)",
    );
  });

  await context.edit(`${sourceRoot}/data/data_session.cpp`, (file) => {
    file.insertAfter('#include "data/data_session.h"', `\n\n${include}`, include);
    file.insertAfter(
      `\tconst auto entry = key.entry();
\tconst auto history = entry->asHistory();`,
      `
\tif (history && Crossgram::MergedForward::IsPeer(history->peer)) {
\t\tremoveChatListEntry(history);
\t\treturn;
\t}`,
      "Crossgram::MergedForward::IsPeer(history->peer)",
    );
  });
}
