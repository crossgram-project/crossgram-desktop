import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { patchDirectDownload } from "../features/direct-download/patch.js";
import { targetById } from "../src/targets.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "crossgram-desktop-direct-e2e-"));
  roots.push(root);
  const source = path.join(root, "Telegram", "SourceFiles");
  await Promise.all([
    mkdir(path.join(source, "data"), { recursive: true }),
    mkdir(path.join(source, "mtproto", "scheme"), { recursive: true }),
    mkdir(path.join(source, "storage"), { recursive: true }),
  ]);
  await writeFile(path.join(root, "Telegram", "CMakeLists.txt"), `set(SOURCES
    storage/download_manager_mtproto.cpp
)
`, "utf8");
  await writeFile(path.join(source, "mtproto", "scheme", "api.tl"), `---functions---
upload.getFile#be5335be flags:# precise:flags.0?true cdn_supported:flags.1?true location:InputFileLocation offset:long limit:int = upload.File;
`, "utf8");
  await writeFile(path.join(source, "storage", "download_manager_mtproto.h"), `#pragma once
class ApiWrap;
class DownloadMtprotoTask {
public:
\t[[nodiscard]] const Location &location() const;
private:
\t[[nodiscard]] mtpRequestId sendRequest(const RequestData &requestData);
\tmtpRequestId _cdnHashesRequestId = 0;
};
`, "utf8");
  await writeFile(path.join(source, "storage", "download_manager_mtproto.cpp"), `#include "base/openssl_help.h"
const DownloadMtprotoTask::Location &DownloadMtprotoTask::location() const {
\treturn _location;
}
mtpRequestId DownloadMtprotoTask::sendRequest(const RequestData &requestData) {
\treturn v::match(_location.data, [&](const StorageFileLocation &location) {
\t\tconst auto reference = location.fileReference();
\t\treturn api().request(MTPupload_GetFile()).send();
\t});
}
void DownloadMtprotoTask::cancelRequest(mtpRequestId requestId) {
\tconst auto hashes = (_cdnHashesRequestId == requestId);
\tapi().request(requestId).cancel();
}
`, "utf8");
  await writeFile(path.join(source, "data", "data_cloud_file.cpp"), `void LoadCloudFile(
\tCloudFile &file,
\tFn<bool()> finalCheck,
\tFn<void(bool)> fail) {
\tif (file.loader) {
\t\treturn;
\t} else if ((file.flags & CloudFile::Flag::Failed)
\t\t|| !file.location.valid()
\t\t|| (finalCheck && !finalCheck())) {
\t\treturn;
\t}
\tfile.flags &= ~CloudFile::Flag::Cancelled;
\tfile.loader = CreateFileLoader();
}
`, "utf8");
  return root;
}

async function patchedFixture(): Promise<{
  schema: string;
  cmake: string;
  header: string;
  implementation: string;
  helper: string;
  cloudFile: string;
}> {
  const root = await fixture();
  const options = {
    root,
    target: targetById("tdesktop"),
    featureRoot: path.resolve("features/direct-download"),
  };
  await patchDirectDownload(options);
  await patchDirectDownload(options);
  const readSource = (relative: string) => readFile(path.join(root, relative), "utf8");
  return {
    schema: await readSource("Telegram/SourceFiles/mtproto/scheme/api.tl"),
    cmake: await readSource("Telegram/CMakeLists.txt"),
    header: await readSource("Telegram/SourceFiles/storage/download_manager_mtproto.h"),
    implementation: await readSource("Telegram/SourceFiles/storage/download_manager_mtproto.cpp"),
    helper: await readSource("Telegram/SourceFiles/crossgram/direct_download.cpp"),
    cloudFile: await readSource("Telegram/SourceFiles/data/data_cloud_file.cpp"),
  };
}

describe("Desktop direct-download patch e2e", () => {
  it("installs the RPC and build sources exactly once", async () => {
    const { schema, cmake } = await patchedFixture();
    expect(schema.match(/crossgram\.getFileUrl#7520f6ea/g)).toHaveLength(1);
    expect(cmake.match(/crossgram\/direct_download\.cpp/g)).toHaveLength(1);
    expect(cmake.match(/crossgram\/direct_download\.h/g)).toHaveLength(1);
  });

  it("uses one HTTP transfer and resumes from Telegram's first missing offset", async () => {
    const { implementation, helper } = await patchedFixture();
    expect(implementation).toContain("_directNetwork->get(request)");
    expect(implementation.match(/_directNetwork->get\(request\)/g)).toHaveLength(1);
    expect(implementation).toContain("std::make_unique<QTemporaryFile>()");
    expect(implementation).toContain("deliverDirectParts();");
    expect(implementation).toContain('request.setRawHeader("Range", "bytes=" + QByteArray::number(offset) + \'-\')');
    expect(implementation.match(/request\.setRawHeader\("Range"/g)).toHaveLength(1);
    expect(implementation).not.toContain("requestData.offset + kDownloadPartSize - 1");
    expect(implementation).not.toContain("_directReplies");
    expect(implementation).toContain("return resolveDirectUrl(requestData, location);");
    expect(implementation).toContain('LogTransport(u"direct"_q, u"http_transfer_resolved"_q)');
    expect(implementation).toContain("fallbackDirectRequests(u\"http_transfer_failed\"_q)");
    expect(helper).toContain("offset == 0 && status == 200");
    expect(helper).toContain("status != 206");
    expect(helper).toContain("contentRange.toLower().startsWith(prefix)");
    expect(helper).not.toContain("supportsRange");
  });

  it("offers raw stickers and reaction animations to the direct URL resolver", async () => {
    const { helper } = await patchedFixture();
    expect(helper).toContain('constexpr char kStickerPrefix[] = "bridge-sticker:";');
    expect(helper).toContain('constexpr char kReactionPrefix[] = "bridge-reaction-resource:";');
    expect(helper).toContain("fileReference.startsWith(kStickerPrefix)");
    expect(helper).toContain("fileReference.startsWith(kReactionPrefix)");
  });

  it("rejects oversized filename-less cloud files before FileLoader asserts", async () => {
    const { cloudFile } = await patchedFixture();
    expect(cloudFile).toContain("file.byteSize > Storage::kMaxFileInMemory");
    expect(cloudFile).toContain("file.flags |= CloudFile::Flag::Failed;");
    expect(cloudFile).toContain("onstack(false);");
    expect(cloudFile.indexOf("file.byteSize > Storage::kMaxFileInMemory"))
      .toBeLessThan(cloudFile.indexOf("file.loader = CreateFileLoader();"));
  });

  it("exposes transport state, coalesces URL resolution, and cancels the shared HTTP transfer", async () => {
    const { header, implementation } = await patchedFixture();
    expect(header).toContain("QString crossgramDownloadTransport() const;");
    expect(header).toContain("QNetworkReply *_directReply = nullptr;");
    expect(implementation).toContain("_directUrlExpiresAt <= QDateTime::currentMSecsSinceEpoch()");
    expect(implementation).toContain("_directUrlExpiresAt = 0;");
    expect(implementation).toContain("if (_directResolving)");
    expect(implementation).toContain("if (requestId < 0)");
    expect(implementation).toContain("reply->abort();");
  });
});
