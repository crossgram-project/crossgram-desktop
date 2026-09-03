import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { patchBranding } from "../features/branding/patch.js";
import { targetById } from "../src/targets.js";

const featureRoot = join(process.cwd(), "features", "branding");

describe("runtime branding patch", () => {
  it("installs the universal branding module and menu action", async () => {
    const root = await mkdtemp(join(tmpdir(), "crossgram-branding-"));
    const files = {
      "Telegram/CMakeLists.txt": "if (CMAKE_GENERATOR STREQUAL Xcode)\n    countries/countries_manager.h\n",
      "Telegram/SourceFiles/core/application.cpp": '#include "core/application.h"\n\tstartLocalStorage();\n',
      "Telegram/SourceFiles/window/window_main_menu.cpp": '#include "settings/settings_common.h"\n\taddAction(\n\t\ttr::lng_menu_settings(),\n',
      "Telegram/SourceFiles/window/main_window.cpp": '#include "window/main_window.h"\n\tsetTitle((user.isEmpty() ? u"Telegram"_q : user) + added + suffix);\n',
    };
    for (const [path, content] of Object.entries(files)) {
      const full = join(root, path);
      await mkdir(join(full, ".."), { recursive: true });
      await writeFile(full, content, "utf8");
    }

    await patchBranding({
      root,
      target: targetById("tdesktop"),
      brand: null,
      featureRoot,
    });

    const cmake = await readFile(join(root, "Telegram/CMakeLists.txt"), "utf8");
    const application = await readFile(join(root, "Telegram/SourceFiles/core/application.cpp"), "utf8");
    const menu = await readFile(join(root, "Telegram/SourceFiles/window/window_main_menu.cpp"), "utf8");
    expect(cmake).toContain("crossgram/branding_runtime.cpp");
    expect(application).toContain("Crossgram::Branding::Initialize();");
    expect(menu).toContain("Crossgram::Branding::FillMenu(_contextMenu.get());");
    expect(await readFile(join(root, "Telegram/SourceFiles/crossgram/branding_runtime.cpp"), "utf8"))
      .toContain("QQ · Cross");

    const once = await readFile(join(root, "Telegram/CMakeLists.txt"), "utf8");
    await patchBranding({ root, target: targetById("tdesktop"), brand: null, featureRoot });
    expect(await readFile(join(root, "Telegram/CMakeLists.txt"), "utf8")).toBe(once);
  });
});
