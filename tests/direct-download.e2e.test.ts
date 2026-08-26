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
    mkdir(path.join(source, "history", "view", "media"), { recursive: true }),
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
  await writeFile(path.join(source, "storage", "file_download.h"), `class FileLoader {
public:
	[[nodiscard]] virtual uint64 objId() const {
		return 0;
	}
};
`, "utf8");
  await writeFile(path.join(source, "storage", "file_download_mtproto.h"), `class mtpFileLoader final
	: public FileLoader
	, private Storage::DownloadMtprotoTask {
public:
	Data::FileOrigin fileOrigin() const override;
	uint64 objId() const override;
};
`, "utf8");
  await writeFile(path.join(source, "storage", "file_download_mtproto.cpp"), `uint64 mtpFileLoader::objId() const {
	return DownloadMtprotoTask::objectId();
}

bool mtpFileLoader::readyToRequest() const {
	return true;
}
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
  await writeFile(path.join(source, "data", "data_document.h"), `class DocumentData {
public:
	[[nodiscard]] bool loading() const;
	[[nodiscard]] QString loadingFilePath() const;
};
`, "utf8");
  await writeFile(path.join(source, "data", "data_document.cpp"), `QString DocumentData::loadingFilePath() const {
	return loading() ? _loader->fileName() : QString();
}

bool DocumentData::displayLoading() const {
	return true;
}
`, "utf8");
  await writeFile(
    path.join(source, "history", "view", "media", "history_view_document.cpp"),
    `void Document::draw(Painter &p, const PaintContext &context) const {
	auto statuswidth = namewidth;
	auto statusText = voiceStatusOverride.isEmpty() ? _statusText : voiceStatusOverride;
	p.setFont(st::normalFont);
	p.setPen(stm->mediaFg);
	p.drawTextLeft(nameleft, statustop, width, statusText);

	if (_realParent->isUnreadMedia()) {
		auto w = st::normalFont->width(statusText);
		if (w + st::mediaUnreadSkip + st::mediaUnreadSize <= statuswidth) {
			p.drawEllipse(QRect());
		}
	}
}
`,
    "utf8",
  );
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
  fileLoader: string;
  mtprotoLoaderHeader: string;
  mtprotoLoaderImplementation: string;
  documentHeader: string;
  documentImplementation: string;
  documentView: string;
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
    fileLoader: await readSource("Telegram/SourceFiles/storage/file_download.h"),
    mtprotoLoaderHeader: await readSource("Telegram/SourceFiles/storage/file_download_mtproto.h"),
    mtprotoLoaderImplementation: await readSource(
      "Telegram/SourceFiles/storage/file_download_mtproto.cpp",
    ),
    documentHeader: await readSource("Telegram/SourceFiles/data/data_document.h"),
    documentImplementation: await readSource("Telegram/SourceFiles/data/data_document.cpp"),
    documentView: await readSource(
      "Telegram/SourceFiles/history/view/media/history_view_document.cpp",
    ),
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

  it("accepts legacy and cache-isolated bridge media references", async () => {
    const { helper } = await patchedFixture();
    expect(helper).toContain("const auto separator = suffix.indexOf(':')");
    expect(helper).toContain("suffix.indexOf(':', separator + 1) >= 0");
    expect(helper).toContain("validId(suffix.left(separator))");
    expect(helper).toContain("validId(suffix.mid(separator + 1))");
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
    expect(header).toContain("bool _directCandidate = false;");
    expect(header).toContain("QNetworkReply *_directReply = nullptr;");
    expect(implementation).toContain('return u"connecting"_q;');
    expect(implementation).toContain("_directCandidate = true;");
    expect(implementation).toContain("_directUrlExpiresAt <= QDateTime::currentMSecsSinceEpoch()");
    expect(implementation).toContain("_directUrlExpiresAt = 0;");
    expect(implementation).toContain("if (_directResolving)");
    expect(implementation).toContain("if (requestId < 0)");
    expect(implementation).toContain("reply->abort();");
  });

  it("migrates transport state when reapplied over the previous direct-download patch", async () => {
    const root = await fixture();
    const options = {
      root,
      target: targetById("tdesktop"),
      featureRoot: path.resolve("features/direct-download"),
    };
    await patchDirectDownload(options);
    const headerPath = path.join(
      root,
      "Telegram",
      "SourceFiles",
      "storage",
      "download_manager_mtproto.h",
    );
    const implementationPath = path.join(
      root,
      "Telegram",
      "SourceFiles",
      "storage",
      "download_manager_mtproto.cpp",
    );
    const previousHeader = (await readFile(headerPath, "utf8"))
      .replace("	bool _directCandidate = false;\n", "");
    const previousImplementation = (await readFile(implementationPath, "utf8"))
      .replace(
        `QString DownloadMtprotoTask::crossgramDownloadTransport() const {
	if (!_directCandidate) {
		return QString();
	} else if (_directResolving) {
		return u"connecting"_q;
	}
	return (!_directDisabled
		&& !_directUrl.isEmpty()
		&& _directUrlExpiresAt > QDateTime::currentMSecsSinceEpoch())
		? u"direct"_q
		: u"relay"_q;
}`,
        `QString DownloadMtprotoTask::crossgramDownloadTransport() const {
	return (!_directDisabled
		&& !_directUrl.isEmpty()
		&& _directUrlExpiresAt > QDateTime::currentMSecsSinceEpoch())
		? u"direct"_q
		: u"relay"_q;
}`,
      )
      .replace("			_directCandidate = true;\n", "");
    await writeFile(headerPath, previousHeader, "utf8");
    await writeFile(implementationPath, previousImplementation, "utf8");

    await patchDirectDownload(options);
    const migratedHeader = await readFile(headerPath, "utf8");
    const migratedImplementation = await readFile(implementationPath, "utf8");
    expect(migratedHeader).toContain("bool _directCandidate = false;");
    expect(migratedImplementation).toContain('return u"connecting"_q;');
    expect(migratedImplementation).toContain("_directCandidate = true;");

    await patchDirectDownload(options);
    expect(await readFile(headerPath, "utf8")).toBe(migratedHeader);
    expect(await readFile(implementationPath, "utf8")).toBe(migratedImplementation);
  });

  it("threads transport state through the file loader and draws a desktop badge", async () => {
    const {
      fileLoader,
      mtprotoLoaderHeader,
      mtprotoLoaderImplementation,
      documentHeader,
      documentImplementation,
      documentView,
    } = await patchedFixture();
    expect(fileLoader).toContain("virtual QString crossgramDownloadTransport() const");
    expect(mtprotoLoaderHeader).toContain("QString crossgramDownloadTransport() const override;");
    expect(mtprotoLoaderImplementation).toContain(
      "return DownloadMtprotoTask::crossgramDownloadTransport();",
    );
    expect(documentHeader).toContain("QString crossgramDownloadTransport() const;");
    expect(documentImplementation).toContain("_loader->crossgramDownloadTransport()");
    expect(documentView).toContain('u"直连"_q');
    expect(documentView).toContain('u"中转"_q');
    expect(documentView).toContain('u"连接中"_q');
    expect(documentView).toContain("p.drawRoundedRect(badge");
    expect(documentView.match(/const auto transport = _data->crossgramDownloadTransport\(\);/g))
      .toHaveLength(1);
  });
});
