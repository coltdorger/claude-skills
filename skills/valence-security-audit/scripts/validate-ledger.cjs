#!/usr/bin/env node
'use strict';
// Checks a security-audit coverage-ledger.json against references/findings-schema.md (coverage ledger section).
// Run: node validate-ledger.cjs <coverage-ledger.json>
// Exit 0: valid. Exit 1: violations (up to 100 printed, each with its JSON path). Exit 2: could not run.
// Zero dependencies and standalone, so it still runs when copied alone into a client folder.

const fs = require('fs');

const NAME = 'validate-ledger';
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_PRINTED = 100;
const MAX_DEPTH = 64;

const FINGERPRINT = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]*$/;
const AGENT_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const WINDOWS_DEVICE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/; // a folder with this name cannot be created on Windows
const ATTACK_CLASSES = ['V1', 'V2', 'V3', 'V4', 'V5', 'V6', 'V7', 'V8', 'V9', 'V10', 'V11', 'V12', 'wildcard'];
const STATUSES = ['planned', 'covered', 'candidate', 'blocked', 'deferred', 'out_of_scope', 'not_applicable'];
const OWNED = ['covered', 'candidate', 'blocked'];
const UNOWNED_WITH_REASON = ['deferred', 'out_of_scope', 'not_applicable'];
const METHODS = ['snapshot', 'select'];
const PRIOR_STATUSES = [
  'none', 'new', 'prior_confirmed_unchanged', 'prior_confirmed_changed', 'prior_needs_validation', 'prior_blocked',
  'prior_deferred', 'prior_out_of_scope', 'prior_covered_unchanged', 'prior_covered_changed', 'prior_rejected_changed',
];
const REQUIRED = ['coverage_id', 'surface', 'boundary', 'attack_class', 'status'];
const OPTIONAL = [
  'label', 'wave', 'prior_status', 'starting_objects', 'agent_id', 'checks', 'result_fingerprints', 'reason',
  'hardening', 'attempts',
];

const PERSONAL_DATA = [
  { re: /[A-Za-z0-9][A-Za-z0-9._%+-]*@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/, what: 'an email address' },
  { re: /(?<![\d-])\d{3}-\d{2}-\d{4}(?![\d-])/, what: 'a US social security number' },
  { re: /(?<![\d-])(?:\+?1[ .-]?)?(?:\([2-9]\d{2}\) ?|[2-9]\d{2}[ .-])[2-9]\d{2}[ .-]\d{4}(?![\d-])/, what: 'a phone number' },
];

class CouldNotRun extends Error {}

const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isText = (v) => typeof v === 'string' && v.trim() !== '';
const list = (v) => (Array.isArray(v) ? v : []);
const at = (path, k) => (/^[A-Za-z_][A-Za-z0-9_]*$/.test(k) ? path + '.' + k : path + '[' + JSON.stringify(k.slice(0, 60)) + ']');
const isAgentId = (v) => typeof v === 'string' && AGENT_ID.test(v) && !WINDOWS_DEVICE.test(v);

function fields(o, path, required, optional, errs) {
  for (const f of required) if (!has(o, f)) errs.push(path + ': missing ' + f);
  for (const f of Object.keys(o)) {
    if (!required.includes(f) && !optional.includes(f)) errs.push(at(path, f) + ': unexpected field');
  }
}

function text(o, f, path, errs) {
  if (has(o, f) && !isText(o[f])) errs.push(at(path, f) + ': must be a non-empty string');
}

function textArray(o, f, path, errs) {
  if (!has(o, f)) return;
  if (!Array.isArray(o[f])) { errs.push(at(path, f) + ': must be an array'); return; }
  o[f].forEach((s, i) => { if (!isText(s)) errs.push(at(path, f) + '[' + i + ']: must be a non-empty string'); });
}

function agent(o, path, errs, required) {
  const v = has(o, 'agent_id') ? o.agent_id : null;
  if (v === null) { if (required) errs.push(path + '.agent_id: required for status ' + o.status); return; }
  if (!isAgentId(v)) errs.push(path + '.agent_id: must match ' + AGENT_ID.source + ' and not be a Windows device name');
}

function checkChecks(o, path, errs) {
  if (!has(o, 'checks')) return;
  if (!Array.isArray(o.checks)) { errs.push(path + '.checks: must be an array'); return; }
  o.checks.forEach((c, i) => {
    const p = path + '.checks[' + i + ']';
    if (!isObj(c)) { errs.push(p + ': must be an object'); return; }
    fields(c, p, ['objects', 'invariant', 'method', 'result'], ['agent_id'], errs);
    if (has(c, 'objects') && (!Array.isArray(c.objects) || c.objects.length === 0)) {
      errs.push(p + '.objects: must name at least one object');
    } else textArray(c, 'objects', p, errs);
    text(c, 'invariant', p, errs);
    text(c, 'result', p, errs);
    if (has(c, 'method') && !METHODS.includes(c.method)) errs.push(p + '.method: must be one of ' + METHODS.join(', '));
    if (has(c, 'agent_id') && !isAgentId(c.agent_id)) errs.push(p + '.agent_id: must match ' + AGENT_ID.source);
  });
}

function checkFingerprints(o, path, errs) {
  if (!has(o, 'result_fingerprints')) return;
  if (!Array.isArray(o.result_fingerprints)) { errs.push(path + '.result_fingerprints: must be an array'); return; }
  const seen = new Set();
  o.result_fingerprints.forEach((f, i) => {
    const p = path + '.result_fingerprints[' + i + ']';
    if (typeof f !== 'string' || !FINGERPRINT.test(f)) errs.push(p + ': must match ' + FINGERPRINT.source);
    else if (seen.has(f)) errs.push(p + ': duplicate fingerprint');
    seen.add(f);
  });
}

// The state table: who may own a unit in each status, and what evidence it must or must not carry.
function checkState(u, path, errs) {
  const s = u.status;
  if (!STATUSES.includes(s)) return;
  const owner = has(u, 'agent_id') && u.agent_id !== null;
  const nChecks = list(u.checks).length;
  const nFps = list(u.result_fingerprints).length;
  const reason = has(u, 'reason') && u.reason !== null;
  if (s === 'planned') {
    if (owner) errs.push(path + '.agent_id: a planned unit has no owner yet');
    if (nChecks) errs.push(path + '.checks: a planned unit has no evidence yet');
    if (nFps) errs.push(path + '.result_fingerprints: a planned unit has no results yet');
  }
  if (OWNED.includes(s)) {
    agent(u, path, errs, true);
    if (!nChecks) errs.push(path + '.checks: status ' + s + ' needs at least one check');
  }
  if (s === 'candidate' && !nFps) errs.push(path + '.result_fingerprints: a candidate unit names its fingerprints');
  if ((s === 'covered' || s === 'blocked') && nFps) {
    errs.push(path + '.result_fingerprints: only a candidate unit carries fingerprints');
  }
  if (s === 'blocked' && !reason) errs.push(path + '.reason: a blocked unit says what blocked it');
  if (UNOWNED_WITH_REASON.includes(s)) {
    if (!reason) errs.push(path + '.reason: status ' + s + ' needs a reason');
    if (owner) errs.push(path + '.agent_id: status ' + s + ' has no owner');
    if (nChecks) errs.push(path + '.checks: status ' + s + ' carries no evidence; partial work is blocked, not ' + s);
    if (nFps) errs.push(path + '.result_fingerprints: status ' + s + ' carries no results');
  }
}

// A reopened unit keeps its earlier attempts; the next attempt must have a fresh owner.
function checkAttempts(u, path, errs) {
  if (!has(u, 'attempts')) return;
  if (!Array.isArray(u.attempts)) { errs.push(path + '.attempts: must be an array'); return; }
  const owners = new Set();
  u.attempts.forEach((a, i) => {
    const p = path + '.attempts[' + i + ']';
    if (!isObj(a)) { errs.push(p + ': must be an object'); return; }
    fields(a, p, ['status', 'agent_id', 'checks', 'reassignment_reason'], ['wave', 'result_fingerprints', 'reason'], errs);
    if (!OWNED.includes(a.status)) errs.push(p + '.status: an archived attempt is covered, candidate or blocked');
    agent(a, p, errs, true);
    checkChecks(a, p, errs);
    if (!list(a.checks).length) errs.push(p + '.checks: an archived attempt keeps its checks');
    checkFingerprints(a, p, errs);
    text(a, 'reassignment_reason', p, errs);
    if (has(a, 'reason') && a.reason !== null) text(a, 'reason', p, errs);
    if (typeof a.agent_id === 'string') {
      if (owners.has(a.agent_id)) errs.push(p + '.agent_id: each attempt has a fresh owner');
      owners.add(a.agent_id);
    }
  });
  if (typeof u.agent_id === 'string' && owners.has(u.agent_id)) {
    errs.push(path + '.agent_id: the current owner already owned an earlier attempt; reassign to a fresh agent');
  }
}

function checkUnit(u, path, errs) {
  if (!isObj(u)) { errs.push(path + ': must be an object'); return; }
  fields(u, path, REQUIRED, OPTIONAL, errs);
  for (const f of ['surface', 'boundary']) {
    if (!has(u, f)) continue;
    const v = u[f];
    if (!isText(v)) errs.push(path + '.' + f + ': must be a non-empty string');
    else if (v !== v.trim()) errs.push(path + '.' + f + ': must not start or end with whitespace');
    else if (v.includes('::')) errs.push(path + '.' + f + ': must not contain "::", which separates the coverage_id parts');
  }
  if (has(u, 'attack_class') && !ATTACK_CLASSES.includes(u.attack_class)) {
    errs.push(path + '.attack_class: must be one of ' + ATTACK_CLASSES.join(', '));
  }
  if (has(u, 'coverage_id')) {
    if (typeof u.coverage_id !== 'string') errs.push(path + '.coverage_id: must be a string');
    else if ([u.surface, u.boundary, u.attack_class].every((v) => typeof v === 'string')) {
      const expected = u.surface + '::' + u.boundary + '::' + u.attack_class;
      if (u.coverage_id !== expected) errs.push(path + '.coverage_id: must be ' + JSON.stringify(expected));
    }
  }
  if (has(u, 'status') && !STATUSES.includes(u.status)) errs.push(path + '.status: must be one of ' + STATUSES.join(', '));
  if (has(u, 'wave') && !(Number.isInteger(u.wave) && u.wave >= 1)) errs.push(path + '.wave: must be a positive integer');
  if (has(u, 'prior_status') && !PRIOR_STATUSES.includes(u.prior_status)) {
    errs.push(path + '.prior_status: must be one of ' + PRIOR_STATUSES.join(', '));
  }
  text(u, 'label', path, errs);
  textArray(u, 'starting_objects', path, errs);
  textArray(u, 'hardening', path, errs);
  if (has(u, 'reason') && u.reason !== null) text(u, 'reason', path, errs);
  agent(u, path, errs, false);
  checkChecks(u, path, errs);
  checkFingerprints(u, path, errs);
  checkState(u, path, errs);
  checkAttempts(u, path, errs);
}

function scanPersonalData(value, path, errs, depth) {
  if (depth > MAX_DEPTH) { errs.push(path + ': nested deeper than ' + MAX_DEPTH + ' levels'); return; }
  if (typeof value === 'string') {
    for (const { re, what } of PERSONAL_DATA) {
      if (re.test(value)) errs.push(path + ': looks like ' + what + '; cite the object, row Id and column, not the value');
    }
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => scanPersonalData(v, path + '[' + i + ']', errs, depth + 1));
  } else if (isObj(value)) {
    for (const k of Object.keys(value)) scanPersonalData(value[k], at(path, k), errs, depth + 1);
  }
}

function checkLedger(data) {
  if (!Array.isArray(data)) return ['$: coverage-ledger.json must be a JSON array of units'];
  const errs = [];
  const seen = new Map();
  let prev = null;
  data.forEach((u, i) => {
    const p = '$[' + i + ']';
    checkUnit(u, p, errs);
    if (!isObj(u) || typeof u.coverage_id !== 'string') return;
    const id = u.coverage_id;
    if (seen.has(id)) errs.push(p + '.coverage_id: duplicate of $[' + seen.get(id) + ']');
    else seen.set(id, i);
    if (prev !== null && id < prev) errs.push(p + '.coverage_id: units must be sorted by coverage_id (ordinal order)');
    prev = id;
  });
  scanPersonalData(data, '$', errs, 0);
  return errs;
}

// Plain stat then readFile: no O_NOFOLLOW or O_NONBLOCK, which Windows does not offer.
// Accepts UTF-8 with or without a BOM and UTF-16 LE with a BOM, because PowerShell 5.1 writes both.
function readJson(file) {
  if (typeof file !== 'string' || file === '') throw new CouldNotRun('no input file given');
  let st;
  try { st = fs.statSync(file); } catch (e) { throw new CouldNotRun('cannot read ' + file + ' (' + (e.code || 'error') + ')'); }
  if (!st.isFile()) throw new CouldNotRun(file + ' is not a regular file');
  if (st.size > MAX_BYTES) throw new CouldNotRun(file + ' is ' + st.size + ' bytes; the limit is ' + MAX_BYTES);
  let buf;
  try { buf = fs.readFileSync(file); } catch (e) { throw new CouldNotRun('cannot read ' + file + ' (' + (e.code || 'error') + ')'); }
  if (buf.length > MAX_BYTES) throw new CouldNotRun(file + ' grew past ' + MAX_BYTES + ' bytes while being read');
  let str;
  if (buf[0] === 0xff && buf[1] === 0xfe) str = buf.toString('utf16le', 2);
  else if (buf[0] === 0xfe && buf[1] === 0xff) throw new CouldNotRun(file + ' is UTF-16 big-endian; save it as UTF-8');
  else str = buf.toString('utf8', buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf ? 3 : 0);
  try { return JSON.parse(str); } catch (e) {
    const pos = /position (\d+)/.exec(String(e.message));
    throw new CouldNotRun(file + ' is not valid JSON' + (pos ? ' (near character ' + pos[1] + ')' : ''));
  }
}

function summary(data) {
  const counts = STATUSES.map((s) => [s, data.filter((u) => isObj(u) && u.status === s).length]).filter(([, n]) => n > 0);
  return data.length + ' unit(s)' + (counts.length ? ': ' + counts.map(([s, n]) => n + ' ' + s).join(', ') : '');
}

function run(args, io) {
  const out = io || { log: console.log, error: console.error };
  if (!Array.isArray(args) || args.length !== 1) {
    out.error(NAME + ': COULD NOT RUN: usage: node validate-ledger.cjs <coverage-ledger.json>');
    return 2;
  }
  let data;
  let errs;
  try {
    data = readJson(args[0]);
    errs = checkLedger(data);
  } catch (e) {
    out.error(NAME + ': COULD NOT RUN: ' + (e instanceof CouldNotRun ? e.message : 'internal error: ' + e.message));
    return 2;
  }
  if (errs.length === 0) { out.log(NAME + ': PASS, ' + summary(data)); return 0; }
  out.error(NAME + ': FAIL, ' + errs.length + ' violation(s)');
  errs.slice(0, MAX_PRINTED).forEach((m) => out.error('  ' + m));
  if (errs.length > MAX_PRINTED) out.error('  ... ' + (errs.length - MAX_PRINTED) + ' more not shown');
  return 1;
}

module.exports = { checkLedger, readJson, run, CouldNotRun, MAX_BYTES, MAX_PRINTED };

if (require.main === module) {
  let code = 2;
  try { code = run(process.argv.slice(2)); } catch (e) { console.error(NAME + ': COULD NOT RUN: ' + e.message); }
  process.exitCode = code === 0 || code === 1 ? code : 2; // anything unexpected is a 2, never a 0
}
