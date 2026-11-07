# Windows Unicode 注入输入修复（`features/win-unicode-input`）

Windows 外部工具（如微信语音输入）用 `KEYEVENTF_UNICODE` 注入文本时，**字符并不在注入的消息里**：系统只往目标线程的队列投递一条 `VK_PACKET`（`0xE7`）的按下与抬起，字符由 `TranslateMessage` 在翻译这次按下时才投递成 `WM_CHAR`（见 MSDN `KEYBDINPUT` 的 Remarks）。Qt 的 Windows 键盘映射器（`qwindowskeymapper.cpp`）在处理按下时用 `PeekMessage` 把紧随其后的 `WM_CHAR` 取走当作这次按键的文本，并按虚拟键记录按键状态：如果注入工具漏发了某个包的抬起，下一次按下就被判成自动连发（Auto-Repeat），重放上一个字符并丢掉本次字符——例如 `这是一个消息，这是最好的消息` 变成 `这是一个消息，，是最好的消息`。

## 关键约束：吞掉按下，必须自己翻译

Qt 的事件分发器只在没有任何原生事件过滤器吞掉消息时才翻译它：

```cpp
// qtbase/src/corelib/kernel/qeventdispatcher_win.cpp
if (!filterNativeEvent(QByteArrayLiteral("windows_generic_MSG"), &msg, 0)) {
    TranslateMessage(&msg);
    DispatchMessage(&msg);
}
```

因此过滤器「吞掉 `VK_PACKET` 按下」会连带跳过 `TranslateMessage`，`WM_CHAR` 就永远不存在——只剩一个空输入框。这正是上一版补丁让微信语音输入完全打不出字的原因：把按下吞了，却没有补上那次翻译。

实测（Qt 6.12，真实 `SendInput` 注入）确认了两点，写在这里免得再被误导：

- 真注入的 `VK_PACKET` 按下，`lParam` 是 `0x00000001`，字符不在消息里；只有 `TranslateMessage` 能从系统键盘状态里把它取出来。
- 手工 `PostMessage` 一条 `WM_KEYDOWN(VK_PACKET, 1 | (ch << 16))` 之后，即使调用 `TranslateMessage` 也不会得到任何 `WM_CHAR`（因此任何用 `PostMessage` 伪造输入包的测试都测不到这个 bug）。

## 补丁行为

在 `Core::Application::run()` 中注册 Windows 原生事件过滤器（`crossgram/win_unicode_input.{h,cpp}`），对每个 `VK_PACKET` 按下做两件事：

- **先翻译**：自己调用一次 `TranslateMessage`，把携带字符的 `WM_CHAR` 投进队列；
- **再吞掉按下本身**：Qt 不会记录这次按键，自动连发与「重放上一个字符」都不会发生。

随后那个独立的 `WM_CHAR` 走 Qt 自己的字符路径（`Qt::Key_Unknown` + 文本），所以：

- 字符不会因为上一个包的文本被重放而重复，也不会因为被 `PeekMessage` 吞掉而丢失；
- 没有配对的按键抬起也不再有任何影响；
- 代理对（Surrogate Pairs）在按下路径被截断后无法再由 Qt 合并，因此由状态机显式配对并通过 `QInputMethodEvent` 提交；
- 普通物理按键、输入法（IME）候选与快捷键不受影响；非 Windows 平台为空实现。

## 测试

- `tests/fixtures/win-unicode-input/core_test.cpp`：把状态机接到一个模拟客户端上跑采集到的消息序列。模拟客户端要求「每一条字符消息都必须有某个按下请求过翻译」，因此上一版「吞掉按下却不翻译」的行为会直接判失败。
- `tests/win-unicode-input.test.ts`：检查补丁接线（CMake、`application.cpp`、幂等性、CRLF），并编译运行上面的状态机测试。
- `tests/win-unicode-input.e2e.test.ts`：用真实 Qt 驱动一个 `QLineEdit`，覆盖三种状态——上游（`这是一个消息，，是最好的消息`）、上一版补丁（一个字都没有）、本补丁（`这是一个消息，这是最好的消息`），并追加代理对（`😀`）、无按键在前的 `WM_CHAR`（`测试`）与普通按键（`ab`）。

  字符必须用 `SendInput` 真注入，不能用 `PostMessage` 伪造：`KEYEVENTF_UNICODE` 的字符存在系统键盘状态里，而一条手工投递的 `VK_PACKET` 不管 `lParam` 里放什么都不会被 `TranslateMessage` 翻出字符。因此 harness 需要成为前台窗口；拿不到前台时它打印 `FOREGROUND=no` 且不注入，测试按跳过处理。

需要 Qt 6 与 C++ 编译器，指向 Qt 安装目录后直接运行：

```bash
CROSSGRAM_QT_ROOT=/c/Qt/6.9.3/msvc2022_64 yarn test tests/win-unicode-input.e2e.test.ts
```

没有 `CROSSGRAM_QT_ROOT` 时该套件与其他需要真实上游源码或已编译客户端的套件一样跳过。
