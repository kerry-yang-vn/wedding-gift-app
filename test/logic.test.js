const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../logic.js');

const T0 = new Date(2026, 10, 4, 13, 5, 9).toISOString(); // 로컬 시간 기준 2026-11-04 13:05:09

const sample = () => [
  { id: 'a', side: 'groom', name: '홍길동', relation: 'family', amount: 150000, meals: 2, kidMeals: 1, createdAt: T0 },
  { id: 'b', side: 'bride', name: '김영희', relation: '', amount: 50000, meals: 1, kidMeals: 0, createdAt: T0 },
  { id: 'c', side: 'groom', name: '이철수', relation: '', amount: 30000, meals: 0, kidMeals: 0, createdAt: T0 },
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
  assert.deepEqual(r.value, { name: '홍 길동', side: 'groom', relation: '', amount: 50000, meals: 2, kidMeals: 0 });
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
  assert.deepEqual(e, { id: 'id1', side: 'groom', name: 'A', amount: 10000, meals: 1, kidMeals: 0, relation: '', createdAt: T0 });
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

/* ---------- 측 고정 ---------- */

test('lockSide: 선택한 측만 남기고 제외된 개수를 알려준다', () => {
  const r = L.lockSide(sample(), 'groom');
  assert.deepEqual(r.entries.map((e) => e.id), ['a', 'c']);
  assert.equal(r.dropped, 1);
  const none = L.lockSide([], 'bride');
  assert.deepEqual(none, { entries: [], dropped: 0 });
});

/* ---------- 집계 ---------- */

test('summarize: 전체와 측별 인원/금액/식권', () => {
  const s = L.summarize(sample());
  assert.deepEqual(
    { count: s.count, amount: s.amount, meals: s.meals, kidMeals: s.kidMeals, totalMeals: s.totalMeals },
    { count: 3, amount: 230000, meals: 3, kidMeals: 1, totalMeals: 4 }
  );
  assert.deepEqual(s.bySide.groom, { count: 2, amount: 180000, meals: 2, kidMeals: 1, totalMeals: 3 });
  assert.deepEqual(s.bySide.bride, { count: 1, amount: 50000, meals: 1, kidMeals: 0, totalMeals: 1 });
});

test('summarize: 빈 목록은 모두 0', () => {
  const s = L.summarize([]);
  assert.equal(s.count, 0);
  assert.equal(s.amount, 0);
  assert.equal(s.bySide.bride.meals, 0);
});

/* ---------- CSV (한쪽 데이터만) ---------- */

test('toCSV: 헤더/행/합계 구조와 CRLF — 선택한 측 데이터만', () => {
  const csv = L.toCSV(sample(), { side: 'groom' });
  assert.deepEqual(csv.split('\r\n'), [
    '번호,구분,이름,관계,축의금(원),식권 대인(장),식권 소인(장),식권 합계(장),접수시각',
    '1,신랑측,홍길동,가족/친척,150000,2,1,3,2026-11-04 13:05:09',
    '2,신랑측,이철수,,30000,0,0,0,2026-11-04 13:05:09',
    '',
    ',신랑측 합계,2명,,180000,2,1,3,',
    '',
  ]);
});

test('toCSV: 다른 측 항목과 전체 합계는 절대 포함되지 않는다', () => {
  const csv = L.toCSV(sample(), { side: 'bride' });
  assert.ok(csv.includes('김영희'));
  for (const leaked of ['홍길동', '이철수', '신랑측', '전체', '230000']) {
    assert.ok(!csv.includes(leaked), `유출됨: ${leaked}`);
  }
});

test('toCSV: side를 지정하지 않으면 내보내지 않고 오류를 낸다', () => {
  assert.throws(() => L.toCSV(sample()), /side/);
  assert.throws(() => L.toCSV(sample(), { side: 'x' }), /side/);
});

test('toCSV: bom 옵션을 켜면 UTF-8 BOM이 붙는다 (엑셀 한글 깨짐 방지)', () => {
  assert.equal(L.toCSV([], { side: 'groom', bom: true }).charCodeAt(0), 0xfeff);
  assert.notEqual(L.toCSV([], { side: 'groom' }).charCodeAt(0), 0xfeff);
});

test('toCSV: 콤마/따옴표 이스케이프와 수식 주입 방지', () => {
  const list = [
    { id: '1', side: 'groom', name: 'Kim, "KJ"', amount: 10000, meals: 0, createdAt: T0 },
    { id: '2', side: 'groom', name: '=SUM(A1)', amount: 10000, meals: 0, createdAt: T0 },
  ];
  const lines = L.toCSV(list, { side: 'groom' }).split('\r\n');
  assert.equal(lines[1], '1,신랑측,"Kim, ""KJ""",,10000,0,0,0,2026-11-04 13:05:09');
  assert.equal(lines[2], "2,신랑측,'=SUM(A1),,10000,0,0,0,2026-11-04 13:05:09");
});

/* ---------- 엑셀용 시트 모델 (한쪽 데이터만) ---------- */

test('toSheetModel: 선택한 측 항목과 합계만 담는다', () => {
  const m = L.toSheetModel(sample(), 'groom');
  assert.equal(m.sheetName, '신랑측 축의금');
  assert.deepEqual(m.rows.map((r) => [r.no, r.name, r.amount, r.meals, r.kidMeals, r.totalMeals]), [
    [1, '홍길동', 150000, 2, 1, 3],
    [2, '이철수', 30000, 0, 0, 0],
  ]);
  assert.deepEqual(m.total, { label: '신랑측 합계', count: 2, amount: 180000, meals: 2, kidMeals: 1, totalMeals: 3 });
  assert.ok(!JSON.stringify(m).includes('김영희'));
});

test('toSheetModel: side를 지정하지 않으면 오류', () => {
  assert.throws(() => L.toSheetModel(sample()), /side/);
  assert.throws(() => L.toSheetModel(sample(), 'x'), /side/);
});

/* ---------- 저장 / 복원 ---------- */

test('serialize → parseStored 왕복 (측 정보 포함)', () => {
  const state = { entries: sample().filter((e) => e.side === 'groom'), side: 'groom' };
  assert.deepEqual(L.parseStored(L.serialize(state)), state);
});

test('parseStored: 깨진 JSON/없는 값/버전 불일치는 빈 상태로 안전하게 처리', () => {
  const empty = { entries: [], side: null };
  assert.deepEqual(L.parseStored(null), empty);
  assert.deepEqual(L.parseStored('{깨짐'), empty);
  assert.deepEqual(L.parseStored('{"version":99,"entries":[]}'), empty);
  assert.deepEqual(L.parseStored('{"version":1,"entries":"x"}'), empty);
});

test('parseStored: 유효하지 않은 항목은 걸러내고, 고정된 측이 아닌 항목도 제외한다', () => {
  const raw = JSON.stringify({
    version: 1,
    side: 'groom',
    entries: [
      { id: 'ok', side: 'groom', name: '홍길동', amount: 10000, meals: 1, createdAt: T0 },
      { id: 'bad', side: 'groom', name: '', amount: 10000, meals: 1, createdAt: T0 },
      { side: 'groom', name: 'id없음', amount: 10000, meals: 1, createdAt: T0 },
      { id: 'other', side: 'bride', name: '김영희', amount: 10000, meals: 1, createdAt: T0 },
    ],
  });
  const r = L.parseStored(raw);
  assert.deepEqual(r.entries.map((e) => e.id), ['ok']);
  assert.equal(r.side, 'groom');
});

test('parseStored: 측이 없는 예전 형식은 미선택(null)으로 불러오고 데이터는 보존한다', () => {
  const legacy = JSON.stringify({
    version: 1,
    lastSide: 'groom',
    entries: [
      { id: 'a', side: 'groom', name: '홍길동', amount: 10000, meals: 0, createdAt: T0 },
      { id: 'b', side: 'bride', name: '김영희', amount: 10000, meals: 0, createdAt: T0 },
    ],
  });
  const r = L.parseStored(legacy);
  assert.equal(r.side, null);
  assert.equal(r.entries.length, 2);
  assert.equal(L.parseStored('{"version":1,"side":"nope","entries":[]}').side, null);
});

/* ---------- 날짜 ---------- */

test('날짜 포맷', () => {
  assert.equal(L.formatDateTime(T0), '2026-11-04 13:05:09');
  assert.equal(L.formatClock(T0), '13:05');
  assert.equal(L.formatDateStamp(new Date(2026, 10, 4)), '20261104');
  assert.equal(L.formatDateTime('invalid'), '');
});

/* ---------- 앱 설치 안내 ---------- */

test('detectInstallMode: 이미 설치되어 실행 중이면 installed', () => {
  assert.equal(L.detectInstallMode({ standalone: true, userAgent: 'iPad' }), 'installed');
  assert.equal(L.detectInstallMode({ displayModeStandalone: true }), 'installed');
});

test('detectInstallMode: 아이패드/아이폰은 ios (일반 UA와 iPadOS 데스크톱 UA 모두)', () => {
  assert.equal(L.detectInstallMode({ userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)' }), 'ios');
  assert.equal(L.detectInstallMode({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)' }), 'ios');
  assert.equal(
    L.detectInstallMode({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', platform: 'MacIntel', maxTouchPoints: 5 }),
    'ios'
  );
});

test('detectInstallMode: 맥 데스크톱/안드로이드/값 없음은 other', () => {
  assert.equal(
    L.detectInstallMode({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', platform: 'MacIntel', maxTouchPoints: 0 }),
    'other'
  );
  assert.equal(L.detectInstallMode({ userAgent: 'Mozilla/5.0 (Linux; Android 14)' }), 'other');
  assert.equal(L.detectInstallMode(), 'other');
});

test('parseAmountInput: 직접 입력 금액 해석', () => {
  assert.equal(L.parseAmountInput('20000'), 20000);
  assert.equal(L.parseAmountInput(' 25,000원 '), 25000);
  assert.equal(L.parseAmountInput('0'), null);
  assert.equal(L.parseAmountInput(''), null);
  assert.equal(L.parseAmountInput('-5000'), null);
  assert.equal(L.parseAmountInput('1.5'), null);
  assert.equal(L.parseAmountInput('2만'), null);
  assert.equal(L.parseAmountInput(null), null);
  assert.equal(L.parseAmountInput('9'.repeat(13)), null);
});

/* ---------- 식권 대인/소인 ---------- */

test('validateEntry: 소인 식권 — 생략하면 0, 범위를 벗어나면 오류', () => {
  assert.equal(L.validateEntry({ name: 'A', side: 'groom', amount: 10000, meals: 1 }).value.kidMeals, 0);
  assert.equal(L.validateEntry({ name: 'A', side: 'groom', amount: 10000, meals: 1, kidMeals: 2 }).value.kidMeals, 2);
  const bad = L.validateEntry({ name: 'A', side: 'groom', amount: 10000, meals: 0, kidMeals: L.MAX_MEALS + 1 });
  assert.equal(bad.ok, false);
  assert.ok(bad.errors[0].includes('소인'));
  assert.equal(L.validateEntry({ name: 'A', side: 'groom', amount: 10000, meals: 0, kidMeals: -1 }).ok, false);
  assert.equal(L.validateEntry({ name: 'A', side: 'groom', amount: 10000, meals: 0, kidMeals: 1.5 }).ok, false);
});

test('updateEntry/parseStored: 소인 식권이 수정·저장·복원된다 (이전 데이터는 소인 0)', () => {
  const after = L.updateEntry(sample(), 'c', { name: '이철수', side: 'groom', amount: 30000, meals: 1, kidMeals: 2 });
  const c = after.find((e) => e.id === 'c');
  assert.deepEqual([c.meals, c.kidMeals], [1, 2]);
  const back = L.parseStored(L.serialize({ side: 'groom', entries: after }));
  assert.deepEqual(back.entries.find((e) => e.id === 'c').kidMeals, 2);
  const old = JSON.stringify({ version: 1, side: 'groom', entries: [{ id: 'x', side: 'groom', name: '구', amount: 10000, meals: 2, createdAt: T0 }] });
  assert.equal(L.parseStored(old).entries[0].kidMeals, 0);
});

test('관계: 선택 안 함/유효 키/잘못된 키', () => {
  const base = { name: '홍길동', side: 'groom', amount: 50000, meals: 1 };
  assert.equal(L.validateEntry(base).value.relation, '');
  assert.equal(L.validateEntry({ ...base, relation: null }).value.relation, '');
  for (const k of Object.keys(L.RELATIONS)) {
    assert.equal(L.validateEntry({ ...base, relation: k }).value.relation, k);
  }
  const bad = L.validateEntry({ ...base, relation: 'boss' });
  assert.equal(bad.ok, false);
  assert.match(bad.errors.join(' '), /관계/);
});

test('관계: 라벨 변환과 CSV 출력', () => {
  assert.equal(L.relationLabel('work'), '직장');
  assert.equal(L.relationLabel(''), '');
  const csv = L.toCSV([{ id: 'x', side: 'groom', name: 'A', relation: 'friend', amount: 1000, meals: 0, kidMeals: 0, createdAt: T0 }], { side: 'groom' });
  assert.ok(csv.includes('A,친구/지인,1000'));
});
