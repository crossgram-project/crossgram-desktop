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
  await Promise.all([
    mkdir(data, { recursive: true }),
    mkdir(path.join(root, "Telegram", "build", "prepare"), { recursive: true }),
    mkdir(path.join(root, "Telegram", "build", "docker", "centos_env"), { recursive: true }),
    mkdir(path.join(root, "snap"), { recursive: true }),
  ]);
  const source = `void DocumentData::setattributes(
		const QVector<MTPDocumentAttribute> &attributes) {
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
		});
	}

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
  it("enables APNG demuxing in Windows, macOS, Linux, and Snap dependency builds", async () => {
    const root = await fixture();
    await patch(root);
    const read = (relative: string) => readFile(path.join(root, relative), "utf8");
    const prepare = await read("Telegram/build/prepare/prepare.py");
    const docker = await read("Telegram/build/docker/centos_env/Dockerfile");
    const snap = await read("snap/snapcraft.yaml");
    const helper = await read("Telegram/build/prepare/enable_ffmpeg_apng.py");
    for (const source of [prepare, docker, snap]) {
      expect(source).toContain("--enable-decoder=png");
      expect(source).toContain("--enable-demuxer=apng");
    }
    expect(prepare).toContain("enable_ffmpeg_apng.py");
    expect(helper).toContain("build_ffmpeg_win.sh");
    expect(prepare.match(/--enable-decoder=png/g)).toHaveLength(1);
    expect(docker.match(/--enable-demuxer=apng/g)).toHaveLength(1);
  });

  it("keeps Animated attributes on stickers and custom reactions in the clip-reader path", async () => {
    const source = await patch(await fixture());
    expect(source).toContain("if (const auto info = sticker(); info && rawImage)");
    expect(source).toContain("info->type = StickerType::Webm;");
    expect(source.match(/preserves alpha and timing for raw GIF\/APNG bytes/g)).toHaveLength(1);
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
});
