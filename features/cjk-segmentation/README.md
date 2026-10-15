# 中日文分词与光标移动（`features/cjk-segmentation`）

Telegram Desktop 与 Qt 默认仅按空格和 ASCII 标点分词，中文句子在无空格或使用全角标点时会被当成整句处理，导致双击选中整句、`Ctrl+Left/Right` 直接跳过整句。

## 补丁行为

- 在 `ui/text/text.h` 中引入 `Ui::Text::WordSegment`，补充全角标点分隔，并使用内置词频词典对连续汉字做最大概率切分（按 64 字符分块处理以限制单次开销）。
- 接管消息正文与输入框（`Ui::InputField`）的选词与光标按词移动逻辑：
  - 双击中文按词选中，拖拽按词扩展选区；
  - `Ctrl+Left/Right`（macOS 为 `Option+Left/Right`）按词移动光标；
  - `Ctrl+Backspace` 与 `Ctrl+Delete` 按词删除。

## 词典生成

`data/words.bin` 包含 114,791 个常用词条（基于结巴分词词典与 `data/supplement.txt` 聊天常用词补充，经 zlib 压缩供 `qUncompress` 加载），可通过以下命令重新生成：

```bash
node features/cjk-segmentation/tools/build-dictionary.mjs <path-to-jieba-dict.txt>
```
