// This file is part of Crossgram Desktop.

#pragma once

namespace Crossgram::WinUnicodeInput {

// 在 Windows 下拦截 KEYEVENTF_UNICODE 合成的 VK_PACKET 按键消息，
// 防止 Qt 按键映射器将未释放的连续包误判为自动连发。非 Windows 平台为空操作。
void Start();

} // namespace Crossgram::WinUnicodeInput
