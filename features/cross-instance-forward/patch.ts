import { PatchContext } from "../../src/core/patch-context.js";
import type { Target } from "../../src/targets.js";

interface PatchOptions {
  readonly root: string;
  readonly target: Target;
  readonly featureRoot: string;
}

const sourceRoot = "Telegram/SourceFiles";
const include = '#include "crossgram/drag_forward.h"';

export async function patchCrossInstanceForward(options: PatchOptions): Promise<void> {
  const context = new PatchContext(options.root, options.target, options.featureRoot);
  await context.install("drag_forward.h", `${sourceRoot}/crossgram/drag_forward.h`);
  await context.install("drag_forward.cpp", `${sourceRoot}/crossgram/drag_forward.cpp`);

  await context.edit("Telegram/CMakeLists.txt", (file) => {
    file.insertAfter(
      "    mainwidget.cpp",
      "\n    crossgram/drag_forward.cpp\n    crossgram/drag_forward.h",
      "crossgram/drag_forward.cpp",
    );
  });

  for (const relative of [
    "history/history_inner_widget.cpp",
    "history/view/history_view_list_widget.cpp",
  ]) {
    await context.edit(`${sourceRoot}/${relative}`, (file) => {
      file.insertAfter(
        relative === "history/history_inner_widget.cpp"
          ? '#include "history/history_inner_widget.h"'
          : '#include "history/view/history_view_list_widget.h"',
        `\n\n${include}`,
        include,
      );
      if (
        relative === "history/history_inner_widget.cpp"
        && file.text().includes("HistoryView::FillDragMimeWithPhoto(")
      ) {
        file.replace(
          `session().data().setMimeForwardIds(getSelectedItems());
\t\t\t\tmimeData->setData(u"application/x-td-forward"_q, "1");`,
          `Crossgram::DragForward::Set(
\t\t\t\t\tmimeData.get(),
\t\t\t\t\t&session().data(),
\t\t\t\t\tgetSelectedItems());`,
          `Crossgram::DragForward::Set(
\t\t\t\t\tmimeData.get(),
\t\t\t\t\t&session().data(),
\t\t\t\t\tgetSelectedItems());`,
        );
      } else if (
        relative === "history/view/history_view_list_widget.cpp"
        && file.text().includes("FillDragMimeWithPhoto(result.get()")
      ) {
        file.replace(
          `session().data().setMimeForwardIds(std::move(items));
\t\t\t\tmimeData->setData(u"application/x-td-forward"_q, "1");`,
          `Crossgram::DragForward::Set(
\t\t\t\t\tmimeData.get(),
\t\t\t\t\t&session().data(),
\t\t\t\t\tstd::move(items));`,
          `Crossgram::DragForward::Set(
\t\t\t\t\tmimeData.get(),
\t\t\t\t\t&session().data(),
\t\t\t\t\tstd::move(items));`,
        );
      }
      file.replace(
        `session().data().setMimeForwardIds(std::move(forwardIds));
\t\t\tresult->setData(u"application/x-td-forward"_q, "1");`,
        `Crossgram::DragForward::Set(
\t\t\t\tresult.get(),
\t\t\t\t&session().data(),
\t\t\t\tstd::move(forwardIds));`,
        `Crossgram::DragForward::Set(
\t\t\t\tresult.get(),
\t\t\t\t&session().data(),
\t\t\t\tstd::move(forwardIds));`,
      );
      if (
        relative === "history/history_inner_widget.cpp"
        && file.text().includes("HistoryView::FillDragMimeWithPhoto(")
      ) {
        file.replace(
          `auto result = std::make_unique<QMimeData>();
\t\tif (!forwardIds.empty()) {
\t\t\tCrossgram::DragForward::Set(
\t\t\t\tresult.get(),
\t\t\t\t&session().data(),
\t\t\t\tstd::move(forwardIds));
\t\t}
\t\tif (!urls.isEmpty()) {
\t\t\tresult->setUrls(urls);
\t\t}
\t\tHistoryView::FillDragMimeWithPhoto(
\t\t\tresult.get(),
\t\t\tstd::move(photoData));`,
          `auto result = std::make_unique<QMimeData>();
\t\tif (!urls.isEmpty()) {
\t\t\tresult->setUrls(urls);
\t\t}
\t\tHistoryView::FillDragMimeWithPhoto(
\t\t\tresult.get(),
\t\t\tstd::move(photoData));
\t\tif (!forwardIds.empty()) {
\t\t\tCrossgram::DragForward::Set(
\t\t\t\tresult.get(),
\t\t\t\t&session().data(),
\t\t\t\tstd::move(forwardIds));
\t\t}`,
          `std::move(photoData));
\t\tif (!forwardIds.empty()) {`,
        );
      } else if (
        relative === "history/view/history_view_list_widget.cpp"
        && file.text().includes("FillDragMimeWithPhoto(result.get()")
      ) {
        file.replace(
          `auto result = std::make_unique<QMimeData>();
\t\tif (!forwardIds.empty()) {
\t\t\tCrossgram::DragForward::Set(
\t\t\t\tresult.get(),
\t\t\t\t&session().data(),
\t\t\t\tstd::move(forwardIds));
\t\t}
\t\tif (!urls.isEmpty()) {
\t\t\tresult->setUrls(urls);
\t\t}
\t\tFillDragMimeWithPhoto(result.get(), std::move(photoData));`,
          `auto result = std::make_unique<QMimeData>();
\t\tif (!urls.isEmpty()) {
\t\t\tresult->setUrls(urls);
\t\t}
\t\tFillDragMimeWithPhoto(result.get(), std::move(photoData));
\t\tif (!forwardIds.empty()) {
\t\t\tCrossgram::DragForward::Set(
\t\t\t\tresult.get(),
\t\t\t\t&session().data(),
\t\t\t\tstd::move(forwardIds));
\t\t}`,
          `FillDragMimeWithPhoto(result.get(), std::move(photoData));
\t\tif (!forwardIds.empty()) {`,
        );
      } else {
        file.replace(
          `auto result = std::make_unique<QMimeData>();
\t\tif (!forwardIds.empty()) {
\t\t\tCrossgram::DragForward::Set(
\t\t\t\tresult.get(),
\t\t\t\t&session().data(),
\t\t\t\tstd::move(forwardIds));
\t\t}
\t\tif (!urls.isEmpty()) {
\t\t\tresult->setUrls(urls);
\t\t}`,
          `auto result = std::make_unique<QMimeData>();
\t\tif (!urls.isEmpty()) {
\t\t\tresult->setUrls(urls);
\t\t}
\t\tif (!forwardIds.empty()) {
\t\t\tCrossgram::DragForward::Set(
\t\t\t\tresult.get(),
\t\t\t\t&session().data(),
\t\t\t\tstd::move(forwardIds));
\t\t}`,
          `result->setUrls(urls);
\t\t}
\t\tif (!forwardIds.empty()) {`,
        );
      }
    });
  }

  await context.edit(`${sourceRoot}/dialogs/dialogs_widget.cpp`, (file) => {
    file.insertAfter(
      '#include "dialogs/dialogs_widget.h"',
      `\n\n${include}`,
      include,
    );
    file.replace(
      `_dragForward = !controller()->adaptive().isOneColumn()
\t\t&& data->hasFormat(u"application/x-td-forward"_q);`,
      `_dragForward = !controller()->adaptive().isOneColumn()
\t\t&& Crossgram::DragForward::CanTake(
\t\t\tdata,
\t\t\t&controller()->session().data());`,
      "Crossgram::DragForward::CanTake(",
    );
  });

  await context.edit(`${sourceRoot}/mainwidget.cpp`, (file) => {
    file.insertAfter('#include "mainwidget.h"', `\n\n${include}`, include);
    file.replace(
      `if (data->hasFormat(u"application/x-td-forward"_q)) {
\t\tauto draft = Data::ForwardDraft{
\t\t\t.ids = session().data().takeMimeForwardIds(),
\t\t};`,
      `if (auto ids = Crossgram::DragForward::Take(
\t\t\tdata,
\t\t\t&session().data())) {
\t\tauto draft = Data::ForwardDraft{
\t\t\t.ids = std::move(*ids),
\t\t};`,
      "Crossgram::DragForward::Take(",
    );
  });

  await context.edit(`${sourceRoot}/core/mime_type.cpp`, (file) => {
    file.insertAfter('#include "core/mime_type.h"', `\n\n${include}`, include);
    file.replace(
      `if (original->hasFormat(u"application/x-td-forward"_q)) {
\t\tresult->setData(u"application/x-td-forward"_q, "1");
\t}`,
      "Crossgram::DragForward::CopyMarker(original, result.get());",
      "Crossgram::DragForward::CopyMarker(",
    );
  });

  await context.edit(`${sourceRoot}/storage/storage_media_prepare.cpp`, (file) => {
    file.replace(
      `if (!data || data->hasFormat(u"application/x-td-forward"_q)) {
\t\treturn MimeDataState::None;
\t}`,
      `if (!data) {
\t\treturn MimeDataState::None;
\t}`,
      "if (!data) {",
    );
  });

}
