# 聊天历史无障碍列表缓存（`features/accessibility`）

Telegram Desktop 将当前会话中加载的每条消息暴露为无障碍子元素（Accessibility Child），但上游 `HistoryInner::accessibleElements()` 在每次被读取时都会遍历全部历史消息块并逐条检查 `isHidden()`。当会话包含上万条消息且触发焦点切换（`QWidget::setFocus`）时，屏幕阅读器或系统无障碍组件会反复读取属性，导致 UI 线程陷入 $O(N^2)$ 卡死。

## 补丁行为

- 在 `HistoryInner` 中缓存 `std::vector<Element*>`，使单行无障碍属性读取从 $O(N)$ 降为 $O(1)$。
- 新增 `invalidateAccessibleElements()`，在所有会改变消息行或销毁视图的路径上清空缓存：新增/移除消息、卸载/清空历史、销毁任意 `HistoryView::Element`、切换迁移历史（Migrated History）以及 `updateSize()` / `viewLayoutChanged` 布局变更。

## 测试

- `tests/accessibility.test.ts`：校验补丁幂等性，并通过 C++20 编译器编译运行生成的缓存逻辑。
- `tests/accessibility.e2e.test.ts`：针对真实上游源码执行补丁校验。
