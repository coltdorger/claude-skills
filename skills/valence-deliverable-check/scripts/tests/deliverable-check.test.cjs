'use strict';
// Run: node skills/valence-deliverable-check/scripts/tests/deliverable-check.test.cjs
// Fixtures are built in memory with a minimal ZIP writer below. They hold placeholder content only: no real client,
// person, record or finding. Values that look personal are invented and use reserved or test-only shapes.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { spawnSync } = require('child_process');
const {
  checkPackage, readZip, readPart, parseXml, textOf, crc32, loadPatterns, personalData, run, CouldNotRun, MAX_ENTRIES,
  MAX_PART_BYTES,
} = require('../deliverable-check.cjs');

let n = 0;
const ok = (v, msg) => { assert.ok(v, msg); n++; };
const eq = (a, b, msg) => { assert.strictEqual(a, b, msg + '\n  got ' + JSON.stringify(a)); n++; };
const refuses = (fn, re, msg) => {
  let err = null;
  try { fn(); } catch (e) { err = e; }
  assert.ok(err instanceof CouldNotRun, msg + ': expected CouldNotRun, got ' + (err && err.stack));
  assert.ok(re.test(err.message), msg + ': ' + err.message);
  n++;
};

// ---------------------------------------------------------------------------------------------------------------
// A minimal ZIP writer: stored or deflate entries, with overrides for building damaged packages.

const CRC = Array.from({ length: 256 }, (_, k) => {
  let c = k;
  for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (b) => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

function zip(files, o = {}) {
  const locals = [];
  const central = [];
  let offset = 0;
  for (const f of files) {
    const data = Buffer.isBuffer(f.data) ? f.data : Buffer.from(String(f.data), 'utf8');
    const method = f.method !== undefined ? f.method : f.store ? 0 : 8;
    const body = method === 8 ? zlib.deflateRawSync(data) : data;
    const name = Buffer.from(f.name, 'utf8');
    const c = f.crc !== undefined ? f.crc : crc(data);
    const usize = f.usize !== undefined ? f.usize : data.length;
    const flags = 0x800 | (f.flags || 0);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(flags, 6); lh.writeUInt16LE(method, 8);
    lh.writeUInt32LE(c, 14); lh.writeUInt32LE(body.length, 18); lh.writeUInt32LE(usize, 22); lh.writeUInt16LE(name.length, 26);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(flags, 8);
    ch.writeUInt16LE(method, 10); ch.writeUInt32LE(c, 16); ch.writeUInt32LE(body.length, 20); ch.writeUInt32LE(usize, 24);
    ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(offset, 42);
    locals.push(lh, name, body);
    central.push(ch, name);
    offset += 30 + name.length + body.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  const count = o.count !== undefined ? o.count : files.length;
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(count, 8); end.writeUInt16LE(count, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

// ---------------------------------------------------------------------------------------------------------------
// PPTX fixtures. Boxes are in inches.

const IN = 914400;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
  + 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" '
  + 'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
const DEC = '<a:extLst><a:ext uri="{C183D7F6-B498-43B3-948B-1728B52AA6E4}"><adec:decorative '
  + 'xmlns:adec="http://schemas.microsoft.com/office/drawing/2017/decorative" val="1"/></a:ext></a:extLst>';
const rels = (list) => XML + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
  + list.map(([id, type, target, ext]) => '<Relationship Id="' + id + '" Type="' + REL + type + '" Target="' + esc(target) + '"'
    + (ext ? ' TargetMode="External"' : '') + '/>').join('') + '</Relationships>';
const emu = (v) => Math.round(v * IN);
const xfrm = (b) => (b ? '<a:xfrm' + (b.rot ? ' rot="' + b.rot + '"' : '') + '><a:off x="' + emu(b.x) + '" y="' + emu(b.y) + '"/><a:ext cx="'
  + emu(b.w) + '" cy="' + emu(b.h) + '"/></a:xfrm>' : '');
const cNvPr = (o, fallback) => '<p:cNvPr id="' + o.id + '" name="' + esc(o.name || fallback + ' ' + o.id) + '"'
  + (o.descr !== undefined ? ' descr="' + esc(o.descr) + '"' : '') + '>' + (o.decorative ? DEC : '') + '</p:cNvPr>';

function sp(o) {
  const ph = o.ph ? '<p:ph' + (o.ph.type ? ' type="' + o.ph.type + '"' : '') + (o.ph.idx ? ' idx="' + o.ph.idx + '"' : '') + '/>' : '';
  const text = o.text === undefined ? '' : '<p:txBody><a:bodyPr/><a:lstStyle/>' + [].concat(o.text).map((t) => '<a:p><a:r><a:rPr lang="en-US"'
    + (o.tooltip ? '><a:hlinkClick r:id="" tooltip="' + esc(o.tooltip) + '"/></a:rPr>' : '/>') + '<a:t>' + esc(t) + '</a:t></a:r></a:p>').join('')
    + '</p:txBody>';
  return '<p:sp><p:nvSpPr>' + cNvPr(o, 'TextBox') + '<p:cNvSpPr/><p:nvPr>' + ph + '</p:nvPr></p:nvSpPr><p:spPr>' + xfrm(o.box)
    + '</p:spPr>' + text + '</p:sp>';
}
const pic = (o) => '<p:pic><p:nvPicPr>' + cNvPr(o, 'Picture') + '<p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rId9"/>'
  + '</p:blipFill><p:spPr>' + xfrm(o.box) + '</p:spPr></p:pic>';
function grp(o, children) {
  const a = (v) => emu(v);
  return '<p:grpSp><p:nvGrpSpPr><p:cNvPr id="' + o.id + '" name="Group ' + o.id + '"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr>'
    + '<a:xfrm><a:off x="' + a(o.box.x) + '" y="' + a(o.box.y) + '"/><a:ext cx="' + a(o.box.w) + '" cy="' + a(o.box.h) + '"/>'
    + '<a:chOff x="' + a(o.child.x) + '" y="' + a(o.child.y) + '"/><a:chExt cx="' + a(o.child.w) + '" cy="' + a(o.child.h) + '"/></a:xfrm>'
    + '</p:grpSpPr>' + children.join('') + '</p:grpSp>';
}
const frame = (o, data) => '<p:graphicFrame><p:nvGraphicFramePr>' + cNvPr(o, 'Frame') + '<p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>'
  + '<p:xfrm><a:off x="' + emu(o.box.x) + '" y="' + emu(o.box.y) + '"/><a:ext cx="' + emu(o.box.w) + '" cy="' + emu(o.box.h) + '"/></p:xfrm>'
  + '<a:graphic>' + data + '</a:graphic></p:graphicFrame>';
const table = (o) => frame(o, '<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblGrid><a:gridCol w="914400"/></a:tblGrid>'
  + o.rows.map(([h, t]) => '<a:tr h="' + emu(h) + '"><a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:t>' + esc(t) + '</a:t></a:r></a:p></a:txBody></a:tc></a:tr>').join('')
  + '</a:tbl></a:graphicData>');
const chart = (o) => frame(o, '<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart '
  + 'xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" r:id="rId5"/></a:graphicData>');
const ROOT = '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>';
const slideXml = (shapes, o) => XML + '<p:sld ' + NS + (o.hidden ? ' show="0"' : '') + '><p:cSld><p:spTree>' + ROOT + shapes.join('')
  + '</p:spTree></p:cSld></p:sld>';
const notesXml = (text) => XML + '<p:notes ' + NS + '><p:cSld><p:spTree>' + ROOT + sp({ id: 2, name: 'Slide Image Placeholder 1', ph: { type: 'sldImg' } })
  + sp({ id: 3, name: 'Notes Placeholder 2', ph: { type: 'body', idx: 1 }, text }) + '</p:spTree></p:cSld></p:notes>';
const LAYOUT = XML + '<p:sldLayout ' + NS + '><p:cSld><p:spTree>' + ROOT
  + sp({ id: 2, name: 'Title 1', ph: { type: 'title' }, box: { x: 0.6, y: 0.5, w: 12, h: 1 } })
  + sp({ id: 3, name: 'Content Placeholder 2', ph: { idx: 1 }, box: { x: 0.6, y: 1.6, w: 12, h: 4.8 } })
  + sp({ id: 4, name: 'Tall Placeholder 3', ph: { type: 'body', idx: 10 }, box: { x: 0.6, y: 1.6, w: 12, h: 5.6 } })
  + '</p:spTree></p:cSld></p:sldLayout>';
const MASTER = XML + '<p:sldMaster ' + NS + '><p:cSld><p:spTree>' + ROOT
  + sp({ id: 2, name: 'Title Placeholder 1', ph: { type: 'title' }, box: { x: 0.6, y: 0.4, w: 12, h: 1 }, text: 'Click to edit Master title style' })
  + sp({ id: 3, name: 'Text Placeholder 2', ph: { type: 'body', idx: 1 }, box: { x: 0.6, y: 1.6, w: 12, h: 4.8 } })
  + sp({ id: 4, name: 'Footer Placeholder 3', ph: { type: 'ftr', idx: 11 }, box: { x: 4, y: 6.95, w: 5, h: 0.4 } })
  + '</p:spTree></p:cSld><p:txStyles/></p:sldMaster>';

// A clean slide: a title that inherits its position from the layout, a body text box, a footer that inherits from
// the master and sits below the content line, and a slide number placed below it too.
const cleanSlide = (k) => ({
  shapes: [
    sp({ id: 2, name: 'Title 1', ph: { type: 'title' }, text: 'Renew a license, step ' + k }),
    sp({ id: 3, name: 'TextBox 3', box: { x: 0.6, y: 1.6, w: 12, h: 4 }, text: 'Open the record and choose Renew.' }),
    sp({ id: 4, name: 'Footer Placeholder 4', ph: { type: 'ftr', idx: 11 }, text: 'Sample agency' }),
    sp({ id: 5, name: 'Slide Number Placeholder 5', ph: { type: 'sldNum', idx: 12 }, box: { x: 11, y: 6.9, w: 1.5, h: 0.4 }, text: String(k) }),
  ],
  notes: 'Say what the step does.',
});
const withShapes = (...extra) => { const s = cleanSlide(1); s.shapes = s.shapes.concat(extra); return s; };

function pptx(o = {}) {
  const slides = o.slides || [cleanSlide(1), cleanSlide(2)];
  const size = o.size || [12192000, 6858000];
  const files = [
    { name: '[Content_Types].xml', data: XML + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>' },
    { name: '_rels/.rels', data: rels([['rId1', 'officeDocument', 'ppt/presentation.xml']]) },
    { name: 'ppt/presentation.xml', data: XML + '<p:presentation ' + NS + '><p:sldIdLst>'
      + slides.map((_, i) => '<p:sldId id="' + (256 + i) + '" r:id="rId' + (i + 1) + '"/>').join('') + '</p:sldIdLst>'
      + (o.noSize ? '' : '<p:sldSz cx="' + size[0] + '" cy="' + size[1] + '"/>') + '</p:presentation>' },
    { name: 'ppt/_rels/presentation.xml.rels', data: rels(slides.map((_, i) => ['rId' + (i + 1), 'slide', 'slides/slide' + (i + 1) + '.xml'])) },
    { name: 'ppt/slideLayouts/slideLayout1.xml', data: LAYOUT },
    { name: 'ppt/slideLayouts/_rels/slideLayout1.xml.rels', data: rels([['rId1', 'slideMaster', '../slideMasters/slideMaster1.xml']]) },
    { name: 'ppt/slideMasters/slideMaster1.xml', data: MASTER },
  ];
  slides.forEach((s, i) => {
    const k = i + 1;
    files.push({ name: 'ppt/slides/slide' + k + '.xml', data: slideXml(s.shapes, s) });
    const r = [['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml']];
    if (s.notes !== undefined) {
      r.push(['rId2', 'notesSlide', '../notesSlides/notesSlide' + k + '.xml']);
      files.push({ name: 'ppt/notesSlides/notesSlide' + k + '.xml', data: notesXml(s.notes) });
    }
    (s.links || []).forEach((t, j) => r.push(['rId' + (10 + j), 'hyperlink', t, true]));
    files.push({ name: 'ppt/slides/_rels/slide' + k + '.xml.rels', data: rels(r) });
  });
  for (const m of o.media || []) files.push({ name: m, data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]), store: true });
  for (const f of o.extra || []) files.push(f);
  return zip(files);
}

// ---------------------------------------------------------------------------------------------------------------
// DOCX fixtures.

const WNS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" '
  + 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" '
  + 'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" '
  + 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
  + 'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';
const run_ = (t) => '<w:r><w:t xml:space="preserve">' + esc(t) + '</w:t></w:r>';
const para = (text, style) => '<w:p>' + (style ? '<w:pPr><w:pStyle w:val="' + style + '"/></w:pPr>' : '') + run_(text) + '</w:p>';
const h = (lvl, text) => para(text, 'Heading' + lvl);
const image = (o) => '<w:p><w:r><w:drawing><wp:inline><wp:extent cx="914400" cy="914400"/><wp:docPr id="' + o.id + '" name="'
  + esc(o.name || 'Picture ' + o.id) + '"' + (o.descr !== undefined ? ' descr="' + esc(o.descr) + '"' : '') + '>' + (o.decorative ? DEC : '')
  + '</wp:docPr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr>'
  + '<pic:cNvPr id="0" name="image.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId9"/></pic:blipFill><pic:spPr/>'
  + '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>';
const tbl = (rows, header) => '<w:tbl>' + rows.map((cells, i) => '<w:tr>' + (header && i === 0 ? '<w:trPr><w:tblHeader/></w:trPr>' : '')
  + cells.map((c) => '<w:tc><w:p>' + (c ? run_(c) : '') + '</w:p></w:tc>').join('') + '</w:tr>').join('') + '</w:tbl>';
const STYLES = XML + '<w:styles ' + WNS + '><w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/></w:style>'
  + [1, 2, 3].map((k) => '<w:style w:type="paragraph" w:styleId="Heading' + k + '"><w:name w:val="heading ' + k + '"/>'
    + '<w:basedOn w:val="Normal"/><w:pPr><w:outlineLvl w:val="' + (k - 1) + '"/></w:pPr></w:style>').join('')
  + '<w:style w:type="paragraph" w:styleId="berschrift2"><w:name w:val="heading 2"/></w:style>'
  + '<w:style w:type="paragraph" w:styleId="StepHeading"><w:name w:val="Step Heading"/><w:basedOn w:val="Heading3"/></w:style>'
  + '<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/></w:style></w:styles>';
const CLEAN_BODY = h(1, 'Renewing a license') + para('Open the record.') + h(2, 'Before you start') + para('You need the license number.')
  + h(3, 'Fees') + para('The fee is shown on the summary page.') + image({ id: 1, descr: 'The Renew button on the record toolbar.' })
  + tbl([['Field', 'What to enter'], ['License number', 'The number on the certificate']], true);

function docx(o = {}) {
  const body = o.body !== undefined ? o.body : CLEAN_BODY;
  const docRels = [['rId1', 'styles', 'styles.xml']];
  const files = [
    { name: '[Content_Types].xml', data: XML + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>' },
    { name: '_rels/.rels', data: rels([['rId1', 'officeDocument', 'word/document.xml'], ['rId2', 'metadata/core-properties', 'docProps/core.xml']]) },
    { name: 'word/document.xml', data: XML + '<w:document ' + WNS + '><w:body>' + body + '<w:sectPr/></w:body></w:document>' },
    { name: 'word/styles.xml', data: STYLES },
  ];
  if (o.header) {
    docRels.push(['rId2', 'header', 'header1.xml']);
    files.push({ name: 'word/header1.xml', data: XML + '<w:hdr ' + WNS + '>' + o.header + '</w:hdr>' });
  }
  if (o.comments) {
    docRels.push(['rId3', 'comments', 'comments.xml']);
    files.push({ name: 'word/comments.xml', data: XML + '<w:comments ' + WNS + '><w:comment w:id="0" w:author="Reviewer">' + o.comments + '</w:comment></w:comments>' });
  }
  (o.links || []).forEach((t, j) => docRels.push(['rId' + (10 + j), 'hyperlink', t, true]));
  files.push({ name: 'word/_rels/document.xml.rels', data: rels(docRels) });
  if (o.title !== null) {
    files.push({ name: 'docProps/core.xml', data: XML + '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" '
      + 'xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>' + esc(o.title === undefined ? 'Renewing a license' : o.title) + '</dc:title>'
      + (o.creator ? '<dc:creator>' + esc(o.creator) + '</dc:creator>' : '') + '</cp:coreProperties>' });
  }
  for (const m of o.media || []) files.push({ name: m, data: Buffer.from([0xff, 0xd8, 0xff, 0]), store: true });
  for (const f of o.extra || []) files.push(f);
  return zip(files);
}

// ---------------------------------------------------------------------------------------------------------------
// Helpers over a report.

const RESIDUE = loadPatterns('# real values seen while capturing (fixture only)\nPat Example-Person\n\n/LIC-\\d{6}/\nrecords-host.internal\n', 'residue file', false);
const check = (buf, kind, o = {}) => checkPackage(buf, Object.assign({ kind, residue: RESIDUE }, o));
const deck = (o, extra) => check(pptx(o), 'pptx', extra);
const guide = (o, extra) => check(docx(o), 'docx', extra);
const findingsOf = (r, c) => r.findings.filter((f) => f.check === c);
const hasFinding = (r, c, re, sev) => findingsOf(r, c).some((f) => (!re || re.test(f.location + ' | ' + f.message)) && (!sev || f.severity === sev));
const stateOf = (r, c) => r.categories[c].state;
const CLEAN = 'checked, none found';

// ---------------------------------------------------------------------------------------------------------------
// ZIP reader.

eq(crc32(Buffer.from('123456789')), 0xcbf43926, 'CRC-32 matches the standard check value');
{
  const z = readZip(zip([{ name: 'a.xml', data: '<a>stored</a>', store: true }, { name: 'B/c.xml', data: '<c>' + 'deflated '.repeat(50) + '</c>' }]));
  eq(readPart(z, 'a.xml').toString(), '<a>stored</a>', 'a stored entry reads back');
  ok(readPart(z, 'b/C.XML').toString().startsWith('<c>deflated'), 'a deflated entry reads back, and part names are case-insensitive');
  eq(readPart(z, 'missing.xml'), null, 'a missing part is null');
}
refuses(() => readZip(Buffer.from('plain text, not a package')), /not a ZIP package/, 'non-ZIP input');
refuses(() => readZip(Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(512)])), /password-protected or in the old binary format/, 'an encrypted or old binary Office file');
refuses(() => readZip(pptx().subarray(0, 400)), /end record is missing/, 'a truncated package');
refuses(() => readZip(zip([{ name: 'a.xml', data: '<a/>', flags: 1 }])), /encrypted entries/, 'an encrypted entry');
refuses(() => readZip(zip([{ name: 'a.xml', data: '<a/>', usize: 0xffffffff }])), /ZIP64/, 'a ZIP64 size marker');
refuses(() => readZip(zip([{ name: 'a.xml', data: '<a/>' }], { count: 0xffff })), /ZIP64/, 'a ZIP64 entry count');
refuses(() => readZip(zip(Array.from({ length: MAX_ENTRIES + 1 }, (_, i) => ({ name: 'p' + i + '.xml', data: '<a/>', store: true })))), /entries; the limit is 5000/, 'more than 5000 entries');
refuses(() => readZip(zip([{ name: 'a.xml', data: '<a/>' }, { name: 'A.XML', data: '<b/>' }])), /same part twice/, 'one part named twice');
refuses(() => readPart(readZip(zip([{ name: 'a.xml', data: '<a/>', usize: MAX_PART_BYTES + 1 }])), 'a.xml'), /the limit is/, 'a part over the size cap is never inflated');
refuses(() => readPart(readZip(zip([{ name: 'a.xml', data: '<a>' + 'x'.repeat(5000) + '</a>', usize: 100 }])), 'a.xml'), /does not inflate to its declared size/, 'a part that inflates past its declared size');
refuses(() => readPart(readZip(zip([{ name: 'a.xml', data: '<a>small</a>', usize: 4000 }])), 'a.xml'), /different size/, 'a part that inflates short of its declared size');
refuses(() => readPart(readZip(zip([{ name: 'a.xml', data: '<a/>', crc: 1234 }])), 'a.xml'), /CRC check/, 'a part with a bad CRC');
refuses(() => readPart(readZip(zip([{ name: 'a.xml', data: '<a/>', method: 12 }])), 'a.xml'), /compression method 12/, 'an unsupported compression method');

// ---------------------------------------------------------------------------------------------------------------
// XML scanner.

{
  const x = parseXml('<?xml version="1.0"?><!-- note --><r a="1 &amp; 2" b=\'x\'><t>A &lt;b&gt; &#65;&#x42;</t><u/><v><![CDATA[<raw>]]></v></r>', 't');
  eq(x.name, 'r', 'root element');
  eq(x.attrs.a, '1 & 2', 'attribute entities are decoded');
  eq(x.attrs.b, 'x', 'single-quoted attributes');
  eq(x.children[0].text, 'A <b> AB', 'text entities and character references are decoded');
  eq(x.children[2].text, '<raw>', 'CDATA is kept as text');
  eq(textOf(parseXml('<a:p><a:r><a:t>one</a:t></a:r>\n   <a:br/><a:r><a:t>two</a:t></a:r></a:p>', 't')), 'one\ntwo\n', 'whitespace between tags is not text; breaks are');
}
refuses(() => parseXml('<a><b></a></b>', 'slide1.xml'), /not well-formed XML \(mismatched closing tag/, 'mismatched tags');
refuses(() => parseXml('<!DOCTYPE a [<!ENTITY x "y">]><a>&x;</a>', 'slide1.xml'), /DOCTYPE/, 'a DOCTYPE is refused');
refuses(() => parseXml('<a/><b/>', 'slide1.xml'), /exactly one root/, 'two root elements');
refuses(() => parseXml('<a><b>', 'slide1.xml'), /never closed/, 'an unclosed element');

// ---------------------------------------------------------------------------------------------------------------
// PPTX: a clean deck, and the verdict and exit-code contract.

{
  const r = deck();
  eq(r.verdict, 'Ready', 'a clean 16:9 deck with a residue file and no images is Ready');
  eq(r.findings.length, 0, 'a clean deck has no findings');
  ok(Object.values(r.categories).every((c) => c.state === CLEAN), 'every category reads checked, none found');
  eq(r.summary.slides, 2, 'the slide count is reported');
  eq(r.summary.slide_ratio, 1.778, 'the actual ratio is reported');
  ok(/1\.778 \(16:9\)/.test(r.categories.slide_size.note), 'the slide-size note names the ratio');
  ok(/8 shape\(s\) measured on 2 slide\(s\).*6\.70 in/.test(r.categories.layout.note), 'every shape is measured, including inherited placeholder positions');
  eq(r.summary.content_line_in, 6.7, 'the default content line is 6.70 in');
}
{
  const r = check(pptx(), 'pptx', { residue: null });
  eq(r.verdict, 'Ready with follow-ups', 'without a residue file the best verdict is Ready with follow-ups');
  eq(stateOf(r, 'residue'), 'not checked', 'the residue category reads not checked without a file');
  ok(/no --residue file/.test(r.categories.residue.note), 'the note says why residue was not checked');
}

// Slide size.
{
  const r = deck({ size: [9144000, 6858000] });
  ok(hasFinding(r, 'slide_size', /10\.00 x 7\.50 in, ratio 1\.333 \(4:3\)/, 'high'), 'a 4:3 deck is a high finding with its actual size and ratio');
  eq(r.verdict, 'Not ready', 'a 4:3 deck is Not ready');
  eq(stateOf(deck({ size: [9144000, 5143500] }), 'slide_size'), CLEAN, 'a 10 x 5.625 in deck is 16:9');
  ok(hasFinding(deck({ noSize: true }), 'slide_size', /not declared/, 'high'), 'a missing slide size is a finding');
  eq(stateOf(deck({ noSize: true }), 'layout'), 'not checked', 'without a slide size, positions are not checked');
}

// Layout: canvas edges and the content line.
{
  const neg = deck({ slides: [withShapes(sp({ id: 9, name: 'Callout 9', box: { x: -0.5, y: 2, w: 3, h: 1 }, text: 'Step 1' }))] });
  ok(hasFinding(neg, 'layout', /shape 9 "Callout 9".*negative position \(left -0\.50 in/, 'high'), 'a negative position is a high finding');
  const right = deck({ slides: [withShapes(sp({ id: 9, box: { x: 11, y: 2, w: 3, h: 1 }, text: 'Step 1' }))] });
  ok(hasFinding(right, 'layout', /extends past the slide edge \(right 14\.00 in/, 'high'), 'past the right edge is a high finding');
  const low = deck({ slides: [withShapes(sp({ id: 9, name: 'Note 9', box: { x: 1, y: 6, w: 4, h: 1 }, text: 'A note' }))] });
  ok(hasFinding(low, 'layout', /slide 1, shape 9 "Note 9" \| ends at 7\.00 in, below the content line at 6\.70 in/, 'medium'), 'below the content line is a medium finding with slide and shape');
  eq(stateOf(check(pptx({ slides: [withShapes(sp({ id: 9, box: { x: 1, y: 6, w: 4, h: 1 }, text: 'A note' }))] }), 'pptx', { contentBottomIn: 7.1 }), 'layout'), CLEAN, '--content-bottom moves the line');
  for (const [what, shape] of [
    ['a date placeholder', sp({ id: 9, name: 'Date Placeholder 9', ph: { type: 'dt', idx: 13 }, box: { x: 1, y: 6.9, w: 2, h: 0.4 }, text: 'November 2026' })],
    ['a shape named as a footer', sp({ id: 9, name: 'Agency footer text', box: { x: 1, y: 6.9, w: 4, h: 0.4 }, text: 'Sample agency' })],
    ['a full-slide background picture', pic({ id: 9, descr: 'Background pattern', box: { x: 0, y: 0, w: 13.333, h: 7.5 } })],
  ]) eq(stateOf(deck({ slides: [withShapes(shape)] }), 'layout'), CLEAN, what + ' may sit below the content line');
  ok(hasFinding(deck({ slides: [withShapes(sp({ id: 9, name: 'Footnote box', box: { x: 1, y: 6.9, w: 4, h: 0.4 }, text: 'See page 2' }))] }), 'layout', /below the content line/),
    'a name that only contains "foot" as part of another word is not exempt');
  const small = deck({ size: [9144000, 5143500], slides: [withShapes(sp({ id: 9, box: { x: 1, y: 4.5, w: 4, h: 0.6 }, text: 'A note' }))] });
  ok(hasFinding(small, 'layout', /below the content line at 5\.03 in/), 'on a 5.625 in slide the content line scales to 5.03 in');
  ok(/scaled to this slide height/.test(small.categories.layout.note), 'the note says the line was scaled');
}
{
  // Group transforms: the group maps a 10 x 10 in child space onto a 5 x 5 in box at (1, 1).
  const inside = deck({ slides: [withShapes(grp({ id: 20, box: { x: 1, y: 1, w: 5, h: 5 }, child: { x: 0, y: 0, w: 10, h: 10 } },
    [sp({ id: 21, box: { x: 8, y: 8, w: 2, h: 2 }, text: 'Scaled into place' })]))] });
  eq(stateOf(inside, 'layout'), CLEAN, 'a child is measured through its group scale (ends at 6.00 in, not 10.00 in)');
  const moved = deck({ slides: [withShapes(grp({ id: 20, box: { x: 9, y: 4, w: 5, h: 2 }, child: { x: 0, y: 0, w: 5, h: 2 } },
    [sp({ id: 21, name: 'Grouped 21', box: { x: 1, y: 0, w: 4, h: 1 }, text: 'Offset by its group' })]))] });
  ok(hasFinding(moved, 'layout', /shape 21 "Grouped 21".*right 14\.00 in/, 'high'), 'a child is measured through its group offset');
}
{
  const rotated = deck({ slides: [withShapes(sp({ id: 9, box: { x: 1, y: 5, w: 4, h: 0.5, rot: 5400000 }, text: 'Turned on its side' }))] });
  ok(hasFinding(rotated, 'layout', /ends at 7\.25 in/), 'a rotated shape is measured by its rotated bounding box');
}
{
  const inherited = deck({ slides: [withShapes(sp({ id: 9, name: 'Tall body 9', ph: { type: 'body', idx: 10 }, text: 'Inherits a tall box' }))] });
  ok(hasFinding(inherited, 'layout', /shape 9 "Tall body 9" \| ends at 7\.20 in/, 'medium'), 'a placeholder with no position is measured at its layout position');
  const lost = deck({ slides: [withShapes(sp({ id: 9, name: 'Picture Placeholder 9', ph: { type: 'pic', idx: 40 }, text: 'Nowhere to inherit from' }))] });
  eq(stateOf(lost, 'layout'), 'not checked', 'a shape with no resolvable position makes layout not checked, never clean');
  ok(/1 shape\(s\) had no position/.test(lost.categories.layout.note), 'the note counts the unmeasured shape');
  const tall = deck({ slides: [withShapes(table({ id: 9, name: 'Steps table', box: { x: 1, y: 4, w: 6, h: 1 }, rows: [[1.5, 'Step one'], [1.5, 'Step two']] }))] });
  ok(hasFinding(tall, 'layout', /"Steps table" \| ends at 7\.00 in/), 'a table is measured by its row heights when they exceed its frame');
}

// Placeholder text.
for (const [text, rule] of [
  ['TODO: add the renewal fee', /TODO/], ['Fee: TBD', /TBD or TBC/], ['License XXXX', /XXX/], ['Lorem ipsum dolor sit amet', /lorem ipsum/],
  ['Click to add text', /Click to add/], ['[Insert screenshot here]', /\[insert/], ['Dear {{ApplicantName}}', /\{\{ \}\}/],
  ['Dear «ApplicantName»', /merge field/], ['FIXME before handoff', /TODO or FIXME/],
]) {
  ok(hasFinding(deck({ slides: [withShapes(sp({ id: 9, box: { x: 1, y: 2, w: 4, h: 1 }, text }))] }), 'placeholder_text', rule, 'high'), 'placeholder flagged: ' + rule);
}
eq(stateOf(deck({ slides: [withShapes(sp({ id: 9, box: { x: 1, y: 2, w: 4, h: 1 }, text: 'Open your To Do list, then the Todo tab, then Tables.' }))] }), 'placeholder_text'), CLEAN,
  'ordinary words that contain placeholder letters are not flagged');
{
  const s = cleanSlide(1);
  s.notes = 'TBD: confirm the fee with the client';
  ok(hasFinding(deck({ slides: [s] }), 'placeholder_text', /speaker notes of slide 1/), 'placeholder text in speaker notes is flagged');
  ok(hasFinding(deck({ slides: [withShapes(pic({ id: 9, descr: 'TODO describe this screen', box: { x: 1, y: 2, w: 4, h: 3 } }))] }), 'placeholder_text', /alt text/),
    'placeholder text in alt text is flagged');
  eq(stateOf(deck(), 'placeholder_text'), CLEAN, "the master's own prompt text is not a finding");
}

// Empty and image-only slides.
{
  const empty = deck({ slides: [cleanSlide(1), { shapes: [sp({ id: 2, name: 'Title 1', ph: { type: 'title' } })], notes: 'Pause here.' }] });
  ok(hasFinding(empty, 'empty_slides', /^slide 2 \|/, 'medium'), 'a slide with only an empty placeholder is empty');
  const only = deck({ slides: [cleanSlide(1), { shapes: [pic({ id: 2, descr: 'The renewal form', box: { x: 1, y: 1, w: 10, h: 5 } })], notes: 'Walk the form.' }] });
  ok(hasFinding(only, 'image_only_slides', /^slide 2 \|.*screen reader/, 'medium'), 'a picture with no text is an image-only slide');
  eq(stateOf(only, 'empty_slides'), CLEAN, 'an image-only slide is not also reported as empty');
  const chartOnly = deck({ slides: [cleanSlide(1), { shapes: [chart({ id: 2, descr: 'Renewals by month', box: { x: 1, y: 1, w: 8, h: 5 } })], notes: 'Trend.' }] });
  ok(stateOf(chartOnly, 'empty_slides') === CLEAN && stateOf(chartOnly, 'image_only_slides') === CLEAN, 'a chart slide is neither empty nor image-only');
  ok(hasFinding(deck({ slides: [] }), 'empty_slides', /no slides/), 'a deck with no slides is a finding');
}

// Alt text.
{
  const r = deck({ slides: [withShapes(pic({ id: 9, name: 'Picture 9', box: { x: 1, y: 2, w: 4, h: 3 } }))] });
  ok(hasFinding(r, 'alt_text', /slide 1, shape 9 "Picture 9" \| picture has no alt text/, 'high'), 'a picture with no descr is a high finding');
  ok(hasFinding(deck({ slides: [withShapes(pic({ id: 9, descr: '   ', box: { x: 1, y: 2, w: 4, h: 3 } }))] }), 'alt_text', /no alt text/), 'blank alt text counts as none');
  eq(stateOf(deck({ slides: [withShapes(pic({ id: 9, descr: 'The Renew button', box: { x: 1, y: 2, w: 4, h: 3 } }))] }), 'alt_text'), CLEAN, 'a described picture is clean');
  const dec = deck({ slides: [withShapes(pic({ id: 9, decorative: true, box: { x: 1, y: 2, w: 4, h: 3 } }))] });
  eq(stateOf(dec, 'alt_text'), CLEAN, 'a picture marked decorative needs no alt text');
  ok(/1 marked decorative/.test(dec.categories.alt_text.note), 'decorative pictures are counted');
  ok(hasFinding(deck({ slides: [withShapes(pic({ id: 9, descr: 'A screenshot of a computer\n\nDescription automatically generated', box: { x: 1, y: 2, w: 4, h: 3 } }))] }),
    'alt_text', /generated automatically/, 'medium'), 'auto-generated alt text is a medium finding');
  ok(hasFinding(deck({ slides: [withShapes(pic({ id: 9, descr: 'screen shot 3.PNG', box: { x: 1, y: 2, w: 4, h: 3 } }))] }), 'alt_text', /only a file name/, 'high'),
    'a file name as alt text (what python-pptx writes) is a high finding');
  eq(stateOf(deck({ slides: [withShapes(pic({ id: 9, descr: 'The Renew button, shown at step 3.', box: { x: 1, y: 2, w: 4, h: 3 } }))] }), 'alt_text'), CLEAN,
    'a sentence that ends in a full stop is not a file name');
  ok(hasFinding(deck({ slides: [withShapes(chart({ id: 9, box: { x: 1, y: 1, w: 6, h: 4 } }))] }), 'alt_text', /chart has no alt text/), 'a chart with no alt text is flagged');
}

// Speaker notes (advisory) and hidden slides.
{
  const s2 = cleanSlide(2);
  delete s2.notes;
  const s3 = cleanSlide(3);
  s3.notes = '   ';
  const r = deck({ slides: [cleanSlide(1), s2, s3] });
  ok(hasFinding(r, 'speaker_notes', /^slides 2-3 \|/, 'low'), 'missing and blank notes are one low finding listing the slides');
  eq(r.verdict, 'Ready with follow-ups', 'missing notes alone leave the deck Ready with follow-ups');
  ok(/notes on 1 of 3/.test(r.categories.speaker_notes.note), 'the note counts slides with notes');
  const hid = cleanSlide(2);
  hid.hidden = true;
  hid.shapes.push(sp({ id: 9, box: { x: 1, y: 2, w: 3, h: 1 }, text: 'TODO' }));
  const rh = deck({ slides: [cleanSlide(1), hid] });
  ok(hasFinding(rh, 'placeholder_text', /^slide 2 \(hidden\)/), 'a hidden slide is still checked, and its location says hidden');
  eq(rh.summary.hidden_slides.join(','), '2', 'hidden slides are listed in the summary');
}

// Images and embedded files: never reported clean when they exist.
{
  const r = deck({ slides: [withShapes(pic({ id: 9, descr: 'The renewal form', box: { x: 1, y: 2, w: 4, h: 3 } }))], media: ['ppt/media/image1.png', 'ppt/media/image2.jpeg'] });
  eq(stateOf(r, 'text_in_images'), 'not checked', 'text inside images is not checked when images exist');
  ok(/2 image file\(s\) in the package \(1 placed on slides\)/.test(r.categories.text_in_images.note), 'the note gives the image count');
  eq(r.verdict, 'Ready with follow-ups', 'a deck with screenshots is at best Ready with follow-ups');
  ok(/not checked: text_in_images/.test(r.verdict_reason), 'the verdict reason names the not-checked category');
  eq(stateOf(deck(), 'text_in_images'), CLEAN, 'a deck with no images reads checked, none found');
  const e = deck({ extra: [{ name: 'ppt/embeddings/Microsoft_Excel_Worksheet1.xlsx', data: 'PK', store: true }, { name: 'ppt/media/media1.mp4', data: 'x', store: true }] });
  eq(stateOf(e, 'embedded_files'), 'not checked', 'embedded workbooks and video are not checked');
  ok(/2 embedded file/.test(e.categories.embedded_files.note), 'the embedded count is given');
}

// Fonts named in the file, for the font rule in SKILL.md.
{
  const s = cleanSlide(1);
  s.shapes.push(sp({ id: 9, box: { x: 1, y: 2, w: 3, h: 1 }, text: 'Styled' }).replace('<a:rPr lang="en-US"/>', '<a:rPr lang="en-US"><a:latin typeface="Segoe UI"/><a:ea typeface="+mn-ea"/></a:rPr>'));
  const r = deck({ slides: [s] });
  ok(r.summary.fonts_named.includes('Segoe UI') && !r.summary.fonts_named.some((f) => f.startsWith('+')), 'fonts are listed, theme references are not');
}

// ---------------------------------------------------------------------------------------------------------------
// Personal data: flagged by position, never echoed; documented samples skipped.

const EMAIL = 'pat.person@agency-mail.fixture'; // a top-level domain that does not exist
const PHONE = '(555) 867-5309'; // area code 555 is not in service
const SSN = '123-45-6789';
{
  const r = deck({ slides: [withShapes(sp({ id: 9, name: 'Contact 9', box: { x: 1, y: 2, w: 5, h: 1 }, text: ['Email ' + EMAIL, 'Call ' + PHONE + ' or 555.555.2368', 'SSN ' + SSN] }))] });
  ok(hasFinding(r, 'personal_data', /shape 9 "Contact 9" \| looks like an email address/, 'critical'), 'an email address is a critical finding');
  ok(hasFinding(r, 'personal_data', /looks like a phone number \(2 matches\)/), 'phone numbers with brackets and dots are counted');
  ok(hasFinding(r, 'personal_data', /social security number/), 'an SSN is flagged');
  const json = JSON.stringify(r);
  ok(![EMAIL, PHONE, '555.555.2368', SSN, '867-5309'].some((v) => json.includes(v)), 'the report never contains the values');
  eq(r.verdict, 'Not ready', 'personal data makes the deck Not ready');
}
{
  const r = deck({ slides: [withShapes(sp({ id: 9, box: { x: 1, y: 2, w: 5, h: 1 }, text: 'Sample: jane.doe@example.com, 202-555-0143, SSN 000-12-3456, help.desk@records.test' }))] });
  eq(stateOf(r, 'personal_data'), CLEAN, 'reserved example domains, 555-01xx numbers and never-issued SSNs are samples');
  ok(/4 documented sample value\(s\) skipped/.test(r.categories.personal_data.note), 'skipped samples are counted');
  eq(personalData('Ids 1000000001 and 2034567891, CHECKSUM -1876543210, dated 2026-11-10', null).hits.length, 0, 'bare digit runs and dates are not personal data');
}
{
  const allow = loadPatterns('help.desk@agency-mail.fixture\n/^\\(555\\) 867-\\d{4}$/\n123-45-6789\n', 'allow file', true);
  const r = deck({ slides: [withShapes(sp({ id: 9, box: { x: 1, y: 2, w: 5, h: 1 }, text: 'Help desk: help.desk@agency-mail.fixture or (555) 867-5309. SSN 123-45-6789. Also ' + EMAIL }))] }, { allow });
  ok(hasFinding(r, 'personal_data', /email address;/) && !hasFinding(r, 'personal_data', /email address \(2 matches\)/),
    'an allowed contact is cleared and another email is still flagged');
  ok(!hasFinding(r, 'personal_data', /phone/), 'an allowed phone number is cleared');
  ok(hasFinding(r, 'personal_data', /social security number/), 'an SSN can never be allowed');
  ok(/2 value\(s\) cleared by the allow file/.test(r.categories.personal_data.note), 'cleared values are counted');
}
{
  const s = cleanSlide(1);
  s.notes = 'Ask ' + EMAIL + ' for access';
  s.links = ['mailto:' + EMAIL];
  s.shapes.push(pic({ id: 9, name: 'Picture 9', descr: 'Record of ' + EMAIL, box: { x: 1, y: 2, w: 3, h: 2 } }));
  const r = deck({ slides: [s], extra: [{ name: 'docProps/core.xml', data: '<cp:coreProperties xmlns:cp="x" xmlns:dc="y"><dc:creator>' + EMAIL + '</dc:creator></cp:coreProperties>' }] });
  ok(hasFinding(r, 'personal_data', /^speaker notes of slide 1/), 'personal data in speaker notes is found');
  ok(hasFinding(r, 'personal_data', /^link targets in ppt\/slides\/_rels\/slide1\.xml\.rels/), 'personal data in a hyperlink target is found');
  ok(hasFinding(r, 'personal_data', /shape 9 "Picture 9", alt text/), 'personal data in alt text is found');
  ok(hasFinding(r, 'personal_data', /^document properties \(docProps\/core\.xml\)/), 'personal data in document properties is found');
  ok(!JSON.stringify(r).includes(EMAIL), 'none of those locations echoes the value');
}

// Residue patterns: position and line number, never the pattern or the text.
{
  const s = withShapes(sp({ id: 9, name: 'Record header', box: { x: 1, y: 2, w: 5, h: 1 }, text: 'Licensee: pat   example-person, license LIC-204518' }));
  const r = deck({ slides: [s] });
  ok(hasFinding(r, 'residue', /slide 1, shape 9 "Record header" \| matches residue pattern on line 2/, 'critical'), 'a literal matches case-insensitively across extra spaces');
  ok(hasFinding(r, 'residue', /line 4$/), 'a /regex/ line matches');
  const json = JSON.stringify(r);
  ok(!/example-person|LIC-204518|LIC-\\\\d/i.test(json), 'the report holds neither the matched text nor the pattern');
  const named = deck({ slides: [withShapes(sp({ id: 9, name: 'Pat Example-Person record', box: { x: 1, y: 2, w: 5, h: 1 }, text: 'Sample record' }))] });
  ok(hasFinding(named, 'residue', /^slide 1, shape 9, shape name \|/), 'a residue hit in a shape name withholds the name from the location');
  ok(!/Example-Person/.test(JSON.stringify(named)), 'the withheld name is not in the report');
  const chartPart = deck({ extra: [{ name: 'ppt/charts/chart1.xml', data: '<c:chartSpace xmlns:c="x"><c:v>Records from records-host.internal</c:v></c:chartSpace>' }] });
  ok(hasFinding(chartPart, 'residue', /^chart \(ppt\/charts\/chart1\.xml\) \| matches residue pattern on line 5/), 'residue in a chart part is found');
  eq(stateOf(deck(), 'residue'), CLEAN, 'a clean deck has no residue');
}
refuses(() => loadPatterns('ok value\n/unclosed(/\n', 'residue file', false), /residue file line 2 is not a valid regular expression/, 'an invalid regex names its line');
refuses(() => loadPatterns('/a*/\n', 'residue file', false), /line 1 matches empty text/, 'a pattern that matches empty text is refused');
refuses(() => loadPatterns('ab\n', 'residue file', false), /line 1 is shorter than 3/, 'a two-character literal is refused');
refuses(() => loadPatterns('/abc/g\n', 'residue file', false), /only the i, m, s and u flags/, 'the g flag is refused');
{
  let msg = '';
  try { loadPatterns('/Secret-Client-Value(/\n', 'residue file', false); } catch (e) { msg = e.message; }
  ok(msg && !msg.includes('Secret-Client-Value'), 'a pattern error never quotes the pattern');
}

// ---------------------------------------------------------------------------------------------------------------
// DOCX.

{
  const r = guide();
  eq(r.verdict, 'Ready', 'a clean guide with a residue file and no media is Ready');
  ok(Object.values(r.categories).every((c) => c.state === CLEAN), 'every docx category reads checked, none found');
  eq(r.summary.headings, 3, 'headings are counted');
  eq(r.summary.tables, 1, 'tables are counted');
}

// Heading order.
{
  const r = guide({ body: h(1, 'Renewing a license') + para('Intro.') + h(3, 'Fees') + para('Text.') });
  ok(hasFinding(r, 'heading_order', /^paragraph 3, heading 2 "Fees" \| Heading 3 follows Heading 1, so a level is skipped/, 'medium'), 'Heading 1 then Heading 3 is a medium finding at the paragraph');
  ok(hasFinding(guide({ body: h(2, 'Start') + para('Text.') }), 'heading_order', /first heading is Heading 2/), 'a guide that starts at Heading 2 is flagged');
  eq(stateOf(guide({ body: h(1, 'A') + h(2, 'B') + h(3, 'C') + h(1, 'D') + h(2, 'E') }), 'heading_order'), CLEAN, 'going back up any number of levels is fine');
  ok(hasFinding(guide({ body: h(1, 'A') + para('Step', 'StepHeading') }), 'heading_order', /Heading 3 follows Heading 1/), 'a custom style based on a heading takes its level');
  eq(stateOf(guide({ body: h(1, 'A') + para('B', 'berschrift2') }), 'heading_order'), CLEAN, 'a localized style id is read by its built-in name');
  ok(hasFinding(guide({ body: h(1, 'A') + '<w:p><w:pPr><w:outlineLvl w:val="3"/></w:pPr>' + run_('Direct') + '</w:p>' }), 'heading_order', /Heading 4 follows Heading 1/),
    'a direct outline level on a paragraph is read');
  ok(hasFinding(guide({ body: para('Only body text.') }), 'heading_order', /no headings/, 'low'), 'a guide with no headings gets a low finding');
  ok(hasFinding(guide({ body: h(1, 'A') + para('Under A') + h(2, 'B') + para('TODO here') }), 'placeholder_text', /^paragraph 4, under heading "B" \|/),
    'a body finding names the heading it sits under');
}

// Images, headers and alt text.
{
  ok(hasFinding(guide({ body: h(1, 'A') + image({ id: 7 }) }), 'alt_text', /^paragraph 2, under heading "A", image 7 "Picture 7" \| image has no alt text/, 'high'), 'an image with no descr is a high finding');
  eq(stateOf(guide({ body: h(1, 'A') + image({ id: 7, decorative: true }) }), 'alt_text'), CLEAN, 'a decorative image needs no alt text');
  ok(hasFinding(guide({ header: image({ id: 3, name: 'Agency logo' }) }), 'alt_text', /^header \(word\/header1\.xml\), paragraph 1, image 3 "Agency logo"/), 'a header logo with no alt text is found');
  const legacy = guide({ body: h(1, 'A') + '<w:p><w:r><w:pict><v:shape xmlns:v="urn:schemas-microsoft-com:vml"><v:imagedata r:id="rId9"/></v:shape></w:pict></w:r></w:p>' });
  eq(stateOf(legacy, 'alt_text'), 'not checked', 'a legacy VML image makes alt text not checked, never clean');
}

// Placeholders, content controls, deleted text.
{
  ok(hasFinding(guide({ body: h(1, 'A') + para('[Insert the fee table]') }), 'placeholder_text', /\[insert/, 'high'), 'a placeholder in a paragraph is flagged');
  const sdt = '<w:sdt><w:sdtPr><w:showingPlcHdr/></w:sdtPr><w:sdtContent><w:p>' + run_('Choose an item.') + '</w:p></w:sdtContent></w:sdt>';
  ok(hasFinding(guide({ body: h(1, 'A') + sdt }), 'placeholder_text', /^paragraph 2, under heading "A" \| a content control still shows its placeholder prompt/), 'a content control showing its prompt is flagged');
  const del = h(1, 'A') + '<w:p><w:del w:id="1" w:author="x"><w:r><w:delText>TODO ' + EMAIL + '</w:delText></w:r></w:del>' + run_('Final text.') + '</w:p>';
  const rd = guide({ body: del });
  eq(stateOf(rd, 'placeholder_text'), CLEAN, 'deleted text is not visible, so it is not a placeholder');
  ok(hasFinding(rd, 'personal_data', /^paragraph 2/), 'but personal data in deleted text is still found, because it travels in the file');
  ok(hasFinding(guide({ header: para('Draft TBD') }), 'placeholder_text', /^header \(word\/header1\.xml\), paragraph 1/), 'placeholders in a header are flagged');
  const rc = guide({ comments: para('TODO ask about ' + EMAIL) });
  ok(!hasFinding(rc, 'placeholder_text') && hasFinding(rc, 'personal_data', /^comments \(word\/comments\.xml\)/), 'comments are searched for personal data, not placeholders');
  ok(hasFinding(guide({ links: ['https://records-host.internal/case/1'] }), 'residue', /^link targets in word\/_rels\/document\.xml\.rels/), 'residue in a hyperlink target is found');
}

// Table header rows (advisory).
{
  ok(hasFinding(guide({ body: h(1, 'A') + tbl([['', ''], ['License number', 'On the certificate']], true) }), 'table_headers', /table 1 .* the header row is empty/, 'low'), 'an empty header row is a low finding');
  ok(hasFinding(guide({ body: h(1, 'A') + tbl([['Field', 'Value'], ['License number', 'On the certificate']], false) }), 'table_headers', /no row is marked/, 'low'), 'a table with no header row marked is a low finding');
  eq(stateOf(guide({ body: h(1, 'A') + tbl([['One cell only'], ['Another']], false) }), 'table_headers'), CLEAN, 'a one-column layout table is skipped');
}

// Title property.
{
  ok(hasFinding(guide({ title: '' }), 'document_title', /Title property/, 'medium'), 'an empty title is a medium finding');
  ok(hasFinding(guide({ title: null }), 'document_title', /Title property/), 'missing document properties is a finding');
  eq(guide({ title: '' }).verdict, 'Not ready', 'a missing title makes the guide Not ready');
}

// Images in a guide.
{
  const r = guide({ media: ['word/media/image1.png'] });
  eq(stateOf(r, 'text_in_images'), 'not checked', 'guide screenshots are not checked');
  ok(/1 image file\(s\) in the package \(1 placed in the document\)/.test(r.categories.text_in_images.note), 'the guide note counts images');
}

// Kind and prefix mismatches.
refuses(() => check(docx(), 'pptx'), /not a PowerPoint package/, 'a Word file checked as a deck');
refuses(() => check(pptx(), 'docx'), /not a Word package/, 'a deck checked as a Word file');
refuses(() => check(zip([{ name: 'ppt/presentation.xml', data: '<presentation xmlns="x"/>' }]), 'pptx'), /XML prefixes this checker reads/, 'unconventional prefixes fail closed');
refuses(() => check(zip([
  { name: '_rels/.rels', data: rels([['rId1', 'officeDocument', 'ppt/presentation.xml']]) },
  { name: 'ppt/presentation.xml', data: '<p:presentation ' + NS + '><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/></p:presentation>' },
  { name: 'ppt/_rels/presentation.xml.rels', data: rels([['rId1', 'slide', 'slides/slide1.xml']]) },
  { name: 'ppt/slides/slide1.xml', data: '<p:sld ' + NS + '><p:cSld><p:spTree>' },
]), 'pptx'), /not well-formed XML/, 'a malformed slide part');
refuses(() => check(zip([
  { name: 'ppt/presentation.xml', data: '<p:presentation ' + NS + '><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/></p:presentation>' },
]), 'pptx'), /slide 1 is listed in the presentation but its part is missing/, 'a listed slide with no part');

// ---------------------------------------------------------------------------------------------------------------
// The CLI: exit 0 Ready, 1 findings or follow-ups, 2 could not run; one JSON object on stdout or in --out.

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deliverable-check-test-'));
try {
  const file = (name, content) => { const p = path.join(dir, name); fs.writeFileSync(p, content); return p; };
  const lines = [];
  const written = {};
  const io = { log: (m) => lines.push(m), error: (m) => lines.push(m), writeFile: (f, s) => { written[f] = s; } };
  const last = () => lines[lines.length - 1];
  const residueFile = file('residue.txt', '# fixture patterns\nPat Example-Person\n/LIC-\\d{6}/\n');

  const clean = file('clean.pptx', pptx());
  eq(run([clean, '--residue', residueFile], io), 0, 'a Ready deck exits 0');
  const out0 = JSON.parse(lines[lines.length - 2]);
  eq(out0.verdict, 'Ready', 'stdout holds the JSON report');
  eq(out0.file, 'clean.pptx', 'the report names the file by base name only');
  ok(!lines[lines.length - 2].includes(dir), 'the report holds no machine-local path');
  ok(/^deliverable-check: Ready/.test(last()), 'a one-line verdict goes to stderr');
  eq(run([clean], io), 1, 'Ready with follow-ups exits 1, because a person still owes the follow-ups');
  eq(run([file('bad.pptx', pptx({ size: [9144000, 6858000] })), '--residue', residueFile], io), 1, 'Not ready exits 1');
  eq(run([file('guide.docx', docx()), '--residue', residueFile], io), 0, 'a Ready guide exits 0');

  const outPath = path.join(dir, 'report.json');
  lines.length = 0;
  eq(run([clean, '--residue', residueFile, '--out', outPath], io), 0, '--out still exits by verdict');
  eq(JSON.parse(written[outPath]).verdict, 'Ready', '--out receives the report');
  ok(lines.every((m) => !m.startsWith('{')), 'with --out nothing JSON goes to stdout');
  eq(run([path.join(dir, 'missing.pptx'), '--out', outPath], io), 2, 'a missing file exits 2');
  eq(JSON.parse(written[outPath]).verdict, 'Could not run', 'a failed run overwrites --out, so a stale Ready is never left behind');
  eq(run([clean, '--out', clean], io), 2, '--out naming the input exits 2');
  ok(/would overwrite an input file/.test(lines.find((m) => /COULD NOT RUN/.test(m) && /overwrite/.test(m)) || ''), 'and says why');

  eq(run([file('notzip.pptx', 'not a zip')], io), 2, 'a malformed package exits 2');
  ok(/COULD NOT RUN: the file is not a ZIP package/.test(lines.find((m) => /not a ZIP/.test(m)) || ''), 'and says it could not run');
  eq(run([file('damaged.pptx', pptx().subarray(0, 300))], io), 2, 'a truncated package exits 2');
  eq(run([file('deck.ppt', 'x')], io), 2, 'a .ppt file exits 2');
  eq(run([file('page.html', '<html></html>')], io), 2, 'an HTML page exits 2; it is checked by hand');
  const folder = path.join(dir, 'folder.pptx');
  fs.mkdirSync(folder);
  lines.length = 0;
  eq(run([folder], io), 2, 'a directory exits 2');
  ok(lines.some((m) => /folder\.pptx is not a regular file/.test(m)), 'and says it is not a regular file');
  eq(run([], io), 2, 'no argument exits 2');
  eq(run([clean, clean], io), 2, 'two input files exit 2');
  eq(run([clean, '--verbose'], io), 2, 'an unknown option exits 2');
  eq(run([clean, '--content-bottom', 'six'], io), 2, 'a bad --content-bottom exits 2');
  eq(run([file('g.docx', docx()), '--content-bottom', '6.5'], io), 2, '--content-bottom on a .docx exits 2');
  eq(run([clean, '--residue', file('empty.txt', '# only a comment\n\n')], io), 2, 'a residue file with no patterns exits 2');
  lines.length = 0;
  eq(run([clean, '--residue', file('broken.txt', 'fine value\n/Client-Secret-Value(/\n')], io), 2, 'an invalid residue pattern exits 2');
  ok(lines.some((m) => /residue file line 2/.test(m)) && !lines.some((m) => m.includes('Client-Secret-Value')), 'the error names the line, not the pattern');
  const utf16 = file('residue16.txt', Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('Renew a license\n', 'utf16le')]));
  lines.length = 0;
  eq(run([clean, '--residue', utf16], io), 1, 'a UTF-16 LE residue file from PowerShell is read');
  ok(JSON.parse(lines[0]).findings.some((f) => f.check === 'residue'), 'and its patterns are applied');

  // The real process: exit codes as the shell sees them.
  const script = path.join(__dirname, '..', 'deliverable-check.cjs');
  const node = (args) => spawnSync(process.execPath, [script].concat(args), { encoding: 'utf8' });
  eq(node([clean, '--residue', residueFile]).status, 0, 'the process exits 0 for Ready');
  const p1 = node([clean]);
  eq(p1.status, 1, 'the process exits 1 for follow-ups');
  eq(JSON.parse(p1.stdout).verdict, 'Ready with follow-ups', 'the process prints one JSON object');
  const p2 = node([path.join(dir, 'notzip.pptx')]);
  eq(p2.status, 2, 'the process exits 2 when it could not run');
  eq(JSON.parse(p2.stdout).verdict, 'Could not run', 'a 2 never reads as Ready');
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('deliverable-check: ' + n + ' assertions passed');
