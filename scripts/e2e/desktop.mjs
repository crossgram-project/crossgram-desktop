#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import { connect } from "node:net";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    host: { type: "string", default: "127.0.0.1" },
    port: { type: "string" },
    token: { type: "string" },
    command: { type: "string", default: "ping" },
    selector: { type: "string" },
    action: { type: "string" },
    text: { type: "string" },
    "include-values": { type: "boolean", default: false },
    timeout: { type: "string", default: "5000" },
  },
});

const port = Number(values.port ?? process.env.CROSSGRAM_E2E_PORT);
const token = values.token ?? process.env.CROSSGRAM_E2E_TOKEN;
const timeout = Number(values.timeout);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("Pass --port or set CROSSGRAM_E2E_PORT to a TCP port");
}
if (!token) {
  throw new Error("Pass --token or set CROSSGRAM_E2E_TOKEN");
}
if (!Number.isFinite(timeout) || timeout < 1) {
  throw new Error("--timeout must be a positive number of milliseconds");
}

const request = {
  id: randomBytes(8).toString("hex"),
  token,
  command: values.command,
};
if (values.selector) request.selector = JSON.parse(values.selector);
if (values.action) request.action = values.action;
if (values.text !== undefined) request.text = values.text;
if (values["include-values"]) request.includeValues = true;

const response = await new Promise((resolve, reject) => {
  const socket = connect({ host: values.host, port });
  let buffer = "";
  const timer = setTimeout(() => {
    socket.destroy();
    reject(new Error(`E2E request timed out after ${timeout} ms`));
  }, timeout);
  socket.setEncoding("utf8");
  socket.once("connect", () => socket.write(`${JSON.stringify(request)}\n`));
  socket.on("data", (chunk) => {
    buffer += chunk;
    const newline = buffer.indexOf("\n");
    if (newline < 0) return;
    clearTimeout(timer);
    socket.end();
    try {
      resolve(JSON.parse(buffer.slice(0, newline)));
    } catch (error) {
      reject(error);
    }
  });
  socket.once("error", (error) => {
    clearTimeout(timer);
    reject(error);
  });
});

console.log(JSON.stringify(response, null, 2));
if (!response.ok) process.exitCode = 1;
