export type TargetId =
  | "tdesktop"
  | "tdesktop-x64"
  | "ayugram"
  | "materialgram";

export interface Target {
  readonly id: TargetId;
  readonly repository: string;
  readonly product: string;
  readonly executable: string;
  readonly crossName: string;
  readonly apiId: number;
  readonly apiHash: string;
  readonly desktopFile: string;
  readonly linuxIconId: string;
  readonly macIconSet: string;
}

export const CROSSGRAM_TELEGRAM_API_ID = 24862414;
export const CROSSGRAM_TELEGRAM_API_HASH =
  "1745670d4621f50d831db069ecc40285";

export const targets: readonly Target[] = [
  {
    id: "tdesktop",
    repository: "telegramdesktop/tdesktop",
    product: "Telegram Desktop",
    executable: "Telegram",
    crossName: "CrossTelegram",
    apiId: CROSSGRAM_TELEGRAM_API_ID,
    apiHash: CROSSGRAM_TELEGRAM_API_HASH,
    desktopFile: "org.telegram.desktop.desktop",
    linuxIconId: "org.telegram.desktop",
    macIconSet: "Icon.appiconset",
  },
  {
    id: "tdesktop-x64",
    repository: "TDesktop-x64/tdesktop",
    product: "64Gram",
    executable: "Telegram",
    crossName: "Cross64Gram",
    apiId: CROSSGRAM_TELEGRAM_API_ID,
    apiHash: CROSSGRAM_TELEGRAM_API_HASH,
    desktopFile: "io.github.tdesktop_x64.TDesktop.desktop",
    linuxIconId: "org.telegram.desktop",
    macIconSet: "Icon.appiconset",
  },
  {
    id: "ayugram",
    repository: "AyuGram/AyuGramDesktop",
    product: "AyuGram Desktop",
    executable: "AyuGram",
    crossName: "CrossAyuGram",
    apiId: CROSSGRAM_TELEGRAM_API_ID,
    apiHash: CROSSGRAM_TELEGRAM_API_HASH,
    desktopFile: "com.ayugram.desktop.desktop",
    linuxIconId: "com.ayugram.desktop",
    macIconSet: "AppIcon.appiconset",
  },
  {
    id: "materialgram",
    repository: "kukuruzka165/materialgram",
    product: "Materialgram",
    executable: "materialgram",
    crossName: "CrossMaterialgram",
    apiId: CROSSGRAM_TELEGRAM_API_ID,
    apiHash: CROSSGRAM_TELEGRAM_API_HASH,
    desktopFile: "io.github.kukuruzka165.materialgram.desktop",
    linuxIconId: "io.github.kukuruzka165.materialgram",
    macIconSet: "AppIcon.appiconset",
  },
] as const;

export function targetById(value: string): Target {
  const result = targets.find(({ id }) => id === value);
  if (!result) {
    throw new Error(`Unknown target '${value}'.`);
  }
  return result;
}
