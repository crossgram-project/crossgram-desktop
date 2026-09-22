// This file is part of Crossgram Desktop.

#pragma once

#include <cstdint>
#include <string_view>

namespace Crossgram::MergedForward {

// The relay names a synthetic merged-forward chat after the multi-forward it
// renders: `bridgebundle_<id>` in current builds and `bridgechat_<id>` in
// older ones that are still addressable. Such a username means "history-only
// view": the peer must stay out of the chat list, and the link has to open
// the transcript at the message it anchors to, which the relay points at the
// first message of the bundle. The glue in merged_forward.cpp maps the
// QString onto these bytes, so the accepted usernames can be verified
// without Qt.
inline constexpr auto kUsernamePrefixes = {
	std::string_view("bridgebundle_"),
	std::string_view("bridgechat_"),
};

// Matches QString::toLongLong() as used by the glue: the id must consist of
// ASCII digits, fit into a signed 64-bit value and be positive.
[[nodiscard]] inline bool IsSyntheticUsername(std::string_view username) {
	constexpr auto kMaxId = std::uint64_t(0x7FFFFFFFFFFFFFFFULL);
	for (const auto prefix : kUsernamePrefixes) {
		if (username.size() <= prefix.size()) {
			continue;
		}
		auto matching = true;
		for (auto index = std::size_t(0); index != prefix.size(); ++index) {
			const auto lowered = (username[index] >= 'A' && username[index] <= 'Z')
				? char(username[index] + ('a' - 'A'))
				: username[index];
			if (lowered != prefix[index]) {
				matching = false;
				break;
			}
		}
		if (!matching) {
			continue;
		}
		auto id = std::uint64_t(0);
		for (const auto ch : username.substr(prefix.size())) {
			if (ch < '0' || ch > '9') {
				return false;
			}
			const auto digit = std::uint64_t(ch - '0');
			if (id > (kMaxId - digit) / 10) {
				return false;
			}
			id = id * 10 + digit;
		}
		return id > 0;
	}
	return false;
}

} // namespace Crossgram::MergedForward
