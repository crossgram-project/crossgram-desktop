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

  it("uses the current macOS icon set in every upstream", () => {
    expect(targets.map(({ macIconSet }) => macIconSet)).toEqual(
      targets.map(() => "Icon.appiconset"),
    );
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
    const expected = targets.flatMap(({ id }) => [
      "cross",
      "qq",
      "wechat",
      "wecom",
      "dingtalk",
      "discord",
    ].map((brand) => `${id}/${brand}`));
    expect(
      [...check.matchAll(/^\s+- target: (\S+)\r?\n\s+brand: (\S+)$/gm)]
        .map((match) => `${match[1]}/${match[2]}`),
    ).toEqual(expected);

    const releaseTargets = [...release.matchAll(
      /^\s+- target: (\S+)\r?\n\s+repository: \S+\r?\n\s+brands: '(\[[^']+\])'$/gm,
    )].map((match) => ({
      target: match[1],
      brands: JSON.parse(match[2] ?? "[]") as string[],
    }));
    expect(releaseTargets).toEqual(targets.map(({ id }) => ({
      target: id,
      brands: ["cross", "qq", "wechat", "wecom", "dingtalk", "discord"],
    })));
    expect(release).toContain("name: Publish one unified release");
    expect(release).toContain('release_tag="crossgram-${GITHUB_RUN_NUMBER}"');
    expect(release).toContain("secrets.CROSSGRAM_RELEASE_TOKEN || github.token");
    expect(release).not.toContain('release_tag="crossgram/$TARGET/');
    expect(release).toContain("desktop-app/rnnoise.git");
    expect(release).toContain("generated Dockerfile does not contain the expected rnnoise source");
    expect(release).toContain('final_stage = text.rfind("\\nFROM builder\\n")');
    expect(release).toContain('text = text[:final_stage] + text[final_stage:].replace("COPY --link ", "COPY ")');
    expect(release).toContain('text = text.replace("-j$(nproc)", "-j2")');
    expect(release).toContain('text = text.replace("-j2 install", "-j4 install")');
    expect(release).toContain("make -j2 DESTDIR=/usr/src/breakpad-cache install");
    expect(release).toContain("sed -i '8220,8525d;5271,5277d;2726,2763d;1402,1432d;335d;238d' Makefile.in");
    expect(release).toContain('f"target=/var/cache/ccache-{stage_name}"');
    expect(release).toContain('stage_text = stage_text.replace("ccache gcc", "gcc").replace("ccache g++", "g++")');
    expect(release).toContain("gperf flex bison clang-tools-extra");
    expect(release).toContain("gperf flex bison clang clang-tools-extra");
    expect(release).toContain('text = text.replace("ccache gcc", "gcc").replace("ccache g++", "g++")');
    expect(release).toContain('text = text.replace("<<EOF\\n", "<<EOF\\nexport CCACHE_DISABLE=1\\n")');
    expect(release).toContain("stage_name = text[stage_name_start:stage_name_end]");
    expect(release).toContain('if stage_name == "qt"');
    expect(release).toContain('if stage_name == "xkbcommon"');
    expect(release).toContain('if stage_name == "protobuf"');
    expect(release).toContain('"cmake --build build --parallel 4"');
    expect(release).toContain('"cmake --build build --parallel 2"');
    expect(release).toContain('if stage_name in {"dav1d", "xkbcommon", "protobuf", "jxl", "openal"}');
    expect(release).toContain('text = text.replace("meson compile -C build", "meson compile -C build -j2")');
    expect(release).toContain("export CFLAGS=");
    expect(release).toContain("$CFLAGS -O0");
    expect(release).toContain("export CXXFLAGS=");
    expect(release).toContain("$CXXFLAGS -O0");
    expect(release).toContain("-j4 stage");
    expect(release).toContain("cp -a boost /usr/src/boost-cache/usr/local/include/");
    expect(release).toContain("tar -C /usr/src/boost-cache -czf /usr/src/boost-cache.tar usr");
    expect(release).toContain('"COPY --link --from=boost /usr/src/boost-cache /\\n",');
    expect(release).toContain("COPY --link --from=boost /usr/src/boost-cache.tar /usr/src/boost-cache.tar");
    expect(release).toContain('text = text.replace("cmake --build build", "cmake --build build --parallel 1")');
    expect(release).toContain('if stage_name == "openssl"');
    expect(release).toContain("openssl-devel");
    expect(release).toContain("mkdir -p /usr/src/openssl-cache/usr/local/include /usr/src/openssl-cache/usr/local/lib64");
    expect(release).toContain("cp -a /usr/lib64/libssl.so* /usr/lib64/libcrypto.so*");
    expect(release).toContain("git clone -b openssl-3.2.1");
    expect(release).toContain("cmake -B build . -DTG_OWT_DLOPEN_PIPEWIRE=ON\\ncmake --build build --parallel 4");
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
    expect(release.match(/vsversion: "18\.0"/g)).toHaveLength(4);
    expect(release).toContain("matrix.build.target }} / ${{ matrix.platform");
    expect(release).toContain("crossgram-${{ matrix.build.target }}--${{ matrix.platform");
    expect(release).toContain("CROSSGRAM_TARGET: ${{ matrix.build.target }}");
    expect(release).not.toContain("$env:TARGET");
    expect(release).toContain("TARGET_FILTER: ${{ inputs.target }}");
    expect(release).toContain("AVAILABLE_BRANDS: ${{ matrix.build.brands }}");
    expect(release).not.toContain("${{ matrix.build.brand }}");
    expect(release).toContain("-Wno-error=install-absolute-destination");
    expect(release).toContain("CMAKE_INSTALL_FULL_DATADIR");
    expect(release).toContain("CMAKE_INSTALL_DATADIR");
    expect(release).toContain("-DCMAKE_EXE_LINKER_FLAGS=dnsapi.lib");
    expect(release).toContain(
      "-DCMAKE_EXE_LINKER_FLAGS_RELEASE=/DEBUG:FASTLINK /OPT:REF /OPT:ICF",
    );
    expect(release).toContain("group: crossgram-desktop-upstream-release");
    expect(release).toContain("Both API overrides are required");
    expect(release).toContain("test -n \"$OVERRIDE_API_ID\" && test -n \"$OVERRIDE_API_HASH\"");
    expect(release).toContain("'-GNinja Multi-Config'");
    expect(release).toContain("CMAKE_MSVC_DEBUG_INFORMATION_FORMAT=Embedded");
    expect(release).not.toContain("CMAKE_MSVC_DEBUG_INFORMATION_FORMAT=ProgramDatabase");
    expect(release).toContain("$env:_LINK_ = '/DEBUG:FASTLINK /OPT:REF /OPT:ICF'");
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
