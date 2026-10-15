# Windows Unicode 注入输入修复（`features/win-unicode-input`）

Windows 外部工具（如微信语音输入）通过 `KEYEVENTF_UNICODE` 注入文本时，系统会依次投递 `VK_PACKET` 按下消息与携带字符的 `WM_CHAR`。Qt 的 Windows 键盘映射器（`qwindowskeymapper.cpp`）按虚拟键码（`VK_PACKET`）记录按键状态：若输入工具在发送下一个字符前漏发了上一个字符的 `WM_KEYUP`，Qt 会将新到来的 `VK_PACKET` 误判为自动连发（Auto-Repeat），导致前一个字符重复出现、新字符被吞掉（例如输入 `这是一个消息，这是最好的消息` 变成 `这是一个消息，，是最好的消息`）。

## 补丁行为

在 `Core::Application::run()` 中注册 Windows 原生事件过滤器（`crossgram/win_unicode_input.{h,cpp}`）：

- 在 Qt 键盘映射器处理前拦截并丢弃 `VK_PACKET` 的按下与抬起消息，让队列中的 `WM_CHAR` 直接走 Qt 纯字符分发路径（`Qt::Key_Unknown`），不再受 `WM_KEYUP` 缺失影响，也不会误触快捷键。
- 显式配对 UTF-16 代理对（Surrogate Pairs）并通过 `QInputMethodEvent` 提交。
- 普通物理按键、输入法（IME）候选与快捷键不受影响；非 Windows 平台为空实现。
