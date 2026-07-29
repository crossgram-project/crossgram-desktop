#pragma once

#include <QtCore/QString>

[[nodiscard]] inline QString operator""_q(
		const char16_t *data,
		std::size_t size) {
	return QString::fromRawData(
		reinterpret_cast<const QChar*>(data),
		size);
}
