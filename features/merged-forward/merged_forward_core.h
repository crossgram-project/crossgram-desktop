// This file is part of Crossgram Desktop.

#pragma once

#include <cstdint>
#include <string_view>

namespace Crossgram::MergedForward {

// 服务端用 `bridgebundle_<id>`（旧版为 `bridgechat_<id>`）标识合成的合并转发会话。
// 这类会话仅作历史记录视图展示，不能加入左侧会话列表，且打开链接时需直接定位到首条消息。
// 此头文件不依赖 Qt，供 merged_forward.cpp 将 QString 转为字节后调用。
inline constexpr auto kUsernamePrefixes = {
	std::string_view("bridgebundle_"),
	std::string_view("bridgechat_"),
};

// 与 QString::toLongLong() 校验规则一致：后缀必须为纯 ASCII 数字，且在 64 位正有符号整数范围内。
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
