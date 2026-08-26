#include "crossgram/fast_upload.h"

#include "storage/localimageloader.h"

#include <QtCore/QCryptographicHash>
#include <QtCore/QFile>

extern "C" {
#include <openssl/sha.h>
}

#include <algorithm>
namespace Crossgram::FastUpload {
namespace {

constexpr auto kFirstChunkLimit = qint64(10) * 1024 * 1024;
constexpr auto kSha1CheckpointBytes = qint64(1024) * 1024;

class Hasher final {
public:
	Hasher() {
		SHA1_Init(&_sha1State);
	}

	void feed(const QByteArray &bytes) {
		_md5.addData(bytes);
		_sha1.addData(bytes);
		if (_size < kFirstChunkLimit) {
			_first.addData(bytes.constData(), int(std::min<qint64>(
				bytes.size(),
				kFirstChunkLimit - _size)));
		}
		for (auto offset = qsizetype(0); offset < bytes.size();) {
			const auto untilCheckpoint = kSha1CheckpointBytes
				- (_sha1Bytes % kSha1CheckpointBytes);
			const auto length = std::min<qint64>(bytes.size() - offset, untilCheckpoint);
			SHA1_Update(&_sha1State, bytes.constData() + offset, size_t(length));
			_sha1Bytes += length;
			offset += length;
			if ((_sha1Bytes % kSha1CheckpointBytes) == 0) {
				appendIntermediateSha1();
			}
		}
		_size += bytes.size();
	}

	[[nodiscard]] Hashes finish() {
		const auto finalSha1 = _sha1.result();
		if ((_size % kSha1CheckpointBytes) == 0 && !_sha1Checkpoints.isEmpty()) {
			_sha1Checkpoints.chop(SHA_DIGEST_LENGTH);
			_sha1Checkpoints.append(finalSha1);
		} else {
			_sha1Checkpoints.append(finalSha1);
		}
		return {
			.size = _size,
			.md5 = _md5.result(),
			.sha1 = finalSha1,
			.sha1Checkpoints = _sha1Checkpoints,
			.file10mMd5 = _first.result(),
		};
	}

private:
	void appendIntermediateSha1() {
		const auto append = [this](uint32_t value) {
			for (auto shift = 0; shift != 32; shift += 8) {
				_sha1Checkpoints.append(char((value >> shift) & 0xff));
			}
		};
		append(_sha1State.h0);
		append(_sha1State.h1);
		append(_sha1State.h2);
		append(_sha1State.h3);
		append(_sha1State.h4);
	}

	QCryptographicHash _md5 = QCryptographicHash(QCryptographicHash::Md5);
	QCryptographicHash _sha1 = QCryptographicHash(QCryptographicHash::Sha1);
	QCryptographicHash _first = QCryptographicHash(QCryptographicHash::Md5);
	SHA_CTX _sha1State = {};
	QByteArray _sha1Checkpoints;
	qint64 _sha1Bytes = 0;
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
