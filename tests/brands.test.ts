import { describe, expect, it } from "vitest";
import { brandById, brands, resolveBrand } from "../src/brands.js";
import { targetById } from "../src/targets.js";

describe("brands", () => {
  it("defines the default and five themed builds", () => {
    expect(brands.map(({ id }) => id)).toEqual([
      "cross",
      "qq",
      "wechat",
      "wecom",
      "dingtalk",
      "discord",
    ]);
  });

  it("derives stable, isolated platform identifiers", () => {
    const target = targetById("tdesktop");
    const first = resolveBrand(target, brandById("qq"));
    const second = resolveBrand(target, brandById("qq"));
    expect(first.windowsAppId).toBe(second.windowsAppId);
    expect(first.windowsAppId).toMatch(/^\{[0-9A-F-]{36}\}$/);
    expect(first.linuxId).toBe("org.telegram.desktop.crossgram.qq");
    expect(first.title).toBe("QQ · Cross");
  });

  it("uses each upstream's Cross name for the default brand", () => {
    expect(resolveBrand(targetById("ayugram"), brandById("cross")).title)
      .toBe("CrossAyuGram");
  });
});
