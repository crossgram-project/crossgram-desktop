import { PatchContext } from "../../src/core/patch-context.js";
import type { Target } from "../../src/targets.js";

interface PatchOptions {
  readonly root: string;
  readonly target: Target;
  readonly featureRoot: string;
}

const sourceRoot = "Telegram/SourceFiles";

/**
 * Keep injected KEYEVENTF_UNICODE characters intact on Windows.
 *
 * Qt's Windows key mapper records one key record per virtual key and treats a
 * repeated VK_PACKET key press without an intermediate key release as an
 * auto-repeat of the previous packet, which duplicates the previous character
 * and drops the new one. Tools that commit text this way (WeChat voice input,
 * for example) do not guarantee a key release per packet, so the client has to
 * route those key presses around the record; see the feature README.
 */
export async function patchWinUnicodeInput(options: PatchOptions): Promise<void> {
  const context = new PatchContext(options.root, options.target, options.featureRoot);
  await context.install("win_unicode_input.h", `${sourceRoot}/crossgram/win_unicode_input.h`);
  await context.install(
    "win_unicode_input_core.h",
    `${sourceRoot}/crossgram/win_unicode_input_core.h`,
  );
  await context.install("win_unicode_input.cpp", `${sourceRoot}/crossgram/win_unicode_input.cpp`);

  await context.edit("Telegram/CMakeLists.txt", (file) => {
    file.insertAfter(
      "    countries/countries_manager.h",
      "\n    crossgram/win_unicode_input.cpp"
        + "\n    crossgram/win_unicode_input.h"
        + "\n    crossgram/win_unicode_input_core.h",
      "crossgram/win_unicode_input.cpp",
    );
  });

  await context.edit(`${sourceRoot}/core/application.cpp`, (file) => {
    file.insertAfter(
      '#include "core/application.h"',
      '\n#include "crossgram/win_unicode_input.h"',
      '#include "crossgram/win_unicode_input.h"',
    );
    file.insertAfter(
      "\tQCoreApplication::instance()->installEventFilter(this);",
      "\n\tCrossgram::WinUnicodeInput::Start();",
      "Crossgram::WinUnicodeInput::Start();",
    );
  });
}
