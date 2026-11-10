#!/usr/bin/env node
'use strict';
// Pre-handoff gate for a client deliverable: a 16:9 walkthrough deck (.pptx) or an accessible Word guide (.docx).
// Run: node deliverable-check.cjs <file.pptx|file.docx> [--residue <patterns-file>] [--allow <patterns-file>]
//                                 [--content-bottom <inches>] [--out <report.json>]
// Exit 0: Ready. Exit 1: findings or follow-ups, so read the report. Exit 2: could not run.
// Zero dependencies and read-only: a small ZIP reader inflates XML parts in memory and never writes them to disk.
// Findings cite slide, shape, paragraph and pattern-line positions, never the matched text.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const NAME = 'deliverable-check';
const MAX_FILE_BYTES = 256 * 1024 * 1024;
const MAX_ENTRIES = 5000;
const MAX_PART_BYTES = 24 * 1024 * 1024;      // any one part the checker inflates
const MAX_INFLATED_BYTES = 256 * 1024 * 1024; // all inflated parts together
const MAX_ELEMENTS = 1500000;                 // per XML part
const MAX_XML_DEPTH = 256;
const MAX_PATTERN_FILE_BYTES = 1024 * 1024;
const MAX_PATTERNS = 5000;
const MAX_LISTED = 1000;
const EMU_PER_IN = 914400;
const STANDARD_SLIDE_H = 6858000;        // 7.5 in, the height of a 13.333 x 7.5 in widescreen slide
const DEFAULT_CONTENT_BOTTOM = 6126480;  // 6.70 in on that slide
const EPS = 4572;                        // 0.005 in: sub-pixel overflow is ignored

const SEVERITIES = ['critical', 'high', 'medium', 'low'];
const FINDING = 'finding';
const CLEAN = 'checked, none found';
const NOT_CHECKED = 'not checked';
const PPTX_CATEGORIES = ['slide_size', 'layout', 'placeholder_text', 'empty_slides', 'image_only_slides', 'alt_text',
  'speaker_notes', 'personal_data', 'residue', 'text_in_images', 'embedded_files'];
const DOCX_CATEGORIES = ['heading_order', 'alt_text', 'placeholder_text', 'table_headers', 'document_title',
  'personal_data', 'residue', 'text_in_images', 'embedded_files'];

class CouldNotRun extends Error {}

// ---------------------------------------------------------------------------------------------------------------
// ZIP: central directory, stored and deflate entries, nothing extracted to disk.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function readZip(buf) {
  if (!Buffer.isBuffer(buf)) throw new CouldNotRun('no file content to read');
  if (buf.length >= 8 && buf.readUInt32BE(0) === 0xd0cf11e0 && buf.readUInt32BE(4) === 0xa1b11ae1) {
    throw new CouldNotRun('the file is password-protected or in the old binary format; save an unprotected .pptx or .docx copy and check that');
  }
  if (buf.length < 22 || buf.readUInt32LE(0) !== 0x04034b50) {
    throw new CouldNotRun('the file is not a ZIP package, and every .pptx and .docx is one');
  }
  let eocd = -1;
  for (let i = buf.length - 22, stop = Math.max(0, buf.length - 22 - 0xffff); i >= stop; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50 && i + 22 + buf.readUInt16LE(i + 20) <= buf.length) { eocd = i; break; }
  }
  if (eocd < 0) throw new CouldNotRun('the ZIP end record is missing; the file is truncated or damaged');
  const count = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff
    || (eocd >= 20 && buf.readUInt32LE(eocd - 20) === 0x07064b50)) {
    throw new CouldNotRun('ZIP64 packages are not supported');
  }
  if (buf.readUInt16LE(eocd + 4) !== 0 || buf.readUInt16LE(eocd + 6) !== 0 || buf.readUInt16LE(eocd + 8) !== count) {
    throw new CouldNotRun('multi-part ZIP archives are not supported');
  }
  if (count > MAX_ENTRIES) throw new CouldNotRun('the package has ' + count + ' entries; the limit is ' + MAX_ENTRIES);
  if (cdOffset + cdSize > eocd) throw new CouldNotRun('the ZIP central directory is out of bounds; the file is damaged');
  const entries = new Map();
  let p = cdOffset;
  for (let n = 0; n < count; n++) {
    if (p + 46 > eocd || buf.readUInt32LE(p) !== 0x02014b50) throw new CouldNotRun('the ZIP central directory is damaged');
    const flags = buf.readUInt16LE(p + 8);
    const nameLen = buf.readUInt16LE(p + 28);
    const next = p + 46 + nameLen + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
    if (next > eocd) throw new CouldNotRun('the ZIP central directory is damaged');
    const e = {
      name: buf.toString(flags & 0x800 ? 'utf8' : 'latin1', p + 46, p + 46 + nameLen),
      method: buf.readUInt16LE(p + 10),
      crc: buf.readUInt32LE(p + 16),
      csize: buf.readUInt32LE(p + 20),
      usize: buf.readUInt32LE(p + 24),
      offset: buf.readUInt32LE(p + 42),
    };
    if (e.csize === 0xffffffff || e.usize === 0xffffffff || e.offset === 0xffffffff) {
      throw new CouldNotRun('ZIP64 packages are not supported');
    }
    if (flags & 0x41) throw new CouldNotRun('the package has encrypted entries; save an unprotected copy and check that');
    const key = e.name.toLowerCase(); // part names in an Office package are case-insensitive
    if (entries.has(key)) throw new CouldNotRun('the package names the same part twice');
    entries.set(key, e);
    p = next;
  }
  return { buf, entries, inflated: 0, cache: new Map() };
}

const hasPart = (zip, name) => zip.entries.has(String(name).toLowerCase());

function readPart(zip, name) {
  const e = zip.entries.get(String(name).toLowerCase());
  if (!e) return null;
  if (e.usize > MAX_PART_BYTES) {
    throw new CouldNotRun('part ' + e.name + ' is ' + e.usize + ' bytes uncompressed; the limit is ' + MAX_PART_BYTES);
  }
  if (zip.inflated + e.usize > MAX_INFLATED_BYTES) {
    throw new CouldNotRun('the package inflates past ' + MAX_INFLATED_BYTES + ' bytes of XML; the limit protects against ZIP bombs');
  }
  const b = zip.buf;
  if (e.offset + 30 > b.length || b.readUInt32LE(e.offset) !== 0x04034b50) {
    throw new CouldNotRun('part ' + e.name + ' has a damaged local header');
  }
  const start = e.offset + 30 + b.readUInt16LE(e.offset + 26) + b.readUInt16LE(e.offset + 28);
  if (start + e.csize > b.length) throw new CouldNotRun('part ' + e.name + ' runs past the end of the file; the file is truncated');
  const raw = b.subarray(start, start + e.csize);
  let data;
  if (e.method === 0) data = raw;
  else if (e.method === 8) {
    try {
      data = zlib.inflateRawSync(raw, { maxOutputLength: Math.max(e.usize, 1) });
    } catch (err) {
      throw new CouldNotRun('part ' + e.name + ' does not inflate to its declared size (' + (err.code || 'error') + ')');
    }
  } else throw new CouldNotRun('part ' + e.name + ' uses compression method ' + e.method + '; only stored and deflate are supported');
  if (data.length !== e.usize) throw new CouldNotRun('part ' + e.name + ' inflates to a different size than its header says');
  if (crc32(data) !== e.crc) throw new CouldNotRun('part ' + e.name + ' fails its CRC check; the file is damaged');
  zip.inflated += data.length;
  return data;
}

// ---------------------------------------------------------------------------------------------------------------
// XML: a small tag scanner that builds a tree of { name, attrs, children, text }. No DOCTYPE, no custom entities.

// Plain UTF-8 with or without a BOM, and UTF-16 with a BOM (PowerShell 5.1 writes UTF-16 LE by default).
function decodeText(buf) {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return buf.toString('utf16le', 2);
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    const c = Buffer.from(buf.subarray(2, 2 + ((buf.length - 2) & ~1)));
    c.swap16();
    return c.toString('utf16le');
  }
  return buf.toString('utf8', buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf ? 3 : 0);
}

const TAG = /<(\/?)([A-Za-z_][\w.-]*(?::[A-Za-z_][\w.-]*)?)((?:\s+[A-Za-z_][\w.:-]*\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/y;
const ATTR = /([A-Za-z_][\w.:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
const ENTITY = /&(?:(lt|gt|amp|quot|apos)|#(\d{1,7})|#x([0-9A-Fa-f]{1,6}));/g;
const NAMED = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

function unescapeXml(s) {
  if (s.indexOf('&') < 0) return s;
  return s.replace(ENTITY, (m, named, dec, hex) => {
    if (named) return NAMED[named];
    const cp = dec ? parseInt(dec, 10) : parseInt(hex, 16);
    return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
  });
}

function parseXml(str, part) {
  const fail = (why) => { throw new CouldNotRun('part ' + part + ' is not well-formed XML (' + why + ')'); };
  const root = { name: '#document', attrs: {}, children: [], text: '' };
  const stack = [root];
  let elements = 0;
  let i = 0;
  const addText = (s) => {
    const cur = stack[stack.length - 1];
    if (cur !== root && s) cur.text += unescapeXml(s);
  };
  while (i < str.length) {
    const lt = str.indexOf('<', i);
    if (lt < 0) { addText(str.slice(i)); break; }
    if (lt > i) addText(str.slice(i, lt));
    if (str.startsWith('<!--', lt)) {
      const e = str.indexOf('-->', lt + 4);
      if (e < 0) fail('unclosed comment');
      i = e + 3;
    } else if (str.startsWith('<![CDATA[', lt)) {
      const e = str.indexOf(']]>', lt + 9);
      if (e < 0) fail('unclosed CDATA section');
      const cur = stack[stack.length - 1];
      if (cur !== root) cur.text += str.slice(lt + 9, e);
      i = e + 3;
    } else if (str.startsWith('<?', lt)) {
      const e = str.indexOf('?>', lt + 2);
      if (e < 0) fail('unclosed declaration');
      i = e + 2;
    } else if (str.startsWith('<!', lt)) {
      fail('a DOCTYPE or entity declaration, which Office parts never carry');
    } else {
      TAG.lastIndex = lt;
      const m = TAG.exec(str);
      if (!m) fail('bad tag near character ' + lt);
      i = TAG.lastIndex;
      const [, close, name, attrText, selfClose] = m;
      const cur = stack[stack.length - 1];
      if (close) {
        if (attrText || selfClose) fail('bad closing tag near character ' + lt);
        if (cur === root || cur.name !== name) fail('mismatched closing tag near character ' + lt);
        stack.pop();
        continue;
      }
      if (++elements > MAX_ELEMENTS) fail('more than ' + MAX_ELEMENTS + ' elements');
      const attrs = {};
      if (attrText) for (const a of attrText.matchAll(ATTR)) attrs[a[1]] = unescapeXml(a[2] !== undefined ? a[2] : a[3]);
      const el = { name, attrs, children: [], text: '' };
      cur.children.push(el);
      if (!selfClose) {
        stack.push(el);
        if (stack.length > MAX_XML_DEPTH) fail('nested deeper than ' + MAX_XML_DEPTH + ' levels');
      }
    }
  }
  if (stack.length !== 1) fail('an element is never closed');
  if (root.children.length !== 1) fail('expected exactly one root element');
  return root.children[0];
}

function xmlPart(zip, name) {
  const key = String(name).toLowerCase();
  if (zip.cache.has(key)) return zip.cache.get(key);
  const data = readPart(zip, name);
  const doc = data === null ? null : parseXml(decodeText(data), zip.entries.get(key).name);
  zip.cache.set(key, doc);
  return doc;
}

const kid = (el, name) => (el ? el.children.find((c) => c.name === name) || null : null);
const kids = (el, name) => (el ? el.children.filter((c) => c.name === name) : []);

// mc:AlternateContent holds the same content twice; read the first mc:Choice (or the fallback when there is no
// choice), so nothing is counted or reported twice.
function branch(el) {
  if (!el.children.some((c) => c.name === 'mc:AlternateContent')) return el.children;
  const out = [];
  for (const c of el.children) {
    if (c.name !== 'mc:AlternateContent') { out.push(c); continue; }
    const pick = kid(c, 'mc:Choice') || kid(c, 'mc:Fallback');
    if (pick) out.push(...branch(pick));
  }
  return out;
}

function findAll(el, test, out = []) {
  const ok = typeof test === 'string' ? (c) => c.name === test : test;
  if (el) for (const c of branch(el)) { if (ok(c)) out.push(c); findAll(c, ok, out); }
  return out;
}
const find = (el, test) => findAll(el, test)[0] || null;

// Text of an element. Only leaf elements carry text in OOXML, so whitespace between tags is ignored.
// stop: element names not to descend into (a nested paragraph). omit: names to leave out (deleted text).
function textOf(el, opts = {}) {
  const out = [];
  const gather = (e, top) => {
    if (!top && opts.stop && opts.stop.has(e.name)) return;
    if (opts.omit && opts.omit.has(e.name)) return;
    if (e.name === 'w:tab') { out.push('\t'); return; }
    if (e.name === 'a:br' || e.name === 'w:br' || e.name === 'w:cr') { out.push('\n'); return; }
    if (e.children.length === 0) { if (e.text) out.push(e.text); return; }
    for (const c of branch(e)) gather(c, false);
    if (e.name === 'a:p' || e.name === 'w:p') out.push('\n');
  };
  if (el) gather(el, true);
  return out.join('');
}

// ---------------------------------------------------------------------------------------------------------------
// Package relationships.

function relsPathOf(part) {
  const i = part.lastIndexOf('/');
  return (i < 0 ? '' : part.slice(0, i + 1)) + '_rels/' + part.slice(i + 1) + '.rels';
}

function normalizePart(p) {
  const out = [];
  for (const s of p.split('/')) {
    if (s === '' || s === '.') continue;
    if (s === '..') out.pop(); else out.push(s);
  }
  return out.join('/');
}

function resolvePart(from, target) {
  let t = target;
  try { t = decodeURIComponent(t); } catch (_) { /* keep it as written */ }
  if (t.startsWith('/')) return normalizePart(t.slice(1));
  const i = from.lastIndexOf('/');
  return normalizePart((i < 0 ? '' : from.slice(0, i + 1)) + t);
}

function relsOf(zip, part) {
  const doc = xmlPart(zip, relsPathOf(part));
  if (!doc) return [];
  if (doc.name !== 'Relationships') throw new CouldNotRun(relsPathOf(part) + ' is not a relationships part');
  return kids(doc, 'Relationship').map((r) => {
    const external = r.attrs.TargetMode === 'External';
    const target = r.attrs.Target || '';
    return { id: r.attrs.Id, type: r.attrs.Type || '', external, target: external ? target : resolvePart(part, target) };
  });
}
const relOfType = (list, suffix) => list.find((r) => !r.external && r.type.endsWith(suffix)) || null;

function mainPart(zip, fallback) {
  const r = relOfType(relsOf(zip, ''), '/officeDocument');
  return r && hasPart(zip, r.target) ? r.target : fallback;
}

const prefixError = (part) => new CouldNotRun('part ' + part + ' does not use the XML prefixes this checker reads '
  + '(p:, a:, w:, r:, as Office and the common libraries write them), so it cannot be checked');

// ---------------------------------------------------------------------------------------------------------------
// Text rules: personal data, residue patterns, placeholders.

// The same three patterns as skills/valence-security-audit/scripts/validate-findings.cjs, with capture groups so
// documented sample values can be recognised. A bare run of ten digits is not a phone number: ids look like that.
const PERSONAL = [
  { kind: 'email', what: 'an email address', allowable: true,
    re: /[A-Za-z0-9][A-Za-z0-9._%+-]*@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})/g,
    // RFC 2606 names are reserved for examples and never reach a person.
    sample: (m) => /(?:^|\.)example\.(?:com|net|org)$|\.(?:example|test|invalid|localhost)$/i.test(m[1]) },
  { kind: 'ssn', what: 'a US social security number', allowable: false,
    re: /(?<![\d-])(\d{3})-(\d{2})-(\d{4})(?![\d-])/g,
    // Area 000 or 666, group 00 and serial 0000 are never issued.
    sample: (m) => m[1] === '000' || m[1] === '666' || m[2] === '00' || m[3] === '0000' },
  { kind: 'phone', what: 'a phone number', allowable: true,
    re: /(?<![\d-])(?:\+?1[ .-]?)?(?:\(([2-9]\d{2})\) ?|([2-9]\d{2})[ .-])([2-9]\d{2})[ .-](\d{4})(?![\d-])/g,
    // 555-0100 to 555-0199 is the range set aside for fiction.
    sample: (m) => m[3] === '555' && Number(m[4]) >= 100 && Number(m[4]) <= 199 },
];

function personalData(text, allow) {
  const hits = [];
  let samples = 0;
  let allowed = 0;
  for (const rule of PERSONAL) {
    let n = 0;
    for (const m of String(text).matchAll(rule.re)) {
      if (rule.sample(m)) samples++;
      else if (rule.allowable && allow && allow.some((a) => a.re.test(m[0]))) allowed++;
      else n++;
    }
    if (n) hits.push({ kind: rule.kind, what: rule.what, count: n });
  }
  return { hits, samples, allowed };
}

const PLACEHOLDERS = [
  { re: /\bTODOs?\b|\bFIXME\b/, what: 'TODO or FIXME' },
  { re: /\bTB[DC]\b/, what: 'TBD or TBC' },
  { re: /(?<![A-Za-z0-9])X{3,}(?![A-Za-z0-9])/, what: 'XXX' },
  { re: /\blorem\s+ipsum\b/i, what: 'lorem ipsum' },
  { re: /\bclick to (?:add|edit)\b/i, what: '"Click to add" prompt text' },
  { re: /\bclick (?:or tap )?here to (?:enter|add)\b/i, what: 'Word content-control prompt text' },
  { re: /\[\s*insert\b/i, what: '"[insert" marker' },
  { re: /\{\{[^{}\n]{0,80}\}\}/, what: '{{ }} template token' },
  { re: /«[^«»\n]{1,80}»/, what: '« » merge field' },
];

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// One pattern per line: a literal (case-insensitive, any run of whitespace matches any run) or /regex/flags.
// Blank lines and lines starting with # are skipped. Errors name the line number, never the line: the patterns
// are client data. anchored: a literal must equal the whole value (used by the allow file).
function loadPatterns(text, label, anchored) {
  const out = [];
  String(text).split(/\r\n|\r|\n/).forEach((raw, i) => {
    const line = raw.trim();
    const n = i + 1;
    if (line === '' || line.startsWith('#')) return;
    if (out.length >= MAX_PATTERNS) throw new CouldNotRun(label + ' has more than ' + MAX_PATTERNS + ' patterns');
    if (line.length > 500) throw new CouldNotRun(label + ' line ' + n + ' is longer than 500 characters');
    let re;
    const m = /^\/(.+)\/([a-z]*)$/s.exec(line);
    if (m) {
      if (!/^[imsu]*$/.test(m[2]) || new Set(m[2]).size !== m[2].length) {
        throw new CouldNotRun(label + ' line ' + n + ': only the i, m, s and u flags are allowed');
      }
      try { re = new RegExp(m[1], m[2]); } catch (_) {
        throw new CouldNotRun(label + ' line ' + n + ' is not a valid regular expression');
      }
    } else {
      if (line.replace(/\s+/g, '').length < 3) {
        throw new CouldNotRun(label + ' line ' + n + ' is shorter than 3 characters, so it would match almost anything');
      }
      const body = line.split(/\s+/).map(escapeRe).join('\\s+');
      re = new RegExp(anchored ? '^' + body + '$' : body, 'i');
    }
    if (re.test('')) throw new CouldNotRun(label + ' line ' + n + ' matches empty text, so it would match everywhere');
    out.push({ line: n, re });
  });
  return out;
}

function newContext(opts) {
  const findings = [];
  const seen = new Set();
  return {
    residue: opts.residue || null,
    allow: opts.allow || null,
    samples: 0,
    allowed: 0,
    units: [],
    handled: new Set(),
    findings,
    add(check, severity, location, part, message) {
      const key = check + '\u0000' + location + '\u0000' + message;
      if (seen.has(key)) return;
      seen.add(key);
      findings.push({ check, severity, location, part: part || null, message });
    },
  };
}

// A shape name or heading may appear in a location only if it holds no personal data and no residue match.
function safeLabel(text, ctx) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t || t.length > 60) return null;
  const pd = personalData(t, null);
  if (pd.hits.length || pd.samples) return null;
  if (ctx.residue && ctx.residue.some((p) => p.re.test(t))) return null;
  return t;
}

function scanUnit(u, ctx) {
  if (u.text && u.text.trim()) {
    const pd = personalData(u.text, ctx.allow);
    ctx.samples += pd.samples;
    ctx.allowed += pd.allowed;
    for (const h of pd.hits) {
      ctx.add('personal_data', 'critical', u.where, u.part, 'looks like ' + h.what
        + (h.count > 1 ? ' (' + h.count + ' matches)' : '') + '; replace it with a sample value');
    }
    if (ctx.residue) {
      for (const p of ctx.residue) {
        if (p.re.test(u.text)) ctx.add('residue', 'critical', u.where, u.part, 'matches residue pattern on line ' + p.line);
      }
    }
  }
  if (u.visible && u.visible.trim()) {
    for (const ph of PLACEHOLDERS) {
      if (ph.re.test(u.visible)) ctx.add('placeholder_text', 'high', u.where, u.part, 'placeholder text: ' + ph.what);
    }
  }
}

const AUTO_ALT = /description automatically generated|AI-generated content may be incorrect/i;
// python-pptx and some exporters write the image file name as alt text; a screen reader then reads "image1.png".
const FILE_ALT = /^[^\\/:*?"<>|\r\n]{1,150}\.(?:png|jpe?g|jfif|gif|bmp|tiff?|emf|wmf|svg|webp)$/i;
const isDecorative = (el) => findAll(el, (c) => /(?:^|:)decorative$/.test(c.name))
  .some((d) => d.attrs.val === '1' || d.attrs.val === 'true');

function checkAlt(attrs, owner, what, where, part, ctx, stats) {
  stats.alts++;
  if (isDecorative(owner)) { stats.decorative++; return; }
  const d = (attrs.descr || '').trim();
  if (!d) ctx.add('alt_text', 'high', where, part, what + ' has no alt text');
  else if (FILE_ALT.test(d)) ctx.add('alt_text', 'high', where, part, 'alt text is only a file name, which tells a screen-reader user nothing');
  else if (AUTO_ALT.test(d)) ctx.add('alt_text', 'medium', where, part, 'alt text was generated automatically and has not been reviewed');
}

const isChartUri = (uri) => /\/(?:chart|chartex|diagram)$/.test(uri || '');
const inches = (emu) => (emu / EMU_PER_IN).toFixed(2);

function rangeList(ns) {
  const out = [];
  for (let i = 0; i < ns.length; i++) {
    let j = i;
    while (j + 1 < ns.length && ns[j + 1] === ns[j] + 1) j++;
    out.push(j > i ? ns[i] + '-' + ns[j] : String(ns[i]));
    i = j;
  }
  return out.join(', ');
}

function ratioName(r) {
  const known = [[16 / 9, '16:9'], [16 / 10, '16:10'], [4 / 3, '4:3'], [3 / 2, '3:2'], [1, '1:1']];
  const k = known.find(([v]) => Math.abs(v - r) < 0.01);
  return k ? k[1] : 'not a standard ratio';
}

// ---------------------------------------------------------------------------------------------------------------
// PPTX.

const SHAPES = new Set(['p:sp', 'p:pic', 'p:graphicFrame', 'p:cxnSp', 'p:grpSp', 'p:contentPart']);
const NV = { 'p:sp': 'p:nvSpPr', 'p:pic': 'p:nvPicPr', 'p:graphicFrame': 'p:nvGraphicFramePr', 'p:cxnSp': 'p:nvCxnSpPr', 'p:grpSp': 'p:nvGrpSpPr' };
const FOOTER_TYPES = new Set(['ftr', 'sldNum', 'dt']);
const FOOTER_NAME = /footer|\bfoot\b|slide ?number|page ?number|pagination/i;
const MASTER_TYPE = { ctrTitle: 'title', subTitle: 'body', obj: 'body' };
const IDENTITY = { sx: 1, sy: 1, tx: 0, ty: 0 };

function nvOf(el) {
  const nv = NV[el.name] ? kid(el, NV[el.name]) : null;
  return { cNvPr: kid(nv, 'p:cNvPr'), ph: kid(kid(nv, 'p:nvPr'), 'p:ph') };
}

function xfrmOf(el) {
  if (el.name === 'p:graphicFrame') return kid(el, 'p:xfrm');
  if (el.name === 'p:grpSp') return kid(kid(el, 'p:grpSpPr'), 'a:xfrm');
  return kid(kid(el, 'p:spPr'), 'a:xfrm');
}

const num = (v) => (v !== undefined && /^-?\d+$/.test(String(v).trim()) ? Number(v) : null);

function boxOf(xf) {
  const off = kid(xf, 'a:off');
  const ext = kid(xf, 'a:ext');
  if (!off || !ext) return null;
  const v = [num(off.attrs.x), num(off.attrs.y), num(ext.attrs.cx), num(ext.attrs.cy)];
  if (v.some((n) => n === null)) return null;
  return { x: v[0], y: v[1], w: v[2], h: v[3], rot: num(xf.attrs.rot) || 0 };
}

// A rotated shape is measured by the bounding box of the rotated rectangle around its centre.
function unrotate(b) {
  if (!b.rot) return b;
  const t = (b.rot / 60000) * Math.PI / 180;
  const c = Math.abs(Math.cos(t));
  const s = Math.abs(Math.sin(t));
  const w = b.w * c + b.h * s;
  const h = b.w * s + b.h * c;
  return { x: b.x + b.w / 2 - w / 2, y: b.y + b.h / 2 - h / 2, w, h };
}

// Group transform: child coordinates map through chOff/chExt onto off/ext. Group rotation and flips are ignored.
function groupMap(grp, parent) {
  const xf = xfrmOf(grp);
  if (!xf) return parent;
  const pick = (n, a) => { const e = kid(xf, n); return e ? num(e.attrs[a]) : null; };
  const v = [pick('a:off', 'x'), pick('a:off', 'y'), pick('a:ext', 'cx'), pick('a:ext', 'cy'),
    pick('a:chOff', 'x'), pick('a:chOff', 'y'), pick('a:chExt', 'cx'), pick('a:chExt', 'cy')];
  if (v.some((n) => n === null)) return parent;
  const [ox, oy, ex, ey, cx0, cy0, cex, cey] = v;
  const sx = cex ? ex / cex : 1;
  const sy = cey ? ey / cey : 1;
  const tx = ox - cx0 * sx;
  const ty = oy - cy0 * sy;
  return { sx: parent.sx * sx, sy: parent.sy * sy, tx: parent.sx * tx + parent.tx, ty: parent.sy * ty + parent.ty };
}
const place = (b, m) => ({ x: b.x * m.sx + m.tx, y: b.y * m.sy + m.ty, w: b.w * m.sx, h: b.h * m.sy });

function walkShapes(container, map, visit) {
  for (const el of branch(container)) {
    if (!SHAPES.has(el.name)) continue;
    visit(el, map);
    if (el.name === 'p:grpSp') walkShapes(el, groupMap(el, map), visit);
  }
}

const spTreeOf = (doc) => kid(kid(doc, 'p:cSld'), 'p:spTree');

function placeholderBoxes(zip, part) {
  const key = 'placeholders:' + part.toLowerCase();
  if (zip.cache.has(key)) return zip.cache.get(key);
  const res = { byIdx: new Map(), byType: new Map() };
  const doc = xmlPart(zip, part);
  const tree = doc && spTreeOf(doc);
  if (tree) {
    walkShapes(tree, IDENTITY, (el, map) => {
      const { ph } = nvOf(el);
      if (!ph) return;
      const xf = xfrmOf(el);
      const b = xf ? boxOf(xf) : null;
      const entry = { type: ph.attrs.type || 'obj', box: b ? place(unrotate(b), map) : null };
      if (ph.attrs.idx !== undefined && !res.byIdx.has(ph.attrs.idx)) res.byIdx.set(ph.attrs.idx, entry);
      if (!res.byType.has(entry.type)) res.byType.set(entry.type, entry);
    });
  }
  zip.cache.set(key, res);
  return res;
}

// A placeholder that sets no position takes its layout's, matched by idx and then by type, else its master's.
function inheritedBox(ph, layout, master) {
  const type = ph.attrs.type || 'obj';
  const idx = ph.attrs.idx;
  const lp = layout ? (idx !== undefined && layout.byIdx.get(idx)) || layout.byType.get(type) || null : null;
  if (lp && lp.box) return lp.box;
  const t = lp ? lp.type : type;
  const mp = master ? master.byType.get(MASTER_TYPE[t] || t) : null;
  return mp && mp.box ? mp.box : null;
}

function checkPptx(zip, ctx, opts) {
  const presPart = mainPart(zip, 'ppt/presentation.xml');
  const pres = hasPart(zip, presPart) ? xmlPart(zip, presPart) : null;
  if (!pres || !/(?:^|:)presentation$/.test(pres.name)) {
    throw new CouldNotRun('the file has no presentation part, so it is not a PowerPoint package');
  }
  if (pres.name !== 'p:presentation') throw prefixError(presPart);
  ctx.handled.add(presPart.toLowerCase());
  const notes = {};
  const partial = {};

  // Slide size.
  const sz = kid(pres, 'p:sldSz');
  const cx = sz ? num(sz.attrs.cx) : null;
  const cy = sz ? num(sz.attrs.cy) : null;
  let ratio = null;
  if (!cx || !cy || cx <= 0 || cy <= 0) {
    ctx.add('slide_size', 'high', 'presentation', presPart, 'the slide size is not declared, so the deck is not known to be 16:9');
    notes.slide_size = 'slide size not declared';
  } else {
    ratio = cx / cy;
    notes.slide_size = inches(cx) + ' x ' + inches(cy) + ' in, ratio ' + ratio.toFixed(3) + ' (' + ratioName(ratio) + ')';
    if (Math.abs(ratio - 16 / 9) > 0.01) {
      ctx.add('slide_size', 'high', 'presentation', presPart, 'the slide is ' + notes.slide_size + '; a walkthrough deck is 16:9');
    }
  }

  // Content line: the 6.70 in default belongs to a 7.5 in slide, so it scales with any other height.
  let line = null;
  let scaled = false;
  if (opts.contentBottomIn !== null && opts.contentBottomIn !== undefined) line = Math.round(opts.contentBottomIn * EMU_PER_IN);
  else if (cy) {
    line = cy === STANDARD_SLIDE_H ? DEFAULT_CONTENT_BOTTOM : Math.round(DEFAULT_CONTENT_BOTTOM * cy / STANDARD_SLIDE_H);
    scaled = cy !== STANDARD_SLIDE_H;
  }

  // Slides in deck order.
  const relById = new Map(relsOf(zip, presPart).map((r) => [r.id, r]));
  const slides = kids(kid(pres, 'p:sldIdLst'), 'p:sldId').map((s, i) => {
    const r = relById.get(s.attrs['r:id']);
    if (!r || r.external || !hasPart(zip, r.target)) {
      throw new CouldNotRun('slide ' + (i + 1) + ' is listed in the presentation but its part is missing');
    }
    return { n: i + 1, part: r.target };
  });
  if (slides.length === 0) ctx.add('empty_slides', 'medium', 'presentation', presPart, 'the deck has no slides');

  const stats = { alts: 0, decorative: 0 };
  let measured = 0;
  let unmeasured = 0;
  let picturesPlaced = 0;
  let withNotes = 0;
  const noNotes = [];
  const hidden = [];

  for (const s of slides) {
    const doc = xmlPart(zip, s.part);
    if (doc.name !== 'p:sld') throw prefixError(s.part);
    ctx.handled.add(s.part.toLowerCase());
    const isHidden = doc.attrs.show === '0' || doc.attrs.show === 'false';
    if (isHidden) hidden.push(s.n);
    const label = 'slide ' + s.n + (isHidden ? ' (hidden)' : '');
    const srels = relsOf(zip, s.part);
    const layoutRel = relOfType(srels, '/slideLayout');
    const layoutOk = layoutRel && hasPart(zip, layoutRel.target);
    const layout = layoutOk ? placeholderBoxes(zip, layoutRel.target) : null;
    const masterRel = layoutOk ? relOfType(relsOf(zip, layoutRel.target), '/slideMaster') : null;
    const master = masterRel && hasPart(zip, masterRel.target) ? placeholderBoxes(zip, masterRel.target) : null;
    let slideText = '';
    let pics = 0;
    let frames = 0;
    const tree = spTreeOf(doc);
    if (tree) {
      walkShapes(tree, IDENTITY, (el, map) => {
        const { cNvPr, ph } = nvOf(el);
        const attrs = cNvPr ? cNvPr.attrs : {};
        const name = attrs.name || '';
        const shown = safeLabel(name, ctx);
        const where = label + ', shape ' + (attrs.id || '?') + (shown ? ' "' + shown + '"' : '');
        if (name) ctx.units.push({ where: where + ', shape name', part: s.part, text: name, visible: null });
        const extra = [attrs.descr, attrs.title];
        if (el.name !== 'p:grpSp') findAll(el, (c) => c.attrs.tooltip).forEach((c) => extra.push(c.attrs.tooltip));
        const alt = extra.filter(Boolean).join('\n');
        if (alt) ctx.units.push({ where: where + ', alt text or link tooltip', part: s.part, text: alt, visible: alt });
        if (el.name === 'p:grpSp') return; // its children are visited and measured one by one

        if (el.name === 'p:sp' || el.name === 'p:graphicFrame') {
          const t = textOf(el);
          if (t.trim()) { ctx.units.push({ where, part: s.part, text: t, visible: t }); slideText += t; }
        }
        if (el.name === 'p:pic') { pics++; checkAlt(attrs, cNvPr, 'picture', where, s.part, ctx, stats); }
        if (el.name === 'p:graphicFrame') {
          frames++;
          const gd = find(el, 'a:graphicData');
          if (gd && isChartUri(gd.attrs.uri)) checkAlt(attrs, cNvPr, 'chart', where, s.part, ctx, stats);
        }

        const xf = xfrmOf(el);
        const b = xf ? boxOf(xf) : null;
        let box = b ? place(unrotate(b), map) : null;
        if (!box && ph) box = inheritedBox(ph, layout, master);
        if (box && el.name === 'p:graphicFrame') {
          // A table grows to fit its rows; take the larger of the frame and the sum of the row heights.
          const rows = findAll(el, 'a:tr').reduce((t, r) => t + (num(r.attrs.h) || 0), 0) * map.sy;
          if (rows > box.h) box = { x: box.x, y: box.y, w: box.w, h: rows };
        }
        if (!box || !cx || !cy) { unmeasured++; return; }
        measured++;
        const L = box.x;
        const T = box.y;
        const R = box.x + box.w;
        const B = box.y + box.h;
        if (L < -EPS || T < -EPS) {
          ctx.add('layout', 'high', where, s.part, 'starts at a negative position (left ' + inches(L) + ' in, top ' + inches(T) + ' in)');
        }
        const exempt = (ph && FOOTER_TYPES.has(ph.attrs.type)) || FOOTER_NAME.test(name);
        const fullBleed = L <= EPS && T <= EPS && R >= cx - EPS && B >= cy - EPS;
        if (R > cx + EPS || B > cy + EPS) {
          ctx.add('layout', 'high', where, s.part, 'extends past the slide edge (right ' + inches(R) + ' in, bottom '
            + inches(B) + ' in on a ' + inches(cx) + ' x ' + inches(cy) + ' in slide)');
        } else if (!exempt && !fullBleed && line !== null && B > line + EPS) {
          ctx.add('layout', 'medium', where, s.part, 'ends at ' + inches(B) + ' in, below the content line at ' + inches(line) + ' in');
        }
      });
    }
    picturesPlaced += pics;
    if (!slideText.trim()) {
      if (pics > 0) {
        ctx.add('image_only_slides', 'medium', label, s.part, 'has a picture and no text, so a screen reader has no slide title or text to announce');
      } else if (frames === 0) {
        ctx.add('empty_slides', 'medium', label, s.part, 'has no text, picture, table or chart');
      }
    }

    // Speaker notes travel with the deck, so they are searched like slide text.
    const notesRel = relOfType(srels, '/notesSlide');
    let body = '';
    if (notesRel && hasPart(zip, notesRel.target)) {
      const nd = xmlPart(zip, notesRel.target);
      ctx.handled.add(notesRel.target.toLowerCase());
      const ntree = spTreeOf(nd);
      if (ntree) {
        walkShapes(ntree, IDENTITY, (el) => {
          const { ph } = nvOf(el);
          if (ph && ph.attrs.type === 'body') body += textOf(el);
        });
      }
      ctx.units.push({ where: 'speaker notes of ' + label, part: notesRel.target, text: textOf(nd), visible: body });
    }
    if (body.trim()) withNotes++; else noNotes.push(s.n);
  }

  if (noNotes.length) {
    const where = noNotes.length === slides.length ? 'every slide' : (noNotes.length === 1 ? 'slide ' : 'slides ') + rangeList(noNotes);
    ctx.add('speaker_notes', 'low', where, null, 'no speaker notes, so the presenter has no script for '
      + (noNotes.length === 1 ? 'this slide' : 'these slides'));
  }

  notes.layout = !cx || !cy ? 'slide size unknown, so shape positions were not measured'
    : measured + ' shape(s) measured on ' + slides.length + ' slide(s) against the slide edges and a content line at '
      + inches(line) + ' in' + (scaled ? ' (the 6.70 in default scaled to this slide height)' : '')
      + (unmeasured ? '; ' + unmeasured + ' shape(s) had no position the checker could resolve, so check them by eye' : '');
  partial.layout = !cx || !cy || unmeasured > 0;
  notes.placeholder_text = 'slide text, tables, alt text, link tooltips and speaker notes searched';
  notes.empty_slides = slides.length + ' slide(s)';
  notes.image_only_slides = slides.length + ' slide(s)';
  notes.alt_text = stats.alts + ' picture(s) and chart(s) on slides' + (stats.decorative ? ', ' + stats.decorative + ' marked decorative' : '');
  notes.speaker_notes = 'notes on ' + withNotes + ' of ' + slides.length + ' slide(s)';

  return {
    categories: PPTX_CATEGORIES,
    notes,
    partial,
    placed: picturesPlaced,
    placedWhere: 'on slides',
    summary: {
      slides: slides.length,
      hidden_slides: hidden,
      slide_size_in: cx && cy ? [Number(inches(cx)), Number(inches(cy))] : null,
      slide_ratio: ratio === null ? null : Number(ratio.toFixed(3)),
      content_line_in: line === null ? null : Number(inches(line)),
      slides_with_notes: withNotes,
      pictures_on_slides: picturesPlaced,
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// DOCX.

const STOP_AT_PARAGRAPH = new Set(['w:p']);
const NOT_VISIBLE = new Set(['w:delText', 'w:instrText']);
const on = (el) => el && el.attrs['w:val'] !== '0' && el.attrs['w:val'] !== 'false';

function styleLevels(doc) {
  const byName = (t) => { const m = /^heading\s*([1-9])$/i.exec(t || ''); return m ? Number(m[1]) : 0; };
  const styles = new Map();
  for (const s of kids(doc, 'w:style')) {
    if ((s.attrs['w:type'] || 'paragraph') !== 'paragraph' || !s.attrs['w:styleId']) continue;
    const nm = kid(s, 'w:name');
    const based = kid(s, 'w:basedOn');
    const ol = kid(kid(s, 'w:pPr'), 'w:outlineLvl');
    styles.set(s.attrs['w:styleId'], {
      name: nm ? nm.attrs['w:val'] : '',
      basedOn: based ? based.attrs['w:val'] : null,
      outline: ol ? ol.attrs['w:val'] : null,
    });
  }
  const memo = new Map();
  const level = (id, depth = 0) => {
    if (!id || depth > 20) return 0;
    if (memo.has(id)) return memo.get(id);
    const s = styles.get(id);
    let v;
    if (!s) v = byName(id);
    else if (byName(s.name)) v = byName(s.name); // built-in headings keep the English name "heading N" in any locale
    else if (s.outline !== null) { const o = parseInt(s.outline, 10); v = o >= 0 && o <= 8 ? o + 1 : 0; }
    else v = level(s.basedOn, depth + 1);
    memo.set(id, v);
    return v;
  };
  return level;
}

// Walks one story part (body, header, footer, notes, comments) in document order, paragraph by paragraph.
function walkStory(zip, ctx, part, role, o, stats) {
  const doc = xmlPart(zip, part);
  if (!doc) return;
  const top = role ? doc : kid(doc, 'w:body');
  if (!top) throw new CouldNotRun('part ' + part + ' has no document body');
  ctx.handled.add(part.toLowerCase());
  const prefix = role ? role + ' (' + part + '), ' : '';
  let paras = 0;
  let tables = 0;
  let under = null;
  const paraWhere = (n) => prefix + 'paragraph ' + n + (under ? ', under heading "' + under + '"' : '');
  const placeWhere = (st) => (st.para ? paraWhere(st.para) : prefix.replace(/, $/, '') || 'document body');

  const onParagraph = (p, st) => {
    let where = paraWhere(st.para);
    const pPr = kid(p, 'w:pPr');
    let level = 0;
    if (o.headings && !st.box) {
      const own = kid(pPr, 'w:outlineLvl');
      if (own && /^\d$/.test(own.attrs['w:val'] || '')) { const v = Number(own.attrs['w:val']); level = v <= 8 ? v + 1 : 0; }
      else { const ps = kid(pPr, 'w:pStyle'); level = o.levelOf(ps ? ps.attrs['w:val'] : null); }
    }
    const text = textOf(p, { stop: STOP_AT_PARAGRAPH });
    if (level) {
      stats.headings++;
      const shown = safeLabel(textOf(p, { stop: STOP_AT_PARAGRAPH, omit: NOT_VISIBLE }), ctx);
      where = prefix + 'paragraph ' + st.para + ', heading ' + stats.headings + (shown ? ' "' + shown + '"' : '');
      if (level > stats.prevLevel + 1) {
        ctx.add('heading_order', 'medium', where, part, stats.prevLevel
          ? 'Heading ' + level + ' follows Heading ' + stats.prevLevel + ', so a level is skipped'
          : 'the first heading is Heading ' + level + '; start at Heading 1');
      }
      stats.prevLevel = level;
      under = shown;
    }
    if (text.trim()) {
      ctx.units.push({ where, part, text, visible: o.placeholders ? textOf(p, { stop: STOP_AT_PARAGRAPH, omit: NOT_VISIBLE }) : null });
    }
  };

  const onDrawing = (d, st) => {
    const docPr = kid(d, 'wp:docPr');
    const attrs = docPr ? docPr.attrs : {};
    const gd = find(d, 'a:graphicData');
    const uri = gd ? gd.attrs.uri || '' : '';
    const isPicture = /\/picture$/.test(uri) || (/wordprocessingGroup$/.test(uri) && find(gd, 'pic:pic'));
    const shown = safeLabel(attrs.name, ctx);
    const where = placeWhere(st) + ', image ' + (attrs.id || '?') + (shown ? ' "' + shown + '"' : '');
    if (attrs.name) ctx.units.push({ where: where + ', name', part, text: attrs.name, visible: null });
    const alt = [attrs.descr, attrs.title].filter(Boolean).join('\n');
    if (alt) ctx.units.push({ where: where + ', alt text', part, text: alt, visible: o.placeholders ? alt : null });
    if (o.alt && (isPicture || isChartUri(uri))) {
      if (isPicture) stats.placed++;
      checkAlt(attrs, docPr || d, isPicture ? 'image' : 'chart', where, part, ctx, stats);
    }
  };

  const onSdt = (sdt, st, nextPara) => {
    if (!o.placeholders || !on(kid(kid(sdt, 'w:sdtPr'), 'w:showingPlcHdr'))) return;
    const at = find(kid(sdt, 'w:sdtContent'), 'w:p') ? nextPara : st.para;
    ctx.add('placeholder_text', 'high', at ? paraWhere(at) : placeWhere(st), part, 'a content control still shows its placeholder prompt');
  };

  const onTable = (tbl, nextPara) => {
    tables++;
    stats.tables++;
    if (!o.tables) return;
    const rows = kids(tbl, 'w:tr');
    const cols = rows.length ? findAll(rows[0], 'w:tc').length : 0;
    if (rows.length < 2 || cols < 2) return;
    const isHeader = (tr) => on(kid(kid(tr, 'w:trPr'), 'w:tblHeader'));
    let k = 0;
    while (k < rows.length && isHeader(rows[k])) k++;
    const where = prefix + 'table ' + tables + ' (its first cell is paragraph ' + nextPara + ')';
    if (k === 0) {
      ctx.add('table_headers', 'low', where, part, 'no row is marked "Repeat as header row", so a tagged PDF gets no header cells; ignore this for a layout table');
    } else if (rows.slice(0, k).every((r) => !textOf(r).trim()) && rows.slice(k).some((r) => textOf(r).trim())) {
      ctx.add('table_headers', 'low', where, part, 'the header row is empty');
    }
  };

  const visit = (el, st) => {
    for (const c of branch(el)) {
      let next = st;
      if (c.name === 'w:p') { paras++; next = { para: paras, box: st.box }; onParagraph(c, next); }
      else if (c.name === 'w:txbxContent') next = { para: st.para, box: true };
      else if (c.name === 'wp:inline' || c.name === 'wp:anchor') onDrawing(c, st);
      else if (c.name === 'w:sdt') onSdt(c, st, paras + 1);
      else if (c.name === 'w:tbl') onTable(c, paras + 1);
      else if (c.name === 'v:imagedata' && o.alt) stats.legacy++;
      if (c.attrs['w:tooltip']) {
        ctx.units.push({ where: placeWhere(st) + ', link tooltip', part, text: c.attrs['w:tooltip'], visible: o.placeholders ? c.attrs['w:tooltip'] : null });
      }
      visit(c, next);
    }
  };
  visit(top, { para: null, box: false });
  if (!role) stats.paragraphs = paras;
}

const STORY_ROLES = [['/header', 'header'], ['/footer', 'footer'], ['/footnotes', 'footnotes'], ['/endnotes', 'endnotes'], ['/comments', 'comments']];

function checkDocx(zip, ctx) {
  const docPart = mainPart(zip, 'word/document.xml');
  const doc = hasPart(zip, docPart) ? xmlPart(zip, docPart) : null;
  if (!doc || !/(?:^|:)document$/.test(doc.name)) throw new CouldNotRun('the file has no document part, so it is not a Word package');
  if (doc.name !== 'w:document') throw prefixError(docPart);
  const rels = relsOf(zip, docPart);
  const stylesRel = relOfType(rels, '/styles');
  const stylesPart = stylesRel && hasPart(zip, stylesRel.target) ? stylesRel.target : 'word/styles.xml';
  const styles = hasPart(zip, stylesPart) ? xmlPart(zip, stylesPart) : null;
  const levelOf = styleLevels(styles || { children: [] });
  const stats = { headings: 0, prevLevel: 0, alts: 0, decorative: 0, legacy: 0, placed: 0, tables: 0, paragraphs: 0 };

  walkStory(zip, ctx, docPart, null, { headings: true, alt: true, placeholders: true, tables: true, levelOf }, stats);
  for (const r of rels) {
    if (r.external || !hasPart(zip, r.target)) continue;
    const role = STORY_ROLES.find(([suffix]) => r.type.endsWith(suffix));
    if (!role) continue;
    const isComments = role[1] === 'comments';
    walkStory(zip, ctx, r.target, role[1], { headings: false, alt: !isComments, placeholders: !isComments, tables: false, levelOf }, stats);
  }
  if (stats.headings === 0) {
    ctx.add('heading_order', 'low', 'document body', docPart, 'the document has no headings, so screen-reader users cannot navigate it by heading');
  }

  // The title property: tagged-PDF export takes the PDF title from it.
  const coreRel = relOfType(relsOf(zip, ''), '/core-properties');
  const corePart = coreRel && hasPart(zip, coreRel.target) ? coreRel.target : 'docProps/core.xml';
  const core = hasPart(zip, corePart) ? xmlPart(zip, corePart) : null;
  const title = core ? textOf(find(core, 'dc:title')).trim() : '';
  if (!title) {
    ctx.add('document_title', 'medium', 'document properties', core ? corePart : null,
      'the Title property (File > Info) is empty; a tagged PDF takes its title from it, and PDF accessibility checks fail without one');
  }

  return {
    categories: DOCX_CATEGORIES,
    notes: {
      heading_order: stats.headings + ' heading(s) in the body, levels read from paragraph styles and outline levels',
      alt_text: stats.alts + ' image(s) and chart(s) in the body, headers and footers'
        + (stats.decorative ? ', ' + stats.decorative + ' marked decorative' : '')
        + (stats.legacy ? '; ' + stats.legacy + ' legacy VML image(s) not checked, so open them in Word' : ''),
      placeholder_text: 'body, headers, footers, footnotes, endnotes, alt text and content controls searched',
      table_headers: stats.tables + ' table(s); layout tables of one row or one column are skipped',
      document_title: title ? 'the Title property is set' : 'the Title property is empty',
    },
    partial: { alt_text: stats.legacy > 0 },
    placed: stats.placed,
    placedWhere: 'in the document',
    summary: { paragraphs: stats.paragraphs, headings: stats.headings, tables: stats.tables, images_placed: stats.placed },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Whole package.

const ROLES = [
  [/^ppt\/notesSlides\//i, 'speaker notes'], [/^ppt\/slideLayouts\//i, 'slide layout'],
  [/^ppt\/slideMasters\//i, 'slide master'], [/^ppt\/(?:notes|handout)Masters\//i, 'notes or handout master'],
  [/comment/i, 'comments'], [/^(?:ppt|word)\/charts\//i, 'chart'], [/^(?:ppt|word)\/diagrams\//i, 'SmartArt'],
  [/^docProps\//i, 'document properties'], [/^customXml\//i, 'custom XML'], [/^(?:ppt|word)\/theme\//i, 'theme'],
  [/^word\/header/i, 'header'], [/^word\/footer/i, 'footer'], [/^word\/(?:foot|end)notes/i, 'notes'],
];

// Everything not already walked: layouts, masters, charts, comments, properties, custom XML, and the external
// link targets in every relationships part. Personal data and residue are searched here; placeholders are not,
// because layouts carry PowerPoint's own prompt text by design.
function scanRemainingParts(zip, ctx) {
  for (const [key, e] of zip.entries) {
    if (ctx.handled.has(key) || e.name.endsWith('/')) continue;
    const isRels = /\.rels$/i.test(e.name);
    if (!isRels && !/\.xml$/i.test(e.name)) continue;
    const doc = xmlPart(zip, e.name);
    if (!doc) continue;
    if (isRels) {
      const ext = kids(doc, 'Relationship').filter((r) => r.attrs.TargetMode === 'External').map((r) => r.attrs.Target || '');
      if (ext.length) ctx.units.push({ where: 'link targets in ' + e.name, part: e.name, text: ext.join('\n'), visible: null });
      continue;
    }
    const role = (ROLES.find(([re]) => re.test(e.name)) || [null, 'package part'])[1];
    const where = role + ' (' + e.name + ')';
    const text = textOf(doc);
    if (text.trim()) ctx.units.push({ where, part: e.name, text, visible: null });
    const attrs = findAll(doc, (c) => c.attrs.descr || c.attrs.title || c.attrs.tooltip || c.attrs['w:tooltip']
      || (/(?:^|:)(?:cNvPr|docPr)$/.test(c.name) && c.attrs.name))
      .flatMap((c) => [c.attrs.descr, c.attrs.title, c.attrs.tooltip, c.attrs['w:tooltip'], /(?:cNvPr|docPr)$/.test(c.name) ? c.attrs.name : null])
      .filter(Boolean);
    if (attrs.length) ctx.units.push({ where: where + ', alt text, titles and shape names', part: e.name, text: attrs.join('\n'), visible: null });
  }
}

const IMAGE_EXT = /\.(?:png|jpe?g|jfif|gif|bmp|tiff?|emf|wmf|svg|webp|ico)$/i;
const AV_EXT = /\.(?:mp4|m4v|mov|wmv|avi|mpe?g|mkv|webm|mp3|m4a|wav|wma|aac|ogg)$/i;
const EMBED_DIR = /^(?:ppt|word)\/embeddings\//i;

function inventory(zip) {
  let images = 0;
  let embedded = 0;
  for (const e of zip.entries.values()) {
    if (e.name.endsWith('/')) continue;
    if (IMAGE_EXT.test(e.name)) images++;
    else if (EMBED_DIR.test(e.name) || AV_EXT.test(e.name)) embedded++;
  }
  return { images, embedded };
}

const FONT_EL = new Set(['a:latin', 'a:ea', 'a:cs', 'a:sym']);

function fontsNamed(zip) {
  const set = new Set();
  for (const [key, e] of zip.entries) {
    if (!/\.xml$/i.test(e.name)) continue;
    const doc = zip.cache.has(key) ? zip.cache.get(key) : xmlPart(zip, e.name);
    if (!doc) continue;
    for (const c of findAll(doc, (x) => FONT_EL.has(x.name) || x.name === 'w:rFonts')) {
      const vals = c.name === 'w:rFonts' ? [c.attrs['w:ascii'], c.attrs['w:hAnsi'], c.attrs['w:eastAsia'], c.attrs['w:cs']] : [c.attrs.typeface];
      for (const v of vals) if (v && v.trim() && !v.startsWith('+')) set.add(v.trim());
    }
  }
  return [...set].sort().slice(0, 50);
}

function checkPackage(buf, opts = {}) {
  const kind = opts.kind;
  if (kind !== 'pptx' && kind !== 'docx') throw new CouldNotRun('kind must be pptx or docx');
  const zip = readZip(buf);
  const ctx = newContext(opts);
  const res = kind === 'pptx' ? checkPptx(zip, ctx, opts) : checkDocx(zip, ctx, opts);
  scanRemainingParts(zip, ctx);
  for (const u of ctx.units) scanUnit(u, ctx);
  const inv = inventory(zip);

  const notes = Object.assign({}, res.notes, {
    personal_data: 'email, SSN and phone patterns searched in every XML part of the package'
      + (ctx.samples ? '; ' + ctx.samples + ' documented sample value(s) skipped' : '')
      + (ctx.allowed ? '; ' + ctx.allowed + ' value(s) cleared by the allow file' : ''),
    residue: ctx.residue ? ctx.residue.length + ' pattern(s) searched in every XML part of the package'
      : 'no --residue file was given, so real-data residue was not searched',
    text_in_images: inv.images ? inv.images + ' image file(s) in the package (' + res.placed + ' placed ' + res.placedWhere
      + '); text inside images cannot be searched, so a person reads each one' : 'no images in the package',
    embedded_files: inv.embedded ? inv.embedded + ' embedded file(s) (workbooks, objects, video or audio) were not opened or searched'
      : 'no embedded files',
  });
  const partial = Object.assign({}, res.partial, { residue: !ctx.residue, text_in_images: inv.images > 0, embedded_files: inv.embedded > 0 });

  const categories = {};
  for (const c of res.categories) {
    const state = ctx.findings.some((f) => f.check === c) ? FINDING : partial[c] ? NOT_CHECKED : CLEAN;
    categories[c] = { state, note: notes[c] };
  }

  const rank = (f) => SEVERITIES.indexOf(f.severity) * 100 + res.categories.indexOf(f.check);
  const sorted = ctx.findings.map((f, i) => ({ f, i })).sort((a, b) => rank(a.f) - rank(b.f) || a.i - b.i).map((x) => x.f);
  const counts = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const f of sorted) counts[f.severity]++;
  const blocking = counts.critical + counts.high + counts.medium;
  const notChecked = res.categories.filter((c) => categories[c].state === NOT_CHECKED);
  let verdict;
  let reason;
  if (blocking) {
    verdict = 'Not ready';
    reason = blocking + ' blocking finding(s): ' + ['critical', 'high', 'medium'].filter((s) => counts[s]).map((s) => counts[s] + ' ' + s).join(', ');
  } else if (counts.low || notChecked.length) {
    verdict = 'Ready with follow-ups';
    reason = [counts.low ? counts.low + ' low finding(s)' : null, notChecked.length ? 'not checked: ' + notChecked.join(', ') : null]
      .filter(Boolean).join('; ') + '; a person clears these before sending';
  } else {
    verdict = 'Ready';
    reason = 'every category was checked and nothing was found';
  }

  const report = {
    tool: NAME,
    report_version: 1,
    file: opts.fileLabel || null,
    kind,
    verdict,
    verdict_reason: reason,
    summary: Object.assign({}, res.summary, {
      images_in_package: inv.images,
      embedded_files: inv.embedded,
      fonts_named: fontsNamed(zip),
      findings: counts,
    }),
    options: {
      residue_patterns: ctx.residue ? ctx.residue.length : 0,
      allow_patterns: ctx.allow ? ctx.allow.length : 0,
    },
    categories,
    findings: sorted.slice(0, MAX_LISTED).map((f, i) => Object.assign({ id: 'F' + (i + 1) }, f)),
  };
  if (sorted.length > MAX_LISTED) report.findings_not_listed = sorted.length - MAX_LISTED;
  return report;
}

// ---------------------------------------------------------------------------------------------------------------
// Command line.

// Plain stat then readFile: no O_NOFOLLOW or O_NONBLOCK, which Windows does not offer.
function readFileChecked(file, max, label) {
  let st;
  try { st = fs.statSync(file); } catch (e) { throw new CouldNotRun('cannot read ' + label + ' (' + (e.code || 'error') + ')'); }
  if (!st.isFile()) throw new CouldNotRun(label + ' is not a regular file');
  if (st.size > max) throw new CouldNotRun(label + ' is ' + st.size + ' bytes; the limit is ' + max);
  let buf;
  try { buf = fs.readFileSync(file); } catch (e) { throw new CouldNotRun('cannot read ' + label + ' (' + (e.code || 'error') + ')'); }
  if (buf.length > max) throw new CouldNotRun(label + ' grew past ' + max + ' bytes while being read');
  return buf;
}

const USAGE = 'usage: node deliverable-check.cjs <file.pptx|file.docx> [--residue <file>] [--allow <file>] [--content-bottom <inches>] [--out <report.json>]';

function parseArgs(args) {
  if (!Array.isArray(args)) throw new CouldNotRun(USAGE);
  const o = { file: null, residue: null, allow: null, contentBottom: null, out: null };
  const keys = { '--residue': 'residue', '--allow': 'allow', '--content-bottom': 'contentBottom', '--out': 'out' };
  for (let i = 0; i < args.length; i++) {
    const a = String(args[i]);
    if (Object.prototype.hasOwnProperty.call(keys, a)) {
      if (i + 1 >= args.length) throw new CouldNotRun(a + ' needs a value; ' + USAGE);
      if (o[keys[a]] !== null) throw new CouldNotRun(a + ' is given twice');
      o[keys[a]] = String(args[++i]);
    } else if (a.startsWith('--')) throw new CouldNotRun('unknown option ' + a + '; ' + USAGE);
    else if (o.file === null) o.file = a;
    else throw new CouldNotRun('more than one input file given; ' + USAGE);
  }
  if (o.file === null) throw new CouldNotRun(USAGE);
  if (o.contentBottom !== null) {
    const v = /^\d+(?:\.\d+)?$/.test(o.contentBottom) ? Number(o.contentBottom) : NaN;
    if (!(v > 0 && v <= 100)) throw new CouldNotRun('--content-bottom must be a number of inches above 0, such as 6.70');
    o.contentBottom = v;
  }
  return o;
}

function kindOf(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.pptx') return 'pptx';
  if (ext === '.docx') return 'docx';
  throw new CouldNotRun('expected a .pptx or .docx file; HTML pages and other formats are checked by hand (see SKILL.md)');
}

function samePath(a, b) {
  const ra = path.resolve(a);
  const rb = path.resolve(b);
  return process.platform === 'win32' ? ra.toLowerCase() === rb.toLowerCase() : ra === rb;
}

function run(args, io) {
  const out = io || {
    log: (s) => process.stdout.write(s + '\n'),
    error: (s) => process.stderr.write(s + '\n'),
    writeFile: (f, s) => fs.writeFileSync(f, s),
  };
  let opts = null;
  const emit = (json) => { if (opts && opts.out) out.writeFile(opts.out, json + '\n'); else out.log(json); };
  try {
    opts = parseArgs(args);
    const kind = kindOf(opts.file);
    if (opts.out && [opts.file, opts.residue, opts.allow].some((f) => f && samePath(f, opts.out))) {
      const bad = opts.out;
      opts.out = null; // never overwrite an input with the report
      throw new CouldNotRun('--out ' + path.basename(bad) + ' would overwrite an input file');
    }
    if (kind === 'docx' && opts.contentBottom !== null) throw new CouldNotRun('--content-bottom applies to a .pptx only');
    const buf = readFileChecked(opts.file, MAX_FILE_BYTES, path.basename(opts.file));
    let residue = null;
    let allow = null;
    if (opts.residue) {
      residue = loadPatterns(decodeText(readFileChecked(opts.residue, MAX_PATTERN_FILE_BYTES, 'the residue file')), 'residue file', false);
      if (residue.length === 0) throw new CouldNotRun('the residue file has no patterns, and a residue check with no patterns proves nothing');
    }
    if (opts.allow) allow = loadPatterns(decodeText(readFileChecked(opts.allow, MAX_PATTERN_FILE_BYTES, 'the allow file')), 'allow file', true);
    const report = checkPackage(buf, { kind, residue, allow, contentBottomIn: opts.contentBottom, fileLabel: path.basename(opts.file) });
    const json = JSON.stringify(report, null, 2);
    try { emit(json); } catch (e) { throw new CouldNotRun('cannot write the report (' + (e.code || 'error') + ')'); }
    out.error(NAME + ': ' + report.verdict + ' (' + report.verdict_reason + ')');
    return report.verdict === 'Ready' ? 0 : 1;
  } catch (e) {
    const msg = e instanceof CouldNotRun ? e.message : 'internal error: ' + String((e && e.message) || e).slice(0, 200);
    out.error(NAME + ': COULD NOT RUN: ' + msg);
    // Overwrites any earlier report at --out, so a stale "Ready" is never left behind.
    const fail = { tool: NAME, report_version: 1, file: opts && opts.file ? path.basename(opts.file) : null, verdict: 'Could not run', reason: msg };
    try { emit(JSON.stringify(fail, null, 2)); } catch (_) { /* the stderr line above already says it could not run */ }
    return 2;
  }
}

module.exports = {
  readZip, readPart, parseXml, textOf, crc32, loadPatterns, personalData, checkPackage, parseArgs, run, CouldNotRun,
  MAX_ENTRIES, MAX_PART_BYTES, DEFAULT_CONTENT_BOTTOM, EMU_PER_IN,
};

if (require.main === module) {
  let code = 2;
  try { code = run(process.argv.slice(2)); } catch (e) { process.stderr.write(NAME + ': COULD NOT RUN: ' + e.message + '\n'); }
  process.exitCode = code === 0 || code === 1 ? code : 2; // anything unexpected is a 2, never a 0
}
