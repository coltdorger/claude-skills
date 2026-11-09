#!/usr/bin/env node
'use strict';
// Checks a security-audit findings.json against references/findings-schema.md.
// Run: node validate-findings.cjs <findings.json>
// Exit 0: valid. Exit 1: violations (up to 100 printed, each with its JSON path). Exit 2: could not run.
// Zero dependencies. Reads with a plain stat and readFile, so it behaves the same on Windows and Linux.

const fs = require('fs');

const NAME = 'validate-findings';
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_PRINTED = 100;
const MAX_DEPTH = 64;

const FINGERPRINT = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]*$/;
const ATTACK_CLASSES = ['V1', 'V2', 'V3', 'V4', 'V5', 'V6', 'V7', 'V8', 'V9', 'V10', 'V11', 'V12', 'wildcard'];
const VERDICTS = ['confirmed', 'needs_validation', 'rejected'];
const COMMON = ['verdict', 'fingerprint', 'title', 'description', 'attack_class', 'trace', 'evidence'];
const BY_VERDICT = {
  confirmed: ['root_cause', 'intended_behavior', 'boundary', 'observed_result', 'remediation', 'severity', 'confidence'],
  needs_validation: ['claimed_root_cause', 'blockers', 'validation_plan'],
  rejected: ['claimed_root_cause', 'reason'],
};
const STEP_KINDS = ['entrypoint', 'propagation', 'sink'];
const OBJECT_TYPES = [
  'portal_page', 'page', 'tab', 'dashboard', 'widget', 'grid', 'form', 'dialog', 'launcher', 'procedure', 'function',
  'view', 'trigger', 'workflow', 'settings_row', 'lookup', 'role', 'permission', 'user_account', 'template',
  'mail_gate', 'table', 'other',
];
const EVIDENCE_KINDS = ['select', 'snapshot', 'atlas', 'click_list'];
const ENVIRONMENTS = ['stage', 'prod', 'snapshot'];
const LEVELS = ['informational', 'low', 'medium', 'high', 'critical']; // index is the rank
const BOUNDARY_FIELDS = ['lower_trust_principal', 'action', 'intended_control', 'crossed_boundary', 'affected_resource'];
const PLAN_FIELDS = ['stage_select', 'click_list', 'owner_question'];

// Evidence cites object names, row Ids and column names, never personal-data values. These patterns are a backstop.
// A bare run of ten digits is not flagged: CHECKSUM values and large row Ids look exactly like that.
const PERSONAL_DATA = [
  { re: /[A-Za-z0-9][A-Za-z0-9._%+-]*@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/, what: 'an email address' },
  { re: /(?<![\d-])\d{3}-\d{2}-\d{4}(?![\d-])/, what: 'a US social security number' },
  { re: /(?<![\d-])(?:\+?1[ .-]?)?(?:\([2-9]\d{2}\) ?|[2-9]\d{2}[ .-])[2-9]\d{2}[ .-]\d{4}(?![\d-])/, what: 'a phone number' },
];

class CouldNotRun extends Error {}

const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isText = (v) => typeof v === 'string' && v.trim() !== '';
const at = (path, k) => (/^[A-Za-z_][A-Za-z0-9_]*$/.test(k) ? path + '.' + k : path + '[' + JSON.stringify(k.slice(0, 60)) + ']');

function fields(o, path, required, optional, errs) {
  for (const f of required) if (!has(o, f)) errs.push(path + ': missing ' + f);
  for (const f of Object.keys(o)) {
    if (!required.includes(f) && !optional.includes(f)) errs.push(at(path, f) + ': unexpected field');
  }
}

function text(o, f, path, errs) {
  if (has(o, f) && !isText(o[f])) errs.push(at(path, f) + ': must be a non-empty string');
}

function oneOf(o, f, allowed, path, errs) {
  if (has(o, f) && !allowed.includes(o[f])) errs.push(at(path, f) + ': must be one of ' + allowed.join(', '));
}

function object(o, f, path, errs) {
  if (!has(o, f)) return null;
  if (!isObj(o[f])) { errs.push(at(path, f) + ': must be an object'); return null; }
  return o[f];
}

function textList(o, f, path, errs) {
  if (!has(o, f)) return;
  const v = o[f];
  if (!Array.isArray(v) || v.length === 0) { errs.push(at(path, f) + ': must be a non-empty array of strings'); return; }
  v.forEach((s, i) => { if (!isText(s)) errs.push(at(path, f) + '[' + i + ']: must be a non-empty string'); });
}

function checkTrace(trace, path, errs) {
  if (!Array.isArray(trace) || trace.length === 0) { errs.push(path + ': must be a non-empty array'); return; }
  const last = trace.length - 1;
  trace.forEach((s, i) => {
    const p = path + '[' + i + ']';
    if (!isObj(s)) { errs.push(p + ': must be an object'); return; }
    fields(s, p, ['kind', 'object_type', 'object', 'description'], ['location'], errs);
    oneOf(s, 'kind', STEP_KINDS, p, errs);
    oneOf(s, 'object_type', OBJECT_TYPES, p, errs);
    for (const f of ['object', 'location', 'description']) text(s, f, p, errs);
    if (!STEP_KINDS.includes(s.kind)) return;
    if (trace.length === 1) {
      if (s.kind === 'propagation') errs.push(p + '.kind: a one-step trace is an entrypoint or a sink');
    } else {
      const expected = i === 0 ? 'entrypoint' : i === last ? 'sink' : 'propagation';
      if (s.kind !== expected) errs.push(p + '.kind: expected ' + expected + ' (order: entrypoint, propagation..., sink)');
    }
  });
}

function checkEvidence(evidence, path, errs) {
  if (!Array.isArray(evidence) || evidence.length === 0) { errs.push(path + ': must be a non-empty array'); return; }
  evidence.forEach((e, i) => {
    const p = path + '[' + i + ']';
    if (!isObj(e)) { errs.push(p + ': must be an object'); return; }
    fields(e, p, ['kind', 'ref', 'observed', 'environment'], [], errs);
    oneOf(e, 'kind', EVIDENCE_KINDS, p, errs);
    oneOf(e, 'environment', ENVIRONMENTS, p, errs);
    text(e, 'ref', p, errs);
    text(e, 'observed', p, errs);
  });
}

function checkLevel(sev, f, path, errs) {
  const v = object(sev, f, path, errs);
  if (!v) return;
  const p = at(path, f);
  fields(v, p, ['level', 'reason'], [], errs);
  oneOf(v, 'level', LEVELS, p, errs);
  text(v, 'reason', p, errs);
}

function checkConfirmed(r, path, errs) {
  for (const f of ['root_cause', 'intended_behavior', 'observed_result']) text(r, f, path, errs);
  const b = object(r, 'boundary', path, errs);
  if (b) {
    fields(b, path + '.boundary', BOUNDARY_FIELDS, [], errs);
    for (const f of BOUNDARY_FIELDS) text(b, f, path + '.boundary', errs);
  }
  const rem = object(r, 'remediation', path, errs);
  if (rem) {
    const p = path + '.remediation';
    fields(rem, p, ['strategy'], ['config_changes'], errs);
    text(rem, 'strategy', p, errs);
    if (has(rem, 'config_changes')) {
      if (!Array.isArray(rem.config_changes)) errs.push(p + '.config_changes: must be an array');
      else rem.config_changes.forEach((c, i) => {
        const cp = p + '.config_changes[' + i + ']';
        if (!isObj(c)) { errs.push(cp + ': must be an object'); return; }
        fields(c, cp, ['object', 'change'], [], errs);
        text(c, 'object', cp, errs);
        text(c, 'change', cp, errs);
      });
    }
  }
  const sev = object(r, 'severity', path, errs);
  if (sev) {
    const p = path + '.severity';
    fields(sev, p, ['likelihood', 'impact', 'overall_severity'], [], errs);
    checkLevel(sev, 'likelihood', p, errs);
    checkLevel(sev, 'impact', p, errs);
    oneOf(sev, 'overall_severity', LEVELS, p, errs);
    const overall = LEVELS.indexOf(sev.overall_severity);
    const impact = isObj(sev.impact) ? LEVELS.indexOf(sev.impact.level) : -1;
    if (overall >= 0 && impact >= 0 && overall > impact) {
      errs.push(p + '.overall_severity: ' + sev.overall_severity + ' is above the demonstrated impact ' + sev.impact.level);
    }
  }
  const conf = object(r, 'confidence', path, errs);
  if (conf) {
    const p = path + '.confidence';
    fields(conf, p, ['score', 'reason'], [], errs);
    if (has(conf, 'score') && !(typeof conf.score === 'number' && conf.score >= 0 && conf.score <= 1)) {
      errs.push(p + '.score: must be a number from 0 to 1');
    }
    text(conf, 'reason', p, errs);
  }
}

function checkNeedsValidation(r, path, errs) {
  text(r, 'claimed_root_cause', path, errs);
  textList(r, 'blockers', path, errs);
  const plan = object(r, 'validation_plan', path, errs);
  if (plan) {
    const p = path + '.validation_plan';
    fields(plan, p, [], PLAN_FIELDS, errs);
    for (const f of PLAN_FIELDS) text(plan, f, p, errs);
    if (!PLAN_FIELDS.some((f) => isText(plan[f]))) errs.push(p + ': needs at least one of ' + PLAN_FIELDS.join(', '));
  }
}

function checkRecord(r, path, errs) {
  if (!isObj(r)) { errs.push(path + ': must be an object'); return; }
  const known = VERDICTS.includes(r.verdict);
  if (!known) errs.push(path + '.verdict: must be one of ' + VERDICTS.join(', '));
  const allowed = COMMON.concat(known ? BY_VERDICT[r.verdict] : []);
  for (const f of allowed) if (f !== 'verdict' && !has(r, f)) errs.push(path + ': missing ' + f);
  for (const f of Object.keys(r)) {
    if (allowed.includes(f)) continue;
    const owners = VERDICTS.filter((v) => BY_VERDICT[v].includes(f));
    if (owners.length === 0) errs.push(at(path, f) + ': unexpected field');
    else if (known) errs.push(at(path, f) + ': belongs to ' + owners.join(' and ') + ' records, not ' + r.verdict);
  }
  if (has(r, 'fingerprint') && !(typeof r.fingerprint === 'string' && FINGERPRINT.test(r.fingerprint))) {
    errs.push(path + '.fingerprint: must match ' + FINGERPRINT.source);
  }
  text(r, 'title', path, errs);
  text(r, 'description', path, errs);
  oneOf(r, 'attack_class', ATTACK_CLASSES, path, errs);
  if (has(r, 'trace')) checkTrace(r.trace, path + '.trace', errs);
  if (has(r, 'evidence')) checkEvidence(r.evidence, path + '.evidence', errs);
  if (r.verdict === 'confirmed') checkConfirmed(r, path, errs);
  if (r.verdict === 'needs_validation') checkNeedsValidation(r, path, errs);
  if (r.verdict === 'rejected') { text(r, 'claimed_root_cause', path, errs); text(r, 'reason', path, errs); }
}

// Never echoes the matched value: printing it would copy the personal data into the terminal and the session log.
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

function checkFindings(data) {
  if (!Array.isArray(data)) return ['$: findings.json must be a JSON array of records'];
  const errs = [];
  const seen = new Map();
  let prev = null;
  data.forEach((r, i) => {
    const p = '$[' + i + ']';
    checkRecord(r, p, errs);
    if (!isObj(r) || typeof r.fingerprint !== 'string') return;
    const fp = r.fingerprint;
    if (seen.has(fp)) errs.push(p + '.fingerprint: duplicate of $[' + seen.get(fp) + ']');
    else seen.set(fp, i);
    if (prev !== null && fp < prev) errs.push(p + '.fingerprint: records must be sorted by fingerprint (ordinal order)');
    prev = fp;
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
    // The parser's message can quote file content, which may hold personal data; keep only the position.
    const pos = /position (\d+)/.exec(String(e.message));
    throw new CouldNotRun(file + ' is not valid JSON' + (pos ? ' (near character ' + pos[1] + ')' : ''));
  }
}

function summary(data) {
  const counts = VERDICTS.map((v) => data.filter((r) => isObj(r) && r.verdict === v).length + ' ' + v);
  return data.length + ' record(s): ' + counts.join(', ');
}

function run(args, io) {
  const out = io || { log: console.log, error: console.error };
  if (!Array.isArray(args) || args.length !== 1) {
    out.error(NAME + ': COULD NOT RUN: usage: node validate-findings.cjs <findings.json>');
    return 2;
  }
  let data;
  let errs;
  try {
    data = readJson(args[0]);
    errs = checkFindings(data);
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

module.exports = { checkFindings, readJson, run, CouldNotRun, MAX_BYTES, MAX_PRINTED };

if (require.main === module) {
  let code = 2;
  try { code = run(process.argv.slice(2)); } catch (e) { console.error(NAME + ': COULD NOT RUN: ' + e.message); }
  process.exitCode = code === 0 || code === 1 ? code : 2; // anything unexpected is a 2, never a 0
}
