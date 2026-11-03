const test = require('node:test');
const assert = require('node:assert/strict');
const nodeCrypto = require('node:crypto');
const C = require('../officecrypto.js');
const L = require('../logic.js');
const X = require('../xlsx.js');

const FAST = { spinCount: 1000 }; // 테스트 속도용 (운영 기본값은 100,000)

/* ---------- 표준 문서(MS-OFFCRYPTO)를 그대로 따르는 독립 검증용 복호화기 ---------- */

// 최소 CFB 읽기: 헤더 → FAT → 디렉터리 → (미니)스트림
function readCfb(buf) {
  assert.equal(buf.subarray(0, 8).toString('hex'), 'd0cf11e0a1b11ae1');
  const secSize = 1 << buf.readUInt16LE(30);
  const miniSize = 1 << buf.readUInt16LE(32);
  const cutoff = buf.readUInt32LE(56);
  const sec = (n) => buf.subarray(secSize * (n + 1), secSize * (n + 2));
  const fatSecs = [];
  for (let i = 0; i < buf.readUInt32LE(44); i++) fatSecs.push(buf.readUInt32LE(76 + 4 * i));
  const fat = [];
  for (const s of fatSecs) for (let i = 0; i < secSize; i += 4) fat.push(sec(s).readUInt32LE(i));
  const chain = (start) => {
    const out = [];
    for (let s = start, guard = 0; s < 0xfffffffa; s = fat[s], guard++) {
      assert.ok(guard < 100000, 'FAT 순환');
      out.push(s);
    }
    return out;
  };
  const readChain = (start) => Buffer.concat(chain(start).map(sec));
  const dirBuf = readChain(buf.readUInt32LE(48));
  const entries = [];
  for (let o = 0; o + 128 <= dirBuf.length; o += 128) {
    const nameLen = dirBuf.readUInt16LE(o + 64);
    entries.push({
      name: dirBuf.subarray(o, o + Math.max(0, nameLen - 2)).toString('utf16le'),
      type: dirBuf[o + 66], color: dirBuf[o + 67],
      left: dirBuf.readUInt32LE(o + 68), right: dirBuf.readUInt32LE(o + 72), child: dirBuf.readUInt32LE(o + 76),
      start: dirBuf.readUInt32LE(o + 116), size: dirBuf.readUInt32LE(o + 120),
    });
  }
  const root = entries[0];
  const miniStream = readChain(root.start).subarray(0, root.size);
  const miniFat = [];
  const mfBuf = readChain(buf.readUInt32LE(60));
  for (let i = 0; i < mfBuf.length; i += 4) miniFat.push(mfBuf.readUInt32LE(i));
  const readStream = (e) => {
    if (e.size < cutoff) {
      const parts = [];
      for (let s = e.start; s < 0xfffffffa; s = miniFat[s]) parts.push(miniStream.subarray(s * miniSize, (s + 1) * miniSize));
      return Buffer.concat(parts).subarray(0, e.size);
    }
    return readChain(e.start).subarray(0, e.size);
  };
  // 트리를 순회하며 경로 → 항목 맵 구성
  const byPath = {};
  const walk = (idx, prefix) => {
    if (idx === 0xffffffff) return;
    const e = entries[idx];
    walk(e.left, prefix);
    byPath[prefix + e.name] = e;
    if (e.type === 1) walk(e.child, prefix + e.name + '/');
    walk(e.right, prefix);
  };
  walk(root.child, '');
  return { entries, byPath, readStream };
}

const BLOCK = {
  verifierInput: Buffer.from('fea7d2763b4b9e79', 'hex'),
  verifierValue: Buffer.from('d7aa0f6d3061344e', 'hex'),
  keyValue: Buffer.from('146e0be7abacd0d6', 'hex'),
  hmacKey: Buffer.from('5fb2ad010cb9e1f6', 'hex'),
  hmacValue: Buffer.from('a0677f02b22c8433', 'hex'),
};
const sha = (...parts) => nodeCrypto.createHash('sha512').update(Buffer.concat(parts)).digest();
const attr = (xml, name, from = 0) => new RegExp(name + '="([^"]*)"').exec(xml.slice(from))[1];

function aesDec(key, iv, data) {
  const d = nodeCrypto.createDecipheriv('aes-256-cbc', key, iv);
  d.setAutoPadding(false);
  return Buffer.concat([d.update(data), d.final()]);
}

function referenceDecrypt(file, password) {
  const cfb = readCfb(Buffer.from(file));
  const info = cfb.readStream(cfb.byPath['EncryptionInfo']);
  assert.equal(info.subarray(0, 8).toString('hex'), '0400040040000000');
  const xml = info.subarray(8).toString('utf8');
  const pkgStream = cfb.readStream(cfb.byPath['EncryptedPackage']);

  const keyDataSalt = Buffer.from(attr(xml, 'saltValue'), 'base64');
  const encAt = xml.indexOf('<p:encryptedKey');
  const spin = Number(attr(xml, 'spinCount', encAt));
  const pwSalt = Buffer.from(attr(xml, 'saltValue', encAt), 'base64');
  let h = sha(pwSalt, Buffer.from(password, 'utf16le'));
  for (let i = 0; i < spin; i++) { const n = Buffer.alloc(4); n.writeUInt32LE(i); h = sha(n, h); }
  const k = (block) => sha(h, block).subarray(0, 32);

  const verInput = aesDec(k(BLOCK.verifierInput), pwSalt, Buffer.from(attr(xml, 'encryptedVerifierHashInput', encAt), 'base64'));
  const verHash = aesDec(k(BLOCK.verifierValue), pwSalt, Buffer.from(attr(xml, 'encryptedVerifierHashValue', encAt), 'base64'));
  if (!sha(verInput).equals(verHash)) throw new Error('WRONG_PASSWORD');
  const secret = aesDec(k(BLOCK.keyValue), pwSalt, Buffer.from(attr(xml, 'encryptedKeyValue', encAt), 'base64'));

  // 무결성: HMAC 검증
  const ivOf = (b) => sha(keyDataSalt, b).subarray(0, 16);
  const hmacKey = aesDec(secret, ivOf(BLOCK.hmacKey), Buffer.from(attr(xml, 'encryptedHmacKey'), 'base64'));
  const hmacVal = aesDec(secret, ivOf(BLOCK.hmacValue), Buffer.from(attr(xml, 'encryptedHmacValue'), 'base64'));
  const calc = nodeCrypto.createHmac('sha512', hmacKey.subarray(0, 64)).update(pkgStream).digest();
  if (!calc.equals(hmacVal.subarray(0, 64))) throw new Error('INTEGRITY');

  const size = Number(pkgStream.readBigUInt64LE(0));
  const body = pkgStream.subarray(8);
  const out = [];
  for (let i = 0, idx = 0; i < body.length; i += 4096, idx++) {
    const n = Buffer.alloc(4); n.writeUInt32LE(idx);
    out.push(aesDec(secret, sha(keyDataSalt, n).subarray(0, 16), body.subarray(i, i + 4096)));
  }
  return Buffer.concat(out).subarray(0, size);
}

const sampleXlsx = () => {
  const T0 = new Date(2026, 10, 4, 13, 5, 9).toISOString();
  const entries = [
    { id: 'a', side: 'groom', name: '홍길동', amount: 150000, meals: 2, createdAt: T0 },
    { id: 'c', side: 'groom', name: '이철수', amount: 30000, meals: 0, createdAt: T0 },
  ];
  return X.build(L.toSheetModel(entries, 'groom'), { now: new Date(2026, 10, 4, 14, 0, 0) });
};

/* ---------- 테스트 ---------- */

test('sha512: Node 내장 구현과 모든 경계 길이에서 일치', () => {
  for (const n of [0, 1, 3, 55, 56, 63, 64, 111, 112, 113, 127, 128, 129, 255, 256, 1000, 5000]) {
    const m = nodeCrypto.randomBytes(n);
    assert.equal(Buffer.from(C.sha512(m)).toString('hex'), nodeCrypto.createHash('sha512').update(m).digest('hex'), `길이 ${n}`);
  }
  assert.equal(
    Buffer.from(C.sha512(Buffer.from('abc'))).toString('hex'),
    'ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f',
  );
});

test('비밀번호 검증: 길이 제한', () => {
  assert.equal(C.validatePassword('abc').ok, false);
  assert.equal(C.validatePassword('abcd').ok, true);
  assert.equal(C.validatePassword('가'.repeat(256)).ok, false);
  assert.equal(C.validatePassword(undefined).ok, false);
});

test('암호화 결과는 CFB 컨테이너이며 표준 스트림 구성을 갖는다', async () => {
  const enc = await C.encryptXlsx(sampleXlsx(), 'pass1234', FAST);
  assert.equal(Buffer.from(enc.subarray(0, 8)).toString('hex'), 'd0cf11e0a1b11ae1');
  assert.equal(enc.length % 512, 0);
  const cfb = readCfb(Buffer.from(enc));
  assert.deepEqual(Object.keys(cfb.byPath).sort(), [
    'EncryptedPackage', 'EncryptionInfo',
    '\u0006DataSpaces', '\u0006DataSpaces/DataSpaceInfo', '\u0006DataSpaces/DataSpaceInfo/StrongEncryptionDataSpace',
    '\u0006DataSpaces/DataSpaceMap', '\u0006DataSpaces/TransformInfo', '\u0006DataSpaces/TransformInfo/StrongEncryptionTransform',
    '\u0006DataSpaces/TransformInfo/StrongEncryptionTransform/\u0006Primary', '\u0006DataSpaces/Version',
  ].sort());
  // 작은 스트림은 미니 스트림, 평문 .xlsx의 ZIP 시그니처는 파일 어디에도 노출되지 않는다
  assert.equal(Buffer.from(enc).includes(Buffer.from('PK\u0003\u0004')), false);
  assert.equal(Buffer.from(enc).includes(Buffer.from('홍길동', 'utf8')), false);
});

test('표준 알고리즘대로 복호화하면 원본 .xlsx와 바이트 단위로 같다 (무결성 HMAC 포함)', async () => {
  const xl = sampleXlsx();
  const enc = await C.encryptXlsx(xl, 'pass1234', FAST);
  assert.ok(Buffer.from(xl).equals(referenceDecrypt(enc, 'pass1234')));
});

test('한글·특수문자·이모지 비밀번호도 동일하게 동작 (UTF-16)', async () => {
  const xl = sampleXlsx();
  for (const pw of ['축의금!2026', 'p@ss w0rd', '🔒lock1']) {
    const enc = await C.encryptXlsx(xl, pw, FAST);
    assert.ok(Buffer.from(xl).equals(referenceDecrypt(enc, pw)), pw);
  }
});

test('한글 비밀번호는 NFC로 정규화되어 조합형/분해형 입력 모두 같은 키가 된다', async () => {
  const xl = sampleXlsx();
  const composed = '비밀번호1234';
  const decomposed = composed.normalize('NFD');
  assert.notEqual(composed, decomposed);
  const enc = await C.encryptXlsx(xl, decomposed, FAST);
  assert.ok(Buffer.from(xl).equals(referenceDecrypt(enc, composed)));
});

test('틀린 비밀번호는 거부된다', async () => {
  const enc = await C.encryptXlsx(sampleXlsx(), 'pass1234', FAST);
  assert.throws(() => referenceDecrypt(enc, 'pass12345'), /WRONG_PASSWORD/);
  assert.throws(() => referenceDecrypt(enc, ''), /WRONG_PASSWORD/);
});

test('파일 일부를 변조하면 무결성 검사에서 걸린다', async () => {
  const enc = Buffer.from(await C.encryptXlsx(sampleXlsx(), 'pass1234', FAST));
  const cfb = readCfb(enc);
  const e = cfb.byPath['EncryptedPackage'];
  const tampered = Buffer.from(enc);
  // 큰/작은 스트림 모두 처리하기 위해 암호문 첫 바이트(원본 크기 뒤)를 직접 찾아 뒤집는다
  const pkg = cfb.readStream(e);
  const at = tampered.indexOf(pkg.subarray(8, 40));
  assert.ok(at > 0);
  tampered[at] ^= 0xff;
  assert.throws(() => referenceDecrypt(tampered, 'pass1234'), /INTEGRITY/);
});

test('매번 다른 솔트·키를 쓴다 (같은 입력도 결과가 다름)', async () => {
  const xl = sampleXlsx();
  const a = await C.encryptXlsx(xl, 'pass1234', FAST);
  const b = await C.encryptXlsx(xl, 'pass1234', FAST);
  assert.notDeepEqual(Buffer.from(a), Buffer.from(b));
});

test('큰 파일(여러 4096 세그먼트, 일반 스트림 영역)도 복호화 가능', async () => {
  const big = nodeCrypto.randomBytes(300 * 1024 + 7);
  const enc = await C.encryptXlsx(big, 'pass1234', FAST);
  assert.ok(big.equals(referenceDecrypt(enc, 'pass1234')));
});

test('경계 크기(4096 배수 ±1, 매우 작은 입력)', async () => {
  for (const n of [1, 15, 16, 17, 4095, 4096, 4097, 8192]) {
    const data = nodeCrypto.randomBytes(n);
    const enc = await C.encryptXlsx(data, 'pass1234', FAST);
    assert.ok(data.equals(referenceDecrypt(enc, 'pass1234')), `크기 ${n}`);
  }
});

test('디렉터리 트리: 레드-블랙 규칙(루트 검정, 빨강 노드의 자식은 검정) 및 모든 항목 도달 가능', async () => {
  const enc = await C.encryptXlsx(sampleXlsx(), 'pass1234', FAST);
  const { entries, byPath } = readCfb(Buffer.from(enc));
  assert.equal(entries[0].color, 1);
  const used = entries.filter((e) => e.type !== 0);
  assert.equal(used.length, Object.keys(byPath).length + 1); // + Root Entry
  const check = (idx) => {
    if (idx === 0xffffffff) return 1;
    const e = entries[idx];
    for (const c of [e.left, e.right]) if (e.color === 0 && c !== 0xffffffff) assert.equal(entries[c].color, 1, '빨강 아래 빨강');
    const l = check(e.left), r = check(e.right);
    assert.equal(l, r, '검정 높이 불일치');
    return l + (e.color === 1 ? 1 : 0);
  };
  const walkStorage = (childIdx) => { check(childIdx); };
  walkStorage(entries[0].child);
  for (const e of entries) if (e.type === 1 && e.child !== 0xffffffff) walkStorage(e.child);
});

test('실제 반복 횟수(100,000)로도 표준 복호화가 가능하고 진행률이 단조 증가한다', async () => {
  const xl = sampleXlsx();
  const seen = [];
  const enc = await C.encryptXlsx(xl, 'pass1234', { onProgress: (p) => seen.push(p) });
  assert.ok(Buffer.from(xl).equals(referenceDecrypt(enc, 'pass1234')));
  assert.equal(seen[seen.length - 1], 1);
  assert.ok(seen.every((v, i) => i === 0 || v >= seen[i - 1]));
  assert.ok(seen.length >= 10);
});

test('WebCrypto가 없으면 알기 쉬운 오류를 낸다', async () => {
  await assert.rejects(C.encryptXlsx(sampleXlsx(), 'pass1234', { crypto: {} }), /암호화 기능/);
});

test('짧은 비밀번호는 암호화 전에 거부된다', async () => {
  await assert.rejects(C.encryptXlsx(sampleXlsx(), 'abc'), /4자 이상/);
});
