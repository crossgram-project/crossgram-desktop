#!/usr/bin/env python3
"""Enable the FFmpeg demuxer, decoder, and inflate dependency for APNG."""

from pathlib import Path
import sys


def insert_after(source: str, anchor: str, addition: str) -> str:
    if addition.strip() in source:
        return source
    if source.count(anchor) != 1:
        raise RuntimeError(f"expected one FFmpeg flag anchor: {anchor.strip()}")
    return source.replace(anchor, anchor + addition)


def insert_before(source: str, anchor: str, addition: str) -> str:
    if addition.strip() in source:
        return source
    if source.count(anchor) != 1:
        raise RuntimeError(f"expected one FFmpeg flag anchor: {anchor.strip()}")
    return source.replace(anchor, addition + anchor)


if len(sys.argv) != 2:
    raise SystemExit("usage: enable_ffmpeg_apng.py <build_ffmpeg_win.sh>")

path = Path(sys.argv[1])
text = path.read_text(encoding="utf-8")
text = insert_before(
    text,
    "./configure --prefix=",
    "# APNG and PNG decoders use FFmpeg's zlib inflate wrapper. The Windows\n"
    "# dependency build keeps zlib outside the FFmpeg prefix, so expose the\n"
    "# release headers and import library under the conventional -lz name.\n"
    "install -m 0755 -d \"$FullScriptPath/../local/include\" \"$FullScriptPath/../local/lib\"\n"
    "install -m 0644 \"$FullScriptPath/../zlib/zlib.h\" \"$FullScriptPath/../local/include/zlib.h\"\n"
    "install -m 0644 \"$FullScriptPath/../zlib/zconf.h\" \"$FullScriptPath/../local/include/zconf.h\"\n"
    "install -m 0644 \"$FullScriptPath/../zlib/Release/libzs.lib\" \"$FullScriptPath/../local/lib/z.lib\"\n\n",
)
text = insert_after(
    text,
    "--enable-decoder=gif \\\n",
    "        --enable-zlib \\\n",
)
text = insert_after(
    text,
    "--enable-decoder=gif \\\n",
    "        --enable-decoder=png \\\n"
    "        --enable-decoder=apng \\\n",
)
text = insert_after(
    text,
    "--enable-demuxer=gif \\\n",
    "        --enable-demuxer=apng \\\n",
)
path.write_text(text, encoding="utf-8")
