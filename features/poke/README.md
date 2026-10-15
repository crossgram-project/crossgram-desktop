# 戳一戳菜单（`features/poke`）

在 Telegram Desktop 的三处菜单中挂载「戳一戳」（点击发送 1 次，悬停展开 `1 / 5 / 10` 连戳子菜单）：

- **群消息头像菜单**（`Window::FillSenderUserpicMenu`）
- **私聊顶部/右键菜单**（`Filler::fillHistoryActions`）
- **用户资料页菜单**（`Filler::fillProfileActions`）

## 服务端交互与兼容

| RPC | 说明 |
|---|---|
| `crossgram.getFeatures#c3e6b915 peer:InputPeer = DataJSON;` | 查询会话能力（如 `{"poke":{"maxCount":10}}`） |
| `crossgram.sendPoke#9a2d47f0 peer:InputPeer user_id:InputUser count:int = Bool;` | 向目标用户发送 `count` 次戳一戳 |

- 打开会话时（`SessionNavigation::showPeerHistory`）自动预热查询并按 `session + peer` 缓存结果。
- 若服务端报错（如官方 Telegram 服务器不支持该 RPC），当前账号会话将被标记为不支持并不再发起探测，菜单中不显示入口。
