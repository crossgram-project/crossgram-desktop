// This file is part of Crossgram Desktop.

#pragma once

#include <cstdint>

namespace Crossgram::WinUnicodeInput {

// Windows delivers text injected with KEYEVENTF_UNICODE as a VK_PACKET key
// press followed by the WM_CHAR message carrying that character. Qt's Windows
// key mapper stores one key record per virtual key and treats any repeated
// key press that has no matching key release in between as an auto-repeat:
// it replays the recorded character of the previous packet and drops the
// character of the new one. Windows input tools do not guarantee that every
// injected packet is released before the next one (see the capture in the
// feature README), so the character that follows such a packet is duplicated
// and its own character is lost.
//
// This state machine decides what to do with each native message. The glue in
// win_unicode_input.cpp maps MSG values onto these events, so the behaviour can
// be verified without Windows or Qt.
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
			// Swallow the key press so that Qt never records it. The
			// accompanying WM_CHAR stays in the queue and is dispatched on
			// its own, which is exactly how Qt handles characters that have
			// no usable key information.
			_packet = true;
			return { Action::Swallow };
		case Event::PacketKeyUp:
			// The key release only exists to close Qt's record for a key
			// press we already dropped.
			_packet = false;
			return { Action::Swallow };
		case Event::Char:
			return onChar(value);
		case Event::Other:
			break;
		}
		// Any other native message means the queue moved on.
		_packet = false;
		return { Action::Pass };
	}

private:
	[[nodiscard]] Reaction onChar(char16_t value) {
		const auto packet = _packet;
		_packet = false;
		if (packet && value >= 0xD800 && value <= 0xDBFF) {
			// Qt combines surrogate pairs itself while reading the character
			// of a key press, and that key press no longer exists, so keep
			// the high half until its low half arrives.
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
		// A character that was not injected as a packet key press (a typed
		// key, an IME commit, or a posted text message) leaves the decision
		// to Qt, exactly like a character that ends a pending pair.
		_highSurrogate = 0;
		return { Action::Pass };
	}

	bool _packet = false;
	char16_t _highSurrogate = 0;
};

} // namespace Crossgram::WinUnicodeInput
