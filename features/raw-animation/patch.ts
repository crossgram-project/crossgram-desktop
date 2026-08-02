import { PatchContext } from "../../src/core/patch-context.js";
import type { Target } from "../../src/targets.js";

interface PatchOptions {
  readonly root: string;
  readonly target: Target;
  readonly featureRoot: string;
}

const sourceRoot = "Telegram/SourceFiles";

/**
 * Keep Crossgram's raw GIF/APNG documents and stickers in the existing
 * FFmpeg-backed animation paths instead of requiring relay-side WebM/WebP
 * conversion.
 */
export async function patchRawAnimation(options: PatchOptions): Promise<void> {
  const context = new PatchContext(options.root, options.target, options.featureRoot);

  await context.install(
    "enable_ffmpeg_apng.py",
    "Telegram/build/prepare/enable_ffmpeg_apng.py",
  );

  await context.edit("Telegram/build/prepare/prepare.py", (file) => {
    file.replacePattern(
      /^([ \t]+)--enable-decoder=gif \\$/m,
      "$1--enable-decoder=gif \\\n$1--enable-decoder=png \\",
      "--enable-decoder=png",
    );
    file.replacePattern(
      /^([ \t]+)--enable-demuxer=gif \\$/m,
      "$1--enable-demuxer=gif \\\n$1--enable-demuxer=apng \\",
      "--enable-demuxer=apng",
    );
    file.insertBefore(
      "    bash --login ../patches/build_ffmpeg_win.sh",
      `    python "%ROOT_DIR%\\\\source\\\\Telegram\\\\build\\\\prepare\\\\enable_ffmpeg_apng.py" ../patches/build_ffmpeg_win.sh
`,
      "enable_ffmpeg_apng.py",
    );
  });

  await context.edit("Telegram/build/docker/centos_env/Dockerfile", (file) => {
    file.replacePattern(
      /^([ \t]+)--enable-decoder=gif \\$/m,
      "$1--enable-decoder=gif \\\n$1--enable-decoder=png \\",
      "--enable-decoder=png",
    );
    file.replacePattern(
      /^([ \t]+)--enable-demuxer=gif \\$/m,
      "$1--enable-demuxer=gif \\\n$1--enable-demuxer=apng \\",
      "--enable-demuxer=apng",
    );
  });

  if (options.target.id !== "ayugram") {
    await context.edit("snap/snapcraft.yaml", (file) => {
      file.insertAfter(
        "      - --enable-decoder=gif",
        "\n      - --enable-decoder=png",
        "--enable-decoder=png",
      );
      file.insertAfter(
        "      - --enable-demuxer=gif",
        "\n      - --enable-demuxer=apng",
        "--enable-demuxer=apng",
      );
    });
  }

  await context.edit(`${sourceRoot}/data/data_document.cpp`, (file) => {
    file.insertBefore(
      `\tauto wasVideoData = isVideoFile() ? std::move(_additional) : nullptr;

\t_videoPreloadPrefix = 0;`,
      `\tconst auto crossgramRawAnimationMime = hasMimeType(u"image/gif"_q)
\t\t|| hasMimeType(u"image/apng"_q);
\tauto crossgramAnimatedAttribute = false;

`,
      "const auto crossgramRawAnimationMime",
    );

    file.replace(
      `\t\t}, [&](const MTPDdocumentAttributeAnimated &data) {
\t\t\tif (type == FileDocument
\t\t\t\t|| type == VideoDocument
\t\t\t\t|| (sticker() && sticker()->type != StickerType::Webm)) {
\t\t\t\ttype = AnimatedDocument;
\t\t\t\t_additional = nullptr;
\t\t\t}
\t\t}, [&](const MTPDdocumentAttributeSticker &data) {`,
      `\t\t}, [&](const MTPDdocumentAttributeAnimated &data) {
\t\t\tif (crossgramRawAnimationMime
\t\t\t\t|| hasMimeType(u"image/png"_q)) {
\t\t\t\t// Defer raw image classification until every attribute was read.
\t\t\t\t// Telegram does not guarantee Sticker precedes Animated.
\t\t\t\tcrossgramAnimatedAttribute = true;
\t\t\t} else if (type == FileDocument
\t\t\t\t|| type == VideoDocument
\t\t\t\t|| (sticker() && sticker()->type != StickerType::Webm)) {
\t\t\t\ttype = AnimatedDocument;
\t\t\t\t_additional = nullptr;
\t\t\t}
\t\t}, [&](const MTPDdocumentAttributeSticker &data) {`,
      "crossgramAnimatedAttribute = true",
    );

    file.insertBefore(
      `\t// Any "video/webm" file is treated as a video-sticker.`,
      `\t// Raw GIF/APNG stickers stay StickerDocument regardless of attribute
\t// order, while the existing Webm player selects the generic FFmpeg reader.
\tif (const auto info = sticker();
\t\tinfo && (crossgramRawAnimationMime || crossgramAnimatedAttribute)) {
\t\tinfo->type = StickerType::Webm;
\t} else if (crossgramAnimatedAttribute
\t\t&& (type == FileDocument || type == VideoDocument)) {
\t\ttype = AnimatedDocument;
\t\t_additional = nullptr;
\t}

`,
      "Raw GIF/APNG stickers stay StickerDocument",
    );

    file.replace(
      `\t// Check sticker size/dimensions properties (for sticker of any type).
\tif (type == StickerDocument
\t\t&& ((size > Storage::kMaxStickerBytesSize)
\t\t\t|| (!sticker()->isLottie()
\t\t\t\t&& !GoodStickerDimensions(
\t\t\t\t\tdimensions.width(),
\t\t\t\t\tdimensions.height())))) {
\t\ttype = FileDocument;
\t\t_additional = nullptr;
\t}`,
      `\t// Crossgram may expose the original PNG/GIF/APNG sticker instead of a
\t// Telegram-sized WebP/WebM derivative. The FFmpeg/image readers scale it
\t// client-side, so the Telegram upload limits do not apply to this input.
\tconst auto rawImageSticker = sticker()
\t\t&& (hasMimeType(u"image/png"_q)
\t\t\t|| hasMimeType(u"image/gif"_q)
\t\t\t|| hasMimeType(u"image/apng"_q));
\tif (type == StickerDocument
\t\t&& !rawImageSticker
\t\t&& ((size > Storage::kMaxStickerBytesSize)
\t\t\t|| (!sticker()->isLottie()
\t\t\t\t&& !GoodStickerDimensions(
\t\t\t\t\tdimensions.width(),
\t\t\t\t\tdimensions.height())))) {
\t\ttype = FileDocument;
\t\t_additional = nullptr;
\t}`,
      "const auto rawImageSticker = sticker()",
    );

    file.replace(
      `\tif (!_filename.isEmpty()) {
\t\tusing Type = Core::NameType;
\t\tif (type == VideoDocument
\t\t\t|| type == AnimatedDocument
\t\t\t|| type == RoundVideoDocument
\t\t\t|| isAnimation()) {
\t\t\tif (!enforceNameType(Type::Video)) {
\t\t\t\ttype = FileDocument;
\t\t\t\t_additional = nullptr;
\t\t\t}
\t\t}`,
      `\tif (!_filename.isEmpty()) {
\t\tusing Type = Core::NameType;
\t\tconst auto rawImageAnimation = isAnimation()
\t\t\t&& (hasMimeType(u"image/gif"_q)
\t\t\t\t|| hasMimeType(u"image/apng"_q)
\t\t\t\t|| hasMimeType(u"image/png"_q));
\t\tif (type == VideoDocument
\t\t\t|| type == AnimatedDocument
\t\t\t|| type == RoundVideoDocument
\t\t\t|| isAnimation()) {
\t\t\tif (!rawImageAnimation && !enforceNameType(Type::Video)) {
\t\t\t\ttype = FileDocument;
\t\t\t\t_additional = nullptr;
\t\t\t}
\t\t}`,
      "const auto rawImageAnimation = isAnimation()",
    );

    file.replace(
      `\treturn (type == AnimatedDocument)
\t\t|| isVideoMessage()
\t\t|| ((_filename.isEmpty()
\t\t\t|| _nameType == Core::NameType::Image
\t\t\t|| _nameType == Core::NameType::Video)
\t\t\t&& hasMimeType(u"image/gif"_q)
\t\t\t&& !(_flags & Flag::StreamingPlaybackFailed));`,
      `\treturn (type == AnimatedDocument)
\t\t|| isVideoMessage()
\t\t|| ((_filename.isEmpty()
\t\t\t|| _nameType == Core::NameType::Image
\t\t\t|| _nameType == Core::NameType::Video)
\t\t\t// APNG can be identified by MIME even without an Animated attribute.
\t\t\t&& (hasMimeType(u"image/gif"_q)
\t\t\t\t|| hasMimeType(u"image/apng"_q))
\t\t\t&& !(_flags & Flag::StreamingPlaybackFailed));`,
      "APNG can be identified by MIME even without an Animated attribute",
    );
  });

  await context.edit(`${sourceRoot}/media/clip/media_clip_ffmpeg.h`, (file) => {
    file.insertAfter(
      "#include <libavutil/opt.h>",
      "\n#include <libavutil/pixdesc.h>",
      "#include <libavutil/pixdesc.h>",
    );
  });

  await context.edit(`${sourceRoot}/media/clip/media_clip_ffmpeg.cpp`, (file) => {
    file.replace(
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
      'av_dict_set(&options, "ignore_loop", "0", 0)',
    );

    file.replace(
      `\tconst auto bgra = (format == AV_PIX_FMT_BGRA);
\thasAlpha = bgra || (format == AV_PIX_FMT_YUVA420P);`,
      `\tconst auto bgra = (format == AV_PIX_FMT_BGRA);
\tconst auto descriptor = av_pix_fmt_desc_get(AVPixelFormat(format));
\thasAlpha = descriptor && (descriptor->flags & AV_PIX_FMT_FLAG_ALPHA);`,
      "AV_PIX_FMT_FLAG_ALPHA",
    );
  });
}
