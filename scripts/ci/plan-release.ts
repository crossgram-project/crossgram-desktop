import { appendFileSync } from "node:fs";
import { appendFile } from "node:fs/promises";
import {
  createReleasePlan,
  type ResolvedReleaseTarget,
} from "../../src/release-plan.js";
import { targets } from "../../src/targets.js";

const token = process.env.GITHUB_TOKEN;
const repository = process.env.GITHUB_REPOSITORY;
const eventName = process.env.GITHUB_EVENT_NAME ?? "workflow_dispatch";
const apiUrl = (process.env.GITHUB_API_URL ?? "https://api.github.com").replace(/\/$/, "");
const patcherSha = process.env.GITHUB_SHA;

if (!token) {
  throw new Error("GITHUB_TOKEN is required.");
}
if (!repository) {
  throw new Error("GITHUB_REPOSITORY is required.");
}
if (!patcherSha) {
  throw new Error("GITHUB_SHA is required.");
}

async function githubApi(path: string): Promise<unknown> {
  const response = await fetch(`${apiUrl}/${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "crossgram-desktop-release-planner",
    },
  });
  if (!response.ok) {
    throw new Error(
      `GitHub API ${path} returned ${response.status}: ${await response.text()}`,
    );
  }
  return response.json();
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("GitHub API returned an unexpected object.");
  }
  return value as Record<string, unknown>;
}

function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error("GitHub API returned an unexpected array.");
  }
  return value;
}

async function resolveUpstreamReleases(): Promise<ResolvedReleaseTarget[]> {
  return Promise.all(
    targets.map(async ({ id, repository }) => {
      const release = object(await githubApi(`repos/${repository}/releases/latest`));
      if (typeof release.tag_name !== "string" || !release.tag_name) {
        throw new Error(`${repository} latest release did not contain a tag name.`);
      }
      return { target: id, repository, tag: release.tag_name };
    }),
  );
}

async function listPublishedAssets(): Promise<Set<string>> {
  const names = new Set<string>();
  for (let page = 1; ; page += 1) {
    const releases = array(
      await githubApi(`repos/${repository}/releases?per_page=100&page=${page}`),
    );
    for (const releaseValue of releases) {
      const release = object(releaseValue);
      if (release.draft === true || release.target_commitish !== patcherSha) {
        continue;
      }
      for (const assetValue of array(release.assets)) {
        const asset = object(assetValue);
        if (typeof asset.name === "string") {
          names.add(asset.name);
        }
      }
    }
    if (releases.length < 100) {
      break;
    }
  }
  return names;
}

const releases = await resolveUpstreamReleases();
const publishedAssets = eventName === "schedule"
  ? await listPublishedAssets()
  : new Set<string>();
const matrix = createReleasePlan({
  eventName,
  platformFilter: process.env.PLATFORM_FILTER,
  targetFilter: process.env.TARGET_FILTER,
  brandFilter: process.env.BRAND_FILTER,
  releases,
  publishedAssets,
});
const needed = matrix.length > 0;
const matrixOutput = needed
  ? matrix
  : [{
      target: "none",
      repository: repository,
      tag: "none",
      safeTag: "none",
      platform: "linux",
      batch: "none",
      brands: [],
    }];

if (process.env.GITHUB_OUTPUT) {
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    `needed=${String(needed)}\nmatrix=${JSON.stringify(matrixOutput)}\n`,
    "utf8",
  );
}

const summary = [
  "## Desktop release plan",
  "",
  `Planned ${matrix.length} build job${matrix.length === 1 ? "" : "s"}.`,
  "",
  "| Target | Upstream | Platform | Batch | Brands |",
  "| --- | --- | --- | --- | --- |",
  ...matrix.map((entry) =>
    `| ${entry.target} | \`${entry.tag}\` | ${entry.platform} | ${entry.batch} | ${entry.brands.join(", ")} |`
  ),
  ...(needed ? [] : ["| — | No missing or requested builds | — | — | — |"]),
  "",
];
if (process.env.GITHUB_STEP_SUMMARY) {
  await appendFile(process.env.GITHUB_STEP_SUMMARY, summary.join("\n"), "utf8");
}

console.log(JSON.stringify({ needed, matrix }, null, 2));
