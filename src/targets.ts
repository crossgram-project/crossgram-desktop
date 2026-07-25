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
}

export const targets: readonly Target[] = [
  {
    id: "tdesktop",
    repository: "telegramdesktop/tdesktop",
    product: "Telegram Desktop",
    executable: "Telegram",
  },
  {
    id: "tdesktop-x64",
    repository: "TDesktop-x64/tdesktop",
    product: "64Gram",
    executable: "Telegram",
  },
  {
    id: "ayugram",
    repository: "AyuGram/AyuGramDesktop",
    product: "AyuGram Desktop",
    executable: "AyuGram",
  },
  {
    id: "materialgram",
    repository: "kukuruzka165/materialgram",
    product: "Materialgram",
    executable: "materialgram",
  },
] as const;

export function targetById(value: string): Target {
  const result = targets.find(({ id }) => id === value);
  if (!result) {
    throw new Error(`Unknown target '${value}'.`);
  }
  return result;
}
