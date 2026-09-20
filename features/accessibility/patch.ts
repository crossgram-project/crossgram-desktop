import { PatchContext } from "../../src/core/patch-context.js";
import type { Target } from "../../src/targets.js";

interface PatchOptions {
  readonly root: string;
  readonly target: Target;
}

const headerPath = "Telegram/SourceFiles/history/history_inner_widget.h";
const widgetPath = "Telegram/SourceFiles/history/history_inner_widget.cpp";

const originalElements = [
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

const cachedElements = [
  "const std::vector<HistoryView::Element*> &HistoryInner::accessibleElements() const {",
  "\t// A screen reader reads several properties per row and walks every",
  "\t// row of the list, so rebuilding this list - and asking every",
  "\t// message whether it is hidden - on each read makes one focus",
  "\t// change in a long history quadratic on the UI thread. Keep the",
  "\t// rows until a notification says that they may have changed.",
  "\tif (_accessibleElementsValid) {",
  "\t\treturn _accessibleElements;",
  "\t}",
  "\t_accessibleElements.clear();",
  "\tconst auto gather = [&](not_null<History*> history) {",
  "\t\tfor (const auto &block : history->blocks) {",
  "\t\t\tfor (const auto &message : block->messages) {",
  "\t\t\t\tif (!message->isHidden()) {",
  "\t\t\t\t\t_accessibleElements.push_back(message.get());",
  "\t\t\t\t}",
  "\t\t\t}",
  "\t\t}",
  "\t};",
  "\tif (_migrated) {",
  "\t\tgather(_migrated);",
  "\t}",
  "\tgather(_history);",
  "\t_accessibleElementsValid = true;",
  "\treturn _accessibleElements;",
  "}",
  "",
  "void HistoryInner::invalidateAccessibleElements() {",
  "\t// Messages and whole histories come and go while a slice update",
  "\t// destroys views, so cached rows may outlive the elements they",
  "\t// point at. Rebuilding the list is cheap next to the reads it",
  "\t// saves, so the notifications below simply drop it.",
  "\t_accessibleElementsValid = false;",
  "}",
].join("\n");

export async function patchAccessibility(options: PatchOptions): Promise<void> {
  const context = new PatchContext(options.root, options.target, options.root);

  await context.edit(headerPath, (file) => {
    file.replace(
      "\t[[nodiscard]] std::vector<Element*> accessibleElements() const;",
      [
        "\t[[nodiscard]] const std::vector<Element*> &accessibleElements() const;",
        "\tvoid invalidateAccessibleElements();",
      ].join("\n"),
    );
    file.insertAfter(
      "\tmutable quintptr _accessibilityIdentityCounter = 0;",
      [
        "",
        "\tmutable std::vector<Element*> _accessibleElements;",
        "\tmutable bool _accessibleElementsValid = false;",
      ].join("\n"),
      "_accessibleElementsValid",
    );
  });

  await context.edit(widgetPath, (file) => {
    file.replace(originalElements, cachedElements);
    // HistoryInner is not derived from ListWidget. Its own geometry and
    // layout notifications cover slice changes and in-place visibility changes.
    file.insertAfter(
      "void HistoryInner::updateSize() {",
      "\n\tinvalidateAccessibleElements();",
      "void HistoryInner::updateSize() {\n\tinvalidateAccessibleElements();",
    );
    file.replace(
      "\t\tmarkReadMetricsStale();\n\t\tif (view->isUnderCursor()) {",
      "\t\tinvalidateAccessibleElements();\n\t\tmarkReadMetricsStale();\n\t\tif (view->isUnderCursor()) {",
    );
    file.replaceEvery(
      "const auto elements = accessibleElements();",
      "const auto &elements = accessibleElements();",
    );
    file.replace(
      [
        "void HistoryInner::viewRemoved(not_null<const Element*> view) {",
        "\tif (_overlayHost) {",
      ].join("\n"),
      [
        "void HistoryInner::viewRemoved(not_null<const Element*> view) {",
        "\tinvalidateAccessibleElements();",
        "\tif (_overlayHost) {",
      ].join("\n"),
    );
    file.replace(
      "\t_accessibilityIdentities.remove(item);",
      [
        "\t_accessibilityIdentities.remove(item);",
        "\tinvalidateAccessibleElements();",
      ].join("\n"),
    );
    file.replace(
      [
        "\t}) | rpl::on_next([=] {",
        "\t\tcheckAnnounceFirstMessages();",
        "\t}, lifetime());",
      ].join("\n"),
      [
        "\t}) | rpl::on_next([=] {",
        "\t\tcheckAnnounceFirstMessages();",
        "\t\tinvalidateAccessibleElements();",
        "\t}, lifetime());",
      ].join("\n"),
    );
    file.replace(
      [
        "\t}) | rpl::on_next([this] {",
        "\t\tmouseActionCancel();",
        "\t}, lifetime());",
      ].join("\n"),
      [
        "\t}) | rpl::on_next([this] {",
        "\t\tmouseActionCancel();",
        "\t\tinvalidateAccessibleElements();",
        "\t}, lifetime());",
      ].join("\n"),
    );
    file.replace(
      [
        "void HistoryInner::notifyMigrateUpdated() {",
        "\tconst auto migrated = _history->migrateFrom();",
        "\tif (_migrated != migrated) {",
      ].join("\n"),
      [
        "void HistoryInner::notifyMigrateUpdated() {",
        "\tconst auto migrated = _history->migrateFrom();",
        "\tif (_migrated != migrated) {",
        "\t\tinvalidateAccessibleElements();",
      ].join("\n"),
    );
  });
}
