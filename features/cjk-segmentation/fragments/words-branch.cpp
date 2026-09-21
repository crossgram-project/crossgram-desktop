		} else if (selectType == TextSelectType::Words) {
			// Crossgram: one word of a text that is written without spaces
			// between its words, with the punctuation of such a text cutting
			// words apart instead of belonging to one.
			if (!WordSegment::IsSeparator(_text, from)) {
				from = uint16(WordSegment::Start(_text, from));
			}
			if (to < _text.size()) {
				if (WordSegment::IsSeparator(_text, to)) {
					++to;
				} else {
					to = uint16(WordSegment::End(_text, to));
				}
			}
		}
