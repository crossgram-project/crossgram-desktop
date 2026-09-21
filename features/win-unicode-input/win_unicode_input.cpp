// This file is part of Crossgram Desktop.

#include "crossgram/win_unicode_input.h"

#if defined(_WIN32)

#include "crossgram/win_unicode_input_core.h"

#include <QtCore/QAbstractNativeEventFilter>
#include <QtCore/QCoreApplication>
#include <QtGui/QGuiApplication>
#include <QtGui/QInputMethodEvent>

#include <windows.h>

namespace Crossgram::WinUnicodeInput {
namespace {

constexpr auto kPacketVirtualKey = WPARAM(0xE7); // VK_PACKET

// Windows reports characters injected with KEYEVENTF_UNICODE as a VK_PACKET
// key press followed by their WM_CHAR. Qt's key mapper consumes that WM_CHAR
// while handling the key press and reuses its own key record when the same
// virtual key is pressed again without an intermediate key release, so an
// input tool that does not release every injected packet (WeChat voice input
// does not, see the feature README) makes the previous character repeat and
// the new one disappear.
//
// Swallowing the VK_PACKET key press and key release leaves the character in
// the queue, where Qt dispatches it through its own character path: the same
// path Qt uses for characters that carry no usable key information. Surrogate
// pairs are combined here because Qt only combines them while reading the
// character of a key press, which this filter suppresses.
class Filter final : public QAbstractNativeEventFilter {
public:
	bool nativeEventFilter(
			const QByteArray &eventType,
			void *message,
			qintptr *result) override {
		if (eventType != QByteArrayLiteral("windows_generic_MSG")) {
			return false;
		}
		const auto msg = static_cast<MSG*>(message);
		auto event = Event::Other;
		auto value = char16_t(0);
		switch (msg->message) {
		case WM_KEYDOWN:
		case WM_SYSKEYDOWN:
			event = (msg->wParam == kPacketVirtualKey)
				? Event::PacketKeyDown
				: Event::Other;
			break;
		case WM_KEYUP:
		case WM_SYSKEYUP:
			event = (msg->wParam == kPacketVirtualKey)
				? Event::PacketKeyUp
				: Event::Other;
			break;
		case WM_CHAR:
		case WM_SYSCHAR:
			event = Event::Char;
			value = char16_t(ushort(msg->wParam));
			break;
		default:
			return false;
		}
		const auto reaction = _state.onEvent(event, value);
		if (reaction.commitSurrogatePair) {
			commitSurrogatePair(reaction.high, reaction.low);
		}
		return (reaction.action == Action::Swallow);
	}

private:
	void commitSurrogatePair(char16_t high, char16_t low) {
		const auto focus = QGuiApplication::focusObject();
		if (!focus) {
			return;
		}
		const QChar pair[2] = { QChar(high), QChar(low) };
		auto event = QInputMethodEvent();
		event.setCommitString(QString(pair, 2));
		QCoreApplication::sendEvent(focus, &event);
	}

	State _state;

};

[[nodiscard]] Filter *FilterInstance() {
	static auto filter = Filter();
	return &filter;
}

} // namespace

void Start() {
	// One filter per process: Core::Application restarts keep the same
	// QApplication, so the guard also keeps us from installing it twice.
	[[maybe_unused]] static const auto installed = [] {
		const auto application = QCoreApplication::instance();
		if (!application) {
			return false;
		}
		application->installNativeEventFilter(FilterInstance());
		return true;
	}();
}

} // namespace Crossgram::WinUnicodeInput

#else // _WIN32

namespace Crossgram::WinUnicodeInput {

void Start() {
}

} // namespace Crossgram::WinUnicodeInput

#endif // _WIN32
