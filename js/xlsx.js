/* =====================================================================
   MTX GROUP — Minimal, dependency-free XLSX read/write (offline-safe)
   Why this exists: CSV lets Excel reformat barcodes as numbers (leading
   zeros dropped, scientific notation, precision loss). A real .xlsx keeps
   every cell as TEXT, so barcodes survive a round-trip untouched.
   ===================================================================== */
(function () {
  'use strict';

  // ---- CRC32 (for zip entries) ----
  const CRC = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t;
  })();
  function crc32(buf) { let c = ~0; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (~c) >>> 0; }

  const enc = new TextEncoder();
  const dec = new TextDecoder();

  // ---- ZIP writer (STORE, no compression — valid .xlsx) ----
  function zip(entries) {
    const chunks = [], central = []; let offset = 0;
    for (const e of entries) {
      const name = enc.encode(e.name), data = e.data, crc = crc32(data), size = data.length;
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true);
      lh.setUint32(14, crc, true); lh.setUint32(18, size, true); lh.setUint32(22, size, true);
      lh.setUint16(26, name.length, true);
      chunks.push(new Uint8Array(lh.buffer), name, data);
      const cd = new DataView(new ArrayBuffer(46));
      cd.setUint32(0, 0x02014b50, true); cd.setUint16(4, 20, true); cd.setUint16(6, 20, true);
      cd.setUint32(16, crc, true); cd.setUint32(20, size, true); cd.setUint32(24, size, true);
      cd.setUint16(28, name.length, true); cd.setUint32(42, offset, true);
      central.push({ h: new Uint8Array(cd.buffer), n: name });
      offset += 30 + name.length + size;
    }
    const cStart = offset; let cSize = 0;
    for (const c of central) { chunks.push(c.h, c.n); cSize += c.h.length + c.n.length; }
    const eo = new DataView(new ArrayBuffer(22));
    eo.setUint32(0, 0x06054b50, true); eo.setUint16(8, central.length, true); eo.setUint16(10, central.length, true);
    eo.setUint32(12, cSize, true); eo.setUint32(16, cStart, true);
    chunks.push(new Uint8Array(eo.buffer));
    let total = 0; for (const c of chunks) total += c.length;
    const out = new Uint8Array(total); let p = 0; for (const c of chunks) { out.set(c, p); p += c.length; }
    return out;
  }

  const xmlEsc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const xmlUnesc = (s) => String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  function colLetter(n) { let s = ''; n++; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = (n - m - 1) / 26 | 0; } return s; }
  function colIndex(letters) { let n = 0; for (let i = 0; i < letters.length; i++) n = n * 26 + (letters.charCodeAt(i) - 64); return n - 1; }

  /* Build an .xlsx workbook from a 2D array (first row = headers).
     opts.textCols = 0-based column indexes that must stay TEXT (barcodes, SKUs):
       those whole columns get Excel's Text format so anything typed there —
       even in new rows — keeps leading zeros and never goes scientific.
     Every other column stores real numbers as numbers (so prices/costs/stock
     behave like numbers and sum correctly), and words as text.
     Returns a Uint8Array. */
  function buildXlsx(aoa, opts) {
    opts = opts || {};
    const sheetName = opts.sheetName || 'Sheet1';
    const textCols = new Set(opts.textCols || []);
    const isNum = (s) => /^-?\d+(?:\.\d+)?$/.test(s);

    // <cols>: force Text format (style s="1") on the text columns
    let cols = '';
    if (textCols.size) {
      cols = '<cols>' + [...textCols].sort((a, b) => a - b)
        .map((ci) => `<col min="${ci + 1}" max="${ci + 1}" width="16" style="1" customWidth="1"/>`).join('') + '</cols>';
    }

    let sd = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' + cols + '<sheetData>';
    aoa.forEach((r, ri) => {
      sd += `<row r="${ri + 1}">`;
      r.forEach((val, ci) => {
        const v = val == null ? '' : String(val);
        const ref = colLetter(ci) + (ri + 1);
        const textCol = textCols.has(ci);
        if (ri === 0) {                                   // header row: plain text
          sd += `<c r="${ref}"${textCol ? ' s="1"' : ''} t="inlineStr"><is><t xml:space="preserve">${xmlEsc(v)}</t></is></c>`;
        } else if (textCol) {                             // text column: keep as text
          sd += `<c r="${ref}" s="1" t="inlineStr"><is><t xml:space="preserve">${xmlEsc(v)}</t></is></c>`;
        } else if (v !== '' && isNum(v)) {                // real number
          sd += `<c r="${ref}"><v>${v}</v></c>`;
        } else if (v !== '') {                            // other text
          sd += `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEsc(v)}</t></is></c>`;
        }                                                 // empty non-text cell: omit
      });
      sd += '</row>';
    });
    sd += '</sheetData></worksheet>';

    // styles.xml: s="0" = General, s="1" = Text (numFmtId 49 = "@")
    const styles = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>' +
      '<fills count="1"><fill><patternFill patternType="none"/></fill></fills>' +
      '<borders count="1"><border/></borders>' +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      '<cellXfs count="2">' +
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
      '<xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
      '</cellXfs>' +
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';

    const ct = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>';
    const rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>';
    const wb = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      `<sheets><sheet name="${xmlEsc(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`;
    const wbr = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>';
    return zip([
      { name: '[Content_Types].xml', data: enc.encode(ct) },
      { name: '_rels/.rels', data: enc.encode(rels) },
      { name: 'xl/workbook.xml', data: enc.encode(wb) },
      { name: 'xl/_rels/workbook.xml.rels', data: enc.encode(wbr) },
      { name: 'xl/styles.xml', data: enc.encode(styles) },
      { name: 'xl/worksheets/sheet1.xml', data: enc.encode(sd) }
    ]);
  }

  // ---- ZIP reader ----
  async function inflateRaw(bytes) {
    if (typeof DecompressionStream === 'undefined') throw new Error('This browser can’t open .xlsx — use CSV');
    const ds = new DecompressionStream('deflate-raw');
    const ab = await new Response(new Blob([bytes]).stream().pipeThrough(ds)).arrayBuffer();
    return new Uint8Array(ab);
  }
  async function unzip(bytes) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let eo = -1;
    for (let i = bytes.length - 22; i >= 0; i--) { if (dv.getUint32(i, true) === 0x06054b50) { eo = i; break; } }
    if (eo < 0) throw new Error('Not a valid .xlsx file');
    const count = dv.getUint16(eo + 10, true); let ptr = dv.getUint32(eo + 16, true);
    const files = {};
    for (let n = 0; n < count; n++) {
      if (dv.getUint32(ptr, true) !== 0x02014b50) break;
      const method = dv.getUint16(ptr + 10, true);
      const compSize = dv.getUint32(ptr + 20, true);
      const nameLen = dv.getUint16(ptr + 28, true);
      const extraLen = dv.getUint16(ptr + 30, true);
      const commentLen = dv.getUint16(ptr + 32, true);
      const localOff = dv.getUint32(ptr + 42, true);
      const name = dec.decode(bytes.subarray(ptr + 46, ptr + 46 + nameLen));
      const lNameLen = dv.getUint16(localOff + 26, true), lExtra = dv.getUint16(localOff + 28, true);
      const start = localOff + 30 + lNameLen + lExtra;
      files[name] = { method, comp: bytes.subarray(start, start + compSize) };
      ptr += 46 + nameLen + extraLen + commentLen;
    }
    const out = {};
    for (const name in files) { const f = files[name]; out[name] = f.method === 0 ? f.comp : await inflateRaw(f.comp); }
    return out;
  }

  /* Read the first worksheet of an .xlsx (ArrayBuffer/Uint8Array) into a
     2D array of strings. Handles shared strings, inline strings and numbers. */
  async function readXlsx(input) {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    const parts = await unzip(bytes);
    const text = (n) => parts[n] ? dec.decode(parts[n]) : '';

    // shared strings table
    const sst = []; const sstXml = text('xl/sharedStrings.xml');
    if (sstXml) {
      const siRe = /<si\b[^>]*>([\s\S]*?)<\/si>/g; let m;
      while ((m = siRe.exec(sstXml))) {
        const tRe = /<t\b[^>]*>([\s\S]*?)<\/t>/g; let tm, s = '';
        while ((tm = tRe.exec(m[1]))) s += xmlUnesc(tm[1]);
        sst.push(s);
      }
    }
    // pick first worksheet
    let sheetPath = 'xl/worksheets/sheet1.xml';
    if (!parts[sheetPath]) { const k = Object.keys(parts).find((x) => /^xl\/worksheets\/.+\.xml$/.test(x)); if (k) sheetPath = k; }
    const sheet = text(sheetPath);
    if (!sheet) throw new Error('No worksheet found in file');

    const rows = [];
    const rowRe = /<row\b[^>]*>([\s\S]*?)<\/row>/g; let rm;
    while ((rm = rowRe.exec(sheet))) {
      const cells = [];
      const cRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g; let cm;
      while ((cm = cRe.exec(rm[1]))) {
        const attrs = cm[1], inner = cm[2] || '';
        const refM = /r="([A-Z]+)\d+"/.exec(attrs);
        const col = refM ? colIndex(refM[1]) : cells.length;
        const tM = /t="([^"]+)"/.exec(attrs); const type = tM ? tM[1] : 'n';
        let val = '';
        if (type === 's') { const v = /<v>([\s\S]*?)<\/v>/.exec(inner); val = v ? (sst[+v[1]] ?? '') : ''; }
        else if (type === 'inlineStr') { const t = /<t\b[^>]*>([\s\S]*?)<\/t>/.exec(inner); val = t ? xmlUnesc(t[1]) : ''; }
        else if (type === 'str') { const v = /<v>([\s\S]*?)<\/v>/.exec(inner); val = v ? xmlUnesc(v[1]) : ''; }
        else { const v = /<v>([\s\S]*?)<\/v>/.exec(inner); val = v ? v[1] : ''; }
        cells[col] = val;
      }
      for (let i = 0; i < cells.length; i++) if (cells[i] === undefined) cells[i] = '';
      rows.push(cells);
    }
    return rows.filter((r) => r.some((c) => String(c).trim() !== ''));
  }

  window.XLSXLite = { buildXlsx, readXlsx };
})();
