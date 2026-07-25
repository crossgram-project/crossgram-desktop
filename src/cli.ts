#!/usr/bin/env node
import { parseArgs } from "node:util";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { patchServerSwitch } from "../features/server-switch/patch.js";
import { targetById } from "./targets.js";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    root: { type: "string", short: "r" },
    target: { type: "string", short: "t" },
  },
});

if (positionals[0] !== "patch" || !values.root || !values.target) {
  console.error("Usage: yarn apply --target <id> --root <tdesktop checkout>");
  process.exitCode = 2;
} else {
  const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  await patchServerSwitch({
    root: values.root,
    target: targetById(values.target),
    featureRoot: resolve(repositoryRoot, "features/server-switch"),
  });
  console.log(`Patched ${values.target} at ${resolve(values.root)}.`);
}
