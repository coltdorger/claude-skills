'use strict';
// Run: node skills/valence-security-audit/scripts/tests/validate-findings.test.cjs

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { checkFindings, run, MAX_BYTES, MAX_PRINTED } = require('../validate-findings.cjs');

let n = 0;
const passes = (records, msg) => {
  const errs = checkFindings(records);
  assert.deepStrictEqual(errs, [], msg + '\n  ' + errs.join('\n  '));
  n++;
};
const fails = (records, pattern, msg) => {
  const errs = checkFindings(records);
  assert.ok(errs.some((m) => pattern.test(m)), msg + '\n  expected ' + pattern + '\n  got ' + JSON.stringify(errs));
  n++;
};
const eq = (a, b, msg) => { assert.strictEqual(a, b, msg); n++; };
const ok = (v, msg) => { assert.ok(v, msg); n++; };

// Fixtures: placeholder objects only, no real client, person or finding.
const trace = [
  { kind: 'entrypoint', object_type: 'portal_page', object: 'Example Portal Record Detail',
    description: 'A signed-in applicant opens the detail page with a record Id in the address.' },
  { kind: 'propagation', object_type: 'widget', object: 'Example Record Detail Widget', location: 'parameter map',
    description: 'The widget passes only the record Id to the procedure.' },
  { kind: 'sink', object_type: 'procedure', object: 'dbo.Example_RecordDetail_Get', location: 'definition line 14',
    description: 'The WHERE clause filters on the record Id alone.' },
];
const evidence = [
  { kind: 'snapshot', ref: 'snapshot/modules/dbo.Example_RecordDetail_Get.sql', environment: 'snapshot',
    observed: 'WHERE filters on @RecordId only; no join to the signed-in person.' },
  { kind: 'select', ref: 'sys.sql_modules for dbo.Example_RecordDetail_Get', environment: 'stage',
    observed: 'LEN 2140 and CHECKSUM -1876543210 match the manifest, so STAGE runs the snapshot definition.' },
];
const confirmed = {
  verdict: 'confirmed',
  fingerprint: 'V2/dbo.Example_RecordDetail_Get/detail-not-bound-to-user',
  title: 'Portal detail procedure does not bind the record to the signed-in applicant',
  description: 'The detail page returns any record whose Id is supplied.',
  attack_class: 'V2',
  trace,
  evidence: evidence.concat([{ kind: 'click_list', ref: 'NEEDS-VALIDATION click-list 1, steps 1-4', environment: 'stage',
    observed: 'Run by a person with the client-provided dummy accounts A and B: A saw the header of B\'s record, row Id 40213.' }]),
  root_cause: 'The procedure trusts the record Id from the page and never compares it with the signed-in person.',
  intended_behavior: 'An applicant sees only records linked to them through an active relationship.',
  boundary: {
    lower_trust_principal: 'Signed-in applicant A',
    action: 'Opens the detail page with the record Id of another applicant',
    intended_control: 'The detail read is bound to the signed-in person',
    crossed_boundary: 'Applicant to applicant',
    affected_resource: 'Another applicant\'s record detail',
  },
  observed_result: 'Dummy applicant A was shown dummy applicant B\'s record header on STAGE.',
  remediation: {
    strategy: 'Bind the read to the signed-in person in the procedure, the last trusted decision point.',
    config_changes: [{ object: 'dbo.Example_RecordDetail_Get', change: 'Join to the active relationship for the signed-in person; return no row otherwise.' }],
  },
  severity: {
    likelihood: { level: 'medium', reason: 'Needs a valid applicant account and another record Id.' },
    impact: { level: 'high', reason: 'Another applicant\'s record is disclosed.' },
    overall_severity: 'high',
  },
  confidence: { score: 0.9, reason: 'Definition and a person-run click-list agree.' },
};
const rejected = {
  verdict: 'rejected',
  fingerprint: 'V4/dbo.Example_Search/sort-column',
  title: 'Search sort column reaches dynamic SQL',
  description: 'The sort column from the grid is placed in a dynamic ORDER BY.',
  attack_class: 'V4',
  trace: [{ kind: 'sink', object_type: 'procedure', object: 'dbo.Example_Search', location: 'definition lines 20-31',
    description: 'Dynamic ORDER BY built from @SortColumn.' }],
  evidence: [{ kind: 'snapshot', ref: 'snapshot/modules/dbo.Example_Search.sql', environment: 'snapshot',
    observed: 'The column name is checked against a fixed list and wrapped in QUOTENAME before use.' }],
  claimed_root_cause: 'An unparameterised sort column reaches sp_executesql.',
  reason: 'The value is limited to a fixed list of column names and quoted, so no other text reaches the statement.',
};
const needsValidation = {
  verdict: 'needs_validation',
  fingerprint: 'V7/dbo.Example_Notice_Queue/queues-around-gate',
  title: 'Notice procedure queues mail without reading the gate setting',
  description: 'The procedure inserts into the mail queue directly.',
  attack_class: 'V7',
  trace: [
    { kind: 'entrypoint', object_type: 'workflow', object: 'Example Renewal Workflow', location: '$.activities[7]',
      description: 'The workflow step calls the notice procedure.' },
    { kind: 'sink', object_type: 'procedure', object: 'dbo.Example_Notice_Queue', location: 'definition line 40',
      description: 'Inserts a queue row with no reference to the gate setting.' },
  ],
  evidence: [{ kind: 'atlas', ref: 'atlas note for dbo.Example_Notice_Queue', environment: 'snapshot',
    observed: 'Callers: one workflow step; no read of the mail gate settings row.' }],
  claimed_root_cause: 'Queued mail may bypass the per-environment gate.',
  blockers: ['Whether the platform mail sender re-checks the gate for queued rows is not in the snapshot.'],
  validation_plan: { owner_question: 'Does the mail sender read the gate setting before sending a queued row?' },
};
const valid = [confirmed, rejected, needsValidation];
const fresh = () => JSON.parse(JSON.stringify(valid));
const with0 = (edit) => { const r = fresh(); edit(r[0]); return r; };   // edit the confirmed record
const with1 = (edit) => { const r = fresh(); edit(r[1]); return r; };   // edit the rejected record
const with2 = (edit) => { const r = fresh(); edit(r[2]); return r; };   // edit the needs_validation record

// Valid inputs.
passes(valid, 'one valid record of each verdict');
passes([], 'a clean run with zero records is valid');
passes(with0((r) => { delete r.remediation.config_changes; delete r.trace[1].location; }), 'optional fields may be left out');
passes(with2((r) => { r.validation_plan = { stage_select: 'SELECT the gate settings row by its stable key.', click_list: '1. Sign in as staff. 2. Open the queue grid.' }; }), 'any plan field satisfies the plan');

// Top level, verdict and common fields.
fails({ records: valid }, /^\$: findings\.json must be a JSON array/, 'top level must be an array');
fails(['x'], /^\$\[0\]: must be an object/, 'each record is an object');
fails(with0((r) => { r.verdict = 'probable'; }), /^\$\[0\]\.verdict: must be one of/, 'unknown verdict');
fails(with0((r) => { delete r.title; }), /^\$\[0\]: missing title/, 'missing required field');
fails(with0((r) => { r.description = '   '; }), /^\$\[0\]\.description: must be a non-empty string/, 'blank text');
fails(with0((r) => { r.fingerprint = 'V2 detail leak'; }), /^\$\[0\]\.fingerprint: must match/, 'fingerprint pattern');
fails(with0((r) => { r.fingerprint = '-V2/x'; }), /^\$\[0\]\.fingerprint: must match/, 'fingerprint first character');
fails(with0((r) => { r.attack_class = 'V13'; }), /^\$\[0\]\.attack_class: must be one of/, 'attack class enum');
fails(with0((r) => { r.notes = 'x'; }), /^\$\[0\]\.notes: unexpected field/, 'additionalProperties false on a record');

// Fingerprints unique and sorted.
fails(with1((r) => { r.fingerprint = confirmed.fingerprint; }), /^\$\[1\]\.fingerprint: duplicate of \$\[0\]/, 'duplicate fingerprint');
fails([rejected, confirmed, needsValidation], /^\$\[1\]\.fingerprint: records must be sorted/, 'unsorted fingerprints');
fails(with0((r) => { r.fingerprint = 'v2/lowercase-sorts-after-uppercase'; }), /records must be sorted/, 'sort is ordinal, not case-insensitive');

// Trace.
fails(with0((r) => { r.trace = []; }), /^\$\[0\]\.trace: must be a non-empty array/, 'empty trace');
fails(with0((r) => { r.trace = [r.trace[2], r.trace[1], r.trace[0]]; }), /^\$\[0\]\.trace\[0\]\.kind: expected entrypoint/, 'trace order');
fails(with0((r) => { r.trace[1].kind = 'sink'; }), /^\$\[0\]\.trace\[1\]\.kind: expected propagation/, 'middle step is propagation');
fails(with1((r) => { r.trace[0].kind = 'propagation'; }), /^\$\[1\]\.trace\[0\]\.kind: a one-step trace/, 'one-step trace kind');
fails(with0((r) => { r.trace[0].object_type = 'webpage'; }), /^\$\[0\]\.trace\[0\]\.object_type: must be one of/, 'object type enum');
fails(with0((r) => { r.trace[0].line = 3; }), /^\$\[0\]\.trace\[0\]\.line: unexpected field/, 'trace step has no extra fields');
fails(with0((r) => { delete r.trace[2].object; }), /^\$\[0\]\.trace\[2\]: missing object/, 'trace step names its object');

// Evidence.
fails(with0((r) => { r.evidence = []; }), /^\$\[0\]\.evidence: must be a non-empty array/, 'empty evidence');
fails(with0((r) => { r.evidence[0].kind = 'exec'; }), /^\$\[0\]\.evidence\[0\]\.kind: must be one of/, 'evidence kind enum');
fails(with0((r) => { r.evidence[1].environment = 'uat'; }), /^\$\[0\]\.evidence\[1\]\.environment: must be one of/, 'environment enum');
fails(with0((r) => { delete r.evidence[0].observed; }), /^\$\[0\]\.evidence\[0\]: missing observed/, 'evidence says what was observed');

// Confirmed contract.
fails(with0((r) => { delete r.boundary.intended_control; }), /^\$\[0\]\.boundary: missing intended_control/, 'boundary has all five parts');
fails(with0((r) => { r.observed_result = ''; }), /^\$\[0\]\.observed_result: must be a non-empty string/, 'observed result required');
fails(with0((r) => { r.remediation.config_changes = [{ object: 'dbo.Example_RecordDetail_Get' }]; }), /config_changes\[0\]: missing change/, 'config change says what changes');
fails(with0((r) => { r.severity.overall_severity = 'critical'; }), /^\$\[0\]\.severity\.overall_severity: critical is above the demonstrated impact high/, 'overall above impact');
fails(with0((r) => { r.severity.impact.level = 'severe'; }), /^\$\[0\]\.severity\.impact\.level: must be one of/, 'impact level enum');
fails(with0((r) => { delete r.severity.likelihood.reason; }), /^\$\[0\]\.severity\.likelihood: missing reason/, 'likelihood has a reason');
fails(with0((r) => { r.confidence.score = 1.5; }), /^\$\[0\]\.confidence\.score: must be a number from 0 to 1/, 'confidence above 1');
fails(with0((r) => { r.confidence.score = 'high'; }), /^\$\[0\]\.confidence\.score: must be a number from 0 to 1/, 'confidence is a number');

// Cross-verdict fields are forbidden.
fails(with2((r) => { r.severity = confirmed.severity; }), /^\$\[2\]\.severity: belongs to confirmed records, not needs_validation/, 'no severity on needs_validation');
fails(with1((r) => { r.blockers = ['x']; }), /^\$\[1\]\.blockers: belongs to needs_validation records, not rejected/, 'no blockers on rejected');
fails(with1((r) => { r.remediation = confirmed.remediation; }), /^\$\[1\]\.remediation: belongs to confirmed records, not rejected/, 'no remediation on rejected');
fails(with0((r) => { r.claimed_root_cause = 'x'; }), /^\$\[0\]\.claimed_root_cause: belongs to needs_validation and rejected records, not confirmed/, 'no claimed root cause on confirmed');
fails(with2((r) => { r.reason = 'x'; }), /^\$\[2\]\.reason: belongs to rejected records, not needs_validation/, 'no reason on needs_validation');

// needs_validation and rejected contracts.
fails(with2((r) => { r.blockers = []; }), /^\$\[2\]\.blockers: must be a non-empty array/, 'blockers not empty');
fails(with2((r) => { r.blockers = ['']; }), /^\$\[2\]\.blockers\[0\]: must be a non-empty string/, 'blocker text');
fails(with2((r) => { r.validation_plan = {}; }), /^\$\[2\]\.validation_plan: needs at least one of/, 'plan needs one field');
fails(with2((r) => { r.validation_plan = { owner_question: '' }; }), /^\$\[2\]\.validation_plan: needs at least one of/, 'an empty plan field does not count');
fails(with2((r) => { r.validation_plan.exec_probe = 'EXEC it'; }), /^\$\[2\]\.validation_plan\.exec_probe: unexpected field/, 'plan has fixed fields');
fails(with1((r) => { delete r.reason; }), /^\$\[1\]: missing reason/, 'rejected says why');

// Personal-data heuristic: the evidence cites Ids, never values, and the message never echoes the value.
const email = 'someone@example.com';
fails(with0((r) => { r.evidence[0].observed = 'Recipient column held ' + email; }), /^\$\[0\]\.evidence\[0\]\.observed: looks like an email address/, 'email address');
fails(with0((r) => { r.description = 'Applicant 000-12-3456 was shown'; }), /^\$\[0\]\.description: looks like a US social security number/, 'SSN pattern');
fails(with0((r) => { r.observed_result = 'Phone (212) 555-0147 was displayed'; }), /^\$\[0\]\.observed_result: looks like a phone number/, 'phone with brackets');
fails(with2((r) => { r.blockers = ['Call 212-555-0147 to confirm']; }), /^\$\[2\]\.blockers\[0\]: looks like a phone number/, 'phone with dashes');
fails(with0((r) => { r.remediation.config_changes[0].change = 'Send to +1 212.555.0147 instead'; }), /config_changes\[0\]\.change: looks like a phone number/, 'phone with dots and country code');
ok(!checkFindings(with0((r) => { r.evidence[0].observed = 'Recipient column held ' + email; })).join('\n').includes(email), 'the message does not echo the value');
passes(with0((r) => { r.evidence[1].observed = 'CHECKSUM 2034567891 and -1876543210, row Ids 1000000001 and 40213'; }), 'bare ten-digit CHECKSUM values and Ids are not phone numbers');
passes(with0((r) => { r.evidence[1].observed = 'Modified 2026-11-09 by @ModifiedBy; parameter @ApplicantId; rows 101 to 202'; }), 'dates and parameter names are not personal data');

// The CLI: exit 0 clean, 1 violations, 2 could not run, and a 2 never reads as a 0.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'validate-findings-test-'));
try {
  const lines = [];
  const io = { log: (m) => lines.push(m), error: (m) => lines.push(m) };
  const file = (name, content) => { const p = path.join(dir, name); fs.writeFileSync(p, content); return p; };
  eq(run([file('ok.json', JSON.stringify(valid))], io), 0, 'valid file exits 0');
  ok(/PASS, 3 record\(s\): 1 confirmed, 1 needs_validation, 1 rejected/.test(lines.pop()), 'PASS line counts verdicts');
  eq(run([file('bad.json', JSON.stringify(with0((r) => { r.attack_class = 'V99'; })))], io), 1, 'violations exit 1');
  eq(run([path.join(dir, 'missing.json')], io), 2, 'missing file exits 2');
  ok(/COULD NOT RUN: cannot read/.test(lines.pop()), 'missing file says it could not run');
  eq(run([file('broken.json', '[{"verdict": "confirmed", "title": "' + email + '"')], io), 2, 'invalid JSON exits 2');
  ok(!lines.pop().includes(email), 'a JSON error does not quote file content');
  eq(run([dir], io), 2, 'a directory exits 2');
  eq(run([], io), 2, 'no argument exits 2');
  eq(run(['a.json', 'b.json'], io), 2, 'two arguments exit 2');
  eq(run([file('big.json', '[' + ' '.repeat(MAX_BYTES) + ']')], io), 2, 'a file over 5 MiB exits 2');
  eq(run([file('bom8.json', '﻿' + JSON.stringify(valid))], io), 0, 'UTF-8 with a BOM is read');
  eq(run([file('bom16.json', Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(JSON.stringify(valid), 'utf16le')]))], io), 0, 'UTF-16 LE with a BOM is read');
  const many = Array.from({ length: 150 }, (_, i) => ({ verdict: 'rejected', fingerprint: 'V1/x' + String(i).padStart(3, '0') }));
  lines.length = 0;
  eq(run([file('many.json', JSON.stringify(many))], io), 1, 'many violations exit 1');
  eq(lines.filter((m) => m.startsWith('  $')).length, MAX_PRINTED, 'at most 100 messages are printed');
  ok(/more not shown$/.test(lines[lines.length - 1]), 'the rest are counted, not dropped silently');
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('validate-findings: ' + n + ' assertions passed');
