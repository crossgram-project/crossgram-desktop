import { PatchContext } from "../../src/core/patch-context.js";
import type { Target } from "../../src/targets.js";

interface PatchOptions {
  readonly root: string;
  readonly target: Target;
  readonly featureRoot: string;
}

const sourceRoot = "Telegram/SourceFiles";

export async function patchFastUpload(options: PatchOptions): Promise<void> {
  const context = new PatchContext(options.root, options.target, options.featureRoot);
  await context.install("fast_upload.h", `${sourceRoot}/crossgram/fast_upload.h`);
  await context.install("fast_upload.cpp", `${sourceRoot}/crossgram/fast_upload.cpp`);

  await context.edit("Telegram/CMakeLists.txt", (file) => {
    file.insertAfter(
      "    crossgram/direct_download.h",
      "\n    crossgram/fast_upload.cpp\n    crossgram/fast_upload.h",
      "crossgram/fast_upload.cpp",
    );
  });

  await context.edit(`${sourceRoot}/mtproto/scheme/api.tl`, (file) => {
    file.insertAfter(
      "crossgram.getFileUrl#7520f6ea location:InputFileLocation = DataJSON;",
      "\ncrossgram.prepareMediaUpload#f75adc0e peer:InputPeer file_id:long name:string size:long kind:string mime_type:string md5:bytes sha1:bytes file10m_md5:bytes width:int height:int duration:double = Bool;",
      "crossgram.prepareMediaUpload#f75adc0e",
    );
  });

  await context.edit(`${sourceRoot}/storage/file_upload.h`, (file) => {
    file.insertAfter(
      "\tvoid maybeSend();",
      `
	void enqueueUpload(FullMsgId itemId, const std::shared_ptr<FilePrepareResult> &file);
	[[nodiscard]] bool tryFastUpload(FullMsgId itemId, const std::shared_ptr<FilePrepareResult> &file);
	void finishFastUpload(FullMsgId itemId, const std::shared_ptr<FilePrepareResult> &file);
	void fallbackFastUpload(FullMsgId itemId, const std::shared_ptr<FilePrepareResult> &file);`,
      "tryFastUpload(FullMsgId itemId",
    );
  });

  await context.edit(`${sourceRoot}/storage/file_upload.cpp`, (file) => {
    file.insertAfter(
      '#include "apiwrap.h"',
      '\n#include "crossgram/fast_upload.h"',
      '#include "crossgram/fast_upload.h"',
    );
    file.replace(
      `	_queue.push_back({ itemId, file });
	if (!_nextTimer.isActive()) {
		maybeSend();
	}`,
      `	if (!tryFastUpload(itemId, file)) {
		enqueueUpload(itemId, file);
	}`,
      "tryFastUpload(itemId, file)",
    );
    file.insertAfterFunction(
      "void Uploader::upload(",
      `

void Uploader::enqueueUpload(
		FullMsgId itemId,
		const std::shared_ptr<FilePrepareResult> &file) {
	_queue.push_back({ itemId, file });
	if (!_nextTimer.isActive()) {
		maybeSend();
	}
}

bool Uploader::tryFastUpload(
		FullMsgId itemId,
		const std::shared_ptr<FilePrepareResult> &file) {
	if (file->type == SendMediaType::Secure
		|| file->type == SendMediaType::Audio
		|| file->type == SendMediaType::Round) {
		return false;
	}
	if (!session().data().message(itemId)) return false;
	crl::async([weak = make_weak(), itemId, file] {
		const auto hashes = Crossgram::FastUpload::HashPrepared(*file);
		crl::on_main(weak, [=] {
			const auto item = session().data().message(itemId);
			if (!item) return;
			if (!hashes) {
				fallbackFastUpload(itemId, file);
				return;
			}
			_api->request(MTPcrossgram_PrepareMediaUpload(
				item->history()->peer->input(),
				MTP_long(file->id),
				MTP_string(file->filename),
				MTP_long(hashes->size),
				MTP_string(Crossgram::FastUpload::Kind(*file)),
				MTP_string(file->filemime),
				MTP_bytes(hashes->md5),
				MTP_bytes(hashes->sha1),
				MTP_bytes(hashes->file10mMd5),
				MTP_int(0),
				MTP_int(0),
				MTP_double(0)
			)).done([=](const MTPBool &result) {
				if (result.type() == mtpc_boolTrue) {
					finishFastUpload(itemId, file);
				} else {
					fallbackFastUpload(itemId, file);
				}
			}).fail([=](const MTP::Error &) {
				fallbackFastUpload(itemId, file);
			}).send();
		});
	});
	return true;
}

void Uploader::finishFastUpload(
		FullMsgId itemId,
		const std::shared_ptr<FilePrepareResult> &file) {
	_queue.push_back({ itemId, file });
	auto &entry = _queue.back();
	entry.partsSent = entry.parts->size();
	entry.docPartsSent = entry.docPartsCount;
	entry.sentSize = entry.file->partssize;
	entry.docSentSize = entry.docSize;
	maybeFinishFront();
}

void Uploader::fallbackFastUpload(
		FullMsgId itemId,
		const std::shared_ptr<FilePrepareResult> &file) {
	enqueueUpload(itemId, file);
}`,
      "bool Uploader::tryFastUpload(",
    );
  });
}
