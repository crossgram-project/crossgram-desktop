import { PatchContext } from "../../src/core/patch-context.js";
import type { Target } from "../../src/targets.js";

interface PatchOptions {
  readonly root: string;
  readonly target: Target;
  readonly featureRoot: string;
}

const sourceRoot = "Telegram/SourceFiles";

/**
 * 让输入框的 `@` 补全接受子串匹配，而不是只认前缀。
 *
 * 上游的候选来自本地已加载的成员列表，命中条件是
 * `nameWord.startsWith(filter)` 或 `PrimaryUsername(user).startsWith(filter)`。
 * QQ 昵称没有空格（CJK 整串就是一个 word）且常以 emoji/装饰符号开头，
 * 而 Crossgram 里用户的 Telegram 用户名就是数字 QQ 号，所以"打名字中间几个字"
 * 或"跳过昵称开头的 emoji"都会一个人都补不出来。
 *
 * 这里把两处前缀判断放宽为子串判断，其余逻辑不动：过滤词与用户名完全相同时，
 * 仍然返回 true，继续交给 "发送到 @username" 那一行处理。
 */
export async function patchMentionMatching(options: PatchOptions): Promise<void> {
  const context = new PatchContext(options.root, options.target, options.featureRoot);
  await context.edit(`${sourceRoot}/chat_helpers/field_autocomplete.cpp`, (file) => {
    file.replace(
      "\t\t\tif (username.startsWith(_filter, Qt::CaseInsensitive)) {",
      "\t\t\tif (username.contains(_filter, Qt::CaseInsensitive)) {",
      "if (username.contains(_filter, Qt::CaseInsensitive)) {",
    );
    file.replace(
      "\t\t\tif (nameWord.startsWith(_filter, Qt::CaseInsensitive)) {",
      "\t\t\tif (nameWord.contains(_filter, Qt::CaseInsensitive)) {",
      "if (nameWord.contains(_filter, Qt::CaseInsensitive)) {",
    );
  });
}
