#pragma once

#include <QtCore/QByteArray>
#include <QtCore/QString>
#include <QtCore/QtGlobal>

#include <optional>

struct FilePrepareResult;

namespace Crossgram::FastUpload {

struct Hashes {
	qint64 size = 0;
	QByteArray md5;
	QByteArray sha1;
	QByteArray sha1Checkpoints;
	QByteArray file10mMd5;
};

[[nodiscard]] std::optional<Hashes> HashPrepared(const FilePrepareResult &file);
[[nodiscard]] QString Kind(const FilePrepareResult &file);

} // namespace Crossgram::FastUpload
