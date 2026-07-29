import { PatchContext } from "../../src/core/patch-context.js";
import type { Target } from "../../src/targets.js";

interface PatchOptions {
  readonly root: string;
  readonly target: Target;
  readonly featureRoot: string;
}

const sourceRoot = "Telegram/SourceFiles";

export async function patchE2e(options: PatchOptions): Promise<void> {
  const context = new PatchContext(options.root, options.target, options.featureRoot);
  await context.install("e2e.h", `${sourceRoot}/crossgram/e2e.h`);
  await context.install("e2e.cpp", `${sourceRoot}/crossgram/e2e.cpp`);

  await context.edit("Telegram/CMakeLists.txt", (file) => {
    file.insertAfter(
      "    countries/countries_manager.h",
      "\n    crossgram/e2e.cpp\n    crossgram/e2e.h",
      "crossgram/e2e.cpp",
    );
  });

  await context.edit(`${sourceRoot}/core/application.cpp`, (file) => {
    file.insertAfter(
      '#include "core/application.h"',
      '\n#include "crossgram/e2e.h"',
      '#include "crossgram/e2e.h"',
    );
    file.insertAfter(
      "\tprocessCreatedWindow(_lastActivePrimaryWindow);",
      "\n\tCrossgram::E2e::Start();",
      "Crossgram::E2e::Start();",
    );
  });
}
