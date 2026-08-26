import { describe, expect, it } from "vitest";
import {
  createReleasePlan,
  releaseArtifactNames,
  safeReleaseTag,
} from "../src/release-plan.js";

const releases = [
  {
    target: "tdesktop" as const,
    repository: "telegramdesktop/tdesktop",
    tag: "v6.1: stable/test",
  },
  {
    target: "ayugram" as const,
    repository: "AyuGram/AyuGramDesktop",
    tag: "v5.4.1",
  },
];

describe("release planning", () => {
  it("uses artifact-safe upstream tags and matching symbol names", () => {
    expect(safeReleaseTag("v6.1: stable/test")).toBe("v6.1--stable-test");
    expect(
      releaseArtifactNames("tdesktop", "cross", "linux", "v6.1"),
    ).toEqual([
      "crossgram-tdesktop-cross-linux-v6.1.tar.xz",
      "crossgram-tdesktop-cross-linux-v6.1.symbols.tar.xz",
    ]);
    expect(
      releaseArtifactNames("tdesktop", "cross", "windows", "v6.1"),
    ).toEqual([
      "crossgram-tdesktop-cross-windows-v6.1.zip",
      "crossgram-tdesktop-cross-windows-v6.1.symbols.zip",
    ]);
  });

  it("expands filtered manual builds without treating old assets as cache hits", () => {
    const plan = createReleasePlan({
      eventName: "workflow_dispatch",
      platformFilter: "windows-linux",
      targetFilter: "tdesktop",
      brandFilter: "cross, wecom,unknown",
      releases,
      publishedAssets: new Set([
        "crossgram-tdesktop-cross-windows-v6.1--stable-test.zip",
        "crossgram-tdesktop-cross-windows-v6.1--stable-test.symbols.zip",
      ]),
    });

    expect(plan).toEqual([
      expect.objectContaining({
        target: "tdesktop",
        platform: "windows",
        batch: "primary",
        brands: ["cross"],
      }),
      expect.objectContaining({
        target: "tdesktop",
        platform: "windows",
        batch: "secondary",
        brands: ["wecom"],
      }),
      expect.objectContaining({
        target: "tdesktop",
        platform: "linux",
        batch: "primary",
        brands: ["cross"],
      }),
      expect.objectContaining({
        target: "tdesktop",
        platform: "linux",
        batch: "secondary",
        brands: ["wecom"],
      }),
    ]);
  });

  it("only schedules missing package and symbol pairs", () => {
    const published = new Set<string>();
    for (const platform of ["windows", "linux", "macos"] as const) {
      for (const brand of ["cross", "qq", "wechat", "wecom", "dingtalk", "discord"]) {
        for (const asset of releaseArtifactNames(
          "tdesktop",
          brand,
          platform,
          "v6.1--stable-test",
        )) {
          published.add(asset);
        }
      }
    }
    // A package without its matching symbols is incomplete and must be rebuilt.
    published.add("crossgram-ayugram-cross-linux-v5.4.1.tar.xz");

    const plan = createReleasePlan({
      eventName: "schedule",
      releases,
      publishedAssets: published,
    });

    expect(plan).toHaveLength(9);
    expect(plan.every(({ target }) => target === "ayugram")).toBe(true);
    expect(plan.find(({ platform, batch }) =>
      platform === "linux" && batch === "primary"
    )?.brands).toEqual(["cross", "qq"]);
  });

  it("returns an empty scheduled plan when every artifact already exists", () => {
    const published = new Set<string>();
    for (const release of releases) {
      for (const platform of ["windows", "linux", "macos"] as const) {
        for (const brand of ["cross", "qq", "wechat", "wecom", "dingtalk", "discord"]) {
          for (const asset of releaseArtifactNames(
            release.target,
            brand,
            platform,
            safeReleaseTag(release.tag),
          )) {
            published.add(asset);
          }
        }
      }
    }

    expect(createReleasePlan({
      eventName: "schedule",
      releases,
      publishedAssets: published,
    })).toEqual([]);
  });

  it("rejects unsupported platform filters", () => {
    expect(() => createReleasePlan({
      eventName: "workflow_dispatch",
      platformFilter: "android",
      releases,
    })).toThrow(/Unknown platform filter/);
  });
});
