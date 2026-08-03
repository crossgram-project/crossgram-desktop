#!/usr/bin/env python3
"""Enable the FFmpeg demuxer, decoder, and inflate dependency for APNG."""

from pathlib import Path
import re
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
zconf_helper = path.with_name("sanitize_zconf_msvc.py")
zconf_helper.write_text(
    """#!/usr/bin/env python3
from pathlib import Path
import re
import sys

if len(sys.argv) != 2:
    raise SystemExit("usage: sanitize_zconf_msvc.py <zconf.h>")

path = Path(sys.argv[1])
text = path.read_text(encoding="utf-8")
safe = "#if 0 /* Crossgram MSVC: no unistd.h */"
if safe not in text:
    pattern = re.compile(r"(?m)^#if\\s+HAVE_UNISTD_H(?:\\s*-\\s*0)?(?:\\s*/\\*.*)?\\s*$")
    text, count = pattern.subn(safe, text)
    if count != 1:
        raise RuntimeError(
            "expected one zconf HAVE_UNISTD_H conditional, found " + str(count)
        )
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
legacy_zconf_install = (
    "install -m 0644 \"$FullScriptPath/../zlib/zconf.h\" "
    "\"$FullScriptPath/../local/include/zconf.h\"\n"
)
zconf_msvc_sanitize = (
    "# FFmpeg's generated config.h defines HAVE_UNISTD_H while compiling with\n"
    "# MSVC. Do not let zconf.h turn that probe into an unavailable unistd.h\n"
    "# include. zlib itself has already been built before this staging step.\n"
    "python \"$FullScriptPath/sanitize_zconf_msvc.py\" "
    "\"$FullScriptPath/../local/include/zconf.h\"\n"
)
configure_failure_log = (
    "# Preserve FFmpeg's failed feature probes in the CI log.\n"
    "trap 'status=$?; if [ \"$status\" -ne 0 ] && [ -f ffbuild/config.log ]; "
    "then cat ffbuild/config.log >&2; fi; exit \"$status\"' ERR\n"
)
if legacy_archive_install in text:
    text = text.replace(legacy_archive_install, archive_install)
if legacy_zconf_install in text:
    text = text.replace(
        legacy_zconf_install,
        "install -m 0644 \"$FullScriptPath/../zlib/zconf.h.in\" "
        "\"$FullScriptPath/../local/include/zconf.h\"\n",
    )
if archive_install.strip() not in text:
    text = insert_before(
        text,
        "./configure --prefix=",
        "# APNG and PNG decoders use FFmpeg's zlib inflate wrapper. The Windows\n"
        "# dependency build keeps zlib outside the FFmpeg prefix, so expose the\n"
        "# release headers and import library under the conventional -lz name.\n"
        "install -m 0755 -d \"$FullScriptPath/../local/include\" \"$FullScriptPath/../local/lib\"\n"
        "install -m 0644 \"$FullScriptPath/../zlib/zlib.h\" \"$FullScriptPath/../local/include/zlib.h\"\n"
        "# Avoid CMake's MSYS unistd.h detection leaking into the MSVC build.\n"
        "install -m 0644 \"$FullScriptPath/../zlib/zconf.h.in\" \"$FullScriptPath/../local/include/zconf.h\"\n"
        + archive_install
        + "\n",
    )
text = insert_before(
    text,
    "./configure --prefix=",
    zconf_msvc_sanitize,
)
text = insert_before(
    text,
    "./configure --prefix=",
    configure_failure_log,
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
