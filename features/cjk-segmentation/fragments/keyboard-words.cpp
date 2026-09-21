		// Crossgram: the words of a text that is written without spaces
		// between its words are looked up in a dictionary, so that a step
		// over such a text lands on a word and not after a whole sentence.
		// Only the chunk around the position is read, one character per
		// position, so that the offsets stay the ones of the message.
		const auto at = [&](int symbol) {
			const auto one = view->selectedText(
				TextSelection(uint16(symbol), uint16(symbol + 1))).rich.text;

			// A part that gives no text of its own is an object in the flow.
			return one.isEmpty()
				? QChar(QChar::ObjectReplacementCharacter)
				: one[0];
		};
		const auto chunk = int(Ui::Text::WordSegment::kChunkLength);
		const auto chunkStart = (position / chunk) * chunk;
		const auto chunkEnd = std::max(chunkStart, std::min(chunkStart + chunk, maxOffset));
		auto window = QString();
		window.reserve(chunkEnd - chunkStart);
		for (auto symbol = chunkStart; symbol < chunkEnd; ++symbol) {
			window.append(at(symbol));
		}
		const auto local = position - chunkStart;
		const auto moved = forward
			? Ui::Text::WordSegment::MoveForward(window, local)
			: Ui::Text::WordSegment::MoveBackward(window, local);
		wanted = chunkStart + moved;
