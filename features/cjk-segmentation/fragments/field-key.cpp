// Crossgram: moves and deletes by the words of a text that is written
// without spaces between its words, which Qt treats as one word. A step at a
// block boundary is left to Qt, so it can cross into the next block.
bool InputField::handleWordSegmentKey(QKeyEvent *e) {
	const auto deleteForward = (e == QKeySequence::DeleteEndOfWord);
	const auto deleteBackward = (e == QKeySequence::DeleteStartOfWord);
	const auto forward = deleteForward
		|| (e == QKeySequence::MoveToNextWord)
		|| (e == QKeySequence::SelectNextWord);
	const auto backward = deleteBackward
		|| (e == QKeySequence::MoveToPreviousWord)
		|| (e == QKeySequence::SelectPreviousWord);
	if (!forward && !backward) {
		return false;
	}
	const auto deleting = deleteForward || deleteBackward;
	auto cursor = textCursor();
	if (deleting && (cursor.hasSelection() || _inner->isReadOnly())) {
		// Qt deletes the selection itself and enforces read-only fields.
		return false;
	}
	const auto block = cursor.block();
	const auto text = block.text();
	const auto offset = int(cursor.position() - block.position());
	if (offset < 0
		|| offset > int(text.size())
		|| Ui::Text::WordSegment::IsRightToLeft(text)) {
		return false;
	}
	const auto moved = forward
		? Ui::Text::WordSegment::MoveForward(text, offset)
		: Ui::Text::WordSegment::MoveBackward(text, offset);
	if (moved == offset) {
		// At a block edge Qt can continue into the neighboring block.
		return false;
	}
	if (deleting) {
		// Match the edit block used by InputField's normal Backspace/Delete
		// path, so each key press is one undoable edit.
		cursor.beginEditBlock();
		cursor.setPosition(block.position() + moved, QTextCursor::KeepAnchor);
		cursor.removeSelectedText();
		cursor.endEditBlock();
	} else {
		const auto shift = e->modifiers().testFlag(Qt::ShiftModifier);
		cursor.setPosition(
			block.position() + moved,
			shift ? QTextCursor::KeepAnchor : QTextCursor::MoveAnchor);
	}
	setTextCursor(cursor);
	_inner->ensureCursorVisible();
	e->accept();
	return true;
}
