# 服务器切换（`features/server-switch`）

向 Telegram Desktop 注入按账号隔离的自定义 MTProto 服务器配置能力。实现代码拷贝至 `Telegram/SourceFiles/crossgram/server_switch.{h,cpp}`，结构化补丁片段位于 `fragments/`。

## 注入位置

- `Intro::Widget`：登录页 **Server** 按钮、配置选择弹窗与 JSON 编辑器
- `Storage::Account`：按账号读写 `tdata/<account-hash>/server-switch.json`
- `Main::Account`：启动时加载自定义服务器配置，切换服务器时重建 MTProto 实例
- `Main::Domain`：新增账号时继承来源账号已保存的服务器配置
- `MTP::DcOptions`：应用自定义 DC 地址与 RSA 公钥，并在禁用时拦截官方配置覆盖
- `ConfigLoader`：`enable_special_config: false` 时跳过 Telegram Special Config 拉取
- `Telegram/CMakeLists.txt`：注册新增源文件
