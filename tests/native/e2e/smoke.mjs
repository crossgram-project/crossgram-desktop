#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer, connect } from "node:net";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: { binary: { type: "string" } },
});
if (!values.binary) throw new Error("Pass --binary <crossgram_e2e_native_harness>");

const port = await new Promise((resolve, reject) => {
  const reservation = createServer();
  reservation.once("error", reject);
  reservation.listen(0, "127.0.0.1", () => {
    const address = reservation.address();
    if (!address || typeof address === "string") {
      reject(new Error("Could not reserve a TCP port"));
      return;
    }
    reservation.close((error) => error ? reject(error) : resolve(address.port));
  });
});
const token = randomBytes(32).toString("hex");
const child = spawn(values.binary, [], {
  env: {
    ...process.env,
    QT_QPA_PLATFORM: "offscreen",
    CROSSGRAM_E2E_PORT: String(port),
    CROSSGRAM_E2E_TOKEN: token,
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let stderr = "";
child.stderr.setEncoding("utf8");
child.stderr.on("data", (chunk) => { stderr += chunk; });

let sequence = 0;
function request(command) {
  const id = `native-${++sequence}`;
  return new Promise((resolve, reject) => {
    const socket = connect({ host: "127.0.0.1", port });
    let buffer = "";
    socket.setEncoding("utf8");
    socket.once("connect", () => socket.write(`${JSON.stringify({ id, token, ...command })}\n`));
    socket.on("data", (chunk) => {
      buffer += chunk;
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      socket.end();
      try {
        const response = JSON.parse(buffer.slice(0, newline));
        if (response.id !== id) throw new Error("E2E response id mismatch");
        if (!response.ok) throw new Error(response.error);
        resolve(response.result);
      } catch (error) {
        reject(error);
      }
    });
    socket.once("error", reject);
  });
}

async function waitUntilReady() {
  let lastError;
  for (let attempt = 0; attempt !== 50; ++attempt) {
    try {
      return await request({ command: "ping" });
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw lastError;
}

function flatten(node, result = []) {
  result.push(node);
  for (const childNode of node.children ?? []) flatten(childNode, result);
  return result;
}

try {
  const ping = await waitUntilReady();
  if (ping.protocol !== 1) throw new Error(`Unexpected protocol ${ping.protocol}`);
  const initial = flatten(await request({ command: "snapshot", includeValues: true }));
  if (!initial.some((node) => node.name === "Message" && node.role === "textbox")) {
    throw new Error("Message textbox is missing from the semantic tree");
  }
  const button = initial.find((node) => node.name === "Send" && node.role === "button");
  if (!button?.actions?.includes("press")) {
    throw new Error("Send button does not expose the press semantic action");
  }
  await request({
    command: "setText",
    selector: { name: "Message", role: "textbox" },
    text: "semantic e2e",
  });
  await request({
    command: "action",
    selector: { name: "Send", role: "button" },
    action: "press",
  });
  await new Promise((resolve) => setTimeout(resolve, 150));
  const final = flatten(await request({ command: "snapshot", includeValues: true }));
  if (!final.some((node) => node.name === "sent:semantic e2e")) {
    throw new Error("Semantic action did not update the Qt application state");
  }
  console.log(JSON.stringify({ ok: true, protocol: ping.protocol, nodes: final.length }));
} finally {
  child.kill();
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 2000)),
  ]);
  if (child.exitCode && child.exitCode !== 0) {
    throw new Error(`Native harness exited with ${child.exitCode}: ${stderr}`);
  }
}
