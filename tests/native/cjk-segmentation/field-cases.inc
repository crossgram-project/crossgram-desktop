
	// These are real Windows key chords, not a direct call to MoveForward.
	// The handler under test is extracted from the generated input_field.cpp.
	{
		auto field = InputField(u"你好世界");
		auto key = QKeyEvent(Qt::Key_Delete, Qt::ControlModifier);
		CHECK(field.handleWordSegmentKey(&key) && key.accepted(), "Ctrl+Delete is handled");
		CHECK(field.value() == u"世界", "Ctrl+Delete removes only 你好");
		CHECK(field.textCursor().position() == 0 && !field.textCursor().hasSelection(), "forward deletion leaves cursor at the start");
		CHECK(field.document.editBlocksStarted == 1 && field.document.editBlocksEnded == 1, "deletion has one edit block");
		CHECK(field.document.undoEntries.size() == 1 && field.document.undoEntries[0] == u"你好世界", "the whole deletion is undoable");
		CHECK(field.inner.visibleRequests == 1, "deletion keeps the cursor visible");
		auto again = QKeyEvent(Qt::Key_Delete, Qt::ControlModifier);
		CHECK(field.handleWordSegmentKey(&again) && field.value().empty(), "repeated Ctrl+Delete removes the next word");
		CHECK(field.document.undoEntries.size() == 2 && field.document.undoEntries[1] == u"世界", "each deletion is a separate undo step");
	}
	{
		auto field = InputField(u"你好世界");
		field.setPosition(4);
		auto key = QKeyEvent(Qt::Key_Backspace, Qt::ControlModifier);
		CHECK(field.handleWordSegmentKey(&key) && key.accepted(), "Ctrl+Backspace is handled");
		CHECK(field.value() == u"你好" && field.textCursor().position() == 2, "Ctrl+Backspace removes only 世界");
		auto again = QKeyEvent(Qt::Key_Backspace, Qt::ControlModifier);
		CHECK(field.handleWordSegmentKey(&again) && field.value().empty(), "repeated Ctrl+Backspace removes the previous word");
	}
	{
		auto field = InputField(u"你好世界");
		field.setPosition(1);
		auto forward = QKeyEvent(Qt::Key_Delete, Qt::ControlModifier);
		CHECK(field.handleWordSegmentKey(&forward) && field.value() == u"你世界", "Ctrl+Delete inside a word removes only its suffix");
		field.setPosition(2);
		auto backward = QKeyEvent(Qt::Key_Backspace, Qt::ControlModifier);
		CHECK(field.handleWordSegmentKey(&backward) && field.value() == u"你界", "Ctrl+Backspace inside a word removes only its prefix");
	}
	{
		auto field = InputField(u"你好，世界 测试");
		field.setPosition(2);
		auto key = QKeyEvent(Qt::Key_Delete, Qt::ControlModifier);
		CHECK(field.handleWordSegmentKey(&key) && field.value() == u"你好 测试", "delete from punctuation skips it and removes the next word");
		auto next = QKeyEvent(Qt::Key_Delete, Qt::ControlModifier);
		CHECK(field.handleWordSegmentKey(&next) && field.value() == u"你好", "delete from a space skips it and removes the next word");
	}
	{
		auto field = InputField(u"abc你好def");
		field.setPosition(3);
		auto key = QKeyEvent(Qt::Key_Delete, Qt::ControlModifier);
		CHECK(field.handleWordSegmentKey(&key) && field.value() == u"abcdef", "word deletion respects a mixed-script boundary");
		auto next = QKeyEvent(Qt::Key_Delete, Qt::ControlModifier);
		CHECK(field.handleWordSegmentKey(&next) && field.value() == u"abc", "Latin text still deletes as a word");
	}
	{
		auto field = InputField(u"你好\n世界");
		field.setPosition(3);
		auto key = QKeyEvent(Qt::Key_Delete, Qt::ControlModifier);
		CHECK(field.handleWordSegmentKey(&key) && field.value() == u"你好\n", "deletion in a later block uses absolute cursor positions");
		CHECK(field.textCursor().position() == 3, "later-block deletion keeps its position");
		field.setPosition(2);
		auto atEnd = QKeyEvent(Qt::Key_Delete, Qt::ControlModifier);
		CHECK(!field.handleWordSegmentKey(&atEnd) && field.value() == u"你好\n", "Qt handles forward deletion across blocks");
		field.setPosition(3);
		auto atStart = QKeyEvent(Qt::Key_Backspace, Qt::ControlModifier);
		CHECK(!field.handleWordSegmentKey(&atStart) && field.value() == u"你好\n", "Qt handles backward deletion across blocks");
	}
	{
		auto field = InputField(u"你好世界");
		auto selected = field.textCursor();
		selected.setPosition(2, QTextCursor::KeepAnchor);
		field.setTextCursor(selected);
		auto forward = QKeyEvent(Qt::Key_Delete, Qt::ControlModifier);
		auto backward = QKeyEvent(Qt::Key_Backspace, Qt::ControlModifier);
		CHECK(!field.handleWordSegmentKey(&forward) && !field.handleWordSegmentKey(&backward), "Qt handles an existing selection");
		CHECK(!forward.accepted() && !backward.accepted() && field.textCursor().hasSelection(), "selection is left untouched for Qt");
		CHECK(field.value() == u"你好世界", "handler does not delete beyond a selection");
	}
	{
		auto field = InputField(u"你好世界");
		field.inner.readOnly = true;
		auto key = QKeyEvent(Qt::Key_Delete, Qt::ControlModifier);
		CHECK(!field.handleWordSegmentKey(&key) && field.value() == u"你好世界", "read-only fields remain read-only");
	}
	{
		auto field = InputField(u"مرحبا");
		auto key = QKeyEvent(Qt::Key_Delete, Qt::ControlModifier);
		CHECK(!field.handleWordSegmentKey(&key), "right-to-left text stays with Qt");
	}
	{
		auto field = InputField(u"你好世界");
		auto plain = QKeyEvent(Qt::Key_Delete, 0);
		auto shifted = QKeyEvent(Qt::Key_Delete, Qt::ControlModifier | Qt::ShiftModifier);
		CHECK(!field.handleWordSegmentKey(&plain) && !field.handleWordSegmentKey(&shifted), "only the standard word-delete shortcut is intercepted");
		auto next = QKeyEvent(Qt::Key_Right, Qt::ControlModifier);
		CHECK(field.handleWordSegmentKey(&next) && field.textCursor().position() == 2, "Ctrl+Right still moves one word");
		auto select = QKeyEvent(Qt::Key_Right, Qt::ControlModifier | Qt::ShiftModifier);
		CHECK(field.handleWordSegmentKey(&select) && field.textCursor().selectionStart() == 2 && field.textCursor().selectionEnd() == 4, "Ctrl+Shift+Right still selects one word");
		CHECK(field.value() == u"你好世界" && field.document.undoEntries.empty(), "movement and selection do not edit text");
	}
