import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TextFile } from "../src/core/text-file.js";

async function fixture(source: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "crossgram-patch-"));
  const path = join(directory, "fixture.cpp");
  await writeFile(path, source, "utf8");
  return path;
}

describe("TextFile", () => {
  it("inserts after a balanced C++ function and is idempotent", async () => {
    const path = await fixture(
      "void Existing() {\n\tconst auto text = \"} not a brace\";\n}\n\nvoid Next() {\n}\n",
    );
    const file = await TextFile.open(path);
    file.insertAfterFunction(
      "void Existing()",
      "\n\nvoid Added() {\n}\n",
      "void Added()",
    );
    file.insertAfterFunction(
      "void Existing()",
      "\n\nvoid Added() {\n}\n",
      "void Added()",
    );
    await file.save();
    const result = await readFile(path, "utf8");
    expect(result.match(/void Added/g)).toHaveLength(1);
    expect(result.indexOf("void Added")).toBeLessThan(result.indexOf("void Next"));
  });

  it("preserves CRLF line endings", async () => {
    const path = await fixture("first\r\nanchor\r\nlast\r\n");
    const file = await TextFile.open(path);
    file.insertAfter("anchor", "\nadded");
    await file.save();
    const result = await readFile(path, "utf8");
    expect(result).toBe("first\r\nanchor\r\nadded\r\nlast\r\n");
  });

  it("can normalize generated resource files to LF", async () => {
    const path = await fixture("first\r\nsecond\r\n");
    const file = await TextFile.open(path);
    file.normalizeLf();
    await file.save();
    expect(await readFile(path, "utf8")).toBe("first\nsecond\n");
  });

  it("rejects ambiguous anchors", async () => {
    const path = await fixture("anchor\nanchor\n");
    const file = await TextFile.open(path);
    expect(() => file.insertAfter("anchor", "\nadded")).toThrow(/ambiguous/);
  });

  it("replaces one semantic line with a regular expression", async () => {
    const path = await fixture('constexpr auto AppName = "Old"_cs;\n');
    const file = await TextFile.open(path);
    file.replacePattern(
      /^constexpr auto AppName = "[^"]*"_cs;$/m,
      'constexpr auto AppName = "New"_cs;',
    );
    await file.save();
    expect(await readFile(path, "utf8")).toBe('constexpr auto AppName = "New"_cs;\n');
  });

  it("rejects an ambiguous regular expression", async () => {
    const path = await fixture("Name=One\nName=Two\n");
    const file = await TextFile.open(path);
    expect(() => file.replacePattern(/^Name=.*$/m, "Name=Cross")).toThrow(/ambiguous/);
  });
});
