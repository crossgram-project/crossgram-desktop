# Word list sources

`data/words.bin` is built from these sources by
`tools/build-dictionary.mjs`, which keeps the words of the first one that
appear often enough and adds the words of the second one.

| Source | Content | Retrieved |
|---|---|---|
| [fxsjy/jieba](https://github.com/fxsjy/jieba) `jieba/dict.txt` at [`dafc734`](https://github.com/fxsjy/jieba/commit/dafc73425e618c1a0d562f84362b46bedf579bdb) | 349046 Chinese words with the counts of a news corpus, [MIT](https://github.com/fxsjy/jieba/blob/master/LICENSE) | 2026-09-22 |
| `data/supplement.txt` | Words of messaging, applications and the internet that the list above does not carry, written for Crossgram | - |

The base list has the SHA-256
`7197c3211ddd98962b036cdf40324d1ea2bfaa12bd028e68faa70111a88e12a8`
and has not changed since 2014, so the exact revision is the commit above.

The built file that is committed here, `data/words.bin`, has the SHA-256
`3146cbc6a73fe00aa30aa6e0a8883340d694830be3b583d64843fe4d14e90252` and
holds 114791 words taken from both sources.
