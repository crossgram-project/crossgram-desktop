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

  it("keeps workflow matrices in sync with the registry", async () => {
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
    const groupedMatrixBuilds = (workflow: string) =>
      [...workflow.matchAll(/^\s+- target: (\S+)\r?\n\s+brands: '([^']+)'$/gm)]
        .flatMap((match) => (JSON.parse(match[2]!) as string[])
          .map((brand) => `${match[1]}/${brand}`));
    const publishTargets = (workflow: string) =>
      [...workflow.matchAll(/^\s+- target: (\S+)\r?\n\s+repository:/gm)]
        .map((match) => match[1]);
    expect(matrixBuilds(check)).toEqual(expected);
    expect(groupedMatrixBuilds(release).sort()).toEqual([...expected].sort());
    expect(publishTargets(release)).toEqual(targets.map(({ id }) => id));
  });

  it("uses platform-safe release runners and environment names", async () => {
    const release = await readFile(
      resolve(repositoryRoot, ".github/workflows/release.yml"),
      "utf8",
    );
    expect(release).toContain("matrix.build.target == 'materialgram' && 'macos-15-intel'");
    expect(release).toContain("CROSSGRAM_TARGET: ${{ matrix.build.target }}");
    expect(release).not.toContain("$env:TARGET");
    expect(release).toContain("TARGET_FILTER: ${{ inputs.target }}");
    expect(release).toContain("-Wno-error=install-absolute-destination");
    expect(release).toContain("CMAKE_INSTALL_FULL_DATADIR");
    expect(release).toContain("CMAKE_INSTALL_DATADIR");
    expect(release).toContain("-DCMAKE_EXE_LINKER_FLAGS=dnsapi.lib");
    expect(release).toContain("group: release-${{ matrix.build.target }}-${{ matrix.platform }}");
  });
});
