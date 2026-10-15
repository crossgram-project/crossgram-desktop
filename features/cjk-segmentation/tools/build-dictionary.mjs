// 构建客户端内置的紧凑词典 data/words.bin。
//
// 基础词表来自 jieba（见 SOURCES.md，每行包含词语、词频与词性），过滤低频长尾词后
// 与 data/supplement.txt 合并。
//
// 产物布局（qUncompress 解压后的小端字节序）：
//   header: uint32 version, uint32 count, uint32 maxUnits, int16 unknownScore
//   body:   (count + 1) 个 uint32 词偏移量, count 个 int16 分数, UTF-8 词表拼接字节
//
// 分数为 ln(词频 / 总词频) * 1000 取整，分词时可直接通过整数累加比较路径；
// 词条按 UTF-8 字节序（与码点序一致）升序排列，支持二分查找。
import { readFileSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const featureRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const basePath = process.argv[2];
if (!basePath) {
  throw new Error("Usage: node build-dictionary.mjs <path to jieba dict.txt>");
}

// 过滤基础词表中聊天场景罕见的低频专名与复合词，将词典体积减半
const minFrequency = 8;

// 未知单字默认频次（相当于在基础语料中出现 3 次）
const unknownFrequency = 3;

// 补充词表未指定频次时的默认权重
const supplementFrequency = 3000;

const version = 1;

const isIdeographic = (character) => {
  const code = character.codePointAt(0);
  return (code >= 0x3400 && code <= 0x4dbf)
    || (code >= 0x4e00 && code <= 0x9fff)
    || (code >= 0xf900 && code <= 0xfaff)
    || (code >= 0x20000 && code <= 0x2fa1f);
};
const isUsable = (word) => {
  if (!word.length || word.length > 16) return false;
  for (const character of word) {
    if (!isIdeographic(character)) return false;
  }
  return true;
};

const frequencies = new Map();
let skipped = 0;
for (const line of readFileSync(basePath, "utf8").split("\n")) {
  if (!line) continue;
  const [word, frequency] = line.split(" ");
  const value = Number(frequency);
  if (!word || !Number.isFinite(value)) continue;
  if (!isUsable(word) || value < minFrequency) {
    ++skipped;
    continue;
  }
  frequencies.set(word, Math.max(frequencies.get(word) ?? 0, value));
}

let supplemented = 0;
for (const raw of readFileSync(path.join(featureRoot, "data/supplement.txt"), "utf8").split("\n")) {
  const line = raw.split("#")[0].trim();
  if (!line) continue;
  const [word, frequency] = line.split(/\s+/);
  if (!isUsable(word)) {
    throw new Error(`Supplement word '${word}' is not a plain CJK word.`);
  }
  const value = frequency === undefined ? supplementFrequency : Number(frequency);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Supplement word '${word}' has the bad frequency '${frequency}'.`);
  }
  if (!frequencies.has(word)) ++supplemented;
  frequencies.set(word, Math.max(frequencies.get(word) ?? 0, value));
}

const entries = [...frequencies.entries()]
  .sort((left, right) => Buffer.compare(
    Buffer.from(left[0], "utf8"),
    Buffer.from(right[0], "utf8")));
const total = entries.reduce((sum, entry) => sum + entry[1], 0);
const logTotal = Math.log(total);
const score = (frequency) => Math.max(
  -32000,
  Math.min(0, Math.round((Math.log(frequency) - logTotal) * 1000)));

const words = Buffer.concat(entries.map((entry) => Buffer.from(entry[0], "utf8")));
const offsets = Buffer.alloc((entries.length + 1) * 4);
const scores = Buffer.alloc(entries.length * 2);
let offset = 0;
let maxUnits = 1;
for (let index = 0; index !== entries.length; ++index) {
  const [word] = entries[index];
  offsets.writeUInt32LE(offset, index * 4);
  offset += Buffer.byteLength(word, "utf8");
  scores.writeInt16LE(score(entries[index][1]), index * 2);
  maxUnits = Math.max(maxUnits, word.length);
}
offsets.writeUInt32LE(offset, entries.length * 4);

const header = Buffer.alloc(16);
header.writeUInt32LE(version, 0);
header.writeUInt32LE(entries.length, 4);
header.writeUInt32LE(maxUnits, 8);
header.writeInt16LE(score(unknownFrequency), 12);
const payload = Buffer.concat([header, offsets, scores, words]);
const compressed = deflateSync(payload, { level: 9 });
const framed = Buffer.alloc(4 + compressed.length);
framed.writeUInt32BE(payload.length, 0);
compressed.copy(framed, 4);
const destination = path.join(featureRoot, "data/words.bin");
writeFileSync(destination, framed);

const digest = createHash("sha256").update(framed).digest("hex");
console.log(`words.bin: ${entries.length} words (${skipped} base lines skipped, ${supplemented} supplemented), max ${maxUnits} units`);
console.log(`  payload ${(payload.length / 1048576).toFixed(2)} MiB, shipped ${(framed.length / 1048576).toFixed(2)} MiB, base64 ${(framed.length * 4 / 3 / 1048576).toFixed(2)} MiB`);
console.log(`  sha256 ${digest}`);
