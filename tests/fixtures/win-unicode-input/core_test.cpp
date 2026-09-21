// This file is part of Crossgram Desktop.
//
// Exercises the injected-Unicode state machine with the message sequences that
// a captured WeChat voice input session produced, plus the cases that must not
// change. It is compiled against the header that the patch installs, so it also
// proves that the installed header stands on its own.

#include "crossgram/win_unicode_input_core.h"

#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <string>

namespace {

using Crossgram::WinUnicodeInput::Action;
using Crossgram::WinUnicodeInput::Event;
using Crossgram::WinUnicodeInput::State;

constexpr auto kPacketKeyDown = Event::PacketKeyDown;
constexpr auto kPacketKeyUp = Event::PacketKeyUp;
constexpr auto kChar = Event::Char;
constexpr auto kOther = Event::Other;

constexpr auto kComma = char16_t(0xFF0C);       // ，
constexpr auto kThis = char16_t(0x8FD9);        // 这
constexpr auto kHighSurrogate = char16_t(0xD83D);
constexpr auto kLowSurrogate = char16_t(0xDE00);

// Mirrors the client: characters that the filter passes reach Qt's own
// character path, and committed surrogate pairs reach it through an input
// method event. Both end up as inserted text.
class Client final {
public:
	void feed(Event event, char16_t value = 0) {
		const auto reaction = _state.onEvent(event, value);
		if (reaction.commitSurrogatePair) {
			_delivered.push_back(reaction.high);
			_delivered.push_back(reaction.low);
			++_commits;
		}
		if ((reaction.action == Action::Pass) && (event == Event::Char)) {
			_delivered.push_back(value);
		}
	}

	[[nodiscard]] const std::u16string &delivered() const {
		return _delivered;
	}
	[[nodiscard]] int commits() const {
		return _commits;
	}

private:
	State _state;
	std::u16string _delivered;
	int _commits = 0;

};

void dump(const std::u16string &text) {
	printf("delivered:");
	for (const auto character : text) {
		printf(" %04X", unsigned(character));
	}
	printf("\n");
}

void expect(bool condition, const char *what) {
	if (condition) {
		return;
	}
	printf("FAILED: %s\n", what);
	exit(1);
}

void expectText(const Client &client, const char16_t *expected, const char *what) {
	if (client.delivered() != std::u16string(expected)) {
		printf("FAILED: %s\n", what);
		dump(client.delivered());
		exit(1);
	}
}

} // namespace

int main() {
	{
		// The captured session: ，has no key release, so upstream Qt
		// replays ，for the next packet and drops 这.
		auto client = Client();
		client.feed(kPacketKeyDown);
		client.feed(kChar, kComma);
		client.feed(kPacketKeyDown);
		client.feed(kChar, kThis);
		client.feed(kPacketKeyUp);
		expectText(client, u"\uFF0C\u8FD9", "captured stream keeps both characters");
		expect(client.commits() == 0, "captured stream commits no surrogate pair");
	}
	{
		// Every packet released: the original behaviour must stay.
		auto client = Client();
		client.feed(kPacketKeyDown);
		client.feed(kChar, kComma);
		client.feed(kPacketKeyUp);
		client.feed(kPacketKeyDown);
		client.feed(kChar, kThis);
		client.feed(kPacketKeyUp);
		expectText(client, u"\uFF0C\u8FD9", "released packets keep both characters");
	}
	{
		// Equal neighbours: the duplicated character is invisible upstream,
		// but the stream must still be handled per character.
		auto client = Client();
		client.feed(kPacketKeyDown);
		client.feed(kChar, kThis);
		client.feed(kPacketKeyDown);
		client.feed(kChar, kThis);
		client.feed(kPacketKeyUp);
		expectText(client, u"\u8FD9\u8FD9", "equal neighbours keep both characters");
	}
	{
		// Surrogate pairs arrive as two packets and must reach the client
		// combined, exactly like Qt's own key press path combines them.
		auto client = Client();
		client.feed(kPacketKeyDown);
		client.feed(kChar, kHighSurrogate);
		client.feed(kPacketKeyDown);
		client.feed(kChar, kLowSurrogate);
		client.feed(kPacketKeyUp);
		client.feed(kPacketKeyUp);
		expectText(client, u"\U0001F600", "surrogate pair is delivered once");
		expect(client.commits() == 1, "surrogate pair is committed once");
	}
	{
		// A high surrogate without its low half is dropped, a following
		// character still arrives.
		auto client = Client();
		client.feed(kPacketKeyDown);
		client.feed(kChar, kHighSurrogate);
		client.feed(kPacketKeyDown);
		client.feed(kChar, kThis);
		client.feed(kPacketKeyUp);
		client.feed(kPacketKeyUp);
		expectText(client, u"\u8FD9", "lone high surrogate does not eat the next character");
		expect(client.commits() == 0, "lone high surrogate is not committed");
	}
	{
		// A low surrogate without its high half is passed through.
		auto client = Client();
		client.feed(kPacketKeyDown);
		client.feed(kChar, kLowSurrogate);
		client.feed(kPacketKeyUp);
		expect(
			client.delivered() == std::u16string(1, char16_t(0xDE00)),
			"lone low surrogate is passed through");
		expect(client.commits() == 0, "lone low surrogate is not committed");
	}
	{
		// Ordinary typed characters never go through the packet path.
		auto client = Client();
		client.feed(kChar, char16_t('a'));
		client.feed(kChar, kThis);
		expectText(client, u"a\u8FD9", "typed characters are passed through");
	}
	{
		// Typed characters between injected ones stay in order.
		auto client = Client();
		client.feed(kPacketKeyDown);
		client.feed(kChar, kComma);
		client.feed(kPacketKeyUp);
		client.feed(kChar, char16_t('a'));
		client.feed(kPacketKeyDown);
		client.feed(kChar, kThis);
		client.feed(kPacketKeyUp);
		expectText(client, u"\uFF0Ca\u8FD9", "typed and injected characters interleave");
	}
	{
		// A packet that is never followed by its character must not turn the
		// next unrelated character into a packet character. Other messages
		// reset the expectation.
		auto client = Client();
		client.feed(kPacketKeyDown);
		client.feed(kOther);
		client.feed(kChar, char16_t('x'));
		expectText(client, u"x", "stale packet expectation is cleared");
	}
	{
		// The character of a packet with no key press at all is typed text.
		auto client = Client();
		client.feed(kPacketKeyUp);
		client.feed(kChar, kThis);
		expectText(client, u"\u8FD9", "character without a packet press is passed through");
	}
	{
		// Running the state twice must not leak state between streams.
		auto client = Client();
		client.feed(kPacketKeyDown);
		client.feed(kChar, kHighSurrogate);
		client.feed(kPacketKeyDown);
		client.feed(kChar, kLowSurrogate);
		client.feed(kPacketKeyDown);
		client.feed(kChar, kComma);
		client.feed(kPacketKeyUp);
		client.feed(kPacketKeyUp);
		expectText(client, u"\U0001F600\uFF0C", "surrogate pair followed by a character");
	}
	printf("win-unicode-input core checks passed\n");
	return 0;
}
