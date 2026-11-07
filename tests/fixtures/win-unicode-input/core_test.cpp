// This file is part of Crossgram Desktop.
//
// Exercises the injected-Unicode state machine with the message sequences that
// a captured WeChat voice input session produced, plus the cases that must not
// change. It is compiled against the header that the patch installs, so it also
// proves that the installed header stands on its own.
//
// The client model mirrors what the real filter does to a message loop: a
// packet press is translated (that TranslateMessage call is what makes the
// WM_CHAR exist at all) and only then swallowed, whereas the character itself
// passes through to Qt's own character path. A character that arrives without
// any press asking for a translation cannot happen in Windows, so the model
// rejects it: that is the regression that made voice input insert nothing.

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

bool Fail(const char *what) {
	printf("FAILED: %s\n", what);
	exit(1);
}

// Mirrors the client: characters that the filter passes reach Qt's own
// character path, and committed surrogate pairs reach it through an input
// method event. Both end up as inserted text.
class Client final {
public:
	void feed(Event event, char16_t value = 0) {
		apply(_state.onEvent(event, value), event, value, true);
	}

	// A character that Qt produced itself, for example from an ordinary typed
	// key: the filter never saw the press, so no filter translation is owed.
	void feedTyped(char16_t value) {
		apply(_state.onEvent(Event::Char, value), Event::Char, value, false);
	}

	[[nodiscard]] const std::u16string &delivered() const {
		return _delivered;
	}
	[[nodiscard]] int commits() const {
		return _commits;
	}
	[[nodiscard]] int translations() const {
		return _translations;
	}

private:
	void apply(
			const Crossgram::WinUnicodeInput::Reaction &reaction,
			Event event,
			char16_t value,
			bool filterTranslated) {
		if (reaction.translate) {
			++_translations;
			++_pendingCharacters;
		}
		if (reaction.commitSurrogatePair) {
			_delivered.push_back(reaction.high);
			_delivered.push_back(reaction.low);
			++_commits;
		}
		if (event == Event::Char) {
			if (filterTranslated) {
				// Windows only creates a character message for a press that was
				// translated, so a character without one means the filter
				// dropped the press instead of translating it.
				if (_pendingCharacters <= 0) {
					Fail("a character message arrived that no packet press translated");
				}
				--_pendingCharacters;
			}
			if (reaction.action == Action::Pass) {
				_delivered.push_back(value);
			}
		}
	}

	State _state;
	std::u16string _delivered;
	int _commits = 0;
	int _translations = 0;
	int _pendingCharacters = 0;

};

void dump(const std::u16string &text) {
	printf("delivered:");
	for (const auto character : text) {
		printf(" %04X", unsigned(character));
	}
	printf("\n");
}

void expect(bool condition, const char *what) {
	if (!condition) {
		Fail(what);
	}
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
		// 每一个包按下都必须先翻译，否则字符根本不会产生
		auto state = State();
		const auto press = state.onEvent(kPacketKeyDown);
		expect(press.action == Action::Swallow, "a packet press is swallowed");
		expect(press.translate, "a packet press is translated before it is swallowed");
		expect(!press.commitSurrogatePair, "a packet press commits no text by itself");
		const auto release = state.onEvent(kPacketKeyUp);
		expect(release.action == Action::Swallow, "a packet release is swallowed");
		expect(!release.translate, "a packet release needs no translation");
	}
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
		expect(client.translations() == 2, "captured stream translates both presses");
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
		// A whole dictated sentence, injected at once with a single missing
		// key release, must arrive character for character.
		constexpr char16_t kSentence[] = u"\u8FD9\u662F\u4E00\u4E2A\u6D88\u606F\uFF0C\u8FD9\u662F\u6700\u597D\u7684\u6D88\u606F";
		auto client = Client();
		auto count = 0;
		for (auto i = 0; kSentence[i]; ++i) {
			client.feed(kPacketKeyDown);
			client.feed(kChar, kSentence[i]);
			if (i != 6) { // 抬起在 ，之后漏了一个
				client.feed(kPacketKeyUp);
			}
			++count;
		}
		expectText(client, kSentence, "a dictated sentence keeps every character");
		expect(client.translations() == count, "every character of the sentence is translated");
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
		// The two halves arrive interleaved with the press and release of the
		// second packet, because the character is queued behind them.
		auto client = Client();
		client.feed(kPacketKeyDown);
		client.feed(kPacketKeyDown);
		client.feed(kPacketKeyUp);
		client.feed(kPacketKeyUp);
		client.feed(kChar, kHighSurrogate);
		client.feed(kChar, kLowSurrogate);
		expectText(client, u"\U0001F600", "surrogate pair survives a queued delay");
		expect(client.commits() == 1, "queued surrogate pair is committed once");
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
		// Ordinary typed characters never go through the packet path. They get
		// translated by Qt itself, so the filter owes no translation for them.
		auto client = Client();
		client.feedTyped(char16_t('a'));
		client.feedTyped(kThis);
		expectText(client, u"a\u8FD9", "typed characters are passed through");
	}
	{
		// Typed characters between injected ones stay in order.
		auto client = Client();
		client.feed(kPacketKeyDown);
		client.feed(kChar, kComma);
		client.feed(kPacketKeyUp);
		client.feedTyped(char16_t('a'));
		client.feed(kPacketKeyDown);
		client.feed(kChar, kThis);
		client.feed(kPacketKeyUp);
		expectText(client, u"\uFF0Ca\u8FD9", "typed and injected characters interleave");
	}
	{
		// A packet that is never followed by its character must not swallow a
		// later one.
		auto client = Client();
		client.feed(kPacketKeyDown);
		client.feed(kOther);
		client.feed(kPacketKeyDown);
		client.feed(kChar, char16_t('x'));
		expectText(client, u"x", "a press without a character does not eat the next one");
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
