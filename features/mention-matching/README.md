# Crossgram mention matching

> 定位：**兜底/缓解**。真正的修复是让补全弹窗按过滤词去服务器搜成员（官方移动端就是这么做的），
> 见文末「已知的遗留问题」。

输入框里打 `@` 之后的候选列表只用**子串**匹配姓名与用户名。

上游（Telegram Desktop）的两处过滤条件都是前缀匹配：

- `field_autocomplete.cpp`：`nameWord.startsWith(_filter, Qt::CaseInsensitive)`
- `field_autocomplete.cpp`：`PrimaryUsername(user).startsWith(_filter, Qt::CaseInsensitive)`

对 Crossgram 的 QQ 群来说这两条都太窄：

- QQ 昵称基本没有空格，CJK 名字整串就是一个 word，只有从名字第一个字开始打才命中；
- 昵称经常以 emoji 或装饰符号开头（`🌸名字`），此时打 `@名字` 完全匹配不到；
- 用户的 Telegram 用户名是**数字 QQ 号**（relay 的 `platform-crossgram` 投影），
  对"按昵称找人"没有帮助。

## 改动

只把上面两处 `startsWith` 换成 `contains`，其余逻辑（完全等于用户名时仍然交给
"发送到 @username" 一行、`isInaccessible()` 跳过、候选来源与条数）保持不变。

## 已知的遗留问题

候选人数仍然只来自本地已经加载的那一页成员（`channels.getParticipants` 的
`channelParticipantsRecent`，条数上限是服务器 `help.getConfig` 里的 `chatSizeMax`，
Crossgram 目前是 200），排在这一页之后的人还是不会出现。真正的修法是像 Android 端那样在
过滤词非空时调用 `channels.getParticipants(channelParticipantsMentions, q)`（relay 已实现，
会扫全量成员快照），需要给 `Api::ChatParticipants` 加一个新方法并在补全弹出框里异步追加行。
