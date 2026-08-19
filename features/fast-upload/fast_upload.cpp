#include "crossgram/fast_upload.h"

#include "storage/localimageloader.h"

#include <QtCore/QCryptographicHash>
#include <QtCore/QFile>

#include <algorithm>
namespace Crossgram::FastUpload {
namespace {

constexpr auto kFirstChunkLimit = qint64(10) * 1024 * 1024;

class Hasher final {
public:
	void feed(const QByteArray &bytes) {
		_md5.addData(bytes);
		_sha1.addData(bytes);
		if (_size < kFirstChunkLimit) {
			_first.addData(bytes.constData(), int(std::min<qint64>(
				bytes.size(),
				kFirstChunkLimit - _size)));
		}
		_size += bytes.size();
	}

	[[nodiscard]] Hashes finish() {
		return {
			.size = _size,
			.md5 = _md5.result(),
			.sha1 = _sha1.result(),
			.file10mMd5 = _first.result(),
		};
	}

private:
	QCryptographicHash _md5 = QCryptographicHash(QCryptographicHash::Md5);
	QCryptographicHash _sha1 = QCryptographicHash(QCryptographicHash::Sha1);
	QCryptographicHash _first = QCryptographicHash(QCryptographicHash::Md5);
	qint64 _size = 0;
};

} // namespace

std::optional<Hashes> HashPrepared(const FilePrepareResult &file) {
	auto hasher = Hasher();
	if (file.type == SendMediaType::Photo) {
		for (const auto &part : file.fileparts) hasher.feed(part);
	} else if (!file.content.isEmpty()) {
		hasher.feed(file.content);
	} else if (!file.filepath.isEmpty()) {
		auto input = QFile(file.filepath);
		if (!input.open(QIODevice::ReadOnly)) return std::nullopt;
		while (!input.atEnd()) {
			const auto bytes = input.read(256 * 1024);
			if (bytes.isEmpty() && input.error() != QFileDevice::NoError) return std::nullopt;
			hasher.feed(bytes);
		}
	} else {
		return std::nullopt;
	}
	const auto result = hasher.finish();
	return result.size > 0 ? std::make_optional(result) : std::nullopt;
}

QString Kind(const FilePrepareResult &file) {
	if (file.type == SendMediaType::Photo) return QStringLiteral("image");
	return file.filemime.startsWith(QStringLiteral("video/"), Qt::CaseInsensitive)
		? QStringLiteral("video")
		: QStringLiteral("file");
}

} // namespace Crossgram::FastUpload
