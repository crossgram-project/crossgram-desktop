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
archive_helper = path.with_name("enable_ffmpeg_msvc_archive.py")
archive_helper.write_text(
    """#!/usr/bin/env python3
from pathlib import Path
import sys

if len(sys.argv) != 2:
    raise SystemExit("usage: enable_ffmpeg_msvc_archive.py <ffbuild/library.mak>")

path = Path(sys.argv[1])
text = path.read_text(encoding="utf-8")
before = "\\t$(AR) $(ARFLAGS) $(AR_O) $^"
after = (
    "\\t$(file >$@.rsp,$^)\\n"
    "\\t$(AR) $(ARFLAGS) $(AR_O) @$@.rsp\\n"
    "\\t$(RM) $@.rsp"
)
if after not in text:
    if text.count(before) != 1:
        raise RuntimeError("expected one FFmpeg static archive recipe")
    text = text.replace(before, after)
    path.write_text(text, encoding="utf-8")
""",
    encoding="utf-8",
)
archive_install = (
    "zlib_library=\n"
    "for candidate in \\\n"
    "    \"$FullScriptPath/../zlib/Release/libzs.lib\" \\\n"
    "    \"$FullScriptPath/../zlib/Release/zlibstatic.lib\" \\\n"
    "    \"$FullScriptPath/../zlib/Release/zlib.lib\"; do\n"
    "    if [ -f \"$candidate\" ]; then zlib_library=\"$candidate\"; break; fi\n"
    "done\n"
    "if [ -z \"$zlib_library\" ]; then echo \"Windows zlib archive was not found\" >&2; exit 1; fi\n"
    "install -m 0644 \"$zlib_library\" \"$FullScriptPath/../local/lib/zlib.lib\"\n"
)
legacy_archive_install = (
    "install -m 0644 \"$FullScriptPath/../zlib/Release/libzs.lib\" "
    "\"$FullScriptPath/../local/lib/zlib.lib\"\n"
)
if legacy_archive_install in text:
    text = text.replace(legacy_archive_install, archive_install)
text = insert_before(
    text,
    "./configure --prefix=",
    "# APNG and PNG decoders use FFmpeg's zlib inflate wrapper. The Windows\n"
    "# dependency build keeps zlib outside the FFmpeg prefix, so expose the\n"
    "# release headers and import library under the conventional -lz name.\n"
    "install -m 0755 -d \"$FullScriptPath/../local/include\" \"$FullScriptPath/../local/lib\"\n"
    "install -m 0644 \"$FullScriptPath/../zlib/zlib.h\" \"$FullScriptPath/../local/include/zlib.h\"\n"
    "install -m 0644 \"$FullScriptPath/../zlib/zconf.h\" \"$FullScriptPath/../local/include/zconf.h\"\n"
    + archive_install
    + "\n",
)
text = insert_before(
    text,
    "./configure --prefix=",
    "# Make pkg-config resolve zlib from the same MSVC prefix instead of a\n"
    "# system MinGW installation whose import library is not link-compatible.\n"
    "install -m 0755 -d \"$FullScriptPath/../local/lib/pkgconfig\"\n"
    "cat > \"$FullScriptPath/../local/lib/pkgconfig/zlib.pc\" <<EOF\n"
    "prefix=$FullScriptPath/../local\n"
    "exec_prefix=\\${prefix}\n"
    "libdir=\\${exec_prefix}/lib\n"
    "includedir=\\${prefix}/include\n\n"
    "Name: zlib\n"
    "Description: zlib compression library\n"
    "Version: 1.3.1\n"
    "Libs: -L\\${libdir} -lz\n"
    "Cflags: -I\\${includedir}\n"
    "EOF\n\n",
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
text = insert_before(
    text,
    "make -j$NUMBER_OF_PROCESSORS\n",
    "# MSVC's lib.exe command line overflows after enabling PNG/APNG objects.\n"
    "# Let GNU make write the object list directly to a response file.\n"
    "python \"$FullScriptPath/enable_ffmpeg_msvc_archive.py\" ffbuild/library.mak\n\n",
)
path.write_text(text, encoding="utf-8")
