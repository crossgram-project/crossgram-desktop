import { readFile, writeFile } from "node:fs/promises";

export class PatchError extends Error {}

function findUnique(source: string, needle: string, description: string): number {
  const first = source.indexOf(needle);
  if (first < 0) {
    throw new PatchError(`Could not find ${description}.`);
  }
  if (source.indexOf(needle, first + needle.length) >= 0) {
    throw new PatchError(`${description} is ambiguous.`);
  }
  return first;
}

function matchingBrace(source: string, open: number): number {
  let depth = 0;
  let quote = "";
  let lineComment = false;
  let blockComment = false;
  let escaped = false;
  for (let index = open; index < source.length; index += 1) {
    const character = source[index] ?? "";
    const next = source[index + 1] ?? "";
    if (lineComment) {
      if (character === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (character === "*" && next === "/") {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = "";
      continue;
    }
    if (character === "/" && next === "/") {
      lineComment = true;
      index += 1;
    } else if (character === "/" && next === "*") {
      blockComment = true;
      index += 1;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  throw new PatchError("Could not find a matching closing brace.");
}

export class TextFile {
  private constructor(
    readonly path: string,
    private source: string,
    private readonly eol: "\n" | "\r\n",
  ) {}

  static async open(path: string): Promise<TextFile> {
    const source = await readFile(path, "utf8");
    return new TextFile(path, source, source.includes("\r\n") ? "\r\n" : "\n");
  }

  text(): string {
    return this.source;
  }

  has(marker: string): boolean {
    return this.source.includes(this.format(marker));
  }

  insertAfter(anchor: string, addition: string, marker = addition.trim()): void {
    if (this.has(marker)) return;
    const formattedAnchor = this.format(anchor);
    const index =
      findUnique(this.source, formattedAnchor, `anchor '${anchor}'`) + formattedAnchor.length;
    this.source = this.source.slice(0, index) + this.format(addition) + this.source.slice(index);
  }

  insertBefore(anchor: string, addition: string, marker = addition.trim()): void {
    if (this.has(marker)) return;
    const index = findUnique(this.source, this.format(anchor), `anchor '${anchor}'`);
    this.source = this.source.slice(0, index) + this.format(addition) + this.source.slice(index);
  }

  replace(search: string, replacement: string, appliedMarker = replacement.trim()): void {
    if (this.has(appliedMarker)) return;
    const formattedSearch = this.format(search);
    const index = findUnique(this.source, formattedSearch, `text '${search}'`);
    this.source =
      this.source.slice(0, index) +
      this.format(replacement) +
      this.source.slice(index + formattedSearch.length);
  }

  replaceEvery(search: string, replacement: string, appliedMarker = replacement): void {
    if (this.has(appliedMarker)) return;
    const formattedSearch = this.format(search);
    if (!this.source.includes(formattedSearch)) {
      throw new PatchError(`Could not find text '${search}'.`);
    }
    this.source = this.source.replaceAll(formattedSearch, this.format(replacement));
  }

  replacePattern(search: RegExp, replacement: string, appliedMarker = replacement.trim()): void {
    if (this.has(appliedMarker)) return;
    const globalFlags = search.flags.includes("g") ? search.flags : `${search.flags}g`;
    const matches = [...this.source.matchAll(new RegExp(search.source, globalFlags))];
    if (matches.length === 0) {
      throw new PatchError(`Could not find pattern '${search.source}'.`);
    }
    if (matches.length > 1) {
      throw new PatchError(`Pattern '${search.source}' is ambiguous.`);
    }
    const singleFlags = search.flags.replaceAll("g", "").replaceAll("y", "");
    this.source = this.source.replace(
      new RegExp(search.source, singleFlags),
      this.format(replacement),
    );
  }

  insertAfterFunction(signature: string, addition: string, marker = addition.trim()): void {
    if (this.has(marker)) return;
    const start = findUnique(this.source, signature, `function '${signature}'`);
    const open = this.source.indexOf("{", start + signature.length);
    if (open < 0) throw new PatchError(`Function '${signature}' has no body.`);
    const end = matchingBrace(this.source, open) + 1;
    this.source = this.source.slice(0, end) + this.format(addition) + this.source.slice(end);
  }

  replaceFunction(signature: string, replacement: string, marker: string): void {
    if (this.has(marker)) return;
    const start = findUnique(this.source, signature, `function '${signature}'`);
    const open = this.source.indexOf("{", start + signature.length);
    if (open < 0) throw new PatchError(`Function '${signature}' has no body.`);
    const end = matchingBrace(this.source, open) + 1;
    this.source = this.source.slice(0, start) + this.format(replacement) + this.source.slice(end);
  }

  async save(): Promise<void> {
    await writeFile(this.path, this.source, "utf8");
  }

  private format(value: string): string {
    return value.replaceAll("\r\n", "\n").replaceAll("\n", this.eol);
  }
}
