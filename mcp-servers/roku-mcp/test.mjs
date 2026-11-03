// Smoke test: drives server.mjs over MCP stdio exactly as Claude Code does.
// Usage: node test.mjs [toolName jsonArgs]...   (default: status, Home, status)
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const srv = spawn(process.execPath, [path.join(here, "server.mjs")], { env: process.env, stdio: ["pipe", "pipe", "inherit"] });
let buf = "", nextId = 1;
const pending = new Map();
srv.stdout.on("data", (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    const msg = JSON.parse(line);
    pending.get(msg.id)?.(msg); pending.delete(msg.id);
  }
});
const rpc = (method, params) => new Promise((res) => { const id = nextId++; pending.set(id, res); srv.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n"); });

const argv = process.argv.slice(2);
const calls = argv.length
  ? Array.from({ length: argv.length / 2 }, (_, k) => [argv[2 * k], JSON.parse(argv[2 * k + 1])])
  : [["roku_status", {}], ["roku_navigate", { action: "home" }], ["roku_status", {}]];

const init = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } });
console.log("initialize ->", init.result.serverInfo, init.result.protocolVersion);
srv.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
const list = await rpc("tools/list", {});
console.log("tools ->", list.result.tools.map((t) => t.name).join(", "));
let failed = 0;
for (const [name, args] of calls) {
  const r = await rpc("tools/call", { name, arguments: args });
  const res = r.result;
  if (res?.isError) failed++;
  console.log(`\n${name} ${JSON.stringify(args)} ${res?.isError ? "ERROR" : "ok"}\n${res?.content?.[0]?.text ?? JSON.stringify(r.error)}`);
}
srv.stdin.end();
process.exit(failed ? 1 : 0);
