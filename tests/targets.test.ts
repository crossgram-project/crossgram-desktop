import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CROSSGRAM_TELEGRAM_API_HASH,
  CROSSGRAM_TELEGRAM_API_ID,
  targetById,
  targets,
} from "../src/targets.js";

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

  it("uses the Crossgram Telegram API identity for every client target", () => {
    expect(CROSSGRAM_TELEGRAM_API_ID).toBe(24862414);
    expect(CROSSGRAM_TELEGRAM_API_HASH).toBe(
      "1745670d4621f50d831db069ecc40285",
    );
    expect(targets.map(({ apiId }) => apiId)).toEqual(
      targets.map(() => CROSSGRAM_TELEGRAM_API_ID),
    );
    expect(targets.map(({ apiHash }) => apiHash)).toEqual(
      targets.map(() => CROSSGRAM_TELEGRAM_API_HASH),
    );
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
    expect(matrixBuilds(check)).toEqual(expected);
    expect(matrixBuilds(release).sort()).toEqual([...expected].sort());
    expect(release).toContain("name: Publish one unified release");
    expect(release).toContain('release_tag="crossgram-${GITHUB_RUN_NUMBER}"');
    expect(release).toContain("secrets.CROSSGRAM_RELEASE_TOKEN || github.token");
    expect(release).not.toContain('release_tag="crossgram/$TARGET/');
    expect(check).toContain('--feature e2e');
    expect(check).toContain('Verify opt-in E2E feature');
    expect(check).toContain('Verify 64Gram Windows CBOR symbol isolation');
    expect(check).toContain('cbor_encode_double=crossgram_libcbor_encode_double');
  });

  it("uses platform-safe release runners and environment names", async () => {
    const release = await readFile(
      resolve(repositoryRoot, ".github/workflows/release.yml"),
      "utf8",
    );
    expect(release).toContain("matrix.build.target == 'materialgram' && 'macos-15'");
    expect(release).toContain("matrix.platform == 'windows' && 'windows-latest'");
    expect(release.match(/vsversion: "18\.0"/g)).toHaveLength(9);
    expect(release).toContain("matrix.build.target }} / ${{ matrix.build.brand }} / ${{ matrix.platform");
    expect(release).toContain("crossgram-${{ matrix.build.target }}-${{ matrix.build.brand }}--${{ matrix.platform }}");
    expect(release).toContain("CROSSGRAM_TARGET: ${{ matrix.build.target }}");
    expect(release).not.toContain("$env:TARGET");
    expect(release).toContain("TARGET_FILTER: ${{ inputs.target }}");
    expect(release).toContain("-Wno-error=install-absolute-destination");
    expect(release).toContain("CMAKE_INSTALL_FULL_DATADIR");
    expect(release).toContain("CMAKE_INSTALL_DATADIR");
    expect(release).toContain("-DCMAKE_EXE_LINKER_FLAGS=dnsapi.lib");
    expect(release).toContain(
      "-DCMAKE_EXE_LINKER_FLAGS_RELEASE=/DEBUG:FULL /OPT:REF /OPT:ICF",
    );
    expect(release).toContain("group: crossgram-desktop-upstream-release");
    expect(release).toContain("Both API overrides are required");
    expect(release).toContain("test -n \"$OVERRIDE_API_ID\" && test -n \"$OVERRIDE_API_HASH\"");
    expect(release).toContain("'-GNinja Multi-Config'");
    expect(release).toContain("CMAKE_MSVC_DEBUG_INFORMATION_FORMAT=Embedded");
    expect(release).not.toContain("CMAKE_MSVC_DEBUG_INFORMATION_FORMAT=ProgramDatabase");
    expect(release).toContain("$env:_LINK_ = '/DEBUG:FULL /OPT:REF /OPT:ICF'");
    expect(release).toContain("$symbolRoot = Join-Path $source 'out'");
    expect(release).toContain('-Filter "$($metadata.executable).pdb" -File -Recurse');
    expect(release).toContain("-Filter '*.pdb' -File -Recurse");
    expect(release).toContain("Where-Object { $_.Name -ne 'Updater.pdb' }");
    expect(release).toContain("Copy-Item -LiteralPath $symbolFile -Destination $symbolsStage");
    expect(release).toContain("& tar.exe -a -cf $symbolsArchivePath -C $symbolsStage");
    expect(release).toContain("-DNDEBUG -DQT_NO_DEBUG");
    expect(release).toContain("& tar.exe -a -cf $archivePath");
    expect(release).toContain("& tar.exe -a -cf $symbolsArchivePath");
    expect(release).not.toContain("Compress-Archive");
    expect(release).toContain("objcopy --only-keep-debug");
    expect(release).toContain('strip -S -x "$product"');
    expect(release).toContain(".symbols.zip");
    expect(release).toContain(".symbols.tar.xz");
    expect(release).toContain("Skipping incomplete package without matching symbols");
    expect(release).toContain("'CMAKE_OSX_ARCHITECTURES=x86_64'");
    expect(release).toContain("softwareupdate --install-rosetta --agree-to-license");
    expect(release).toContain("CMAKE_BUILD_PARALLEL_LEVEL=3");
    expect(release).toContain("'MAKE_THREADS_CNT': '-j3'");
    expect(release).toContain('selected_xcode="$(cd "$(xcode-select -p)/../.." && pwd -P)"');
  });
});
