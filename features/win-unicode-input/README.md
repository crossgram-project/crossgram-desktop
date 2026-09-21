# Windows injected-Unicode input

Windows sends text that a program injects with `KEYEVENTF_UNICODE` as a
`VK_PACKET` key press followed by the `WM_CHAR` message carrying that
character. Qt's Windows key mapper consumes such a `WM_CHAR` while handling the
key press and stores one key record per *virtual key*, so a second `VK_PACKET`
press that arrives before the matching key release is treated as an auto-repeat
of the previous packet (`qwindowskeymapper.cpp`):

```cpp
// No record of the key being previous pressed, so we now send a QEvent::KeyPress event,
// and store the key data into our records.
if (rec) {
    // auto-repeat: emits KeyRelease + KeyPress with rec->text
} else {
    // consumes the peeked WM_CHAR as this key press' text
}
```

Every injected packet shares the same virtual key, so as soon as one packet
misses its key release, Qt replays the *previous* character for the next packet
and throws the character that packet carried away. WeChat voice input injects
its text this way and does not always release a packet before sending the next
one, which is why the punctuation it commits appears twice while the following
word loses a character.

A message dump captured on a real client reproduces it: it holds one
`WM_KEYDOWN` / `WM_CHAR` pair per character of `这是一个消息，这是最好的消息`, all
for `VK_PACKET`, with exactly one missing `WM_KEYUP` right after `，`. The
client displayed `这是一个消息，，是最好的消息` - the comma repeated and `这`
vanished.

## What the patch does

The patch adds `crossgram/win_unicode_input.{h,cpp}` plus the dependency-free
`win_unicode_input_core.h` state machine, registers the filter from
`Core::Application::run()`, and lists the new files in `Telegram/CMakeLists.txt`.

The filter drops `VK_PACKET` key presses and key releases before Qt's key mapper
can look at them. The character then stays in the message queue and Qt
dispatches it through its own character path, the same path Qt uses for
characters that carry no usable key information, so:

- a character is never replayed on behalf of an earlier packet;
- a character is never dropped, even when its packet has no key release;
- the `WM_CHAR` whose `wParam` is zero that `TranslateMessage` posts for a
  `VK_PACKET` press no longer reaches the mapper either.

Characters also stop carrying a synthetic key code. Qt derived the key of a
packet press from the low byte of the character, so an injected `，` arrived as
`Qt::Key_Clear` and an injected ASCII letter arrived as that letter's key,
which a shortcut could match if a modifier happened to be held while the text
was injected. An injected character now reaches the client as text with
`Qt::Key_Unknown` and `isAutoRepeat()` cleared, the shape Qt gives to every
character that has no usable key information.

Surrogate pairs are combined explicitly, because Qt only combines them while
reading the character of a key press: the high half is remembered and the pair
is committed through a `QInputMethodEvent`, exactly like the Qt code path that
this filter replaces.

The filter only reacts to `VK_PACKET` messages. Typed keys, IME composition and
commit, shortcuts, and characters posted without a key press are untouched, and
no other platform compiles the filter at all (`Start()` is an empty function
outside Windows).

## Tests

`tests/win-unicode-input.test.ts` covers the patch itself (structure,
idempotency, every supported upstream) and compiles and runs
`win_unicode_input_core.h` to exercise the exact message sequences from the
capture, including the packet without a key release, surrogate pairs, and
ordinary typed characters.

`tests/win-unicode-input.e2e.test.ts` builds `tests/native/win-unicode-input`
against a real Qt and drives a `QLineEdit` with the captured message stream on
Windows: the control run reproduces the upstream duplication (`，，`) and the
patched run produces the intended text (`，这`). It needs Qt 6 and a C++
compiler, so point it at a Qt installation and run it directly:

```bash
CROSSGRAM_QT_ROOT=/c/Qt/6.9.3/msvc2022_64 yarn test tests/win-unicode-input.e2e.test.ts
```

Without `CROSSGRAM_QT_ROOT` the end-to-end suite is skipped, like the other
suites that need real upstream sources or a built client.
