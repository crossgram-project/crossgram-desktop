#!/usr/bin/env node
import { appendFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { patchBranding } from "../features/branding/patch.js";
import { patchServerSwitch } from "../features/server-switch/patch.js";
import { brandById, resolveBrand } from "./brands.js";
import { targetById } from "./targets.js";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    root: { type: "string", short: "r" },
    target: { type: "string", short: "t" },
    brand: { type: "string", short: "b", default: "cross" },
    "github-output": { type: "boolean", default: false },
  },
});

const command = positionals[0];
if (!values.target || (command === "patch" && !values.root) || !["patch", "metadata"].includes(command ?? "")) {
  console.error("Usage: yarn apply --target <id> --brand <id> --root <tdesktop checkout>");
  console.error("       yarn metadata --target <id> --brand <id>");
  process.exitCode = 2;
} else {
  const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const target = targetById(values.target);
  const brand = resolveBrand(target, brandById(values.brand ?? "cross"));
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
    await patchServerSwitch({
      root: values.root!,
      target,
      featureRoot: resolve(repositoryRoot, "features/server-switch"),
    });
    await patchBranding({
      root: values.root!,
      target,
      brand,
      featureRoot: resolve(repositoryRoot, "features/branding"),
    });
    console.log(`Patched ${values.target}/${brand.id} at ${resolve(values.root!)}.`);
  }
}
