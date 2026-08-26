import { execFile } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { releaseArtifactNames } from "../src/release-plan.js";

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const servers: ReturnType<typeof createServer>[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) =>
    new Promise<void>((resolveClose, reject) => {
      server.close((error) => error ? reject(error) : resolveClose());
    })
  ));
});

describe("release planner script", () => {
  it("resolves upstream releases and writes only missing scheduled jobs", async () => {
    const completeAssets = [
      ...releaseArtifactNames("tdesktop", "cross", "windows", "v1"),
      ...releaseArtifactNames("ayugram", "cross", "windows", "v1"),
      releaseArtifactNames("tdesktop-x64", "cross", "windows", "v1")[0],
    ].map((name) => ({ name }));
    const upstreamTags = new Map([
      ["/repos/telegramdesktop/tdesktop/releases/latest", "v1"],
      ["/repos/TDesktop-x64/tdesktop/releases/latest", "v1"],
      ["/repos/AyuGram/AyuGramDesktop/releases/latest", "v1"],
      ["/repos/kukuruzka165/materialgram/releases/latest", "v1"],
    ]);
    const server = createServer((request, response) => {
      response.setHeader("content-type", "application/json");
      const url = new URL(request.url ?? "/", "http://localhost");
      const tag = upstreamTags.get(url.pathname);
      if (tag) {
        response.end(JSON.stringify({ tag_name: tag }));
        return;
      }
      if (url.pathname === "/repos/crossgram-project/crossgram-desktop/releases") {
        response.end(JSON.stringify([
          { target_commitish: "current-sha", draft: false, assets: completeAssets },
          {
            target_commitish: "old-sha",
            draft: false,
            assets: [
              ...releaseArtifactNames("materialgram", "cross", "windows", "v1"),
            ].map((name) => ({ name })),
          },
        ]));
        return;
      }
      response.statusCode = 404;
      response.end(JSON.stringify({ message: "not found" }));
    });
    servers.push(server);
    await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Test server did not expose a TCP port.");
    }

    const directory = await mkdtemp(join(tmpdir(), "crossgram-release-plan-"));
    const output = join(directory, "output.txt");
    const summary = join(directory, "summary.md");
    const tsx = resolve(repositoryRoot, "node_modules/tsx/dist/cli.mjs");
    const script = resolve(repositoryRoot, "scripts/ci/plan-release.ts");
    await execFileAsync(process.execPath, [tsx, script], {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        GITHUB_API_URL: `http://127.0.0.1:${address.port}`,
        GITHUB_EVENT_NAME: "schedule",
        GITHUB_OUTPUT: output,
        GITHUB_REPOSITORY: "crossgram-project/crossgram-desktop",
        GITHUB_SHA: "current-sha",
        GITHUB_STEP_SUMMARY: summary,
        GITHUB_TOKEN: "test-token",
        PLATFORM_FILTER: "windows",
        TARGET_FILTER: "all",
        BRAND_FILTER: "cross",
      },
    });

    const outputText = await readFile(output, "utf8");
    expect(outputText).toContain("needed=true\n");
    const matrix = JSON.parse(
      outputText.match(/^matrix=(.+)$/m)?.[1] ?? "[]",
    ) as { target: string; brands: string[] }[];
    expect(matrix.map(({ target }) => target)).toEqual([
      "tdesktop-x64",
      "materialgram",
    ]);
    expect(matrix.every(({ brands }) => brands.join() === "cross")).toBe(true);
    expect(await readFile(summary, "utf8")).toContain("Planned 2 build jobs.");
  });
});
