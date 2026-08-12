import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  patchUpstreamCompatibility,
  qtLibcborCollisions,
} from "../features/upstream-compat/patch.js";
import { targetById } from "../src/targets.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })));
});

async function fixture(eol = "\n"): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "crossgram-desktop-upstream-compat-"));
  temporaryDirectories.push(root);
  await mkdir(path.join(root, "Telegram/cmake"), { recursive: true });
  await writeFile(
    path.join(root, "Telegram/cmake/lib_fido2.cmake"),
    [
      "set(fido2_definitions _FIDO_INTERNAL HAVE_CBOR_H)",
      "target_compile_definitions(lib_fido2 PRIVATE ${fido2_definitions})",
      "target_link_libraries(lib_fido2 PUBLIC desktop-app::external_openssl)",
      "",
    ].join(eol),
    "utf8",
  );
  return root;
}

describe("upstream compatibility", () => {
  it("renames every Qt/libcbor collision for Windows and is idempotent", async () => {
    const root = await fixture();
    const options = { root, target: targetById("tdesktop-x64") };

    await patchUpstreamCompatibility(options);
    const first = await readFile(
      path.join(root, "Telegram/cmake/lib_fido2.cmake"),
      "utf8",
    );

    expect(qtLibcborCollisions).toEqual([
      "cbor_encode_uint",
      "cbor_encode_tag",
      "cbor_encode_null",
      "cbor_encode_double",
    ]);
    for (const symbol of qtLibcborCollisions) {
      const renamed = `crossgram_libcbor_${symbol.slice("cbor_".length)}`;
      expect(first.match(new RegExp(`${symbol}=${renamed}`, "g"))).toHaveLength(1);
    }
    expect(first).toContain("if (WIN32)");
    expect(first.indexOf("target_compile_definitions(lib_fido2 PRIVATE"))
      .toBeLessThan(first.indexOf("crossgram_libcbor_encode_double"));
    expect(first.indexOf("crossgram_libcbor_encode_double"))
      .toBeLessThan(first.indexOf("target_link_libraries(lib_fido2"));

    await patchUpstreamCompatibility(options);
    expect(await readFile(path.join(root, "Telegram/cmake/lib_fido2.cmake"), "utf8"))
      .toBe(first);
  });

  it("preserves CRLF in the patched CMake file", async () => {
    const root = await fixture("\r\n");
    await patchUpstreamCompatibility({ root, target: targetById("tdesktop-x64") });
    const source = await readFile(path.join(root, "Telegram/cmake/lib_fido2.cmake"), "utf8");
    expect(source.replaceAll("\r\n", "")).not.toContain("\n");
  });


  it("teaches AyuGram's language subset scanner about ayu_ keys", async () => {
    const root = await mkdtemp(
      path.join(tmpdir(), "crossgram-desktop-ayugram-compat-"),
    );
    temporaryDirectories.push(root);
    const scannerPath = path.join(
      root,
      "Telegram/codegen/codegen/lang/subsets.cpp",
    );
    await mkdir(path.dirname(scannerPath), { recursive: true });
    await writeFile(
      scannerPath,
      `void Scan(const QByteArray &content, Scanned &result) {
	const auto data = content.constData();
	const auto size = content.size();
	for (auto i = qsizetype(0); i + 4 < size; ++i) {
		if (data[i] != 'l'
			|| data[i + 1] != 'n'
			|| data[i + 2] != 'g'
			|| data[i + 3] != '_'
			|| (i > 0 && IsIdentifierChar(data[i - 1]))) {
			continue;
		}
		auto till = i + 4;
		while (till != size && IsIdentifierChar(data[till])) {
			++till;
		}
		result.tokens.push_back(content.mid(i, till - i));
		i = till - 1;
	}
}
`,
      "utf8",
    );

    const options = { root, target: targetById("ayugram") };
    await patchUpstreamCompatibility(options);
    const first = await readFile(scannerPath, "utf8");
    expect(first).toContain("data[i] == 'l'");
    expect(first).toContain("data[i] == 'a'");
    expect(first).toContain("data[i + 1] == 'y'");
    expect(first).toContain("auto till = i + prefix;");

    await patchUpstreamCompatibility(options);
    expect(await readFile(scannerPath, "utf8")).toBe(first);
  });
  it("does not touch upstreams that do not vendor 64Gram's libfido2", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "crossgram-desktop-upstream-compat-none-"));
    temporaryDirectories.push(root);
    await expect(patchUpstreamCompatibility({ root, target: targetById("tdesktop") }))
      .resolves.toBeUndefined();
  });
});
