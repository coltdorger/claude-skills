#!/usr/bin/env node
'use strict';
// Wires prod-guard.js (PreToolUse) and session-check.js (SessionStart) into ~/.claude/settings.json.
// Idempotent: earlier entries for these hooks are replaced, and settings.json is backed up first.
// Usage: node install-hooks.js <backup-stamp>
const fs = require('fs');
const path = require('path');
const os = require('os');

const home = os.homedir();
const settingsPath = path.join(home, '.claude', 'settings.json');
const backupDir = path.join(home, '.claude', 'backups');
const guardPath = path.join(__dirname, 'prod-guard.js');
const checkPath = path.join(__dirname, 'session-check.js');

for (const p of [guardPath, checkPath]) {
  if (!fs.existsSync(p)) { console.error('missing hook script: ' + p); process.exit(1); }
}

fs.mkdirSync(backupDir, { recursive: true });
const stamp = process.argv[2] || 'manual';
const backupPath = path.join(backupDir, 'settings.json.' + stamp + '-hooks.bak');
if (fs.existsSync(backupPath)) { console.error('backup exists, pass a new stamp: ' + backupPath); process.exit(1); }
if (fs.existsSync(settingsPath)) fs.copyFileSync(settingsPath, backupPath);

const settings = fs.existsSync(settingsPath) ? JSON.parse(fs.readFileSync(settingsPath, 'utf8')) : {};
settings.hooks = settings.hooks || {};

const isOurs = (entry, marker) => (entry.hooks || []).some(h => (h.args || []).join(' ').includes(marker));

settings.hooks.PreToolUse = (settings.hooks.PreToolUse || []).filter(e => !isOurs(e, 'prod-guard'));
settings.hooks.PreToolUse.push({
  matcher: 'Bash|PowerShell|Monitor|mcp__terminal__run_in_terminal',
  hooks: [{ type: 'command', command: 'node', args: [guardPath], timeout: 10, statusMessage: 'prod-guard' }],
});

settings.hooks.SessionStart = (settings.hooks.SessionStart || []).filter(e => !isOurs(e, 'session-check'));
settings.hooks.SessionStart.push({
  hooks: [{ type: 'command', command: 'node', args: [checkPath], timeout: 30, statusMessage: 'VPN check' }],
});

fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
console.log('hooks written to ' + settingsPath + '; backup in ' + backupDir);
