// This file is part of Crossgram Desktop.

#pragma once

#include <cstdint>

namespace Crossgram::WinUnicodeInput {

// Windows 用 KEYEVENTF_UNICODE 注入文本时只投递 VK_PACKET 的按下与抬起，字符本身并不在消息里：
// 必须把这一次按下交给 TranslateMessage，它才会把携带字符的 WM_CHAR 投进同一个队列。
// Qt 的事件分发器只在没有任何原生事件过滤器吞掉消息时才调用 TranslateMessage，
// 因此过滤器吞掉按下却又不自己翻译一次，字符就永远不会产生（微信语音输入会完全打不出字）。
//
// Qt 的键盘映射器在处理按下时用 PeekMessage 取走紧跟其后的 WM_CHAR 作为这次按键的文本，
// 并按虚拟键记录按键状态；一旦某个包漏发抬起，下一次按下就被当成自动连发，
// 重放上一个字符并丢掉本次字符（例如 `这是一个消息，，是最好的消息`）。
//
// 所以这里对每个 VK_PACKET 按下做两件事：自己翻译出 WM_CHAR，再吞掉按下本身。
// 字符随后以独立的 WM_CHAR 回到队列，走 Qt 的纯字符路径，既不复用上一个包的文本，也不会被吞。
//
// 此状态机独立于 Windows/Qt，由 win_unicode_input.cpp 把 MSG 映射为 Event 调用。
enum class Event {
	Other,
	PacketKeyDown,
	PacketKeyUp,
	Char,
};

enum class Action {
	Pass,
	Swallow,
};

struct Reaction {
	Action action = Action::Pass;

	// 调用方必须把这条消息交给 TranslateMessage，WM_CHAR 才会被投进队列
	bool translate = false;

	bool commitSurrogatePair = false;
	char16_t high = 0;
	char16_t low = 0;
};

class State final {
public:
	[[nodiscard]] Reaction onEvent(Event event, char16_t value = 0) {
		switch (event) {
		case Event::PacketKeyDown:
			// 先翻译：吞掉按下会让 Qt 跳过 TranslateMessage，字符就没了。
			// 再吞掉按下本身：不让 Qt 记录按键状态，自动连发与重放都不会发生。
			return { Action::Swallow, true };
		case Event::PacketKeyUp:
			// 按下已被拦截，对应的抬起没有记录可清，直接吞掉
			return { Action::Swallow };
		case Event::Char:
			return onChar(value);
		case Event::Other:
			break;
		}
		return { Action::Pass };
	}

private:
	[[nodiscard]] Reaction onChar(char16_t value) {
		if (value >= 0xD800 && value <= 0xDBFF) {
			// 代理对只在按键按下路径里由 Qt 合并，按下被拦后需自行暂存高代理项
			_highSurrogate = value;
			return { Action::Swallow };
		}
		if (value >= 0xDC00 && value <= 0xDFFF && _highSurrogate) {
			Reaction result;
			result.action = Action::Swallow;
			result.commitSurrogatePair = true;
			result.high = _highSurrogate;
			result.low = value;
			_highSurrogate = 0;
			return result;
		}
		// 其余字符（含普通按键产生的字符）原样交给 Qt 的字符路径
		_highSurrogate = 0;
		return { Action::Pass };
	}

	char16_t _highSurrogate = 0;
};

} // namespace Crossgram::WinUnicodeInput
