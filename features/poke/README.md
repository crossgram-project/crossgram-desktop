# Crossgram poke menus

QQ 的「戳一戳」在 Telegram Desktop 里不存在，所以修改版客户端把它挂到 Telegram 自己
的头像菜单上：点一次头像就戳一下，hover 箭头展开 `1 / 5 / 10` 的连戳子菜单。

菜单入口：

- **消息头像菜单**（`Window::FillSenderUserpicMenu`，群/超级群里点消息左侧头像）：
  戳这条消息的发送者，对话是该消息所在的群。
- **私聊菜单**（`Filler::fillHistoryActions`，聊天标题右侧 ⋮ / 右键会话列表）：
  戳这个私聊对象。
- **资料页菜单**（`Filler::fillProfileActions`，用户资料页 ⋮）：同上。

三处都调用同一个 helper `Crossgram::Poke::AddMenuAction`，条件不满足时它什么都不加：

- 头像/资料不是用户（群、频道）或就是自己；
- 还没拿到服务器对这个会话的能力回答；
- 服务器回答「这个会话不支持戳一戳」。

## 服务端交互

| RPC | 用途 |
| --- | --- |
| `crossgram.getFeatures#c3e6b915 peer:InputPeer = DataJSON;` | 询问某个会话支持哪些 Crossgram 扩展，回答形如 `{"poke":{"maxCount":10}}` |
| `crossgram.sendPoke#9a2d47f0 peer:InputPeer user_id:InputUser count:int = Bool;` | 在 `peer` 里戳 `user_id`，一次性发送 `count` 次（1..maxCount） |

打开任意聊天时 `SessionNavigation::showPeerHistory` 会先 `Warm` 一次，因此绝大多数情况下
用户点开头像时答案已经缓存好，菜单里直接就有「戳一戳」。戳成功的本地回显不是客户端造的：
中转端把 QQ 自己生成的戳一戳系统消息当作普通消息推送，历史、未读和多端同步与 QQ 侧一致。

## 官方服务器兼容

戳一戳入口在**官方 Telegram 服务器上不显示**，而且客户端不会反复试探：

1. 探测只在 `getFeatures` 有结果或明确报错后才有结论。报错（官方服务器不认这个方法）
   会把整个 session 标记为「没有 Crossgram 扩展」，此后不再提问。
2. 没有回答（例如请求被静默丢弃）时，同一个会话最多每小时重试一次，期间仍然不显示入口。
3. 结果是按 session + 会话缓存的，换账号、重登都会重新判断；不会因为缓存而把入口留给
   官方服务器。

探测本身是普通的 MTProto RPC，官方服务器只会把它当作未知方法处理：失败被 `.fail` 静默
吞掉，界面上没有任何提示或日志弹窗。
