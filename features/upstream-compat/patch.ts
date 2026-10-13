import { PatchContext } from "../../src/core/patch-context.js";
import type { Target } from "../../src/targets.js";

interface PatchOptions {
  readonly root: string;
  readonly target: Target;
}

const libcborPrefix = "crossgram_libcbor_";

export const qtLibcborCollisions = [
  "cbor_encode_uint",
  "cbor_encode_tag",
  "cbor_encode_null",
  "cbor_encode_double",
] as const;

export async function patchUpstreamCompatibility(options: PatchOptions): Promise<void> {
  const context = new PatchContext(options.root, options.target, options.root);

  if (options.target.id === "ayugram") {
    await context.edit("Telegram/codegen/codegen/lang/subsets.cpp", (file) => {
      // The pinned AyuGram codegen submodule already reads the ayu_ prefix
      // itself, so there is nothing left to rewrite there.
      if (file.has("data[i] == 'a'")) return;
      file.replace(
        `		if (data[i] != 'l'
			|| data[i + 1] != 'n'
			|| data[i + 2] != 'g'
			|| data[i + 3] != '_'
			|| (i > 0 && IsIdentifierChar(data[i - 1]))) {
			continue;
		}
		auto till = i + 4;`,
        `		const auto prefix = (data[i] == 'l'
			&& data[i + 1] == 'n'
			&& data[i + 2] == 'g'
			&& data[i + 3] == '_')
			? 4
			: (data[i] == 'a'
				&& data[i + 1] == 'y'
				&& data[i + 2] == 'u'
				&& data[i + 3] == '_')
			? 4
			: 0;
		if (!prefix || (i > 0 && IsIdentifierChar(data[i - 1]))) {
			continue;
		}
		auto till = i + prefix;`,
        "const auto prefix = (data[i] == 'l'",
      );
    });
    return;
  }

  if (options.target.id !== "tdesktop-x64") return;

  const definitions = qtLibcborCollisions
    .map((symbol) => `        ${symbol}=${libcborPrefix}${symbol.slice("cbor_".length)}`)
    .join("\n");

  await context.edit("Telegram/cmake/lib_fido2.cmake", (file) => {
    file.insertAfter(
      "target_compile_definitions(lib_fido2 PRIVATE ${fido2_definitions})",
      [
        "",
        "# Qt 6 bundles TinyCBOR in QtCore. Its C symbols overlap with the",
        "# incompatible libcbor API vendored by 64Gram, so isolate the libcbor",
        "# names on Windows before the two static libraries reach the final link.",
        "if (WIN32)",
        "    target_compile_definitions(lib_fido2",
        "    PRIVATE",
        definitions,
        "    )",
        "endif()",
      ].join("\n"),
      `${libcborPrefix}encode_double`,
    );
  });
}
