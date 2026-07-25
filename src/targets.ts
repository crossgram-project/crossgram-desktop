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

export const targets: readonly Target[] = [
  {
    id: "tdesktop",
    repository: "telegramdesktop/tdesktop",
    product: "Telegram Desktop",
    executable: "Telegram",
    crossName: "CrossTelegram",
    apiId: 2040,
    apiHash: "b18441a1ff607e10a989891a5462e627",
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
    apiId: 3722065,
    apiHash: "34900e12ee1e3e1d0d22fa627ac3540d",
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
    apiId: 2040,
    apiHash: "b18441a1ff607e10a989891a5462e627",
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
    apiId: 26417228,
    apiHash: "bf44847efaa9fbb46495e3c3ca9f12f4",
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
