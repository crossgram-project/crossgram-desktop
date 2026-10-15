// This file is part of Crossgram Desktop.

#pragma once

#include <cstdint>

namespace Crossgram::WinUnicodeInput {

// Windows 将 KEYEVENTF_UNICODE 注入的字符拆为 VK_PACKET 按下消息与随后的 WM_CHAR。
// Qt 的 Windows 按键映射器按虚拟键记录按键状态；若连续收到两次按下而中间没有释放
//（如微信语音输入等工具不一定为每个包发送 keyup），Qt 会将其当成自动连发，
// 重放上一次记录的字符并丢弃当前字符。
//
// 此状态机独立于 Windows/Qt，由 win_unicode_input.cpp 将 MSG 映射为 Event 调用。
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
	bool commitSurrogatePair = false;
	char16_t high = 0;
	char16_t low = 0;
};

class State final {
public:
	[[nodiscard]] Reaction onEvent(Event event, char16_t value = 0) {
		switch (event) {
		case Event::PacketKeyDown:
			// 吞掉 VK_PACKET 按下事件，避免 Qt 记录按键状态；队列中的 WM_CHAR 会按纯字符路径独立分发
			_packet = true;
			return { Action::Swallow };
		case Event::PacketKeyUp:
			// 对应的按下事件已被拦截，直接吞掉释放事件
			_packet = false;
			return { Action::Swallow };
		case Event::Char:
			return onChar(value);
		case Event::Other:
			break;
		}
		// 收到其他消息说明当前包已结束
		_packet = false;
		return { Action::Pass };
	}

private:
	[[nodiscard]] Reaction onChar(char16_t value) {
		const auto packet = _packet;
		_packet = false;
		if (packet && value >= 0xD800 && value <= 0xDBFF) {
			// Qt 仅在处理按键按下时合并代理对，拦截按下后需自行暂存高代理项
			_highSurrogate = value;
			return { Action::Swallow };
		}
		if (packet && value >= 0xDC00 && value <= 0xDFFF && _highSurrogate) {
			Reaction result;
			result.action = Action::Swallow;
			result.commitSurrogatePair = true;
			result.high = _highSurrogate;
			result.low = value;
			_highSurrogate = 0;
			return result;
		}
		// 非 VK_PACKET 注入的字符（普通按键、IME 提交等）交由 Qt 默认逻辑处理
		_highSurrogate = 0;
		return { Action::Pass };
	}

	bool _packet = false;
	char16_t _highSurrogate = 0;
};

} // namespace Crossgram::WinUnicodeInput
