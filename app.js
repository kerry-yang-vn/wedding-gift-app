/* 축의금 접수 앱 — 화면/이벤트/저장소 (계산 로직은 logic.js) */
(() => {
  'use strict';

  const L = window.GiftLogic;
  const STORAGE_KEY = 'wedding-gift-v1';
  const $ = (id) => document.getElementById(id);

  /* ---------- 상태 & 저장소 ---------- */

  let storageOk = true;

  function loadState() {
    try {
      return L.parseStored(localStorage.getItem(STORAGE_KEY));
    } catch (e) {
      storageOk = false;
      return L.parseStored(null);
    }
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, L.serialize(state));
      storageOk = true;
    } catch (e) {
      storageOk = false;
    }
    $('storage-warning').hidden = storageOk;
  }

  const state = loadState();
  const form = { side: state.lastSide, base: 0, taps: [], meals: 0, editingId: null };
  const filter = { query: '', side: 'all' };
  let undoDelete = null;
  let toastTimer = null;

  const currentAmount = () => form.base + L.sumTaps(form.taps);

  function newId() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  /* ---------- DOM 유틸 ---------- */

  function el(tag, attrs, ...kids) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else node.setAttribute(k, v);
    }
    node.append(...kids.filter(Boolean));
    return node;
  }

  function toast(message, action) {
    const t = $('toast');
    t.replaceChildren(el('span', { text: message }));
    if (action) {
      const btn = el('button', { type: 'button', class: 'toast-btn', text: action.label });
      btn.addEventListener('click', () => {
        t.hidden = true;
        action.onClick();
      });
      t.append(btn);
    }
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      t.hidden = true;
      if (action) undoDelete = null;
    }, action ? 7000 : 2200);
  }

  /* ---------- 렌더링 ---------- */

  function renderSummary() {
    const s = L.summarize(state.entries);
    $('sum-count').textContent = `${s.count}명`;
    $('sum-amount').textContent = L.formatWon(s.amount);
    $('sum-meals').textContent = `${s.meals}장`;
    for (const side of ['groom', 'bride']) {
      const b = s.bySide[side];
      $(`${side}-amount`).textContent = L.formatWon(b.amount);
      $(`${side}-detail`).textContent = `${b.count}명 · 식권 ${b.meals}장`;
    }
  }

  function renderForm() {
    document.querySelectorAll('.seg-btn').forEach((b) =>
      b.setAttribute('aria-pressed', String(b.dataset.side === form.side))
    );

    $('amount-view').textContent = L.formatWon(currentAmount());
    const parts = [];
    if (form.base) parts.push(`기존 ${L.formatMan(form.base)}`);
    form.taps.forEach((t) => parts.push(L.formatMan(t)));
    $('amount-formula').textContent = parts.length ? parts.join(' + ') : '아래 금액 버튼을 눌러 더하세요';

    $('undo').disabled = form.taps.length === 0;
    $('clear').disabled = currentAmount() === 0;
    $('meal-view').textContent = `${form.meals}장`;
    $('meal-minus').disabled = form.meals <= 0;
    $('meal-plus').disabled = form.meals >= L.MAX_MEALS;

    const editing = form.editingId !== null;
    $('submit').textContent = editing ? '수정 저장' : '등록';
    $('cancel-edit').hidden = !editing;
    $('form-title').textContent = editing ? '접수 수정' : '접수 입력';
    $('form-card').classList.toggle('editing', editing);
  }

  function renderItem(e, no) {
    return el(
      'li',
      { class: 'item' + (form.editingId === e.id ? ' editing' : '') },
      el('span', { class: 'no', text: String(no) }),
      el('span', { class: `pill ${e.side}`, text: L.SIDES[e.side] }),
      el('div', { class: 'nm' }, el('strong', { text: e.name }), el('small', { text: L.formatClock(e.createdAt) })),
      el('span', { class: 'money', text: L.formatWon(e.amount) }),
      el('span', { class: 'meal', text: `식권 ${e.meals}장` }),
      el(
        'div',
        { class: 'acts' },
        el('button', { type: 'button', class: 'mini', 'data-action': 'edit', 'data-id': e.id, text: '수정' }),
        el('button', { type: 'button', class: 'mini del', 'data-action': 'delete', 'data-id': e.id, text: '삭제' })
      )
    );
  }

  function renderList() {
    const numberById = new Map(state.entries.map((e, i) => [e.id, i + 1]));
    const shown = L.filterEntries(state.entries, filter).reverse(); // 최신순
    $('list').replaceChildren(...shown.map((e) => renderItem(e, numberById.get(e.id))));
    const empty = $('empty');
    empty.hidden = shown.length > 0;
    empty.textContent = state.entries.length ? '조건에 맞는 내역이 없습니다.' : '아직 접수된 내역이 없습니다.';
    document.querySelectorAll('.chip').forEach((c) =>
      c.setAttribute('aria-pressed', String(c.dataset.filter === filter.side))
    );
  }

  function renderAll() {
    renderSummary();
    renderForm();
    renderList();
  }

  /* ---------- 폼 동작 ---------- */

  function resetForm() {
    form.base = 0;
    form.taps = [];
    form.meals = 0;
    form.editingId = null;
    $('name').value = '';
    $('form-msg').textContent = '';
  }

  function submit() {
    const result = L.validateEntry({
      name: $('name').value,
      side: form.side,
      amount: currentAmount(),
      meals: form.meals,
    });
    if (!result.ok) {
      $('form-msg').textContent = result.errors.join(' ');
      if (!L.normalizeName($('name').value)) $('name').focus();
      return;
    }

    const v = result.value;
    if (form.editingId) {
      state.entries = L.updateEntry(state.entries, form.editingId, v);
      toast(`${v.name}님 수정 완료`);
    } else {
      state.entries = state.entries.concat(L.createEntry(v, newId(), new Date().toISOString()));
      toast(`${v.name}님 ${L.formatWon(v.amount)} · 식권 ${v.meals}장 등록`);
    }
    state.lastSide = v.side;
    saveState();
    resetForm();
    renderAll();
    $('name').focus();
  }

  function startEdit(id) {
    const e = state.entries.find((x) => x.id === id);
    if (!e) return;
    form.editingId = id;
    form.side = e.side;
    form.base = e.amount;
    form.taps = [];
    form.meals = e.meals;
    $('name').value = e.name;
    $('form-msg').textContent = '';
    renderAll();
    $('form-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function deleteEntry(id) {
    const r = L.removeEntry(state.entries, id);
    if (!r.removed) return;
    state.entries = r.entries;
    if (form.editingId === id) resetForm();
    saveState();
    renderAll();
    undoDelete = { entry: r.removed, index: r.index };
    toast(`${r.removed.name}님 삭제됨`, { label: '되돌리기', onClick: restoreDelete });
  }

  function restoreDelete() {
    if (!undoDelete) return;
    state.entries = L.insertEntryAt(state.entries, undoDelete.index, undoDelete.entry);
    undoDelete = null;
    saveState();
    renderAll();
    toast('복구했습니다');
  }

  function resetAll() {
    if (!state.entries.length) {
      toast('삭제할 내역이 없습니다');
      return;
    }
    const s = L.summarize(state.entries);
    const answer = window.prompt(
      `전체 ${s.count}건(${L.formatWon(s.amount)})을 모두 삭제합니다.\nCSV를 먼저 내보내셨나요?\n계속하려면 "삭제"를 입력하세요.`
    );
    if (answer && answer.trim() === '삭제') {
      state.entries = [];
      undoDelete = null;
      saveState();
      resetForm();
      renderAll();
      toast('전체 삭제했습니다');
    }
  }

  /* ---------- CSV 내보내기 ---------- */

  async function exportCsv() {
    if (!state.entries.length) {
      toast('내보낼 내역이 없습니다');
      return;
    }
    const csv = L.toCSV(state.entries, { bom: true });
    const filename = `축의금_${L.formatDateStamp(new Date())}.csv`;

    // 아이패드: 공유 시트(파일에 저장 / AirDrop / 메일)가 가장 안정적
    try {
      const file = new File([csv], filename, { type: 'text/csv' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: '축의금 내역' });
        return;
      }
    } catch (err) {
      if (err && err.name === 'AbortError') return; // 사용자가 공유 시트를 닫음
    }

    // 폴백: 일반 다운로드
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = el('a', { href: url, download: filename });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /* ---------- 이벤트 연결 ---------- */

  L.AMOUNT_BUTTONS.forEach((v) => {
    const btn = el('button', { type: 'button', class: 'amt', 'aria-label': `${L.formatWon(v)} 더하기`, text: L.formatMan(v) });
    btn.addEventListener('click', () => {
      if (currentAmount() + v > L.MAX_AMOUNT) {
        $('form-msg').textContent = `축의금은 ${L.formatWon(L.MAX_AMOUNT)} 이하로 입력해 주세요.`;
        return;
      }
      $('form-msg').textContent = '';
      form.taps.push(v);
      renderForm();
    });
    $('amount-grid').append(btn);
  });

  document.querySelectorAll('.seg-btn').forEach((btn) =>
    btn.addEventListener('click', () => {
      form.side = btn.dataset.side;
      renderForm();
    })
  );

  $('undo').addEventListener('click', () => { form.taps.pop(); renderForm(); });
  $('clear').addEventListener('click', () => { form.base = 0; form.taps = []; renderForm(); });
  $('meal-minus').addEventListener('click', () => { form.meals = L.clampMeals(form.meals, -1); renderForm(); });
  $('meal-plus').addEventListener('click', () => { form.meals = L.clampMeals(form.meals, 1); renderForm(); });
  $('submit').addEventListener('click', submit);
  $('cancel-edit').addEventListener('click', () => { resetForm(); renderAll(); });
  $('name').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('name').blur(); });

  $('search').addEventListener('input', (e) => { filter.query = e.target.value; renderList(); });
  document.querySelectorAll('.chip').forEach((chip) =>
    chip.addEventListener('click', () => { filter.side = chip.dataset.filter; renderList(); })
  );

  $('list').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    if (btn.dataset.action === 'edit') startEdit(btn.dataset.id);
    else if (btn.dataset.action === 'delete') deleteEntry(btn.dataset.id);
  });

  $('export').addEventListener('click', exportCsv);
  $('reset-all').addEventListener('click', resetAll);

  /* ---------- 시작 ---------- */

  renderAll();
  if (!storageOk) $('storage-warning').hidden = false;

  // 브라우저가 저장소를 임의로 비우지 않도록 요청 (실패해도 무방)
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

  // 오프라인 지원 (http/https 에서만 동작)
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
})();
