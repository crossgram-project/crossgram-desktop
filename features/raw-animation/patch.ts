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
      `    python "%ROOT_DIR%\\Telegram\\build\\prepare\\enable_ffmpeg_apng.py" ../patches/build_ffmpeg_win.sh
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
\t\t\tconst auto rawImage = hasMimeType(u"image/gif"_q)
\t\t\t\t|| hasMimeType(u"image/apng"_q)
\t\t\t\t|| hasMimeType(u"image/png"_q);
\t\t\tif (const auto info = sticker(); info && rawImage) {
\t\t\t\t// The Webm sticker path is an FFmpeg-backed generic clip reader.
\t\t\t\t// It also preserves alpha and timing for raw GIF/APNG bytes.
\t\t\t\tinfo->type = StickerType::Webm;
\t\t\t} else if (type == FileDocument
\t\t\t\t|| type == VideoDocument
\t\t\t\t|| (sticker() && sticker()->type != StickerType::Webm)) {
\t\t\t\ttype = AnimatedDocument;
\t\t\t\t_additional = nullptr;
\t\t\t}
\t\t}, [&](const MTPDdocumentAttributeSticker &data) {`,
      "preserves alpha and timing for raw GIF/APNG bytes",
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
}
