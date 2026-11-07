// This file is part of Crossgram Desktop.
//
// End-to-end harness for the Windows injected-Unicode input fix. It drives a
// real Qt line edit with what an input tool such as WeChat voice input really
// produces: SendInput with KEYEVENTF_UNICODE, one packet per character, with a
// single missing key release in the captured place.
//
//   --control  no filter: upstream Qt's auto-repeat replay bug.
//   --shipped  a filter that swallows the packet press without translating it,
//              which is why voice input inserted nothing at all.
//   (default)  the installed patch.
//
// The characters have to be injected, not posted: the character of a
// KEYEVENTF_UNICODE keystroke lives in the system's keyboard state, and a
// posted VK_PACKET whose lParam holds a scan code translates to nothing at all.
// The window therefore has to be the foreground window; if it cannot be, the
// harness prints FOREGROUND=no and injects nothing, and the caller must skip
// instead of reading empty results as a behaviour.

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
constexpr auto kStreams = 4;

// The captured stream: 这是一个消息，这是最好的消息, with the key release
// after the comma missing.
constexpr char16_t kCaptured[] = u"\u8FD9\u662F\u4E00\u4E2A\u6D88\u606F\uFF0C\u8FD9\u662F\u6700\u597D\u7684\u6D88\u606F";
constexpr int kMissingKeyUpIndex = 6;

// 😀 U+1F600, which an injected stream carries as two packets.
constexpr char16_t kEmoji[] = { char16_t(0xD83D), char16_t(0xDE00), char16_t(0) };

constexpr auto kTypeA = WPARAM(0x41);           // 'A'
constexpr auto kTypeB = WPARAM(0x42);           // 'B'
constexpr auto kLoneTest = WPARAM(0x6D4B);      // 测
constexpr auto kLoneTry = WPARAM(0x8BD5);       // 试

HWND WindowHandle = nullptr;
QLineEdit *Input = nullptr;
int Step = 0;
bool Foreground = false;
QString Results[kStreams];

void Print(const char *text) {
	printf("%s\n", text);
	fflush(stdout);
}

void PrintResult(int index, const QString &text) {
	const auto utf8 = text.toUtf8();
	printf("RESULT%d=%s\n", index + 1, utf8.constData());
	fflush(stdout);
}

// One KEYEVENTF_UNICODE keystroke, which the system turns into a VK_PACKET
// key press (and release) on the foreground thread's queue.
void Inject(char16_t character, bool release) {
	INPUT input = {};
	input.type = INPUT_KEYBOARD;
	input.ki.wVk = 0;
	input.ki.wScan = WORD(character);
	input.ki.dwFlags = KEYEVENTF_UNICODE | (release ? KEYEVENTF_KEYUP : 0);
	SendInput(1, &input, sizeof(INPUT));
}

// Injects a whole stream, skipping exactly one key release where the capture
// had none.
void InjectStream(const char16_t *characters, int missingRelease) {
	for (auto i = 0; characters[i]; ++i) {
		Inject(characters[i], false);
		if (i != missingRelease) {
			Inject(characters[i], true);
		}
	}
}

// A character message that no key press introduced: what the patched client's
// own TranslateMessage hands to Qt.
void PostLoneChar(WPARAM character) {
	PostMessageW(WindowHandle, kWmChar, character, LPARAM(1));
}

// Mirrors an ordinary typed key: the character of such a key comes from
// TranslateMessage, so only the key press and release are posted here.
void PostTyped(WPARAM key) {
	PostMessageW(WindowHandle, kWmKeyDown, key, LPARAM(1));
	PostMessageW(
		WindowHandle,
		kWmKeyUp,
		key,
		LPARAM(1) | (LPARAM(1) << 31) | (LPARAM(1) << 30));
}

// The shipped filter: swallow the packet press and the packet release, but do
// not translate the press, so no character message is ever created.
class ShippedFilter final : public QAbstractNativeEventFilter {
public:
	bool nativeEventFilter(
			const QByteArray &eventType,
			void *message,
			qintptr *) override {
		if (eventType != QByteArrayLiteral("windows_generic_MSG")) {
			return false;
		}
		const auto msg = static_cast<MSG*>(message);
		switch (msg->message) {
		case WM_KEYDOWN:
		case WM_SYSKEYDOWN:
		case WM_KEYUP:
		case WM_SYSKEYUP:
			return (msg->wParam == kPacketVirtualKey);
		default:
			return false;
		}
	}
};

// Injected input lands on the foreground window, so the harness has to own it.
// A process launched from a background shell may not be allowed to take it
// directly; attaching to the thread that owns it and staying attached is what
// makes the transfer stick (detaching hands activation straight back).
bool AcquireForeground() {
	for (auto attempt = 0; attempt != 3; ++attempt) {
		if (GetForegroundWindow() == WindowHandle) {
			return true;
		}
		const auto owner = GetForegroundWindow();
		const auto ownerThread = owner ? GetWindowThreadProcessId(owner, nullptr) : 0;
		const auto ourThread = GetCurrentThreadId();
		if (ownerThread && ownerThread != ourThread) {
			AttachThreadInput(ownerThread, ourThread, TRUE);
		}
		SetForegroundWindow(WindowHandle);
		SetActiveWindow(WindowHandle);
		SetFocus(WindowHandle);
		Sleep(100);
	}
	return GetForegroundWindow() == WindowHandle;
}

void Record(int index) {
	Results[index] = Input->text();
	Input->clear();
}

void RunStep() {
	switch (Step++) {
	case 0:
		// Make Qt believe this window is active so that its key mapper
		// delivers key events to the focused widget.
		PostMessageW(WindowHandle, WM_ACTIVATE, WA_ACTIVE, 0);
		PostMessageW(WindowHandle, WM_SETFOCUS, 0, 0);
		Foreground = AcquireForeground();
		printf("FOREGROUND=%s\n", Foreground ? "yes" : "no");
		printf("WINDOWS our=%p foreground=%p focus=%p\n",
			static_cast<void*>(WindowHandle),
			static_cast<void*>(GetForegroundWindow()),
			static_cast<void*>(GetFocus()));
		fflush(stdout);
		break;
	case 1:
		Print(Foreground ? "injecting the captured stream" : "not foreground: injecting nothing");
		if (Foreground) {
			InjectStream(kCaptured, kMissingKeyUpIndex);
		}
		break;
	case 2:
		Record(0);
		break;
	case 3:
		if (Foreground) {
			InjectStream(kEmoji, -1);
		}
		break;
	case 4:
		Record(1);
		break;
	case 5:
		Print("posting a character without a key press");
		PostLoneChar(kLoneTest);
		PostLoneChar(kLoneTry);
		break;
	case 6:
		Record(2);
		break;
	case 7:
		Print("posting typed keys");
		PostTyped(kTypeA);
		PostTyped(kTypeB);
		break;
	case 8:
		Record(3);
		break;
	default:
		break;
	}
}

} // namespace

int main(int argc, char **argv) {
	QApplication application(argc, argv);
	auto mode = std::string("patched");
	for (auto i = 1; i != argc; ++i) {
		const auto argument = std::string(argv[i]);
		if (argument == "--control" || argument == "--shipped") {
			mode = argument.substr(2);
		}
	}
	if (mode == "shipped") {
		application.installNativeEventFilter(new ShippedFilter());
	} else if (mode == "patched") {
		Crossgram::WinUnicodeInput::Start();
	}
	printf("MODE=%s\n", mode.c_str());
	fflush(stdout);

	QWidget window;
	Input = new QLineEdit(&window);
	Input->setGeometry(10, 10, 300, 30);
	window.resize(340, 60);
	window.show();
	Input->setFocus();
	WindowHandle = reinterpret_cast<HWND>(window.winId());
	SetForegroundWindow(WindowHandle);
	SetFocus(WindowHandle);

	auto timer = QTimer();
	QObject::connect(&timer, &QTimer::timeout, [&] {
		if (Step < 9) {
			RunStep();
			return;
		}
		timer.stop();
		for (auto i = 0; i != kStreams; ++i) {
			PrintResult(i, Results[i]);
		}
		Print("DONE");
		application.quit();
	});
	timer.start(250);
	return application.exec();
}
