#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
// PreToolUse guard for the shell tools (Bash, PowerShell, terminal).
// Blocks (1) any command that names a production database together with a write verb, and
// (2) any call to a named procedure that must never run from an agent session (bulk mail, for example).
// Always exits 0; a block is a permissionDecision of deny, so a broken guard never wedges a session.
//
// Config (environment variables, read once at start):
//   PROD_GUARD_PATTERN        regex fragment that marks a production database name. Default: _Prod_
//   PROD_GUARD_EXEMPT         comma-separated production database names that may be written
//                             (an environment with no stage). A command is exempt only when every
//                             production name in it is on this list. Default: none.
//   PROD_GUARD_BLOCKED_PROCS  comma-separated procedure names blocked on every database. Default: QueueAllPending

const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const PROD_FRAGMENT = process.env.PROD_GUARD_PATTERN || '_Prod_';
const PROD_DB = new RegExp(PROD_FRAGMENT, 'i');
const PROD_NAMES = new RegExp('\\w*' + PROD_FRAGMENT + '\\w*', 'gi');
const EXEMPT_PROD = new Set((process.env.PROD_GUARD_EXEMPT || '')
  .split(',').map(s => s.trim().toLowerCase()).filter(Boolean));
const BLOCKED = (process.env.PROD_GUARD_BLOCKED_PROCS || 'QueueAllPending')
  .split(',').map(s => s.trim()).filter(Boolean);
const BLOCKED_PROC = BLOCKED.length ? new RegExp(BLOCKED.map(escapeRe).join('|'), 'i') : null;

function onlyExemptProd(command) {
  const names = command.match(PROD_NAMES) || [];
  return names.length > 0 && names.every(n => EXEMPT_PROD.has(n.toLowerCase()));
}

const WRITE_VERB = /\b(INSERT|UPDATE|DELETE|MERGE|ALTER|CREATE|DROP|TRUNCATE|GRANT|REVOKE|DENY)\b/i;
const SELECT_INTO = /\bINTO\s+(?!#)[\w\[]/i;
const WRITE_EXEC = /\bEXEC(?:UTE)?\s+[\w.\[\]]*(?:Apply|Create|Delete|Update|Repoint|Insert|Save|Send|Mail)\w*/i;
// Files a command executes (sqlcmd -i, Invoke-Sqlcmd -InputFile, powershell -File): their text is scanned too.
const FILE_ARG = /(?:^|\s)(?:-i|-InputFile|-File)\s+("[^"]+"|'[^']+'|[^\s;|&]+)/gi;

const PROD_MSG = 'prod-guard: writes to a production database are blocked in agent sessions; run it yourself or disable the hook in settings.json.';
const PROC_MSG = 'prod-guard: this procedure is blocked in agent sessions on every database; run it yourself if you mean it.';

function decide(command) {
  if (typeof command !== 'string' || command.length === 0) return null;
  if (BLOCKED_PROC && BLOCKED_PROC.test(command)) return PROC_MSG;
  if (PROD_DB.test(command) && !onlyExemptProd(command)
      && (WRITE_VERB.test(command) || WRITE_EXEC.test(command) || SELECT_INTO.test(command))) return PROD_MSG;
  return null;
}

function referencedText(command, cwd) {
  let text = '';
  for (const m of command.matchAll(FILE_ARG)) {
    const p = m[1].replace(/^["']|["']$/g, '');
    try {
      const full = path.isAbsolute(p) ? p : path.join(cwd || process.cwd(), p);
      const st = fs.statSync(full);
      if (st.isFile() && st.size <= 2 * 1024 * 1024) text += '\n' + fs.readFileSync(full, 'utf8');
    } catch (err) { /* not a readable file: nothing to add */ }
  }
  return text;
}

function main() {
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => { raw += chunk; });
  process.stdin.on('end', () => {
    let reason = null;
    try {
      const input = JSON.parse(raw || '{}');
      const cmd = input && input.tool_input ? input.tool_input.command : undefined;
      reason = decide(typeof cmd === 'string' ? cmd + referencedText(cmd, input.cwd) : cmd);
    } catch (err) {
      process.stdout.write(JSON.stringify({ systemMessage: 'prod-guard: could not read hook input (' + err.message + '); allowing.' }));
      return;
    }
    if (reason) {
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason },
        systemMessage: reason,
      }));
    }
  });
}

module.exports = { decide, referencedText };
if (require.main === module) main();
