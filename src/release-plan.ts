import type { TargetId } from "./targets.js";

export const RELEASE_PLATFORMS = ["windows", "linux", "macos"] as const;
export type ReleasePlatform = (typeof RELEASE_PLATFORMS)[number];

export const RELEASE_BRAND_BATCHES = [
  { name: "primary", brands: ["cross", "qq"] },
  { name: "secondary", brands: ["wechat", "wecom"] },
  { name: "tertiary", brands: ["dingtalk", "discord"] },
] as const;

export interface ResolvedReleaseTarget {
  readonly target: TargetId;
  readonly repository: string;
  readonly tag: string;
}

export interface ReleaseMatrixEntry extends ResolvedReleaseTarget {
  readonly safeTag: string;
  readonly platform: ReleasePlatform;
  readonly batch: string;
  readonly brands: readonly string[];
}

export interface CreateReleasePlanOptions {
  readonly eventName: string;
  readonly platformFilter?: string | undefined;
  readonly targetFilter?: string | undefined;
  readonly brandFilter?: string | undefined;
  readonly releases: readonly ResolvedReleaseTarget[];
  readonly publishedAssets?: ReadonlySet<string>;
}

export function safeReleaseTag(tag: string): string {
  return tag.replace(/[\/: ]/g, "-");
}

export function releaseArtifactNames(
  target: TargetId,
  brand: string,
  platform: ReleasePlatform,
  safeTag: string,
): readonly [string, string] {
  const extension = platform === "linux" ? "tar.xz" : "zip";
  const base = `crossgram-${target}-${brand}-${platform}-${safeTag}`;
  return [`${base}.${extension}`, `${base}.symbols.${extension}`];
}

function selectedPlatforms(filter = "all"): readonly ReleasePlatform[] {
  switch (filter || "all") {
    case "all":
      return RELEASE_PLATFORMS;
    case "windows-linux":
      return ["windows", "linux"];
    case "windows":
    case "linux":
    case "macos":
      return [filter as ReleasePlatform];
    default:
      throw new Error(`Unknown platform filter '${filter}'.`);
  }
}

function selectedBrands(filter = "all"): ReadonlySet<string> | undefined {
  if (!filter || filter === "all") {
    return undefined;
  }
  return new Set(
    filter
      .split(",")
      .map((brand) => brand.trim())
      .filter(Boolean),
  );
}

export function createReleasePlan({
  eventName,
  platformFilter = "all",
  targetFilter = "all",
  brandFilter = "all",
  releases,
  publishedAssets = new Set<string>(),
}: CreateReleasePlanOptions): ReleaseMatrixEntry[] {
  const platforms = selectedPlatforms(platformFilter);
  const requestedBrands = selectedBrands(brandFilter);
  const skipPublished = eventName === "schedule";
  const matrix: ReleaseMatrixEntry[] = [];

  for (const release of releases) {
    if (targetFilter && targetFilter !== "all" && targetFilter !== release.target) {
      continue;
    }
    const safeTag = safeReleaseTag(release.tag);
    for (const platform of platforms) {
      for (const batch of RELEASE_BRAND_BATCHES) {
        const brands = batch.brands.filter((brand) => {
          if (requestedBrands && !requestedBrands.has(brand)) {
            return false;
          }
          if (!skipPublished) {
            return true;
          }
          return releaseArtifactNames(
            release.target,
            brand,
            platform,
            safeTag,
          ).some((asset) => !publishedAssets.has(asset));
        });
        if (brands.length === 0) {
          continue;
        }
        matrix.push({
          ...release,
          safeTag,
          platform,
          batch: batch.name,
          brands,
        });
      }
    }
  }

  return matrix;
}
