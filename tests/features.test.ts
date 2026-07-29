import { describe, expect, it } from "vitest";
import { featureIds, resolveFeatures } from "../src/features.js";

describe("optional features", () => {
  it("keeps semantic E2E disabled for ordinary builds", () => {
    expect(featureIds).toEqual(["e2e"]);
    expect([...resolveFeatures([])]).toEqual([]);
  });

  it("enables E2E only when explicitly selected and de-duplicates flags", () => {
    expect([...resolveFeatures(["e2e", "e2e"])]).toEqual(["e2e"]);
  });

  it("rejects unknown feature names", () => {
    expect(() => resolveFeatures(["debug-api"])).toThrow("Unknown feature 'debug-api'");
  });
});
