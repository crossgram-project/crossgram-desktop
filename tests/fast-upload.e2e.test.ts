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

async function patchedFixture(
  fixtureOptions: { directMaybeSend?: boolean; transcodeQueue?: boolean } = {},
) {
  const root = await mkdtemp(path.join(tmpdir(), "crossgram-desktop-fast-upload-"));
  roots.push(root);
  const source = path.join(root, "Telegram/SourceFiles");
  await Promise.all([
    mkdir(path.join(source, "codegen/scheme"), { recursive: true }),
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
  await writeFile(path.join(source, "codegen/scheme/codegen_scheme.py"), `scheme = {
  'typeIdExceptions': [
    'messageReplies#81834865',
  ],
}
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
  const queuedUpload = fixtureOptions.transcodeQueue
    ? `	_queue.push_back({ itemId, file });
	if (preparing) {
		_queue.back().preparing = true;
		startTranscode(itemId);
	} else if (!_nextTimer.isActive()) {
		maybeSend();
	}`
    : fixtureOptions.directMaybeSend
      ? `	_queue.push_back({ itemId, file });
	maybeSend();`
      : `	_queue.push_back({ itemId, file });
	if (!_nextTimer.isActive()) {
		maybeSend();
	}`;
  await writeFile(path.join(source, "storage/file_upload.cpp"), `#include "apiwrap.h"
namespace Storage {
void Uploader::upload(
		FullMsgId itemId,
		const std::shared_ptr<FilePrepareResult> &file) {
${queuedUpload}
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
    codegen: await read("Telegram/SourceFiles/codegen/scheme/codegen_scheme.py"),
    cmake: await read("Telegram/CMakeLists.txt"),
    header: await read("Telegram/SourceFiles/storage/file_upload.h"),
    implementation: await read("Telegram/SourceFiles/storage/file_upload.cpp"),
    helper: await read("Telegram/SourceFiles/crossgram/fast_upload.cpp"),
  };
}

describe("Desktop hash-first upload patch e2e", () => {
  it("installs the custom method and build sources exactly once", async () => {
    const { schema, codegen, cmake } = await patchedFixture();
    expect(schema.match(/crossgram\.prepareMediaUploadV2#f75adc0f/g)).toHaveLength(1);
    expect(codegen.match(/crossgram\.prepareMediaUploadV2#f75adc0f/g)).toHaveLength(1);
    expect(cmake.match(/crossgram\/fast_upload\.cpp/g)).toHaveLength(1);
    expect(cmake.match(/crossgram\/fast_upload\.h/g)).toHaveLength(1);
  });

  it("queries the hash cache before part upload and falls back on misses or RPC errors", async () => {
    const { header, implementation } = await patchedFixture();
    expect(header).toContain("tryFastUpload(FullMsgId itemId");
    expect(implementation).toContain("MTPcrossgram_PrepareMediaUploadV2(");
    expect(implementation).toContain("crl::async([weak = base::make_weak(this), itemId, file]");
    expect(implementation).toContain("crl::on_main(weak, [weak, itemId, file, hashes]");
    expect(implementation).toContain("weak->session().data().message(itemId)");
    expect(implementation).toContain("weak->_api->request(MTPcrossgram_PrepareMediaUploadV2(");
    expect(implementation).toContain("if (!weak) return;");
    expect(implementation).toContain("weak->finishFastUpload(itemId, file);");
    expect(implementation).toContain("result.type() == mtpc_boolTrue");
    expect(implementation.match(/weak->fallbackFastUpload\(itemId, file\);/g)).toHaveLength(3);
    expect(implementation).toContain("enqueueUpload(itemId, file);");
  });

  it("supports upstreams that call maybeSend directly after queueing", async () => {
    const { implementation } = await patchedFixture({ directMaybeSend: true });
    expect(implementation).toContain("tryFastUpload(itemId, file)");
    expect(implementation).toContain("void Uploader::enqueueUpload(");
    expect(implementation.match(/_queue\.push_back\(\{ itemId, file \}\);/g)).toHaveLength(2);
  });

  it("preserves the upstream transcode queue before attempting fast upload", async () => {
    const { implementation } = await patchedFixture({ transcodeQueue: true });
    expect(implementation).toContain("if (preparing) {");
    expect(implementation).toContain("_queue.back().preparing = true;");
    expect(implementation).toContain("startTranscode(itemId);");
    expect(implementation).toContain("} else if (!tryFastUpload(itemId, file)) {");
    expect(implementation.match(/_queue\.push_back\(\{ itemId, file \}\);/g)).toHaveLength(3);
  });

  it("hashes memory and disk sources in one pass including first-10-MiB MD5", async () => {
    const { helper } = await patchedFixture();
    expect(helper).toContain("QCryptographicHash::Md5");
    expect(helper).toContain("QCryptographicHash::Sha1");
    expect(helper).toContain("SHA1_Update");
    expect(helper).toContain("appendIntermediateSha1");
    expect(helper).toContain("kSha1CheckpointBytes");
    expect(helper).toContain("kFirstChunkLimit");
    expect(helper).toContain("for (const auto &part : file.fileparts)");
    expect(helper).toContain("input.read(256 * 1024)");
  });
});
