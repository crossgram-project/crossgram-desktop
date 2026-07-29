import { execFile } from "node:child_process";
import { createServer } from "node:net";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const driver = path.join(repositoryRoot, "scripts/e2e/desktop.mjs");
const servers: ReturnType<typeof createServer>[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => {
    server.close(() => resolve());
  })));
});

async function serve(response: object): Promise<{
  port: number;
  request: Promise<Record<string, unknown>>;
}> {
  let resolveRequest!: (value: Record<string, unknown>) => void;
  const request = new Promise<Record<string, unknown>>((resolve) => {
    resolveRequest = resolve;
  });
  const server = createServer((socket) => {
    socket.setEncoding("utf8");
    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk;
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      resolveRequest(JSON.parse(buffer.slice(0, newline)) as Record<string, unknown>);
      socket.end(`${JSON.stringify(response)}\n`);
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("missing TCP address");
  return { port: address.port, request };
}

describe("desktop semantic E2E driver", () => {
  it("sends a complete JSON-lines semantic action and prints the response", async () => {
    const token = "e2e-token-that-is-at-least-thirty-two-characters";
    const fixture = await serve({ id: "server-id", ok: true, result: { action: "press" } });
    const execution = execFileAsync(process.execPath, [
      driver,
      "--port", String(fixture.port),
      "--token", token,
      "--command", "action",
      "--selector", '{"name":"Next","role":"button"}',
      "--action", "press",
    ]);
    const received = await fixture.request;
    const { stdout } = await execution;

    expect(received).toMatchObject({
      token,
      command: "action",
      selector: { name: "Next", role: "button" },
      action: "press",
    });
    expect(received.id).toMatch(/^[0-9a-f]{16}$/);
    expect(JSON.parse(stdout)).toEqual({ id: "server-id", ok: true, result: { action: "press" } });
  });

  it("returns a failing process status for endpoint errors", async () => {
    const fixture = await serve({ id: "error-id", ok: false, error: "unauthorized" });
    await expect(execFileAsync(process.execPath, [
      driver,
      "--port", String(fixture.port),
      "--token", "wrong-token",
    ])).rejects.toMatchObject({ code: 1 });
    expect(await fixture.request).toMatchObject({ command: "ping", token: "wrong-token" });
  });
});
