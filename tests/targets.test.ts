import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { targetById, targets } from "../src/targets.js";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("targets", () => {
  it("contains every supported upstream exactly once", () => {
    expect(targets.map(({ id }) => id)).toEqual([
      "tdesktop",
      "tdesktop-x64",
      "ayugram",
      "materialgram",
    ]);
    const repositories = new Set(targets.map(({ repository }) => repository));
    expect(repositories.size).toBe(targets.length);
  });

  it("rejects unknown target ids", () => {
    expect(() => targetById("unknown")).toThrow(/Unknown target/);
  });

  it("keeps both workflow matrices in sync with the registry", async () => {
    const [check, release] = await Promise.all([
      readFile(resolve(repositoryRoot, ".github/workflows/check.yml"), "utf8"),
      readFile(resolve(repositoryRoot, ".github/workflows/release.yml"), "utf8"),
    ]);
    const expected = [
      ...targets.map(({ id }) => `${id}/cross`),
      "tdesktop/qq",
      "tdesktop/wechat",
      "tdesktop/wecom",
      "tdesktop/dingtalk",
      "tdesktop/discord",
    ];
    const matrixBuilds = (workflow: string) =>
      [...workflow.matchAll(/^\s+- target: (\S+)\r?\n\s+brand: (\S+)$/gm)]
        .map((match) => `${match[1]}/${match[2]}`);
    expect(matrixBuilds(check)).toEqual(expected);
    expect(matrixBuilds(release)).toEqual([...expected, ...expected]);
  });
});
