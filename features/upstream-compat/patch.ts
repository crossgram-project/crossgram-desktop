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
    await context.edit("Telegram/SourceFiles/ayu/ayu_url_handlers.cpp", (file) => {
      file.replaceEvery(
        "tr::ayu_UserNotFoundMessage()",
        "tr::lng_blocked_list_not_found(tr::now)",
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
