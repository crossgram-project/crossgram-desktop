# Message history accessibility row cache

Telegram Desktop exposes every loaded message of the open chat as an
accessibility child and rebuilds that row list on every read: `accessibleElements()`
walks all history blocks and asks every message whether it is hidden. A screen
reader reads several properties per row and walks every row on a focus change,
while every one of those reads resolved its row by rebuilding the whole list
again. A single `QWidget::setFocus` in a long history - tens of thousands of
loaded messages - therefore cost quadratic time on the UI thread, and the client
stopped responding with a stack through `Ui::Accessible::Widget::focusChild`,
`Ui::Accessible::Item::state`, `Item::currentIndex`,
`HistoryInner::accessibilityChildIdentity`, `HistoryInner::accessibleElements`
and `Element::isHidden`.

This patch keeps the row list until something reports that it may have changed:

- `accessibleElements()` returns a reference to a cached `std::vector<Element*>`
  and only rebuilds it after an invalidation, so reading a property of a row is
  O(1) instead of O(messages). All readers inside the widget bind that reference
  instead of copying the vector;
- `invalidateAccessibleElements()` drops the cache. It is called from every
  notification that can change the rows: a new item added to the shown history,
  history unload and clear, removal of an item, destruction of any message view,
  a change of the migrated history, and `accessibilityRowsRebuilt()`, the new
  `ListWidget` hook that the base list calls at the end of `refreshRows()`.

Dropping the cache for every destroyed view is what keeps the cached raw
`HistoryView::Element*` pointers valid, because a slice update destroys and
recreates views. The `refreshRows()` hook is what covers a row set that changed
without adding or removing a view, for example when rows become hidden or visible
again in place; `ListWidget` already prunes its accessibility identities at that
exact point.

The cache lives in `HistoryInner` instead of `lib_ui`'s `Ui::Accessible::Item`
because only the widget knows when its rows changed: the library can tell that a
row moved (through the stable identity) but not whether the rows it is asked
about are still alive.

A hidden state that changes without any of those notifications keeps the previous
rows until the next one, which is the same laziness the surrounding accessibility
code already has when it repairs a cached focus index on the next key press.

## Tests

`tests/accessibility.test.ts` builds the upstream shape of all four files,
applies the patch, checks the cache, every invalidation call site and the new
hook, verifies that the patch is idempotent, keeps CRLF, applies to all four
targets, and fails loudly when upstream rewrites the list.

`tests/accessibility.e2e.test.ts` repeats that against real release sources when
`CROSSGRAM_DESKTOP_ACCESSIBILITY_SOURCE_ROOT` points at clean snapshots with one
directory per target. The `check.yml` workflow applies the whole patch set to
every supported upstream release, so a changed upstream fails the check job
instead of silently losing the cache.
