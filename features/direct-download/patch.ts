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
    file.insertAfter("class ApiWrap;", "\nclass QNetworkAccessManager;\nclass QNetworkReply;", "class QNetworkAccessManager;");
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
	void directPartFinished(mtpRequestId requestId);`,
      "sendDirectRequest(const RequestData &requestData)",
    );
    file.insertAfter(
      "\tmtpRequestId _cdnHashesRequestId = 0;",
      `

	QString _directUrl;
	qint64 _directUrlExpiresAt = 0;
	bool _directDisabled = false;
	mtpRequestId _nextDirectRequestId = -1;
	std::unique_ptr<QNetworkAccessManager> _directNetwork;
	base::flat_map<mtpRequestId, QNetworkReply*> _directReplies;`,
      "_nextDirectRequestId = -1",
    );
  });

  await context.edit(`${sourceRoot}/storage/download_manager_mtproto.cpp`, (file) => {
    file.insertAfter(
      '#include "base/openssl_help.h"',
      `
#include "crossgram/direct_download.h"

#include <QtCore/QDateTime>
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
	auto request = QNetworkRequest(QUrl(_directUrl));
	request.setRawHeader("Accept-Encoding", "identity");
	request.setAttribute(
		QNetworkRequest::RedirectPolicyAttribute,
		QNetworkRequest::NoLessSafeRedirectPolicy);
	request.setTransferTimeout(30 * 1000);
	request.setRawHeader("Range", "bytes="
		+ QByteArray::number(requestData.offset)
		+ '-'
		+ QByteArray::number(requestData.offset + kDownloadPartSize - 1));
	const auto reply = _directNetwork->get(request);
	_directReplies.emplace(id, reply);
	QObject::connect(reply, &QNetworkReply::finished, [=] {
		directPartFinished(id);
	});
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
		Crossgram::DirectDownload::LogTransport(u"direct"_q, u"url_resolved"_q);
	} else {
		if (_directUrl.isEmpty()
			|| _directUrlExpiresAt <= QDateTime::currentMSecsSinceEpoch()) {
			_directDisabled = true;
			_directUrl.clear();
			_directUrlExpiresAt = 0;
			Crossgram::DirectDownload::LogTransport(u"relay"_q, u"invalid_rpc_response"_q);
		}
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
		_directUrl.clear();
		_directUrlExpiresAt = 0;
		Crossgram::DirectDownload::LogTransport(u"relay"_q, error.type());
	}
	makeRequest(requestData);
}

void DownloadMtprotoTask::directPartFinished(mtpRequestId requestId) {
	const auto i = _directReplies.find(requestId);
	if (i == end(_directReplies)) return;
	const auto sent = _sentRequests.find(requestId);
	if (sent == end(_sentRequests)) return;
	const auto reply = i->second;
	_directReplies.erase(i);
	const auto status = reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
	const auto contentRange = reply->rawHeader("Content-Range");
	const auto bytes = reply->readAll();
	const auto networkOk = (reply->error() == QNetworkReply::NoError);
	reply->deleteLater();
	const auto valid = networkOk
		&& Crossgram::DirectDownload::ValidateRangeResponse(
			status, contentRange, sent->second.offset, bytes)
		&& (bytes.size() <= kDownloadPartSize);
	const auto requestData = finishSentRequest(
		requestId,
		valid ? FinishRequestReason::Success : FinishRequestReason::Redirect);
	if (valid) {
		const auto owner = _owner;
		const auto dc = dcId();
		partLoaded(requestData.offset, bytes);
		owner->checkSendNextAfterSuccess(dc);
		return;
	}
	_directDisabled = true;
	_directUrl.clear();
	Crossgram::DirectDownload::LogTransport(u"relay"_q, u"http_range_failed"_q);
	makeRequest(requestData);
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
	const auto direct = _directReplies.find(requestId);
	if (direct != end(_directReplies)) {
		const auto reply = direct->second;
		_directReplies.erase(direct);
		QObject::disconnect(reply, nullptr, nullptr, nullptr);
		reply->abort();
		reply->deleteLater();
	} else {
		api().request(requestId).cancel();
	}`,
      "const auto direct = _directReplies.find(requestId);",
    );
  });
}
