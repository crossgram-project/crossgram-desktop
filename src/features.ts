export type FeatureId = "e2e";

export const featureIds: readonly FeatureId[] = ["e2e"];

export function resolveFeatures(values: readonly string[]): ReadonlySet<FeatureId> {
  const result = new Set<FeatureId>();
  for (const value of values) {
    if (!featureIds.includes(value as FeatureId)) {
      throw new Error(`Unknown feature '${value}'.`);
    }
    result.add(value as FeatureId);
  }
  return result;
}
