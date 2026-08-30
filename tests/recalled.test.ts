import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { patchRecalled } from "../features/recalled/patch.js";
import { targetById } from "../src/targets.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "crossgram-desktop-recalled-"));
  roots.push(root);
  const files: Record<string, string> = {
    "Telegram/SourceFiles/mtproto/scheme/api.tl":
      "message#7600b9d3 flags:# out:flags.1?true effect:flags2.2?long factcheck:flags2.3?FactCheck = Message;\n",
    "Telegram/SourceFiles/history/history_item.h":
      "\t[[nodiscard]] bool isDeleted() const;\n\tbool _deleted = false;\n\tbool _deletedAnimated = false;\n",
    "Telegram/SourceFiles/history/history_item.cpp":
      "\tif (const auto until = data.vreport_delivery_until_date()) {\nvoid HistoryItem::applyEdition(HistoryMessageEdition &&edition) {\n",
    "Telegram/SourceFiles/history/history_item_edition.h": "\tbool isEditHide = false;\n",
    "Telegram/SourceFiles/history/history_item_edition.cpp": "isEditHide = message.is_edit_hide();\n",
    "Telegram/SourceFiles/history/view/history_view_message.cpp":
      "#include \"history/view/history_view_message.h\"\nvoid Message::draw(Painter &p, const PaintContext &context) const {\n\tconst auto g = countGeometry();\n\tif (g.width() < 1) return;\n\tconst auto item = data();\n\tconst auto media = this->media();\n}\n",
    "Telegram/SourceFiles/history/view/history_view_element.cpp":
      "if (!settings.semiTransparentDeletedMessages()) {\n\t\t_deletedOpacityAnimation.stop();\n}\nif (!AyuSettings::getInstance().semiTransparentDeletedMessages()) {\n\t\t_deletedOpacityAnimation.stop();\n}\n\tif (_data->isDeleted()) {\n\t\tif (const auto group = history()->owner().groups().find(_data)) {\n\t\t}\n\t}\n",
  };
  await Promise.all(Object.entries(files).map(async ([relative, content]) => {
    const file = path.join(root, relative);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, content, "utf8");
  }));
  return root;
}

describe("recalled desktop patch", () => {
  it("adds schema and UI plumbing for AyuGram and is idempotent", async () => {
    const root = await fixture();
    const options = { root, target: targetById("ayugram"), featureRoot: path.join(root, "feature") };
    await patchRecalled(options);
    const first = await Promise.all([
      readFile(path.join(root, "Telegram/SourceFiles/mtproto/scheme/api.tl"), "utf8"),
      readFile(path.join(root, "Telegram/SourceFiles/history/history_item.h"), "utf8"),
      readFile(path.join(root, "Telegram/SourceFiles/history/history_item.cpp"), "utf8"),
      readFile(path.join(root, "Telegram/SourceFiles/history/history_item_edition.h"), "utf8"),
      readFile(path.join(root, "Telegram/SourceFiles/history/history_item_edition.cpp"), "utf8"),
      readFile(path.join(root, "Telegram/SourceFiles/history/view/history_view_element.cpp"), "utf8"),
    ]);
    expect(first[0]).toContain("recalled:flags.12?true");
    expect(first[0]).toContain("recalled_visible:flags2.30?true");
    expect(first[1]).toContain("isRecalled() const");
    expect(first[1]).toContain("isRecalledVisible() const");
    expect(first[2]).toContain("_recalled = data.is_recalled();");
    expect(first[2]).toContain("_recalledVisible = data.is_recalled_visible();");
    expect(first[2]).toContain("if (edition.recalled) {");
    expect(first[3]).toContain("bool recalled = false");
    expect(first[3]).toContain("bool recalledVisible = false");
    expect(first[4]).toContain("recalled = message.is_recalled();");
    expect(first[4]).toContain("recalledVisible = message.is_recalled_visible();");
    expect(first[5]).toContain("&& !_data->isRecalled()");
    expect(first[5]).toContain("return 0.7;");
    await patchRecalled(options);
    const second = await readFile(path.join(root, "Telegram/SourceFiles/history/history_item.cpp"), "utf8");
    expect(second).toBe(first[2]);
  });

  it.each(["tdesktop", "tdesktop-x64", "materialgram"])("patches %s target", async (targetId) => {
    const root = await fixture();
    await patchRecalled({ root, target: targetById(targetId), featureRoot: root });
    const [schema, message] = await Promise.all([
      readFile(path.join(root, "Telegram/SourceFiles/mtproto/scheme/api.tl"), "utf8"),
      readFile(path.join(root, "Telegram/SourceFiles/history/view/history_view_message.cpp"), "utf8"),
    ]);
    expect(schema).toContain("recalled:flags.12?true");
    expect(message).toContain("crossgram-recalled-generic-paint");
  });
});
