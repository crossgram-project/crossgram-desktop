# 桌面端语义 E2E 接口（`features/e2e`）

受控端到端测试特性（常规构建不包含，需显式传入 `--feature e2e`）：基于 Qt Accessibility 树暴露仅绑定 `127.0.0.1` 的 JSON Lines 自动化接口。

## 启用与运行

```bash
# 1. 打入 E2E 补丁
yarn apply --target tdesktop --brand cross --root /path/to/tdesktop --feature e2e

# 2. 启动客户端（必须同时提供本地端口与至少 32 字符的 Token，否则接口不开启）
CROSSGRAM_E2E_PORT=43127 \
CROSSGRAM_E2E_TOKEN="$(openssl rand -hex 32)" \
/path/to/CrossTelegram
```

## 驱动命令

```bash
yarn e2e:desktop --port 43127 --token "$CROSSGRAM_E2E_TOKEN" --command snapshot
yarn e2e:desktop --port 43127 --token "$CROSSGRAM_E2E_TOKEN" --command action \
  --selector '{"name":"Next","role":"button"}' --action press
```

支持的协议命令：`ping`、`snapshot`（导出无障碍树，密码框内容自动脱敏）、`action`（按选择器触发动作）、`setText`（修改可编辑控件文本）。
