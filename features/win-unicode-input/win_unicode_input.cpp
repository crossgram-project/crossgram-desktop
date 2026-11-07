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

// 拦截 VK_PACKET 的按下与释放，但先自己把按下翻译一次。
//
// 字符不在按下消息里：TranslateMessage 才会把 WM_CHAR 投进队列，而 Qt 的事件分发器
// 只在没有过滤器吞掉消息时才调用它。吞掉按下而不翻译，微信语音输入就一个字都打不出来。
// 翻译出的 WM_CHAR 随后走 Qt 的纯字符路径，因此也不再有“漏发抬起导致自动连发重放上
// 一个字符”的问题。代理对原本由 Qt 在按键按下路径中合并，此处需手动拼接并提交。
class Filter final : public QAbstractNativeEventFilter {
public:
	bool nativeEventFilter(
			const QByteArray &eventType,
			void *message,
			qintptr *) override {
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
		if (reaction.translate) {
			// 分发器不会为被过滤的消息调用 TranslateMessage，这里补上
			::TranslateMessage(msg);
		}
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
