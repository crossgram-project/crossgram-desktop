import { PatchContext } from "../../src/core/patch-context.js";
import type { Target } from "../../src/targets.js";

interface PatchOptions {
  readonly root: string;
  readonly target: Target;
  readonly featureRoot: string;
}

const sourceRoot = "Telegram/SourceFiles";

/**
 * 修复 Windows 下通过 KEYEVENTF_UNICODE 注入字符时的吞字与重复问题。
 *
 * Qt 的 Windows 按键映射器会将缺少中间 keyup 的连续 VK_PACKET 按下当成自动连发，
 * 导致前一个字符重复、新字符丢失（例如微信语音输入）。这里安装原生事件过滤器绕过该按键记录。
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
