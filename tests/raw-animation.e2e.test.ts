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
  await Promise.all([
    mkdir(data, { recursive: true }),
    mkdir(clip, { recursive: true }),
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
      `        --enable-decoder=gif \\
        --enable-demuxer=gif \\
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
  it("enables the APNG demuxer and decoder in Windows, macOS, Linux, and Snap builds", async () => {
    const root = await fixture();
    await patch(root);
    const read = (relative: string) => readFile(path.join(root, relative), "utf8");
    const prepare = await read("Telegram/build/prepare/prepare.py");
    const docker = await read("Telegram/build/docker/centos_env/Dockerfile");
    const snap = await read("snap/snapcraft.yaml");
    const helper = await read("Telegram/build/prepare/enable_ffmpeg_apng.py");
    for (const source of [prepare, docker, snap]) {
      expect(source).toContain("--enable-decoder=png");
      expect(source).toContain("--enable-decoder=apng");
      expect(source).toContain("--enable-demuxer=apng");
    }
    expect(prepare).toContain("enable_ffmpeg_apng.py");
    expect(prepare).toContain(
      'python "%ROOT_DIR%\\\\source\\\\Telegram\\\\build\\\\prepare\\\\enable_ffmpeg_apng.py"',
    );
    expect(helper).toContain("build_ffmpeg_win.sh");
    expect(prepare.match(/--enable-decoder=png/g)).toHaveLength(1);
    expect(prepare.match(/--enable-decoder=apng/g)).toHaveLength(1);
    expect(docker.match(/--enable-decoder=apng/g)).toHaveLength(1);
    expect(snap.match(/--enable-decoder=apng/g)).toHaveLength(1);
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
    expect(windows.match(/--enable-decoder=png/g)).toHaveLength(1);
    expect(windows.match(/--enable-decoder=apng/g)).toHaveLength(1);
    expect(windows.match(/--enable-demuxer=apng/g)).toHaveLength(1);
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

  it("configures the shared FFmpeg clip reader to loop GIF/APNG and preserve RGBA alpha", async () => {
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

    expect(cpp).toContain('av_dict_set(&options, "ignore_loop", "0", 0)');
    expect(cpp).toContain("avformat_open_input(&_fmtContext, nullptr, nullptr, &options)");
    expect(cpp).toContain("av_pix_fmt_desc_get(AVPixelFormat(format))");
    expect(cpp).toContain("AV_PIX_FMT_FLAG_ALPHA");
    expect(header).toContain("#include <libavutil/pixdesc.h>");
    expect(cpp.match(/ignore_loop/g)).toHaveLength(1);
  });
});
