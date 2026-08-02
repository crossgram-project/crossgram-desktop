import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { patchCrossInstanceForward } from "../features/cross-instance-forward/patch.js";
import { targetById } from "../src/targets.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture(eol = "\n"): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "crossgram-desktop-drag-forward-"));
  roots.push(root);
  const source = path.join(root, "Telegram", "SourceFiles");
  await Promise.all([
    mkdir(path.join(source, "history", "view"), { recursive: true }),
    mkdir(path.join(source, "dialogs"), { recursive: true }),
    mkdir(path.join(source, "core"), { recursive: true }),
    mkdir(path.join(source, "storage"), { recursive: true }),
  ]);
  const write = (relative: string, value: string) => writeFile(
    path.join(root, relative),
    value.replaceAll("\n", eol),
    "utf8",
  );
  await Promise.all([
    write("Telegram/CMakeLists.txt", `set(SOURCES
    mainwidget.cpp
)
`),
    write("Telegram/SourceFiles/history/history_inner_widget.cpp", `#include "history/history_inner_widget.h"
void first() {
				session().data().setMimeForwardIds(getSelectedItems());
				mimeData->setData(u"application/x-td-forward"_q, "1");
}
void second() {
	auto result = std::make_unique<QMimeData>();
		if (!forwardIds.empty()) {
			session().data().setMimeForwardIds(std::move(forwardIds));
			result->setData(u"application/x-td-forward"_q, "1");
		}
		if (!urls.isEmpty()) {
			result->setUrls(urls);
		}
		HistoryView::FillDragMimeWithPhoto(
			result.get(),
			std::move(photoData));
}
`),
    write("Telegram/SourceFiles/history/view/history_view_list_widget.cpp", `#include "history/view/history_view_list_widget.h"
void first() {
				session().data().setMimeForwardIds(std::move(items));
				mimeData->setData(u"application/x-td-forward"_q, "1");
}
void second() {
	auto result = std::make_unique<QMimeData>();
		if (!forwardIds.empty()) {
			session().data().setMimeForwardIds(std::move(forwardIds));
			result->setData(u"application/x-td-forward"_q, "1");
		}
		if (!urls.isEmpty()) {
			result->setUrls(urls);
		}
		FillDragMimeWithPhoto(result.get(), std::move(photoData));
}
`),
    write("Telegram/SourceFiles/dialogs/dialogs_widget.cpp", `#include "dialogs/dialogs_widget.h"
void Widget::dragEnterEvent(QDragEnterEvent *e) {
	const auto data = e->mimeData();
	_dragForward = !controller()->adaptive().isOneColumn()
		&& data->hasFormat(u"application/x-td-forward"_q);
}
`),
    write("Telegram/SourceFiles/mainwidget.cpp", `#include "mainwidget.h"
bool MainWidget::filesOrForwardDrop(const QMimeData *data) {
	if (data->hasFormat(u"application/x-td-forward"_q)) {
		auto draft = Data::ForwardDraft{
			.ids = session().data().takeMimeForwardIds(),
		};
		return setForwardDraft(thread, std::move(draft));
	} else if (!Data::CanSendAnyOf(thread, Data::FilesSendRestrictions())) {
		return false;
	}
	return confirmSendingFiles(data);
}
`),
    write("Telegram/SourceFiles/core/mime_type.cpp", `#include "core/mime_type.h"
std::shared_ptr<QMimeData> ShareMimeMediaData(const QMimeData *original) {
	auto result = std::make_shared<QMimeData>();
	if (original->hasFormat(u"application/x-td-forward"_q)) {
		result->setData(u"application/x-td-forward"_q, "1");
	}
	if (original->hasImage()) result->setImageData(original->imageData());
	if (auto list = ReadMimeUrls(original); !list.isEmpty()) result->setUrls(std::move(list));
	return result;
}
`),
    write("Telegram/SourceFiles/storage/storage_media_prepare.cpp", `MimeDataState ComputeMimeDataState(const QMimeData *data) {
	if (!data || data->hasFormat(u"application/x-td-forward"_q)) {
		return MimeDataState::None;
	}
	if (data->hasImage()) return MimeDataState::Image;
	return MimeDataState::Files;
}
`),
  ]);
  return root;
}

async function patched(eol = "\n") {
  const root = await fixture(eol);
  const options = {
    root,
    target: targetById("tdesktop"),
    featureRoot: path.resolve("features/cross-instance-forward"),
  };
  await patchCrossInstanceForward(options);
  await patchCrossInstanceForward(options);
  const read = (relative: string) => readFile(path.join(root, relative), "utf8");
  return {
    cmake: await read("Telegram/CMakeLists.txt"),
    helper: await read("Telegram/SourceFiles/crossgram/drag_forward.cpp"),
    header: await read("Telegram/SourceFiles/crossgram/drag_forward.h"),
    history: await read("Telegram/SourceFiles/history/history_inner_widget.cpp"),
    list: await read("Telegram/SourceFiles/history/view/history_view_list_widget.cpp"),
    dialogs: await read("Telegram/SourceFiles/dialogs/dialogs_widget.cpp"),
    main: await read("Telegram/SourceFiles/mainwidget.cpp"),
    mime: await read("Telegram/SourceFiles/core/mime_type.cpp"),
    prepare: await read("Telegram/SourceFiles/storage/storage_media_prepare.cpp"),
  };
}

describe("Desktop cross-instance media drag patch", () => {
  it("installs a process-local, session-bound drag registry exactly once", async () => {
    const { cmake, helper, header } = await patched();
    expect(cmake.match(/crossgram\/drag_forward\.cpp/g)).toHaveLength(1);
    expect(cmake.match(/crossgram\/drag_forward\.h/g)).toHaveLength(1);
    expect(helper).toContain('"application/x-crossgram-forward-v1"');
    expect(helper).toContain("QCoreApplication::applicationPid()");
    expect(helper).toContain("QUuid::createUuid()");
    expect(helper).toContain("i->session == session");
    expect(helper).toContain("QTimer::singleShot(5 * 60 * 1000");
    expect(helper).toContain("AddMultiMediaFiles(data, session, ids);");
    expect(header).toContain("std::optional<MessageIdsList> Take(");
    expect(header).toContain("struct FullMsgId;");
    expect(header).not.toContain('"data/data_types.h"');
  });

  it("replaces Telegram's bare marker without removing standard media payloads", async () => {
    const { history, list } = await patched();
    for (const source of [history, list]) {
      expect(source).not.toContain("application/x-td-forward");
      expect(source.match(/Crossgram::DragForward::Set\(/g)).toHaveLength(2);
    }
    expect(history).toContain("result->setUrls(urls);");
    expect(history).toContain("std::move(photoData));\n\t\tif (!forwardIds.empty()) {");
  });

  it("materializes complete multi-selections as an ordered local-file list", async () => {
    const { helper, history, list } = await patched();
    expect(helper).toContain("ids.size() < 2");
    expect(helper).toContain("PrepareDocument(");
    expect(helper).toContain("PreparePhoto(");
    expect(helper).toContain("media->bytes()");
    expect(helper).toContain("media->imageBytes(size)");
    expect(helper).toContain("urls.push_back(QUrl::fromLocalFile(prepared.path));");
    expect(helper).toContain("data->setUrls(std::move(urls));");
    expect(helper).toContain("ClearStandardMedia(data);");
    expect(helper).toContain("QDir(directory).removeRecursively();");
    for (const source of [history, list]) {
      expect(source.indexOf("FillDragMimeWithPhoto"))
        .toBeLessThan(source.lastIndexOf("Crossgram::DragForward::Set("));
    }
  });

  it("uses native forwarding only for a validated drag in the target session", async () => {
    const { dialogs, main } = await patched();
    expect(dialogs).toContain("Crossgram::DragForward::CanTake(");
    expect(dialogs).toContain("&controller()->session().data()");
    expect(main).toContain("Crossgram::DragForward::Take(");
    expect(main).toContain(".ids = std::move(*ids)");
    expect(main).not.toContain("takeMimeForwardIds()");
  });

  it("falls back to image or local-file upload for foreign Telegram drags", async () => {
    const { mime, prepare } = await patched();
    expect(mime).toContain("Crossgram::DragForward::CopyMarker(original, result.get());");
    expect(mime).toContain("result->setImageData(original->imageData())");
    expect(mime).toContain("result->setUrls(std::move(list))");
    expect(prepare).not.toContain("application/x-td-forward");
    expect(prepare).toContain("if (!data) {");
  });

  it("preserves CRLF while applying all edits idempotently", async () => {
    const result = await patched("\r\n");
    for (const source of [result.history, result.list, result.dialogs, result.main]) {
      expect(source.replaceAll("\r\n", "")).not.toContain("\n");
    }
  });
});
