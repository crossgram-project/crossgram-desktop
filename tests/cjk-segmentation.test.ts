import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { inflateSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { patchCjkSegmentation } from "../features/cjk-segmentation/patch.js";
import { targets, targetById } from "../src/targets.js";

const roots: string[] = [];
afterEach(async () => {
	// Kept for looking at the generated harness when it has to be debugged.
	if (process.env.CROSSGRAM_KEEP_FIXTURES) return;
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const featureRoot = path.resolve("features/cjk-segmentation");

// The two shapes of the code this patch replaces, the older one and the one of
// the newest upstream. The fixtures below hold one of them each.
const wordsBranchOld = [
	"\t\t} else if (selectType == TextSelectType::Words) {",
	"\t\t\tif (!IsWordSeparator(_text.at(from))) {",
	"\t\t\t\twhile (from > 0 && !IsWordSeparator(_text.at(from - 1))) {",
	"\t\t\t\t\t--from;",
	"\t\t\t\t}",
	"\t\t\t}",
	"\t\t\tif (to < _text.size()) {",
	"\t\t\t\tif (IsWordSeparator(_text.at(to))) {",
	"\t\t\t\t\t++to;",
	"\t\t\t\t} else {",
	"\t\t\t\t\twhile (to < _text.size() && !IsWordSeparator(_text.at(to))) {",
	"\t\t\t\t\t\t++to;",
	"\t\t\t\t\t}",
	"\t\t\t\t}",
	"\t\t\t}",
	"\t\t}",
].join("\n");

const wordsBranchNew = wordsBranchOld
	.replaceAll("IsWordSeparator(_text.at(from - 1))", "IsWordSeparator(_text, from - 1)")
	.replaceAll("IsWordSeparator(_text.at(from))", "IsWordSeparator(_text, from)")
	.replaceAll("IsWordSeparator(_text.at(to))", "IsWordSeparator(_text, to)");

const keyboardOld = [
	"\t\tconst auto separator = [&](int symbol) {",
	"\t\t\tconst auto one = view->selectedText(",
	"\t\t\t\tTextSelection(uint16(symbol), uint16(symbol + 1))).rich.text;",
	"\t\t\treturn one.isEmpty() || Ui::Text::IsWordSeparator(one[0]);",
	"\t\t};",
	"\t\tauto symbol = position;",
	"\t\tif (forward) {",
	"\t\t\twhile (symbol < maxOffset && separator(symbol)) {",
	"\t\t\t\t++symbol;",
	"\t\t\t}",
	"\t\t\twhile (symbol < maxOffset && !separator(symbol)) {",
	"\t\t\t\t++symbol;",
	"\t\t\t}",
	"\t\t} else {",
	"\t\t\tif (symbol > 0) {",
	"\t\t\t\t--symbol;",
	"\t\t\t}",
	"\t\t\twhile (symbol > 0 && separator(symbol)) {",
	"\t\t\t\t--symbol;",
	"\t\t\t}",
	"\t\t\twhile (symbol > 0 && !separator(symbol - 1)) {",
	"\t\t\t\t--symbol;",
	"\t\t\t}",
	"\t\t}",
	"\t\twanted = symbol;",
].join("\n");

const keyboardNew = [
	"\t\tconst auto at = [&](int symbol) {",
	"\t\t\tconst auto one = view->selectedText(",
	"\t\t\t\tTextSelection(uint16(symbol), uint16(symbol + 1))).rich.text;",
	"",
	"\t\t\t// A part that gives no text of its own is an object in the flow.",
	"\t\t\treturn one.isEmpty()",
	"\t\t\t\t? QChar(QChar::ObjectReplacementCharacter)",
	"\t\t\t\t: one[0];",
	"\t\t};",
	"\t\tconst auto separator = [&](int symbol) {",
	"\t\t\treturn Ui::Text::IsWordSeparator(at, maxOffset, symbol);",
	"\t\t};",
...keyboardOld.split("\n").slice(5),
].join("\n");

const headerSource = [
	"#pragma once",
	"",
	"namespace Ui::Text {",
	"",
	"[[nodiscard]] bool IsBad(QChar ch);",
	"[[nodiscard]] bool IsWordSeparator(QChar ch);",
	"[[nodiscard]] bool IsAlmostLinkEnd(QChar ch);",
	"[[nodiscard]] bool IsLinkEnd(QChar ch);",
	"} // namespace Ui::Text",
	"",
		"",
	"",
].join("\n");

const textSource = (wordsBranch: string) => [
	"#include \"ui/text/text.h\"",
	"",
	"#include <QtGui/QGuiApplication>",
	"",
	"#include <algorithm>",
	"",
	"namespace Ui::Text {",
	"",
	"TextSelection String::adjustSelection(",
	"		TextSelection selection,",
	"		TextSelectType selectType) const {",
	"	uint16 from = selection.from, to = selection.to;",
	"	if (from < _text.size() && from <= to) {",
	"		if (to > _text.size()) to = _text.size();",
	"		if (selectType == TextSelectType::Paragraphs) {",
	"			++from;",
	"			++to;",
wordsBranch,
	"	}",
	"	return { from, to };",
	"}",
	"",
	"} // namespace Ui::Text",
	"",
].join("\n");

const fieldHeaderSource = [
	"#pragma once",
	"",
	"namespace Ui {",
	"",
	"class InputField {",
	"	void mouseMoveEventInner(QMouseEvent *e);",
	"	void leaveEventInner(QEvent *e);",
	"	bool revertFormatReplace();",
	"	bool jumpOutOfBlockByBackspace();",
	"",
	"	std::optional<QTextCursor> _formattingCursorUpdate;",
	"	std::optional<QTextCursor> _formattingCursor;",
	"",
	"};",
	"",
	"} // namespace Ui",
	"",
].join("\n");

const fieldSource = [
	"#include \"ui/widgets/fields/input_field.h\"",
	"",
	"class InputField::Inner final : public QTextEdit {",
	"protected:",
	"	void mousePressEvent(QMouseEvent *e) override {",
	"		return outer()->mousePressEventInner(e);",
	"	}",
	"	void mouseReleaseEvent(QMouseEvent *e) override {",
	"		return outer()->mouseReleaseEventInner(e);",
	"	}",
	"	void mouseMoveEvent(QMouseEvent *e) override {",
	"		return outer()->mouseMoveEventInner(e);",
	"	}",
	"};",
	"",
	"void InputField::mousePressEventInner(QMouseEvent *e) {",
	"	_inner->QTextEdit::mousePressEvent(e);",
	"}",
	"",
	"void InputField::mouseReleaseEventInner(QMouseEvent *e) {",
	"	_selectedActionQuoteId = lookupActionQuoteId(e->pos());",
	"	const auto taken = std::exchange(_pressedActionQuoteId, -1);",
	"	if (taken > 0 && taken == _selectedActionQuoteId) {",
	"		blockActionClicked(taken);",
	"	}",
	"	updateCursorShape();",
	"	_inner->QTextEdit::mouseReleaseEvent(e);",
	"}",
	"",
	"void InputField::mouseMoveEventInner(QMouseEvent *e) {",
	"	_selectedActionQuoteId = lookupActionQuoteId(e->pos());",
	"	updateCursorShape();",
	"	_inner->QTextEdit::mouseMoveEvent(e);",
	"}",
	"",
	"void InputField::keyPressEventInner(QKeyEvent *e) {",
	"	const auto key = e->key();",
	"	const auto enter = (key == Qt::Key_Enter || key == Qt::Key_Return);",
	"	if (enter) {",
	"		_submits.fire(e->modifiers());",
	"#ifdef Q_OS_MAC",
	"	} else if (key == Qt::Key_E && e->modifiers().testFlag(Qt::ControlModifier)) {",
	"		copyToFindBuffer();",
	"#endif // Q_OS_MAC",
	"	} else {",
	"		const auto text = e->text();",
	"		auto cursor = textCursor();",
	"		const auto oldPosition = cursor.position();",
	"		_inner->QTextEdit::keyPressEvent(e);",
	"	}",
	"}",
	"",
].join("\n");

const keyboardSource = (keyboardBranch: string) => [
	"#include \"history/view/history_view_keyboard_text_selection.h\"",
	"",
	"namespace HistoryView {",
	"",
	"std::optional<MessageSelection> KeyboardTextSelection::extend(",
	"		not_null<Element*> view,",
	"		const MessageSelection &current,",
	"		int key,",
	"		Qt::KeyboardModifiers modifiers) {",
	"	const auto maxOffset = 100;",
	"	const auto position = int(_focus.offset());",
	"	const auto forward = (key == Qt::Key_Right);",
	"	const auto byWord = true;",
	"	auto wanted = position;",
	"	if (key == Qt::Key_Home) {",
	"		wanted = 0;",
	"	} else if (key == Qt::Key_End) {",
	"		wanted = maxOffset;",
	"	} else if (byWord) {",
keyboardBranch,
	"	} else {",
	"		wanted = position + (forward ? 1 : -1);",
	"	}",
	"	_focus = { uint16(std::clamp(wanted, 0, maxOffset)), false };",
	"	return std::nullopt;",
	"}",
	"",
	"} // namespace HistoryView",
	"",
].join("\n");

interface Fixture {
	readonly header: string;
	readonly text: string;
	readonly fieldHeader: string;
	readonly field: string;
	readonly keyboard: string;
}

async function fixture(
	shape: "old" | "new" = "old",
	eol = "\n",
): Promise<{ root: string; patched: () => Promise<Fixture> }> {
	const temporaryRoot = path.resolve("../work/tests/cjk-segmentation-unit");
	await mkdir(temporaryRoot, { recursive: true });
	const root = await mkdtemp(path.join(temporaryRoot, "fixture-"));
	roots.push(root);
	const write = async (relative: string, value: string) => {
		const destination = path.join(root, relative);
		await mkdir(path.dirname(destination), { recursive: true });
		await writeFile(destination, value.replaceAll("\n", eol), "utf8");
	};
	await write("Telegram/lib_ui/ui/text/text.h", headerSource);
	await write(
		"Telegram/lib_ui/ui/text/text.cpp",
		textSource(shape === "old" ? wordsBranchOld : wordsBranchNew));
	await write("Telegram/lib_ui/ui/widgets/fields/input_field.h", fieldHeaderSource);
	await write("Telegram/lib_ui/ui/widgets/fields/input_field.cpp", fieldSource);
	await write(
		"Telegram/SourceFiles/history/view/history_view_keyboard_text_selection.cpp",
		keyboardSource(shape === "old" ? keyboardOld : keyboardNew));
	const patched = async (): Promise<Fixture> => ({
		header: await readFile(path.join(root, "Telegram/lib_ui/ui/text/text.h"), "utf8"),
		text: await readFile(path.join(root, "Telegram/lib_ui/ui/text/text.cpp"), "utf8"),
		fieldHeader: await readFile(
			path.join(root, "Telegram/lib_ui/ui/widgets/fields/input_field.h"), "utf8"),
		field: await readFile(
			path.join(root, "Telegram/lib_ui/ui/widgets/fields/input_field.cpp"), "utf8"),
		keyboard: await readFile(
			path.join(root, "Telegram/SourceFiles/history/view/history_view_keyboard_text_selection.cpp"),
			"utf8"),
	});
	return { root, patched };
}

function balancedBraces(source: string): boolean {
	return (source.match(/{/g) ?? []).length === (source.match(/}/g) ?? []).length;
}

function definition(source: string, signature: string): string {
	const start = source.indexOf(signature + " {");
	if (start < 0) throw new Error("Missing function: " + signature);
	const body = source.indexOf("{", start + signature.length);
	let depth = 0;
	for (let index = body; index < source.length; ++index) {
		if (source[index] === "{") ++depth;
		else if (source[index] === "}" && --depth === 0) {
			return source.slice(start, index + 1);
		}
	}
	throw new Error("Unclosed function: " + signature);
}

describe("desktop CJK word segmentation patch", () => {
	it("splits the message text selection into words and is idempotent", async () => {
		const { root, patched } = await fixture();
		const options = { root, target: targetById("tdesktop"), featureRoot };
		await patchCjkSegmentation(options);
		const first = await patched();

		expect(first.text).toContain("if (!WordSegment::IsSeparator(_text, from)) {");
		expect(first.text).toContain("from = uint16(WordSegment::Start(_text, from));");
		expect(first.text).toContain("to = uint16(WordSegment::End(_text, to));");
		expect(first.text).toContain("#include \"ui/text/text_crossgram.inc\"");
		expect(first.text).not.toContain("IsWordSeparator(_text.at(from))");

		expect(first.header).toContain("namespace WordSegment {");
		expect(first.header).toContain("inline constexpr auto kChunkLength = 64;");
		expect(first.header).toContain("[[nodiscard]] bool IsSeparator(const QString &text, int position);");
		expect(first.header).toContain("} // namespace WordSegment");
		expect(first.header.indexOf("namespace WordSegment {"))
			.toBeLessThan(first.header.indexOf("[[nodiscard]] bool IsAlmostLinkEnd"));

		expect(first.fieldHeader).toContain("void mouseDoubleClickEventInner(QMouseEvent *e);");
		expect(first.fieldHeader).toContain("bool handleWordSegmentKey(QKeyEvent *e);");
		expect(first.fieldHeader).toContain("bool applyWordSegmentDrag(QMouseEvent *e);");
		expect(first.fieldHeader).toContain("std::optional<QTextCursor> _wordSegmentDrag;");

		expect(first.field).toContain("void mouseDoubleClickEvent(QMouseEvent *e) override {");
		expect(first.field).toContain("if (applyWordSegmentDrag(e)) {");
		// The replaced handler and the new functions have to keep their places:
		// one inside the handler, the others after it, or the compiler reads
		// the new functions as local ones of the handler.
		expect(first.field).toContain([
			"void InputField::mouseMoveEventInner(QMouseEvent *e) {",
			"\t_selectedActionQuoteId = lookupActionQuoteId(e->pos());",
			"\tupdateCursorShape();",
			"\tif (applyWordSegmentDrag(e)) {",
			"\t\treturn;",
			"\t}",
			"\t_inner->QTextEdit::mouseMoveEvent(e);",
			"}",
			"",
			"// Crossgram: moves and deletes by the words of a text that is written",
			"// without spaces between its words, which Qt treats as one word. A step at a",
			"// block boundary is left to Qt, so it can cross into the next block.",
			"bool InputField::handleWordSegmentKey(QKeyEvent *e) {",
		].join("\n"));
		expect(first.field).toContain([
			"\t} else if (handleWordSegmentKey(e)) {",
			"\t\t// Crossgram: the word key was handled above.",
			"\t} else {",
			"\t\tconst auto text = e->text();",
		].join("\n"));
		expect(first.field).toContain("_wordSegmentDrag = std::nullopt;");
		expect(first.field).toContain("} else if (handleWordSegmentKey(e)) {");
		expect(first.field).toContain("bool InputField::handleWordSegmentKey(QKeyEvent *e) {");
		expect(first.field).toContain("e == QKeySequence::DeleteEndOfWord");
		expect(first.field).toContain("e == QKeySequence::DeleteStartOfWord");
		expect(first.field).toContain("cursor.hasSelection() || _inner->isReadOnly()");
		expect(first.field).toContain("cursor.removeSelectedText();");
		expect(first.field).toContain("cursor.beginEditBlock();");
		expect(first.field).toContain("cursor.endEditBlock();");
		expect(first.field).toContain("bool InputField::applyWordSegmentDrag(QMouseEvent *e) {");
		expect(first.field).toContain("void InputField::mouseDoubleClickEventInner(QMouseEvent *e) {");

		expect(first.keyboard).toContain("Ui::Text::WordSegment::MoveForward(window, local)");
		expect(first.keyboard).toContain("Ui::Text::WordSegment::MoveBackward(window, local)");
		expect(first.keyboard).toContain("wanted = chunkStart + moved;");
		expect(first.keyboard).not.toContain("IsWordSeparator(one[0])");

		for (const source of Object.values(first)) {
			expect(balancedBraces(source)).toBe(true);
		}

		const included = await readFile(
			path.join(root, "Telegram/lib_ui/ui/text/text_crossgram.inc"), "utf8");
		expect(included).toContain("namespace Ui::Text::WordSegment {");
		expect(included).toContain("#include \"ui/text/text_crossgram_words.inc\"");
		const generated = await readFile(
			path.join(root, "Telegram/lib_ui/ui/text/text_crossgram_words.inc"), "utf8");
		expect(generated).toContain("static constexpr auto kCrossgramWordsVersion = 1;");
		expect(generated).toContain("static QByteArray CrossgramWordsPayload() {");

		await patchCjkSegmentation(options);
		expect(await patched()).toEqual(first);
	});

	it("upgrades a checkout patched before word deletion was added", async () => {
		const { root, patched } = await fixture();
		const options = { root, target: targetById("tdesktop"), featureRoot };
		await patchCjkSegmentation(options);
		const relative = "Telegram/lib_ui/ui/widgets/fields/input_field.cpp";
		const sourcePath = path.join(root, relative);
		const current = await readFile(sourcePath, "utf8");
		const signature = "bool InputField::handleWordSegmentKey(QKeyEvent *e)";
		const previous = definition(current, signature);
		const movementOnly = [
			"bool InputField::handleWordSegmentKey(QKeyEvent *e) {",
			"	const auto forward = (e == QKeySequence::MoveToNextWord);",
			"	return forward;",
			"}",
		].join("\n");
		await writeFile(sourcePath, current.replace(previous, movementOnly), "utf8");
		await patchCjkSegmentation(options);
		const upgraded = await readFile(sourcePath, "utf8");
		expect(definition(upgraded, signature)).toBe(previous);
		expect(upgraded).toBe(current);
		expect(upgraded.match(/bool InputField::handleWordSegmentKey/g)).toHaveLength(1);
		expect((await patched()).field).toContain("QKeySequence::DeleteEndOfWord");
		await patchCjkSegmentation(options);
		expect(await readFile(sourcePath, "utf8")).toBe(upgraded);
	});

	it("patches the shape of the newest upstream", async () => {
		const { root, patched } = await fixture("new");
		await patchCjkSegmentation({ root, target: targetById("tdesktop"), featureRoot });
		const patchedSources = await patched();
		expect(patchedSources.text).toContain("WordSegment::IsSeparator(_text, from)");
		expect(patchedSources.keyboard).toContain("WordSegment::MoveForward(window, local)");
		for (const source of Object.values(patchedSources)) {
			expect(balancedBraces(source)).toBe(true);
		}
	});

	it.each(targets.map((target) => target.id))("patches %s sources", async (id) => {
		const { root, patched } = await fixture();
		await patchCjkSegmentation({ root, target: targetById(id), featureRoot });
		expect((await patched()).text).toContain("WordSegment::IsSeparator(_text, from)");
	});

	it("preserves CRLF sources", async () => {
		const { root, patched } = await fixture("old", "\r\n");
		await patchCjkSegmentation({ root, target: targetById("ayugram"), featureRoot });
		for (const source of Object.values(await patched())) {
			expect(source.replaceAll("\r\n", "")).not.toContain("\n");
		}
	});

	it("fails loudly when upstream rewrites the branch it replaces", async () => {
		const { root } = await fixture();
		const source = path.join(root, "Telegram/lib_ui/ui/text/text.cpp");
		const text = await readFile(source, "utf8");
		await writeFile(source, text.replace(
			"} else if (selectType == TextSelectType::Words) {",
			"} else if (selectType == TextSelectType::Words && true) {"), "utf8");
		await expect(patchCjkSegmentation({
			root, target: targetById("ayugram"), featureRoot,
		})).rejects.toThrow(/Could not find/);
	});
});

describe("shipped word list", () => {
	it("holds together and is what the patcher packs", async () => {
		const data = await readFile(path.join(featureRoot, "data/words.bin"));
		const payload = inflateSync(data.subarray(4));
		expect(payload.length).toBe(data.readUInt32BE(0));
		const version = payload.readUInt32LE(0);
		const count = payload.readUInt32LE(4);
		const maxUnits = payload.readUInt32LE(8);
		expect(version).toBe(1);
		expect(count).toBeGreaterThan(50000);
		expect(maxUnits).toBe(15);
		const offsets = (count + 1) * 4;
		const wordsAt = 16 + offsets + count * 2;
		expect(payload.readUInt32LE(12 + offsets)).toBe(payload.length - wordsAt);
		let previous = "";
		for (let index = 0; index !== count; index += 1) {
			const from = payload.readUInt32LE(16 + index * 4);
			const to = payload.readUInt32LE(16 + index * 4 + 4);
			expect(to).toBeGreaterThan(from);
			const word = payload.subarray(wordsAt + from, wordsAt + to).toString("utf8");
			expect(word.length).toBeLessThanOrEqual(maxUnits);
			expect(Buffer.compare(Buffer.from(previous, "utf8"), Buffer.from(word, "utf8")))
				.toBeLessThan(0);
			expect(payload.readInt16LE(16 + offsets + index * 2)).toBeLessThan(0);
			previous = word;
		}
		// The words the patcher added itself, and one that only the list knows.
		const has = (word: string) => {
			let from = 0;
			let till = count;
			const wanted = Buffer.from(word, "utf8");
			while (from < till) {
				const middle = from + Math.floor((till - from) / 2);
				const start = payload.readUInt32LE(16 + middle * 4);
				const end = payload.readUInt32LE(16 + middle * 4 + 4);
				const compare = Buffer.compare(payload.subarray(wordsAt + start, wordsAt + end), wanted);
				if (!compare) return true;
				if (compare < 0) from = middle + 1;
				else till = middle;
			}
			return false;
		};
		for (const word of ["微信", "双击", "分词", "表情包", "訊息", "螢幕"]) {
			expect(has(word), word).toBe(true);
		}
	});

	it("is packed into the generated source byte for byte", async () => {
		const { root } = await fixture();
		await patchCjkSegmentation({ root, target: targetById("tdesktop"), featureRoot });
		const generated = await readFile(
			path.join(root, "Telegram/lib_ui/ui/text/text_crossgram_words.inc"), "utf8");
		const packed = [...generated.matchAll(/"([A-Za-z0-9+/]*)"/g)]
			.map((match) => match[1]).join("");
		const data = await readFile(path.join(featureRoot, "data/words.bin"));
		expect(Buffer.from(packed, "base64").equals(data)).toBe(true);
		for (const line of generated.split("\n")) {
			expect(line.length).toBeLessThan(65000);
		}
	});
});

// The word list of the harness, as the generator would have packed it.
function buildPayload(entries: readonly (readonly [string, number])[]): Buffer {
	const sorted = [...entries]
		.sort((left, right) => Buffer.compare(
			Buffer.from(left[0], "utf8"),
			Buffer.from(right[0], "utf8")));
	const total = sorted.reduce((sum, entry) => sum + entry[1], 0);
	const logTotal = Math.log(total);
	const score = (frequency: number) => Math.max(-32000, Math.min(
		0,
		Math.round((Math.log(frequency) - logTotal) * 1000)));
	const words = Buffer.concat(sorted.map(([word]) => Buffer.from(word, "utf8")));
	const offsets = Buffer.alloc((sorted.length + 1) * 4);
	const scores = Buffer.alloc(sorted.length * 2);
	let offset = 0;
	let maxUnits = 1;
	sorted.forEach(([word, frequency], index) => {
		offsets.writeUInt32LE(offset, index * 4);
		offset += Buffer.byteLength(word, "utf8");
		scores.writeInt16LE(score(frequency), index * 2);
		maxUnits = Math.max(maxUnits, word.length);
	});
	offsets.writeUInt32LE(offset, sorted.length * 4);
	const header = Buffer.alloc(16);
	header.writeUInt32LE(1, 0);
	header.writeUInt32LE(sorted.length, 4);
	header.writeUInt32LE(maxUnits, 8);
	header.writeInt16LE(score(1), 12);
	return Buffer.concat([header, offsets, scores, words]);
}

function cppLiteral(data: Buffer): string {
	return data.toString("latin1").replace(/[^\x20-\x7e]/g, (character) =>
		"\\" + character.charCodeAt(0).toString(8).padStart(3, "0"));
}

const harnessShim = [
	"#pragma once",
	"#include <climits>",
	"#include <cstdint>",
	"#include <string>",
	"#include <vector>",
	"",
	"using int16 = std::int16_t;",
	"using uint16 = std::uint16_t;",
	"using int32 = std::int32_t;",
	"using uint32 = std::uint32_t;",
	"using uchar = unsigned char;",
	"",
	"class QChar {",
	"public:",
		"enum Direction { DirL, DirR, DirAL, DirOther };",
		"QChar() = default;",
		"QChar(char16_t value) : _value(value) {",
		"}",
		"[[nodiscard]] char16_t unicode() const {",
			"return _value;",
		"}",
		"[[nodiscard]] bool isSpace() const {",
			"const auto code = int(_value);",
			"return code == 0x20",
				"|| (code >= 0x09 && code <= 0x0d)",
				"|| (code > 127",
					"&& (code == 0x85",
						"|| code == 0xa0",
						"|| (code >= 0x2000 && code <= 0x200a)",
						"|| code == 0x1680",
						"|| code == 0x2028",
						"|| code == 0x2029",
						"|| code == 0x202f",
						"|| code == 0x205f",
						"|| code == 0x3000));",
		"}",
		"[[nodiscard]] Direction direction() const {",
			"const auto code = _value;",
			"if (code >= 0x0590 && code <= 0x08ff) return DirR;",
			"if (code >= 0xfb1d && code <= 0xfeff) return DirAL;",
			"return DirL;",
		"}",
		"static constexpr auto ObjectReplacementCharacter = char16_t(0xfffc);",
	"private:",
		"char16_t _value = 0;",
	"};",
	"",
	"class QString {",
	"public:",
		"QString() = default;",
		"explicit QString(const std::vector<QChar> &value) : _value(value) {",
		"}",
		"[[nodiscard]] QChar at(int index) const {",
			"return _value[index];",
		"}",
		"[[nodiscard]] int size() const {",
			"return int(_value.size());",
		"}",
		"[[nodiscard]] auto begin() const {",
			"return _value.begin();",
		"}",
		"[[nodiscard]] auto end() const {",
			"return _value.end();",
		"}",
	"private:",
		"std::vector<QChar> _value;",
	"};",
	"",
	"class QByteArray {",
	"public:",
		"QByteArray() = default;",
		"QByteArray(const char *data, int size) : _value(data, size) {",
		"}",
		"[[nodiscard]] const char *constData() const {",
			"return _value.data();",
		"}",
		"[[nodiscard]] int size() const {",
			"return int(_value.size());",
		"}",
	"private:",
		"std::string _value;",
	"};",
	"",
	"enum class TextSelectType { Letters = 1, Words = 2, Paragraphs = 3 };",
	"",
	"struct TextSelection {",
		"uint16 from = 0;",
		"uint16 to = 0;",
	"};",
	"",
	"namespace Ui::Text {",
	"",
	"// The separator list of the client, as upstream has it in text.cpp.",
	"[[nodiscard]] inline bool IsWordSeparator(QChar ch) {",
		"switch (ch.unicode()) {",
		"case 0x20:",
		"case 0x0a:",
		"case 0x2e:",
		"case 0x2c:",
		"case 0x3f:",
		"case 0x21:",
		"case 0x40:",
		"case 0x23:",
		"case 0x24:",
		"case 0x3a:",
		"case 0x3b:",
		"case 0x2d:",
		"case 0x3c:",
		"case 0x3e:",
		"case 0x5b:",
		"case 0x5d:",
		"case 0x28:",
		"case 0x29:",
		"case 0x7b:",
		"case 0x7d:",
		"case 0x3d:",
		"case 0x2f:",
		"case 0x2b:",
		"case 0x25:",
		"case 0x26:",
		"case 0x5e:",
		"case 0x2a:",
		"case 0x27:",
		"case 0x22:",
		"case 0x60:",
		"case 0x7e:",
		"case 0x7c:",
		"case 0x2013:",
		"case 0x2014:",
		"case 0x2018:",
		"case 0x2019:",
		"case 0x201c:",
		"case 0x201d:",
		"case 0x2026:",
		"case 0xfffc:",
			"return true;",
		"default:",
			"return false;",
		"}",
	"}",
	"",
		"",
		"// The declarations the patched text.h holds in the client.",
		"namespace WordSegment {",
		"",
		"inline constexpr auto kChunkLength = 64;",
		"",
		"[[nodiscard]] bool IsSeparator(const QString &text, int position);",
		"[[nodiscard]] int Start(const QString &text, int position);",
		"[[nodiscard]] int End(const QString &text, int position);",
		"[[nodiscard]] int MoveForward(const QString &text, int position);",
		"[[nodiscard]] int MoveBackward(const QString &text, int position);",
		"[[nodiscard]] bool IsRightToLeft(const QString &text);",
		"",
		"} // namespace Ui::Text::WordSegment",
	"} // namespace Ui::Text",
	"",
].join("\n");

it("compiles the patched word segmentation and field shortcuts end to end", async () => {
	const { root, patched } = await fixture();
	await patchCjkSegmentation({ root, target: targetById("tdesktop"), featureRoot });
	const sources = await patched();
	const fieldHandler = definition(
		sources.field, "bool InputField::handleWordSegmentKey(QKeyEvent *e)");

	// The branch the patch replaced in the message text selection, taken out of
	// the patched source itself, so that what is exercised is the generated code.
	const start = sources.text.indexOf("} else if (selectType == TextSelectType::Words) {");
	expect(start).toBeGreaterThan(0);
	const open = sources.text.indexOf("{", start);
	let depth = 0;
	let end = -1;
	for (let index = open; index < sources.text.length; index += 1) {
		if (sources.text[index] === "{") depth += 1;
		else if (sources.text[index] === "}" && --depth === 0) {
			end = index + 1;
			break;
		}
	}
	expect(end).toBeGreaterThan(open);
	const branch = sources.text.slice(start, end).replace(/^\s*} else if \([^)]*\) \{/, "if (true) {");

	const payload = buildPayload([
		["你", 500000], ["好", 800000], ["世", 100000], ["界", 90000],
		["的", 1000000], ["是", 900000], ["一", 800000], ["个", 700000],
		["测", 20000], ["试", 30000], ["微", 1000], ["信", 1000],
		["你好", 400000], ["世界", 300000], ["一个", 500000], ["测试", 200000],
		["微信", 60000],
	]);
	const words = [
		"static constexpr auto kCrossgramWordsVersion = 1;",
		"",
		"static QByteArray CrossgramWordsPayload() {",
			`static const char data[] = "${cppLiteral(payload)}";`,
			"return QByteArray(data, int(sizeof(data) - 1));",
		"}",
		"",
	].join("\n");
	await writeFile(
		path.join(root, "Telegram/lib_ui/ui/text/text_crossgram_words.inc"),
		words,
		"utf8");

	const harness = [
		"#include \"shim.h\"",
		"",
		"#include \"ui/text/text_crossgram.inc\"",
		"#include \"field-shim.h\"",
		"",
		...fieldHandler.split("\n"),
		"",
		"static int Failures = 0;",
		"",
		"#define CHECK(condition, message) \\",
			"do { \\",
				"if (!(condition)) { \\",
					"++Failures; \\",
					"std::printf(\"failed: %s (%s:%d)\\n\", message, __FILE__, __LINE__); \\",
				"} \\",
			"} while (false)",
		"",
		"[[nodiscard]] static QString Utf8(const char *text) {",
			"auto result = std::vector<QChar>();",
			"for (auto at = text; *at;) {",
				"const auto lead = uchar(*at);",
				"auto code = char16_t(0);",
				"auto length = 1;",
				"if (lead < 0x80) {",
					"code = lead;",
				"} else if ((lead & 0xe0) == 0xc0) {",
					"code = char16_t(((lead & 0x1f) << 6) | (at[1] & 0x3f));",
					"length = 2;",
				"} else if ((lead & 0xf0) == 0xe0) {",
					"code = char16_t(((lead & 0x0f) << 12)",
						"| ((at[1] & 0x3f) << 6)",
						"| (at[2] & 0x3f));",
					"length = 3;",
				"} else {",
					"code = char16_t(0x25a1);",
					"length = 4;",
				"}",
				"result.push_back(QChar(code));",
				"at += length;",
			"}",
			"return QString(result);",
		"}",
		"",
		"namespace Ui::Text {",
		"",
		"// The patched selection of a word, taken out of the generated text.cpp.",
		"[[nodiscard]] TextSelection AdjustWords(",
			"const QString &_text,",
			"uint16 from,",
			"uint16 to) {",
			...branch.split("\n"),
			"return { from, to };",
		"}",
		"",
		"} // namespace Ui::Text",
		"",
		"int main() {",
			"using namespace Ui::Text;",
			"const auto a = Utf8(\"你好，世界。\");",
			"CHECK(WordSegment::IsSeparator(a, 2), \"punctuation splits words\");",
			"CHECK(!WordSegment::IsSeparator(a, 0), \"a han character is not a separator\");",
			"CHECK(WordSegment::Start(a, 0) == 0 && WordSegment::End(a, 0) == 2, \"你好 is one word\");",
			"CHECK(WordSegment::Start(a, 1) == 0, \"the word end is inside the word\");",
			"CHECK(WordSegment::Start(a, 3) == 3 && WordSegment::End(a, 3) == 5, \"世界 is one word\");",
			"CHECK(WordSegment::End(a, 2) == 3, \"punctuation is a word of its own\");",
			"CHECK(WordSegment::MoveForward(a, 0) == 2, \"a step forward leaves the word\");",
			"CHECK(WordSegment::MoveForward(a, 2) == 5, \"a step forward from punctuation\");",
			"CHECK(WordSegment::MoveBackward(a, 5) == 3, \"a step back enters the word\");",
			"CHECK(WordSegment::MoveBackward(a, 3) == 0, \"a step back over punctuation\");",
			"CHECK(AdjustWords(a, 0, 0).from == 0 && AdjustWords(a, 0, 0).to == 2, \"a double click on 你好\");",
			"CHECK(AdjustWords(a, 3, 3).from == 3 && AdjustWords(a, 3, 3).to == 5, \"a double click on 世界\");",
			"CHECK(AdjustWords(a, 2, 2).from == 2 && AdjustWords(a, 2, 2).to == 3, \"a double click on punctuation\");",
			"CHECK(AdjustWords(a, 1, 4).from == 0 && AdjustWords(a, 1, 4).to == 5, \"a drag over both words\");",
			"",
			"const auto latin = Utf8(\"hello world\");",
			"CHECK(WordSegment::Start(latin, 1) == 0, \"a word of letters\");",
			"CHECK(WordSegment::End(latin, 1) == 5, \"a word of letters ends at the space\");",
			"CHECK(WordSegment::Start(latin, 5) == 5, \"a space is its own position\");",
			"CHECK(WordSegment::End(latin, 5) == 6, \"a space ends one character later\");",
			"CHECK(WordSegment::MoveForward(latin, 0) == 5, \"a step forward over a word\");",
			"CHECK(WordSegment::MoveForward(latin, 5) == 11, \"a step forward from a space\");",
			"CHECK(WordSegment::MoveBackward(latin, 11) == 6, \"a step back over a word\");",
			"CHECK(AdjustWords(latin, 1, 8).from == 0 && AdjustWords(latin, 1, 8).to == 11, \"a drag over letters\");",
			"CHECK(!WordSegment::IsRightToLeft(latin), \"letters are read from the left\");",
			"",
			"const auto apostrophe = Utf8(\"don't stop\");",
			"CHECK(!WordSegment::IsSeparator(apostrophe, 3), \"an apostrophe inside a word stays in it\");",
			"CHECK(WordSegment::Start(apostrophe, 4) == 0, \"the word of an apostrophe word\");",
			"CHECK(WordSegment::IsSeparator(Utf8(\"don 't\"), 4), \"an apostrophe at a word edge splits\");",
			"",
			"const auto russian = Utf8(\"مرحبا\");",
			"CHECK(WordSegment::IsRightToLeft(russian), \"arabic is read from the right\");",
			"",
			"// A word of the list is only looked up inside one chunk, so a word that",
			"// would cross the chunk it starts in is not found.",
			"auto repeated = std::string(\"你\");",
			"for (auto index = 0; index != 100; ++index) {",
				"repeated += (index == 62) ? \"你好\" : \"你\";",
			"}",
			"const auto chunked = Utf8(repeated.c_str());",
			"CHECK(WordSegment::End(chunked, 63) == 64, \"a word does not cross a chunk\");",
			"CHECK(WordSegment::Start(chunked, 64) == 64, \"the character after a chunk starts one\");",
			"CHECK(WordSegment::End(chunked, 4) == 5, \"a character the list does not join\");",
			"",
			"#include \"field-cases.inc\"",
			"",
			"if (Failures) {",
				"std::printf(\"%d checks failed\\n\", Failures);",
				"return 1;",
			"}",
			"std::printf(\"all checks passed\\n\");",
			"return 0;",
		"}",
	].join("\n");

	const directory = path.join(root, "native");
	await mkdir(path.join(directory, "QtCore"), { recursive: true });
	await writeFile(path.join(directory, "shim.h"), harnessShim, "utf8");
	await writeFile(path.join(directory, "QtCore/QByteArray"), "", "utf8");
	await writeFile(path.join(directory, "main.cpp"), harness, "utf8");
	const binary = path.join(directory, process.platform === "win32" ? "main.exe" : "main");
	const run = promisify(execFile);
	await run(process.env.CXX || "clang++", [
		"-std=c++20",
		"-O0",
		"-Wall",
		"-Wextra",
		"-Wno-unused-parameter",
		"-I", directory,
		"-I", path.resolve("tests/native/cjk-segmentation"),
		"-I", path.join(root, "Telegram/lib_ui"),
		"-I", path.join(root, "Telegram/lib_ui/ui/text"),
		"main.cpp",
		"-o", binary,
	], { cwd: directory });
	const execution = await run(binary, [], { cwd: directory });
	expect(execution.stdout).toContain("all checks passed");
}, 120_000);
