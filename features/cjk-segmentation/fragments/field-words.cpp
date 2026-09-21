// Crossgram: moves the cursor over the words of a text that is written
// without spaces between its words, which Qt moves over as one word. An event
// that does not move is left to Qt, the way it would be without this patch.
bool InputField::handleWordSegmentKey(QKeyEvent *e) {
	const auto forward = (e == QKeySequence::MoveToNextWord)
		|| (e == QKeySequence::SelectNextWord);
	const auto backward = (e == QKeySequence::MoveToPreviousWord)
		|| (e == QKeySequence::SelectPreviousWord);
	if (!forward && !backward) {
		return false;
	}
	auto cursor = textCursor();
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
		// A step at the edge of a block is Qt's, and it reaches the block
		// next to this one with it.
		return false;
	}
	const auto shift = e->modifiers().testFlag(Qt::ShiftModifier);
	cursor.setPosition(
		block.position() + moved,
		shift ? QTextCursor::KeepAnchor : QTextCursor::MoveAnchor);
	setTextCursor(cursor);
	_inner->ensureCursorVisible();
	e->accept();
	return true;
}

// Crossgram: selects the word under a double click, the way a message text
// selects it, and keeps it as the anchor of the drag that may follow, so that
// the drag grows the selection by the same words.
void InputField::mouseDoubleClickEventInner(QMouseEvent *e) {
	_inner->QTextEdit::mouseDoubleClickEvent(e);
	const auto position = _inner->cursorForPosition(e->pos()).position();
	const auto block = _inner->document()->findBlock(position);
	const auto text = block.text();
	const auto offset = int(position - block.position());
	if (offset < 0 || offset >= int(text.size())) {
		return;
	}
	const auto from = block.position() + Ui::Text::WordSegment::Start(text, offset);
	const auto to = block.position() + Ui::Text::WordSegment::End(text, offset);
	if (to <= from) {
		return;
	}
	auto probe = textCursor();
	probe.setPosition(position);
	probe.select(QTextCursor::WordUnderCursor);
	if (probe.selectionStart() == from && probe.selectionEnd() == to) {
		return;
	}
	auto cursor = textCursor();
	cursor.setPosition(from);
	cursor.setPosition(to, QTextCursor::KeepAnchor);
	setTextCursor(cursor);
	_wordSegmentDrag = cursor;
}

// Crossgram: whether the movement while the button is held grew the word a
// double click selected, in which case the selection is grown by words too.
bool InputField::applyWordSegmentDrag(QMouseEvent *e) {
	if (!_wordSegmentDrag.has_value() || !(e->buttons() & Qt::LeftButton)) {
		return false;
	}
	const auto anchor = *_wordSegmentDrag;
	const auto anchorBlock = anchor.block();
	auto cursor = _inner->cursorForPosition(e->pos());
	const auto targetBlock = cursor.block();
	auto selection = QTextCursor(_inner->document());
	if (targetBlock == anchorBlock) {
		const auto text = anchorBlock.text();
		const auto offset = int(cursor.position() - anchorBlock.position());
		auto from = offset;
		auto to = offset;
		if (offset >= 0 && offset < int(text.size())) {
			from = Ui::Text::WordSegment::Start(text, offset);
			to = Ui::Text::WordSegment::End(text, offset);
		}
		const auto first = std::min(
			int(anchor.selectionStart() - anchorBlock.position()),
			from);
		const auto last = std::max(
			int(anchor.selectionEnd() - anchorBlock.position()),
			to);
		selection.setPosition(anchorBlock.position() + first);
		selection.setPosition(
			anchorBlock.position() + last,
			QTextCursor::KeepAnchor);
	} else {
		// Away from the word a drag grows the selection by characters, the
		// way a drag that never selected a word does.
		const auto start = (cursor.position() < anchor.selectionStart())
			? anchor.selectionStart()
			: anchor.selectionEnd();
		selection.setPosition(start);
		selection.setPosition(cursor.position(), QTextCursor::KeepAnchor);
	}
	setTextCursor(selection);
	return true;
}
