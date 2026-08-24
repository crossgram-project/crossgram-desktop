import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { patchRawAnimation } from "../features/raw-animation/patch.js";
import { targetById } from "../src/targets.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture(eol = "\n"): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "crossgram-desktop-raw-animation-"));
  roots.push(root);
  const data = path.join(root, "Telegram", "SourceFiles", "data");
  const clip = path.join(root, "Telegram", "SourceFiles", "media", "clip");
  const ffmpeg = path.join(root, "Telegram", "SourceFiles", "ffmpeg");
  await Promise.all([
    mkdir(data, { recursive: true }),
    mkdir(clip, { recursive: true }),
    mkdir(ffmpeg, { recursive: true }),
    mkdir(path.join(root, "Telegram", "build", "prepare"), { recursive: true }),
    mkdir(path.join(root, "Telegram", "build", "patches"), { recursive: true }),
    mkdir(path.join(root, "Telegram", "build", "docker", "centos_env"), { recursive: true }),
    mkdir(path.join(root, "snap"), { recursive: true }),
  ]);
  const source = `void DocumentData::setattributes(
		const QVector<MTPDocumentAttribute> &attributes) {
	auto wasVideoData = isVideoFile() ? std::move(_additional) : nullptr;

	_videoPreloadPrefix = 0;
	for (const auto &attribute : attributes) {
		attribute.match([&](const MTPDdocumentAttributeImageSize &data) {
			dimensions = QSize(data.vw().v, data.vh().v);
		}, [&](const MTPDdocumentAttributeAnimated &data) {
			if (type == FileDocument
				|| type == VideoDocument
				|| (sticker() && sticker()->type != StickerType::Webm)) {
				type = AnimatedDocument;
				_additional = nullptr;
			}
		}, [&](const MTPDdocumentAttributeSticker &data) {
			const auto was = type;
			if (type == FileDocument || type == VideoDocument) {
				type = StickerDocument;
				_additional = std::make_unique<StickerData>();
			}
		});
	}

	// Any "video/webm" file is treated as a video-sticker.

	// Check sticker size/dimensions properties (for sticker of any type).
	if (type == StickerDocument
		&& ((size > Storage::kMaxStickerBytesSize)
			|| (!sticker()->isLottie()
				&& !GoodStickerDimensions(
					dimensions.width(),
					dimensions.height())))) {
		type = FileDocument;
		_additional = nullptr;
	}

	if (!_filename.isEmpty()) {
		using Type = Core::NameType;
		if (type == VideoDocument
			|| type == AnimatedDocument
			|| type == RoundVideoDocument
			|| isAnimation()) {
			if (!enforceNameType(Type::Video)) {
				type = FileDocument;
				_additional = nullptr;
			}
		}
		if (type == SongDocument || type == VoiceDocument || isAudioFile()) {
		}
	}
}

bool DocumentData::isAnimation() const {
	return (type == AnimatedDocument)
		|| isVideoMessage()
		|| ((_filename.isEmpty()
			|| _nameType == Core::NameType::Image
			|| _nameType == Core::NameType::Video)
			&& hasMimeType(u"image/gif"_q)
			&& !(_flags & Flag::StreamingPlaybackFailed));
}
`;
  await Promise.all([
    writeFile(
      path.join(data, "data_document.cpp"),
      source.replaceAll("\n", eol),
      "utf8",
    ),
    writeFile(
      path.join(root, "Telegram", "build", "prepare", "prepare.py"),
      `        --enable-decoder=gif \\
        --enable-demuxer=gif \\
    bash --login ../patches/build_ffmpeg_win.sh
`.replaceAll("\n", eol),
      "utf8",
    ),
    writeFile(
      path.join(root, "Telegram", "build", "patches", "build_ffmpeg_win.sh"),
      `./configure --prefix=local \\
        --enable-decoder=gif \\
        --enable-demuxer=gif \\

make -j$NUMBER_OF_PROCESSORS
`.replaceAll("\n", eol),
      "utf8",
    ),
    writeFile(
      path.join(root, "Telegram", "build", "docker", "centos_env", "Dockerfile"),
      `\t\t--enable-decoder=gif \\
\t\t--enable-demuxer=gif \\
`.replaceAll("\n", eol),
      "utf8",
    ),
    writeFile(
      path.join(root, "snap", "snapcraft.yaml"),
      `      - --enable-decoder=gif
      - --enable-demuxer=gif
`.replaceAll("\n", eol),
      "utf8",
    ),
    writeFile(
      path.join(clip, "media_clip_ffmpeg.h"),
      `#pragma once
extern "C" {
#include <libswscale/swscale.h>
#include <libavutil/opt.h>
}
`.replaceAll("\n", eol),
      "utf8",
    ),
    writeFile(
      path.join(clip, "media_clip_ffmpeg.cpp"),
      `bool FFMpegReaderImplementation::start(Mode mode, crl::time &positionMs) {
	int res = 0;
	char err[AV_ERROR_MAX_STRING_SIZE] = { 0 };
	if ((res = avformat_open_input(&_fmtContext, nullptr, nullptr, nullptr)) < 0) {
		_ioBuffer = nullptr;
		return false;
	}
	return true;
}

bool FFMpegReaderImplementation::renderFrame(
		QImage &to,
		bool &hasAlpha,
		int &index,
		const QSize &size) {
	const auto format = (_frame->format == AV_PIX_FMT_NONE)
		? _codecContext->pix_fmt
		: _frame->format;
	const auto bgra = (format == AV_PIX_FMT_BGRA);
	hasAlpha = bgra || (format == AV_PIX_FMT_YUVA420P);
	return true;
}
`.replaceAll("\n", eol),
      "utf8",
    ),
    writeFile(
      path.join(ffmpeg, "ffmpeg_frame_generator.cpp"),
      `#include "ffmpeg/ffmpeg_frame_generator.h"

#include "ffmpeg/ffmpeg_utility.h"

FrameGenerator::Frame FrameGenerator::Impl::renderCurrent(
\t\tQImage storage,
\t\tQSize size,
\t\tQt::AspectRatioMode mode) {
\tconst auto frame = _current.frame.get();
\tconst auto srcFormat = (frame->format == AV_PIX_FMT_NONE)
\t\t? _codec->pix_fmt
\t\t: frame->format;
\tconst auto bgra = (srcFormat == AV_PIX_FMT_BGRA);
\tconst auto withAlpha = bgra || (srcFormat == AV_PIX_FMT_YUVA420P);
\tif (withAlpha) {
\t\tPremultiplyInplace(storage);
\t}
\treturn {};
}

FrameGenerator::Impl::Impl(const QByteArray &bytes)
: _bytes(bytes) {
\t_format = MakeFormatPointer(
\t\tstatic_cast<void*>(this),
\t\t&FrameGenerator::Impl::Read,
\t\tnullptr,
\t\t&FrameGenerator::Impl::Seek);

\tauto error = 0;
\tif ((error = avformat_find_stream_info(_format.get(), nullptr))) {
\t\treturn;
\t}
}
`.replaceAll("\n", eol),
      "utf8",
    ),
  ]);
  return root;
}

async function patch(root: string): Promise<string> {
  const options = {
    root,
    target: targetById("materialgram"),
    featureRoot: path.resolve("features/raw-animation"),
  };
  await patchRawAnimation(options);
  await patchRawAnimation(options);
  return readFile(path.join(root, "Telegram", "SourceFiles", "data", "data_document.cpp"), "utf8");
}

describe("Desktop raw GIF/APNG animation patch", () => {
  it("enables APNG demux, decode, and zlib inflate support in every FFmpeg build", async () => {
    const root = await fixture();
    await patch(root);
    const read = (relative: string) => readFile(path.join(root, relative), "utf8");
    const prepare = await read("Telegram/build/prepare/prepare.py");
    const docker = await read("Telegram/build/docker/centos_env/Dockerfile");
    const snap = await read("snap/snapcraft.yaml");
    const helper = await read("Telegram/build/prepare/enable_ffmpeg_apng.py");
    for (const source of [prepare, docker, snap]) {
      expect(source).toContain("--enable-zlib");
      expect(source).toContain("--enable-decoder=png");
      expect(source).toContain("--enable-decoder=apng");
      expect(source).toContain("--enable-demuxer=apng");
    }
    expect(prepare).toContain("enable_ffmpeg_apng.py");
    expect(prepare).toContain(
      'python "%ROOT_DIR%\\\\source\\\\Telegram\\\\build\\\\prepare\\\\enable_ffmpeg_apng.py"',
    );
    expect(helper).toContain("build_ffmpeg_win.sh");
    expect(helper).toContain("../zlib/Release/libzs.lib");
    expect(helper).toContain("../zlib/Release/zlibstatic.lib");
    expect(helper).toContain("../zlib/zconf.h.in");
    expect(helper).toContain("Crossgram MSVC");
    expect(helper).toContain("re.compile");
    expect(helper).toContain("sanitize_zconf_msvc.py");
    expect(helper).toContain("patch_ffmpeg_apng_chunks.py");
    expect(helper).toContain("fcTL may be followed by other chunks");
    expect(helper).toContain("../local/lib/zlib.lib");
    expect(helper).toContain("../local/lib/pkgconfig/zlib.pc");
    expect(helper).toContain('Libs: -L\\\\${libdir} -lz');
    expect(helper).toContain("enable_ffmpeg_msvc_archive.py");
    expect(helper).toContain('$(file >$@.rsp,$^)');
    expect(prepare.match(/--enable-zlib/g)).toHaveLength(1);
    expect(prepare.match(/--enable-decoder=png/g)).toHaveLength(1);
    expect(prepare.match(/--enable-decoder=apng/g)).toHaveLength(1);
    expect(docker.match(/--enable-decoder=apng/g)).toHaveLength(1);
    expect(snap.match(/--enable-decoder=apng/g)).toHaveLength(1);
    expect(docker.match(/--enable-zlib/g)).toHaveLength(1);
    expect(snap.match(/--enable-zlib/g)).toHaveLength(1);
    expect(docker.match(/--enable-demuxer=apng/g)).toHaveLength(1);

    const command = prepare.split(/\r?\n/).find((line) =>
      line.includes("enable_ffmpeg_apng.py"),
    );
    expect(command).toBeDefined();
    const evaluated = spawnSync("python", [
      "-c",
      "import ast,sys; print(ast.literal_eval(chr(34)*3 + sys.stdin.read() + chr(34)*3))",
    ], {
      input: command,
      encoding: "utf8",
    });
    if (evaluated.error) throw evaluated.error;
    expect(evaluated.status).toBe(0);
    expect(evaluated.stdout).not.toContain("\b");
    expect(evaluated.stdout).toContain(
      "%ROOT_DIR%\\source\\Telegram\\build\\prepare\\enable_ffmpeg_apng.py",
    );

    const windowsBuild = path.join(
      root,
      "Telegram/build/patches/build_ffmpeg_win.sh",
    );
    for (let attempt = 0; attempt < 2; attempt++) {
      const applied = spawnSync("python", [
        path.join(root, "Telegram/build/prepare/enable_ffmpeg_apng.py"),
        windowsBuild,
      ], { encoding: "utf8" });
      if (applied.error) throw applied.error;
      expect(applied.status).toBe(0);
    }
    const windows = await readFile(windowsBuild, "utf8");
    expect(windows.match(/--enable-zlib/g)).toHaveLength(1);
    expect(windows.match(/\.\.\/zlib\/Release\/libzs\.lib/g)).toHaveLength(1);
    expect(windows.match(/\.\.\/zlib\/Release\/zlibstatic\.lib/g)).toHaveLength(1);
    expect(windows.match(/\.\.\/zlib\/zconf\.h\.in/g)).toHaveLength(1);
    expect(windows).not.toContain('../zlib/zconf.h"');
    expect(windows).toContain("sanitize_zconf_msvc.py");
    expect(windows).toContain("patch_ffmpeg_apng_chunks.py");
    expect(windows).toContain("ffbuild/config.log");
    expect(windows).toContain('install -m 0644 "$zlib_library"');
    expect(windows.match(/\.\.\/local\/lib\/zlib\.lib/g)).toHaveLength(1);
    expect(windows.match(/\.\.\/local\/lib\/pkgconfig\/zlib\.pc/g)).toHaveLength(1);
    expect(windows).toContain("Libs: -L\\${libdir} -lz");
    expect(windows).toContain('python "$FullScriptPath/enable_ffmpeg_msvc_archive.py" ffbuild/library.mak');
    expect(windows.match(/--enable-decoder=png/g)).toHaveLength(1);
    expect(windows.match(/--enable-decoder=apng/g)).toHaveLength(1);
    expect(windows.match(/--enable-demuxer=apng/g)).toHaveLength(1);
  });

  it("upgrades trees that already have APNG flags but still lack zlib", async () => {
    const root = await fixture();
    const files = [
      "Telegram/build/prepare/prepare.py",
      "Telegram/build/patches/build_ffmpeg_win.sh",
      "Telegram/build/docker/centos_env/Dockerfile",
    ];
    for (const relative of files) {
      const filename = path.join(root, relative);
      const source = await readFile(filename, "utf8");
      await writeFile(filename, source
        .replace("--enable-decoder=gif \\", "--enable-decoder=gif \\\n        --enable-decoder=png \\\n        --enable-decoder=apng \\")
        .replace("--enable-demuxer=gif \\", "--enable-demuxer=gif \\\n        --enable-demuxer=apng \\"), "utf8");
    }
    const snapPath = path.join(root, "snap/snapcraft.yaml");
    const snap = await readFile(snapPath, "utf8");
    await writeFile(snapPath, snap
      .replace("      - --enable-decoder=gif", "      - --enable-decoder=gif\n      - --enable-decoder=png\n      - --enable-decoder=apng")
      .replace("      - --enable-demuxer=gif", "      - --enable-demuxer=gif\n      - --enable-demuxer=apng"), "utf8");

    await patch(root);
    const windowsBuild = path.join(root, "Telegram/build/patches/build_ffmpeg_win.sh");
    const helper = path.join(root, "Telegram/build/prepare/enable_ffmpeg_apng.py");
    for (let attempt = 0; attempt < 2; attempt++) {
      const applied = spawnSync("python", [helper, windowsBuild], { encoding: "utf8" });
      if (applied.error) throw applied.error;
      expect(applied.status).toBe(0);
    }
    for (const relative of [...files, "snap/snapcraft.yaml"]) {
      const source = await readFile(path.join(root, relative), "utf8");
      expect(source.match(/--enable-zlib/g)).toHaveLength(1);
      expect(source.match(/--enable-decoder=apng/g)).toHaveLength(1);
      expect(source.match(/--enable-demuxer=apng/g)).toHaveLength(1);
    }
    const windows = await readFile(windowsBuild, "utf8");
    expect(windows.match(/\.\.\/zlib\/Release\/libzs\.lib/g)).toHaveLength(1);
    expect(windows.match(/\.\.\/zlib\/Release\/zlibstatic\.lib/g)).toHaveLength(1);
    expect(windows.match(/\.\.\/zlib\/zconf\.h\.in/g)).toHaveLength(1);
    expect(windows).not.toContain('../zlib/zconf.h"');
    expect(windows).toContain("sanitize_zconf_msvc.py");
    expect(windows).toContain("ffbuild/config.log");
    expect(windows).toContain('install -m 0644 "$zlib_library"');
    expect(windows.match(/\.\.\/local\/lib\/zlib\.lib/g)).toHaveLength(1);
    expect(windows.match(/\.\.\/local\/lib\/pkgconfig\/zlib\.pc/g)).toHaveLength(1);
    expect(windows).toContain("Libs: -L\\${libdir} -lz");
  });

  it("adds pkg-config metadata to the previous zlib helper without duplicating imports", async () => {
    const root = await fixture();
    await patch(root);
    const windowsBuild = path.join(root, "Telegram/build/prepare/../patches/build_ffmpeg_win.sh");
    await writeFile(windowsBuild, `# APNG and PNG decoders use FFmpeg's zlib inflate wrapper. The Windows
# dependency build keeps zlib outside the FFmpeg prefix, so expose the
# release headers and import library under the conventional -lz name.
install -m 0755 -d "$FullScriptPath/../local/include" "$FullScriptPath/../local/lib"
install -m 0644 "$FullScriptPath/../zlib/zlib.h" "$FullScriptPath/../local/include/zlib.h"
install -m 0644 "$FullScriptPath/../zlib/zconf.h" "$FullScriptPath/../local/include/zconf.h"
install -m 0644 "$FullScriptPath/../zlib/Release/libzs.lib" "$FullScriptPath/../local/lib/zlib.lib"

./configure --prefix=local \\
        --enable-decoder=gif \\
        --enable-zlib \\
        --enable-decoder=png \\
        --enable-decoder=apng \\
        --enable-demuxer=gif \\
        --enable-demuxer=apng \\

make -j$NUMBER_OF_PROCESSORS
`, "utf8");
    const helper = path.join(root, "Telegram/build/prepare/enable_ffmpeg_apng.py");
    for (let pass = 0; pass < 2; pass++) {
      const applied = spawnSync("python", [helper, windowsBuild], { encoding: "utf8" });
      expect(applied.status, applied.stderr).toBe(0);
    }
    const windows = await readFile(windowsBuild, "utf8");
    expect(windows.match(/\.\.\/local\/lib\/zlib\.lib/g)).toHaveLength(1);
    expect(windows.match(/\.\.\/local\/lib\/pkgconfig\/zlib\.pc/g)).toHaveLength(1);
    expect(windows.match(/Name: zlib/g)).toHaveLength(1);
  });

  it("disables zconf's Windows unistd include gate without touching FFmpeg probes", async () => {
    const root = await fixture();
    await patch(root);
    const build = path.join(
      root,
      "Telegram/build/prepare/enable_ffmpeg_apng.py",
    );
    const windows = path.join(
      root,
      "Telegram/build/patches/build_ffmpeg_win.sh",
    );
    const generated = spawnSync("python", [build, windows], { encoding: "utf8" });
    expect(generated.status, generated.stderr).toBe(0);
    const helper = path.join(
      root,
      "Telegram/build/patches/sanitize_zconf_msvc.py",
    );
    const variants = [
      "#if 0 /* CMake feature probe */\n#  if defined(Z_HAVE_UNISTD_H)\n#    include <unistd.h>\n",
      "#if 0 /* CMake feature probe */\n#ifdef Z_HAVE_UNISTD_H\n# include <unistd.h>\n",
      "#if 0 /* CMake feature probe */\n#  if defined(Z_HAVE_UNISTD_H) && !defined(_WIN32) /* Crossgram MSVC */\n# include <unistd.h>\n",
    ];
    for (const [index, source] of variants.entries()) {
      const header = path.join(root, `zconf-${index}.h`);
      await writeFile(header, source, "utf8");
      for (let pass = 0; pass < 2; pass++) {
        const sanitized = spawnSync("python", [helper, header], { encoding: "utf8" });
        expect(sanitized.status, sanitized.stderr).toBe(0);
      }
      const staged = await readFile(header, "utf8");
      expect(staged).toContain("defined(Z_HAVE_UNISTD_H) && !defined(_WIN32)");
      expect(staged.match(/Crossgram MSVC/g)).toHaveLength(1);
    }
  });

  it("moves the oversized MSVC archive object list into a make response file", async () => {
    const root = await fixture();
    await patch(root);
    const windowsBuild = path.join(root, "Telegram/build/prepare/../patches/build_ffmpeg_win.sh");
    const helper = path.join(root, "Telegram/build/prepare/enable_ffmpeg_apng.py");
    const applied = spawnSync("python", [helper, windowsBuild], { encoding: "utf8" });
    expect(applied.status, applied.stderr).toBe(0);
    const archiveHelper = path.join(
      root,
      "Telegram/build/prepare/../patches/enable_ffmpeg_msvc_archive.py",
    );
    const library = path.join(root, "ffbuild-library.mak");
    await writeFile(library, `$(SUBDIR)$(LIBNAME): $(OBJS) $(STLIBOBJS)
\t$(RM) $@
\t$(AR) $(ARFLAGS) $(AR_O) $^
\t$(RANLIB) $@
`, "utf8");
    for (let pass = 0; pass < 2; pass++) {
      const patched = spawnSync("python", [archiveHelper, library], { encoding: "utf8" });
      expect(patched.status, patched.stderr).toBe(0);
    }
    const recipe = await readFile(library, "utf8");
    expect(recipe.match(/\$\(file >\$@\.rsp,\$\^\)/g)).toHaveLength(1);
    expect(recipe).toContain("$(AR) $(ARFLAGS) $(AR_O) @$@.rsp");
    expect(recipe).toContain("$(RM) $@.rsp");
  });

  it("keeps Animated attributes on stickers and custom reactions in the clip-reader path", async () => {
    const source = await patch(await fixture());
    expect(source).toContain("crossgramAnimatedAttribute = true;");
    expect(source).toContain("Raw GIF/APNG stickers stay StickerDocument");
    expect(source).toContain("info && (crossgramRawAnimationMime || crossgramAnimatedAttribute)");
    expect(source).toContain("info->type = StickerType::Webm;");
    expect(source.indexOf("Raw GIF/APNG stickers stay StickerDocument"))
      .toBeGreaterThan(source.lastIndexOf("MTPDdocumentAttributeSticker"));
    expect(source.match(/Raw GIF\/APNG stickers stay StickerDocument/g)).toHaveLength(1);
  });

  it("defers raw animation classification until Sticker and Animated attributes are both known", async () => {
    const source = await patch(await fixture());
    const animated = source.indexOf("MTPDdocumentAttributeAnimated");
    const sticker = source.indexOf("MTPDdocumentAttributeSticker");
    const finalClassification = source.indexOf("Raw GIF/APNG stickers stay StickerDocument");

    expect(animated).toBeGreaterThan(-1);
    expect(sticker).toBeGreaterThan(animated);
    expect(finalClassification).toBeGreaterThan(sticker);
    expect(source.slice(animated, sticker)).not.toContain("info->type = StickerType::Webm");
    expect(source.indexOf("crossgramAnimatedAttribute = true;", animated))
      .toBeLessThan(source.indexOf("} else if (type == FileDocument", animated));
  });

  it("accepts source-sized PNG/GIF/APNG stickers instead of applying Telegram upload limits", async () => {
    const source = await patch(await fixture());
    expect(source).toContain('const auto rawImageSticker = sticker()');
    expect(source).toContain('hasMimeType(u"image/png"_q)');
    expect(source).toContain("&& !rawImageSticker");
    expect(source.indexOf("&& !rawImageSticker"))
      .toBeLessThan(source.indexOf("size > Storage::kMaxStickerBytesSize"));
  });

  it("classifies image/apng without forcing image filenames into a video extension", async () => {
    const source = await patch(await fixture());
    expect(source).toContain('|| hasMimeType(u"image/apng"_q))');
    expect(source).toContain("APNG can be identified by MIME even without an Animated attribute");
    expect(source).toContain("if (!rawImageAnimation && !enforceNameType(Type::Video))");
    expect(source.match(/const auto rawImageAnimation = isAnimation\(\)/g)).toHaveLength(1);
  });

  it("preserves CRLF while applying every edit once", async () => {
    const source = await patch(await fixture("\r\n"));
    expect(source.replaceAll("\r\n", "")).not.toContain("\n");
    expect(source.match(/const auto rawImageSticker = sticker\(\)/g)).toHaveLength(1);
    expect(source.match(/const auto rawImageAnimation = isAnimation\(\)/g)).toHaveLength(1);
  });

  it("keeps GIF/APNG looping in the clip reader and preserves RGBA alpha", async () => {
    const root = await fixture();
    await patch(root);
    const cpp = await readFile(path.join(
      root,
      "Telegram/SourceFiles/media/clip/media_clip_ffmpeg.cpp",
    ), "utf8");
    const header = await readFile(path.join(
      root,
      "Telegram/SourceFiles/media/clip/media_clip_ffmpeg.h",
    ), "utf8");

    expect(cpp).toContain("avformat_open_input(&_fmtContext, nullptr, nullptr, nullptr)");
    expect(cpp).not.toContain("ignore_loop");
    expect(cpp).toContain("av_pix_fmt_desc_get(AVPixelFormat(format))");
    expect(cpp).toContain("AV_PIX_FMT_FLAG_ALPHA");
    expect(header).toContain("#include <libavutil/pixdesc.h>");
  });

  it("backports FFmpeg support for ancillary chunks before APNG frame data", async () => {
    const root = await fixture();
    await patch(root);
    const windowsBuild = path.join(root, "Telegram/build/patches/build_ffmpeg_win.sh");
    const helper = path.join(root, "Telegram/build/prepare/enable_ffmpeg_apng.py");
    const generated = spawnSync("python", [helper, windowsBuild], { encoding: "utf8" });
    expect(generated.status, generated.stderr).toBe(0);

    const apngHelper = path.join(
      root,
      "Telegram/build/patches/patch_ffmpeg_apng_chunks.py",
    );
    const source = path.join(root, "apngdec.c");
    await writeFile(source, `        /* fcTL must precede fdAT or IDAT */
        len = avio_rb32(pb);
        tag = avio_rl32(pb);
        if (len > 0x7fffffff ||
            tag != MKTAG('f', 'd', 'A', 'T') &&
            tag != MKTAG('I', 'D', 'A', 'T'))
            return AVERROR_INVALIDDATA;
`, "utf8");
    for (let pass = 0; pass < 2; pass++) {
      const applied = spawnSync("python", [apngHelper, source], { encoding: "utf8" });
      expect(applied.status, applied.stderr).toBe(0);
    }
    const patched = await readFile(source, "utf8");
    expect(patched).toContain("fcTL may be followed by other chunks before fdAT or IDAT");
    expect(patched).toContain("check for empty frame");
    expect(patched).not.toContain("fcTL must precede fdAT or IDAT");
    expect(patched.match(/fcTL may be followed/g)).toHaveLength(1);
  });

  it("removes the previous demuxer-managed loop from already-patched trees", async () => {
    const root = await fixture();
    const filename = path.join(
      root,
      "Telegram/SourceFiles/media/clip/media_clip_ffmpeg.cpp",
    );
    const source = await readFile(filename, "utf8");
    await writeFile(filename, source.replace(
      `\tif ((res = avformat_open_input(&_fmtContext, nullptr, nullptr, nullptr)) < 0) {
\t\t_ioBuffer = nullptr;`,
      `\tauto options = static_cast<AVDictionary*>(nullptr);
\t// Stickers and GIF messages always loop in the UI. Let the GIF/APNG
\t// demuxers replay their native animation instead of relying on seeking,
\t// which is not reliable for every APNG stream.
\tav_dict_set(&options, "ignore_loop", "0", 0);
\tres = avformat_open_input(&_fmtContext, nullptr, nullptr, &options);
\tav_dict_free(&options);
\tif (res < 0) {
\t\t_ioBuffer = nullptr;`,
    ), "utf8");

    await patch(root);
    const upgraded = await readFile(filename, "utf8");
    expect(upgraded).not.toContain("ignore_loop");
    expect(upgraded).not.toContain("AVDictionary");
    expect(upgraded).toContain(
      "avformat_open_input(&_fmtContext, nullptr, nullptr, nullptr)",
    );
    expect(upgraded.match(/avformat_open_input/g)).toHaveLength(1);
  });

  it("premultiplies every alpha-bearing format in the sticker frame generator", async () => {
    const root = await fixture();
    await patch(root);
    const cpp = await readFile(path.join(
      root,
      "Telegram/SourceFiles/ffmpeg/ffmpeg_frame_generator.cpp",
    ), "utf8");

    expect(cpp).toContain("#include <libavutil/pixdesc.h>");
    expect(cpp).toContain("av_pix_fmt_desc_get(AVPixelFormat(srcFormat))");
    expect(cpp).toContain("descriptor->flags & AV_PIX_FMT_FLAG_ALPHA");
    expect(cpp).toContain("straight-alpha RGB");
    expect(cpp).not.toContain(
      "const auto withAlpha = bgra || (srcFormat == AV_PIX_FMT_YUVA420P);",
    );
    expect(cpp.indexOf("const auto withAlpha = descriptor"))
      .toBeLessThan(cpp.indexOf("PremultiplyInplace(storage)"));
    expect(cpp.match(/#include <libavutil\/pixdesc\.h>/g)).toHaveLength(1);
  });

  it("does not call avformat_find_stream_info after FFmpeg rejects cached bytes", async () => {
    const root = await fixture();
    await patch(root);
    const cpp = await readFile(path.join(
      root,
      "Telegram/SourceFiles/ffmpeg/ffmpeg_frame_generator.cpp",
    ), "utf8");

    const guard = cpp.indexOf("if (!_format)");
    const probe = cpp.indexOf("avformat_find_stream_info");
    expect(guard).toBeGreaterThan(-1);
    expect(probe).toBeGreaterThan(guard);
    expect(cpp).toContain("do not pass that null context back into libavformat");
    expect(cpp.match(/if \(!_format\)/g)).toHaveLength(1);
  });
});
