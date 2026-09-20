import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
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
  "void HistoryInner::layoutChanged() {",
  "\t\tmarkReadMetricsStale();",
  "\t\tif (view->isUnderCursor()) {",
  "\t\t\tmouseActionUpdate();",
  "\t\t}",
  "}",
  "",
  "void HistoryInner::updateSize() {",
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
  const temporaryRoot = path.resolve("../work/tests/accessibility-unit");
  await mkdir(temporaryRoot, { recursive: true });
  const root = await mkdtemp(path.join(temporaryRoot, "fixture-"));
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
    expect(first.header).not.toContain("accessibilityRowsRebuilt");
    expect(first.header).toContain("mutable std::vector<Element*> _accessibleElements;");
    expect(first.header).toContain("mutable bool _accessibleElementsValid = false;");

    expect(first.widget).toContain("const std::vector<HistoryView::Element*> &HistoryInner::accessibleElements() const {");
    expect(first.widget).toContain("if (_accessibleElementsValid) {");
    expect(first.widget).toContain("_accessibleElements.clear();");
    expect(first.widget).toContain("_accessibleElements.push_back(message.get());");
    expect(first.widget).toContain("_accessibleElementsValid = true;");
    expect(first.widget).toContain("void HistoryInner::invalidateAccessibleElements() {");
    expect(first.widget).toContain("void HistoryInner::updateSize() {\n\tinvalidateAccessibleElements();");
    expect(first.widget).toContain("invalidateAccessibleElements();\n\t\tmarkReadMetricsStale();");
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

    // ListWidget is a separate final widget, not the base of HistoryInner.
    expect(first.listHeader).toBe(listHeaderSource);
    expect(first.listWidget).toBe(listWidgetSource);

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
    expect(listWidget).toBe(listWidgetSource);
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

function cppFunction(source: string, signature: string): string {
  const start = source.indexOf(signature);
  if (start < 0) throw new Error("Missing generated function " + signature);
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    if (source[i] === "}" && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error("Unbalanced generated function " + signature);
}

it("compiles against the actual independent widget bases and exercises cached row lifetimes", async () => {
  const root = await fixture();
  await patchAccessibility({ root, target: targetById("tdesktop") });
  const { header, widget } = await patched(root);
  const functions = [
    "const std::vector<HistoryView::Element*> &HistoryInner::accessibleElements() const",
    "void HistoryInner::invalidateAccessibleElements()",
    "void HistoryInner::updateSize()",
    "void HistoryInner::viewRemoved(",
  ].map(signature => cppFunction(widget, signature)).join("\n");
  const source = `#include <cassert>
#include <cstdint>
#include <memory>
#include <vector>
using quintptr = std::uintptr_t;
template <typename T> using not_null = T;
namespace Ui {
struct RpWidget { virtual ~RpWidget() = default; };
struct AbstractTooltipShower { virtual ~AbstractTooltipShower() = default; };
}
int reads = 0;
namespace HistoryView {
struct Element { bool hidden = false; bool isHidden() const { ++reads; return hidden; } };
}
struct Block { std::vector<std::unique_ptr<HistoryView::Element>> messages; };
struct History { std::vector<std::unique_ptr<Block>> blocks; };
struct Overlay { void viewGone(const HistoryView::Element*) {} };
// HistoryInner and ListWidget are independent widgets upstream, not a hierarchy.
class HistoryInner : public Ui::RpWidget, public Ui::AbstractTooltipShower {
public:
 using Element = HistoryView::Element;
 HistoryInner(History *history, History *migrated) : _history(history), _migrated(migrated) {}
 const auto &rows() const { return accessibleElements(); }
 void invalidate() { invalidateAccessibleElements(); }
 void updateSize();
 void viewRemoved(not_null<const Element*> view);
 private:
 History *_history;
 History *_migrated;
 Overlay *_overlayHost = nullptr;
${header}
};
${functions}
int main() {
 History primary, migrated;
 primary.blocks.push_back(std::make_unique<Block>());
 migrated.blocks.push_back(std::make_unique<Block>());
 auto &messages = primary.blocks.front()->messages;
 auto &oldMessages = migrated.blocks.front()->messages;
 messages.push_back(std::make_unique<HistoryView::Element>());
 messages.push_back(std::make_unique<HistoryView::Element>());
 oldMessages.push_back(std::make_unique<HistoryView::Element>());
 oldMessages.push_back(std::make_unique<HistoryView::Element>());
 oldMessages.back()->hidden = true;
 HistoryInner widget(&primary, &migrated);
 assert(widget.rows().size() == 3);
 assert(widget.rows()[0] == oldMessages[0].get());
 assert(widget.rows()[1] == messages[0].get());
 for (int n = 0; n != 200; ++n) assert(widget.rows().size() == 3);
 assert(reads == 4);
 messages[0]->hidden = true;
 widget.updateSize();
 assert(widget.rows().size() == 2);
 assert(reads == 8);
 messages.push_back(std::make_unique<HistoryView::Element>());
 widget.invalidate();
 assert(widget.rows().size() == 3);
 widget.viewRemoved(messages[1].get());
 messages.erase(messages.begin() + 1);
 assert(widget.rows().size() == 2);
 assert(widget.rows().back() == messages.back().get());
 widget.invalidate();
 primary.blocks.clear();
 assert(widget.rows().size() == 1);
}
`;
  const cpp = path.join(root, "cache-test.cpp");
  const binary = path.join(root, process.platform === "win32" ? "cache-test.exe" : "cache-test");
  await writeFile(cpp, source, "utf8");
  const run = promisify(execFile);
  await run(process.env.CXX || "clang++", ["-std=c++20", "-O0", cpp, "-o", binary]);
  await run(binary);
}, 30_000);
