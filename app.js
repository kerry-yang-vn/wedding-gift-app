/* 축의금 접수 앱 — 화면/이벤트/저장소 (계산 로직은 logic.js)
   이 기기는 신랑측/신부측 중 한쪽으로 고정되며, 상대측 정보와 전체 합계는 어디에도 표시·내보내기되지 않는다. */
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

  const state = loadState(); // { entries, side } — side가 null이면 아직 측을 고르지 않은 상태
  const form = { base: 0, taps: [], meals: 0, kids: 0, relation: '', editingId: null }; // meals=식권 대인, kids=식권 소인
  const filter = { query: '' };
  let undoDelete = null;
  let toastTimer = null;

  const currentAmount = () => form.base + L.sumTaps(form.taps);

  // 화면에 보여주는 데이터는 항상 이 기기의 측 항목뿐이다 (측 미선택이면 아무것도 보이지 않음)
  const ownEntries = () => (state.side ? state.entries.filter((e) => e.side === state.side) : []);

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
    }, action ? 7000 : 2800);
  }

  /* ---------- 렌더링 ---------- */

  function renderSide() {
    document.body.dataset.side = state.side || '';
    $('side-label').textContent = state.side ? `${L.SIDES[state.side]} 접수대` : '선택 필요';
    $('side-setup').hidden = Boolean(state.side);
  }

  function renderSummary() {
    const s = L.summarize(ownEntries());
    $('sum-count').textContent = `${s.count}명`;
    $('sum-amount').textContent = L.formatWon(s.amount);
    $('sum-meals').textContent = `${s.totalMeals}장`;
    $('sum-meals-detail').textContent = `대인 ${s.meals} · 소인 ${s.kidMeals}`;
  }

  function renderForm() {
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
    document.querySelectorAll('#relation-chips .chip').forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.relation === form.relation)));
    $('kid-view').textContent = `${form.kids}장`;
    $('kid-minus').disabled = form.kids <= 0;
    $('kid-plus').disabled = form.kids >= L.MAX_MEALS;

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
      el(
        'div',
        { class: 'nm' },
        el('div', {}, el('strong', { text: e.name }), e.relation ? el('span', { class: 'tag', text: L.relationLabel(e.relation) }) : ''),
        el('small', { text: L.formatClock(e.createdAt) })
      ),
      el('span', { class: 'money', text: L.formatWon(e.amount) }),
      el('span', { class: 'meal', text: `식권 대인 ${e.meals} · 소인 ${e.kidMeals || 0}` }),
      el(
        'div',
        { class: 'acts' },
        el('button', { type: 'button', class: 'mini btn-outlined', 'data-action': 'edit', 'data-id': e.id, text: '수정' }),
        el('button', { type: 'button', class: 'mini btn-danger', 'data-action': 'delete', 'data-id': e.id, text: '삭제' })
      )
    );
  }

  function renderList() {
    const own = ownEntries();
    const numberById = new Map(own.map((e, i) => [e.id, i + 1]));
    const shown = L.filterEntries(own, { query: filter.query }).reverse(); // 최신순
    $('list').replaceChildren(...shown.map((e) => renderItem(e, numberById.get(e.id))));
    const empty = $('empty');
    empty.hidden = shown.length > 0;
    empty.textContent = own.length ? '조건에 맞는 내역이 없습니다.' : '아직 접수된 내역이 없습니다.';
  }

  function renderAll() {
    renderSide();
    renderSummary();
    renderForm();
    renderList();
  }

  /* ---------- 측 선택 / 변경 ---------- */

  function chooseSide(side) {
    const { entries, dropped } = L.lockSide(state.entries, side);
    if (dropped > 0) {
      const ok = window.confirm(
        `이 기기에 저장된 예전(연습) 데이터 중 ${L.SIDES[side]}이 아닌 ${dropped}건은 삭제됩니다.\n계속할까요?`
      );
      if (!ok) return;
    }
    state.entries = entries;
    state.side = side;
    saveState();
    resetForm();
    renderAll();
    $('name').focus();
  }

  function changeSide() {
    if (ownEntries().length > 0) {
      toast('접수 내역이 있어 측을 바꿀 수 없습니다. 먼저 CSV로 백업하고 전체 삭제를 해주세요.');
      return;
    }
    state.side = null;
    saveState();
    resetForm();
    renderAll();
  }

  /* ---------- 폼 동작 ---------- */

  function resetForm() {
    form.base = 0;
    form.taps = [];
    form.meals = 0;
    form.kids = 0;
    form.relation = '';
    form.editingId = null;
    $('name').value = '';
    $('form-msg').textContent = '';
  }

  function submit() {
    if (!state.side) return;
    const result = L.validateEntry({
      name: $('name').value,
      side: state.side,
      relation: form.relation,
      amount: currentAmount(),
      meals: form.meals,
      kidMeals: form.kids,
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
      toast(`${v.name}님 ${L.formatWon(v.amount)} · 식권 대인 ${v.meals}·소인 ${v.kidMeals} 등록`);
    }
    saveState();
    resetForm();
    renderAll();
    $('name').focus();
  }

  function startEdit(id) {
    const e = ownEntries().find((x) => x.id === id);
    if (!e) return;
    form.editingId = id;
    form.base = e.amount;
    form.taps = [];
    form.meals = e.meals;
    form.kids = e.kidMeals || 0;
    form.relation = e.relation || '';
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
    const own = ownEntries();
    if (!own.length) {
      toast('삭제할 내역이 없습니다');
      return;
    }
    const s = L.summarize(own);
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

  /* ---------- 내보내기 (엑셀 / CSV — 모두 이 기기의 측 데이터만) ---------- */

  // 태블릿(iPad 등): 공유 시트(파일에 저장 / AirDrop / 메일)를 먼저 시도하고, 안 되면 일반 다운로드로 대체
  async function deliverFile(parts, filename, mime) {
    try {
      const file = new File(parts, filename, { type: mime });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: `${L.SIDES[state.side]} 축의금 내역` });
        return;
      }
    } catch (err) {
      if (err && err.name === 'AbortError') return; // 사용자가 공유 시트를 닫음
    }

    const url = URL.createObjectURL(new Blob(parts, { type: mime }));
    const a = el('a', { href: url, download: filename });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('파일을 내려받았습니다. 저장되지 않았다면 CSV 버튼을 이용해 주세요.');
  }

  function exportable() {
    if (!state.side || !ownEntries().length) {
      toast('내보낼 내역이 없습니다');
      return false;
    }
    return true;
  }

  const fileStem = () => `축의금_${L.SIDES[state.side]}_${L.formatDateStamp(new Date())}`;

  /* ---------- 엑셀 내보내기 대화상자: 비밀번호 없이 / 비밀번호 걸기 ---------- */

  // 암호화에 1초 안팎이 걸리므로, 끝난 뒤 사용자가 "저장·공유하기"를 다시 눌러 전달한다.
  // (공유 시트는 사용자가 방금 누른 직후에만 열 수 있어서, 대기 후 자동으로 열면 막힐 수 있음)
  const exp = { bytes: null, busy: false };

  const cryptoReady = () => !!(window.GiftCrypto && window.crypto && window.crypto.subtle);
  const exportMode = () => document.querySelector('input[name="export-mode"]:checked').value;

  function showExportMsg(text, ok) {
    const m = $('export-msg');
    m.textContent = text || '';
    m.classList.toggle('ok', !!ok);
  }

  function syncExportDialog() {
    const usePw = exportMode() === 'password';
    const locked = exp.busy || !!exp.bytes;
    $('export-pw-box').hidden = !usePw;
    document.querySelectorAll('#export-dialog input').forEach((i) => { i.disabled = locked && i.id !== 'export-show'; });
    if (!cryptoReady()) $('export-mode-pw').disabled = true;
    $('export-go').disabled = exp.busy;
    $('export-cancel').disabled = exp.busy;
    $('export-go').textContent = exp.bytes ? '저장·공유하기' : usePw ? '암호화하여 만들기' : '내보내기';
  }

  function openExportDialog() {
    exp.bytes = null;
    exp.busy = false;
    document.querySelector('input[name="export-mode"][value="plain"]').checked = true;
    ['export-pw', 'export-pw2'].forEach((id) => { $(id).value = ''; $(id).type = 'password'; });
    $('export-show').checked = false;
    $('export-nocrypto').hidden = cryptoReady();
    $('export-scope').textContent = `${L.SIDES[state.side]} 접수 ${ownEntries().length}건만 담깁니다.`;
    showExportMsg('');
    syncExportDialog();
    $('export-dialog').hidden = false;
    $('export-go').focus();
  }

  function closeExportDialog() {
    if (exp.busy) return;
    exp.bytes = null;
    ['export-pw', 'export-pw2'].forEach((id) => { $(id).value = ''; }); // 비밀번호를 화면에 남기지 않음
    $('export-dialog').hidden = true;
  }

  async function submitExport(e) {
    e.preventDefault();
    if (exp.busy) return;

    if (exp.bytes) { // 암호화된 파일 전달
      const bytes = exp.bytes;
      closeExportDialog();
      await deliverFile([bytes], `${fileStem()}.xlsx`, window.GiftXlsx.MIME);
      return;
    }

    if (!state.side || !ownEntries().length) {
      closeExportDialog();
      toast('내보낼 내역이 없습니다');
      return;
    }
    const plain = window.GiftXlsx.build(L.toSheetModel(state.entries, state.side), { now: new Date() });

    if (exportMode() === 'plain') {
      closeExportDialog();
      await deliverFile([plain], `${fileStem()}.xlsx`, window.GiftXlsx.MIME);
      return;
    }

    const pw = $('export-pw').value;
    const check = window.GiftCrypto.validatePassword(pw);
    if (!check.ok) return showExportMsg(check.error);
    if (pw !== $('export-pw2').value) return showExportMsg('비밀번호 확인이 일치하지 않습니다.');

    exp.busy = true;
    syncExportDialog();
    showExportMsg('암호화 중… 0%', true);
    try {
      exp.bytes = await window.GiftCrypto.encryptXlsx(plain, pw, {
        onProgress: (p) => showExportMsg(`암호화 중… ${Math.round(p * 100)}%`, true),
      });
    } catch (err) {
      exp.bytes = null;
      exp.busy = false;
      syncExportDialog();
      return showExportMsg((err && err.message) || '암호화에 실패했습니다. 비밀번호 없이 내보내거나 CSV를 이용해 주세요.');
    }
    exp.busy = false;
    syncExportDialog();
    showExportMsg('암호화가 끝났습니다. 아래 버튼을 눌러 저장하세요.', true);
    $('export-go').focus();
  }

  function exportExcel() {
    if (!exportable()) return;
    openExportDialog();
  }

  async function exportCsv() {
    if (!exportable()) return;
    const csv = L.toCSV(state.entries, { side: state.side, bom: true });
    await deliverFile([csv], `${fileStem()}.csv`, 'text/csv;charset=utf-8');
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

  /* 직접 입력: 4개 버튼에 없는 금액(예: 2만, 25,000원)을 같은 방식으로 누적한다 */
  function setCustomOpen(open) {
    $('custom-row').hidden = !open;
    $('custom-open').hidden = open;
    $('custom-input').value = '';
    $('custom-preview').hidden = true;
    if (open) $('custom-input').focus();
  }

  function addCustom() {
    const v = L.parseAmountInput($('custom-input').value);
    if (!v) { $('form-msg').textContent = '금액을 숫자로 입력해 주세요. (예: 20000)'; return; }
    if (currentAmount() + v > L.MAX_AMOUNT) {
      $('form-msg').textContent = `축의금은 ${L.formatWon(L.MAX_AMOUNT)} 이하로 입력해 주세요.`;
      return;
    }
    $('form-msg').textContent = '';
    form.taps.push(v);
    renderForm();
    setCustomOpen(false);
  }

  $('custom-open').addEventListener('click', () => setCustomOpen(true));
  $('custom-cancel').addEventListener('click', () => setCustomOpen(false));
  $('custom-add').addEventListener('click', addCustom);
  $('custom-input').addEventListener('input', () => {
    const v = L.parseAmountInput($('custom-input').value);
    $('custom-preview').hidden = !v;
    if (v) $('custom-preview').textContent = `= ${L.formatWon(v)}`;
  });
  $('custom-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addCustom(); } });

  // 관계 칩: 선택 사항. 같은 칩을 다시 누르면 선택 해제
  Object.entries(L.RELATIONS).forEach(([key, label]) => {
    const chip = el('button', { type: 'button', class: 'chip', 'data-relation': key, 'aria-pressed': 'false', text: label });
    chip.addEventListener('click', () => { form.relation = form.relation === key ? '' : key; renderForm(); });
    $('relation-chips').append(chip);
  });

  document.querySelectorAll('[data-setup]').forEach((btn) =>
    btn.addEventListener('click', () => chooseSide(btn.dataset.setup))
  );
  $('change-side').addEventListener('click', changeSide);

  $('undo').addEventListener('click', () => { form.taps.pop(); renderForm(); });
  $('clear').addEventListener('click', () => { form.base = 0; form.taps = []; renderForm(); });
  $('meal-minus').addEventListener('click', () => { form.meals = L.clampMeals(form.meals, -1); renderForm(); });
  $('meal-plus').addEventListener('click', () => { form.meals = L.clampMeals(form.meals, 1); renderForm(); });
  $('kid-minus').addEventListener('click', () => { form.kids = L.clampMeals(form.kids, -1); renderForm(); });
  $('kid-plus').addEventListener('click', () => { form.kids = L.clampMeals(form.kids, 1); renderForm(); });
  $('submit').addEventListener('click', submit);
  $('cancel-edit').addEventListener('click', () => { resetForm(); renderAll(); });
  $('name').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('name').blur(); });

  $('search').addEventListener('input', (e) => { filter.query = e.target.value; renderList(); });

  $('list').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    if (btn.dataset.action === 'edit') startEdit(btn.dataset.id);
    else if (btn.dataset.action === 'delete') deleteEntry(btn.dataset.id);
  });

  $('export').addEventListener('click', exportExcel);
  $('export-csv').addEventListener('click', exportCsv);
  $('export-form').addEventListener('submit', submitExport);
  $('export-cancel').addEventListener('click', closeExportDialog);
  document.querySelectorAll('input[name="export-mode"]').forEach((r) => r.addEventListener('change', () => { showExportMsg(''); syncExportDialog(); }));
  $('export-show').addEventListener('change', (e) => {
    $('export-pw').type = $('export-pw2').type = e.target.checked ? 'text' : 'password';
  });
  $('export-dialog').addEventListener('click', (e) => { if (e.target === $('export-dialog')) closeExportDialog(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('export-dialog').hidden) closeExportDialog(); });
  $('reset-all').addEventListener('click', resetAll);

  /* ---------- 앱 설치 안내 ---------- */

  let deferredPrompt = null; // 크롬/안드로이드/PC: 브라우저가 주는 설치 프롬프트
  let installBarDismissed = false;

  function renderInstallBar() {
    const mode = L.detectInstallMode({
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      maxTouchPoints: navigator.maxTouchPoints,
      standalone: navigator.standalone === true,
      displayModeStandalone: !!(window.matchMedia && window.matchMedia('(display-mode: standalone)').matches),
    });
    let show = false;
    if (mode !== 'installed' && !installBarDismissed) {
      if (deferredPrompt) {
        show = true;
        $('install-btn').textContent = '앱 설치';
      } else if (mode === 'ios') {
        // iOS Safari는 설치 프롬프트 API가 없어 안내 화면으로 대신한다
        show = true;
        $('install-btn').textContent = '설치 방법 보기';
      }
    }
    $('install-bar').hidden = !show;
  }

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    renderInstallBar();
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    renderInstallBar();
    toast('앱이 설치되었습니다');
  });

  $('install-btn').addEventListener('click', async () => {
    if (deferredPrompt) {
      const promptEvent = deferredPrompt;
      deferredPrompt = null;
      promptEvent.prompt();
      try { await promptEvent.userChoice; } catch (e) { /* 무시 */ }
      renderInstallBar();
    } else {
      $('install-guide').hidden = false;
    }
  });

  $('install-dismiss').addEventListener('click', () => {
    installBarDismissed = true;
    renderInstallBar();
  });

  $('guide-close').addEventListener('click', () => { $('install-guide').hidden = true; });
  $('install-guide').addEventListener('click', (e) => {
    if (e.target === $('install-guide')) $('install-guide').hidden = true; // 바깥 영역 탭하면 닫기
  });

  /* ---------- 시작 ---------- */

  renderAll();
  renderInstallBar();
  if (!storageOk) $('storage-warning').hidden = false;

  // 브라우저가 저장소를 임의로 비우지 않도록 요청 (실패해도 무방)
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

  // 오프라인 지원 (http/https 에서만 동작)
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
})();
