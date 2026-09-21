// This file is part of Crossgram Desktop.

#pragma once

namespace Crossgram::WinUnicodeInput {

// Keeps injected KEYEVENTF_UNICODE input intact on Windows by handling the
// VK_PACKET key presses that Windows synthesizes for it before Qt's Windows
// key mapper can mistake them for auto-repeats of an earlier packet.
// Does nothing on other platforms.
void Start();

} // namespace Crossgram::WinUnicodeInput
