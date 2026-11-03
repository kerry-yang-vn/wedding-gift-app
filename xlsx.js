/* 의존성 없는 최소 .xlsx 생성기 (브라우저/Node 공용)
   .xlsx = ZIP(무압축 STORE) 안의 SpreadsheetML(XML). 외부 라이브러리 없이 오프라인에서 동작한다.
   문자열은 모두 inlineStr(글자)로 저장하므로 "=SUM(A1)" 같은 이름도 수식으로 실행되지 않는다. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.GiftXlsx = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

  const utf8 = (s) => new TextEncoder().encode(s);

  /* ---------- CRC32 / ZIP (STORE) ---------- */

  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  function zipStore(files, date) {
    const d = date || new Date();
    const dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    const dosDate = ((Math.max(d.getFullYear(), 1980) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();

    const entries = files.map((f) => ({ nameBytes: utf8(f.name), data: f.data, crc: crc32(f.data) }));
    let size = 22; // end of central directory
    for (const e of entries) size += 30 + e.nameBytes.length + e.data.length + 46 + e.nameBytes.length;

    const out = new Uint8Array(size);
    const dv = new DataView(out.buffer);
    let p = 0;
    const u16 = (v) => { dv.setUint16(p, v, true); p += 2; };
    const u32 = (v) => { dv.setUint32(p, v, true); p += 4; };
    const put = (b) => { out.set(b, p); p += b.length; };

    const offsets = [];
    for (const e of entries) {
      offsets.push(p);
      u32(0x04034b50); u16(20); u16(0x0800); u16(0); u16(dosTime); u16(dosDate);
      u32(e.crc); u32(e.data.length); u32(e.data.length); u16(e.nameBytes.length); u16(0);
      put(e.nameBytes);
      put(e.data);
    }
    const cdStart = p;
    entries.forEach((e, i) => {
      u32(0x02014b50); u16(20); u16(20); u16(0x0800); u16(0); u16(dosTime); u16(dosDate);
      u32(e.crc); u32(e.data.length); u32(e.data.length); u16(e.nameBytes.length); u16(0); u16(0);
      u16(0); u16(0); u32(0); u32(offsets[i]);
      put(e.nameBytes);
    });
    const cdSize = p - cdStart;
    u32(0x06054b50); u16(0); u16(0); u16(entries.length); u16(entries.length); u32(cdSize); u32(cdStart); u16(0);
    return out;
  }

  /* ---------- SpreadsheetML ---------- */

  // XML에서 허용되지 않는 제어문자를 제거하고 특수문자를 이스케이프한다
  const esc = (s) =>
    String(s)
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

  // 시트 이름: 엑셀 금지 문자 제거, 최대 31자
  const safeSheetName = (name) => String(name).replace(/[\\/?*[\]:]/g, '').slice(0, 31) || 'Sheet1';

  // 로컬 시각 → 엑셀 날짜 일련번호 (1899-12-30 기준)
  function excelSerial(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    const utc = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds());
    // 부동소수점 오차로 초가 1초 적게 표시되지 않도록 1밀리초를 더한다 (같은 초 안에 머문다)
    return Number((utc / 86400000 + 25569 + 0.001 / 86400).toFixed(10));
  }

  const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';

  const CONTENT_TYPES =
    XML_HEAD +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    '</Types>';

  const ROOT_RELS =
    XML_HEAD +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    '</Relationships>';

  const WORKBOOK_RELS =
    XML_HEAD +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
    '</Relationships>';

  // 셀 서식 번호: 0 기본 / 1 머리글 / 2 금액(#,##0) / 3 정수 / 4 날짜시각 / 5 굵은 글자 / 6 굵은 금액 / 7 굵은 정수
  //              8 가운데 정렬 정수 / 9 가운데 정렬 글자
  const STYLES =
    XML_HEAD +
    `<styleSheet xmlns="${NS}">` +
    '<numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy\\-mm\\-dd\\ hh:mm:ss"/></numFmts>' +
    '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
    '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FFE8EDF5"/><bgColor indexed="64"/></patternFill></fill></fills>' +
    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="10">' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
    '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center"/></xf>' +
    '<xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
    '<xf numFmtId="1" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
    '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
    '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
    '<xf numFmtId="3" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>' +
    '<xf numFmtId="1" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>' +
    '<xf numFmtId="1" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="center"/></xf>' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center"/></xf>' +
    '</cellXfs>' +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
    '</styleSheet>';

  const COLS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
  const COL_WIDTHS = [8, 10, 18, 16, 14, 14, 14, 22];

  function buildSheetXml(model) {
    const text = (ref, value, style) =>
      `<c r="${ref}"${style ? ` s="${style}"` : ''} t="inlineStr"><is><t xml:space="preserve">${esc(value)}</t></is></c>`;
    const num = (ref, value, style) => `<c r="${ref}"${style ? ` s="${style}"` : ''}><v>${value}</v></c>`;

    const rows = [];
    rows.push(`<row r="1">${model.headers.map((h, i) => text(`${COLS[i]}1`, h, 1)).join('')}</row>`);

    model.rows.forEach((r, i) => {
      const n = i + 2;
      const serial = excelSerial(r.createdAt);
      rows.push(
        `<row r="${n}">` +
          num(`A${n}`, r.no, 8) +
          text(`B${n}`, r.side, 9) +
          text(`C${n}`, r.name) +
          num(`D${n}`, r.amount, 2) +
          num(`E${n}`, r.meals, 3) +
          num(`F${n}`, r.kidMeals, 3) +
          num(`G${n}`, r.totalMeals, 3) +
          (serial === null ? '' : num(`H${n}`, serial, 4)) +
          '</row>'
      );
    });

    const last = model.rows.length + 1; // 마지막 데이터 행
    const totalRow = last + 2; // 한 줄 띄우고 합계
    const sum = (col, cached, style) =>
      model.rows.length
        ? `<c r="${col}${totalRow}" s="${style}"><f>SUM(${col}2:${col}${last})</f><v>${cached}</v></c>`
        : num(`${col}${totalRow}`, 0, style);
    rows.push(
      `<row r="${totalRow}">` +
        text(`B${totalRow}`, model.total.label, 5) +
        text(`C${totalRow}`, `${model.total.count}명`, 5) +
        sum('D', model.total.amount, 6) +
        sum('E', model.total.meals, 7) +
        sum('F', model.total.kidMeals, 7) +
        sum('G', model.total.totalMeals, 7) +
        '</row>'
    );

    const cols = COL_WIDTHS.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('');
    return (
      XML_HEAD +
      `<worksheet xmlns="${NS}">` +
      `<dimension ref="A1:H${totalRow}"/>` +
      '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
      `<cols>${cols}</cols>` +
      `<sheetData>${rows.join('')}</sheetData>` +
      `<autoFilter ref="A1:H${last}"/>` +
      '</worksheet>'
    );
  }

  function buildWorkbookXml(sheetName) {
    return (
      XML_HEAD +
      `<workbook xmlns="${NS}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
      `<sheets><sheet name="${esc(safeSheetName(sheetName))}" sheetId="1" r:id="rId1"/></sheets>` +
      '</workbook>'
    );
  }

  /* model: logic.js 의 toSheetModel() 결과. 반환: .xlsx 파일 바이트(Uint8Array) */
  function build(model, opts) {
    const files = [
      { name: '[Content_Types].xml', data: utf8(CONTENT_TYPES) },
      { name: '_rels/.rels', data: utf8(ROOT_RELS) },
      { name: 'xl/workbook.xml', data: utf8(buildWorkbookXml(model.sheetName)) },
      { name: 'xl/_rels/workbook.xml.rels', data: utf8(WORKBOOK_RELS) },
      { name: 'xl/styles.xml', data: utf8(STYLES) },
      { name: 'xl/worksheets/sheet1.xml', data: utf8(buildSheetXml(model)) },
    ];
    return zipStore(files, opts && opts.now);
  }

  return { MIME, build, crc32, zipStore, excelSerial };
});
