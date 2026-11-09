'use strict';
// Run: node skills/valence-security-audit/scripts/tests/validate-ledger.test.cjs

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { checkLedger, run } = require('../validate-ledger.cjs');

let n = 0;
const passes = (ledger, msg) => {
  const errs = checkLedger(ledger);
  assert.deepStrictEqual(errs, [], msg + '\n  ' + errs.join('\n  '));
  n++;
};
const fails = (ledger, pattern, msg) => {
  const errs = checkLedger(ledger);
  assert.ok(errs.some((m) => pattern.test(m)), msg + '\n  expected ' + pattern + '\n  got ' + JSON.stringify(errs));
  n++;
};
const eq = (a, b, msg) => { assert.strictEqual(a, b, msg); n++; };
const ok = (v, msg) => { assert.ok(v, msg); n++; };

// Fixtures: placeholder objects only. Canonical refs are object names or stable keys, never identity Ids.
const check = (objects, result) => ({ objects, invariant: 'The read is bound to the signed-in person', method: 'snapshot', result });
const unit = (surface, boundary, attackClass, state) => Object.assign({
  coverage_id: surface + '::' + boundary + '::' + attackClass, surface, boundary, attack_class: attackClass, wave: 1,
}, state);
const byId = (a, b) => (a.coverage_id < b.coverage_id ? -1 : a.coverage_id > b.coverage_id ? 1 : 0);
const valid = [
  unit('portal_page:Example Portal Record Detail', 'procedure:dbo.Example_RecordDetail_Get', 'V2', {
    status: 'candidate', agent_id: 'hunter-w1-01', prior_status: 'none',
    checks: [check(['dbo.Example_RecordDetail_Get', 'Example Record Detail Widget'], 'WHERE filters on the record Id alone')],
    result_fingerprints: ['V2/dbo.Example_RecordDetail_Get/detail-not-bound-to-user'],
  }),
  unit('portal_page:Example Portal Record Detail', 'procedure:dbo.Example_RecordDetail_Get', 'V4', {
    status: 'covered', agent_id: 'hunter-w1-01', starting_objects: ['dbo.Example_RecordDetail_Get'],
    checks: [{ objects: ['dbo.Example_RecordDetail_Get'], invariant: 'No parameter reaches EXEC or sp_executesql', method: 'select',
      result: 'sys.sql_modules definition has no dynamic SQL; LEN and CHECKSUM match the manifest' }],
    hardening: ['The procedure has no header comment naming its callers.'],
  }),
  unit('portal_page:Example Portal Record Detail', 'procedure:dbo.Example_RecordDetail_Get', 'V6', {
    status: 'not_applicable', reason: 'The page renders no template and offers no export.',
  }),
  unit('portal_page:Example Portal Upload', 'procedure:dbo.Example_Upload_Save', 'V2', {
    status: 'blocked', agent_id: 'hunter-w1-02', reason: 'The save path runs through a platform service the snapshot does not show.',
    checks: [check(['dbo.Example_Upload_Save'], 'The procedure takes a person Id parameter; who supplies it is not visible')],
  }),
  unit('tier:staff', 'role:Example Reviewer', 'V3', { status: 'planned', prior_status: 'prior_deferred', label: 'Reviewer role grants' }),
  unit('workflow:Example Legacy Renewal', 'workflow:Example Legacy Renewal', 'wildcard', {
    status: 'deferred', wave: 2, reason: 'Accepted by the final critic in a quick run; no second wave in quick.',
    attempts: [{ status: 'covered', agent_id: 'hunter-w1-03', wave: 1, reassignment_reason: 'The embedded copy was not read.',
      checks: [check(['Example Legacy Renewal'], 'Standalone row read; launch buttons point at it')] }],
  }),
  unit('mail_gate:outbound', 'settings_row:mail gate', 'V12', { status: 'out_of_scope', reason: 'The client did not allow PROD reads for this run.' }),
].sort(byId);
const fresh = () => JSON.parse(JSON.stringify(valid));
const find = (ledger, status) => ledger.find((u) => u.status === status);
const edit = (status, change) => { const l = fresh(); change(find(l, status)); return l; };
const idx = (status) => valid.findIndex((u) => u.status === status);
const P = (status) => '^\\$\\[' + idx(status) + '\\]';

// Valid inputs.
passes(valid, 'one valid unit of each status');
passes([], 'an empty ledger is valid (nothing seeded yet)');
passes(edit('planned', (u) => { u.agent_id = null; u.checks = []; u.result_fingerprints = []; u.reason = null; }), 'explicit nulls and empty arrays on a planned unit');
passes(edit('candidate', (u) => { u.reason = 'One variant still open in a sibling dialog.'; u.attempts = [{ status: 'blocked', agent_id: 'hunter-w0-09', reason: 'Tunnel dropped mid-check.', reassignment_reason: 'Rerun after the tunnel came back.', checks: [check(['dbo.Example_RecordDetail_Get'], 'Partial read')] }]; }), 'a candidate after a reassignment with a fresh owner');

// Shape, sort, duplicates and the coverage_id rule.
fails({ units: valid }, /^\$: coverage-ledger\.json must be a JSON array/, 'top level must be an array');
fails([valid[1], valid[0]].concat(valid.slice(2)), /^\$\[1\]\.coverage_id: units must be sorted/, 'unsorted units');
fails([valid[0], valid[0]].concat(valid.slice(1)), /^\$\[1\]\.coverage_id: duplicate of \$\[0\]/, 'duplicate coverage_id');
fails(edit('covered', (u) => { u.coverage_id = u.coverage_id.replace('::V4', '::V5'); }), /coverage_id: must be "portal_page:Example Portal Record Detail::procedure:dbo\.Example_RecordDetail_Get::V4"/, 'coverage_id is built from the fields');
fails(edit('planned', (u) => { u.surface = 'tier::staff'; u.coverage_id = u.surface + '::' + u.boundary + '::' + u.attack_class; }), new RegExp(P('planned') + '\\.surface: must not contain "::"'), 'separator inside a part');
fails(edit('planned', (u) => { u.boundary = ' role:Example Reviewer'; }), new RegExp(P('planned') + '\\.boundary: must not start or end with whitespace'), 'canonical refs are trimmed');
fails(edit('planned', (u) => { u.attack_class = 'V0'; }), new RegExp(P('planned') + '\\.attack_class: must be one of'), 'attack class enum');
fails(edit('planned', (u) => { u.status = 'in_review'; }), new RegExp(P('planned') + '\\.status: must be one of'), 'status enum');
fails(edit('planned', (u) => { delete u.status; }), new RegExp(P('planned') + ': missing status'), 'status required');
fails(edit('planned', (u) => { u.agentId = 'hunter-w1-09'; }), new RegExp(P('planned') + '\\.agentId: unexpected field'), 'unknown unit field');
fails(edit('planned', (u) => { u.wave = 0; }), new RegExp(P('planned') + '\\.wave: must be a positive integer'), 'wave');
fails(edit('planned', (u) => { u.prior_status = 'prior_fine'; }), new RegExp(P('planned') + '\\.prior_status: must be one of'), 'prior status enum');

// State rules.
fails(edit('planned', (u) => { u.agent_id = 'hunter-w1-04'; }), new RegExp(P('planned') + '\\.agent_id: a planned unit has no owner'), 'planned has no owner');
fails(edit('planned', (u) => { u.checks = [check(['x'], 'y')]; }), new RegExp(P('planned') + '\\.checks: a planned unit has no evidence'), 'planned has no evidence');
fails(edit('covered', (u) => { delete u.agent_id; }), new RegExp(P('covered') + '\\.agent_id: required for status covered'), 'covered needs an owner');
fails(edit('covered', (u) => { u.checks = []; }), new RegExp(P('covered') + '\\.checks: status covered needs at least one check'), 'covered needs checks');
fails(edit('blocked', (u) => { delete u.checks; }), new RegExp(P('blocked') + '\\.checks: status blocked needs at least one check'), 'blocked needs checks');
fails(edit('blocked', (u) => { delete u.reason; }), new RegExp(P('blocked') + '\\.reason: a blocked unit says what blocked it'), 'blocked needs a reason');
fails(edit('candidate', (u) => { u.result_fingerprints = []; }), new RegExp(P('candidate') + '\\.result_fingerprints: a candidate unit names its fingerprints'), 'candidate needs fingerprints');
fails(edit('candidate', (u) => { u.result_fingerprints = ['V2 detail leak']; }), /result_fingerprints\[0\]: must match/, 'fingerprint pattern');
fails(edit('candidate', (u) => { u.result_fingerprints.push(u.result_fingerprints[0]); }), /result_fingerprints\[1\]: duplicate fingerprint/, 'duplicate fingerprint in a unit');
fails(edit('covered', (u) => { u.result_fingerprints = ['V4/x']; }), new RegExp(P('covered') + '\\.result_fingerprints: only a candidate unit'), 'covered carries no fingerprints');
fails(edit('deferred', (u) => { delete u.reason; }), new RegExp(P('deferred') + '\\.reason: status deferred needs a reason'), 'deferred needs a reason');
fails(edit('out_of_scope', (u) => { u.agent_id = 'hunter-w1-05'; }), new RegExp(P('out_of_scope') + '\\.agent_id: status out_of_scope has no owner'), 'out_of_scope has no owner');
fails(edit('not_applicable', (u) => { u.checks = [check(['x'], 'y')]; }), new RegExp(P('not_applicable') + '\\.checks: status not_applicable carries no evidence'), 'not_applicable carries no evidence');
fails(edit('not_applicable', (u) => { u.reason = ' '; }), new RegExp(P('not_applicable') + '\\.reason: must be a non-empty string'), 'blank reason');

// Checks.
fails(edit('covered', (u) => { u.checks[0].method = 'exec'; }), /checks\[0\]\.method: must be one of snapshot, select/, 'check method is snapshot or select');
fails(edit('covered', (u) => { u.checks[0].objects = []; }), /checks\[0\]\.objects: must name at least one object/, 'check names objects');
fails(edit('covered', (u) => { delete u.checks[0].invariant; }), /checks\[0\]: missing invariant/, 'check states its invariant');
fails(edit('covered', (u) => { u.checks[0].result = ''; }), /checks\[0\]\.result: must be a non-empty string/, 'check states its result');
fails(edit('covered', (u) => { u.checks[0].artifact = 'x.txt'; }), /checks\[0\]\.artifact: unexpected field/, 'check has fixed fields');

// Agent ids.
fails(edit('covered', (u) => { u.agent_id = 'Hunter-W1-01'; }), new RegExp(P('covered') + '\\.agent_id: must match'), 'agent id is lowercase');
fails(edit('covered', (u) => { u.agent_id = 'con'; }), new RegExp(P('covered') + '\\.agent_id: must match .* not be a Windows device name'), 'Windows device names are refused');
fails(edit('covered', (u) => { u.agent_id = 'a'.repeat(65); }), new RegExp(P('covered') + '\\.agent_id: must match'), 'agent id length');

// Attempts after a critic reassignment.
fails(edit('deferred', (u) => { u.status = 'covered'; u.reason = null; u.agent_id = 'hunter-w1-03'; u.checks = [check(['x'], 'y')]; }), /agent_id: the current owner already owned an earlier attempt/, 'reassignment needs a fresh owner');
fails(edit('deferred', (u) => { u.attempts[0].status = 'planned'; }), /attempts\[0\]\.status: an archived attempt is covered, candidate or blocked/, 'only evidence-bearing states are archived');
fails(edit('deferred', (u) => { delete u.attempts[0].reassignment_reason; }), /attempts\[0\]: missing reassignment_reason/, 'archived attempt says why it was reopened');

// Personal data in check results.
fails(edit('covered', (u) => { u.checks[0].result = 'Recipient was someone@example.com'; }), /checks\[0\]\.result: looks like an email address/, 'email in a check result');

// The CLI: exit 0 clean, 1 violations, 2 could not run.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'validate-ledger-test-'));
try {
  const lines = [];
  const io = { log: (m) => lines.push(m), error: (m) => lines.push(m) };
  const file = (name, content) => { const p = path.join(dir, name); fs.writeFileSync(p, content); return p; };
  eq(run([file('ok.json', JSON.stringify(valid))], io), 0, 'valid ledger exits 0');
  ok(/PASS, 7 unit\(s\): 1 planned, 1 covered, 1 candidate, 1 blocked, 1 deferred, 1 out_of_scope, 1 not_applicable/.test(lines.pop()), 'PASS line counts statuses');
  eq(run([file('bad.json', JSON.stringify([valid[1], valid[0]]))], io), 1, 'violations exit 1');
  eq(run([path.join(dir, 'missing.json')], io), 2, 'missing file exits 2');
  eq(run([file('broken.json', '[{')], io), 2, 'invalid JSON exits 2');
  eq(run([], io), 2, 'no argument exits 2');
  eq(run([file('bom8.json', '﻿' + JSON.stringify(valid))], io), 0, 'UTF-8 with a BOM is read');
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('validate-ledger: ' + n + ' assertions passed');
