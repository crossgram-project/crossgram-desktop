import { PatchContext } from "../../src/core/patch-context.js";
import type { Target } from "../../src/targets.js";

interface PatchOptions {
  readonly root: string;
  readonly target: Target;
  readonly featureRoot: string;
}

const sourceRoot = "Telegram/SourceFiles";

export async function patchDirectDownload(options: PatchOptions): Promise<void> {
  const context = new PatchContext(options.root, options.target, options.featureRoot);
  await context.install("direct_download.h", `${sourceRoot}/crossgram/direct_download.h`);
  await context.install("direct_download.cpp", `${sourceRoot}/crossgram/direct_download.cpp`);

  await context.edit("Telegram/CMakeLists.txt", (file) => {
    file.insertAfter(
      "    storage/download_manager_mtproto.cpp",
      "\n    crossgram/direct_download.cpp\n    crossgram/direct_download.h",
      "crossgram/direct_download.cpp",
    );
  });

  await context.edit(`${sourceRoot}/mtproto/scheme/api.tl`, (file) => {
    file.insertAfter(
      "upload.getFile#be5335be flags:# precise:flags.0?true cdn_supported:flags.1?true location:InputFileLocation offset:long limit:int = upload.File;",
      "\ncrossgram.getFileUrl#7520f6ea location:InputFileLocation = DataJSON;",
      "crossgram.getFileUrl#7520f6ea",
    );
  });

  await context.edit(`${sourceRoot}/storage/download_manager_mtproto.h`, (file) => {
    file.insertAfter(
      "class ApiWrap;",
      "\nclass QNetworkAccessManager;\nclass QNetworkReply;\nclass QTemporaryFile;",
      "class QNetworkAccessManager;",
    );
    file.insertAfter(
      "\t[[nodiscard]] const Location &location() const;",
      "\n\t[[nodiscard]] QString crossgramDownloadTransport() const;",
      "crossgramDownloadTransport() const",
    );
    file.insertAfter(
      "\t[[nodiscard]] mtpRequestId sendRequest(const RequestData &requestData);",
      `
	[[nodiscard]] mtpRequestId resolveDirectUrl(
		const RequestData &requestData,
		const StorageFileLocation &location);
	[[nodiscard]] mtpRequestId sendDirectRequest(const RequestData &requestData);
	void directUrlResolved(const MTPDataJSON &result, mtpRequestId requestId);
	void directUrlFailed(const MTP::Error &error, mtpRequestId requestId);
	void startDirectTransfer(int64 offset);
	void directTransferReadyRead();
	void directTransferFinished();
	void deliverDirectParts();
	void fallbackDirectRequests(const QString &reason);`,
      "sendDirectRequest(const RequestData &requestData)",
    );
    file.insertAfter(
      "\tmtpRequestId _cdnHashesRequestId = 0;",
      `

	QString _directUrl;
	qint64 _directUrlExpiresAt = 0;
	bool _directDisabled = false;
	bool _directResolving = false;
	mtpRequestId _nextDirectRequestId = -1;
	std::unique_ptr<QNetworkAccessManager> _directNetwork;
	QNetworkReply *_directReply = nullptr;
	std::unique_ptr<QTemporaryFile> _directCache;
	qint64 _directBaseOffset = 0;
	qint64 _directDownloaded = 0;
	bool _directFinished = false;`,
      "_nextDirectRequestId = -1",
    );
  });

  await context.edit(`${sourceRoot}/storage/download_manager_mtproto.cpp`, (file) => {
    file.insertAfter(
      '#include "base/openssl_help.h"',
      `
#include "crossgram/direct_download.h"

#include <QtCore/QDateTime>
#include <QtCore/QTemporaryFile>
#include <QtNetwork/QNetworkAccessManager>
#include <QtNetwork/QNetworkReply>
#include <QtNetwork/QNetworkRequest>`,
      '#include "crossgram/direct_download.h"',
    );
    file.insertAfterFunction(
      "const DownloadMtprotoTask::Location &DownloadMtprotoTask::location() const",
      `

QString DownloadMtprotoTask::crossgramDownloadTransport() const {
	return (!_directDisabled
		&& !_directUrl.isEmpty()
		&& _directUrlExpiresAt > QDateTime::currentMSecsSinceEpoch())
		? u"direct"_q
		: u"relay"_q;
}

mtpRequestId DownloadMtprotoTask::resolveDirectUrl(
		const RequestData &requestData,
		const StorageFileLocation &location) {
	return api().request(MTPcrossgram_GetFileUrl(
		location.tl(api().session().userId())
	)).done([=](const MTPDataJSON &result, mtpRequestId requestId) {
		directUrlResolved(result, requestId);
	}).fail([=](const MTP::Error &error, mtpRequestId requestId) {
		directUrlFailed(error, requestId);
	}).toDC(MTP::downloadDcId(dcId(), requestData.sessionIndex)).send();
}

mtpRequestId DownloadMtprotoTask::sendDirectRequest(const RequestData &requestData) {
	if (!_directNetwork) {
		_directNetwork = std::make_unique<QNetworkAccessManager>();
	}
	const auto id = _nextDirectRequestId--;
	if (!_directReply && !_directFinished) {
		auto offset = requestData.offset;
		for (const auto &[requestId, sent] : _sentRequests) {
			if (requestId < 0) offset = std::min(offset, sent.offset);
		}
		startDirectTransfer(offset);
	} else if (requestData.offset < _directBaseOffset) {
		crl::on_main(this, [=] {
			fallbackDirectRequests(u"http_resume_moved_backwards"_q);
		});
	}
	return id;
}

void DownloadMtprotoTask::directUrlResolved(
		const MTPDataJSON &result,
		mtpRequestId requestId) {
	const auto requestData = finishSentRequest(requestId, FinishRequestReason::Redirect);
	const auto parsed = result.match([](const MTPDdataJSON &data) {
		return Crossgram::DirectDownload::ParseResolvedUrl(data.vdata().v);
	});
	if (parsed && parsed->expiresAt > QDateTime::currentMSecsSinceEpoch()) {
		_directUrl = parsed->url;
		_directUrlExpiresAt = parsed->expiresAt;
		_directResolving = false;
		Crossgram::DirectDownload::LogTransport(u"direct"_q, u"http_transfer_resolved"_q);
	} else {
		if (_directUrl.isEmpty()
			|| _directUrlExpiresAt <= QDateTime::currentMSecsSinceEpoch()) {
			_directDisabled = true;
			_directResolving = false;
			_directUrl.clear();
			_directUrlExpiresAt = 0;
			Crossgram::DirectDownload::LogTransport(u"relay"_q, u"invalid_rpc_response"_q);
		}
	}
	if (_directDisabled) {
		fallbackDirectRequests(u"invalid_rpc_response"_q);
	}
	makeRequest(requestData);
}

void DownloadMtprotoTask::directUrlFailed(
		const MTP::Error &error,
		mtpRequestId requestId) {
	const auto requestData = finishSentRequest(requestId, FinishRequestReason::Redirect);
	if (_directUrl.isEmpty()
		|| _directUrlExpiresAt <= QDateTime::currentMSecsSinceEpoch()) {
		_directDisabled = true;
		_directResolving = false;
		_directUrl.clear();
		_directUrlExpiresAt = 0;
	}
	fallbackDirectRequests(error.type());
	makeRequest(requestData);
}

void DownloadMtprotoTask::startDirectTransfer(int64 offset) {
	if (_directReply || _directFinished) return;
	_directCache = std::make_unique<QTemporaryFile>();
	if (!_directCache->open()) {
		_directFinished = true;
		crl::on_main(this, [=] {
			fallbackDirectRequests(u"http_cache_open_failed"_q);
		});
		return;
	}
	_directBaseOffset = offset;
	_directDownloaded = offset;
	auto request = QNetworkRequest(QUrl(_directUrl));
	request.setRawHeader("Accept-Encoding", "identity");
	request.setAttribute(
		QNetworkRequest::RedirectPolicyAttribute,
		QNetworkRequest::NoLessSafeRedirectPolicy);
	request.setTransferTimeout(30 * 1000);
	if (offset > 0) {
		request.setRawHeader("Range", "bytes=" + QByteArray::number(offset) + '-');
	}
	_directReply = _directNetwork->get(request);
	_directReply->setReadBufferSize(512 * 1024);
	QObject::connect(_directReply, &QNetworkReply::readyRead, [=] {
		directTransferReadyRead();
	});
	QObject::connect(_directReply, &QNetworkReply::finished, [=] {
		directTransferFinished();
	});
}

void DownloadMtprotoTask::directTransferReadyRead() {
	if (!_directReply || !_directCache) return;
	const auto bytes = _directReply->readAll();
	if (bytes.isEmpty()) return;
	if (!_directCache->seek(_directDownloaded - _directBaseOffset)
		|| _directCache->write(bytes) != bytes.size()) {
		fallbackDirectRequests(u"http_cache_write_failed"_q);
		return;
	}
	_directDownloaded += bytes.size();
	deliverDirectParts();
}

void DownloadMtprotoTask::directTransferFinished() {
	if (!_directReply) return;
	const auto weak = base::make_weak(this);
	directTransferReadyRead();
	if (!weak || !_directReply) return;
	const auto reply = base::take(_directReply);
	const auto status = reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
	const auto contentRange = reply->rawHeader("Content-Range");
	const auto valid = (reply->error() == QNetworkReply::NoError)
		&& Crossgram::DirectDownload::ValidateHttpResponse(
			status, contentRange, _directBaseOffset);
	reply->deleteLater();
	if (!valid) {
		fallbackDirectRequests(u"http_transfer_failed"_q);
		return;
	}
	_directFinished = true;
	deliverDirectParts();
}

void DownloadMtprotoTask::deliverDirectParts() {
	if (!_directCache) return;
	auto ready = std::vector<mtpRequestId>();
	for (const auto &[requestId, requestData] : _sentRequests) {
		if (requestId >= 0) continue;
		if (requestData.offset < _directBaseOffset) {
			fallbackDirectRequests(u"http_resume_moved_backwards"_q);
			return;
		}
		const auto available = std::max<int64>(0, _directDownloaded - requestData.offset);
		if (available >= kDownloadPartSize || _directFinished) {
			ready.push_back(requestId);
		}
	}
	for (const auto requestId : ready) {
		const auto i = _sentRequests.find(requestId);
		if (i == end(_sentRequests)) continue;
		const auto offset = i->second.offset;
		const auto available = std::max<int64>(0, _directDownloaded - offset);
		const auto size = int(std::min<int64>(kDownloadPartSize, available));
		if (!_directCache->seek(offset - _directBaseOffset)) {
			fallbackDirectRequests(u"http_cache_seek_failed"_q);
			return;
		}
		const auto bytes = _directCache->read(size);
		if (bytes.size() != size) {
			fallbackDirectRequests(u"http_cache_read_failed"_q);
			return;
		}
		const auto requestData = finishSentRequest(requestId, FinishRequestReason::Success);
		const auto weak = base::make_weak(this);
		const auto owner = _owner;
		const auto dc = dcId();
		partLoaded(requestData.offset, bytes);
		if (!weak) return;
		owner->checkSendNextAfterSuccess(dc);
		if (!weak) return;
	}
}

void DownloadMtprotoTask::fallbackDirectRequests(const QString &reason) {
	_directDisabled = true;
	_directResolving = false;
	_directUrl.clear();
	_directUrlExpiresAt = 0;
	_directFinished = false;
	if (_directReply) {
		const auto reply = base::take(_directReply);
		QObject::disconnect(reply, nullptr, nullptr, nullptr);
		reply->abort();
		reply->deleteLater();
	}
	_directCache.reset();
	_directBaseOffset = 0;
	_directDownloaded = 0;
	auto retry = std::vector<RequestData>();
	auto requestIds = std::vector<mtpRequestId>();
	for (const auto &[requestId, requestData] : _sentRequests) {
		if (requestId < 0) requestIds.push_back(requestId);
	}
	for (const auto requestId : requestIds) {
		retry.push_back(finishSentRequest(requestId, FinishRequestReason::Redirect));
	}
	Crossgram::DirectDownload::LogTransport(u"relay"_q, reason);
	for (const auto &requestData : retry) {
		makeRequest(requestData);
	}
}`,
      "QString DownloadMtprotoTask::crossgramDownloadTransport() const",
    );
    file.replace(
      "\t\tconst auto reference = location.fileReference();",
      `		if (Crossgram::DirectDownload::IsCandidate(location.fileReference())
			&& !_directDisabled) {
			if (!_directUrl.isEmpty()
				&& _directUrlExpiresAt > QDateTime::currentMSecsSinceEpoch()) {
				return sendDirectRequest(requestData);
			}
			if (_directResolving) {
				return _nextDirectRequestId--;
			}
			_directResolving = true;
			return resolveDirectUrl(requestData, location);
		}
		const auto reference = location.fileReference();`,
      "return resolveDirectUrl(requestData, location);",
    );
    file.replace(
      `void DownloadMtprotoTask::cancelRequest(mtpRequestId requestId) {
\tconst auto hashes = (_cdnHashesRequestId == requestId);
\tapi().request(requestId).cancel();`,
      `void DownloadMtprotoTask::cancelRequest(mtpRequestId requestId) {
	const auto hashes = (_cdnHashesRequestId == requestId);
	if (requestId < 0) {
		[[maybe_unused]] const auto data = finishSentRequest(
			requestId,
			FinishRequestReason::Cancel);
		return;
	} else {
		api().request(requestId).cancel();
	}`,
      "if (requestId < 0)",
    );
  });

  await context.edit(`${sourceRoot}/data/data_cloud_file.cpp`, (file) => {
    file.replace(
      `\t} else if ((file.flags & CloudFile::Flag::Failed)
\t\t|| !file.location.valid()
\t\t|| (finalCheck && !finalCheck())) {
\t\treturn;
\t}
\tfile.flags &= ~CloudFile::Flag::Cancelled;`,
      `\t} else if ((file.flags & CloudFile::Flag::Failed)
\t\t|| !file.location.valid()
\t\t|| (finalCheck && !finalCheck())) {
\t\treturn;
\t} else if (file.byteSize > Storage::kMaxFileInMemory) {
\t\t// CloudFile always downloads without an output filename. FileLoader
\t\t// requires those downloads to fit its in-memory limit, so reject
\t\t// oversized synthetic photo sizes instead of tripping its assertion.
\t\tfile.flags |= CloudFile::Flag::Failed;
\t\tif (const auto onstack = fail) {
\t\t\tonstack(false);
\t\t}
\t\treturn;
\t}
\tfile.flags &= ~CloudFile::Flag::Cancelled;`,
      "oversized synthetic photo sizes",
    );
  });
}
