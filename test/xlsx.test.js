const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const L = require('../logic.js');
const X = require('../xlsx.js');

const T0 = new Date(2026, 10, 4, 13, 5, 9).toISOString();
const NOW = new Date(2026, 10, 4, 14, 0, 0);

const sample = () => [
  { id: 'a', side: 'groom', name: '홍길동', amount: 150000, meals: 2, kidMeals: 1, createdAt: T0 },
  { id: 'b', side: 'bride', name: '김영희', amount: 50000, meals: 1, createdAt: T0 },
  { id: 'c', side: 'groom', name: '이철수', amount: 30000, meals: 0, createdAt: T0 },
];

// STORE 방식 ZIP 읽기: 로컬 헤더를 순서대로 훑는다
function unzip(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const files = {};
  let p = 0;
  while (dv.getUint32(p, true) === 0x04034b50) {
    const method = dv.getUint16(p + 8, true);
    const crc = dv.getUint32(p + 14, true);
    const size = dv.getUint32(p + 18, true);
    const nameLen = dv.getUint16(p + 26, true);
    const extraLen = dv.getUint16(p + 28, true);
    const name = Buffer.from(bytes.subarray(p + 30, p + 30 + nameLen)).toString('utf8');
    const start = p + 30 + nameLen + extraLen;
    files[name] = { method, crc, data: bytes.subarray(start, start + size) };
    p = start + size;
  }
  return files;
}

const textOf = (file) => Buffer.from(file.data).toString('utf8');
const build = (entries, side) => X.build(L.toSheetModel(entries, side), { now: NOW });

test('crc32: 표준 검증값 (123456789 → CBF43926)', () => {
  assert.equal(X.crc32(Buffer.from('123456789')), 0xcbf43926);
});

test('ZIP 구조: 필수 파일 6개, 무압축, CRC 일치, 끝 레코드 정상', () => {
  const bytes = build(sample(), 'groom');
  const files = unzip(bytes);
  assert.deepEqual(Object.keys(files), [
    '[Content_Types].xml',
    '_rels/.rels',
    'xl/workbook.xml',
    'xl/_rels/workbook.xml.rels',
    'xl/styles.xml',
    'xl/worksheets/sheet1.xml',
  ]);
  for (const [name, f] of Object.entries(files)) {
    assert.equal(f.method, 0, `${name} 무압축`);
    assert.equal(f.crc, X.crc32(f.data), `${name} CRC`);
    if (typeof zlib.crc32 === 'function') assert.equal(f.crc, zlib.crc32(f.data) >>> 0, `${name} zlib CRC`);
  }
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assert.equal(dv.getUint32(bytes.length - 22, true), 0x06054b50);
  assert.equal(dv.getUint16(bytes.length - 22 + 10, true), 6);
});

test('시트 내용: 선택한 측 데이터와 SUM 합계 수식(캐시값 포함)', () => {
  const sheet = textOf(unzip(build(sample(), 'groom'))['xl/worksheets/sheet1.xml']);
  assert.ok(sheet.includes('홍길동') && sheet.includes('이철수'));
  assert.ok(sheet.includes('신랑측 합계') && sheet.includes('2명'));
  assert.ok(sheet.includes('<f>SUM(E2:E3)</f><v>180000</v>'));
  assert.ok(sheet.includes('<f>SUM(F2:F3)</f><v>2</v>'), '대인 합계');
  assert.ok(sheet.includes('<f>SUM(G2:G3)</f><v>1</v>'), '소인 합계');
  assert.ok(sheet.includes('<f>SUM(H2:H3)</f><v>3</v>'), '식권 합계');
  assert.ok(sheet.includes('<c r="F2" s="3"><v>2</v></c><c r="G2" s="3"><v>1</v></c><c r="H2" s="3"><v>3</v></c>'), '행별 대인/소인/합계');
  assert.ok(sheet.includes('<autoFilter ref="A1:I3"/>'));
  assert.ok(sheet.includes('식권 대인(장)') && sheet.includes('식권 소인(장)') && sheet.includes('식권 합계(장)'));
});

test('다른 측 정보·전체 합계는 파일 어디에도 들어가지 않는다', () => {
  const files = unzip(build(sample(), 'groom'));
  for (const [name, f] of Object.entries(files)) {
    const t = textOf(f);
    for (const leaked of ['김영희', '신부측', '전체', '230000']) {
      assert.ok(!t.includes(leaked), `${name}에 유출: ${leaked}`);
    }
  }
  const bride = textOf(unzip(build(sample(), 'bride'))['xl/worksheets/sheet1.xml']);
  assert.ok(bride.includes('김영희') && !bride.includes('홍길동') && !bride.includes('신랑측'));
});

test('이름의 수식·XML 특수문자는 글자로만 저장된다 (수식 주입/XML 깨짐 방지)', () => {
  const list = [
    { id: '1', side: 'groom', name: '=SUM(A1)', amount: 10000, meals: 0, createdAt: T0 },
    { id: '2', side: 'groom', name: '<b>&"x"', amount: 10000, meals: 0, createdAt: T0 },
    { id: '3', side: 'groom', name: 'a\u0001b', amount: 10000, meals: 0, createdAt: T0 },
  ];
  const sheet = textOf(unzip(build(list, 'groom'))['xl/worksheets/sheet1.xml']);
  assert.ok(sheet.includes('t="inlineStr"><is><t xml:space="preserve">=SUM(A1)</t>'));
  assert.ok(sheet.includes('&lt;b&gt;&amp;&quot;x&quot;'));
  assert.ok(sheet.includes('>ab<'), '제어문자 제거');
  assert.equal((sheet.match(/<f>/g) || []).length, 4, '수식은 합계 4개(금액·대인·소인·식권합계)뿐');
});

test('접수시각은 엑셀 날짜 값(로컬 시각 기준)으로 저장되고, 초 단위가 어긋나지 않는다', () => {
  const serial = X.excelSerial(T0);
  assert.equal(Math.floor(serial), Math.floor(Date.UTC(2026, 10, 4) / 86400000 + 25569)); // 날짜 부분
  const secondsOfDay = Math.floor((serial - Math.floor(serial)) * 86400);
  assert.equal(secondsOfDay, 13 * 3600 + 5 * 60 + 9); // 13:05:09 — 1초 적게 내림되지 않는다
  const sheet = textOf(unzip(build(sample(), 'groom'))['xl/worksheets/sheet1.xml']);
  assert.ok(sheet.includes(`<c r="I2" s="4"><v>${X.excelSerial(T0)}</v></c>`));
  assert.equal(X.excelSerial('invalid'), null);
});

test('시트 이름과 서식(스타일) 파트', () => {
  const files = unzip(build(sample(), 'groom'));
  assert.ok(textOf(files['xl/workbook.xml']).includes('name="신랑측 축의금"'));
  const styles = textOf(files['xl/styles.xml']);
  assert.ok(styles.startsWith('<?xml'));
  assert.ok(styles.includes('<cellXfs count="10">'));
});

test('내역이 0건이어도 유효한 파일을 만든다 (수식 없이 0)', () => {
  const sheet = textOf(unzip(build([], 'groom'))['xl/worksheets/sheet1.xml']);
  assert.ok(!sheet.includes('<f>'));
  assert.ok(sheet.includes('0명'));
});

test('side를 지정하지 않으면 파일을 만들 수 없다', () => {
  assert.throws(() => X.build(L.toSheetModel(sample())), /side/);
});
