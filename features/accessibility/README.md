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
  a change of the migrated history, and the widget's own `updateSize()` and
  `viewLayoutChanged` notifications.

Dropping the cache for every destroyed view is what keeps the cached raw
`HistoryView::Element*` pointers valid, because a slice update destroys and
recreates views. Geometry updates and view-layout notifications also cover
loaded slices and rows becoming hidden or visible in place. `HistoryInner` and
`HistoryView::ListWidget` are independent widgets; `ListWidget` is not a base
class of `HistoryInner`, so adding a virtual method there cannot provide a
`HistoryInner` override or invalidate its cache. This patch leaves `ListWidget`
unchanged.

The cache lives in `HistoryInner` instead of `lib_ui`'s `Ui::Accessible::Item`
because only the widget knows when its rows changed: the library can tell that a
row moved (through the stable identity) but not whether the rows it is asked
about are still alive.

A hidden state that changes without any of those notifications keeps the previous
rows until the next one, which is the same laziness the surrounding accessibility
code already has when it repairs a cached focus index on the next key press.

Upstream still rebuilds the row list on every read, so this cache lives in the
patcher. If an upstream ever caches the rows itself, the anchors below stop
matching and the check workflow fails loudly, and this feature can be dropped.

## Tests

`tests/accessibility.test.ts` verifies the cache and all invalidation call sites,
idempotence, CRLF preservation, and unchanged sibling-list sources. It also
compiles and executes the generated cache implementation in a C++20 harness
with the actual independent widget-base shape. This rejects invalid overrides
and checks repeated-read reuse, geometry invalidation, migrated-row ordering,
hidden rows, and removal of cached view pointers. Use `clang++` or set `CXX` to
a compatible C++ compiler.

`tests/accessibility.e2e.test.ts` repeats that against real release sources when
`CROSSGRAM_DESKTOP_ACCESSIBILITY_SOURCE_ROOT` points at clean snapshots with one
directory per target. The `check.yml` workflow applies the whole patch set to
every supported upstream release, so a changed upstream fails the check job
instead of silently losing the cache.
