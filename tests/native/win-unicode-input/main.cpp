// This file is part of Crossgram Desktop.
//
// End-to-end harness for the Windows injected-Unicode input fix. It drives a
// real Qt line edit with the exact message stream that WeChat voice input
// produced in the captured dump: two VK_PACKET key presses whose packets share
// a single key release. Qt's key mapper treats the second press as an
// auto-repeat of the first packet, so the control run duplicates the first
// character and loses the second one; the patched run must keep both.
//
// Build it with tests/native/win-unicode-input/CMakeLists.txt and run it with
// and without --control.

#include "crossgram/win_unicode_input.h"

#include <QtCore/QAbstractNativeEventFilter>
#include <QtCore/QTimer>
#include <QtWidgets/QApplication>
#include <QtWidgets/QLineEdit>
#include <QtWidgets/QWidget>

#include <cstdio>
#include <string>

#include <windows.h>

namespace {

constexpr auto kWmKeyDown = UINT(0x0100);
constexpr auto kWmKeyUp = UINT(0x0101);
constexpr auto kWmChar = UINT(0x0102);
constexpr auto kPacketVirtualKey = WPARAM(0xE7); // VK_PACKET

constexpr auto kComma = char16_t(0xFF0C);   // ，
constexpr auto kThis = char16_t(0x8FD9);    // 这
constexpr auto kHighSurrogate = char16_t(0xD83D);
constexpr auto kLowSurrogate = char16_t(0xDE00);

constexpr auto kTypeA = WPARAM(0x41);       // 'A'
constexpr auto kTypeB = WPARAM(0x42);       // 'B'

HWND WindowHandle = nullptr;
QLineEdit *Input = nullptr;
int Step = 0;
QString Results[3];

void Print(const char *text) {
	printf("%s\n", text);
	fflush(stdout);
}

void PrintResult(int index, const QString &text) {
	const auto utf8 = text.toUtf8();
	printf("RESULT%d=%s\n", index + 1, utf8.constData());
	fflush(stdout);
}

// Mirrors what the system posts for one KEYEVENTF_UNICODE keystroke.
void PostPacket(char16_t character, bool release) {
	const auto lParam = release
		? LPARAM(1) | (LPARAM(1) << 31) | (LPARAM(1) << 30)
		: LPARAM(1);
	PostMessageW(
		WindowHandle,
		release ? kWmKeyUp : kWmKeyDown,
		kPacketVirtualKey,
		lParam);
	if (!release) {
		PostMessageW(WindowHandle, kWmChar, WPARAM(character), lParam);
	}
}

// Mirrors an ordinary typed key: the character of such a key is produced by
// TranslateMessage, so only the key press and release are posted here.
void PostTyped(WPARAM key) {
	PostMessageW(WindowHandle, kWmKeyDown, key, LPARAM(1));
	PostMessageW(
		WindowHandle,
		kWmKeyUp,
		key,
		LPARAM(1) | (LPARAM(1) << 31) | (LPARAM(1) << 30));
}

void Record() {
	const auto index = Step / 2 - 1;
	if (index >= 0 && index < 3) {
		Results[index] = Input->text();
		Input->clear();
	}
}

void RunStep() {
	switch (Step++) {
	case 0:
		// Make Qt believe this window is active so that its key mapper
		// delivers key events to the focused widget.
		PostMessageW(WindowHandle, WM_ACTIVATE, WA_ACTIVE, 0);
		PostMessageW(WindowHandle, WM_SETFOCUS, 0, 0);
		break;
	case 1:
		// The captured stream: ，(press, no release) 这 (press, release).
		Print("posting captured packet stream");
		PostPacket(kComma, false);
		PostPacket(kThis, false);
		PostPacket(kThis, true);
		break;
	case 2:
		Record();
		break;
	case 3:
		Print("posting surrogate pair");
		PostPacket(kHighSurrogate, false);
		PostPacket(kLowSurrogate, false);
		PostPacket(kLowSurrogate, true);
		break;
	case 4:
		Record();
		break;
	case 5:
		Print("posting typed keys");
		PostTyped(kTypeA);
		PostTyped(kTypeB);
		break;
	case 6:
		Record();
		break;
	default:
		break;
	}
}

} // namespace

int main(int argc, char **argv) {
	QApplication application(argc, argv);
	auto control = false;
	for (auto i = 1; i != argc; ++i) {
		if (std::string(argv[i]) == "--control") {
			control = true;
		}
	}
	if (!control) {
		Crossgram::WinUnicodeInput::Start();
	}
	Print(control ? "MODE=control" : "MODE=patched");

	QWidget window;
	Input = new QLineEdit(&window);
	Input->setGeometry(10, 10, 300, 30);
	window.resize(340, 60);
	window.show();
	Input->setFocus();
	WindowHandle = reinterpret_cast<HWND>(window.winId());

	auto timer = QTimer();
	QObject::connect(&timer, &QTimer::timeout, [&] {
		if (Step < 7) {
			RunStep();
			return;
		}
		timer.stop();
		PrintResult(0, Results[0]);
		PrintResult(1, Results[1]);
		PrintResult(2, Results[2]);
		Print("DONE");
		application.quit();
	});
	timer.start(250);
	return application.exec();
}
