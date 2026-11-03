const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const APP = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
const logicSrc = fs.readFileSync(path.join(APP, 'logic.js'), 'utf8');
const xlsxSrc = fs.readFileSync(path.join(APP, 'xlsx.js'), 'utf8');
const cryptoSrc = fs.readFileSync(path.join(APP, 'officecrypto.js'), 'utf8');
const appSrc = fs.readFileSync(path.join(APP, 'app.js'), 'utf8');

let passed = 0;
let failed = 0;
function check(label, cond, extra) {
  if (cond) { passed++; console.log('  ✓', label); }
  else { failed++; console.log('  ✗', label, extra !== undefined ? `(실제: ${JSON.stringify(extra)})` : ''); }
}

function boot(seedStorage, env) {
  const dom = new JSDOM(html.replace(/<script src[^>]*><\/script>/g, ''), {
    url: 'http://localhost/',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    beforeParse(win) {
      if (seedStorage) win.localStorage.setItem('wedding-gift-v1', seedStorage);
      win.HTMLElement.prototype.scrollIntoView = () => {};
      win.TextEncoder = TextEncoder; // jsdom에는 없지만 실제 브라우저에는 있다
      if (!(env && env.__noCrypto)) Object.defineProperty(win, 'crypto', { value: require('node:crypto').webcrypto, configurable: true });
      if (env) { env = { ...env }; delete env.__noCrypto; }
      for (const [k, v] of Object.entries(env || {})) {
        Object.defineProperty(win.navigator, k, { value: v, configurable: true });
      }
    },
  });
  dom.window.eval(logicSrc);
  dom.window.eval(xlsxSrc);
  dom.window.eval(cryptoSrc);
  dom.window.eval(appSrc);
  return dom;
}

const q = (w, sel) => w.document.querySelector(sel);
const qa = (w, sel) => [...w.document.querySelectorAll(sel)];
const text = (w, id) => w.document.getElementById(id).textContent;
const amt = (w, label) => qa(w, '.amt').find((b) => b.textContent === label);
const setName = (w, v) => { w.document.getElementById('name').value = v; };
const click = (w, id) => w.document.getElementById(id).click();
const chooseSide = (w, side) => q(w, `[data-setup=${side}]`).click();
const stored = (w) => JSON.parse(w.localStorage.getItem('wedding-gift-v1'));
const isHidden = (w, id) => w.document.getElementById(id).hidden === true;
// 화면에 노출되는 영역(합계/입력/내역)의 텍스트 — 측 선택 오버레이는 제외
const visibleText = (w) => ['.summary', '#form-card', '#list-card'].map((s) => q(w, s).textContent).join(' ');
const exportModeNow = (w) => w.document.querySelector('input[name="export-mode"]:checked').value;
const entry = (id, side, name, amount, meals) => ({ id, side, name, amount, meals, createdAt: new Date().toISOString() });

(async () => {
  console.log('[1] 첫 실행: 측 선택');
  let dom = boot();
  let w = dom.window;
  check('측 선택 화면이 열려 있다', !isHidden(w, 'side-setup'));
  check('측 미선택 상태 표시', text(w, 'side-label') === '선택 필요');
  check('금액 버튼 4개 (1만/3만/5만/10만)', qa(w, '.amt').map((b) => b.textContent).join(',') === '1만,3만,5만,10만');
  chooseSide(w, 'groom');
  check('신랑측 선택 → 선택 화면 닫힘', isHidden(w, 'side-setup'));
  check('상단에 "신랑측 접수대" 표시', text(w, 'side-label') === '신랑측 접수대', text(w, 'side-label'));
  check('측 정보가 저장소에 기록됨', stored(w).side === 'groom');
  check('측 전환 버튼(.seg-btn)이 없다', qa(w, '.seg-btn').length === 0);
  check('화면 어디에도 "신부측"·"전체 합계" 문구가 없다', !/신부측|전체 합계/.test(visibleText(w)), visibleText(w));
  check('식권 기본값 0장', text(w, 'meal-view') === '0장');
  check('초기 합계 0명/0원/0장', text(w, 'sum-count') === '0명' && text(w, 'sum-amount') === '0원' && text(w, 'sum-meals') === '0장');

  console.log('[2] 홍길동: 10만 + 5만 = 15만, 식권 2장');
  setName(w, '홍길동');
  amt(w, '10만').click();
  amt(w, '5만').click();
  check('금액 합산 150,000원', text(w, 'amount-view') === '150,000원', text(w, 'amount-view'));
  check('수식 표시 "10만 + 5만"', text(w, 'amount-formula') === '10만 + 5만');
  click(w, 'meal-plus'); click(w, 'meal-plus');
  click(w, 'submit');
  check('합계 1명/150,000원/2장', text(w, 'sum-count') === '1명' && text(w, 'sum-amount') === '150,000원' && text(w, 'sum-meals') === '2장',
    [text(w, 'sum-count'), text(w, 'sum-amount'), text(w, 'sum-meals')]);
  check('목록 1건, 폼 초기화', qa(w, '.item').length === 1 && w.document.getElementById('name').value === '' && text(w, 'amount-view') === '0원' && text(w, 'meal-view') === '0장');
  check('저장된 항목의 측이 신랑측', stored(w).entries.every((e) => e.side === 'groom'));

  console.log('[3] 이철수: 3만, 식권 0장');
  setName(w, '이철수');
  amt(w, '3만').click();
  click(w, 'submit');
  check('합계 2명/180,000원/2장', text(w, 'sum-count') === '2명' && text(w, 'sum-amount') === '180,000원' && text(w, 'sum-meals') === '2장');
  check('최신순 정렬 (이철수가 맨 위)', q(w, '.item .nm strong').textContent === '이철수');

  console.log('[4] 입력 검증');
  click(w, 'submit');
  check('이름 없이 등록 → 오류 메시지', text(w, 'form-msg').includes('이름'), text(w, 'form-msg'));
  setName(w, '테스트');
  click(w, 'submit');
  check('금액 없이 등록 → 오류 메시지', text(w, 'form-msg').includes('금액'), text(w, 'form-msg'));
  check('검증 실패 시 목록 변화 없음', text(w, 'sum-count') === '2명');

  console.log('[5] 마지막 취소 / 금액 초기화');
  amt(w, '1만').click(); amt(w, '3만').click();
  check('1만+3만 = 40,000원', text(w, 'amount-view') === '40,000원');
  click(w, 'undo');
  check('마지막 취소 → 10,000원', text(w, 'amount-view') === '10,000원');
  click(w, 'clear');
  check('금액 초기화 → 0원, 취소 버튼 비활성', text(w, 'amount-view') === '0원' && w.document.getElementById('undo').disabled === true);
  setName(w, '');

  console.log('[6] 수정');
  qa(w, '.item').find((li) => li.textContent.includes('홍길동')).querySelector('[data-action=edit]').click();
  check('수정 모드: 이름/금액/버튼 문구', w.document.getElementById('name').value === '홍길동' && text(w, 'amount-view') === '150,000원' && text(w, 'submit') === '수정 저장');
  click(w, 'clear');
  amt(w, '10만').click();
  click(w, 'meal-minus');
  click(w, 'submit');
  check('수정 반영: 총 130,000원/식권 1장', text(w, 'sum-amount') === '130,000원' && text(w, 'sum-meals') === '1장', [text(w, 'sum-amount'), text(w, 'sum-meals')]);
  check('수정 후 2건 유지, 일반 모드 복귀', text(w, 'sum-count') === '2명' && text(w, 'submit') === '등록');

  console.log('[7] 삭제 → 되돌리기');
  const before = qa(w, '.item .nm strong').map((n) => n.textContent).join(',');
  qa(w, '.item').find((li) => li.textContent.includes('이철수')).querySelector('[data-action=delete]').click();
  check('삭제 후 1명', text(w, 'sum-count') === '1명');
  const undoBtn = q(w, '.toast-btn');
  check('토스트에 되돌리기 버튼', !!undoBtn && undoBtn.textContent === '되돌리기');
  undoBtn.click();
  check('되돌리기 → 2명 복구, 순서 동일', text(w, 'sum-count') === '2명' && qa(w, '.item .nm strong').map((n) => n.textContent).join(',') === before);

  console.log('[8] 이름 검색');
  const search = w.document.getElementById('search');
  search.value = '이';
  search.dispatchEvent(new w.Event('input', { bubbles: true }));
  check('이름 검색 "이" → 1건', qa(w, '.item').length === 1);
  search.value = '없는사람';
  search.dispatchEvent(new w.Event('input', { bubbles: true }));
  check('검색 결과 없음 안내', text(w, 'empty') === '조건에 맞는 내역이 없습니다.' && !isHidden(w, 'empty') === true);
  search.value = '';
  search.dispatchEvent(new w.Event('input', { bubbles: true }));
  check('측별 필터 칩이 없다', qa(w, '.chip:not([data-relation])').length === 0);

  console.log('[9] XSS 방어 (이름에 HTML 입력)');
  setName(w, '<img src=x onerror=alert(1)>');
  amt(w, '1만').click();
  click(w, 'submit');
  check('이름이 텍스트로만 표시', qa(w, '.item img').length === 0 && qa(w, '.item .nm strong').some((n) => n.textContent === '<img src=x onerror=alert(1)>'));

  console.log('[10] 새로고침 후 데이터·측 복원');
  const saved = w.localStorage.getItem('wedding-gift-v1');
  const w2 = boot(saved).window;
  check('재실행 후 합계 동일 (3명)', text(w2, 'sum-count') === '3명' && text(w2, 'sum-amount') === text(w, 'sum-amount'));
  check('측 선택 화면이 다시 뜨지 않고 신랑측 유지', isHidden(w2, 'side-setup') && text(w2, 'side-label') === '신랑측 접수대');

  console.log('[11] 손상된 저장 데이터에서도 앱이 열린다');
  const w3 = boot('{깨진json').window;
  check('깨진 데이터 → 빈 상태 + 측 선택 화면', text(w3, 'sum-count') === '0명' && !isHidden(w3, 'side-setup'));

  console.log('[12] 예전 형식(측 없음, 양쪽 연습 데이터) 불러오기');
  const legacy = JSON.stringify({
    version: 1,
    lastSide: 'groom',
    entries: [entry('l1', 'groom', '홍길동', 100000, 1), entry('l2', 'groom', '이철수', 50000, 0), entry('l3', 'bride', '김영희', 30000, 1)],
  });
  const w4 = boot(legacy).window;
  check('측 선택 전에는 어떤 내역도 합계·목록에 보이지 않는다', !isHidden(w4, 'side-setup') && text(w4, 'sum-count') === '0명' && qa(w4, '.item').length === 0);
  let confirmMsg = '';
  w4.confirm = (m) => { confirmMsg = m; return false; };
  chooseSide(w4, 'groom');
  check('확인창에서 취소 → 측 선택 화면 유지, 데이터 보존', !isHidden(w4, 'side-setup') && stored(w4).entries.length === 3 && confirmMsg.includes('1건'), confirmMsg);
  w4.confirm = () => true;
  chooseSide(w4, 'groom');
  check('확인 → 신랑측만 남고 2명/150,000원', isHidden(w4, 'side-setup') && text(w4, 'sum-count') === '2명' && text(w4, 'sum-amount') === '150,000원', [text(w4, 'sum-count'), text(w4, 'sum-amount')]);
  check('상대측 항목은 저장소에서도 제거됨', stored(w4).entries.length === 2 && stored(w4).entries.every((e) => e.side === 'groom'));

  console.log('[13] 내보내기: 이 기기의 측 데이터만 (엑셀 / CSV)');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let blobBytes = null;
  let blobText = null;
  let downloadName = null;
  w.URL.createObjectURL = (blob) => {
    const fr1 = new w.FileReader();
    fr1.onload = () => { blobBytes = new Uint8Array(fr1.result); };
    fr1.readAsArrayBuffer(blob);
    const fr2 = new w.FileReader();
    fr2.onload = () => { blobText = fr2.result; };
    fr2.readAsText(blob);
    return 'blob:test';
  };
  w.URL.revokeObjectURL = () => {};
  const origCreate = w.document.createElement.bind(w.document);
  w.document.createElement = (tag) => {
    const n = origCreate(tag);
    if (tag === 'a') n.click = () => { downloadName = n.getAttribute('download'); };
    return n;
  };
  const submitExport = () => q(w, '#export-form').dispatchEvent(new w.Event('submit', { cancelable: true, bubbles: true }));
  const setMode = (v) => { const r = q(w, `input[name="export-mode"][value="${v}"]`); r.checked = true; r.dispatchEvent(new w.Event('change', { bubbles: true })); };
  const setPw = (a, b) => { w.document.getElementById('export-pw').value = a; w.document.getElementById('export-pw2').value = b; };

  click(w, 'export');
  check('엑셀 버튼 → 내보내기 대화상자가 열림 (아직 파일 없음)', !isHidden(w, 'export-dialog') === true && downloadName === null);
  check('대화상자에 측·건수 안내 (신랑측 3건)', text(w, 'export-scope').includes('신랑측') && text(w, 'export-scope').includes('3건'), text(w, 'export-scope'));
  check('기본 선택은 "비밀번호 없이", 비밀번호 입력칸은 숨김', exportModeNow(w) === 'plain' && isHidden(w, 'export-pw-box'));
  check('"비밀번호 걸기" 선택 시 입력칸 표시, 버튼 문구 변경', (setMode('password'), !isHidden(w, 'export-pw-box') && text(w, 'export-go') === '암호화하여 만들기'));
  setMode('plain');
  check('"비밀번호 없이" 로 되돌리면 입력칸 숨김, 버튼 "내보내기"', isHidden(w, 'export-pw-box') && text(w, 'export-go') === '내보내기');
  click(w, 'export-cancel');
  check('취소 → 닫힘, 파일 없음', isHidden(w, 'export-dialog') && downloadName === null);

  click(w, 'export');
  submitExport();
  await sleep(150);
  check('엑셀(비밀번호 없이): 대화상자 닫히고 파일명 축의금_신랑측_YYYYMMDD.xlsx', isHidden(w, 'export-dialog') && /^축의금_신랑측_\d{8}\.xlsx$/.test(downloadName || ''), downloadName);
  check('엑셀: 올바른 .xlsx(ZIP, "PK" 시그니처) 파일이 만들어짐', !!blobBytes && blobBytes[0] === 0x50 && blobBytes[1] === 0x4b && blobBytes.length > 500, blobBytes && blobBytes.length);
  check('엑셀 버튼을 눌러도 CSV 텍스트가 아닌 바이너리', !!blobText && !blobText.includes('번호,구분,이름'));
  blobBytes = null; blobText = null; downloadName = null;

  console.log('[13-2] 엑셀 비밀번호 걸기');
  click(w, 'export');
  setMode('password');
  setPw('abc', 'abc');
  submitExport();
  check('4자 미만 → 오류 안내, 파일 없음', text(w, 'export-msg').includes('4자 이상') && downloadName === null && !isHidden(w, 'export-dialog'), text(w, 'export-msg'));
  setPw('pass1234', 'pass12345');
  submitExport();
  check('확인 입력이 다르면 → 오류 안내', text(w, 'export-msg').includes('일치하지 않습니다') && downloadName === null, text(w, 'export-msg'));
  q(w, '#export-show').checked = true; q(w, '#export-show').dispatchEvent(new w.Event('change', { bubbles: true }));
  check('"비밀번호 보기" → 입력칸이 text로 전환', q(w, '#export-pw').type === 'text' && q(w, '#export-pw2').type === 'text');
  q(w, '#export-show').checked = false; q(w, '#export-show').dispatchEvent(new w.Event('change', { bubbles: true }));
  check('보기 해제 → 다시 password', q(w, '#export-pw').type === 'password');
  setPw('pass1234', 'pass1234');
  submitExport();
  check('암호화 시작 → 진행 중 표시, 버튼 잠김', text(w, 'export-msg').includes('암호화 중') && w.document.getElementById('export-go').disabled === true && w.document.getElementById('export-cancel').disabled === true, text(w, 'export-msg'));
  click(w, 'export-cancel');
  check('암호화 중에는 취소로 닫히지 않는다', !isHidden(w, 'export-dialog'));
  for (let i = 0; i < 100 && text(w, 'export-go') !== '저장·공유하기'; i++) await sleep(100);
  check('암호화 완료 → 버튼이 "저장·공유하기"로 바뀌고, 아직 자동 저장되지 않는다', text(w, 'export-go') === '저장·공유하기' && downloadName === null && text(w, 'export-msg').includes('끝났습니다'), [text(w, 'export-go'), text(w, 'export-msg')]);
  check('완료 후 입력칸은 잠김(비밀번호 변경 불가)', w.document.getElementById('export-pw').disabled === true);
  submitExport();
  await sleep(200);
  check('저장·공유하기 → 대화상자 닫히고 .xlsx 파일 전달', isHidden(w, 'export-dialog') && /^축의금_신랑측_\d{8}\.xlsx$/.test(downloadName || ''), downloadName);
  check('전달된 파일은 암호화 컨테이너(CFB 시그니처 D0CF11E0), ZIP("PK")이 아니다', !!blobBytes && blobBytes[0] === 0xd0 && blobBytes[1] === 0xcf && blobBytes[2] === 0x11 && blobBytes[3] === 0xe0, blobBytes && [...blobBytes.slice(0, 4)]);
  check('파일 안에 이름·측 문구가 평문으로 남지 않는다', !!blobText && !/홍길동|신랑측|이철수/.test(blobText));
  check('닫힌 뒤 비밀번호 입력값이 비워진다', w.document.getElementById('export-pw').value === '' && w.document.getElementById('export-pw2').value === '');
  blobBytes = null; blobText = null; downloadName = null;
  click(w, 'export');
  check('다시 열면 초기 상태(비밀번호 없이, 입력칸 숨김, 활성)', exportModeNow(w) === 'plain' && isHidden(w, 'export-pw-box') && w.document.getElementById('export-pw').disabled === false && text(w, 'export-go') === '내보내기');
  w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  check('Esc 키로 닫힘', isHidden(w, 'export-dialog'));
  w.document.getElementById('export-dialog').hidden = true;

  console.log('[13-3] WebCrypto 없는 환경 (http 등)');
  const wNc = boot(stored(w) && JSON.stringify(stored(w)), { __noCrypto: true }).window;
  click(wNc, 'export');
  check('비밀번호 옵션 비활성 + 안내 문구, 일반 내보내기는 가능', wNc.document.getElementById('export-mode-pw').disabled === true && !isHidden(wNc, 'export-nocrypto'));
  click(wNc, 'export-cancel');
  console.log('[13-4] CSV');
  click(w, 'export-csv');
  await sleep(150);
  check('CSV: 파일명 축의금_신랑측_YYYYMMDD.csv', /^축의금_신랑측_\d{8}\.csv$/.test(downloadName || ''), downloadName);
  check('CSV: 신랑측 합계 포함, 신부측/전체 합계 없음', !!blobText && blobText.includes('신랑측 합계,3명') && !/신부측|전체 합계/.test(blobText), blobText && blobText.slice(0, 120));

  console.log('[13-5] 금액 직접 입력');
  click(w, 'clear');
  const typeCustom = (v) => { const i = w.document.getElementById('custom-input'); i.value = v; i.dispatchEvent(new w.Event('input', { bubbles: true })); };
  check('4개 버튼 아래 "직접 입력" 버튼이 있고 입력칸은 숨김', !isHidden(w, 'custom-open') === true && isHidden(w, 'custom-row') && text(w, 'custom-open') === '직접 입력');
  click(w, 'custom-open');
  check('직접 입력 → 입력칸 표시, 버튼 숨김', !isHidden(w, 'custom-row') && isHidden(w, 'custom-open'));
  typeCustom('25,000');
  check('입력 중 미리보기 "= 25,000원"', !isHidden(w, 'custom-preview') && text(w, 'custom-preview') === '= 25,000원', text(w, 'custom-preview'));
  click(w, 'custom-add');
  check('25,000원이 더해지고 입력칸이 닫힘', text(w, 'amount-view') === '25,000원' && isHidden(w, 'custom-row') && !isHidden(w, 'custom-open'), text(w, 'amount-view'));
  amt(w, '10만').click();
  check('버튼과 혼합 누적: 25,000 + 10만 = 125,000원', text(w, 'amount-view') === '125,000원' && text(w, 'amount-formula').includes('25,000원 + 10만'), text(w, 'amount-formula'));
  click(w, 'undo');
  click(w, 'undo');
  check('마지막 취소로 직접 입력 값도 되돌아감', text(w, 'amount-view') === '0원');
  click(w, 'custom-open');
  typeCustom('abc');
  click(w, 'custom-add');
  check('숫자가 아니면 오류 안내, 금액 변화 없음', text(w, 'form-msg').includes('숫자') && text(w, 'amount-view') === '0원', text(w, 'form-msg'));
  typeCustom('200000000');
  click(w, 'custom-add');
  check('상한(1억) 초과 거부', text(w, 'form-msg').includes('이하') && text(w, 'amount-view') === '0원', text(w, 'form-msg'));
  typeCustom('70000');
  w.document.getElementById('custom-input').dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  check('Enter 키로도 더해짐 (70,000원)', text(w, 'amount-view') === '70,000원', text(w, 'amount-view'));
  setName(w, '직접입력님');
  click(w, 'submit');
  check('등록되면 70,000원으로 저장', stored(w).entries.some((e) => e.name === '직접입력님' && e.amount === 70000));
  click(w, 'custom-open');
  click(w, 'custom-cancel');
  check('닫기 → 입력칸 숨김, 버튼 복귀', isHidden(w, 'custom-row') && !isHidden(w, 'custom-open'));

  console.log('[13-6] 식권 대인/소인');
  click(w, 'clear');
  check('소인 식권 기본값 0장, 대인·소인 스테퍼가 따로 있다', text(w, 'kid-view') === '0장' && text(w, 'meal-view') === '0장' && w.document.getElementById('kid-minus').disabled === true);
  setName(w, '가족단위');
  amt(w, '10만').click();
  click(w, 'meal-plus'); click(w, 'meal-plus');
  click(w, 'kid-plus');
  check('대인 2 · 소인 1 입력 반영', text(w, 'meal-view') === '2장' && text(w, 'kid-view') === '1장');
  const beforeTotal = text(w, 'sum-meals');
  console.log('[13-7] 관계 선택');
  const chips = qa(w, '#relation-chips .chip');
  check('관계 칩 4개, 처음엔 모두 미선택', chips.length === 4 && chips.every((c) => c.getAttribute('aria-pressed') === 'false') && chips.map((c) => c.textContent).join('|') === '가족/친척|친구/지인|직장|기타', chips.map((c) => c.textContent));
  chips[0].click();
  check('칩 선택 → aria-pressed=true (하나만)', chips[0].getAttribute('aria-pressed') === 'true' && chips.slice(1).every((c) => c.getAttribute('aria-pressed') === 'false'));
  chips[2].click();
  check('다른 칩을 누르면 선택이 옮겨간다', chips[0].getAttribute('aria-pressed') === 'false' && chips[2].getAttribute('aria-pressed') === 'true');
  chips[2].click();
  check('같은 칩 다시 누르면 선택 해제', chips.every((c) => c.getAttribute('aria-pressed') === 'false'));
  chips[0].click();
  click(w, 'submit');
  const kidEntry = stored(w).entries.find((e) => e.name === '가족단위');
  check('저장: meals=2(대인), kidMeals=1(소인)', kidEntry && kidEntry.meals === 2 && kidEntry.kidMeals === 1, kidEntry);
  check('저장된 관계는 family, 등록 후 칩 선택 초기화', kidEntry && kidEntry.relation === 'family' && qa(w, '#relation-chips .chip').every((c) => c.getAttribute('aria-pressed') === 'false'), kidEntry);
  check('목록에 관계 태그 "가족/친척" 표시', qa(w, '.item').some((li) => li.textContent.includes('가족단위') && li.querySelector('.tag') && li.querySelector('.tag').textContent === '가족/친척'));
  check('관계를 고르지 않은 항목에는 태그가 없다', qa(w, '.item').some((li) => !li.querySelector('.tag')));
  check('등록 후 폼의 대인/소인이 0장으로 초기화', text(w, 'meal-view') === '0장' && text(w, 'kid-view') === '0장');
  check('목록에 "식권 대인 2 · 소인 1" 표시', qa(w, '.item').some((li) => li.textContent.includes('가족단위') && li.textContent.includes('식권 대인 2 · 소인 1')));
  const allEntries = stored(w).entries;
  const adultSum = allEntries.reduce((a, e) => a + e.meals, 0);
  const kidSum = allEntries.reduce((a, e) => a + (e.kidMeals || 0), 0);
  check('상단 식권 합계는 대인+소인, 보조 문구에 대인·소인 각각', text(w, 'sum-meals') === `${adultSum + kidSum}장` && text(w, 'sum-meals-detail') === `대인 ${adultSum} · 소인 ${kidSum}`, [text(w, 'sum-meals'), text(w, 'sum-meals-detail')]);
  const editBtn = qa(w, '.item').find((li) => li.textContent.includes('가족단위')).querySelector('[data-action=edit]');
  editBtn.click();
  check('수정 시 대인 2 · 소인 1이 채워진다', text(w, 'meal-view') === '2장' && text(w, 'kid-view') === '1장');
  check('수정 시 관계 칩(가족/친척)도 채워진다', qa(w, '#relation-chips .chip')[0].getAttribute('aria-pressed') === 'true');
  qa(w, '#relation-chips .chip')[3].click();
  click(w, 'kid-plus');
  click(w, 'submit');
  check('소인 수정 저장 (1→2)', stored(w).entries.find((e) => e.name === '가족단위').kidMeals === 2);
  check('관계 수정 저장 (가족/친척→기타)', stored(w).entries.find((e) => e.name === '가족단위').relation === 'other');
  for (let i = 0; i < 100; i++) click(w, 'kid-plus');
  check('소인 상한에서 + 버튼 잠김', w.document.getElementById('kid-plus').disabled === true && text(w, 'kid-view') === `${w.GiftLogic.MAX_MEALS}장`);
  click(w, 'clear');
  w.document.getElementById('cancel-edit').click();
  click(w, 'export-csv');
  await sleep(150);
  check('CSV에 대인/소인/합계 열이 있다', !!blobText && blobText.includes('식권 대인(장),식권 소인(장),식권 합계(장)') && blobText.includes('가족단위'), blobText && blobText.split('\r\n')[0]);
  check('CSV에 관계 열과 라벨(기타)이 있다', blobText.split('\r\n')[0].startsWith('번호,구분,이름,관계,') && blobText.includes('가족단위,기타,'), blobText.split('\r\n')[1]);
  blobBytes = null; blobText = null; downloadName = null;

  console.log('[14] 측 변경 규칙 / 전체 삭제');
  click(w, 'change-side');
  check('접수 내역이 있으면 측 변경 불가 (안내 문구)', isHidden(w, 'side-setup') && text(w, 'side-label') === '신랑측 접수대' && text(w, 'toast').includes('전체 삭제'), text(w, 'toast'));
  w.prompt = () => '취소';
  click(w, 'reset-all');
  check('다른 문구 입력 시 삭제되지 않음', text(w, 'sum-count') === '5명', text(w, 'sum-count'));
  w.prompt = () => '삭제';
  click(w, 'reset-all');
  check('"삭제" 입력 시 전체 삭제, 측은 유지', text(w, 'sum-count') === '0명' && qa(w, '.item').length === 0 && stored(w).side === 'groom' && stored(w).entries.length === 0);
  click(w, 'change-side');
  check('내역이 비면 측 변경 → 선택 화면 다시 열림', !isHidden(w, 'side-setup') && stored(w).side === null);
  chooseSide(w, 'bride');
  check('신부측 선택 → "신부측 접수대" 표시', text(w, 'side-label') === '신부측 접수대' && w.document.body.dataset.side === 'bride');
  setName(w, '박지민');
  amt(w, '3만').click();
  click(w, 'submit');
  check('신부측으로 등록 → 저장 항목 측이 bride', stored(w).entries.length === 1 && stored(w).entries[0].side === 'bride');
  check('신랑측 문구가 화면에 없다', !/신랑측|전체 합계/.test(visibleText(w)), visibleText(w));

  console.log('[15] 앱 설치 안내');
  const wait = () => new Promise((r) => setTimeout(r, 20));
  const bar = (win) => win.document.getElementById('install-bar');
  const IPAD_UA = 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1';

  const wPlain = boot().window;
  check('일반 브라우저(설치 수단 없음)에서는 안내 바 숨김', bar(wPlain).hidden === true);

  const wChrome = boot().window;
  let prompted = false;
  const ev = new wChrome.Event('beforeinstallprompt', { cancelable: true });
  ev.prompt = () => { prompted = true; };
  ev.userChoice = Promise.resolve({ outcome: 'accepted' });
  wChrome.dispatchEvent(ev);
  check('크롬: 설치 프롬프트가 오면 "앱 설치" 버튼 표시', bar(wChrome).hidden === false && text(wChrome, 'install-btn') === '앱 설치');
  click(wChrome, 'install-btn');
  await wait();
  check('크롬: 버튼 누르면 브라우저 설치 창 호출, 안내 바 닫힘', prompted === true && bar(wChrome).hidden === true);

  const wIpad = boot(null, { userAgent: IPAD_UA }).window;
  check('아이패드: "설치 방법 보기" 버튼 표시', bar(wIpad).hidden === false && text(wIpad, 'install-btn') === '설치 방법 보기');
  click(wIpad, 'install-btn');
  check('아이패드: 버튼 → 홈 화면에 추가 가이드 표시', !isHidden(wIpad, 'install-guide') && text(wIpad, 'guide-title').includes('홈 화면에 추가'));
  click(wIpad, 'guide-close');
  check('아이패드: 확인 → 가이드 닫힘', isHidden(wIpad, 'install-guide'));
  click(wIpad, 'install-dismiss');
  check('아이패드: 닫기 → 안내 바 숨김', bar(wIpad).hidden === true);

  const wIpadOS = boot(null, { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15', platform: 'MacIntel', maxTouchPoints: 5 }).window;
  check('iPadOS(맥으로 보고되는 UA)도 안내 표시', bar(wIpadOS).hidden === false);
  const wMac = boot(null, { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', platform: 'MacIntel', maxTouchPoints: 0 }).window;
  check('맥 데스크톱 Safari는 안내 없음', bar(wMac).hidden === true);
  const wInstalled = boot(null, { userAgent: IPAD_UA, standalone: true }).window;
  check('이미 홈 화면 앱으로 실행 중이면 안내 숨김', bar(wInstalled).hidden === true);

  console.log(`\n결과: ${passed} 통과 / ${failed} 실패`);
  process.exit(failed ? 1 : 0);
})();
