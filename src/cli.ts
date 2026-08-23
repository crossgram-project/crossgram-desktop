#!/usr/bin/env node
import { appendFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { patchBranding } from "../features/branding/patch.js";
import { patchE2e } from "../features/e2e/patch.js";
import { patchServerSwitch } from "../features/server-switch/patch.js";
import { patchDirectDownload } from "../features/direct-download/patch.js";
import { patchFastUpload } from "../features/fast-upload/patch.js";
import { patchCrossInstanceForward } from "../features/cross-instance-forward/patch.js";
import { patchRawAnimation } from "../features/raw-animation/patch.js";
import { patchMergedForward } from "../features/merged-forward/patch.js";
import { patchUpstreamCompatibility } from "../features/upstream-compat/patch.js";
import { brandById, resolveBrand } from "./brands.js";
import { resolveFeatures } from "./features.js";
import { targetById } from "./targets.js";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    root: { type: "string", short: "r" },
    target: { type: "string", short: "t" },
    brand: { type: "string", short: "b", default: "cross" },
    feature: { type: "string", multiple: true, default: [] },
    "github-output": { type: "boolean", default: false },
  },
});

const command = positionals[0];
if (!values.target || (command === "patch" && !values.root) || !["patch", "metadata"].includes(command ?? "")) {
  console.error("Usage: yarn apply --target <id> --brand <id> --root <tdesktop checkout> [--feature e2e]");
  console.error("       yarn metadata --target <id> --brand <id>");
  process.exitCode = 2;
} else {
  const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const target = targetById(values.target);
  const brand = resolveBrand(target, brandById(values.brand ?? "cross"));
  const features = resolveFeatures(values.feature ?? []);
  if (command === "metadata") {
    const metadata = {
      target: target.id,
      repository: target.repository,
      upstreamExecutable: target.executable,
      executable: brand.executable,
      displayName: brand.title,
      packageSuffix: brand.packageSuffix,
      linuxId: brand.linuxId,
      windowsAppId: brand.windowsAppId,
      apiId: target.apiId,
      apiHash: target.apiHash,
      brand: brand.id,
    };
    if (values["github-output"]) {
      const output = process.env.GITHUB_OUTPUT;
      if (!output) throw new Error("GITHUB_OUTPUT is not set.");
      await appendFile(
        output,
        Object.entries(metadata).map(([key, value]) => `${key}=${value}\n`).join(""),
        "utf8",
      );
    } else {
      console.log(JSON.stringify(metadata));
    }
  } else {
    await patchUpstreamCompatibility({
      root: values.root!,
      target,
    });
    await patchServerSwitch({
      root: values.root!,
      target,
      featureRoot: resolve(repositoryRoot, "features/server-switch"),
    });
    await patchDirectDownload({
      root: values.root!,
      target,
      featureRoot: resolve(repositoryRoot, "features/direct-download"),
    });
    await patchFastUpload({
      root: values.root!,
      target,
      featureRoot: resolve(repositoryRoot, "features/fast-upload"),
    });
    await patchCrossInstanceForward({
      root: values.root!,
      target,
      featureRoot: resolve(repositoryRoot, "features/cross-instance-forward"),
    });
    await patchRawAnimation({
      root: values.root!,
      target,
      featureRoot: resolve(repositoryRoot, "features/raw-animation"),
    });
    await patchMergedForward({
      root: values.root!,
      target,
      featureRoot: resolve(repositoryRoot, "features/merged-forward"),
    });
    await patchBranding({
      root: values.root!,
      target,
      brand,
      featureRoot: resolve(repositoryRoot, "features/branding"),
    });
    if (features.has("e2e")) {
      await patchE2e({
        root: values.root!,
        target,
        featureRoot: resolve(repositoryRoot, "features/e2e"),
      });
    }
    const enabled = features.size ? ` with ${[...features].join(", ")}` : "";
    console.log(`Patched ${values.target}/${brand.id}${enabled} at ${resolve(values.root!)}.`);
  }
}
