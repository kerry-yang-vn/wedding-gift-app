/* 축의금 접수 앱 — 순수 로직 (DOM·저장소 의존 없음, 브라우저/Node 공용) */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.GiftLogic = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const AMOUNT_BUTTONS = Object.freeze([10000, 30000, 50000, 100000]);
  const SIDES = Object.freeze({ groom: '신랑측', bride: '신부측' });
  const MAX_MEALS = 99;
  const MAX_AMOUNT = 100000000; // 1억 원 — 오입력 방지용 상한
  const MAX_NAME_LENGTH = 30;
  const STORAGE_VERSION = 1;

  const hasSide = (side) => Object.prototype.hasOwnProperty.call(SIDES, side);

  /* ---------- 금액 / 표시 ---------- */

  function sumTaps(taps) {
    return taps.reduce((acc, v) => acc + v, 0);
  }

  function formatWon(amount) {
    const n = Math.trunc(Number(amount) || 0);
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '원';
  }

  // 10000 → "1만", 100000 → "10만", 그 외는 "15,000원"
  function formatMan(amount) {
    return amount % 10000 === 0 ? `${amount / 10000}만` : formatWon(amount);
  }

  function clampMeals(current, delta) {
    return Math.min(MAX_MEALS, Math.max(0, current + delta));
  }

  const pad = (n) => String(n).padStart(2, '0');

  function formatDateTime(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
      `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  function formatClock(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function formatDateStamp(date) {
    return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
  }

  /* ---------- 검증 / 생성 ---------- */

  function normalizeName(name) {
    return String(name == null ? '' : name).replace(/\s+/g, ' ').trim();
  }

  function validateEntry(input) {
    const errors = [];
    const src = input || {};
    const name = normalizeName(src.name);
    const side = src.side;
    const amount = Number(src.amount);
    const meals = Number(src.meals);

    if (!name) errors.push('이름을 입력해 주세요.');
    else if (name.length > MAX_NAME_LENGTH) errors.push(`이름은 ${MAX_NAME_LENGTH}자 이하로 입력해 주세요.`);

    if (!hasSide(side)) errors.push('신랑측/신부측을 선택해 주세요.');

    if (!Number.isInteger(amount) || amount <= 0) errors.push('축의금 금액을 선택해 주세요.');
    else if (amount > MAX_AMOUNT) errors.push(`축의금은 ${formatWon(MAX_AMOUNT)} 이하로 입력해 주세요.`);

    if (!Number.isInteger(meals) || meals < 0 || meals > MAX_MEALS) {
      errors.push(`식권은 0~${MAX_MEALS}장 사이로 입력해 주세요.`);
    }

    return {
      ok: errors.length === 0,
      errors,
      value: errors.length === 0 ? { name, side, amount, meals } : null,
    };
  }

  function createEntry(value, id, createdAt) {
    return { id, side: value.side, name: value.name, amount: value.amount, meals: value.meals, createdAt };
  }

  /* ---------- 목록 조작 (불변: 항상 새 배열 반환) ---------- */

  function updateEntry(entries, id, value) {
    return entries.map((e) =>
      e.id === id ? { ...e, side: value.side, name: value.name, amount: value.amount, meals: value.meals } : e
    );
  }

  function removeEntry(entries, id) {
    const index = entries.findIndex((e) => e.id === id);
    if (index === -1) return { entries, removed: null, index: -1 };
    return {
      entries: entries.slice(0, index).concat(entries.slice(index + 1)),
      removed: entries[index],
      index,
    };
  }

  function insertEntryAt(entries, index, entry) {
    const i = Math.min(Math.max(index, 0), entries.length);
    return entries.slice(0, i).concat(entry, entries.slice(i));
  }

  function filterEntries(entries, { query = '', side = 'all' } = {}) {
    const q = normalizeName(query).toLowerCase();
    return entries.filter(
      (e) => (side === 'all' || e.side === side) && (!q || e.name.toLowerCase().includes(q))
    );
  }

  // 기기의 측을 고정할 때 다른 측 항목은 제외한다. dropped = 제외된 개수
  function lockSide(entries, side) {
    const kept = entries.filter((e) => e.side === side);
    return { entries: kept, dropped: entries.length - kept.length };
  }

  /* ---------- 집계 ---------- */

  function summarize(entries) {
    const empty = () => ({ count: 0, amount: 0, meals: 0 });
    const result = { ...empty(), bySide: { groom: empty(), bride: empty() } };
    for (const e of entries) {
      const bucket = result.bySide[e.side];
      for (const target of bucket ? [result, bucket] : [result]) {
        target.count += 1;
        target.amount += e.amount;
        target.meals += e.meals;
      }
    }
    return result;
  }

  /* ---------- CSV ---------- */

  function csvCell(value, isText) {
    let s = String(value == null ? '' : value);
    // 엑셀 수식 주입 방지: =, +, -, @ 로 시작하는 텍스트는 앞에 ' 를 붙인다
    if (isText && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
    if (/[",\r\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  // 한쪽(side) 데이터만 내보낸다. 다른 측 항목과 전체 합계는 절대 포함하지 않는다.
  function toCSV(entries, { side, bom = false } = {}) {
    if (!hasSide(side)) throw new Error('toCSV: side(groom/bride)를 지정해야 합니다.');
    const own = entries.filter((e) => e.side === side);
    const row = (cells) => cells.join(',');
    const lines = [row(['번호', '구분', '이름', '축의금(원)', '식권(장)', '접수시각'])];

    own.forEach((e, i) => {
      lines.push(
        row([
          i + 1,
          csvCell(SIDES[e.side] || ''),
          csvCell(e.name, true),
          e.amount,
          e.meals,
          csvCell(formatDateTime(e.createdAt)),
        ])
      );
    });

    const s = summarize(own);
    lines.push('');
    lines.push(row(['', `${SIDES[side]} 합계`, `${s.count}명`, s.amount, s.meals, '']));

    return (bom ? '﻿' : '') + lines.join('\r\n') + '\r\n';
  }

  /* ---------- 엑셀(.xlsx)용 시트 모델 (한쪽 데이터만) ---------- */

  function toSheetModel(entries, side) {
    if (!hasSide(side)) throw new Error('toSheetModel: side(groom/bride)를 지정해야 합니다.');
    const own = entries.filter((e) => e.side === side);
    const s = summarize(own);
    return {
      sheetName: `${SIDES[side]} 축의금`,
      headers: ['번호', '구분', '이름', '축의금(원)', '식권(장)', '접수시각'],
      rows: own.map((e, i) => ({
        no: i + 1,
        side: SIDES[e.side],
        name: e.name,
        amount: e.amount,
        meals: e.meals,
        createdAt: e.createdAt,
      })),
      total: { label: `${SIDES[side]} 합계`, count: s.count, amount: s.amount, meals: s.meals },
    };
  }

  /* ---------- 저장 / 복원 ---------- */

  function serialize(state) {
    return JSON.stringify({ version: STORAGE_VERSION, side: state.side, entries: state.entries });
  }

  function parseStored(raw) {
    const empty = { entries: [], side: null };
    if (!raw) return empty;

    let data;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      return empty;
    }
    if (!data || data.version !== STORAGE_VERSION || !Array.isArray(data.entries)) return empty;

    const entries = [];
    for (const e of data.entries) {
      const v = validateEntry(e);
      if (v.ok && typeof e.id === 'string' && e.id) {
        entries.push({ id: e.id, ...v.value, createdAt: typeof e.createdAt === 'string' ? e.createdAt : '' });
      }
    }
    // side가 없으면(첫 실행·예전 형식) 미선택(null). 측이 고정된 기기에서는 다른 측 데이터가
    // 섞여 있어도 집계·내보내기에 나오지 않도록 걸러낸다.
    const side = hasSide(data.side) ? data.side : null;
    return { entries: side ? entries.filter((e) => e.side === side) : entries, side };
  }

  /* ---------- 앱 설치(PWA) 안내 ---------- */

  // 반환값: 'installed'(이미 설치돼 실행 중) | 'ios'(홈 화면에 추가 안내 필요) | 'other'
  function detectInstallMode(env) {
    const e = env || {};
    if (e.standalone === true || e.displayModeStandalone === true) return 'installed';
    const ua = String(e.userAgent || '');
    // iPadOS의 Safari는 Mac처럼 보고되므로 터치 지원 여부로 구분한다
    const isIOS = /iPad|iPhone|iPod/.test(ua) || (e.platform === 'MacIntel' && Number(e.maxTouchPoints) > 1);
    return isIOS ? 'ios' : 'other';
  }

  return {
    AMOUNT_BUTTONS,
    SIDES,
    MAX_MEALS,
    MAX_AMOUNT,
    MAX_NAME_LENGTH,
    sumTaps,
    formatWon,
    formatMan,
    clampMeals,
    formatDateTime,
    formatClock,
    formatDateStamp,
    normalizeName,
    validateEntry,
    createEntry,
    updateEntry,
    removeEntry,
    insertEntryAt,
    filterEntries,
    lockSide,
    summarize,
    toCSV,
    toSheetModel,
    serialize,
    parseStored,
    detectInstallMode,
  };
});
