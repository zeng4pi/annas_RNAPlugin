#!/usr/bin/env node
// One-shot MCP handshake test. Spawns server.js, performs initialize +
// tools/list, asserts both tools show up, then exits. No network.

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const child = spawn(process.execPath, [path.join(here, "server.js")], {
  stdio: ["pipe", "pipe", "inherit"],
  env: { ...process.env, ANNAS_ARCHIVE_API_KEY: "" },
});

let buf = "";
const pending = new Map();
let nextId = 1;

child.stdout.on("data", (chunk) => {
  buf += chunk.toString("utf8");
  let idx;
  while ((idx = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  }
});

function send(method, params) {
  const id = nextId++;
  const payload = { jsonrpc: "2.0", id, method, params: params || {} };
  child.stdin.write(JSON.stringify(payload) + "\n");
  return new Promise((resolve, reject) => {
    pending.set(id, resolve);
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`timeout waiting for ${method}`));
      }
    }, 5000);
  });
}

function notify(method, params) {
  const payload = { jsonrpc: "2.0", method, params: params || {} };
  child.stdin.write(JSON.stringify(payload) + "\n");
}

try {
  const init = await send("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "handshake-test", version: "0" },
  });
  if (!init.result || !init.result.serverInfo) throw new Error(`initialize: ${JSON.stringify(init)}`);
  if (init.result.serverInfo.name !== "annas-archive") {
    throw new Error(`serverInfo.name = ${init.result.serverInfo.name}`);
  }

  notify("notifications/initialized");

  const tl = await send("tools/list");
  if (!tl.result || !Array.isArray(tl.result.tools)) throw new Error(`tools/list: ${JSON.stringify(tl)}`);
  const names = tl.result.tools.map((t) => t.name).sort();
  if (JSON.stringify(names) !== JSON.stringify(["download_book", "search_books"])) {
    throw new Error(`unexpected tools: ${names.join(",")}`);
  }

  // Sanity: calling download_book without the env var should return an error,
  // NOT crash the process.
  const dl = await send("tools/call", { name: "download_book", arguments: { md5: "0".repeat(32) } });
  if (!dl.result || !dl.result.isError) {
    throw new Error(`expected download_book to surface a tool error: ${JSON.stringify(dl)}`);
  }

  console.log(`OK — handshake passed (tools: ${names.join(", ")}).`);
  child.kill("SIGTERM");
  process.exit(0);
} catch (err) {
  console.error("FAIL:", err && err.message || err);
  child.kill("SIGTERM");
  process.exit(1);
}
