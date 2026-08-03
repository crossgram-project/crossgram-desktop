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


if len(sys.argv) != 2:
    raise SystemExit("usage: enable_ffmpeg_apng.py <build_ffmpeg_win.sh>")

path = Path(sys.argv[1])
text = path.read_text(encoding="utf-8")
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
