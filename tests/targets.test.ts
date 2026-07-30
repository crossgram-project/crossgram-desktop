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
    expect(matrixBuilds(check)).toEqual(expected);
    expect(groupedMatrixBuilds(release).sort()).toEqual([...expected].sort());
    expect(release).toContain("name: Publish one unified release");
    expect(release).toContain('release_tag="crossgram-${GITHUB_RUN_NUMBER}"');
    expect(release).toContain("secrets.CROSSGRAM_RELEASE_TOKEN || github.token");
    expect(release).not.toContain('release_tag="crossgram/$TARGET/');
    expect(check).toContain('--feature e2e');
    expect(check).toContain('Verify opt-in E2E feature');
  });

  it("uses platform-safe release runners and environment names", async () => {
    const release = await readFile(
      resolve(repositoryRoot, ".github/workflows/release.yml"),
      "utf8",
    );
    expect(release).toContain("matrix.build.target == 'materialgram' && 'macos-15'");
    expect(release).toContain("CROSSGRAM_TARGET: ${{ matrix.build.target }}");
    expect(release).not.toContain("$env:TARGET");
    expect(release).toContain("TARGET_FILTER: ${{ inputs.target }}");
    expect(release).toContain("-Wno-error=install-absolute-destination");
    expect(release).toContain("CMAKE_INSTALL_FULL_DATADIR");
    expect(release).toContain("CMAKE_INSTALL_DATADIR");
    expect(release).toContain("-DCMAKE_EXE_LINKER_FLAGS=dnsapi.lib");
    expect(release).toContain("group: crossgram-desktop-upstream-release");
    expect(release).toContain("'-GNinja Multi-Config'");
    expect(release).toContain("CMAKE_MSVC_DEBUG_INFORMATION_FORMAT=Embedded");
    expect(release).toContain("-DNDEBUG -DQT_NO_DEBUG");
    expect(release).toContain("objcopy --only-keep-debug");
    expect(release).toContain('strip -S -x "$product"');
    expect(release).toContain(".symbols.zip");
    expect(release).toContain(".symbols.tar.xz");
    expect(release).toContain("'CMAKE_OSX_ARCHITECTURES=x86_64'");
    expect(release).toContain("softwareupdate --install-rosetta --agree-to-license");
    expect(release).toContain("CMAKE_BUILD_PARALLEL_LEVEL=3");
    expect(release).toContain("'MAKE_THREADS_CNT': '-j3'");
    expect(release).toContain('selected_xcode="$(cd "$(xcode-select -p)/../.." && pwd -P)"');
  });
});
