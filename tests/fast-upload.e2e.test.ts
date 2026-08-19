import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { patchFastUpload } from "../features/fast-upload/patch.js";
import { targetById } from "../src/targets.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function patchedFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "crossgram-desktop-fast-upload-"));
  roots.push(root);
  const source = path.join(root, "Telegram/SourceFiles");
  await Promise.all([
    mkdir(path.join(source, "mtproto/scheme"), { recursive: true }),
    mkdir(path.join(source, "storage"), { recursive: true }),
  ]);
  await writeFile(path.join(root, "Telegram/CMakeLists.txt"), `set(SOURCES
    crossgram/direct_download.cpp
    crossgram/direct_download.h
)
`);
  await writeFile(path.join(source, "mtproto/scheme/api.tl"), `---functions---
crossgram.getFileUrl#7520f6ea location:InputFileLocation = DataJSON;
`);
  await writeFile(path.join(source, "storage/file_upload.h"), `#pragma once
struct FilePrepareResult;
namespace Storage {
class Uploader {
private:
	void maybeSend();
};
}
`);
  await writeFile(path.join(source, "storage/file_upload.cpp"), `#include "apiwrap.h"
namespace Storage {
void Uploader::upload(
		FullMsgId itemId,
		const std::shared_ptr<FilePrepareResult> &file) {
	_queue.push_back({ itemId, file });
	if (!_nextTimer.isActive()) {
		maybeSend();
	}
}
}
`);
  const options = {
    root,
    target: targetById("tdesktop"),
    featureRoot: path.resolve("features/fast-upload"),
  };
  await patchFastUpload(options);
  await patchFastUpload(options);
  const read = (relative: string) => readFile(path.join(root, relative), "utf8");
  return {
    schema: await read("Telegram/SourceFiles/mtproto/scheme/api.tl"),
    cmake: await read("Telegram/CMakeLists.txt"),
    header: await read("Telegram/SourceFiles/storage/file_upload.h"),
    implementation: await read("Telegram/SourceFiles/storage/file_upload.cpp"),
    helper: await read("Telegram/SourceFiles/crossgram/fast_upload.cpp"),
  };
}

describe("Desktop hash-first upload patch e2e", () => {
  it("installs the custom method and build sources exactly once", async () => {
    const { schema, cmake } = await patchedFixture();
    expect(schema.match(/crossgram\.prepareMediaUpload#f75adc0e/g)).toHaveLength(1);
    expect(cmake.match(/crossgram\/fast_upload\.cpp/g)).toHaveLength(1);
    expect(cmake.match(/crossgram\/fast_upload\.h/g)).toHaveLength(1);
  });

  it("queries the hash cache before part upload and falls back on misses or RPC errors", async () => {
    const { header, implementation } = await patchedFixture();
    expect(header).toContain("tryFastUpload(FullMsgId itemId");
    expect(implementation).toContain("MTPcrossgram_PrepareMediaUpload(");
    expect(implementation).toContain("crl::async([weak = make_weak(), itemId, file]");
    expect(implementation).toContain("result.type() == mtpc_boolTrue");
    expect(implementation).toContain("finishFastUpload(itemId, file);");
    expect(implementation.match(/fallbackFastUpload\(itemId, file\);/g)).toHaveLength(3);
    expect(implementation).toContain("enqueueUpload(itemId, file);");
  });

  it("hashes memory and disk sources in one pass including first-10-MiB MD5", async () => {
    const { helper } = await patchedFixture();
    expect(helper).toContain("QCryptographicHash::Md5");
    expect(helper).toContain("QCryptographicHash::Sha1");
    expect(helper).toContain("kFirstChunkLimit");
    expect(helper).toContain("for (const auto &part : file.fileparts)");
    expect(helper).toContain("input.read(256 * 1024)");
  });
});
