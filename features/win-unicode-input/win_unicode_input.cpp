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

// 拦截 VK_PACKET 的按下与释放事件，让随后的 WM_CHAR 走 Qt 纯字符分发路径，
// 避免输入工具连续注入未释放的 VK_PACKET 时被 Qt 误判为自动连发而吞字。
// 代理对原本由 Qt 在按键按下路径中合并，此处需手动拼接并提交。
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
	// Core::Application 重启会复用同一个 QApplication，静态守卫防止重复注册过滤器
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
