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
