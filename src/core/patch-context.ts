import { copyFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { Target } from "../targets.js";
import { TextFile } from "./text-file.js";

export class PatchContext {
  readonly root: string;
  readonly featureRoot: string;

  constructor(
    root: string,
    readonly target: Target,
    featureRoot: string,
  ) {
    this.root = resolve(root);
    this.featureRoot = resolve(featureRoot);
  }

  async edit(relativePath: string, edit: (file: TextFile) => void): Promise<void> {
    const file = await TextFile.open(join(this.root, relativePath));
    edit(file);
    await file.save();
  }

  async install(asset: string, relativePath: string): Promise<void> {
    const destination = join(this.root, relativePath);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(join(this.featureRoot, asset), destination);
  }

  async fragment(name: string): Promise<string> {
    const value = await readFile(join(this.featureRoot, "fragments", name), "utf8");
    return value.replace(/\r?\n$/, "");
  }
}
