#!/usr/bin/env node
// Roku ECP MCP server. Zero dependencies (Node 18+: fetch, AbortSignal.timeout, dgram).
// Transport: MCP stdio (newline-delimited JSON-RPC). Opens no listening socket.
//
// Config (env):
//   ROKU_IP          Roku address (required unless discovery finds one)
//   ROKU_PORT        default 8060
//   ROKU_TIMEOUT_MS  per-request timeout, default 4000
//   ROKU_SERIAL      optional; lets SSDP rediscovery find this Roku if DHCP moves it

import dgram from "node:dgram";
import { createInterface } from "node:readline";

const SERVER_INFO = { name: "roku", version: "1.0.0" };
const PORT = Number(process.env.ROKU_PORT || 8060);
const TIMEOUT_MS = Number(process.env.ROKU_TIMEOUT_MS || 4000);
const SERIAL = (process.env.ROKU_SERIAL || "").trim();
let rokuIp = (process.env.ROKU_IP || "").trim();

const log = (...a) => console.error("[roku-mcp]", ...a); // stdout is the protocol channel

// ---------- safety: only talk to private LAN addresses ----------
function isPrivateIPv4(ip) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
}

class RokuError extends Error {
  constructor(message, kind) { super(message); this.kind = kind; }
}

// ---------- ECP HTTP ----------
async function ecp(method, path, { ip = rokuIp, timeoutMs = TIMEOUT_MS } = {}) {
  if (!ip) throw new RokuError("No Roku IP configured. Set ROKU_IP or run roku_discover.", "config");
  if (!isPrivateIPv4(ip)) throw new RokuError(`Refusing to contact ${ip}: not a private LAN address.`, "config");
  const url = `http://${ip}:${PORT}${path}`;
  let res;
  try {
    res = await fetch(url, { method, signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    const code = e?.cause?.code || e?.name || "";
    if (code === "TimeoutError" || code === "AbortError" || code === "UND_ERR_CONNECT_TIMEOUT")
      throw new RokuError(`Timed out after ${timeoutMs} ms reaching ${ip}:${PORT}. The Roku may be off, asleep, on a different IP, or isolated from this computer by the Wi-Fi network.`, "timeout");
    if (code === "ECONNREFUSED")
      throw new RokuError(`${ip}:${PORT} refused the connection. Something answered at that IP but ECP is not listening; check it is still the Roku and that "Control by mobile apps" is enabled.`, "refused");
    if (code === "EHOSTUNREACH" || code === "ENETUNREACH")
      throw new RokuError(`${ip} is unreachable from this computer (${code}). Check this PC is on the same network as the Roku.`, "unreachable");
    throw new RokuError(`Network error reaching ${ip}:${PORT}: ${code || e.message}`, "network");
  }
  const body = await res.text().catch(() => "");
  if (res.status === 403)
    throw new RokuError(`Roku refused ${method} ${path} (HTTP 403). ECP is limited or disabled: on the Roku, Settings > System > Advanced system settings > Control by mobile apps > Network access = Default or Permissive.`, "forbidden");
  if (res.status === 404)
    throw new RokuError(`Roku does not support ${method} ${path} (HTTP 404).`, "unsupported");
  if (res.status >= 400)
    throw new RokuError(`Roku returned HTTP ${res.status} for ${method} ${path}.`, "http");
  return { status: res.status, body };
}

// Tiny XML helpers (ECP responses are flat and simple).
const xmlUnescape = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
function xmlFlat(xml) {
  const out = {};
  for (const m of xml.matchAll(/<([a-zA-Z0-9-]+)>([^<]*)<\/\1>/g)) out[m[1]] = xmlUnescape(m[2].trim());
  return out;
}
function xmlAttrs(s) {
  const out = {};
  for (const m of s.matchAll(/([a-zA-Z0-9-]+)="([^"]*)"/g)) out[m[1]] = xmlUnescape(m[2]);
  return out;
}

// ---------- discovery (SSDP, LAN only) ----------
function ssdpDiscover(waitMs = 3000) {
  return new Promise((resolve) => {
    const found = new Map();
    const sock = dgram.createSocket({ type: "udp4", reuseAddr: true });
    const msg = Buffer.from("M-SEARCH * HTTP/1.1\r\nHost: 239.255.255.250:1900\r\nMan: \"ssdp:discover\"\r\nST: roku:ecp\r\nMX: 2\r\n\r\n");
    sock.on("message", (buf) => {
      const loc = /LOCATION:\s*http:\/\/([\d.]+):(\d+)/i.exec(buf.toString());
      const usn = /USN:\s*uuid:roku:ecp:(\S+)/i.exec(buf.toString());
      if (loc) found.set(loc[1], { ip: loc[1], port: Number(loc[2]), serial: usn ? usn[1] : null });
    });
    sock.on("error", (e) => { log("ssdp error", e.message); try { sock.close(); } catch {} resolve([...found.values()]); });
    sock.bind(() => {
      try { sock.send(msg, 1900, "239.255.255.250"); setTimeout(() => sock.send(msg, 1900, "239.255.255.250"), 500); } catch {}
    });
    setTimeout(() => { try { sock.close(); } catch {} resolve([...found.values()]); }, waitMs);
  });
}

// Run fn; if the Roku is unreachable and ROKU_SERIAL is set, try once to rediscover it.
async function withRediscovery(fn) {
  try {
    return await fn();
  } catch (e) {
    if (!(e instanceof RokuError) || !["timeout", "unreachable", "refused"].includes(e.kind) || !SERIAL) throw e;
    const hits = await ssdpDiscover(2500);
    const hit = hits.find((h) => h.serial && h.serial.toUpperCase() === SERIAL.toUpperCase());
    if (!hit || hit.ip === rokuIp) {
      e.message += hits.length
        ? ` SSDP found ${hits.length} Roku(s) but none with serial ${SERIAL}.`
        : " SSDP discovery found no Roku either, which points to the network (client isolation or a different Wi-Fi) or the Roku being off, rather than a changed IP.";
      throw e;
    }
    log(`Roku moved: ${rokuIp} -> ${hit.ip}`);
    rokuIp = hit.ip;
    return await fn();
  }
}

// ---------- device queries ----------
async function deviceInfo() {
  const { body } = await ecp("GET", "/query/device-info");
  return xmlFlat(body);
}

let appsCache = { at: 0, apps: [] };
async function listApps({ fresh = false } = {}) {
  if (!fresh && Date.now() - appsCache.at < 60_000 && appsCache.apps.length) return appsCache.apps;
  const { body } = await ecp("GET", "/query/apps");
  const apps = [...body.matchAll(/<app\s+([^>]*)>([^<]*)<\/app>/g)].map((m) => {
    const a = xmlAttrs(m[1]);
    return { id: a.id, type: a.type, version: a.version, name: xmlUnescape(m[2].trim()) };
  });
  appsCache = { at: Date.now(), apps };
  return apps;
}

async function activeApp() {
  const { body } = await ecp("GET", "/query/active-app");
  const m = /<app(?:\s+([^>]*))?>([^<]*)<\/app>/.exec(body);
  if (!m) return { name: "unknown" };
  const a = xmlAttrs(m[1] || "");
  const screensaver = /<screensaver[^>]*>([^<]*)<\/screensaver>/.exec(body);
  return { id: a.id || null, name: xmlUnescape(m[2].trim()), screensaver: screensaver ? xmlUnescape(screensaver[1]) : null };
}

// "Disney+" -> "disneyplus", "YouTube TV" -> "youtubetv"
const norm = (s) => s.toLowerCase().replace(/\+/g, "plus").replace(/&/g, "and").replace(/[^a-z0-9]/g, "");
const ALIASES = { disney: "disneyplus", prime: "primevideo", amazon: "primevideo", amazonprime: "primevideo", hbo: "max", hbomax: "max", roku: "therokuchannel", rokuchannel: "therokuchannel", peacock: "peacocktv", spotify: "spotifymusic", yt: "youtube" };

function resolveApp(apps, query) {
  const q = String(query).trim();
  if (/^\d+$/.test(q)) {
    const byId = apps.find((a) => a.id === q);
    if (byId) return { app: byId };
  }
  const nq = ALIASES[norm(q)] || norm(q);
  const exact = apps.find((a) => norm(a.name) === nq);
  if (exact) return { app: exact };
  const starts = apps.filter((a) => norm(a.name).startsWith(nq));
  if (starts.length === 1) return { app: starts[0] };
  const contains = apps.filter((a) => norm(a.name).includes(nq));
  if (contains.length === 1) return { app: contains[0] };
  const candidates = (starts.length ? starts : contains).map((a) => a.name);
  return { candidates };
}

// ---------- keys ----------
const KEYS = ["Home", "Rev", "Fwd", "Play", "Select", "Left", "Right", "Down", "Up", "Back", "InstantReplay", "Info",
  "Backspace", "Search", "Enter", "FindRemote", "VolumeDown", "VolumeMute", "VolumeUp", "PowerOff", "PowerOn", "Power",
  "ChannelUp", "ChannelDown", "InputTuner", "InputHDMI1", "InputHDMI2", "InputHDMI3", "InputHDMI4", "InputAV1"];
const KEY_LOOKUP = Object.fromEntries(KEYS.map((k) => [k.toLowerCase(), k]));
Object.assign(KEY_LOOKUP, {
  ok: "Select", enter: "Enter", pause: "Play", playpause: "Play", "play/pause": "Play", rewind: "Rev", fastforward: "Fwd",
  ff: "Fwd", forward: "Fwd", replay: "InstantReplay", star: "Info", options: "Info", mute: "VolumeMute",
  volup: "VolumeUp", voldown: "VolumeDown", "volume_up": "VolumeUp", "volume_down": "VolumeDown",
});

function canonicalKey(k) {
  const s = String(k).trim();
  if (/^Lit_.+/.test(s)) return s;
  const c = KEY_LOOKUP[s.toLowerCase().replace(/[\s-]/g, "")] || KEY_LOOKUP[s.toLowerCase()];
  if (!c) throw new RokuError(`Unknown key "${s}". Valid keys: ${KEYS.join(", ")} (or Lit_<char>).`, "badkey");
  return c;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function keypress(key) {
  const k = canonicalKey(key);
  const path = k.startsWith("Lit_") ? `/keypress/Lit_${encodeURIComponent(k.slice(4))}` : `/keypress/${k}`;
  const { status } = await ecp("POST", path);
  return { key: k, status };
}

async function pressRepeated(key, times = 1, delayMs = 250) {
  const n = Math.max(1, Math.min(50, Math.floor(times)));
  const results = [];
  for (let i = 0; i < n; i++) {
    results.push(await keypress(key));
    if (i < n - 1) await sleep(delayMs);
  }
  return results;
}

async function typeText(text, delayMs = 120) {
  const chars = [...String(text)].slice(0, 200);
  for (const ch of chars) { await keypress(`Lit_${ch}`); await sleep(delayMs); }
  return chars.length;
}

async function launchApp(query, { contentId, mediaType } = {}) {
  let apps = await listApps();
  let r = resolveApp(apps, query);
  if (!r.app) { apps = await listApps({ fresh: true }); r = resolveApp(apps, query); }
  if (!r.app) {
    throw new RokuError(r.candidates?.length
      ? `"${query}" matches more than one app: ${r.candidates.join(", ")}. Be more specific.`
      : `No installed app matches "${query}". Installed: ${apps.map((a) => a.name).join(", ")}.`, "noapp");
  }
  const params = new URLSearchParams();
  if (contentId) params.set("contentId", contentId);
  if (mediaType) params.set("mediaType", mediaType);
  const qs = params.toString() ? `?${params}` : "";
  await ecp("POST", `/launch/${encodeURIComponent(r.app.id)}${qs}`);
  // Confirm: poll active-app for up to ~6s.
  let now = null;
  for (let i = 0; i < 12; i++) {
    await sleep(500);
    try { now = await activeApp(); } catch { continue; }
    if (now.id === r.app.id) break;
  }
  return { app: r.app, confirmed: now?.id === r.app.id, activeNow: now };
}

// ---------- tool definitions ----------
const ok = (text, data) => ({ content: [{ type: "text", text: data === undefined ? text : `${text}\n${JSON.stringify(data, null, 2)}` }] });
const fail = (text) => ({ content: [{ type: "text", text }], isError: true });

const NOTE_STICK = "This Roku is a streaming player, not a Roku TV: power and volume reach the TV only through HDMI-CEC, and the Roku cannot confirm the TV obeyed.";

async function describePowerVolumeLimits() {
  try {
    const d = await deviceInfo();
    return d["is-tv"] === "true" ? "" : ` ${NOTE_STICK}`;
  } catch { return ""; }
}

const tools = [
  {
    name: "roku_device_info",
    description: "Get Roku device information: model, software version, network, power mode, the app on screen, and what the device supports. Set full=true for every raw field.",
    inputSchema: { type: "object", properties: { full: { type: "boolean", description: "Return every raw device-info field" } } },
    run: async ({ full }) => {
      const d = await deviceInfo();
      let current = null;
      try { current = await activeApp(); } catch {}
      if (full) return ok("Roku device-info (raw):", { ...d, "active-app": current });
      const pick = ["user-device-name", "user-device-location", "friendly-model-name", "model-name", "model-number", "is-tv", "is-stick",
        "software-version", "network-type", "network-name", "power-mode", "supports-suspend", "ecp-setting-mode", "ui-resolution", "time-zone-name"];
      const summary = Object.fromEntries(pick.filter((k) => k in d).map((k) => [k, d[k]]));
      summary["ip"] = rokuIp;
      summary["active-app"] = current?.name ?? "unknown";
      return ok("Roku device info:", summary);
    },
  },
  {
    name: "roku_list_apps",
    description: "List the apps (channels) installed on the Roku, with their IDs, read live from the device.",
    inputSchema: { type: "object", properties: {} },
    run: async () => {
      const apps = await listApps({ fresh: true });
      return ok(`${apps.length} installed apps:`, apps.map((a) => ({ name: a.name, id: a.id, type: a.type })));
    },
  },
  {
    name: "roku_launch_app",
    description: "Launch an installed app by name (e.g. Netflix, YouTube, Hulu, Disney+) or by ID. The ID is looked up live from the Roku. Optional contentId/mediaType deep-link into the app if it supports it. Confirms the app came to the front.",
    inputSchema: {
      type: "object",
      properties: {
        app: { type: "string", description: "App name (fuzzy: 'disney+', 'prime', 'youtube tv') or numeric app ID" },
        contentId: { type: "string", description: "Optional deep-link content ID" },
        mediaType: { type: "string", description: "Optional deep-link media type (movie, episode, series, live, ...)" },
      },
      required: ["app"],
    },
    run: async ({ app, contentId, mediaType }) => {
      const r = await launchApp(app, { contentId, mediaType });
      return r.confirmed
        ? ok(`Launched ${r.app.name} (id ${r.app.id}); it is now the active app.`)
        : ok(`Sent launch for ${r.app.name} (id ${r.app.id}), but after 6 s the active app is still "${r.activeNow?.name ?? "unknown"}". It may still be loading, or need a profile picked.`);
    },
  },
  {
    name: "roku_power",
    description: "Turn the TV/Roku on or off (PowerOn, PowerOff, or Power toggle). Support varies by model; on streaming sticks this relies on HDMI-CEC.",
    inputSchema: { type: "object", properties: { action: { type: "string", enum: ["on", "off", "toggle"] } }, required: ["action"] },
    run: async ({ action }) => {
      const key = { on: "PowerOn", off: "PowerOff", toggle: "Power" }[action];
      if (!key) return fail(`action must be on, off or toggle`);
      await keypress(key);
      await sleep(1500);
      let mode = "unknown";
      try { mode = (await deviceInfo())["power-mode"] || "unknown"; } catch { mode = "unreachable (may be powering down)"; }
      return ok(`Roku accepted ${key}. Roku power-mode now: ${mode}.${await describePowerVolumeLimits()}`);
    },
  },
  {
    name: "roku_volume",
    description: "Volume up, down, or mute. 'steps' repeats up/down (1-50). Support varies by model; streaming sticks pass volume to the TV via HDMI-CEC.",
    inputSchema: {
      type: "object",
      properties: { action: { type: "string", enum: ["up", "down", "mute"] }, steps: { type: "integer", minimum: 1, maximum: 50, default: 1 } },
      required: ["action"],
    },
    run: async ({ action, steps = 1 }) => {
      const key = { up: "VolumeUp", down: "VolumeDown", mute: "VolumeMute" }[action];
      if (!key) return fail("action must be up, down or mute");
      const r = await pressRepeated(key, action === "mute" ? 1 : steps, 200);
      return ok(`Roku accepted ${key} x${r.length}.${await describePowerVolumeLimits()}`);
    },
  },
  {
    name: "roku_playback",
    description: "Playback control: play_pause (toggle), fast_forward, rewind, instant_replay. 'times' repeats fast_forward/rewind to change speed.",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["play_pause", "play", "pause", "fast_forward", "rewind", "instant_replay"] },
        times: { type: "integer", minimum: 1, maximum: 10, default: 1 },
      },
      required: ["action"],
    },
    run: async ({ action, times = 1 }) => {
      const key = { play_pause: "Play", play: "Play", pause: "Play", fast_forward: "Fwd", rewind: "Rev", instant_replay: "InstantReplay" }[action];
      if (!key) return fail("unknown playback action");
      const r = await pressRepeated(key, ["Fwd", "Rev"].includes(key) ? times : 1, 300);
      const note = action === "play" || action === "pause" ? " (Roku has one Play/Pause toggle key.)" : "";
      return ok(`Roku accepted ${key} x${r.length}.${note}`);
    },
  },
  {
    name: "roku_navigate",
    description: "Remote navigation: home, back, up, down, left, right, select (OK), info (*), search, backspace. 'times' repeats the press (1-50).",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["home", "back", "up", "down", "left", "right", "select", "info", "search", "backspace"] },
        times: { type: "integer", minimum: 1, maximum: 50, default: 1 },
      },
      required: ["action"],
    },
    run: async ({ action, times = 1 }) => {
      const key = canonicalKey(action);
      const watch = key === "Home" || key === "Back";
      let before = null;
      if (watch) { try { before = await activeApp(); } catch {} }
      const r = await pressRepeated(key, times, 250);
      let where = "";
      if (watch) {
        // Apps can take a few seconds to exit; poll until the screen changes (or Home is reached).
        let now = null;
        for (let i = 0; i < 10; i++) {
          await sleep(400);
          try { now = await activeApp(); } catch { continue; }
          if (now.id !== before?.id || (key === "Home" && now.name !== before?.name)) break;
          if (key === "Home" && /^(Roku|Roku Dynamic Menu)$/.test(now.name)) break;
        }
        if (now) where = ` Active app now: ${now.name}.`;
      }
      return ok(`Roku accepted ${key} x${r.length}.${where}`);
    },
  },
  {
    name: "roku_type_text",
    description: "Type text into the focused on-screen keyboard or search box (one character at a time, max 200).",
    inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
    run: async ({ text }) => ok(`Typed ${await typeText(text)} characters.`),
  },
  {
    name: "roku_send_commands",
    description: "Run several remote commands in order. Each step is one of: {key, times?} (any ECP key such as Home, Down, Select, Play, VolumeUp), {launch: app name or ID}, {text: string}, or {wait_ms}. Stops at the first failure and reports what ran.",
    inputSchema: {
      type: "object",
      properties: {
        steps: {
          type: "array",
          maxItems: 100,
          items: {
            type: "object",
            properties: {
              key: { type: "string" }, times: { type: "integer", minimum: 1, maximum: 50 },
              launch: { type: "string" }, text: { type: "string" }, wait_ms: { type: "integer", minimum: 0, maximum: 30000 },
            },
          },
        },
        delay_ms: { type: "integer", minimum: 0, maximum: 5000, default: 350, description: "Pause between steps" },
      },
      required: ["steps"],
    },
    run: async ({ steps, delay_ms = 350 }) => {
      if (!Array.isArray(steps) || !steps.length) return fail("steps must be a non-empty array");
      const done = [];
      for (const [i, s] of steps.slice(0, 100).entries()) {
        try {
          if (s.key) { const r = await pressRepeated(s.key, s.times || 1, 250); done.push(`${i + 1}. ${r[0].key} x${r.length}`); }
          else if (s.launch) { const r = await launchApp(s.launch); done.push(`${i + 1}. launch ${r.app.name}${r.confirmed ? "" : " (not confirmed active)"}`); }
          else if (s.text !== undefined) { const n = await typeText(s.text); done.push(`${i + 1}. typed ${n} chars`); }
          else if (s.wait_ms !== undefined) { await sleep(s.wait_ms); done.push(`${i + 1}. waited ${s.wait_ms} ms`); }
          else throw new RokuError(`step ${i + 1} has none of key, launch, text, wait_ms`, "badstep");
        } catch (e) {
          return fail(`Stopped at step ${i + 1}: ${e.message}\nCompleted:\n${done.join("\n") || "(none)"}`);
        }
        if (i < steps.length - 1) await sleep(delay_ms);
      }
      return ok(`All ${done.length} steps sent:\n${done.join("\n")}`);
    },
  },
  {
    name: "roku_status",
    description: "Check that the Roku is reachable and report what is on screen (active app, screensaver) and the response time.",
    inputSchema: { type: "object", properties: {} },
    run: async () => {
      const t0 = Date.now();
      const a = await activeApp();
      const ms = Date.now() - t0;
      return ok(`Roku at ${rokuIp}:${PORT} is reachable (${ms} ms). Active app: ${a.name}${a.id ? ` (id ${a.id})` : ""}${a.screensaver ? `; screensaver: ${a.screensaver}` : ""}.`);
    },
  },
  {
    name: "roku_discover",
    description: "Search the local network for Rokus with SSDP (useful if the Roku's IP changed). Set use_ip to switch this session to a found Roku.",
    inputSchema: { type: "object", properties: { use_ip: { type: "string", description: "Switch control to this discovered IP" } } },
    run: async ({ use_ip }) => {
      if (use_ip) {
        if (!isPrivateIPv4(use_ip)) return fail(`${use_ip} is not a private LAN address.`);
        const d = await deviceInfo().catch(() => null);
        const test = await ecp("GET", "/query/device-info", { ip: use_ip }).then((r) => xmlFlat(r.body)).catch((e) => { throw e; });
        rokuIp = use_ip; appsCache = { at: 0, apps: [] };
        return ok(`Now controlling ${test["friendly-model-name"] || "Roku"} at ${use_ip}${d ? "" : " (the previous address was not answering)"}. This lasts for this session; update ROKU_IP in the MCP config to make it permanent.`);
      }
      const hits = await ssdpDiscover(3000);
      if (!hits.length) return ok("No Roku answered SSDP discovery. Multicast may be blocked by the Wi-Fi (client isolation), or no Roku is on this network. A direct IP can still work when discovery does not.");
      return ok(`Found ${hits.length} Roku(s) (current target ${rokuIp || "none"}):`, hits);
    },
  },
];
const toolByName = Object.fromEntries(tools.map((t) => [t.name, t]));

// ---------- MCP stdio JSON-RPC ----------
const send = (msg) => process.stdout.write(JSON.stringify(msg) + "\n");
const reply = (id, result) => send({ jsonrpc: "2.0", id, result });
const replyErr = (id, code, message) => send({ jsonrpc: "2.0", id, error: { code, message } });

async function handle(msg) {
  const { id, method, params } = msg;
  const isRequest = id !== undefined && id !== null;
  switch (method) {
    case "initialize":
      return reply(id, {
        protocolVersion: params?.protocolVersion || "2025-06-18",
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: "Controls the user's Roku over the local network (ECP). Use roku_send_commands for multi-step remote sequences. App IDs are resolved live; use roku_list_apps to see what is installed.",
      });
    case "ping":
      return reply(id, {});
    case "tools/list":
      return reply(id, { tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
    case "tools/call": {
      const tool = toolByName[params?.name];
      if (!tool) return reply(id, fail(`Unknown tool ${params?.name}`));
      try {
        return reply(id, await withRediscovery(() => tool.run(params.arguments || {})));
      } catch (e) {
        log(tool.name, "failed:", e.message);
        return reply(id, fail(e instanceof RokuError ? e.message : `Unexpected error: ${e.message}`));
      }
    }
    default:
      if (method?.startsWith("notifications/")) return; // initialized, cancelled, etc.
      if (isRequest) return replyErr(id, -32601, `Method not found: ${method}`);
  }
}

const rl = createInterface({ input: process.stdin });
rl.on("line", (line) => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch { return replyErr(null, -32700, "Parse error"); }
  handle(msg).catch((e) => { log("handler crash", e); if (msg.id != null) replyErr(msg.id, -32603, e.message); });
});
rl.on("close", () => process.exit(0));
log(`ready; target ${rokuIp || "(none)"}:${PORT}`);
