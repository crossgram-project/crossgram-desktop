import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { patchAccessibility } from "../features/accessibility/patch.js";
import { targets } from "../src/targets.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const relativePaths = [
  "Telegram/SourceFiles/history/history_inner_widget.h",
  "Telegram/SourceFiles/history/history_inner_widget.cpp",
  "Telegram/SourceFiles/history/view/history_view_list_widget.h",
  "Telegram/SourceFiles/history/view/history_view_list_widget.cpp",
];

interface Sources {
  readonly header: string;
  readonly widget: string;
  readonly listHeader: string;
  readonly listWidget: string;
}

async function snapshot(root: string): Promise<Sources> {
  const [header, widget, listHeader, listWidget] = await Promise.all(
    relativePaths.map((relative) => readFile(path.join(root, relative), "utf8")),
  );
  if (
    header === undefined
    || widget === undefined
    || listHeader === undefined
    || listWidget === undefined
  ) {
    throw new Error("Missing patched history sources.");
  }
  return { header, widget, listHeader, listWidget };
}

function balancedBraces(source: string): boolean {
  return (source.match(/\{/g) ?? []).length === (source.match(/\}/g) ?? []).length;
}

// Point this at clean release source snapshots, one directory per target. The
// unit tests cover the row cache itself; this runs the same patch against the
// real message history of every supported upstream and reads back the result
// the way the C++ compiler would.
const sourceRoot = process.env.CROSSGRAM_DESKTOP_ACCESSIBILITY_SOURCE_ROOT;
describe.skipIf(!sourceRoot)("real upstream message history accessibility", () => {
  it.each(targets)("patches $id release sources idempotently", async (target) => {
    const fixture = await mkdtemp(path.join(tmpdir(), "crossgram-desktop-accessibility-real-"));
    roots.push(fixture);
    const root = path.join(fixture, target.id);
    for (const relative of relativePaths) {
      await cp(
        path.join(sourceRoot!, target.id, relative),
        path.join(root, relative),
        { recursive: true },
      );
    }

    await patchAccessibility({ root, target });
    const sources = await snapshot(root);
    const { header, widget, listHeader, listWidget } = sources;

    expect(header).toContain("const std::vector<Element*> &accessibleElements() const;");
    expect(header).toContain("mutable std::vector<Element*> _accessibleElements;");
    expect(widget).toContain("const std::vector<HistoryView::Element*> &HistoryInner::accessibleElements() const {");
    expect(widget).toContain("void HistoryInner::invalidateAccessibleElements() {");
    expect(widget).toContain("void HistoryInner::accessibilityRowsRebuilt() {");
    expect(header).toContain("void accessibilityRowsRebuilt() override;");
    expect(listHeader).toContain("virtual void accessibilityRowsRebuilt() {");
    expect(listWidget).toContain("pruneAccessibilityIdentities();\n\taccessibilityRowsRebuilt();");
    expect(widget).not.toContain("const auto elements = accessibleElements();");
    expect(widget).not.toContain("std::vector<Element*> result;");

    // The cache is only correct together with every invalidation the patch
    // installs, and every read inside the widget has to share the rows.
    const invalidations = widget.match(/invalidateAccessibleElements\(\);/g) ?? [];
    expect(invalidations.length).toBeGreaterThanOrEqual(5);
    const reads = widget.match(/const auto &elements = accessibleElements\(\);/g) ?? [];
    expect(reads.length).toBeGreaterThanOrEqual(15);
    for (const source of Object.values(sources)) {
      expect(balancedBraces(source)).toBe(true);
    }

    await patchAccessibility({ root, target });
    expect(await snapshot(root)).toEqual(sources);
  });
});
