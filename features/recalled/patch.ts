import { PatchContext } from "../../src/core/patch-context.js";
import type { Target } from "../../src/targets.js";

interface PatchOptions {
  readonly root: string;
  readonly target: Target;
  readonly featureRoot: string;
}

/**
 * Add Crossgram's recalled message flags and render visible recalls using
 * AyuGram's existing deleted-message UI (opacity + deleted-mark icon).
 *
 * `recalled` is the semantic bit (flags.12). `recalled_visible` (flags2.30)
 * is deliberately separate so the server can omit recalled messages for
 * clients/configurations that should not display them.
 */
export async function patchRecalled(options: PatchOptions): Promise<void> {
  // The source locations and Ayu-specific deleted-message UI are only present
  // in AyuGramDesktop. Other desktop targets keep the upstream schema untouched.
  if (options.target.id !== "ayugram") return;
  const context = new PatchContext(options.root, options.target, options.featureRoot);

  await context.edit("Telegram/SourceFiles/mtproto/scheme/api.tl", (file) => {
    file.replacePattern(
      /^message#7600b9d3 flags:# /m,
      "message#7600b9d3 flags:# recalled:flags.12?true ",
      "recalled:flags.12?true",
    );
    file.replacePattern(
      /effect:flags2\.2\?long factcheck:/,
      "effect:flags2.2?long recalled_visible:flags2.30?true factcheck:",
      "recalled_visible:flags2.30?true",
    );
  });

  await context.edit("Telegram/SourceFiles/history/history_item.h", (file) => {
    file.replace(
      "\t[[nodiscard]] bool isDeleted() const;",
      "\t[[nodiscard]] bool isDeleted() const;\n\t[[nodiscard]] bool isRecalled() const { return _recalled; }\n\t[[nodiscard]] bool isRecalledVisible() const { return _recalledVisible; }",
      "isRecalled() const { return _recalled; }",
    );
    file.replace(
      "\tbool _deleted = false;\n\tbool _deletedAnimated = false;",
      "\tbool _deleted = false;\n\tbool _deletedAnimated = false;\n\tbool _recalled = false;\n\tbool _recalledVisible = false;",
      "bool _recalled = false;",
    );
  });

  await context.edit("Telegram/SourceFiles/history/history_item.cpp", (file) => {
    file.insertAfter(
      "\tif (const auto until = data.vreport_delivery_until_date()) {",
      "\t_recalled = data.is_recalled();\n\t_recalledVisible = data.is_recalled_visible();\n\tif (_recalled && _recalledVisible) {\n\t\tsetDeleted();\n\t}\n\n",
      "_recalled = data.is_recalled();",
    );
  });

  await context.edit("Telegram/SourceFiles/history/view/history_view_element.cpp", (file) => {
    file.replace(
      "if (!settings.semiTransparentDeletedMessages()) {",
      "if (!settings.semiTransparentDeletedMessages() && !_data->isRecalled()) { // crossgram-recalled-opacity",
      "crossgram-recalled-opacity",
    );
    file.replace(
      "if (!AyuSettings::getInstance().semiTransparentDeletedMessages()) {\n\t\t_deletedOpacityAnimation.stop();",
      "if (!AyuSettings::getInstance().semiTransparentDeletedMessages() && !_data->isRecalled()) {\n\t\t_deletedOpacityAnimation.stop();",
      "if (!AyuSettings::getInstance().semiTransparentDeletedMessages() && !_data->isRecalled())",
    );
    file.replace(
      "\tif (_data->isDeleted()) {\n\t\tif (const auto group = history()->owner().groups().find(_data)) {",
      "\tif (_data->isDeleted()) {\n\t\tif (_data->isRecalled()) {\n\t\t\treturn 0.7;\n\t\t}\n\t\tif (const auto group = history()->owner().groups().find(_data)) {",
      "return 0.7;",
    );
  });

  await context.edit("Telegram/SourceFiles/history/history_item_edition.h", (file) => {
    file.replace(
      "\tbool isEditHide = false;",
      "\tbool isEditHide = false;\n\tbool recalled = false;\n\tbool recalledVisible = false;",
      "bool recalled = false;",
    );
  });

  await context.edit("Telegram/SourceFiles/history/history_item_edition.cpp", (file) => {
    file.replace(
      "isEditHide = message.is_edit_hide();",
      "isEditHide = message.is_edit_hide();\n\trecalled = message.is_recalled();\n\trecalledVisible = message.is_recalled_visible();",
      "recalled = message.is_recalled();",
    );
  });

  await context.edit("Telegram/SourceFiles/history/history_item.cpp", (file) => {
    file.insertAfter(
      "void HistoryItem::applyEdition(HistoryMessageEdition &&edition) {",
      "\tif (edition.recalled) {\n\t\t_recalled = true;\n\t\t_recalledVisible = edition.recalledVisible;\n\t\tif (_recalledVisible) {\n\t\t\tsetDeleted();\n\t\t}\n\t}\n",
      "_recalledVisible = edition.recalledVisible;",
    );
  });
}
