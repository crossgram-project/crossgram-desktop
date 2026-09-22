import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { patchCjkSegmentation } from "../features/cjk-segmentation/patch.js";
import { targets } from "../src/targets.js";

const roots: string[] = [];
afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

// The sources of one release of every supported upstream, one directory per
// target id, holding the files this patch reads and writes:
//
//   Telegram/lib_ui/ui/text/text.h
//   Telegram/lib_ui/ui/text/text.cpp
//   Telegram/lib_ui/ui/widgets/fields/input_field.h
//   Telegram/lib_ui/ui/widgets/fields/input_field.cpp
//   Telegram/SourceFiles/history/view/history_view_keyboard_text_selection.cpp
//
// The unit suite covers both shapes of every edit on its own; this runs the
// same patch against what the upstreams actually ship, because the anchors
// and the two shapes of the replaced code only exist there.
const sourceRoot = process.env.CROSSGRAM_DESKTOP_CJK_SEGMENTATION_SOURCE_ROOT;
const relativePaths = [
	"Telegram/lib_ui/ui/text/text.h",
	"Telegram/lib_ui/ui/text/text.cpp",
	"Telegram/lib_ui/ui/widgets/fields/input_field.h",
	"Telegram/lib_ui/ui/widgets/fields/input_field.cpp",
	"Telegram/SourceFiles/history/view/history_view_keyboard_text_selection.cpp",
];

describe.skipIf(!sourceRoot)("real upstream CJK word segmentation", () => {
	it.each(targets)("patches $id release sources idempotently", async (target) => {
		const temporaryRoot = path.resolve("../work/tests/cjk-segmentation-e2e");
		await mkdir(temporaryRoot, { recursive: true });
		const fixture = await mkdtemp(path.join(temporaryRoot, "fixture-"));
		roots.push(fixture);
		const root = path.join(fixture, target.id);
		for (const relative of relativePaths) {
			await cp(
				path.join(sourceRoot!, target.id, relative),
				path.join(root, relative),
				{ recursive: true });
		}
		const braceDelta = (source: string) =>
			(source.match(/{/g) ?? []).length - (source.match(/}/g) ?? []).length;
		const originalDeltas = await Promise.all(relativePaths.map(async (relative) =>
			braceDelta(await readFile(path.join(root, relative), "utf8"))));
		const options = {
			root,
			target,
			featureRoot: path.resolve("features/cjk-segmentation"),
		};
		await patchCjkSegmentation(options);
		const read = (relative: string) => readFile(path.join(root, relative), "utf8");
		const text = await read("Telegram/lib_ui/ui/text/text.cpp");
		const header = await read("Telegram/lib_ui/ui/text/text.h");
		const field = await read("Telegram/lib_ui/ui/widgets/fields/input_field.cpp");
		const fieldHeader = await read(
			"Telegram/lib_ui/ui/widgets/fields/input_field.h");
		const keyboard = await read(relativePaths[4]!);

		expect(text).toContain("#include \"ui/text/text_crossgram.inc\"");
		expect(text).toContain("WordSegment::IsSeparator(_text, from)");
		expect(text).not.toContain("IsWordSeparator(_text.at(from))");
		expect(header).toContain("inline constexpr auto kChunkLength = 64;");
		expect(header).toContain("} // namespace WordSegment");
		expect(fieldHeader).toContain("void mouseDoubleClickEventInner(QMouseEvent *e);");
		expect(fieldHeader).toContain("std::optional<QTextCursor> _wordSegmentDrag;");
		expect(field).toContain("bool InputField::handleWordSegmentKey(QKeyEvent *e) {");
		// The new functions have to be definitions of the class at the top of
		// the file, the way the definitions around them are, and not nested in
		// the handler they follow.
		for (const definition of [
			"bool InputField::handleWordSegmentKey(QKeyEvent *e) {",
			"void InputField::mouseDoubleClickEventInner(QMouseEvent *e) {",
			"bool InputField::applyWordSegmentDrag(QMouseEvent *e) {",
		]) {
			expect(field.split("\n").some((line) => line.startsWith(definition)))
				.toBe(true);
		}
		expect(field).toContain("bool InputField::applyWordSegmentDrag(QMouseEvent *e) {");
		expect(field).toContain("} else if (handleWordSegmentKey(e)) {");
		expect(keyboard).toContain("Ui::Text::WordSegment::MoveForward(window, local)");
		expect(keyboard).not.toContain("IsWordSeparator(one[0])");

		// The patch replaces code, so the braces of every file it touches
		// have to balance exactly as they did in the release.
		const deltas = [text, header, field, fieldHeader, keyboard].map(braceDelta);
		expect(deltas).toEqual(originalDeltas);

		const before = [text, header, field, fieldHeader, keyboard];
		const generated = await read(
			"Telegram/lib_ui/ui/text/text_crossgram_words.inc");
		await patchCjkSegmentation(options);
		expect(await read("Telegram/lib_ui/ui/text/text_crossgram_words.inc"))
			.toEqual(generated);
		expect(await Promise.all([
			read("Telegram/lib_ui/ui/text/text.cpp"),
			read("Telegram/lib_ui/ui/text/text.h"),
			read("Telegram/lib_ui/ui/widgets/fields/input_field.cpp"),
			read("Telegram/lib_ui/ui/widgets/fields/input_field.h"),
			read(relativePaths[4]!),
		])).toEqual(before);
	});

	it("keeps a rewritten upstream from being patched silently", async () => {
		const target = targets[0]!;
		const temporaryRoot = path.resolve("../work/tests/cjk-segmentation-e2e");
		await mkdir(temporaryRoot, { recursive: true });
		const fixture = await mkdtemp(path.join(temporaryRoot, "fixture-"));
		roots.push(fixture);
		const root = path.join(fixture, target.id);
		for (const relative of relativePaths) {
			await cp(
				path.join(sourceRoot!, target.id, relative),
				path.join(root, relative),
				{ recursive: true });
		}
		const source = path.join(root, "Telegram/lib_ui/ui/text/text.cpp");
		const text = await readFile(source, "utf8");
		await writeFile(source, text.replace(
			"} else if (selectType == TextSelectType::Words) {",
			"} else if (selectType == TextSelectType::Wordk) {"), "utf8");
		await expect(patchCjkSegmentation({
			root,
			target,
			featureRoot: path.resolve("features/cjk-segmentation"),
		})).rejects.toThrow(/Could not find/);
		});
});
