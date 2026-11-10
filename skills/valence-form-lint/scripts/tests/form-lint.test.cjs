'use strict';
// Run: node skills/valence-form-lint/scripts/tests/form-lint.test.cjs

const assert = require('assert');
const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { lint, run, CHECKS, CouldNotRun, looksLikeReport, internalName, kindOf, MAX_BYTES, OUTPUT } = require('../form-lint.cjs');

let n = 0;
const eq = (a, b, msg) => { assert.deepStrictEqual(a, b, msg); n++; };
const ok = (v, msg) => { assert.ok(v, msg); n++; };

// Fixture: a placeholder application form with explicit pixel boxes. No real client, person, value or finding.
const box = (x, y, w, h) => ({ x, y, w, h });
function basePack() {
  const c = { visible: true, required: false, readOnly: false, theme: 'Default', fontSize: 14 };
  const w = (o) => Object.assign({}, c, o);
  const widgets = [
    w({ id: 'hdr-applicant', type: 'heading', label: 'Applicant', section: 'Applicant', fontSize: 18,
      box: box(32, 96, 600, 28), box375: box(16, 96, 343, 28), text: { need: 90, have: 600 } }),
    w({ id: 'txt-first', field: 'FirstName', type: 'text', label: 'First name', required: true, requiredMarker: true,
      section: 'Applicant', box: box(32, 150, 280, 36), box375: box(16, 150, 343, 36), text: { need: 70, have: 280 } }),
    w({ id: 'txt-last', field: 'LastName', type: 'text', label: 'Last name', required: true, requiredMarker: true,
      section: 'Applicant', box: box(336, 150, 280, 36), box375: box(16, 200, 343, 36), text: { need: 68, have: 280 } }),
    w({ id: 'ddl-type', field: 'LicenseType', type: 'dropdown', label: 'License type', required: true, requiredMarker: true,
      section: 'Applicant', options: 6, optionW: 240, box: box(32, 230, 280, 36), box375: box(16, 250, 343, 36),
      text: { need: 84, have: 280 } }),
    w({ id: 'rad-delivery', field: 'DeliveryMethod', type: 'radio', label: 'Delivery method', requiredMarker: false,
      section: 'Applicant', options: 3, box: box(32, 300, 280, 72), box375: box(16, 300, 343, 72), text: { need: 104, have: 280 } }),
    w({ id: 'hdr-details', type: 'heading', label: 'Details', section: 'Details', fontSize: 18,
      box: box(32, 400, 600, 28), box375: box(16, 400, 343, 28), text: { need: 70, have: 600 } }),
    w({ id: 'txt-notes', field: 'Notes', type: 'textarea', label: 'Notes', requiredMarker: false, section: 'Details',
      help: 'Anything the reviewer should know before deciding.', box: box(32, 450, 584, 96), box375: box(16, 450, 343, 120),
      text: { need: 40, have: 584 } }),
    w({ id: 'chk-confirm', field: 'Confirmed', type: 'checkbox', label: 'I confirm the details above are correct', required: true,
      requiredMarker: true, section: 'Details', box: box(32, 570, 24, 24), box375: box(16, 590, 24, 24), text: { need: 250, have: 400 } }),
    w({ id: 'btn-address', type: 'button', label: 'Find address', section: 'Details', box: box(32, 610, 140, 36),
      box375: box(16, 630, 140, 36), text: { need: 92, have: 124 } }),
    w({ id: 'grd-history', type: 'grid', label: 'License history', section: 'Details', box: box(32, 670, 900, 240),
      box375: box(16, 690, 343, 240) }),
  ];
  const target = [
    '# Target: example application form',
    '',
    'Capture: LIVE WALK',
    'Task: a licensing clerk records a new application and saves it.',
    'Buttons: Save application saves and closes; Cancel closes without saving; Find address opens the address search.',
    '',
    '## States',
    '',
    '| surface | state | screenshot | shows |',
    '|---|---|---|---|',
    '| form | populated | 01-populated.png | every field filled |',
    '| form | empty | 02-empty.png | new record, no values |',
    '| form | error | 03-error.png | banner names the failed save and keeps the input |',
    '| form | edge | 04-edge.png | long values in every text field |',
    '| grid:grd-history | populated | 01-populated.png | three rows |',
    '| grid:grd-history | empty | 05-grid-empty.png | message: no history yet |',
    '| grid:grd-history | error | 06-grid-error.png | error banner with a retry link |',
    '| grid:grd-history | edge | 04-edge.png | sixty rows, paged |',
    '',
    '## Fixed constraints',
    '',
    '- The Save application wording is set by the client procedure manual.',
    '',
  ].join('\n');
  const walk = ['txt-first', 'txt-last', 'ddl-type', 'rad-delivery', 'txt-notes', 'chk-confirm', 'btn-address', 'btn-save', 'btn-cancel'];
  const keyboard = '# Keyboard walk\n\n| step | key | widget | result |\n|---|---|---|---|\n' +
    walk.map((id, i) => '| ' + (i + 1) + ' | Tab | ' + id + ' | focused |').join('\n') + '\n';
  return {
    census: { captureWidth: 1280, narrowScrollWidth: 375, closeControl: false, widgets,
      footer: [{ id: 'btn-save', label: 'Save application' }, { id: 'btn-cancel', label: 'Cancel' }] },
    target,
    keyboard,
    client: '# Client block (placeholder)\n\nlint-themes: Default, High contrast\n',
    files: ['target.md', 'census.json', 'keyboard.md', 'client-block.md', '01-populated.png', '02-empty.png', '03-error.png',
      '04-edge.png', '05-grid-empty.png', '06-grid-error.png', 'a11y-default.json', 'side-effects.json'],
  };
}

const W = (p, id) => p.census.widgets.find((x) => x.id === id);
const of = (r, check) => r.findings.filter((f) => f.check === check);
const checkOf = (r, id) => r.checks.find((c) => c.id === id);
const lintWith = (edit) => { const p = basePack(); edit(p); return lint(p); };
const kbRows = (ids, key) => '| step | key | widget | result |\n|---|---|---|---|\n' +
  ids.map((id, i) => '| ' + (i + 1) + ' | ' + (key || 'Tab') + ' | ' + id + ' | focused |').join('\n') + '\n';
const fixed = (line) => (p) => { p.target = p.target.replace('## Fixed constraints\n', '## Fixed constraints\n\n' + line + '\n'); };

// A flag case: the check raises at least one finding matching `expect` (every key equal, or matching a RegExp).
function flags(check, edit, msg, expect) {
  const r = lintWith(edit);
  const hits = of(r, check);
  const match = (f) => Object.entries(expect || {}).every(([k, v]) => (v instanceof RegExp ? v.test(String(f[k])) : f[k] === v));
  assert.ok(hits.some(match), msg + ': expected a ' + check + ' finding like ' + JSON.stringify(expect || {}) +
    '\n  got ' + JSON.stringify(hits.map((f) => [f.severity, f.kind, f.title])));
  n++;
  return { r, hits };
}
// A false-positive shape: the check ran fully and found nothing.
function clean(check, edit, msg) {
  const r = lintWith(edit);
  const c = checkOf(r, check);
  assert.deepStrictEqual(of(r, check).map((f) => f.title), [], msg);
  assert.strictEqual(c.status, 'none_found', msg + ': status ' + c.status + ' ' + JSON.stringify(c.missing));
  n++;
  return r;
}
function notChecked(check, edit, msg, missing) {
  const r = lintWith(edit);
  const c = checkOf(r, check);
  assert.strictEqual(c.status, 'not_checked', msg + ': status ' + c.status);
  if (missing) assert.ok(c.missing.some((m) => missing.test(m)), msg + ': missing ' + JSON.stringify(c.missing));
  assert.ok(!r.owned.some((o) => o.check === check), msg + ': a not-checked check is never owned');
  n++;
  return r;
}

// ---------- the clean pack ----------
{
  const r = lint(basePack());
  eq(r.findings.map((f) => f.id), [], 'the base pack has no findings');
  for (const c of CHECKS) eq(checkOf(r, c.id).status, 'none_found', 'base pack: ' + c.id + ' is checked, none found');
  eq(r.summary.exit, 0, 'the base pack exits 0');
  eq(r.capture, 'LIVE WALK', 'capture mode is read');
  eq(r.owned.length, CHECKS.length - 1, 'every check but staging is owned when all ran fully');
  ok(!r.owned.some((o) => o.check === 'staging'), 'staging is never owned: the auditor keeps its own capture rule');
  eq(r.inputs['keyboard.md'], 'structured', 'the keyboard walk is recognised as structured');
  for (const c of CHECKS) ok(['critical', 'major', 'minor', 'advisory'].includes(c.severity) && c.area && c.source && c.needs.length, c.id + ' declares severity, area, source and needs');
}

// ---------- staging ----------
flags('staging', (p) => { p.target = p.target.replace('LIVE WALK', 'REPLICA ONLY'); }, 'replica capture', { severity: 'major', title: 'Capture is REPLICA ONLY' });
{
  const { r } = flags('staging', (p) => { p.target = null; }, 'no target.md', { severity: 'critical', title: 'target.md is missing' });
  ok(r.summary.stop && r.summary.exit === 1, 'a missing target.md stops the run');
}
flags('staging', (p) => { p.target = p.target.replace('Capture: LIVE WALK\n', ''); }, 'no capture line', { severity: 'critical', title: /no Capture line/ });
flags('staging', (p) => { p.target = p.target.replace('LIVE WALK', 'LIVE'); }, 'unknown capture mode', { title: 'Capture mode not recognised' });
flags('staging', (p) => { p.target = p.target.replace('Capture: LIVE WALK', 'Capture: LIVE WALK\nCapture: REPLICA ONLY'); }, 'two capture lines disagree', { title: 'Capture lines disagree' });
flags('staging', (p) => { p.files = p.files.filter((f) => f !== '03-error.png'); }, 'a named screenshot is missing', { severity: 'critical', title: /is missing/ });
flags('staging', (p) => { p.target += '\nSee also ../other-form/01.png for the old layout.\n'; }, 'a screenshot path leaves the pack', { title: 'Screenshot path leaves the pack' });
flags('staging', (p) => { p.files.push('ux-auditor-iteration-1.json'); }, 'an earlier report by name', { title: 'The pack holds an earlier report' });
flags('staging', (p) => { p.reports = [{ path: 'notes/result.json', reason: looksLikeReport('notes/result.json', { verdict: 'x', score: {} }) }]; }, 'an earlier report by content', { title: 'The pack holds an earlier report' });
clean('staging', (p) => { p.target = p.target.replace('Capture: LIVE WALK', '**Capture:** LIVE WALK (STAGE, walked by the engineer)\nCapture width: 1280 px'); }, 'bold capture line with a note, plus a capture-width line');
clean('staging', (p) => { p.target += '\nScreenshots are saved as .png files; the style guide is at https://example.org/guide/figure-1.png.\n'; }, 'prose about .png and an image URL name no pack file');
clean('staging', (p) => { p.files.push('wave-report.json', OUTPUT, 'shots/archive-note.txt'); }, 'a scan named report, the lint\'s own output and other files are not earlier reports');
clean('staging', (p) => { p.target = p.target.replace('| form | edge | 04-edge.png |', '| form | edge | `Screen Shot 4.png` |'); p.files.push('Screen Shot 4.png'); }, 'a backtick-quoted screenshot name with spaces');
eq(looksLikeReport('a11y-high-contrast.json', { violations: [], passes: [] }), null, 'an accessibility scan is not a report');
ok(looksLikeReport('iteration.json', { gates: {} }), 'auditor-shaped JSON is a report whatever its name');
eq(looksLikeReport(OUTPUT, { tool: 'valence-form-lint' }), null, 'the lint\'s own output is not a report');
ok(looksLikeReport(OUTPUT, { verdict: 'merged' }), 'a merged result saved as mechanical.json is a report');

// ---------- unlabelled-field ----------
flags('unlabelled-field', (p) => { Object.assign(W(p, 'txt-first'), { label: '', placeholder: 'First name' }); }, 'placeholder only', { title: 'Placeholder is the only label', severity: 'major' });
flags('unlabelled-field', (p) => { Object.assign(W(p, 'txt-last'), { label: null, ariaLabel: 'Last name' }); }, 'aria-label only never counts', { title: 'Named only by aria-label' });
flags('unlabelled-field', (p) => { W(p, 'ddl-type').label = ' * '; }, 'a label that is only a required marker', { title: 'Field has no visible label' });
flags('unlabelled-field', (p) => { W(p, 'txt-notes').labelVisible = false; }, 'a label recorded but hidden', { title: 'Label is recorded but not shown' });
clean('unlabelled-field', (p) => { Object.assign(W(p, 'txt-notes'), { label: '', visible: false }); }, 'a hidden input needs no label');
clean('unlabelled-field', (p) => { p.census.widgets.push({ id: 'st-intro', type: 'static', label: '', visible: true }); }, 'static text is not an input');
clean('unlabelled-field', (p) => { Object.assign(W(p, 'txt-first'), { placeholder: 'As on the photo ID', label: 'First name:' }); }, 'a placeholder beside a visible label');

// ---------- duplicate-label ----------
flags('duplicate-label', (p) => { W(p, 'txt-last').label = 'First name'; }, 'same label, same section', { severity: 'major' });
flags('duplicate-label', (p) => { W(p, 'txt-notes').label = 'License type'; }, 'same label, different sections', { severity: 'minor' });
flags('duplicate-label', (p) => { W(p, 'txt-last').label = 'first NAME: *'; }, 'case, colon and marker do not make labels differ', { severity: 'major' });
flags('duplicate-label', (p) => { W(p, 'txt-notes').label = 'License type'; delete W(p, 'txt-notes').section; }, 'a missing section reads as the same section', { severity: 'major' });
clean('duplicate-label', (p) => { W(p, 'txt-first').label = 'Address line 1'; W(p, 'txt-last').label = 'Address line 2'; }, 'numbered labels differ');
clean('duplicate-label', (p) => { p.census.widgets.push({ id: 'txt-old', type: 'text', label: 'First name', visible: false }); }, 'a hidden input with the same label');
clean('duplicate-label', (p) => { W(p, 'hdr-details').label = 'Notes'; }, 'a heading that matches an input label is not a duplicate input');

// ---------- repeated-text ----------
const helpAll = (text, ids) => (p) => ids.forEach((id) => { W(p, id).help = text; });
flags('repeated-text', helpAll('See the instructions', ['txt-first', 'txt-last', 'ddl-type']), 'the same help text three times in one section', { severity: 'minor' });
flags('repeated-text', (p) => { helpAll('Required by statute', ['txt-notes', 'chk-confirm'])(p); W(p, 'btn-address').label = 'Required by statute'; }, 'help text and a button in one section');
clean('repeated-text', (p) => { helpAll('See the instructions', ['txt-first', 'txt-last'])(p); W(p, 'txt-notes').help = 'See the instructions'; }, 'three times, but across two sections');
clean('repeated-text', (p) => { W(p, 'txt-last').label = 'Name'; W(p, 'ddl-type').label = 'Name'; W(p, 'txt-first').label = 'Name'; }, 'three identical input labels are duplicate-label\'s, not repeated-text\'s');
clean('repeated-text', (p) => { helpAll('See the instructions', ['txt-first', 'txt-last', 'ddl-type'])(p); W(p, 'ddl-type').visible = false; }, 'a hidden widget does not count');

// ---------- generic-button ----------
flags('generic-button', (p) => { p.census.footer[0].label = 'OK'; }, 'OK', { severity: 'minor' });
flags('generic-button', (p) => { p.census.footer[0].label = 'Submit.'; }, 'Submit with a full stop');
flags('generic-button', (p) => { p.census.footer.push({ label: 'yes' }); }, 'lower-case yes');
clean('generic-button', (p) => { p.census.footer[0].label = 'Submit renewal'; }, 'Submit with an object');
clean('generic-button', (p) => { p.census.footer.push({ label: 'OK', visible: false }); }, 'a hidden OK');
clean('generic-button', (p) => { W(p, 'btn-address').label = 'OK'; }, 'a body button is not a footer button');

// ---------- footer-count ----------
flags('footer-count', (p) => { p.census.footer.push({ label: 'Print' }, { label: 'Save draft' }); }, 'four buttons', { title: 'Footer has 4 buttons' });
flags('footer-count', (p) => { for (const l of ['Print', 'Email', 'Copy', 'Delete']) p.census.footer.push({ label: l }); }, 'six buttons');
clean('footer-count', (p) => { p.census.footer.push({ label: 'Save draft' }); }, 'three buttons');
clean('footer-count', (p) => { p.census.footer.push({ label: 'Save draft' }, { label: 'Approve', visible: false }); }, 'a hidden fourth button');

// ---------- footer-exit ----------
flags('footer-exit', (p) => { p.census.footer = [{ label: 'Save application' }]; }, 'no exit', { severity: 'major' });
flags('footer-exit', (p) => { p.census.footer[1].label = 'Return to applicant'; }, 'a workflow return is not an exit');
flags('footer-exit', (p) => { p.census.footer[1].label = 'Send back'; }, 'send back is a workflow action');
clean('footer-exit', (p) => { p.census.footer[1].label = 'Close window'; }, 'close');
clean('footer-exit', (p) => { p.census.footer = [{ label: 'Save application' }]; p.census.closeControl = true; }, 'the dialog\'s own close control');
clean('footer-exit', (p) => { p.census.footer = [{ label: 'Save application' }]; p.census.widgets.push({ id: 'lnk-back', type: 'link', label: 'Back to search', visible: true }); }, 'a body link back');
clean('footer-exit', (p) => { p.census.footer[1].label = 'Discard changes'; }, 'discard');

// ---------- choice-overload ----------
flags('choice-overload', (p) => { W(p, 'rad-delivery').options = 8; }, 'eight radios', { severity: 'major' });
flags('choice-overload', (p) => { p.census.widgets.push({ id: 'cbl-days', type: 'checkboxlist', label: 'Days', visible: true, options: 12 }); }, 'twelve checkboxes', { severity: 'major' });
flags('choice-overload', (p) => { W(p, 'rad-delivery').options = 5; }, 'five radios', { severity: 'advisory' });
{
  const { r } = flags('choice-overload', (p) => { W(p, 'rad-delivery').options = 7; }, 'seven radios', { severity: 'advisory' });
  eq(r.summary.exit, 0, 'an advisory finding alone exits 0');
}
clean('choice-overload', (p) => { W(p, 'ddl-type').options = 40; }, 'dropdowns are exempt');
clean('choice-overload', (p) => { W(p, 'rad-delivery').options = 4; }, 'four radios');
clean('choice-overload', (p) => { Object.assign(W(p, 'rad-delivery'), { options: 9, readOnly: true }); }, 'a read-only group');
clean('choice-overload', (p) => { Object.assign(W(p, 'rad-delivery'), { options: 9, visible: false }); }, 'a hidden group');

// ---------- dropdown-options ----------
flags('dropdown-options', (p) => { W(p, 'ddl-type').options = 0; }, 'empty dropdown', { severity: 'critical', title: 'List has no options' });
flags('dropdown-options', (p) => { W(p, 'rad-delivery').options = 0; }, 'empty radio list bound to a lookup', { severity: 'critical' });
flags('dropdown-options', (p) => { W(p, 'ddl-type').options = 1; }, 'one-option dropdown', { severity: 'minor' });
flags('dropdown-options', (p) => { W(p, 'ddl-type').options = []; }, 'options as an empty array', { severity: 'critical' });
flags('dropdown-options', (p) => { Object.assign(W(p, 'ddl-type'), { options: 0, dependsOn: 'txt-last' }); }, 'an empty dependent list is advisory', { severity: 'advisory' });
clean('dropdown-options', (p) => { W(p, 'ddl-type').options = 2; }, 'two options');
clean('dropdown-options', (p) => { Object.assign(W(p, 'ddl-type'), { options: 1, readOnly: true }); }, 'a read-only dropdown shows a value, not a choice');
clean('dropdown-options', (p) => { Object.assign(W(p, 'ddl-type'), { options: 1, dependsOn: 'txt-last' }); }, 'one option filtered by a parent');
clean('dropdown-options', (p) => { Object.assign(W(p, 'ddl-type'), { options: 0, visible: false }); }, 'a hidden empty dropdown');

// ---------- required-blocked ----------
flags('required-blocked', (p) => { Object.assign(W(p, 'txt-first'), { readOnly: true, hasValue: false }); }, 'required, read-only, empty', { severity: 'critical', title: 'Required field is read-only and empty' });
flags('required-blocked', (p) => { Object.assign(W(p, 'txt-last'), { visible: false, value: '   ' }); }, 'required, hidden, blank value', { severity: 'critical', title: 'Required field is hidden and empty' });
flags('required-blocked', (p) => { W(p, 'ddl-type').readOnly = true; }, 'required, read-only, fill state unknown', { severity: 'major', kind: 'gap' });
clean('required-blocked', (p) => { Object.assign(W(p, 'txt-first'), { readOnly: true, hasValue: true }); }, 'read-only but filled by the platform');
clean('required-blocked', (p) => { Object.assign(W(p, 'txt-last'), { visible: false, value: 'placeholder-value' }); }, 'hidden but set');
clean('required-blocked', (p) => { Object.assign(W(p, 'txt-notes'), { readOnly: true, visible: false }); }, 'not required');

// ---------- required-markers ----------
flags('required-markers', (p) => { W(p, 'txt-last').requiredMarker = false; }, 'one required field unmarked', { severity: 'major', title: 'Required field has no marker' });
flags('required-markers', (p) => { W(p, 'txt-notes').requiredMarker = true; }, 'an optional field marked', { severity: 'minor' });
flags('required-markers', (p) => {
  for (const x of p.census.widgets) delete x.requiredMarker;
  W(p, 'txt-first').label = 'First name *';
  W(p, 'ddl-type').label = 'License type (required)';
}, 'markers read from label text, two of four required marked', { severity: 'major' });
clean('required-markers', () => {}, 'every required field marked');
clean('required-markers', (p) => { for (const x of p.census.widgets) delete x.requiredMarker; }, 'no marker in any label text: the platform may draw them, so no finding');
clean('required-markers', (p) => { for (const x of p.census.widgets) delete x.requiredMarker; W(p, 'txt-notes').label = 'Rate * hours'; W(p, 'rad-delivery').label = 'Required documents'; }, 'an asterisk mid-label and the word required are not markers');
clean('required-markers', (p) => { Object.assign(W(p, 'txt-last'), { requiredMarker: false, readOnly: true, hasValue: true }); }, 'a read-only required field is exempt');

// ---------- theme-approved and theme-mixed ----------
flags('theme-approved', (p) => { W(p, 'txt-notes').theme = 'Legacy Blue'; }, 'off-list theme', { severity: 'major' });
{
  const { hits } = flags('theme-approved', (p) => { W(p, 'txt-notes').theme = 'Legacy Blue'; W(p, 'txt-first').theme = 'Compact'; }, 'two off-list themes');
  eq(hits.length, 2, 'one finding per off-list theme');
}
clean('theme-approved', (p) => { W(p, 'txt-notes').theme = 'high contrast'; }, 'theme names compare without case');
clean('theme-approved', (p) => { Object.assign(W(p, 'txt-notes'), { theme: 'Legacy Blue', visible: false }); }, 'a hidden widget');
notChecked('theme-approved', (p) => { p.client = null; }, 'no client block', /client-block\.md/);
notChecked('theme-approved', (p) => { p.client = '# Client block\nThemes: see the style guide\n'; }, 'no lint-themes line', /lint-themes/);
flags('theme-mixed', (p) => { W(p, 'txt-notes').theme = 'High contrast'; }, 'two approved themes on one form', { severity: 'minor' });
flags('theme-mixed', (p) => { W(p, 'txt-notes').theme = 'High contrast'; W(p, 'txt-first').theme = 'Compact'; }, 'three themes', { title: 'Form mixes 3 themes' });
clean('theme-mixed', (p) => { W(p, 'txt-notes').theme = 'default'; }, 'case does not make a second theme');
clean('theme-mixed', (p) => { Object.assign(W(p, 'txt-notes'), { theme: 'High contrast', visible: false }); }, 'a hidden widget');

// ---------- small-target ----------
{
  const { hits } = flags('small-target', (p) => { W(p, 'chk-confirm').box = box(32, 600, 16, 16); }, 'a 16px checkbox next to a button', { severity: 'minor' });
  ok(/not a WCAG 2\.1 AA failure/.test(hits[0].why) && /2\.5\.8/.test(hits[0].why) && /AAA/.test(hits[0].why), 'the finding says it is not a WCAG 2.1 AA failure');
}
{
  const { hits } = flags('small-target', (p) => {
    p.census.widgets.push({ id: 'chk-a', type: 'checkbox', label: 'A', visible: true, box: box(700, 150, 16, 16) },
      { id: 'chk-b', type: 'checkbox', label: 'B', visible: true, box: box(718, 150, 16, 16) });
  }, 'two small checkboxes 2px apart (centres 18px apart)');
  eq(hits.length, 2, 'both crowded targets are flagged');
}
clean('small-target', (p) => {
  p.census.widgets.push({ id: 'chk-a', type: 'checkbox', label: 'A', visible: true, box: box(700, 150, 16, 16) },
    { id: 'chk-b', type: 'checkbox', label: 'B', visible: true, box: box(726, 150, 16, 16) });
}, 'two small checkboxes with centres 26px apart pass the spacing test');
clean('small-target', (p) => { p.census.widgets.push({ id: 'chk-lone', type: 'checkbox', label: 'Lone', visible: true, box: box(900, 300, 16, 16) }); }, 'a small target with room passes the spacing test');
clean('small-target', (p) => { W(p, 'chk-confirm').box = box(32, 570, 24, 24); }, 'exactly 24x24');
clean('small-target', (p) => { W(p, 'chk-confirm').box = box(32, 600, 0, 0); }, 'a zero box was not rendered');
clean('small-target', (p) => { Object.assign(W(p, 'btn-address'), { readOnly: true, box: box(32, 600, 10, 10) }); }, 'a read-only control is not a target');
clean('small-target', (p) => { W(p, 'hdr-details').box = box(32, 600, 10, 10); }, 'a heading is not a target');

// ---------- all-caps-text ----------
const caps = 'THE APPLICANT MUST ATTACH A CERTIFIED COPY OF EVERY LICENSE HELD IN ANOTHER STATE WITHIN THE LAST TEN YEARS';
flags('all-caps-text', (p) => { W(p, 'txt-notes').help = caps; }, 'help text in capitals', { severity: 'minor', title: /Help text/ });
flags('all-caps-text', (p) => { W(p, 'chk-confirm').label = caps; }, 'a label in capitals', { title: /Label/ });
clean('all-caps-text', (p) => { W(p, 'txt-first').label = 'APPLICANT NAME'; W(p, 'hdr-details').label = 'SSN'; }, 'short labels in capitals are a convention');
clean('all-caps-text', (p) => { W(p, 'txt-notes').help = caps.charAt(0) + caps.slice(1).toLowerCase(); }, 'a long help text in sentence case');
clean('all-caps-text', (p) => { W(p, 'txt-notes').help = 'ID 1001-2002-3003-4004-5005-6006-7007-8008-9009 1001-2002-3003-4004-5005-6006-7007-8008'; }, 'a long run of codes has too few letters');
clean('all-caps-text', (p) => { Object.assign(W(p, 'txt-notes'), { help: caps, visible: false }); }, 'a hidden widget');

// ---------- internal-name ----------
flags('internal-name', (p) => { W(p, 'txt-first').label = 'Applicant_FirstName'; }, 'underscore', { severity: 'major', title: /Applicant_FirstName/ });
flags('internal-name', (p) => { W(p, 'ddl-type').label = 'LicenseTypeId'; }, 'three-part CamelCase');
flags('internal-name', (p) => { W(p, 'txt-last').label = 'ZipCode'; }, 'two parts ending in a field suffix');
flags('internal-name', (p) => { W(p, 'txt-notes').label = 'IDNumber'; }, 'an acronym run into a field word');
flags('internal-name', (p) => { p.census.footer[0].label = 'btnSaveRecord'; }, 'a footer button label');
clean('internal-name', (p) => { W(p, 'ddl-type').label = 'DeKalb County office'; W(p, 'txt-last').label = 'McHenry or LaSalle'; }, 'county names are not internal names');
clean('internal-name', (p) => { W(p, 'txt-notes').label = 'PayPal or LinkedIn reference'; W(p, 'hdr-details').label = 'PhD and iPhone'; }, 'product and degree names');
clean('internal-name', (p) => { W(p, 'txt-notes').label = 'Signature: ________'; W(p, 'txt-first').label = 'SSN'; }, 'a fill-in line and an acronym');

// ---------- keyboard-coverage, keyboard-trap, keyboard-order ----------
const walkIds = ['txt-first', 'txt-last', 'ddl-type', 'rad-delivery', 'txt-notes', 'chk-confirm', 'btn-address', 'btn-save', 'btn-cancel'];
flags('keyboard-coverage', (p) => { p.keyboard = kbRows(walkIds.filter((x) => x !== 'ddl-type')); }, 'a widget never reached', { severity: 'major' });
flags('keyboard-coverage', (p) => { p.keyboard = kbRows(walkIds.filter((x) => x !== 'btn-cancel')); }, 'a footer button never reached');
clean('keyboard-coverage', (p) => { W(p, 'txt-notes').visible = false; p.keyboard = kbRows(walkIds.filter((x) => x !== 'txt-notes')); }, 'a hidden widget is not in the walk');
clean('keyboard-coverage', (p) => { W(p, 'txt-notes').readOnly = true; p.keyboard = kbRows(walkIds.filter((x) => x !== 'txt-notes')); }, 'a read-only widget is not in the walk');
clean('keyboard-coverage', (p) => { p.keyboard = kbRows(walkIds.map((x) => '`' + x + '`')); }, 'ids in backticks still match');
flags('keyboard-trap', (p) => { p.keyboard = p.keyboard.replace('| txt-notes | focused |', '| txt-notes | trapped |'); }, 'trapped', { severity: 'critical' });
flags('keyboard-trap', (p) => { p.keyboard = p.keyboard.replace('| txt-notes | focused |', '| txt-notes | Trap: focus stays in the editor |'); }, 'Trap with a note');
clean('keyboard-trap', (p) => { p.keyboard = p.keyboard.replace('| txt-notes | focused |', '| txt-notes | focused (no trap) |'); }, 'no trap');
clean('keyboard-trap', (p) => { p.keyboard = p.keyboard.replace('| btn-cancel | focused |', '| btn-cancel | focused; Escape closes the dialog |'); }, 'a dialog closing on Escape');
flags('keyboard-order', (p) => { p.keyboard = kbRows(['txt-last', 'txt-first', 'ddl-type', 'rad-delivery', 'txt-notes', 'chk-confirm', 'btn-address', 'btn-save', 'btn-cancel']); }, 'right to left within a row', { severity: 'major' });
flags('keyboard-order', (p) => { p.keyboard = kbRows(['txt-first', 'txt-last', 'rad-delivery', 'ddl-type', 'txt-notes', 'chk-confirm', 'btn-address', 'btn-save', 'btn-cancel']); }, 'back up the same column');
clean('keyboard-order', (p) => {
  Object.assign(W(p, 'txt-last'), { box: box(32, 230, 280, 36) });
  Object.assign(W(p, 'ddl-type'), { box: box(400, 150, 280, 36) });
  Object.assign(W(p, 'rad-delivery'), { box: box(400, 230, 280, 72) });
}, 'down the left column, then up into the right column');
clean('keyboard-order', (p) => { p.keyboard = kbRows(walkIds.concat(['txt-first', 'txt-last'])); }, 'focus wrapping round to the first field');
clean('keyboard-order', (p) => { p.keyboard += '| 10 | Shift+Tab | btn-address | focused |\n| 11 | Shift+Tab | txt-first | focused |\n'; }, 'Shift+Tab rows going back up');
notChecked('keyboard-order', (p) => { for (const x of p.census.widgets) delete x.box; }, 'no boxes', /widget\.box/);
for (const id of ['keyboard-coverage', 'keyboard-order', 'keyboard-trap']) {
  notChecked(id, (p) => { p.keyboard = null; }, id + ' without keyboard.md', /^keyboard\.md$/);
  notChecked(id, (p) => { p.keyboard = '# Keyboard walk\n\nTabbed through every field in order; no trap.\n'; }, id + ' with a prose walk', /table/);
}

// ---------- state-captures and error-as-empty ----------
flags('state-captures', (p) => { p.target = p.target.replace(/^\| form \| error .*\n/m, ''); }, 'no form error capture', { severity: 'major', kind: 'gap' });
flags('state-captures', (p) => { p.target = p.target.replace(/^\| grid:grd-history \| edge .*\n/m, ''); }, 'no grid edge capture', { severity: 'minor' });
{
  const { hits } = flags('state-captures', (p) => { p.target = p.target.replace(/## States[\s\S]*?(?=## Fixed)/, ''); }, 'no states table');
  eq(hits.length, 2, 'one finding for the form and one for its grid');
}
flags('state-captures', (p) => { p.target = p.target.replace('| form | empty | 02-empty.png |', '| form | empty | - |'); }, 'a dash is no screenshot');
clean('state-captures', (p) => { W(p, 'grd-history').visible = false; p.target = p.target.replace(/^\| grid:grd-history .*\n/gm, ''); }, 'a hidden grid needs no captures');
clean('state-captures', (p) => {
  p.target = p.target.replace('| surface | state | screenshot | shows |', '| State | Surface | Shows | Screenshot |')
    .replace(/^\| (form|grid:grd-history) \| (\w+) \| ([^|]+) \| ([^|]*) \|$/gm, '| $2 | $1 | $4 | $3 |');
}, 'columns in another order');
clean('state-captures', (p) => { p.target = p.target.replace(/^\| form \|/gm, '| Form |'); }, 'surface names compare without case');
flags('error-as-empty', (p) => { p.target = p.target.replace('banner names the failed save and keeps the input', 'as-empty: blank form, no message'); }, 'recorded as looking empty', { severity: 'critical', kind: 'defect' });
flags('error-as-empty', (p) => { p.target = p.target.replace('| grid:grd-history | error | 06-grid-error.png |', '| grid:grd-history | error | 05-grid-empty.png |'); }, 'error and empty cite one screenshot', { severity: 'critical' });
flags('error-as-empty', (p) => { p.target = p.target.replace('error banner with a retry link', 'shown as empty: grid with no rows'); }, 'shown as empty');
clean('error-as-empty', (p) => { p.target = p.target.replace('banner names the failed save and keeps the input', 'red border on the blank required field, message under it'); }, 'blank in an error note is not as-empty');
clean('error-as-empty', (p) => { p.target = p.target.replace('message: no history yet', 'as-empty is right here: first use'); }, 'as-empty on the empty row is not an error');
notChecked('error-as-empty', (p) => { p.target = p.target.replace(/## States[\s\S]*?(?=## Fixed)/, ''); }, 'no states table', /states table/);

// ---------- text-overflow, clipped-dropdown, narrow-overflow ----------
flags('text-overflow', (p) => { W(p, 'txt-first').text = { need: 320, have: 280 }; }, 'measured overflow', { severity: 'major', kind: 'defect' });
flags('text-overflow', (p) => { Object.assign(W(p, 'btn-address'), { label: 'Submit the renewal application now', box: box(32, 610, 120, 36) }); delete W(p, 'btn-address').text; }, 'estimated button overflow goes to verify', { severity: 'minor', kind: 'gap' });
clean('text-overflow', (p) => { W(p, 'txt-first').text = { need: 282, have: 280 }; }, 'within 2px');
clean('text-overflow', (p) => { Object.assign(W(p, 'btn-address'), { label: 'Save', box: box(32, 610, 100, 36) }); delete W(p, 'btn-address').text; }, 'an estimate that fits');
clean('text-overflow', (p) => { Object.assign(W(p, 'txt-first'), { text: { need: 900, have: 280 }, visible: false }); }, 'a hidden widget');
notChecked('text-overflow', (p) => { for (const x of p.census.widgets) delete x.text; }, 'no text measurements', /widget\.text/);
flags('clipped-dropdown', (p) => { W(p, 'ddl-type').optionW = 320; }, 'option wider than the box', { severity: 'minor' });
flags('clipped-dropdown', (p) => { W(p, 'ddl-type').optionW = 283; }, 'just over the slack');
clean('clipped-dropdown', (p) => { W(p, 'ddl-type').optionW = 282; }, 'within the slack');
clean('clipped-dropdown', (p) => { Object.assign(W(p, 'ddl-type'), { optionW: 600, visible: false }); }, 'a hidden dropdown');
clean('clipped-dropdown', (p) => { W(p, 'rad-delivery').optionW = 600; }, 'a radio group is not a dropdown');
notChecked('clipped-dropdown', (p) => { delete W(p, 'ddl-type').optionW; }, 'boxes without optionW', /optionW/);
flags('narrow-overflow', (p) => { W(p, 'txt-notes').box375 = box(16, 450, 400, 120); }, 'a widget past 375px', { severity: 'major' });
flags('narrow-overflow', (p) => { for (const x of p.census.widgets) delete x.box375; p.census.narrowScrollWidth = 420; }, 'page width alone', { title: 'Page scrolls sideways at 375px' });
clean('narrow-overflow', (p) => { W(p, 'grd-history').box375 = box(16, 690, 900, 240); p.census.narrowScrollWidth = 916; }, 'a data grid is exempt');
clean('narrow-overflow', (p) => { W(p, 'txt-notes').box375 = box(16, 450, 359, 120); }, 'right edge inside the viewport');
clean('narrow-overflow', (p) => { Object.assign(W(p, 'txt-notes'), { box375: box(16, 450, 500, 120), visible: false }); }, 'a hidden widget');
clean('narrow-overflow', (p) => { for (const x of p.census.widgets) delete x.box375; }, 'the page width alone answers it when it fits');
notChecked('narrow-overflow', (p) => { for (const x of p.census.widgets) delete x.box375; delete p.census.narrowScrollWidth; }, 'neither recorded', /box375/);

// ---------- not checked is never passed ----------
{
  const r = lintWith((p) => { for (const x of p.census.widgets) delete x.box; });
  for (const id of ['small-target', 'keyboard-order']) eq(checkOf(r, id).status, 'not_checked', id + ' without boxes is not checked');
  eq(r.summary.exit, 0, 'not checked never fails the run on its own');
  ok(/not checked: .*small-target \(widget\.box\)/.test(require('../form-lint.cjs').summaryLines(r).join('\n')), 'the summary names the missing field');
}
for (const id of ['generic-button', 'footer-count', 'footer-exit']) notChecked(id, (p) => { delete p.census.footer; }, id + ' without a footer', /census\.footer/);
{
  const r = notChecked('unlabelled-field', (p) => { delete W(p, 'txt-notes').label; }, 'one input without a label field', /widget\.label/);
  eq(checkOf(r, 'unlabelled-field').unchecked, 1, 'the unchecked widget is counted');
}
{
  const r = lintWith((p) => { delete W(p, 'txt-notes').label; W(p, 'txt-first').label = ''; });
  eq(checkOf(r, 'unlabelled-field').status, 'finding', 'a finding among partly checked widgets');
  ok(!r.owned.some((o) => o.check === 'unlabelled-field'), 'a partly checked check is not owned');
}
notChecked('unlabelled-field', (p) => { W(p, 'txt-notes').type = 'signature pad'; }, 'a type outside the vocabulary', /not in the contract vocabulary/);
clean('unlabelled-field', (p) => { Object.assign(W(p, 'txt-notes'), { type: 'signature pad', kind: 'textarea' }); }, 'kind overrides the platform type');
eq(kindOf({ type: 'Drop Down' }), 'dropdown', 'type names map without case or spaces');
eq(kindOf({ type: 'RadioButtonList' }), 'radio', 'platform aliases map to kinds');
eq(kindOf({}), undefined, 'no type is not recorded');
eq(internalName('First name'), null, 'plain words are not internal names');

// ---------- waivers ----------
{
  const r = lintWith((p) => { W(p, 'txt-first').label = 'Applicant_FirstName'; fixed('- lint-waive internal-name txt-first: the client requires the statute field name on this label')(p); });
  const f = of(r, 'internal-name')[0];
  ok(f.waived && f.waived.source === 'fixed_constraint', 'a fixed-constraint waiver marks the finding');
  eq(r.summary.exit, 0, 'a waived major no longer fails the run');
  eq(r.summary.waived, 1, 'the waived count');
  eq(r.waivers[0].applied_to, [f.id], 'the waiver lists what it covered');
  eq(checkOf(r, 'internal-name').status, 'finding', 'a waived finding is still a finding, listed');
}
{
  const r = lintWith((p) => { p.census.footer[0].label = 'Submit'; fixed('- `lint-waive generic-button: the procedure manual names this button Submit`')(p); });
  ok(of(r, 'generic-button')[0].waived, 'a whole-check waiver in backticks');
}
{
  const r = lintWith((p) => { W(p, 'txt-first').label = 'Applicant_FirstName'; p.target = p.target.replace('## States', 'lint-waive internal-name: the client wants it, said in a meeting\n\n## States'); });
  ok(!of(r, 'internal-name')[0].waived && r.summary.exit === 1, 'a waiver outside Fixed constraints waives nothing');
  ok(/Fixed constraints/.test(r.waiver_errors[0].error), 'and is listed as a waiver error');
}
{
  const r = lintWith((p) => { p.census.footer = [{ label: 'Save application' }]; p.client += 'lint-waive footer-exit: proven: the platform dialog always draws its own close button\n'; });
  const f = of(r, 'footer-exit')[0];
  ok(f.waived && f.waived.source === 'platform_limit', 'a proven platform limit in the client block');
}
{
  const r = lintWith((p) => { p.census.footer = [{ label: 'Save application' }]; p.client += 'lint-waive footer-exit: the platform probably draws a close button\n'; });
  ok(!of(r, 'footer-exit')[0].waived && /proven/.test(r.waiver_errors[0].error), 'an unproven platform limit waives nothing');
}
const waiverError = (line, pattern, msg) => {
  const r = lintWith(fixed(line));
  ok(r.waiver_errors.some((e) => pattern.test(e.error)), msg + ': ' + JSON.stringify(r.waiver_errors));
};
waiverError('- lint-waive staging: the replica is all we could get', /cannot be waived/, 'staging is never waived');
waiverError('- lint-waive no-such-check: reason given here', /no check is named/, 'an unknown check');
waiverError('- lint-waive generic-button: ok', /too short/, 'a reason is required');
waiverError('- lint-waive internal-name txt-gone: the field was removed last week', /not in the census/, 'a widget outside the census');
{
  const email = 'someone@example.com';
  const r = lintWith(fixed('- lint-waive generic-button: agreed with ' + email + ' by phone'));
  ok(/personal data/.test(r.waiver_errors[0].error) && !JSON.stringify(r).includes(email), 'a reason holding personal data is rejected and not copied');
}
{
  const r = lintWith(fixed('- lint-waive generic-button: the procedure manual names this button Submit'));
  eq(r.waivers[0].applied_to, [], 'a waiver that matches nothing is listed with nothing applied');
}

// ---------- personal data ----------
{
  const email = 'applicant@example.com';
  const ssn = '000-12-3456';
  const phone = '(212) 555-0147';
  const r = lintWith((p) => {
    Object.assign(W(p, 'txt-first'), { value: email, readOnly: true });       // required, read-only, filled: no finding
    Object.assign(W(p, 'txt-last'), { value: ssn });
    Object.assign(W(p, 'txt-notes'), { value: phone, label: 'Call ' + phone + ' for help', help: 'Or write to ' + email });
    W(p, 'txt-notes').text = { need: 900, have: 584 };
  });
  const text = JSON.stringify(r);
  ok(![email, ssn, phone].some((v) => text.includes(v)), 'no census value or personal-data pattern reaches mechanical.json');
  eq(r.summary.withheld, 0, 'values are never copied in the first place, so nothing needed withholding');
  ok(of(r, 'text-overflow').length === 1 && /widgets\[6\]\.text/.test(of(r, 'text-overflow')[0].evidence), 'the finding cites the widget and field instead');
  eq(of(r, 'required-blocked').length, 0, 'a value is read only to test emptiness');
  const quoted = lintWith((p) => { W(p, 'txt-notes').label = 'Call ' + phone + ' for help'; W(p, 'txt-last').label = 'Call ' + phone + ' for help'; });
  const dup = of(quoted, 'duplicate-label')[0];
  ok(dup && /\[withheld\]/.test(dup.title) && !JSON.stringify(quoted).includes(phone), 'a quoted label holding a phone number is withheld');
  ok(quoted.summary.withheld >= 1, 'withheld patterns are counted');
  ok(!require('../form-lint.cjs').summaryLines(quoted).join('\n').includes(phone), 'the console summary carries no personal data');
}

// ---------- could not run ----------
const throws = (fn, pattern, msg) => { assert.throws(fn, (e) => e instanceof CouldNotRun && pattern.test(e.message), msg); n++; };
throws(() => lint({ census: { controls: [] } }), /widgets array/, 'a census without widgets');
throws(() => lint({ census: { widgets: [{ type: 'text' }] } }), /has no id/, 'a widget without an id');
throws(() => lint({ census: { widgets: [{ id: 'a' }, { id: 'a' }] } }), /repeats/, 'duplicate widget ids');

// ---------- the CLI: exit 0 clean, 1 findings, 2 could not run, and a 2 never reads as a 0 ----------
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'form-lint-test-'));
try {
  const lines = [];
  const io = { log: (m) => lines.push(m), error: (m) => lines.push(m) };
  const stage = (name, edit) => {
    const p = basePack();
    if (edit) edit(p);
    const dir = path.join(root, name);
    fs.mkdirSync(dir);
    for (const f of p.files) fs.writeFileSync(path.join(dir, f), f.endsWith('.json') ? '{}' : 'placeholder');
    fs.writeFileSync(path.join(dir, 'census.json'), JSON.stringify(p.census));
    fs.writeFileSync(path.join(dir, 'target.md'), p.target);
    fs.writeFileSync(path.join(dir, 'keyboard.md'), p.keyboard);
    fs.writeFileSync(path.join(dir, 'client-block.md'), p.client);
    return dir;
  };
  const cleanDir = stage('clean');
  lines.length = 0;
  eq(run([cleanDir], io), 0, 'a clean pack exits 0');
  ok(/^form-lint: PASS, 0 critical, 0 major/.test(lines[0]), 'PASS line');
  ok(lines.some((l) => /^form-lint: owned \(the only lint output the auditor is given\): words: /.test(l)), 'the owned line for the auditor prompt');
  const written = JSON.parse(fs.readFileSync(path.join(cleanDir, OUTPUT), 'utf8'));
  eq([written.tool, written.summary.exit, written.findings.length], ['valence-form-lint', 0, 0], 'mechanical.json is written in the pack');
  eq(run([cleanDir], io), 0, 'a second run overwrites its own mechanical.json and still passes staging');

  const bad = stage('bad', (p) => { W(p, 'ddl-type').options = 0; });
  lines.length = 0;
  eq(run([bad], io), 1, 'a critical finding exits 1');
  ok(/^form-lint: FAIL, 1 critical/.test(lines[0]) && lines.some((l) => /critical dropdown-options\/ddl-type: List has no options/.test(l)), 'FAIL line and the finding');

  const old = stage('old');
  fs.writeFileSync(path.join(old, 'iteration-1.json'), JSON.stringify({ verdict: 'not ready', gates: {} }));
  lines.length = 0;
  eq(run([old], io), 1, 'an earlier report found by content exits 1');
  ok(lines.some((l) => /STOP: the pack is not staged/.test(l)), 'and says STOP');

  eq(run([path.join(root, 'missing')], io), 2, 'a missing pack folder exits 2');
  eq(run([path.join(cleanDir, 'census.json')], io), 2, 'a file instead of a folder exits 2');
  const noCensus = stage('no-census');
  fs.unlinkSync(path.join(noCensus, 'census.json'));
  eq(run([noCensus], io), 2, 'a pack without census.json exits 2');
  const email = 'someone@example.com';
  const broken = stage('broken');
  fs.writeFileSync(path.join(broken, 'census.json'), '{"widgets": [{"id": "a", "value": "' + email + '"');
  lines.length = 0;
  eq(run([broken], io), 2, 'invalid census JSON exits 2');
  ok(lines.length === 1 && !lines[0].includes(email) && /not valid JSON/.test(lines[0]), 'the JSON error does not quote file content');
  const shape = stage('shape');
  fs.writeFileSync(path.join(shape, 'census.json'), JSON.stringify({ controls: [] }));
  eq(run([shape], io), 2, 'a census without a widgets array exits 2');
  const dupe = stage('dupe');
  fs.writeFileSync(path.join(dupe, 'census.json'), JSON.stringify({ widgets: [{ id: 'x' }, { id: 'x' }] }));
  eq(run([dupe], io), 2, 'duplicate widget ids exit 2');
  const big = stage('big');
  fs.writeFileSync(path.join(big, 'census.json'), '{"widgets": []' + ' '.repeat(MAX_BYTES) + '}');
  eq(run([big], io), 2, 'a census over 5 MiB exits 2');
  const outDir = stage('out-dir');
  fs.mkdirSync(path.join(outDir, OUTPUT));
  eq(run([outDir], io), 2, 'a folder where mechanical.json goes exits 2');
  eq(run([], io), 2, 'no argument exits 2');
  eq(run(['a', 'b'], io), 2, 'two arguments exit 2');
  const bom8 = stage('bom8');
  fs.writeFileSync(path.join(bom8, 'census.json'), '﻿' + JSON.stringify(basePack().census));
  eq(run([bom8], io), 0, 'UTF-8 with a BOM is read');
  const bom16 = stage('bom16');
  fs.writeFileSync(path.join(bom16, 'census.json'), Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(JSON.stringify(basePack().census), 'utf16le')]));
  fs.writeFileSync(path.join(bom16, 'target.md'), Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(basePack().target.replace(/\n/g, '\r\n'), 'utf16le')]));
  eq(run([bom16], io), 0, 'UTF-16 LE with a BOM and CRLF line ends are read');
  const be = stage('be');
  fs.writeFileSync(path.join(be, 'census.json'), Buffer.from([0xfe, 0xff, 0x00, 0x7b]));
  eq(run([be], io), 2, 'UTF-16 BE exits 2');

  const script = path.join(__dirname, '..', 'form-lint.cjs');
  const missing = childProcess.spawnSync(process.execPath, [script, path.join(root, 'missing')], { encoding: 'utf8' });
  eq(missing.status, 2, 'the real entry point exits 2 when it could not run');
  const real = childProcess.spawnSync(process.execPath, [script, cleanDir], { encoding: 'utf8' });
  eq(real.status, 0, 'the real entry point exits 0 on a clean pack');
  const realBad = childProcess.spawnSync(process.execPath, [script, bad], { encoding: 'utf8' });
  eq(realBad.status, 1, 'the real entry point exits 1 on findings');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log('form-lint: ' + n + ' assertions passed');
