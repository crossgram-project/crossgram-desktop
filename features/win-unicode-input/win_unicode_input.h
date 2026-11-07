// This file is part of Crossgram Desktop.

#pragma once

namespace Crossgram::WinUnicodeInput {

// 在 Windows 下接管 KEYEVENTF_UNICODE 合成的 VK_PACKET 按下：先自己翻译出 WM_CHAR，
// 再吞掉按下本身，避免 Qt 按键映射器把未释放的连续包误判为自动连发。
// 非 Windows 平台为空操作。
void Start();

} // namespace Crossgram::WinUnicodeInput
