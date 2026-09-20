import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { patchAccessibility } from "../features/accessibility/patch.js";
import { targets, targetById } from "../src/targets.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const headerSource = [
  "private:",
  "\t[[nodiscard]] std::vector<Element*> accessibleElements() const;",
  "\t[[nodiscard]] int accessibilityUnreadBarIndex() const;",
  "\tvoid applyAccessibilityFocus(int index, bool announceAlways);",
  "",
  "\tmutable quintptr _accessibilityIdentityCounter = 0;",
  "\tmutable const HistoryView::Element *_activeColumnsView = nullptr;",
  "",
].join("\n");

const widgetFunction = [
  "std::vector<HistoryView::Element*> HistoryInner::accessibleElements() const {",
  "\tstd::vector<Element*> result;",
  "\tconst auto gather = [&](not_null<History*> history) {",
  "\t\tfor (const auto &block : history->blocks) {",
  "\t\t\tfor (const auto &message : block->messages) {",
  "\t\t\t\tif (!message->isHidden()) {",
  "\t\t\t\t\tresult.push_back(message.get());",
  "\t\t\t\t}",
  "\t\t\t}",
  "\t\t}",
  "\t};",
  "\tif (_migrated) {",
  "\t\tgather(_migrated);",
  "\t}",
  "\tgather(_history);",
  "\treturn result;",
  "}",
].join("\n");

const widgetSource = [
  '#include "history/history_inner_widget.h"',
  "",
  "void HistoryInner::setup() {",
  "\tsession().data().newItemAdded(",
  "\t) | rpl::filter([=](not_null<HistoryItem*> item) {",
  "\t\tconst auto history = item->history();",
  "\t\treturn (history == _history)",
  "\t\t\t|| (_migrated && history == _migrated);",
  "\t}) | rpl::on_next([=] {",
  "\t\tcheckAnnounceFirstMessages();",
  "\t}, lifetime());",
  "\trpl::merge(",
  "\t\tsession().data().historyUnloaded(),",
  "\t\tsession().data().historyCleared()",
  "\t) | rpl::filter([this](not_null<const History*> history) {",
  "\t\treturn (_history == history);",
  "\t}) | rpl::on_next([this] {",
  "\t\tmouseActionCancel();",
  "\t}, lifetime());",
  "}",
  "",
  "void HistoryInner::itemRemoved(not_null<const HistoryItem*> item) {",
  "\t_accessibilityIdentities.remove(item);",
  "}",
  "",
  "void HistoryInner::viewRemoved(not_null<const Element*> view) {",
  "\tif (_overlayHost) {",
  "\t\t_overlayHost->viewGone(view);",
  "\t}",
  "}",
  "",
  "void HistoryInner::notifyMigrateUpdated() {",
  "\tconst auto migrated = _history->migrateFrom();",
  "\tif (_migrated != migrated) {",
  "\t\tif (_migrated) {",
  "\t\t\t_migrated->delegateMixin()->setCurrent(nullptr);",
  "\t\t}",
  "\t}",
  "}",
  "",
  widgetFunction,
  "",
  "int HistoryInner::accessibilityChildCount() const {",
  "\tconst auto barIndex = accessibilityUnreadBarIndex();",
  "\treturn int(accessibleElements().size()) + (barIndex >= 0 ? 1 : 0);",
  "}",
  "",
  "int HistoryInner::accessibilityChildName(int index) const {",
  "\tconst auto elements = accessibleElements();",
  "\treturn int(elements.size());",
  "}",
  "",
  "quintptr HistoryInner::accessibilityChildIdentity(int index) const {",
  "\tconst auto elements = accessibleElements();",
  "\tif (index >= 0) {",
  "\t\tconst auto elements = accessibleElements();",
  "\t\treturn quintptr(elements.size() + index);",
  "\t}",
  "\treturn 0;",
  "}",
  "",
].join("\n");

const listHeaderSource = [
  "private:",
  "\tvoid applyAccessibilityFocus(int index, bool announceAlways);",
  "\tvoid pruneAccessibilityIdentities();",
  "\t[[nodiscard]] auto computeActiveColumns(int row) const",
  "\t\t-> const std::vector<HistoryView::MessageSubItem> &;",
  "",
].join("\n");

const listWidgetSource = [
  '#include "history/view/history_view_list_widget.h"',
  "",
  "void ListWidget::refreshRows(const Data::MessagesSlice &old) {",
  "\tExpects(_viewsCapacity.empty());",
  "\tpruneAccessibilityIdentities();",
  "\tcheckUnreadBarCreation(markLastAsRead);",
  "}",
  "",
  "void ListWidget::pruneAccessibilityIdentities() {",
  "\t_accessibilityIdentities.clear();",
  "}",
  "",
].join("\n");

async function fixture(eol = "\n"): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "crossgram-desktop-accessibility-"));
  roots.push(root);
  const history = path.join(root, "Telegram/SourceFiles/history");
  const listView = path.join(history, "view");
  await mkdir(listView, { recursive: true });
  const write = (directory: string, name: string, value: string) =>
    writeFile(path.join(directory, name), value.replaceAll("\n", eol), "utf8");
  await write(history, "history_inner_widget.h", headerSource);
  await write(history, "history_inner_widget.cpp", widgetSource);
  await write(listView, "history_view_list_widget.h", listHeaderSource);
  await write(listView, "history_view_list_widget.cpp", listWidgetSource);
  return root;
}

interface PatchedSources {
  readonly header: string;
  readonly widget: string;
  readonly listHeader: string;
  readonly listWidget: string;
}

async function patched(root: string): Promise<PatchedSources> {
  const read = (relative: string) => readFile(path.join(root, relative), "utf8");
  return {
    header: await read("Telegram/SourceFiles/history/history_inner_widget.h"),
    widget: await read("Telegram/SourceFiles/history/history_inner_widget.cpp"),
    listHeader: await read("Telegram/SourceFiles/history/view/history_view_list_widget.h"),
    listWidget: await read("Telegram/SourceFiles/history/view/history_view_list_widget.cpp"),
  };
}

function balancedBraces(source: string): boolean {
  return (source.match(/{/g) ?? []).length === (source.match(/}/g) ?? []).length;
}

describe("desktop message history accessibility patch", () => {
  it("caches the accessibility rows and is idempotent", async () => {
    const root = await fixture();
    const options = { root, target: targetById("ayugram") };

    await patchAccessibility(options);
    const first = await patched(root);

    expect(first.header).toContain("const std::vector<Element*> &accessibleElements() const;");
    expect(first.header).toContain("void invalidateAccessibleElements();");
    expect(first.header).toContain("void accessibilityRowsRebuilt() override;");
    expect(first.header).toContain("mutable std::vector<Element*> _accessibleElements;");
    expect(first.header).toContain("mutable bool _accessibleElementsValid = false;");

    expect(first.widget).toContain("const std::vector<HistoryView::Element*> &HistoryInner::accessibleElements() const {");
    expect(first.widget).toContain("if (_accessibleElementsValid) {");
    expect(first.widget).toContain("_accessibleElements.clear();");
    expect(first.widget).toContain("_accessibleElements.push_back(message.get());");
    expect(first.widget).toContain("_accessibleElementsValid = true;");
    expect(first.widget).toContain("void HistoryInner::invalidateAccessibleElements() {");
    expect(first.widget).toContain("void HistoryInner::accessibilityRowsRebuilt() {\n\tinvalidateAccessibleElements();");
    expect(first.widget).not.toContain("std::vector<Element*> result;");

    // Every read of the list inside the widget shares the cached rows
    // instead of copying them.
    expect(first.widget.match(/const auto &elements = accessibleElements\(\);/g) ?? []).toHaveLength(3);
    expect(first.widget).not.toContain("const auto elements = accessibleElements();");

    // Rows are rebuilt whenever messages, views, histories, or the
    // migrated history change.
    expect(first.widget).toContain("void HistoryInner::viewRemoved(not_null<const Element*> view) {\n\tinvalidateAccessibleElements();");
    expect(first.widget).toContain("_accessibilityIdentities.remove(item);\n\tinvalidateAccessibleElements();");
    expect(first.widget).toContain("checkAnnounceFirstMessages();\n\t\tinvalidateAccessibleElements();");
    expect(first.widget).toContain("mouseActionCancel();\n\t\tinvalidateAccessibleElements();");
    expect(first.widget).toContain("if (_migrated != migrated) {\n\t\tinvalidateAccessibleElements();");
    expect((first.widget.match(/invalidateAccessibleElements\(\);/g) ?? []).length).toBeGreaterThanOrEqual(5);

    // The base list tells the widget when the rows were rebuilt for a new
    // slice, which is the only notification for a row set that changed
    // without adding or removing a view.
    expect(first.listHeader).toContain("virtual void accessibilityRowsRebuilt() {");
    expect(first.listWidget).toContain("pruneAccessibilityIdentities();\n\taccessibilityRowsRebuilt();");

    expect(balancedBraces(first.header)).toBe(true);
    expect(balancedBraces(first.widget)).toBe(true);
    expect(balancedBraces(first.listHeader)).toBe(true);
    expect(balancedBraces(first.listWidget)).toBe(true);

    await patchAccessibility(options);
    expect(await patched(root)).toEqual(first);
  });

  it.each(targets.map((target) => target.id))("patches %s sources", async (targetId) => {
    const root = await fixture();
    await patchAccessibility({ root, target: targetById(targetId) });
    const { widget, listWidget } = await patched(root);
    expect(widget).toContain("_accessibleElementsValid = true;");
    expect(listWidget).toContain("accessibilityRowsRebuilt();");
  });

  it("preserves CRLF sources", async () => {
    const root = await fixture("\r\n");
    await patchAccessibility({ root, target: targetById("tdesktop") });
    const sources = await patched(root);
    for (const source of Object.values(sources)) {
      expect(source.replaceAll("\r\n", "")).not.toContain("\n");
    }
  });

  it("fails loudly when upstream rewrites the accessibility list", async () => {
    const root = await fixture();
    const widgetPath = path.join(root, "Telegram/SourceFiles/history/history_inner_widget.cpp");
    const source = await readFile(widgetPath, "utf8");
    await writeFile(widgetPath, source.replace(
      "std::vector<HistoryView::Element*> HistoryInner::accessibleElements() const {",
      "std::vector<HistoryView::Element*> HistoryInner::accessibleElements() const {\n\tExpects(_history != nullptr);",
    ), "utf8");
    await expect(patchAccessibility({ root, target: targetById("ayugram") }))
      .rejects.toThrow(/Could not find text 'std::vector<HistoryView::Element\*> HistoryInner::accessibleElements/);
  });
});
