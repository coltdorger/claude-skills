#!/usr/bin/env node
'use strict';
// Mechanical checks over one Valence form's UX evidence pack, run before the ux-auditor scores the form.
// Run: node form-lint.cjs <pack-folder>
// Writes <pack-folder>/mechanical.json and prints a short summary. Reads only files inside the pack folder:
// no network, no database, no mail. Census values may be record data, so the output cites widget ids, field
// names and positions, never values.
// Exit 0: no critical or major finding. Exit 1: critical or major findings. Exit 2: could not run.
// Zero dependencies. Plain stat and readFile, so it behaves the same on Windows and Linux.

const fs = require('fs');
const path = require('path');

const NAME = 'form-lint';
const TOOL = 'valence-form-lint';
const CONTRACT = 1;
const OUTPUT = 'mechanical.json';
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_FILES = 5000;
const MAX_WALK_DEPTH = 4;
const MAX_PRINTED = 10;
const NARROW_PX = 375;
const TARGET_PX = 24;
const CAPS_CHARS = 80;
const SLACK_PX = 2;

const SEVERITIES = ['critical', 'major', 'minor', 'advisory'];
const STATES = ['populated', 'empty', 'error', 'edge'];
const AREA_NAMES = {
  proof_gate: 'proof gate', task_flow: 'task flow', widget_fit: 'widget fit', visual_restraint: 'visual restraint',
  words: 'words', actions: 'actions', responsive_accessible: 'responsive and accessible',
};

// The contract's widget kinds and the platform type names that map to them. A census may also carry `kind`
// directly; then `type` is ignored.
const KINDS = {
  text: ['text', 'textbox', 'input', 'string', 'singleline'],
  textarea: ['textarea', 'multiline', 'memo', 'longtext'],
  richtext: ['richtext', 'rte', 'editor', 'htmleditor'],
  number: ['number', 'numeric', 'integer', 'decimal'],
  money: ['money', 'currency'],
  date: ['date', 'datepicker'],
  datetime: ['datetime', 'datetimepicker'],
  time: ['time', 'timepicker'],
  email: ['email'],
  phone: ['phone', 'tel', 'telephone'],
  dropdown: ['dropdown', 'dropdownlist', 'select', 'combobox', 'combo', 'ddl', 'lookup', 'picklist'],
  typeahead: ['typeahead', 'autocomplete', 'searchlookup', 'lookupsearch'],
  radio: ['radio', 'radiogroup', 'radiolist', 'radiobuttonlist', 'radiobuttons'],
  checkbox: ['checkbox'],
  checkboxlist: ['checkboxlist', 'checkboxgroup', 'checkboxes'],
  file: ['file', 'fileupload', 'upload', 'attachment'],
  button: ['button'],
  link: ['link', 'hyperlink', 'anchor'],
  grid: ['grid', 'datagrid', 'gridview', 'table'],
  static: ['static', 'statictext', 'literal', 'label', 'textblock', 'html', 'note', 'instructions'],
  heading: ['heading', 'header', 'title', 'sectionheader'],
  image: ['image', 'img', 'logo'],
  layout: ['section', 'panel', 'group', 'spacer', 'divider', 'container'],
};
const KIND_OF = new Map();
for (const [kind, names] of Object.entries(KINDS)) for (const n of names) KIND_OF.set(n, kind);

const INPUT = new Set(['text', 'textarea', 'richtext', 'number', 'money', 'date', 'datetime', 'time', 'email', 'phone',
  'dropdown', 'typeahead', 'radio', 'checkbox', 'checkboxlist', 'file']);
const CHOICE = new Set(['dropdown', 'radio', 'checkboxlist']);
const GROUP = new Set(['radio', 'checkboxlist']);
const ACTION = new Set(['button', 'link']);
const INTERACTIVE = new Set([...INPUT, ...ACTION]);
const TEXTUAL = new Set([...INPUT, ...ACTION, 'static', 'heading']);
const GRID = new Set(['grid']);
const DROPDOWN = new Set(['dropdown']);

const GENERIC_BUTTONS = new Set(['ok', 'yes', 'no', 'submit']);
const EXIT_LABEL = /^(?:cancel|close|back|exit|discard|go back|previous)\b/i;
const MARKER = /^\s*\*|\*\s*:?\s*$|\(\s*required\s*\)/i;
const AS_EMPTY = /\bas-empty\b|\bshown as empty\b|\bsame as (?:the )?empty\b/i;
const IMAGE = /[^./\\]\.(?:png|jpe?g|gif|webp|bmp)$/i; // a name before the extension, so prose about ".png" is not a file
const REPORT_NAME = /(?:^|[^a-z])(?:auditor|ux-?audit|ux-?report|verdict|merged)(?:[^a-z]|$)/i;
// The last part of a two-part CamelCase token that marks a database or field name (FirstName, StatusId), so that
// place and product names such as DeKalb, McHenry or PayPal are not flagged.
const FIELD_SUFFIX = new Set(['id', 'ids', 'code', 'cd', 'date', 'dt', 'flag', 'ind', 'num', 'no', 'nbr', 'number',
  'key', 'type', 'name', 'desc', 'text', 'value', 'val', 'amt', 'amount', 'count', 'cnt', 'status', 'guid', 'fk', 'pk']);

// Output cites ids and positions, never values. These patterns are a backstop over everything written or printed.
// A bare run of ten digits is not matched: row Ids and CHECKSUM values look exactly like that.
const PERSONAL_DATA = [
  /[A-Za-z0-9][A-Za-z0-9._%+-]*@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g,
  /(?<![\d-])\d{3}-\d{2}-\d{4}(?![\d-])/g,
  /(?<![\d-])(?:\+?1[ .-]?)?(?:\([2-9]\d{2}\) ?|[2-9]\d{2}[ .-])[2-9]\d{2}[ .-]\d{4}(?![\d-])/g,
];

class CouldNotRun extends Error {}

const has = (o, k) => o !== null && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isText = (v) => typeof v === 'string' && v.trim() !== '';
const isBool = (v) => typeof v === 'boolean';
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isBox = (v) => isObj(v) && ['x', 'y', 'w', 'h'].every((k) => isNum(v[k])) && v.w >= 0 && v.h >= 0;
const textOrNull = (v) => v === null || typeof v === 'string';
const px = (v) => String(Math.round(v * 10) / 10);
const quote = (s) => {
  const t = String(s).replace(/\s+/g, ' ').trim();
  return '"' + (t.length > 60 ? t.slice(0, 57) + '...' : t) + '"';
};
const list = (xs) => (xs.length < 2 ? xs.join('') : xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1]);

// Which census fields count as recorded, and in what shape. A field in the wrong shape counts as absent.
const FIELDS = {
  label: textOrNull, help: textOrNull, placeholder: textOrNull, ariaLabel: textOrNull,
  visible: isBool, required: isBool, readOnly: isBool, requiredMarker: isBool, labelVisible: isBool, hasValue: isBool,
  options: (v) => (Number.isInteger(v) && v >= 0) || Array.isArray(v),
  theme: isText, section: isText, field: isText, dependsOn: isText,
  box: isBox, box375: isBox,
  fontSize: (v) => isNum(v) && v > 0,
  text: (v) => isObj(v) && isNum(v.need) && isNum(v.have),
  optionW: (v) => isNum(v) && v >= 0,
};
const hasField = (raw, f) => has(raw, f) && FIELDS[f](raw[f]);
const optionCount = (raw) => (Array.isArray(raw.options) ? raw.options.length : raw.options); // contents never read

function kindOf(raw) {
  const v = has(raw, 'kind') ? raw.kind : raw.type;
  if (!isText(v)) return undefined;                                // not recorded
  return KIND_OF.get(v.toLowerCase().replace(/[^a-z]/g, '')) || null; // null: not in the contract vocabulary
}

// A label as a reader compares it: no required marker, no trailing colon, single spaces. Empty if no letter or digit.
function bare(s) {
  if (typeof s !== 'string') return '';
  const t = s.replace(/\(\s*required\s*\)/gi, ' ').replace(/\*/g, ' ').replace(/\s+/g, ' ').trim().replace(/\s*:$/, '').trim();
  return /[\p{L}\p{N}]/u.test(t) ? t : '';
}
const keyOf = (s) => bare(s).toLowerCase();

function hasPersonalData(s) {
  return typeof s === 'string' && PERSONAL_DATA.some((re) => { re.lastIndex = 0; return re.test(s); });
}

function redactText(s, counter) {
  let out = s;
  for (const re of PERSONAL_DATA) {
    re.lastIndex = 0;
    out = out.replace(re, () => { counter.n++; return '[withheld]'; });
  }
  return out;
}

function redactDeep(v, counter) {
  if (typeof v === 'string') return redactText(v, counter);
  if (Array.isArray(v)) return v.map((x) => redactDeep(x, counter));
  if (isObj(v)) {
    const o = {};
    for (const k of Object.keys(v)) o[k] = redactDeep(v[k], counter);
    return o;
  }
  return v;
}

// ---------- reading the markdown files ----------

function cells(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  return s.split(/(?<!\\)\|/).map((c) => c.replace(/\\\|/g, '|').trim());
}
const cleanCell = (c) => c.replace(/[`*]/g, '').trim();
const isTableRow = (l) => l.includes('|') && l.trim() !== '';
const isSeparator = (l) => /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(l);

// The first markdown table whose header holds every named column, with each body row and its line number.
function findTable(text, cols) {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length - 1; i++) {
    if (!isTableRow(lines[i]) || !isSeparator(lines[i + 1])) continue;
    const header = cells(lines[i]).map((c) => cleanCell(c).toLowerCase());
    const rows = [];
    let j = i + 2;
    for (; j < lines.length && isTableRow(lines[j]) && !isSeparator(lines[j]); j++) rows.push({ line: j + 1, cells: cells(lines[j]) });
    if (cols.every((c) => header.includes(c))) {
      const col = (name, row) => { const k = header.indexOf(name); return k >= 0 && k < row.cells.length ? row.cells[k] : ''; };
      return { line: i + 1, header, rows, col };
    }
    i = j - 1;
  }
  return null;
}

function normRel(ref) {
  return String(ref).replace(/\\/g, '/').replace(/^(?:\.\/)+/, '');
}
const outsidePack = (ref) => /^(?:\/|[A-Za-z]:)/.test(ref) || ref.split('/').includes('..');

// Image file names on one line: backtick-quoted names (which may hold spaces) and bare tokens. URLs are skipped.
function imageRefs(line) {
  const out = [];
  const rest = line.replace(/`([^`]+)`/g, (m, inner) => { if (IMAGE.test(inner.trim())) out.push(inner.trim()); return ' '; });
  for (let tok of rest.split(/[\s|()<>[\]"'!,;]+/)) {
    tok = tok.replace(/[.:]+$/, '');
    if (tok.includes('://') || !IMAGE.test(tok)) continue;
    out.push(tok);
  }
  return out.map(normRel);
}

function waiverLine(plain) {
  const m = /^\s*(?:[-*+]\s+)?lint-waive\s+([A-Za-z0-9-]+)(?:\s+([^\s:]+))?\s*:\s*(.*?)\s*$/i.exec(plain);
  return m ? { check: m[1].toLowerCase(), widget: m[2] || null, reason: m[3] } : null;
}

function parseTarget(text) {
  const out = { captures: [], shots: [], waivers: [], states: null };
  const seen = new Set();
  let inFixed = false;
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = i + 1;
    const plain = raw.replace(/`/g, '').replace(/\*\*|__/g, '');
    const heading = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/.exec(plain);
    if (heading) inFixed = /\bfixed constraints?\b/i.test(heading[1]);
    else if (/^\s*fixed constraints?\s*:?\s*$/i.test(plain)) inFixed = true;
    const cap = /^\s*(?:[-*+]\s+|#{1,6}\s+)?capture\s*:\s*(.*?)\s*#*\s*$/i.exec(plain);
    if (cap) {
      const v = cap[1].toUpperCase().replace(/\s+/g, ' ');
      out.captures.push({ line, mode: /^LIVE WALK\b/.test(v) ? 'LIVE WALK' : /^REPLICA ONLY\b/.test(v) ? 'REPLICA ONLY' : 'unknown' });
    }
    const wv = waiverLine(plain);
    if (wv) out.waivers.push(Object.assign(wv, { line, inFixed }));
    for (const ref of imageRefs(raw)) {
      if (seen.has(ref)) continue;
      seen.add(ref);
      out.shots.push({ ref, line, outside: outsidePack(ref) });
    }
  });
  const t = findTable(text, ['surface', 'state', 'screenshot']);
  if (t) {
    out.states = { line: t.line, rows: t.rows.map((r) => {
      const shotCell = t.col('screenshot', r);
      const refs = imageRefs(shotCell);
      return {
        line: r.line,
        surface: cleanCell(t.col('surface', r)).toLowerCase(),
        state: cleanCell(t.col('state', r)).toLowerCase(),
        shot: refs.length ? refs[0] : '',
        shows: t.col('shows', r),
      };
    }) };
  }
  return out;
}

function parseKeyboard(text) {
  const t = findTable(text, ['step', 'key', 'widget', 'result']);
  if (!t) return null;
  return t.rows.map((r) => {
    const widget = cleanCell(t.col('widget', r));
    return { line: r.line, step: cleanCell(t.col('step', r)), key: cleanCell(t.col('key', r)),
      widget: /^(?:-+|—|none|n\/a)?$/i.test(widget) ? '' : widget, result: cleanCell(t.col('result', r)) };
  });
}

function parseClient(text) {
  const out = { themes: null, waivers: [] };
  text.split(/\r?\n/).forEach((raw, i) => {
    const plain = raw.replace(/`/g, '').replace(/\*\*|__/g, '');
    const th = /^\s*(?:[-*+]\s+)?lint-themes\s*:\s*(.*?)\s*$/i.exec(plain);
    if (th) {
      const names = th[1].split(',').map((s) => s.trim()).filter(Boolean);
      if (names.length) out.themes = (out.themes || []).concat(names);
    }
    const wv = waiverLine(plain);
    if (wv) {
      const proven = /^proven\s*:\s*(.*)$/i.exec(wv.reason);
      out.waivers.push(Object.assign(wv, { line: i + 1, proven: Boolean(proven), reason: proven ? proven[1] : wv.reason }));
    }
  });
  return out;
}

// A file in the pack that is an earlier report: by name, or by the shape of an auditor's JSON. The lint's own
// mechanical.json is overwritten each run and is judged by its content only.
function looksLikeReport(relPath, json) {
  const rel = normRel(relPath);
  if (rel.toLowerCase() !== OUTPUT && REPORT_NAME.test(rel)) return 'its name marks it as a report';
  if (isObj(json) && (has(json, 'verdict') || has(json, 'gates'))) return 'it holds a verdict or gates, the shape of an auditor report';
  return null;
}

// ---------- the census ----------

function checkCensus(c) {
  if (!isObj(c) || !Array.isArray(c.widgets)) {
    throw new CouldNotRun('census.json needs a top-level object with a widgets array (see references/census-contract.md)');
  }
  const seen = new Map();
  c.widgets.forEach((w, i) => {
    if (!isObj(w)) throw new CouldNotRun('census.json widgets[' + i + '] is not an object');
    const ok = (typeof w.id === 'string' && w.id.trim() !== '') || isNum(w.id);
    if (!ok) throw new CouldNotRun('census.json widgets[' + i + '] has no id; every finding cites a widget id');
    const k = String(w.id).trim();
    if (seen.has(k)) throw new CouldNotRun('census.json widgets[' + i + '].id repeats widgets[' + seen.get(k) + '].id');
    seen.set(k, i);
  });
}

const cite = (w, f) => 'census widgets[' + w.i + '].' + f;

function atWidget(w, extra) {
  const where = { widget: w.id, census: 'widgets[' + w.i + ']' };
  if (isText(w.raw.field)) where.field = w.raw.field.trim();
  if (isText(w.raw.section)) where.section = w.raw.section.trim();
  return Object.assign(where, extra || {});
}

function atFooter(b, i) {
  const where = { census: 'footer[' + i + ']' };
  if (isText(b.id)) where.widget = b.id.trim();
  return where;
}

const notChecked = (missing) => ({ notChecked: true, findings: [], unchecked: [], missing: new Set(missing) });
const fresh = () => ({ findings: [], unchecked: [], missing: new Set() });
function unchecked(r, id, lack) { r.unchecked.push(id); lack.forEach((m) => r.missing.add(m)); }

// Visits every widget a check could apply to. A widget that lacks a field the check needs is counted as
// unchecked, never as passing, so a thin census cannot produce a clean result.
function scan(ctx, spec, visit) {
  const r = fresh();
  for (const w of ctx.widgets) {
    if (spec.kinds) {
      if (w.kind === undefined) { unchecked(r, w.id, ['widget.type']); continue; }
      if (w.kind === null) { unchecked(r, w.id, ['widget.type (not in the contract vocabulary)']); continue; }
      if (!spec.kinds.has(w.kind)) continue;
    }
    const lackPre = (spec.pre || []).filter((f) => !hasField(w.raw, f));
    if (lackPre.length) { unchecked(r, w.id, lackPre.map((f) => 'widget.' + f)); continue; }
    if (spec.applies && !spec.applies(w)) continue;
    const lack = (spec.needs || []).filter((f) => !hasField(w.raw, f));
    if (lack.length) { unchecked(r, w.id, lack.map((f) => 'widget.' + f)); continue; }
    visit(w, r);
  }
  return r;
}

const shown = (w) => w.raw.visible === true;
const editable = (w) => w.raw.visible === true && w.raw.readOnly !== true;

function isFilled(raw) {
  if (isBool(raw.hasValue)) return raw.hasValue;
  if (!has(raw, 'value')) return null;
  const v = raw.value;                    // read only to test for emptiness; never copied into the output
  if (v === null || v === undefined) return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'string') return v.trim() !== '';
  return true;
}

function marked(raw) {
  if (isBool(raw.requiredMarker)) return raw.requiredMarker;
  if (typeof raw.label === 'string') return MARKER.test(raw.label);
  return null;
}

function internalName(s) {
  if (typeof s !== 'string') return null;
  for (const tok of s.split(/[^A-Za-z0-9_]+/)) {
    if (/[A-Za-z0-9]_[A-Za-z0-9]/.test(tok)) return { token: tok, rule: 'underscore' };
    const parts = tok.split(/(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/);
    if (parts.length >= 3 || (parts.length === 2 && FIELD_SUFFIX.has(parts[1].toLowerCase()))) return { token: tok, rule: 'camel' };
  }
  return null;
}

const centre = (b) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
const small = (b) => b.w < TARGET_PX || b.h < TARGET_PX;
function distToBox(p, b) {
  const dx = Math.max(b.x - p.x, 0, p.x - (b.x + b.w));
  const dy = Math.max(b.y - p.y, 0, p.y - (b.y + b.h));
  return Math.hypot(dx, dy);
}
// WCAG 2.2 spacing test: a 24px circle on the target's centre touches no other target and no other small
// target's circle.
function spaced(w, targets) {
  const c = centre(w.raw.box);
  for (const o of targets) {
    if (o === w) continue;
    const b = o.raw.box;
    if (small(b) ? Math.hypot(c.x - centre(b).x, c.y - centre(b).y) < TARGET_PX : distToBox(c, b) < TARGET_PX / 2) return false;
  }
  return true;
}

// Focus moving from box p to box n goes against the visual order when it goes right to left within a row, or up
// the page other than into the next column to the right.
function backward(p, n) {
  const tol = Math.max(8, Math.min(p.h, n.h) / 2);
  if (Math.abs(n.y - p.y) <= tol) return n.x + SLACK_PX < p.x;
  if (n.y < p.y) return !(n.x >= p.x + p.w - SLACK_PX);
  return false;
}

function keyboardRows(ctx) {
  if (!ctx.keyboard) return notChecked(['keyboard.md']);
  if (!ctx.keyboard.rows) return notChecked(['keyboard.md table with step, key, widget and result columns']);
  return { rows: ctx.keyboard.rows };
}

// ---------- the checks ----------

const CHECKS = [
  {
    id: 'staging', title: 'The pack is staged for an audit', severity: 'critical', area: 'proof_gate',
    informs: 'proof gate', source: 'V', waivable: false,
    needs: ['target.md Capture line', 'every screenshot target.md names', 'the pack file list'],
    run(ctx, F) {
      const r = fresh();
      const t = ctx.target;
      const why = 'An unstaged pack wastes an auditor run: the auditor returns "not staged" or scores holes.';
      if (!t) {
        r.findings.push(F('critical', 'gap', { file: 'target.md' }, 'target.md is missing',
          'The pack has no target.md, so the capture mode, the task and what each button does are unknown.',
          why, 'Stage the pack again with target.md.'));
      } else {
        const modes = [...new Set(t.captures.map((c) => c.mode))];
        const first = t.captures[0];
        if (!first) {
          r.findings.push(F('critical', 'gap', { file: 'target.md' }, 'target.md has no Capture line',
            'No line reads "Capture: LIVE WALK" or "Capture: REPLICA ONLY".', why, 'Add the Capture line.'));
        } else if (modes.length > 1) {
          r.findings.push(F('critical', 'gap', { file: 'target.md', line: first.line }, 'Capture lines disagree',
            'target.md lines ' + list(t.captures.map((c) => String(c.line))) + ' name different capture modes.', why,
            'Keep one Capture line that says how this pack was captured.'));
        } else if (modes[0] === 'unknown') {
          r.findings.push(F('critical', 'gap', { file: 'target.md', line: first.line }, 'Capture mode not recognised',
            'target.md line ' + first.line + ' names neither LIVE WALK nor REPLICA ONLY.', why,
            'Write "Capture: LIVE WALK" or "Capture: REPLICA ONLY".'));
        } else if (modes[0] === 'REPLICA ONLY') {
          r.findings.push(F('major', 'gap', { file: 'target.md', line: first.line }, 'Capture is REPLICA ONLY',
            'target.md line ' + first.line + ' reads REPLICA ONLY.',
            'The auditor scores a replica, but the gate passes only on a live walk.',
            'Walk the form live on STAGE when it can be reached; until then this pack cannot pass the gate.'));
        }
        for (const s of t.shots) {
          if (s.outside) {
            r.findings.push(F('critical', 'gap', { file: 'target.md', line: s.line, screenshot: s.ref },
              'Screenshot path leaves the pack', 'target.md line ' + s.line + ' names a screenshot outside the pack folder.',
              why, 'Copy the screenshot into the pack and name it relative to the pack folder.'));
          } else if (!ctx.exists(s.ref)) {
            r.findings.push(F('critical', 'gap', { file: 'target.md', line: s.line, screenshot: s.ref },
              'Screenshot named in target.md is missing', 'target.md line ' + s.line + ' names a screenshot the pack does not hold.',
              why, 'Add the screenshot or correct its name.'));
          }
        }
      }
      for (const rep of ctx.reports) {
        r.findings.push(F('critical', 'gap', { file: rep.path }, 'The pack holds an earlier report', rep.path + ': ' + rep.reason + '.',
          'The auditor is never shown an earlier score or report, and returns "not staged" when it finds one.',
          'Stage a fresh pack for this iteration; keep earlier reports outside it.'));
      }
      if (ctx.truncated) unchecked(r, 'pack', ['the pack file list (over ' + MAX_FILES + ' files or ' + MAX_WALK_DEPTH + ' folders deep)']);
      return r;
    },
  },
  {
    id: 'unlabelled-field', title: 'Every input has a visible label', severity: 'major', area: 'words',
    informs: 'field labels', source: 'U',
    needs: ['widget.type', 'widget.visible', 'widget.label'], uses: ['widget.labelVisible', 'widget.placeholder', 'widget.ariaLabel'],
    run(ctx, F) {
      return scan(ctx, { kinds: INPUT, pre: ['visible'], applies: shown, needs: ['label'] }, (w, r) => {
        const label = bare(w.raw.label);
        const visible = w.raw.labelVisible !== false;
        if (label && visible) return;
        let title;
        let evidence;
        if (label) { title = 'Label is recorded but not shown'; evidence = cite(w, 'label') + ' is set, but labelVisible is false.'; }
        else if (bare(w.raw.placeholder)) { title = 'Placeholder is the only label'; evidence = cite(w, 'label') + ' is empty; only a placeholder names the field.'; }
        else if (bare(w.raw.ariaLabel)) { title = 'Named only by aria-label'; evidence = cite(w, 'label') + ' is empty; only aria-label names the field, and aria-label is never visible.'; }
        else { title = 'Field has no visible label'; evidence = cite(w, 'label') + ' is empty.'; }
        r.findings.push(F('major', 'defect', atWidget(w), title, evidence,
          'A placeholder disappears as the user types and aria-label is never seen, so the user cannot tell what the field wants (WCAG 2.1 SC 1.3.1 and 3.3.2).',
          'Give the field a visible label next to it.'));
      });
    },
  },
  {
    id: 'duplicate-label', title: 'No two inputs share a label', severity: 'major', area: 'words',
    informs: 'field labels', source: 'U', needs: ['widget.type', 'widget.visible', 'widget.label'], uses: ['widget.section'],
    run(ctx, F) {
      const groups = new Map();
      const r = scan(ctx, { kinds: INPUT, pre: ['visible'], applies: shown, needs: ['label'] }, (w) => {
        const k = keyOf(w.raw.label);
        if (!k || w.raw.labelVisible === false) return; // unlabelled-field reports these
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(w);
      });
      for (const ws of groups.values()) {
        if (ws.length < 2) continue;
        const secs = ws.map((w) => (isText(w.raw.section) ? w.raw.section.trim().toLowerCase() : null));
        const apart = secs.every((s) => s !== null) && new Set(secs).size === ws.length;
        const ids = ws.map((w) => w.id);
        r.findings.push(F(apart ? 'minor' : 'major', 'defect',
          { widget: ids[0], widgets: ids, census: ws.map((w) => 'widgets[' + w.i + ']').join(', ') },
          'Inputs share the label ' + quote(bare(ws[0].raw.label)),
          ws.length + ' inputs (' + list(ids) + ') carry the same label' + (apart ? ', each in a different section.'
            : secs.includes(null) ? '; not every one has a section recorded.' : ', two of them in the same section.'),
          apart ? 'The section heading separates them for sighted users, but a screen reader announces the same name for each.'
            : 'The user cannot tell which field is which, and a screen reader announces the same name for each.',
          'Name each field for its own content, for example by adding the section or the role to the label.'));
      }
      return r;
    },
  },
  {
    id: 'repeated-text', title: 'No text repeats three or more times in one section', severity: 'minor', area: 'words',
    informs: 'repeated text', source: 'U', needs: ['widget.visible', 'widget.label', 'widget.section'], uses: ['widget.help'],
    run(ctx, F) {
      const sections = new Map();
      const r = scan(ctx, { pre: ['visible'], applies: shown, needs: ['label', 'section'] }, (w) => {
        const sec = w.raw.section.trim();
        const k = sec.toLowerCase();
        if (!sections.has(k)) sections.set(k, { name: sec, texts: new Map() });
        const texts = sections.get(k).texts;
        const own = new Map();
        const label = keyOf(w.raw.label);
        if (label.length >= 2) own.set(label, INPUT.has(w.kind) && w.raw.labelVisible !== false ? 'input label' : 'text');
        const help = keyOf(w.raw.help);
        if (help.length >= 2 && !own.has(help)) own.set(help, 'help');
        for (const [t, slot] of own) {
          if (!texts.has(t)) texts.set(t, []);
          texts.get(t).push({ w, slot });
        }
      });
      for (const { name, texts } of sections.values()) {
        for (const [t, hits] of texts) {
          // Three inputs with one label are a duplicate-label finding; report here only text that is not all labels.
          if (hits.length < 3 || hits.every((h) => h.slot === 'input label')) continue;
          const ids = hits.map((h) => h.w.id);
          r.findings.push(F('minor', 'defect', { widget: ids[0], widgets: ids, section: name },
            'The same text appears ' + hits.length + ' times in one section',
            'Section ' + quote(name) + ': ' + quote(t) + ' is the label or help text of ' + list(ids) + '.',
            'Text repeated into every slot reads as noise and hides the one place it matters.',
            'Say it once, at the section level or on the one field it belongs to.'));
        }
      }
      return r;
    },
  },
  {
    id: 'generic-button', title: 'Footer buttons name their action', severity: 'minor', area: 'actions',
    informs: 'button wording', source: 'U', needs: ['census.footer[].label'],
    run(ctx, F) {
      if (!ctx.footer) return notChecked(['census.footer']);
      const r = fresh();
      ctx.footer.forEach((b, i) => {
        if (isObj(b) && b.visible === false) return;
        if (!isObj(b) || typeof b.label !== 'string') { unchecked(r, 'footer[' + i + ']', ['census.footer[].label']); return; }
        const k = b.label.trim().replace(/[.!:]+$/, '').toLowerCase();
        if (!GENERIC_BUTTONS.has(k)) return;
        r.findings.push(F('minor', 'defect', atFooter(b, i), 'Footer button says only ' + quote(b.label.trim()),
          'census footer[' + i + '].label is ' + quote(b.label.trim()) + '.',
          'OK, Yes, No and Submit name a gesture, not an outcome, so the user has to guess what happens.',
          'Name the action and its object, for example "Submit renewal" or "Approve license".'));
      });
      return r;
    },
  },
  {
    id: 'footer-count', title: 'Three footer buttons or fewer', severity: 'minor', area: 'actions',
    informs: 'footer actions', source: 'U', needs: ['census.footer'],
    run(ctx, F) {
      if (!ctx.footer) return notChecked(['census.footer']);
      const r = fresh();
      const visible = ctx.footer.filter((b) => !(isObj(b) && b.visible === false));
      if (visible.length > 3) {
        r.findings.push(F('minor', 'defect', { census: 'footer' }, 'Footer has ' + visible.length + ' buttons',
          'census footer lists ' + visible.length + ' visible buttons.',
          'Past three actions at one decision point the user has to hold too much in mind; one primary and one or two secondary is the norm.',
          'Keep one primary and one or two secondary actions; move the rest into the form body or a menu.'));
      }
      return r;
    },
  },
  {
    id: 'footer-exit', title: 'The form has a way out', severity: 'major', area: 'actions',
    informs: 'a way out', source: 'U', needs: ['census.footer[].label'], uses: ['census.closeControl', 'widget.type', 'widget.label'],
    run(ctx, F) {
      if (!ctx.footer) return notChecked(['census.footer']);
      const labels = [];
      const r = scan(ctx, { kinds: ACTION, pre: ['visible'], applies: shown, needs: ['label'] }, (w) => labels.push(w.raw.label));
      ctx.footer.forEach((b, i) => {
        if (isObj(b) && b.visible === false) return;
        if (!isObj(b) || typeof b.label !== 'string') { unchecked(r, 'footer[' + i + ']', ['census.footer[].label']); return; }
        labels.push(b.label);
      });
      if (ctx.census.closeControl === true || labels.some((l) => EXIT_LABEL.test(l.trim()))) return { findings: [], unchecked: [], missing: new Set() };
      if (r.unchecked.length) return r; // the exit may be among the widgets that could not be read
      r.findings.push(F('major', 'defect', { census: 'footer' }, 'No way out of the form',
        'No visible footer or body button starts with Cancel, Close, Back, Exit, Discard, Go back or Previous, and census closeControl is not true.',
        'A user who opened the form by mistake can leave only by saving or through the browser.',
        'Add a Cancel or Close button that leaves without saving.'));
      return r;
    },
  },
  {
    id: 'choice-overload', title: 'Radio and checkbox groups stay small', severity: 'major', area: 'widget_fit',
    informs: 'choice size', source: 'U', needs: ['widget.type', 'widget.visible', 'widget.options'], uses: ['widget.readOnly'],
    run(ctx, F) {
      return scan(ctx, { kinds: GROUP, pre: ['visible'], applies: editable, needs: ['options'] }, (w, r) => {
        const n = optionCount(w.raw);
        if (n < 5) return;
        const many = n >= 8;
        r.findings.push(F(many ? 'major' : 'advisory', 'defect', atWidget(w), 'Choice group has ' + n + ' options',
          cite(w, 'options') + ' is ' + n + ' on a ' + (w.kind === 'radio' ? 'radio group' : 'checkbox list') + '.',
          many ? 'Eight or more options at one decision point overload working memory; users skip, misclick or give up.'
            : 'Five to seven options push the working-memory limit; this is advisory and costs no points by itself.',
          many ? 'Use a dropdown or typeahead, or split the options into groups.' : 'Consider grouping, or a dropdown if the list will grow.'));
      });
    },
  },
  {
    id: 'dropdown-options', title: 'Lists are not empty', severity: 'critical', area: 'widget_fit',
    informs: 'lookup lists', source: 'V', needs: ['widget.type', 'widget.visible', 'widget.options'], uses: ['widget.readOnly', 'widget.dependsOn'],
    run(ctx, F) {
      return scan(ctx, { kinds: CHOICE, pre: ['visible'], applies: editable, needs: ['options'] }, (w, r) => {
        const n = optionCount(w.raw);
        const parent = isText(w.raw.dependsOn) ? w.raw.dependsOn.trim() : null;
        if (n === 0 && parent) {
          r.findings.push(F('advisory', 'defect', atWidget(w), 'Dependent list is empty at capture',
            cite(w, 'options') + ' is 0 and the list fills from widget ' + parent + '.',
            'A list that fills from another field is empty until that field is chosen; this costs no points by itself.',
            'Check the populated-state capture; if the list is still empty there, treat it as an empty lookup.'));
        } else if (n === 0) {
          r.findings.push(F('critical', 'defect', atWidget(w), 'List has no options', cite(w, 'options') + ' is 0.',
            'An empty list is usually an inactive or empty lookup failing silently, and the user cannot complete the field.',
            'Check the lookup rows and their active flag, and the procedure parameters, on STAGE.'));
        } else if (n === 1 && w.kind === 'dropdown' && !parent) {
          r.findings.push(F('minor', 'defect', atWidget(w), 'Dropdown has one option', cite(w, 'options') + ' is 1.',
            'A one-option dropdown asks for a choice that does not exist, or hides missing lookup rows.',
            'Check the lookup for missing rows; if one option is right, preselect it and show it as text.'));
        }
      });
    },
  },
  {
    id: 'required-blocked', title: 'Required fields can be filled', severity: 'critical', area: 'task_flow',
    informs: 'required fields reachable', source: 'V', needs: ['widget.type', 'widget.required', 'widget.visible', 'widget.readOnly'],
    uses: ['widget.hasValue', 'widget.value (emptiness only)'],
    run(ctx, F) {
      return scan(ctx, { kinds: INPUT, pre: ['required'], applies: (w) => w.raw.required === true, needs: ['visible', 'readOnly'] }, (w, r) => {
        if (w.raw.visible && !w.raw.readOnly) return;
        const filled = isFilled(w.raw);
        if (filled === true) return;
        const how = !w.raw.visible ? 'hidden' : 'read-only';
        if (filled === false) {
          r.findings.push(F('critical', 'defect', atWidget(w), 'Required field is ' + how + ' and empty',
            cite(w, 'required') + ' is true, ' + (!w.raw.visible ? cite(w, 'visible') + ' is false' : cite(w, 'readOnly') + ' is true') + ', and it has no value.',
            'The user cannot fill it, so the save is refused or, on this platform, fails silently: the task is blocked.',
            'Make it visible and editable, give it a default, or clear the required flag if the platform fills it later.'));
        } else {
          r.findings.push(F('major', 'gap', atWidget(w), 'Required field is ' + how + '; fill state unknown',
            cite(w, 'required') + ' is true and the census records neither hasValue nor value.',
            'If nothing fills it, the user cannot complete the task.',
            'Record hasValue in the census, or confirm on STAGE that the platform fills it.'));
        }
      });
    },
  },
  {
    id: 'required-markers', title: 'Required markers are consistent', severity: 'major', area: 'words',
    informs: 'required markers', source: 'U', needs: ['widget.type', 'widget.visible', 'widget.required', 'widget.requiredMarker or widget.label'],
    run(ctx, F) {
      const req = [];
      const opt = [];
      const r = scan(ctx, { kinds: INPUT, pre: ['visible', 'required'], applies: editable }, (w, rr) => {
        const m = marked(w.raw);
        if (m === null) { unchecked(rr, w.id, ['widget.requiredMarker or widget.label']); return; }
        (w.raw.required ? req : opt).push({ w, m });
      });
      const markedReq = req.filter((x) => x.m).length;
      if (markedReq) {
        for (const { w } of req.filter((x) => !x.m)) {
          r.findings.push(F('major', 'defect', atWidget(w), 'Required field has no marker',
            cite(w, 'required') + ' is true and no marker shows, while ' + markedReq + ' other required field(s) show one.',
            'Users take the marker as the rule, so they skip an unmarked required field and the save is refused or fails silently.',
            'Mark every required field the same way.'));
        }
      }
      for (const { w } of opt.filter((x) => x.m)) {
        r.findings.push(F('minor', 'defect', atWidget(w), 'Optional field shows a required marker',
          cite(w, 'required') + ' is false and a required marker shows.',
          'The marker promises a rule the form does not enforce, which teaches users to ignore it.',
          'Remove the marker, or make the field required if it is.'));
      }
      return r;
    },
  },
  {
    id: 'theme-approved', title: 'Themes are on the approved list', severity: 'major', area: 'visual_restraint',
    informs: 'approved themes', source: 'V', needs: ['client-block.md lint-themes line', 'widget.visible', 'widget.theme'],
    run(ctx, F) {
      if (!ctx.client) return notChecked(['client-block.md']);
      if (!ctx.client.themes) return notChecked(['client-block.md lint-themes line']);
      const approved = new Set(ctx.client.themes.map((t) => t.toLowerCase()));
      const off = new Map();
      const r = scan(ctx, { pre: ['visible'], applies: shown, needs: ['theme'] }, (w) => {
        const t = w.raw.theme.trim();
        if (approved.has(t.toLowerCase())) return;
        if (!off.has(t.toLowerCase())) off.set(t.toLowerCase(), { name: t, ws: [] });
        off.get(t.toLowerCase()).ws.push(w);
      });
      for (const { name, ws } of off.values()) {
        const ids = ws.map((w) => w.id);
        r.findings.push(F('major', 'defect', { widget: ids[0], widgets: ids }, 'Theme ' + quote(name) + ' is not on the approved list',
          ws.length + ' widget(s) (' + list(ids) + ') use it; client-block.md approves ' + list(ctx.client.themes) + '.',
          'The client approved a fixed set of themes; one outside it has not been signed off and may not have been checked for contrast.',
          'Switch these widgets to an approved theme, or get the theme added to the client block.'));
      }
      return r;
    },
  },
  {
    id: 'theme-mixed', title: 'One theme per form', severity: 'minor', area: 'visual_restraint',
    informs: 'one theme per form', source: 'V', needs: ['widget.visible', 'widget.theme'],
    run(ctx, F) {
      const used = new Map();
      const r = scan(ctx, { pre: ['visible'], applies: shown, needs: ['theme'] }, (w) => {
        const t = w.raw.theme.trim();
        if (!used.has(t.toLowerCase())) used.set(t.toLowerCase(), { name: t, ws: [] });
        used.get(t.toLowerCase()).ws.push(w);
      });
      if (used.size >= 2) {
        const sorted = [...used.values()].sort((a, b) => b.ws.length - a.ws.length);
        const rest = sorted.slice(1).flatMap((x) => x.ws.map((w) => w.id));
        r.findings.push(F('minor', 'defect', { widget: rest[0], widgets: rest }, 'Form mixes ' + used.size + ' themes',
          'Themes in use: ' + list(sorted.map((x) => quote(x.name) + ' (' + x.ws.length + ')')) + '.',
          'Widgets that look different for no reason make the form read as assembled rather than designed.',
          'Use one theme across the form.'));
      }
      return r;
    },
  },
  {
    id: 'small-target', title: 'Interactive targets are at least 24x24 px', severity: 'minor', area: 'responsive_accessible',
    informs: 'target size', source: 'U', needs: ['widget.type', 'widget.visible', 'widget.box'], uses: ['widget.readOnly'],
    run(ctx, F) {
      const targets = [];
      const r = scan(ctx, { kinds: INTERACTIVE, pre: ['visible'], applies: editable, needs: ['box'] }, (w) => {
        if (w.raw.box.w > 0 && w.raw.box.h > 0) targets.push(w); // a zero box was not rendered at this width
      });
      for (const w of targets) {
        const b = w.raw.box;
        if (!small(b) || spaced(w, targets)) continue;
        r.findings.push(F('minor', 'defect', atWidget(w), 'Target is ' + px(b.w) + 'x' + px(b.h) + ' px',
          cite(w, 'box') + ' is under 24x24 px and another target sits inside its 24 px spacing circle.',
          'Small, crowded targets cause misclicks. This is a quality finding, not a WCAG 2.1 AA failure: the 24x24 minimum (SC 2.5.8) is in WCAG 2.2, and 44x44 (SC 2.5.5) is AAA.',
          'Make the control at least 24x24 px, or give it room.'));
      }
      return r;
    },
  },
  {
    id: 'all-caps-text', title: 'No long runs of capitals', severity: 'minor', area: 'words',
    informs: 'readable text', source: 'U', needs: ['widget.visible', 'widget.label'], uses: ['widget.help'],
    run(ctx, F) {
      return scan(ctx, { pre: ['visible'], applies: shown, needs: ['label'] }, (w, r) => {
        for (const slot of ['label', 'help']) {
          if (typeof w.raw[slot] !== 'string') continue;
          const t = w.raw[slot].replace(/\s+/g, ' ').trim();
          const letters = (t.match(/\p{L}/gu) || []).length;
          if (t.length < CAPS_CHARS || letters < 20 || /\p{Ll}/u.test(t)) continue;
          r.findings.push(F('minor', 'defect', atWidget(w), (slot === 'label' ? 'Label' : 'Help text') + ' is a long run of capitals',
            cite(w, slot) + ' is ' + t.length + ' characters with no lowercase letter.',
            'Capitals remove word shapes, so a sentence in capitals reads slowly. Short labels in capitals are a convention and are not flagged.',
            'Write it in sentence case.'));
        }
      });
    },
  },
  {
    id: 'internal-name', title: 'Labels carry no internal names', severity: 'major', area: 'words',
    informs: 'internal names', source: 'U+V', needs: ['widget.visible', 'widget.label'], uses: ['census.footer[].label'],
    run(ctx, F) {
      const add = (r, where, at, label) => {
        const hit = internalName(label);
        if (!hit) return;
        r.findings.push(F('major', 'defect', where, 'Label shows an internal name ' + quote(hit.token),
          at + ': ' + quote(hit.token) + (hit.rule === 'underscore' ? ' joins words with an underscore.' : ' runs words together in CamelCase.'),
          'A database or field name in a label was never written for the user, who has to guess what it means.',
          'Write the label in plain words, for example "License type" for a LicenseTypeId field.'));
      };
      const r = scan(ctx, { pre: ['visible'], applies: shown, needs: ['label'] }, (w, rr) => add(rr, atWidget(w), cite(w, 'label'), w.raw.label));
      (ctx.footer || []).forEach((b, i) => {
        if (isObj(b) && b.visible !== false && typeof b.label === 'string') add(r, atFooter(b, i), 'census footer[' + i + '].label', b.label);
      });
      return r;
    },
  },
  {
    id: 'keyboard-coverage', title: 'The keyboard walk reaches every control', severity: 'major', area: 'responsive_accessible',
    informs: 'keyboard reach', source: 'U', needs: ['keyboard.md table', 'widget.type', 'widget.visible'], uses: ['widget.readOnly', 'census.footer[].id'],
    run(ctx, F) {
      const kb = keyboardRows(ctx);
      if (kb.notChecked) return kb;
      const seen = new Set(kb.rows.map((x) => x.widget).filter(Boolean));
      const why = 'A control the keyboard cannot reach cannot be used without a mouse (WCAG 2.1 SC 2.1.1, Level A).';
      const fix = 'Put the control in the tab order, or walk the form again if the row was missed.';
      const r = scan(ctx, { kinds: INTERACTIVE, pre: ['visible'], applies: editable }, (w, rr) => {
        if (seen.has(w.id)) return;
        rr.findings.push(F('major', 'defect', atWidget(w), 'Never reached in the keyboard walk', 'keyboard.md has no row for widget ' + w.id + '.', why, fix));
      });
      (ctx.footer || []).forEach((b, i) => {
        if (!isObj(b) || b.visible === false || !isText(b.id) || seen.has(b.id.trim())) return;
        r.findings.push(F('major', 'defect', atFooter(b, i), 'Never reached in the keyboard walk', 'keyboard.md has no row for footer button ' + b.id.trim() + '.', why, fix));
      });
      return r;
    },
  },
  {
    id: 'keyboard-order', title: 'Focus follows the visual order', severity: 'major', area: 'responsive_accessible',
    informs: 'focus order', source: 'U', needs: ['keyboard.md table', 'widget.box'],
    run(ctx, F) {
      const kb = keyboardRows(ctx);
      if (kb.notChecked) return kb;
      const r = fresh();
      const visited = new Set();
      let prev = null;
      let pairs = 0;
      for (const row of kb.rows) {
        if (!/^tab$/i.test(row.key) || !row.widget || visited.has(row.widget)) continue; // a revisit is focus wrapping round
        visited.add(row.widget);
        const w = ctx.byId.get(row.widget);
        if (!w) continue; // footer buttons and ids outside the census carry no box
        if (!hasField(w.raw, 'box')) { unchecked(r, w.id, ['widget.box']); continue; }
        if (prev) {
          pairs++;
          const p = prev.w.raw.box;
          const n = w.raw.box;
          if (backward(p, n)) {
            r.findings.push(F('major', 'defect', atWidget(w, { file: 'keyboard.md', line: row.line, step: row.step }), 'Focus jumps against the visual order',
              'keyboard.md step ' + row.step + ': Tab moves from ' + prev.w.id + ' (x ' + px(p.x) + ', y ' + px(p.y) + ') to ' + w.id + ' (x ' + px(n.x) + ', y ' + px(n.y) + ').',
              'Focus that jumps back up or across the form loses keyboard and screen-reader users (WCAG 2.1 SC 2.4.3, Level A).',
              'Order the widgets so the tab order follows the layout, top to bottom and left to right.'));
          }
        }
        prev = { w, row };
      }
      if (!pairs && !r.findings.length) {
        const controls = ctx.widgets.filter((w) => INTERACTIVE.has(w.kind) && w.raw.visible === true && w.raw.readOnly !== true).length;
        if (controls > 1) return notChecked([...r.missing, 'keyboard.md Tab rows on two or more census widgets with a box']);
      }
      return r;
    },
  },
  {
    id: 'keyboard-trap', title: 'No keyboard trap', severity: 'critical', area: 'responsive_accessible',
    informs: 'keyboard trap', source: 'U', needs: ['keyboard.md table'],
    run(ctx, F) {
      const kb = keyboardRows(ctx);
      if (kb.notChecked) return kb;
      const r = fresh();
      for (const row of kb.rows) {
        if (!/^trap(?:ped)?\b/i.test(row.result)) continue;
        const w = row.widget ? ctx.byId.get(row.widget) : null;
        const where = w ? atWidget(w) : (row.widget ? { widget: row.widget } : {});
        r.findings.push(F('critical', 'defect', Object.assign(where, { file: 'keyboard.md', line: row.line, step: row.step }), 'Keyboard trap',
          'keyboard.md step ' + row.step + ' (line ' + row.line + '): focus could not leave ' + (row.widget || 'the control') + '.',
          'A keyboard user stuck in one control cannot finish the task (WCAG 2.1 SC 2.1.2, Level A). A dialog that holds focus until Escape or Close is not a trap.',
          'Let Tab, Shift+Tab or Escape move focus out of the control.'));
      }
      return r;
    },
  },
  {
    id: 'state-captures', title: 'Every state is captured', severity: 'major', area: 'task_flow',
    informs: 'state evidence', source: 'U', needs: ['target.md', 'target.md states table', 'widget.type', 'widget.visible'],
    run(ctx, F) {
      if (!ctx.target) return notChecked(['target.md']);
      const tbl = ctx.target.states;
      const surfaces = [{ name: 'form', w: null }];
      const r = scan(ctx, { kinds: GRID, pre: ['visible'], applies: shown }, (w) => surfaces.push({ name: 'grid:' + w.id, w }));
      for (const s of surfaces) {
        const have = new Set();
        if (tbl) for (const row of tbl.rows) if (row.surface === s.name.toLowerCase() && STATES.includes(row.state) && row.shot) have.add(row.state);
        const missing = STATES.filter((x) => !have.has(x));
        if (!missing.length) continue;
        const sev = missing.includes('populated') || missing.includes('error') ? 'major' : 'minor';
        r.findings.push(F(sev, 'gap', s.w ? atWidget(s.w, { surface: s.name }) : { surface: 'form', file: 'target.md' },
          (s.w ? 'Grid ' + s.w.id : 'Form') + ' has no capture for the ' + list(missing) + ' state' + (missing.length > 1 ? 's' : ''),
          tbl ? 'The target.md states table (line ' + tbl.line + ') has no row with a screenshot for ' + s.name + ' in ' + list(missing) + '.'
            : 'target.md has no states table with surface, state and screenshot columns.',
          'A pack that shows only the populated state proves little; this platform fails silently, so an error that renders as an empty grid stays hidden unless the error state is captured.',
          'Capture the missing states and list them in the states table; for a state STAGE cannot produce, say why in target.md so the auditor records it under verify.'));
      }
      return r;
    },
  },
  {
    id: 'error-as-empty', title: 'Errors are not shown as empty', severity: 'critical', area: 'task_flow',
    informs: 'error states', source: 'U', needs: ['target.md states table'],
    run(ctx, F) {
      if (!ctx.target) return notChecked(['target.md']);
      if (!ctx.target.states) return notChecked(['target.md states table']);
      const r = fresh();
      const rows = ctx.target.states.rows;
      for (const row of rows.filter((x) => x.state === 'error')) {
        const empties = rows.filter((x) => x.surface === row.surface && x.state === 'empty' && x.shot).map((x) => x.shot.toLowerCase());
        const said = AS_EMPTY.test(row.shows || '');
        const same = row.shot && empties.includes(row.shot.toLowerCase());
        if (!said && !same) continue;
        const where = { surface: row.surface, file: 'target.md', line: row.line };
        if (row.surface.startsWith('grid:')) where.widget = row.surface.slice(5);
        if (row.shot) where.screenshot = row.shot;
        r.findings.push(F('critical', 'defect', where, 'Error is shown as an empty state',
          said ? 'target.md line ' + row.line + ' records the error capture as looking empty.'
            : 'target.md line ' + row.line + ' cites the same screenshot for the error and the empty state.',
          'The user reads a failure as "no records" and acts on it; an error is never collapsed into the empty state.',
          'Show an error that names the cause and a way to recover, distinct from the empty state; trace the procedure behind it on STAGE.'));
      }
      return r;
    },
  },
  {
    id: 'text-overflow', title: 'Text fits its box', severity: 'major', area: 'widget_fit',
    informs: 'text fits', source: 'U', needs: ['widget.type', 'widget.visible', 'widget.text'],
    uses: ['widget.box, widget.fontSize and widget.label (an estimate, for buttons and links only)'],
    run(ctx, F) {
      return scan(ctx, { kinds: TEXTUAL, pre: ['visible'], applies: shown }, (w, r) => {
        const raw = w.raw;
        if (hasField(raw, 'text')) {
          if (raw.text.need > raw.text.have + SLACK_PX) {
            r.findings.push(F('major', 'defect', atWidget(w), 'Text overflows its box',
              cite(w, 'text') + ': the text needs ' + px(raw.text.need) + ' px and has ' + px(raw.text.have) + ' px.',
              'Text wider than its box is cut off or runs into the next control, so the user cannot read all of it.',
              'Widen the control or let the text wrap.'));
          }
          return;
        }
        const label = bare(raw.label);
        if (ACTION.has(w.kind) && hasField(raw, 'box') && hasField(raw, 'fontSize') && label) {
          const est = label.length * raw.fontSize * (/\p{Ll}/u.test(label) ? 0.5 : 0.62) + 16;
          if (est > raw.box.w * 1.1) {
            r.findings.push(F('minor', 'gap', atWidget(w), 'Button text may not fit (estimate)',
              cite(w, 'label') + ' is ' + label.length + ' characters at ' + px(raw.fontSize) + ' px, about ' + px(est) + ' px; ' + cite(w, 'box') + ' is ' + px(raw.box.w) + ' px wide.',
              'This is an estimate from the character count, not a measurement, so it goes to verify.',
              'Check the screenshot, or record text.need and text.have in the census.'));
          }
          return;
        }
        unchecked(r, w.id, [ACTION.has(w.kind) ? 'widget.text (or widget.box, widget.fontSize and widget.label)' : 'widget.text']);
      });
    },
  },
  {
    id: 'clipped-dropdown', title: 'Dropdowns are as wide as their options', severity: 'minor', area: 'widget_fit',
    informs: 'text fits', source: 'V', needs: ['widget.type', 'widget.visible', 'widget.box', 'widget.optionW'],
    run(ctx, F) {
      return scan(ctx, { kinds: DROPDOWN, pre: ['visible'], applies: shown, needs: ['box', 'optionW'] }, (w, r) => {
        if (w.raw.optionW <= w.raw.box.w + SLACK_PX) return;
        r.findings.push(F('minor', 'defect', atWidget(w), 'Dropdown is narrower than its longest option',
          cite(w, 'optionW') + ' is ' + px(w.raw.optionW) + ' px; ' + cite(w, 'box') + ' is ' + px(w.raw.box.w) + ' px wide.',
          'The chosen option is cut off in the closed control, so the user cannot confirm what was picked.',
          'Widen the dropdown to its longest option, or shorten the option text in the lookup.'));
      });
    },
  },
  {
    id: 'narrow-overflow', title: 'Nothing runs past a 375px viewport', severity: 'major', area: 'responsive_accessible',
    informs: '375px reflow', source: 'U', needs: ['widget.visible', 'widget.box375 or census.narrowScrollWidth'], uses: ['widget.type (grids are exempt)'],
    run(ctx, F) {
      const sw = ctx.census.narrowScrollWidth;
      const pageWidth = isNum(sw);
      let gridOver = false;
      const why = 'At phone width the user has to scroll sideways to reach it (WCAG 2.1 SC 1.4.10 Reflow, Level AA; data grids are exempt).';
      const r = scan(ctx, { pre: ['visible'], applies: shown, needs: pageWidth ? [] : ['box375'] }, (w, rr) => {
        if (!hasField(w.raw, 'box375')) return; // only reached when the page width is recorded
        const b = w.raw.box375;
        if (b.x + b.w <= NARROW_PX + 1 && b.x >= -1) return;
        if (w.kind === 'grid') { gridOver = true; return; }
        rr.findings.push(F('major', 'defect', atWidget(w), 'Runs past the 375px viewport',
          cite(w, 'box375') + ' spans x ' + px(b.x) + ' to ' + px(b.x + b.w) + ' px at a 375 px viewport.', why,
          'Let the control shrink or stack at narrow widths.'));
      });
      if (pageWidth) {
        r.unchecked = [];
        r.missing = new Set(); // the recorded page width answers the question for every widget
        if (sw > NARROW_PX + 1 && !r.findings.length && !gridOver) {
          r.findings.push(F('major', 'defect', { census: 'narrowScrollWidth' }, 'Page scrolls sideways at 375px',
            'census narrowScrollWidth is ' + px(sw) + ' px at a 375 px viewport.', why,
            'Record box375 per widget to find the control that is too wide, then let it shrink or stack.'));
        }
      } else if (r.unchecked.length && r.missing.has('widget.box375')) {
        r.missing.delete('widget.box375');
        r.missing.add('widget.box375 (or census.narrowScrollWidth)');
      }
      return r;
    },
  },
];

const CHECK_IDS = new Set(CHECKS.map((c) => c.id));

// ---------- waivers ----------

function collectWaivers(ctx) {
  const ok = [];
  const errors = [];
  const ids = new Set([...ctx.byId.keys()]);
  for (const b of ctx.footer || []) if (isObj(b) && isText(b.id)) ids.add(b.id.trim());
  const consider = (wv, file, source) => {
    const err = (m) => errors.push({ file, line: wv.line, error: m });
    const def = CHECKS.find((c) => c.id === wv.check);
    if (!def) return err('no check is named ' + quote(wv.check));
    if (def.waivable === false) return err(wv.check + ' cannot be waived: an unstaged pack is never audited');
    if (source === 'fixed_constraint' && !wv.inFixed) return err('a target.md waiver must sit under the Fixed constraints heading, because only a fixed constraint waives a check');
    if (source === 'platform_limit' && !wv.proven) return err('a client-block waiver must read "proven: <reason>", because only a platform limit the client block marks as proven waives a check');
    if (hasPersonalData(wv.reason)) return err('the reason looks like it holds personal data; cite ids, not values');
    const reason = wv.reason.replace(/\s+/g, ' ').trim();
    if (reason.length < 10 || reason.split(' ').length < 2) return err('the reason is missing or too short; write why the check does not apply');
    if (wv.widget && !ids.has(wv.widget)) return err('widget ' + quote(wv.widget) + ' is not in the census');
    ok.push({ check: wv.check, widget: wv.widget || null, source, file, line: wv.line, reason, applied_to: [] });
  };
  if (ctx.target) ctx.target.waivers.forEach((w) => consider(w, 'target.md', 'fixed_constraint'));
  if (ctx.client) ctx.client.waivers.forEach((w) => consider(w, 'client-block.md', 'platform_limit'));
  return { ok, errors };
}

// ---------- the run ----------

function settle(res) {
  const findings = res.findings || [];
  const left = res.unchecked || [];
  let status = 'none_found';
  if (res.notChecked) status = 'not_checked';
  else if (findings.length) status = 'finding';
  else if (left.length) status = 'not_checked';
  return { status, findings, unchecked: left, missing: [...(res.missing || [])].sort() };
}

function ownedText(owned) {
  if (!owned.length) return 'none';
  const byArea = new Map();
  for (const o of owned) {
    if (!byArea.has(o.area)) byArea.set(o.area, []);
    if (!byArea.get(o.area).includes(o.informs)) byArea.get(o.area).push(o.informs);
  }
  return [...byArea].map(([a, xs]) => AREA_NAMES[a] + ': ' + xs.join(', ')).join('; ');
}

// Runs every check over an in-memory pack: { census, target, keyboard, client (texts or null), files, reports?,
// exists?, truncated? }. Returns the mechanical.json object, already scrubbed of personal-data patterns.
function lint(pack) {
  if (!isObj(pack)) throw new CouldNotRun('no pack given');
  checkCensus(pack.census);
  const census = pack.census;
  const widgets = census.widgets.map((raw, i) => ({ i, id: String(raw.id).trim(), raw, kind: kindOf(raw) }));
  const files = Array.isArray(pack.files) ? pack.files.map(normRel) : [];
  const fileSet = new Set(files);
  const kbRows = typeof pack.keyboard === 'string' ? parseKeyboard(pack.keyboard) : null;
  const ctx = {
    census,
    widgets,
    byId: new Map(widgets.map((w) => [w.id, w])),
    footer: Array.isArray(census.footer) ? census.footer : null,
    target: typeof pack.target === 'string' ? parseTarget(pack.target) : null,
    keyboard: typeof pack.keyboard === 'string' ? { rows: kbRows } : null,
    client: typeof pack.client === 'string' ? parseClient(pack.client) : null,
    reports: Array.isArray(pack.reports) ? pack.reports
      : files.map((f) => ({ path: f, reason: looksLikeReport(f) })).filter((x) => x.reason),
    exists: typeof pack.exists === 'function' ? pack.exists : (rel) => fileSet.has(normRel(rel)),
    truncated: pack.truncated === true,
  };

  const checks = [];
  const findings = [];
  for (const def of CHECKS) {
    const F = (severity, kind, where, title, evidence, why, fix) => ({
      id: '', check: def.id, severity, kind, area: def.area, title, where, evidence, why, fix, waived: null,
    });
    const s = settle(def.run(ctx, F));
    findings.push(...s.findings);
    checks.push({ id: def.id, title: def.title, severity: def.severity, area: def.area, informs: def.informs,
      source: def.source, needs: def.needs, uses: def.uses || [], status: s.status, findings: s.findings.length,
      waived: 0, unchecked: s.unchecked.length, missing: s.missing });
  }

  const taken = new Map();
  for (const f of findings) {
    const anchor = f.where.widget || f.where.surface || f.where.census || (f.where.file ? f.where.file + (f.where.line ? ':' + f.where.line : '') : 'form');
    const base = f.check + '/' + anchor;
    const k = (taken.get(base) || 0) + 1;
    taken.set(base, k);
    f.id = k === 1 ? base : base + '#' + k;
  }

  const { ok: waivers, errors: waiverErrors } = collectWaivers(ctx);
  for (const wv of waivers) {
    for (const f of findings) {
      if (f.check !== wv.check || f.waived) continue;
      if (wv.widget && f.where.widget !== wv.widget && !(f.where.widgets || []).includes(wv.widget)) continue;
      f.waived = { source: wv.source, file: wv.file, line: wv.line, reason: wv.reason };
      wv.applied_to.push(f.id);
    }
  }
  for (const c of checks) c.waived = findings.filter((f) => f.check === c.id && f.waived).length;

  const active = findings.filter((f) => !f.waived);
  const counts = {};
  for (const s of SEVERITIES) counts[s] = active.filter((f) => f.severity === s).length;
  const states = { finding: 0, none_found: 0, not_checked: 0 };
  for (const c of checks) states[c.status]++;
  const owned = checks.filter((c) => c.id !== 'staging' && c.status !== 'not_checked' && c.unchecked === 0)
    .map((c) => ({ check: c.id, area: c.area, informs: c.informs }));
  const capture = ctx.target && ctx.target.captures.length ? ctx.target.captures[0].mode : null;

  const result = {
    tool: TOOL,
    contract: CONTRACT,
    capture,
    inputs: {
      'target.md': Boolean(ctx.target),
      'census.json': { widgets: widgets.length, footer: ctx.footer ? ctx.footer.length : null,
        captureWidth: isNum(census.captureWidth) ? census.captureWidth : null },
      'keyboard.md': !ctx.keyboard ? 'missing' : kbRows ? 'structured' : 'not structured',
      'client-block.md': Boolean(ctx.client),
    },
    summary: Object.assign({}, counts, {
      waived: findings.length - active.length,
      checks: states,
      withheld: 0,
      exit: counts.critical + counts.major > 0 ? 1 : 0,
      stop: active.some((f) => f.check === 'staging' && f.severity === 'critical'),
    }),
    owned,
    checks,
    findings,
    waivers,
    waiver_errors: waiverErrors,
  };
  const counter = { n: 0 };
  const clean = redactDeep(result, counter);
  clean.summary.withheld = counter.n;
  return clean;
}

function summaryLines(res) {
  const s = res.summary;
  const out = [];
  out.push(NAME + ': ' + (s.exit ? 'FAIL' : 'PASS') + ', ' + SEVERITIES.map((k) => s[k] + ' ' + k).join(', ') +
    (s.waived ? ' (' + s.waived + ' waived)' : '') + '; checks: ' + s.checks.finding + ' with findings, ' +
    s.checks.none_found + ' none found, ' + s.checks.not_checked + ' not checked');
  if (s.stop) out.push(NAME + ': STOP: the pack is not staged; restage it and run the lint again before the auditor');
  const top = res.findings.filter((f) => !f.waived && f.severity === 'critical')
    .concat(res.findings.filter((f) => !f.waived && f.severity === 'major'));
  top.slice(0, MAX_PRINTED).forEach((f) => out.push('  ' + f.severity + ' ' + f.id + ': ' + f.title));
  if (top.length > MAX_PRINTED) out.push('  ... ' + (top.length - MAX_PRINTED) + ' more critical or major in ' + OUTPUT);
  const nc = res.checks.filter((c) => c.status === 'not_checked');
  if (nc.length) out.push(NAME + ': not checked: ' + nc.map((c) => c.id + ' (' + (c.missing.join(', ') || 'see ' + OUTPUT) + ')').join('; '));
  if (res.waiver_errors.length) out.push(NAME + ': ' + res.waiver_errors.length + ' waiver line(s) rejected; see waiver_errors in ' + OUTPUT);
  if (s.withheld) out.push(NAME + ': ' + s.withheld + ' value(s) that looked like personal data were withheld from the output');
  out.push(NAME + ': owned (the only lint output the auditor is given): ' + ownedText(res.owned));
  return out;
}

// ---------- the filesystem ----------

function decode(buf, label) {
  if (buf[0] === 0xff && buf[1] === 0xfe) return buf.toString('utf16le', 2);
  if (buf[0] === 0xfe && buf[1] === 0xff) throw new CouldNotRun(label + ' is UTF-16 big-endian; save it as UTF-8');
  return buf.toString('utf8', buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf ? 3 : 0);
}

// Plain stat then readFile: no O_NOFOLLOW or O_NONBLOCK, which Windows does not offer.
// Accepts UTF-8 with or without a BOM and UTF-16 LE with a BOM, because PowerShell 5.1 writes both.
function readText(file, label, optional) {
  let st;
  try { st = fs.statSync(file); } catch (e) {
    if (optional && e.code === 'ENOENT') return null;
    throw new CouldNotRun('cannot read ' + label + ' (' + (e.code || 'error') + ')');
  }
  if (!st.isFile()) throw new CouldNotRun(label + ' is not a regular file');
  if (st.size > MAX_BYTES) throw new CouldNotRun(label + ' is ' + st.size + ' bytes; the limit is ' + MAX_BYTES);
  let buf;
  try { buf = fs.readFileSync(file); } catch (e) { throw new CouldNotRun('cannot read ' + label + ' (' + (e.code || 'error') + ')'); }
  if (buf.length > MAX_BYTES) throw new CouldNotRun(label + ' grew past ' + MAX_BYTES + ' bytes while being read');
  return decode(buf, label);
}

function parseJson(text, label) {
  try { return JSON.parse(text); } catch (e) {
    // The parser's message can quote file content, which may hold personal data; keep only the position.
    const pos = /position (\d+)/.exec(String(e.message));
    throw new CouldNotRun(label + ' is not valid JSON' + (pos ? ' (near character ' + pos[1] + ')' : ''));
  }
}

function tryJson(file) {
  try { return JSON.parse(readText(file, 'json', false)); } catch (e) { return undefined; }
}

// Lists the pack, skipping links (a link could point outside the pack), and marks earlier reports.
function walk(dir) {
  const files = [];
  const reports = [];
  let truncated = false;
  const visit = (abs, rel, depth) => {
    let entries;
    try { entries = fs.readdirSync(abs, { withFileTypes: true }); } catch (e) {
      throw new CouldNotRun('cannot list ' + (rel || 'the pack folder') + ' (' + (e.code || 'error') + ')');
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const e of entries) {
      if (files.length >= MAX_FILES) { truncated = true; return; }
      const r = rel ? rel + '/' + e.name : e.name;
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) {
        if (depth < MAX_WALK_DEPTH) visit(path.join(abs, e.name), r, depth + 1); else truncated = true;
        continue;
      }
      if (!e.isFile()) continue;
      files.push(r);
      const json = /\.json$/i.test(e.name) && r !== 'census.json' ? tryJson(path.join(abs, e.name)) : undefined;
      const why = looksLikeReport(r, json);
      if (why) reports.push({ path: r, reason: why });
    }
  };
  visit(dir, '', 0);
  return { files, reports, truncated };
}

function loadPack(dir) {
  if (typeof dir !== 'string' || dir === '') throw new CouldNotRun('no pack folder given');
  let st;
  try { st = fs.statSync(dir); } catch (e) { throw new CouldNotRun('cannot read the pack folder (' + (e.code || 'error') + ')'); }
  if (!st.isDirectory()) throw new CouldNotRun('the pack path is not a folder');
  const census = parseJson(readText(path.join(dir, 'census.json'), 'census.json', false), 'census.json');
  checkCensus(census);
  const { files, reports, truncated } = walk(dir);
  return {
    census,
    target: readText(path.join(dir, 'target.md'), 'target.md', true),
    keyboard: readText(path.join(dir, 'keyboard.md'), 'keyboard.md', true),
    client: readText(path.join(dir, 'client-block.md'), 'client-block.md', true),
    files,
    reports,
    truncated,
    exists: (rel) => { try { return fs.statSync(path.join(dir, rel)).isFile(); } catch (e) { return false; } },
  };
}

function writeOutput(dir, result) {
  const file = path.join(dir, OUTPUT);
  let st = null;
  try { st = fs.lstatSync(file); } catch (e) { if (e.code !== 'ENOENT') throw new CouldNotRun('cannot check ' + OUTPUT + ' (' + (e.code || 'error') + ')'); }
  if (st && (st.isSymbolicLink() || !st.isFile())) throw new CouldNotRun(OUTPUT + ' in the pack is a link or a folder; remove it and run again');
  try { fs.writeFileSync(file, JSON.stringify(result, null, 2) + '\n'); } catch (e) {
    throw new CouldNotRun('cannot write ' + OUTPUT + ' (' + (e.code || 'error') + ')');
  }
}

function run(args, io) {
  const out = io || { log: console.log, error: console.error };
  if (!Array.isArray(args) || args.length !== 1) {
    out.error(NAME + ': COULD NOT RUN: usage: node form-lint.cjs <pack-folder>');
    return 2;
  }
  let result;
  try {
    result = lint(loadPack(args[0]));
    writeOutput(args[0], result);
  } catch (e) {
    const msg = e instanceof CouldNotRun ? e.message : 'internal error: ' + e.message;
    out.error(NAME + ': COULD NOT RUN: ' + redactText(msg, { n: 0 }));
    return 2;
  }
  const say = result.summary.exit ? out.error : out.log;
  for (const line of summaryLines(result)) say(line);
  say(NAME + ': wrote ' + OUTPUT);
  return result.summary.exit;
}

module.exports = {
  lint, run, loadPack, parseTarget, parseKeyboard, parseClient, looksLikeReport, internalName, kindOf, summaryLines,
  CHECKS, CHECK_IDS, CouldNotRun, MAX_BYTES, OUTPUT,
};

if (require.main === module) {
  let code = 2;
  try { code = run(process.argv.slice(2)); } catch (e) { console.error(NAME + ': COULD NOT RUN: internal error'); }
  process.exitCode = code === 0 || code === 1 ? code : 2; // anything unexpected is a 2, never a 0
}
