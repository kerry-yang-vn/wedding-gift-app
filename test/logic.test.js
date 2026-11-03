const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../logic.js');

const T0 = new Date(2026, 10, 4, 13, 5, 9).toISOString(); // 로컬 시간 기준 2026-11-04 13:05:09

const sample = () => [
  { id: 'a', side: 'groom', name: '홍길동', amount: 150000, meals: 2, createdAt: T0 },
  { id: 'b', side: 'bride', name: '김영희', amount: 50000, meals: 1, createdAt: T0 },
  { id: 'c', side: 'groom', name: '이철수', amount: 30000, meals: 0, createdAt: T0 },
];

/* ---------- 금액 / 표시 ---------- */

test('버튼 금액은 1만/3만/5만/10만 4개이다', () => {
  assert.deepEqual([...L.AMOUNT_BUTTONS], [10000, 30000, 50000, 100000]);
});

test('sumTaps: 10만 + 5만 = 15만원', () => {
  assert.equal(L.sumTaps([100000, 50000]), 150000);
  assert.equal(L.sumTaps([]), 0);
  assert.equal(L.sumTaps([10000, 10000, 30000]), 50000);
});

test('formatWon: 천 단위 콤마', () => {
  assert.equal(L.formatWon(0), '0원');
  assert.equal(L.formatWon(150000), '150,000원');
  assert.equal(L.formatWon(1234567), '1,234,567원');
});

test('formatMan: 만 단위 표기', () => {
  assert.equal(L.formatMan(10000), '1만');
  assert.equal(L.formatMan(150000), '15만');
  assert.equal(L.formatMan(15000), '15,000원');
});

test('clampMeals: 0 미만/99 초과로 가지 않는다', () => {
  assert.equal(L.clampMeals(0, -1), 0);
  assert.equal(L.clampMeals(2, 1), 3);
  assert.equal(L.clampMeals(99, 1), 99);
});

/* ---------- 검증 ---------- */

test('validateEntry: 정상 입력은 공백을 정리해 반환한다', () => {
  const r = L.validateEntry({ name: '  홍   길동 ', side: 'groom', amount: 50000, meals: 2 });
  assert.equal(r.ok, true);
  assert.deepEqual(r.value, { name: '홍 길동', side: 'groom', amount: 50000, meals: 2 });
});

test('validateEntry: 식권 기본값 0장은 허용한다', () => {
  assert.equal(L.validateEntry({ name: 'A', side: 'bride', amount: 10000, meals: 0 }).ok, true);
});

test('validateEntry: 이름 누락 / 금액 0 / 측 누락 / 식권 범위 오류를 모두 잡는다', () => {
  const r = L.validateEntry({ name: ' ', side: 'x', amount: 0, meals: 100 });
  assert.equal(r.ok, false);
  assert.equal(r.errors.length, 4);
  assert.equal(r.value, null);
});

test('validateEntry: 소수/NaN/상한 초과 금액은 거부한다', () => {
  assert.equal(L.validateEntry({ name: 'A', side: 'groom', amount: 1000.5, meals: 0 }).ok, false);
  assert.equal(L.validateEntry({ name: 'A', side: 'groom', amount: NaN, meals: 0 }).ok, false);
  assert.equal(L.validateEntry({ name: 'A', side: 'groom', amount: L.MAX_AMOUNT + 1, meals: 0 }).ok, false);
});

test('validateEntry: 너무 긴 이름은 거부한다', () => {
  const r = L.validateEntry({ name: 'ㄱ'.repeat(31), side: 'groom', amount: 10000, meals: 0 });
  assert.equal(r.ok, false);
});

/* ---------- 목록 조작 ---------- */

test('createEntry: id와 접수시각이 붙는다', () => {
  const e = L.createEntry({ name: 'A', side: 'groom', amount: 10000, meals: 1 }, 'id1', T0);
  assert.deepEqual(e, { id: 'id1', side: 'groom', name: 'A', amount: 10000, meals: 1, createdAt: T0 });
});

test('updateEntry: id/접수시각은 유지하고 값만 바꾼다 (원본 불변)', () => {
  const before = sample();
  const after = L.updateEntry(before, 'b', { name: '김영희2', side: 'groom', amount: 100000, meals: 3 });
  assert.equal(after[1].name, '김영희2');
  assert.equal(after[1].id, 'b');
  assert.equal(after[1].createdAt, T0);
  assert.equal(before[1].name, '김영희');
});

test('removeEntry / insertEntryAt: 삭제 후 같은 위치로 되돌릴 수 있다', () => {
  const before = sample();
  const r = L.removeEntry(before, 'b');
  assert.equal(r.entries.length, 2);
  assert.equal(r.removed.id, 'b');
  assert.equal(r.index, 1);
  const restored = L.insertEntryAt(r.entries, r.index, r.removed);
  assert.deepEqual(restored, before);
});

test('removeEntry: 없는 id는 아무 일도 하지 않는다', () => {
  const before = sample();
  const r = L.removeEntry(before, 'zzz');
  assert.equal(r.removed, null);
  assert.equal(r.entries, before);
});

test('insertEntryAt: 범위를 벗어난 index는 끝/처음으로 보정한다', () => {
  const e = { id: 'n', side: 'groom', name: 'N', amount: 1, meals: 0, createdAt: T0 };
  assert.equal(L.insertEntryAt(sample(), 99, e).at(-1).id, 'n');
  assert.equal(L.insertEntryAt(sample(), -5, e)[0].id, 'n');
});

test('filterEntries: 이름 검색(대소문자 무시)과 측 필터', () => {
  const list = sample().concat({ id: 'd', side: 'bride', name: 'Kim Min', amount: 10000, meals: 0, createdAt: T0 });
  assert.deepEqual(L.filterEntries(list, { query: '홍' }).map((e) => e.id), ['a']);
  assert.deepEqual(L.filterEntries(list, { query: 'kim' }).map((e) => e.id), ['d']);
  assert.deepEqual(L.filterEntries(list, { side: 'groom' }).map((e) => e.id), ['a', 'c']);
  assert.equal(L.filterEntries(list, {}).length, 4);
});

/* ---------- 집계 ---------- */

test('summarize: 전체와 측별 인원/금액/식권', () => {
  const s = L.summarize(sample());
  assert.deepEqual({ count: s.count, amount: s.amount, meals: s.meals }, { count: 3, amount: 230000, meals: 3 });
  assert.deepEqual(s.bySide.groom, { count: 2, amount: 180000, meals: 2 });
  assert.deepEqual(s.bySide.bride, { count: 1, amount: 50000, meals: 1 });
});

test('summarize: 빈 목록은 모두 0', () => {
  const s = L.summarize([]);
  assert.equal(s.count, 0);
  assert.equal(s.amount, 0);
  assert.equal(s.bySide.bride.meals, 0);
});

/* ---------- CSV ---------- */

test('toCSV: 헤더/행/합계 구조와 CRLF', () => {
  const csv = L.toCSV(sample().slice(0, 2));
  assert.deepEqual(csv.split('\r\n'), [
    '번호,구분,이름,축의금(원),식권(장),접수시각',
    '1,신랑측,홍길동,150000,2,2026-11-04 13:05:09',
    '2,신부측,김영희,50000,1,2026-11-04 13:05:09',
    '',
    ',신랑측 합계,1명,150000,2,',
    ',신부측 합계,1명,50000,1,',
    ',전체 합계,2명,200000,3,',
    '',
  ]);
});

test('toCSV: bom 옵션을 켜면 UTF-8 BOM이 붙는다 (엑셀 한글 깨짐 방지)', () => {
  assert.equal(L.toCSV([], { bom: true }).charCodeAt(0), 0xfeff);
  assert.notEqual(L.toCSV([]).charCodeAt(0), 0xfeff);
});

test('toCSV: 콤마/따옴표 이스케이프와 수식 주입 방지', () => {
  const list = [
    { id: '1', side: 'groom', name: 'Kim, "KJ"', amount: 10000, meals: 0, createdAt: T0 },
    { id: '2', side: 'bride', name: '=SUM(A1)', amount: 10000, meals: 0, createdAt: T0 },
  ];
  const lines = L.toCSV(list).split('\r\n');
  assert.equal(lines[1], '1,신랑측,"Kim, ""KJ""",10000,0,2026-11-04 13:05:09');
  assert.equal(lines[2], "2,신부측,'=SUM(A1),10000,0,2026-11-04 13:05:09");
});

/* ---------- 저장 / 복원 ---------- */

test('serialize → parseStored 왕복', () => {
  const state = { entries: sample(), lastSide: 'bride' };
  assert.deepEqual(L.parseStored(L.serialize(state)), state);
});

test('parseStored: 깨진 JSON/없는 값/버전 불일치는 빈 상태로 안전하게 처리', () => {
  const empty = { entries: [], lastSide: 'groom' };
  assert.deepEqual(L.parseStored(null), empty);
  assert.deepEqual(L.parseStored('{깨짐'), empty);
  assert.deepEqual(L.parseStored('{"version":99,"entries":[]}'), empty);
  assert.deepEqual(L.parseStored('{"version":1,"entries":"x"}'), empty);
});

test('parseStored: 유효하지 않은 항목만 걸러내고 나머지는 보존', () => {
  const raw = JSON.stringify({
    version: 1,
    lastSide: 'nope',
    entries: [
      { id: 'ok', side: 'groom', name: '홍길동', amount: 10000, meals: 1, createdAt: T0 },
      { id: 'bad', side: 'groom', name: '', amount: 10000, meals: 1, createdAt: T0 },
      { side: 'groom', name: 'id없음', amount: 10000, meals: 1, createdAt: T0 },
    ],
  });
  const r = L.parseStored(raw);
  assert.deepEqual(r.entries.map((e) => e.id), ['ok']);
  assert.equal(r.lastSide, 'groom');
});

/* ---------- 날짜 ---------- */

test('날짜 포맷', () => {
  assert.equal(L.formatDateTime(T0), '2026-11-04 13:05:09');
  assert.equal(L.formatClock(T0), '13:05');
  assert.equal(L.formatDateStamp(new Date(2026, 10, 4)), '20261104');
  assert.equal(L.formatDateTime('invalid'), '');
});
