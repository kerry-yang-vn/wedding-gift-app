const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const APP = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
const logicSrc = fs.readFileSync(path.join(APP, 'logic.js'), 'utf8');
const appSrc = fs.readFileSync(path.join(APP, 'app.js'), 'utf8');

let passed = 0;
let failed = 0;
function check(label, cond, extra) {
  if (cond) { passed++; console.log('  ✓', label); }
  else { failed++; console.log('  ✗', label, extra !== undefined ? `(실제: ${JSON.stringify(extra)})` : ''); }
}

function boot(seedStorage) {
  const dom = new JSDOM(html.replace(/<script src[^>]*><\/script>/g, ''), {
    url: 'http://localhost/',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    beforeParse(win) {
      if (seedStorage) win.localStorage.setItem('wedding-gift-v1', seedStorage);
      win.HTMLElement.prototype.scrollIntoView = () => {};
    },
  });
  dom.window.eval(logicSrc);
  dom.window.eval(appSrc);
  return dom;
}

const q = (w, sel) => w.document.querySelector(sel);
const qa = (w, sel) => [...w.document.querySelectorAll(sel)];
const text = (w, id) => w.document.getElementById(id).textContent;
const amt = (w, label) => qa(w, '.amt').find((b) => b.textContent === label);
const setName = (w, v) => { w.document.getElementById('name').value = v; };
const click = (w, id) => w.document.getElementById(id).click();

(async () => {
  console.log('[1] 초기 화면');
  let dom = boot();
  let w = dom.window;
  check('금액 버튼 4개 (1만/3만/5만/10만)', qa(w, '.amt').map((b) => b.textContent).join(',') === '1만,3만,5만,10만');
  check('초기 합계 0명/0원/0장', text(w, 'sum-count') === '0명' && text(w, 'sum-amount') === '0원' && text(w, 'sum-meals') === '0장');
  check('식권 기본값 0장', text(w, 'meal-view') === '0장');
  check('기본 선택은 신랑측', q(w, '.seg-btn.groom').getAttribute('aria-pressed') === 'true');
  check('빈 목록 안내 문구', text(w, 'empty') === '아직 접수된 내역이 없습니다.');

  console.log('[2] 신랑측 홍길동: 10만 + 5만 = 15만, 식권 2장');
  setName(w, '홍길동');
  amt(w, '10만').click();
  amt(w, '5만').click();
  check('금액 합산 150,000원', text(w, 'amount-view') === '150,000원', text(w, 'amount-view'));
  check('수식 표시 "10만 + 5만"', text(w, 'amount-formula') === '10만 + 5만', text(w, 'amount-formula'));
  click(w, 'meal-plus'); click(w, 'meal-plus');
  check('식권 2장', text(w, 'meal-view') === '2장');
  click(w, 'submit');
  check('합계 1명/150,000원/2장', text(w, 'sum-count') === '1명' && text(w, 'sum-amount') === '150,000원' && text(w, 'sum-meals') === '2장',
    [text(w, 'sum-count'), text(w, 'sum-amount'), text(w, 'sum-meals')]);
  check('신랑측 집계', text(w, 'groom-amount') === '150,000원' && text(w, 'groom-detail') === '1명 · 식권 2장', text(w, 'groom-detail'));
  check('목록 1건', qa(w, '.item').length === 1);
  check('등록 후 폼 초기화 (이름/금액/식권)', w.document.getElementById('name').value === '' && text(w, 'amount-view') === '0원' && text(w, 'meal-view') === '0장');
  check('등록 후 선택한 측(신랑측) 유지', q(w, '.seg-btn.groom').getAttribute('aria-pressed') === 'true');

  console.log('[3] 신부측 김영희: 5만, 식권 0장');
  q(w, '.seg-btn.bride').click();
  setName(w, '김영희');
  amt(w, '5만').click();
  click(w, 'submit');
  check('합계 2명/200,000원/2장', text(w, 'sum-count') === '2명' && text(w, 'sum-amount') === '200,000원' && text(w, 'sum-meals') === '2장');
  check('신부측 집계', text(w, 'bride-amount') === '50,000원' && text(w, 'bride-detail') === '1명 · 식권 0장', text(w, 'bride-detail'));
  check('최신순 정렬 (김영희가 맨 위)', q(w, '.item .nm strong').textContent === '김영희');

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
  check('마지막 취소 → 10,000원', text(w, 'amount-view') === '10,000원', text(w, 'amount-view'));
  click(w, 'clear');
  check('금액 초기화 → 0원', text(w, 'amount-view') === '0원');
  check('초기화 후 취소 버튼 비활성', w.document.getElementById('undo').disabled === true);
  setName(w, '');

  console.log('[6] 수정');
  const hongItem = qa(w, '.item').find((li) => li.textContent.includes('홍길동'));
  hongItem.querySelector('[data-action=edit]').click();
  check('수정 모드: 이름/금액/버튼 문구', w.document.getElementById('name').value === '홍길동' && text(w, 'amount-view') === '150,000원' && text(w, 'submit') === '수정 저장',
    [w.document.getElementById('name').value, text(w, 'amount-view'), text(w, 'submit')]);
  click(w, 'clear');
  amt(w, '10만').click();
  click(w, 'meal-minus');
  click(w, 'submit');
  check('수정 반영: 총 150,000원/식권 1장', text(w, 'sum-amount') === '150,000원' && text(w, 'sum-meals') === '1장', [text(w, 'sum-amount'), text(w, 'sum-meals')]);
  check('수정 후에도 2건 유지, 일반 모드 복귀', text(w, 'sum-count') === '2명' && text(w, 'submit') === '등록');

  console.log('[7] 삭제 → 되돌리기');
  const before = qa(w, '.item .nm strong').map((n) => n.textContent).join(',');
  qa(w, '.item').find((li) => li.textContent.includes('김영희')).querySelector('[data-action=delete]').click();
  check('삭제 후 1명', text(w, 'sum-count') === '1명');
  const undoBtn = q(w, '.toast-btn');
  check('토스트에 되돌리기 버튼', !!undoBtn && undoBtn.textContent === '되돌리기');
  undoBtn.click();
  check('되돌리기 → 2명 복구, 순서 동일', text(w, 'sum-count') === '2명' && qa(w, '.item .nm strong').map((n) => n.textContent).join(',') === before);

  console.log('[8] 검색 / 필터');
  const search = w.document.getElementById('search');
  search.value = '김';
  search.dispatchEvent(new w.Event('input', { bubbles: true }));
  check('이름 검색 "김" → 1건', qa(w, '.item').length === 1);
  search.value = '없는사람';
  search.dispatchEvent(new w.Event('input', { bubbles: true }));
  check('검색 결과 없음 안내', text(w, 'empty') === '조건에 맞는 내역이 없습니다.' && w.document.getElementById('empty').hidden === false);
  search.value = '';
  search.dispatchEvent(new w.Event('input', { bubbles: true }));
  qa(w, '.chip').find((c) => c.dataset.filter === 'groom').click();
  check('신랑측 필터 → 1건', qa(w, '.item').length === 1 && qa(w, '.item .pill')[0].textContent === '신랑측');
  qa(w, '.chip').find((c) => c.dataset.filter === 'all').click();
  check('전체 필터 → 2건', qa(w, '.item').length === 2);

  console.log('[9] XSS 방어 (이름에 HTML 입력)');
  setName(w, '<img src=x onerror=alert(1)>');
  amt(w, '1만').click();
  click(w, 'submit');
  check('이름이 텍스트로만 표시 (img 태그 생성 없음)', qa(w, '.item img').length === 0 && qa(w, '.item .nm strong').some((n) => n.textContent === '<img src=x onerror=alert(1)>'));

  console.log('[10] 새로고침 후 데이터 복원');
  const saved = w.localStorage.getItem('wedding-gift-v1');
  check('localStorage에 저장됨', !!saved && JSON.parse(saved).entries.length === 3);
  const dom2 = boot(saved);
  const w2 = dom2.window;
  check('재실행 후 합계 동일 (3명)', text(w2, 'sum-count') === '3명' && text(w2, 'sum-amount') === text(w, 'sum-amount'), [text(w2, 'sum-count'), text(w2, 'sum-amount')]);
  check('마지막 선택 측 복원', q(w2, '.seg-btn.groom').getAttribute('aria-pressed') === 'true');

  console.log('[11] 손상된 저장 데이터에서도 앱이 열린다');
  const w3 = boot('{깨진json').window;
  check('깨진 데이터 → 빈 상태로 시작', text(w3, 'sum-count') === '0명');

  console.log('[12] CSV 내보내기 (다운로드 폴백)');
  let blobText = null;
  let downloadName = null;
  w.URL.createObjectURL = (blob) => {
    const fr = new w.FileReader();
    fr.onload = () => { blobText = fr.result; };
    fr.readAsText(blob);
    return 'blob:test';
  };
  w.URL.revokeObjectURL = () => {};
  const origCreate = w.document.createElement.bind(w.document);
  w.document.createElement = (tag) => {
    const n = origCreate(tag);
    if (tag === 'a') n.click = () => { downloadName = n.getAttribute('download'); };
    return n;
  };
  click(w, 'export');
  await new Promise((r) => setTimeout(r, 100));
  check('파일명 축의금_YYYYMMDD.csv', /^축의금_\d{8}\.csv$/.test(downloadName || ''), downloadName);
  check('CSV 내용: 헤더 + 합계 포함', !!blobText && blobText.includes('번호,구분,이름') && blobText.includes('전체 합계,3명'), blobText && blobText.slice(0, 80));

  console.log('[13] 전체 삭제 (확인 문구 입력)');
  w.prompt = () => '취소';
  click(w, 'reset-all');
  check('다른 문구 입력 시 삭제되지 않음', text(w, 'sum-count') === '3명');
  w.prompt = () => '삭제';
  click(w, 'reset-all');
  check('"삭제" 입력 시 전체 삭제', text(w, 'sum-count') === '0명' && qa(w, '.item').length === 0);
  check('삭제 내용이 저장소에도 반영', JSON.parse(w.localStorage.getItem('wedding-gift-v1')).entries.length === 0);

  console.log(`\n결과: ${passed} 통과 / ${failed} 실패`);
  process.exit(failed ? 1 : 0);
})();
