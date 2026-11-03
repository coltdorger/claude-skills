#!/usr/bin/env node
'use strict';
// SessionStart hook: in a client folder that needs the VPN, run the tunnel check and print one line,
// then self-test the prod guard so a broken or unwired guard is visible before any work starts. Never blocks.
//
// Config (environment variables):
//   GUARD_FOLDER_PATTERN  regex that marks a folder needing the check. Default: CLIENT-
//   VPN_CHECK_SCRIPT      PowerShell script that prints {"State": "Up|Degraded|Down"}. Optional.

const { spawnSync } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

const FOLDER = new RegExp(process.env.GUARD_FOLDER_PATTERN || 'CLIENT-', 'i');

function needsCheck(cwd) {
  return typeof cwd === 'string' && FOLDER.test(cwd);
}

function stateLine(state) {
  const s = state || 'Unknown';
  return s === 'Up' ? 'VPN tunnel: Up' : 'VPN tunnel: ' + s + ', re-dial before any stage work';
}

function readState() {
  const script = process.env.VPN_CHECK_SCRIPT;
  if (!script) return 'Unknown';
  const r = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-Check'],
    { encoding: 'utf8', timeout: 20000 });
  const m = /"State":\s*"(\w+)"/.exec(r.stdout || '');
  return m ? m[1] : 'Unknown';
}

function guardLine() {
  try {
    const { decide } = require(path.join(__dirname, 'prod-guard.js'));
    if (!decide('sqlcmd -d X_' + 'Prod_Y -Q "UPDATE t SET a=1"')) return 'prod guard: NOT blocking (self-test failed)';
    const settings = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude', 'settings.json'), 'utf8'));
    const wired = ((settings.hooks || {}).PreToolUse || [])
      .some(e => (e.hooks || []).some(h => (h.args || []).join(' ').includes('prod-guard')));
    return wired ? 'prod guard: armed' : 'prod guard: NOT wired in settings.json';
  } catch (err) {
    return 'prod guard: BROKEN (' + String(err && err.message).split(/\r?\n/)[0] + ')';
  }
}

function main() {
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => { raw += chunk; });
  process.stdin.on('end', () => {
    let cwd = process.cwd();
    try { const input = JSON.parse(raw || '{}'); if (input && input.cwd) cwd = input.cwd; } catch (err) { /* keep process.cwd() */ }
    if (!needsCheck(cwd)) return;
    let line;
    try { line = stateLine(readState()); } catch (err) { line = 'VPN tunnel: check failed (' + err.message + ')'; }
    line += '; ' + guardLine();
    process.stdout.write(JSON.stringify({
      systemMessage: line,
      hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: line },
    }));
  });
}

module.exports = { needsCheck, stateLine, guardLine };
if (require.main === module) main();
