import { PatchContext } from "../../src/core/patch-context.js";
import type { Target } from "../../src/targets.js";

interface PatchOptions {
  readonly root: string;
  readonly target: Target;
  readonly featureRoot: string;
}

/** Add Crossgram recalled flags and render visible recalls on every desktop target. */
export async function patchRecalled(options: PatchOptions): Promise<void> {
  const context = new PatchContext(options.root, options.target, options.featureRoot);

  // The wire schema and HistoryItem plumbing are shared by tdesktop, 64Gram,
  // Materialgram and AyuGram. `true` flag fields carry no payload, so old
  // clients safely ignore the new bits while retaining the same constructor.
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
    file.insertAfter(
      "\t[[nodiscard]] bool isEmpty() const;",
      "\n\t[[nodiscard]] bool isRecalled() const { return _recalled; }\n\t[[nodiscard]] bool isRecalledVisible() const { return _recalledVisible; }",
      "isRecalled() const { return _recalled; }",
    );
    file.insertAfter(
      "\tmutable MessageFlags _flags = 0;",
      "\n\tbool _recalled = false;\n\tbool _recalledVisible = false;",
      "bool _recalled = false;",
    );
  });

  await context.edit("Telegram/SourceFiles/history/history_item.cpp", (file) => {
    file.insertAfter(
      "\tif (const auto until = data.vreport_delivery_until_date()) {",
      "\t_recalled = data.is_recalled();\n\t_recalledVisible = data.is_recalled_visible();\n\n",
      "_recalled = data.is_recalled();",
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
      "\tif (edition.recalled) {\n\t\t_recalled = true;\n\t\t_recalledVisible = edition.recalledVisible;\n\t}\n",
      "_recalledVisible = edition.recalledVisible;",
    );
  });

  await context.edit("Telegram/SourceFiles/history/view/history_view_message.cpp", (file) => {
      file.insertAfter(
        "#include \"history/view/history_view_message.h\"",
        "\n#include <gsl/gsl>",
        "#include <gsl/gsl>",
      );
      file.insertAfter(
        "\tconst auto media = this->media();",
        "\n\t// crossgram-recalled-generic-paint\n\tp.save();\n\tconst auto recalledPaintGuard = gsl::finally([&] {\n\t\tif (item->isRecalled() && item->isRecalledVisible()) {\n\t\t\tp.setPen(Qt::gray);\n\t\t\tp.drawText(QRect(0, 0, width(), height()), Qt::AlignRight | Qt::AlignBottom, QString::fromUtf8(\"\\xF0\\x9F\\x97\\x91\"));\n\t\t}\n\t\tp.restore();\n\t});\n\tif (item->isRecalled() && item->isRecalledVisible()) {\n\t\tp.setOpacity(p.opacity() * 0.7);\n\t}",
        "crossgram-recalled-generic-paint",
      );
  });
}
