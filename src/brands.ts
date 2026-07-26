import { createHash } from "node:crypto";
import type { Target } from "./targets.js";

export type BrandId = "cross" | "qq" | "wechat" | "wecom" | "dingtalk" | "discord";

export interface Brand {
  readonly id: BrandId;
  readonly title: string | null;
  readonly executable: string | null;
  readonly packageSuffix: string;
  readonly icon: string | null;
}

export interface ResolvedBrand {
  readonly id: BrandId;
  readonly title: string;
  readonly executable: string;
  readonly packageSuffix: string;
  readonly icon: string | null;
  readonly windowsAppId: string;
  readonly linuxId: string;
}

export const brands: readonly Brand[] = [
  { id: "cross", title: null, executable: null, packageSuffix: "crossgram", icon: null },
  { id: "qq", title: "QQ · Cross", executable: "QQ-Cross", packageSuffix: "crossgram.qq", icon: "qq.jpg" },
  { id: "wechat", title: "微信 · Cross", executable: "WeChat-Cross", packageSuffix: "crossgram.wechat", icon: "wechat.jpg" },
  { id: "wecom", title: "企业微信 · Cross", executable: "WeCom-Cross", packageSuffix: "crossgram.wecom", icon: "wecom.png" },
  { id: "dingtalk", title: "钉钉 · Cross", executable: "DingTalk-Cross", packageSuffix: "crossgram.dingtalk", icon: "dingtalk.jpg" },
  { id: "discord", title: "Discord · Cross", executable: "Discord-Cross", packageSuffix: "crossgram.discord", icon: "discord.jpg" },
] as const;

export function brandById(value: string): Brand {
  const result = brands.find(({ id }) => id === value);
  if (!result) throw new Error(`Unknown brand '${value}'.`);
  return result;
}

export function resolveBrand(target: Target, brand: Brand): ResolvedBrand {
  const title = brand.title ?? target.crossName;
  const executable = brand.executable ?? target.crossName;
  const bytes = createHash("sha256").update(`${target.id}:${brand.id}`).digest().subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex").toUpperCase();
  const windowsAppId = `{${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}}`;
  const linuxId = `${target.desktopFile.slice(0, -".desktop".length)}.${brand.packageSuffix}`;
  return { ...brand, title, executable, windowsAppId, linuxId };
}
