#pragma once

// A small QTextEdit/keyboard model for executing the *patched* InputField
// handler in the same C++ harness as the real word-segmentation fragment.
// The key matches below use Qt's Windows standard shortcuts.
#include "shim.h"

#include <algorithm>
#include <string>
#include <utility>
#include <vector>

namespace Qt {
enum KeyboardModifier : int {
	ShiftModifier = 1,
	ControlModifier = 2,
	AltModifier = 4,
};
enum Key { Key_Delete, Key_Backspace, Key_Left, Key_Right };
class KeyboardModifiers {
public:
	explicit KeyboardModifiers(int value) : _value(value) {
	}
	[[nodiscard]] bool testFlag(KeyboardModifier flag) const {
		return (_value & flag) != 0;
	}
	[[nodiscard]] int value() const {
		return _value;
	}
private:
	int _value;
};
} // namespace Qt

namespace QKeySequence {
enum StandardKey {
	DeleteEndOfWord,
	DeleteStartOfWord,
	MoveToNextWord,
	MoveToPreviousWord,
	SelectNextWord,
	SelectPreviousWord,
};
} // namespace QKeySequence

class QKeyEvent {
public:
	QKeyEvent(Qt::Key key, int modifiers) : _key(key), _modifiers(modifiers) {
	}
	[[nodiscard]] bool operator==(QKeySequence::StandardKey sequence) const {
		const auto ctrl = _modifiers == Qt::ControlModifier;
		const auto select = _modifiers == (Qt::ControlModifier | Qt::ShiftModifier);
		switch (sequence) {
		case QKeySequence::DeleteEndOfWord: return ctrl && _key == Qt::Key_Delete;
		case QKeySequence::DeleteStartOfWord: return ctrl && _key == Qt::Key_Backspace;
		case QKeySequence::MoveToNextWord: return ctrl && _key == Qt::Key_Right;
		case QKeySequence::MoveToPreviousWord: return ctrl && _key == Qt::Key_Left;
		case QKeySequence::SelectNextWord: return select && _key == Qt::Key_Right;
		case QKeySequence::SelectPreviousWord: return select && _key == Qt::Key_Left;
		}
		return false;
	}
	[[nodiscard]] Qt::KeyboardModifiers modifiers() const {
		return Qt::KeyboardModifiers(_modifiers);
	}
	void accept() {
		_accepted = true;
	}
	[[nodiscard]] bool accepted() const {
		return _accepted;
	}
private:
	Qt::Key _key;
	int _modifiers;
	bool _accepted = false;
};

[[nodiscard]] inline bool operator==(const QKeyEvent *event, QKeySequence::StandardKey sequence) {
	return *event == sequence;
}

struct TestDocument {
	explicit TestDocument(std::u16string value) : value(std::move(value)) {
	}
	std::u16string value;
	std::u16string beforeEdit;
	std::vector<std::u16string> undoEntries;
	int editBlocksStarted = 0;
	int editBlocksEnded = 0;
};

class QTextBlock {
public:
	QTextBlock(TestDocument *document, int from, int to)
	: _document(document), _from(from), _to(to) {
	}
	[[nodiscard]] int position() const {
		return _from;
	}
	[[nodiscard]] QString text() const {
		auto result = std::vector<QChar>();
		for (auto at = _from; at < _to; ++at) {
			result.emplace_back(_document->value[at]);
		}
		return QString(result);
	}
private:
	TestDocument *_document;
	int _from;
	int _to;
};

class QTextCursor {
public:
	enum MoveMode { MoveAnchor, KeepAnchor };
	explicit QTextCursor(TestDocument *document) : _document(document) {
	}
	[[nodiscard]] int position() const {
		return _position;
	}
	[[nodiscard]] int anchor() const {
		return _anchor;
	}
	[[nodiscard]] bool hasSelection() const {
		return _position != _anchor;
	}
	[[nodiscard]] int selectionStart() const {
		return std::min(_position, _anchor);
	}
	[[nodiscard]] int selectionEnd() const {
		return std::max(_position, _anchor);
	}
	[[nodiscard]] QTextBlock block() const {
		const auto size = int(_document->value.size());
		auto from = 0;
		for (auto at = 0; at < _position; ++at) {
			if (_document->value[at] == u'\n') from = at + 1;
		}
		auto to = from;
		while (to < size && _document->value[to] != u'\n') ++to;
		return QTextBlock(_document, from, to);
	}
	void setPosition(int position, MoveMode mode = MoveAnchor) {
		_position = std::clamp(position, 0, int(_document->value.size()));
		if (mode == MoveAnchor) _anchor = _position;
	}
	void beginEditBlock() {
		_document->beforeEdit = _document->value;
		++_document->editBlocksStarted;
	}
	void removeSelectedText() {
		if (!hasSelection()) return;
		const auto from = selectionStart();
		_document->value.erase(from, selectionEnd() - from);
		_position = _anchor = from;
	}
	void endEditBlock() {
		if (_document->beforeEdit != _document->value) {
			_document->undoEntries.push_back(_document->beforeEdit);
		}
		++_document->editBlocksEnded;
	}
private:
	TestDocument *_document;
	int _position = 0;
	int _anchor = 0;
};

struct TestInner {
	bool readOnly = false;
	int visibleRequests = 0;
	[[nodiscard]] bool isReadOnly() const {
		return readOnly;
	}
	void ensureCursorVisible() {
		++visibleRequests;
	}
};

class InputField {
public:
	explicit InputField(std::u16string value)
	: document(std::move(value)), _inner(&inner), _cursor(&document) {
	}
	[[nodiscard]] QTextCursor textCursor() const {
		return _cursor;
	}
	void setTextCursor(const QTextCursor &cursor) {
		_cursor = cursor;
	}
	void setPosition(int position) {
		_cursor.setPosition(position);
	}
	[[nodiscard]] std::u16string value() const {
		return document.value;
	}
	bool handleWordSegmentKey(QKeyEvent *event);

	TestDocument document;
	TestInner inner;
	TestInner *_inner;
private:
	QTextCursor _cursor;
};
