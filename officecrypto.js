/* 의존성 없는 Office 문서 암호화 (브라우저/Node 공용)
   .xlsx 바이트를 "열기 암호"가 걸린 파일로 감싼다.
   방식: MS-OFFCRYPTO "Agile Encryption" (Excel 2010+ 기본 방식)
     - 키 파생: SHA-512 × 100,000회 반복 (동기 SHA-512 직접 구현: 비동기 호출 10만 번의 지연 방지)
     - 본문 암호화: AES-256-CBC, 4096바이트 단위, 무결성: HMAC-SHA512
     - 컨테이너: CFB(Compound File Binary) — 암호화된 Office 파일의 표준 포장 형식
   AES·HMAC·난수는 브라우저/Node 내장 WebCrypto를 사용한다 (https 또는 설치된 앱에서 동작). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.GiftCrypto = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SPIN_COUNT = 100000;
  const SEGMENT = 4096; // 본문 암호화 단위
  const SECTOR = 512;
  const MINI_SECTOR = 64;
  const MINI_CUTOFF = 4096;
  const MAX_FAT_SECTORS = 109; // 헤더 DIFAT만 사용 → 약 7MB까지
  const FREESECT = 0xffffffff;
  const ENDOFCHAIN = 0xfffffffe;
  const FATSECT = 0xfffffffd;
  const NOSTREAM = 0xffffffff;

  // MS-OFFCRYPTO 2.3.4.13 / 2.3.4.14 에 정의된 고정 블록 키
  const BLOCK = {
    verifierInput: Uint8Array.from([0xfe, 0xa7, 0xd2, 0x76, 0x3b, 0x4b, 0x9e, 0x79]),
    verifierValue: Uint8Array.from([0xd7, 0xaa, 0x0f, 0x6d, 0x30, 0x61, 0x34, 0x4e]),
    keyValue: Uint8Array.from([0x14, 0x6e, 0x0b, 0xe7, 0xab, 0xac, 0xd0, 0xd6]),
    hmacKey: Uint8Array.from([0x5f, 0xb2, 0xad, 0x01, 0x0c, 0xb9, 0xe1, 0xf6]),
    hmacValue: Uint8Array.from([0xa0, 0x67, 0x7f, 0x02, 0xb2, 0x2c, 0x84, 0x33]),
  };

  /* ---------- 바이트 도우미 ---------- */

  function concat(...parts) {
    let n = 0;
    for (const p of parts) n += p.length;
    const out = new Uint8Array(n);
    let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  }

  const u32le = (n) => Uint8Array.of(n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255);

  function toBase64(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return typeof btoa === 'function' ? btoa(s) : Buffer.from(bytes).toString('base64');
  }

  function utf16le(str) {
    const out = new Uint8Array(str.length * 2);
    for (let i = 0; i < str.length; i++) {
      const c = str.charCodeAt(i);
      out[2 * i] = c & 255;
      out[2 * i + 1] = c >>> 8;
    }
    return out;
  }

  /* ---------- SHA-512 (동기) ----------
     64비트 값을 상위/하위 32비트 쌍으로 계산한다.
     초기값·상수는 표준 정의(소수의 제곱근/세제곱근 소수부 앞 64비트)를 BigInt로 계산해 오타 위험을 없앴고,
     테스트에서 Node 내장 SHA-512와 대조한다. */

  let KH = null, KL = null, IH = null, IL = null;

  function initConstants() {
    if (KH) return;
    const primes = [];
    for (let n = 2; primes.length < 80; n++) {
      if (primes.every((p) => n % p !== 0)) primes.push(n);
    }
    const iroot = (x, k) => { // 정수 k제곱근 (뉴턴법)
      let r = 1n << BigInt(Math.ceil(x.toString(2).length / k) + 1);
      for (;;) {
        const next = ((BigInt(k) - 1n) * r + x / r ** (BigInt(k) - 1n)) / BigInt(k);
        if (next >= r) return r;
        r = next;
      }
    };
    const MASK = (1n << 64n) - 1n;
    KH = new Uint32Array(80); KL = new Uint32Array(80);
    IH = new Uint32Array(8); IL = new Uint32Array(8);
    primes.forEach((p, i) => {
      const v = iroot(BigInt(p) << 192n, 3) & MASK;
      KH[i] = Number(v >> 32n); KL[i] = Number(v & 0xffffffffn);
    });
    primes.slice(0, 8).forEach((p, i) => {
      const v = iroot(BigInt(p) << 128n, 2) & MASK;
      IH[i] = Number(v >> 32n); IL[i] = Number(v & 0xffffffffn);
    });
  }

  const WH = new Uint32Array(80);
  const WL = new Uint32Array(80);

  function sha512(msg) {
    initConstants();
    const len = msg.length;
    const total = ((len + 17 + 127) >> 7) << 7;
    const buf = new Uint8Array(total);
    buf.set(msg);
    buf[len] = 0x80;
    const dv = new DataView(buf.buffer);
    dv.setUint32(total - 8, Math.floor(len / 0x20000000));
    dv.setUint32(total - 4, (len << 3) >>> 0);

    const Hh = Uint32Array.from(IH), Hl = Uint32Array.from(IL);

    for (let off = 0; off < total; off += 128) {
      for (let t = 0; t < 16; t++) {
        WH[t] = dv.getUint32(off + 8 * t);
        WL[t] = dv.getUint32(off + 8 * t + 4);
      }
      for (let t = 16; t < 80; t++) {
        const h15 = WH[t - 15], l15 = WL[t - 15];
        const s0h = ((h15 >>> 1) | (l15 << 31)) ^ ((h15 >>> 8) | (l15 << 24)) ^ (h15 >>> 7);
        const s0l = ((l15 >>> 1) | (h15 << 31)) ^ ((l15 >>> 8) | (h15 << 24)) ^ ((l15 >>> 7) | (h15 << 25));
        const h2 = WH[t - 2], l2 = WL[t - 2];
        const s1h = ((h2 >>> 19) | (l2 << 13)) ^ ((l2 >>> 29) | (h2 << 3)) ^ (h2 >>> 6);
        const s1l = ((l2 >>> 19) | (h2 << 13)) ^ ((h2 >>> 29) | (l2 << 3)) ^ ((l2 >>> 6) | (h2 << 26));
        const lo = (s1l >>> 0) + WL[t - 7] + (s0l >>> 0) + WL[t - 16];
        const hi = (s1h >>> 0) + WH[t - 7] + (s0h >>> 0) + WH[t - 16] + ((lo / 4294967296) >>> 0);
        WL[t] = lo >>> 0;
        WH[t] = hi >>> 0;
      }

      let ah = Hh[0], al = Hl[0], bh = Hh[1], bl = Hl[1], ch = Hh[2], cl = Hl[2], dh = Hh[3], dl = Hl[3];
      let eh = Hh[4], el = Hl[4], fh = Hh[5], fl = Hl[5], gh = Hh[6], gl = Hl[6], hh = Hh[7], hl = Hl[7];

      for (let t = 0; t < 80; t++) {
        const S1h = ((eh >>> 14) | (el << 18)) ^ ((eh >>> 18) | (el << 14)) ^ ((el >>> 9) | (eh << 23));
        const S1l = ((el >>> 14) | (eh << 18)) ^ ((el >>> 18) | (eh << 14)) ^ ((eh >>> 9) | (el << 23));
        const chh = (eh & fh) ^ (~eh & gh);
        const chl = (el & fl) ^ (~el & gl);
        const t1lSum = (hl >>> 0) + (S1l >>> 0) + (chl >>> 0) + KL[t] + WL[t];
        const t1h = ((hh >>> 0) + (S1h >>> 0) + (chh >>> 0) + KH[t] + WH[t] + ((t1lSum / 4294967296) >>> 0)) >>> 0;
        const t1l = t1lSum >>> 0;

        const S0h = ((ah >>> 28) | (al << 4)) ^ ((al >>> 2) | (ah << 30)) ^ ((al >>> 7) | (ah << 25));
        const S0l = ((al >>> 28) | (ah << 4)) ^ ((ah >>> 2) | (al << 30)) ^ ((ah >>> 7) | (al << 25));
        const mjh = (ah & bh) ^ (ah & ch) ^ (bh & ch);
        const mjl = (al & bl) ^ (al & cl) ^ (bl & cl);
        const t2lSum = (S0l >>> 0) + (mjl >>> 0);
        const t2h = ((S0h >>> 0) + (mjh >>> 0) + ((t2lSum / 4294967296) >>> 0)) >>> 0;
        const t2l = t2lSum >>> 0;

        hh = gh; hl = gl; gh = fh; gl = fl; fh = eh; fl = el;
        const elSum = (dl >>> 0) + t1l;
        eh = ((dh >>> 0) + t1h + ((elSum / 4294967296) >>> 0)) >>> 0;
        el = elSum >>> 0;
        dh = ch; dl = cl; ch = bh; cl = bl; bh = ah; bl = al;
        const alSum = t1l + t2l;
        ah = (t1h + t2h + ((alSum / 4294967296) >>> 0)) >>> 0;
        al = alSum >>> 0;
      }

      const addTo = (i, xh, xl) => {
        const l = (Hl[i] >>> 0) + (xl >>> 0);
        Hh[i] = ((Hh[i] >>> 0) + (xh >>> 0) + ((l / 4294967296) >>> 0)) >>> 0;
        Hl[i] = l >>> 0;
      };
      addTo(0, ah, al); addTo(1, bh, bl); addTo(2, ch, cl); addTo(3, dh, dl);
      addTo(4, eh, el); addTo(5, fh, fl); addTo(6, gh, gl); addTo(7, hh, hl);
    }

    const out = new Uint8Array(64);
    const odv = new DataView(out.buffer);
    for (let i = 0; i < 8; i++) { odv.setUint32(8 * i, Hh[i]); odv.setUint32(8 * i + 4, Hl[i]); }
    return out;
  }

  /* ---------- 키 파생 / AES ---------- */

  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

  // 비밀번호 → 반복 해시값 (화면이 멈추지 않도록 중간중간 양보)
  async function spinHash(salt, password, spinCount, onProgress) {
    let h = sha512(concat(salt, utf16le(password)));
    const buf = new Uint8Array(68);
    for (let i = 0; i < spinCount; i++) {
      buf[0] = i & 255; buf[1] = (i >>> 8) & 255; buf[2] = (i >>> 16) & 255; buf[3] = (i >>> 24) & 255;
      buf.set(h, 4);
      h = sha512(buf);
      if (i % 5000 === 4999) {
        if (onProgress) onProgress((i + 1) / spinCount);
        await tick();
      }
    }
    return h;
  }

  const blockKey = (spun, block) => sha512(concat(spun, block)).subarray(0, 32);

  // AES-256-CBC, 패딩 없음 (입력은 16바이트의 배수). WebCrypto는 항상 PKCS7 패딩을 붙이므로 마지막 블록을 잘라낸다.
  async function aesCbc(subtle, keyBytes, iv, data) {
    const key = await subtle.importKey('raw', keyBytes, { name: 'AES-CBC' }, false, ['encrypt']);
    const out = new Uint8Array(await subtle.encrypt({ name: 'AES-CBC', iv }, key, data));
    return out.subarray(0, data.length);
  }

  const padTo16 = (data) => {
    const n = Math.ceil(data.length / 16) * 16;
    if (n === data.length) return data;
    const out = new Uint8Array(n);
    out.set(data);
    return out;
  };

  /* ---------- Agile 암호화 ---------- */

  async function encryptAgile(plain, password, opts) {
    const o = opts || {};
    const cryptoApi = o.crypto || (typeof globalThis !== 'undefined' ? globalThis.crypto : null);
    if (!cryptoApi || !cryptoApi.subtle || !cryptoApi.getRandomValues) {
      throw new Error('이 환경에서는 암호화 기능을 쓸 수 없습니다.');
    }
    const subtle = cryptoApi.subtle;
    const random = (n) => cryptoApi.getRandomValues(new Uint8Array(n));
    const spinCount = o.spinCount || SPIN_COUNT;
    const onProgress = o.onProgress || null;

    const keyDataSalt = random(16);
    const passwordSalt = random(16);
    const secretKey = random(32);
    const verifierInput = random(16);
    const hmacSalt = random(64);

    // 1) 본문 암호화 (EncryptedPackage 스트림)
    const head = new Uint8Array(8);
    new DataView(head.buffer).setUint32(0, plain.length, true); // 원본 크기 (하위 32비트, 상위는 0)
    const segments = [head];
    const segKey = await subtle.importKey('raw', secretKey, { name: 'AES-CBC' }, false, ['encrypt']);
    for (let i = 0, idx = 0; i < plain.length; i += SEGMENT, idx++) {
      const chunk = padTo16(plain.subarray(i, i + SEGMENT));
      const iv = sha512(concat(keyDataSalt, u32le(idx))).subarray(0, 16);
      const enc = new Uint8Array(await subtle.encrypt({ name: 'AES-CBC', iv }, segKey, chunk));
      segments.push(enc.subarray(0, chunk.length));
    }
    const encryptedPackage = concat(...segments);

    // 2) 비밀번호로 비밀키 보호
    const spun = await spinHash(passwordSalt, password, spinCount, onProgress);
    const encVerifierInput = await aesCbc(subtle, blockKey(spun, BLOCK.verifierInput), passwordSalt, verifierInput);
    const encVerifierValue = await aesCbc(subtle, blockKey(spun, BLOCK.verifierValue), passwordSalt, sha512(verifierInput));
    const encKeyValue = await aesCbc(subtle, blockKey(spun, BLOCK.keyValue), passwordSalt, secretKey);

    // 3) 무결성 (HMAC-SHA512 over EncryptedPackage 전체)
    const hmacKey = await subtle.importKey('raw', hmacSalt, { name: 'HMAC', hash: 'SHA-512' }, false, ['sign']);
    const hmac = new Uint8Array(await subtle.sign('HMAC', hmacKey, encryptedPackage));
    const ivOf = (block) => sha512(concat(keyDataSalt, block)).subarray(0, 16);
    const encHmacKey = await aesCbc(subtle, secretKey, ivOf(BLOCK.hmacKey), hmacSalt);
    const encHmacValue = await aesCbc(subtle, secretKey, ivOf(BLOCK.hmacValue), hmac);

    if (onProgress) onProgress(1);

    const b64 = toBase64;
    const xml =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n' +
      '<encryption xmlns="http://schemas.microsoft.com/office/2006/encryption" ' +
      'xmlns:p="http://schemas.microsoft.com/office/2006/keyEncryptor/password" ' +
      'xmlns:c="http://schemas.microsoft.com/office/2006/keyEncryptor/certificate">' +
      '<keyData saltSize="16" blockSize="16" keyBits="256" hashSize="64" cipherAlgorithm="AES" ' +
      'cipherChaining="ChainingModeCBC" hashAlgorithm="SHA512" saltValue="' + b64(keyDataSalt) + '"/>' +
      '<dataIntegrity encryptedHmacKey="' + b64(encHmacKey) + '" encryptedHmacValue="' + b64(encHmacValue) + '"/>' +
      '<keyEncryptors><keyEncryptor uri="http://schemas.microsoft.com/office/2006/keyEncryptor/password">' +
      '<p:encryptedKey spinCount="' + spinCount + '" saltSize="16" blockSize="16" keyBits="256" hashSize="64" ' +
      'cipherAlgorithm="AES" cipherChaining="ChainingModeCBC" hashAlgorithm="SHA512" saltValue="' + b64(passwordSalt) + '" ' +
      'encryptedVerifierHashInput="' + b64(encVerifierInput) + '" ' +
      'encryptedVerifierHashValue="' + b64(encVerifierValue) + '" ' +
      'encryptedKeyValue="' + b64(encKeyValue) + '"/>' +
      '</keyEncryptor></keyEncryptors></encryption>';
    const xmlBytes = new TextEncoder().encode(xml);
    const encryptionInfo = concat(Uint8Array.of(4, 0, 4, 0, 0x40, 0, 0, 0), xmlBytes); // 버전 4.4, 플래그 0x40

    return buildCfb(dataSpaceStreams(encryptionInfo, encryptedPackage));
  }

  /* ---------- CFB (Compound File Binary) 작성기 ---------- */

  // 암호화된 Office 파일이 반드시 포함하는 DataSpaces 고정 스트림 (Excel이 만드는 값과 동일)
  const hexBytes = (h) => Uint8Array.from(h.match(/../g).map((x) => parseInt(x, 16)));
  const DS_VERSION = hexBytes('3c0000004d006900630072006f0073006f00660074002e0043006f006e007400610069006e00650072002e004400610074006100530070006100630065007300010000000100000001000000');
  const DS_MAP = hexBytes('08000000010000006800000001000000000000002000000045006e0063007200790070007400650064005000610063006b00610067006500320000005300740072006f006e00670045006e006300720079007000740069006f006e004400610074006100530070006100630065000000');
  const DS_INFO = hexBytes('0800000001000000320000005300740072006f006e00670045006e006300720079007000740069006f006e005400720061006e00730066006f0072006d000000');
  const DS_PRIMARY = hexBytes('58000000010000004c0000007b00460046003900410033004600300033002d0035003600450046002d0034003600310033002d0042004400440035002d003500410034003100430031004400300037003200340036007d004e0000004d006900630072006f0073006f00660074002e0043006f006e007400610069006e00650072002e0045006e006300720079007000740069006f006e005400720061006e00730066006f0072006d00000001000000010000000100000000000000000000000000000004000000');

  function dataSpaceStreams(encryptionInfo, encryptedPackage) {
    const stream = (name, data) => ({ name, type: 'stream', data });
    const storage = (name, children) => ({ name, type: 'storage', children });
    return storage('Root Entry', [
      storage('\u0006DataSpaces', [
        stream('Version', DS_VERSION),
        stream('DataSpaceMap', DS_MAP),
        storage('DataSpaceInfo', [stream('StrongEncryptionDataSpace', DS_INFO)]),
        storage('TransformInfo', [
          storage('StrongEncryptionTransform', [stream('\u0006Primary', DS_PRIMARY)]),
        ]),
      ]),
      stream('EncryptionInfo', encryptionInfo),
      stream('EncryptedPackage', encryptedPackage),
    ]);
  }

  // CFB 이름 비교: 짧은 이름이 먼저, 같은 길이면 대문자 기준 코드 단위 순서
  function compareNames(a, b) {
    if (a.length !== b.length) return a.length - b.length;
    const x = a.toUpperCase(), y = b.toUpperCase();
    for (let i = 0; i < x.length; i++) {
      if (x.charCodeAt(i) !== y.charCodeAt(i)) return x.charCodeAt(i) - y.charCodeAt(i);
    }
    return 0;
  }

  function buildCfb(rootNode) {
    // 1) 디렉터리 항목 평탄화 (형제는 균형 이진 트리 + 레드-블랙 색 규칙)
    const dir = [];
    function addNode(node, type) {
      const e = { name: node.name, type, data: node.data || null, left: NOSTREAM, right: NOSTREAM, child: NOSTREAM, color: 1, start: ENDOFCHAIN, size: 0 };
      dir.push(e);
      return dir.length - 1;
    }
    function layoutChildren(parentIdx, children) {
      if (!children || !children.length) return;
      const sorted = children.slice().sort((a, b) => compareNames(a.name, b.name));
      const ids = sorted.map((c) => addNode(c, c.type === 'stream' ? 2 : 1));
      const n = ids.length;
      const maxDepth = Math.floor(Math.log2(n));
      const perfect = n === Math.pow(2, maxDepth + 1) - 1;
      const build = (lo, hi, depth) => {
        if (lo > hi) return NOSTREAM;
        const mid = lo + Math.floor((hi - lo + 1 - 1) / 2);
        const id = ids[mid];
        dir[id].color = !perfect && depth === maxDepth ? 0 : 1;
        dir[id].left = build(lo, mid - 1, depth + 1);
        dir[id].right = build(mid + 1, hi, depth + 1);
        return id;
      };
      dir[parentIdx].child = build(0, n - 1, 0);
      sorted.forEach((c, i) => layoutChildren(ids[i], c.children));
    }
    const rootIdx = addNode(rootNode, 5);
    layoutChildren(rootIdx, rootNode.children);

    // 2) 스트림을 일반/미니 영역에 배치
    const miniParts = [];
    let miniCount = 0;
    const bigStreams = [];
    for (const e of dir) {
      if (e.type !== 2) continue;
      e.size = e.data.length;
      if (e.size < MINI_CUTOFF) {
        e.start = miniCount;
        const sectors = Math.ceil(e.size / MINI_SECTOR);
        const padded = new Uint8Array(sectors * MINI_SECTOR);
        padded.set(e.data);
        miniParts.push(padded);
        miniCount += sectors;
      } else {
        bigStreams.push(e);
      }
    }
    const miniStream = concat(...miniParts);
    const miniFat = new Uint32Array(Math.ceil(miniCount / 128) * 128 || 0).fill(FREESECT);
    for (const e of dir) {
      if (e.type !== 2 || e.size >= MINI_CUTOFF) continue;
      const sectors = Math.ceil(e.size / MINI_SECTOR);
      for (let i = 0; i < sectors; i++) miniFat[e.start + i] = i === sectors - 1 ? ENDOFCHAIN : e.start + i + 1;
    }

    const dirSectors = Math.ceil(dir.length / 4);
    const miniFatSectors = miniFat.length / 128;
    const miniStreamSectors = Math.ceil(miniStream.length / SECTOR);
    const bigSectors = bigStreams.map((e) => Math.ceil(e.size / SECTOR));
    const dataSectors = dirSectors + miniFatSectors + miniStreamSectors + bigSectors.reduce((a, b) => a + b, 0);

    let fatSectors = 1;
    while (fatSectors * 128 < dataSectors + fatSectors) fatSectors++;
    if (fatSectors > MAX_FAT_SECTORS) throw new Error('파일이 너무 커서 암호화할 수 없습니다.');
    const totalSectors = dataSectors + fatSectors;

    // 3) 섹터 번호 배정: [디렉터리][미니FAT][미니스트림][큰 스트림들][FAT]
    const fat = new Uint32Array(fatSectors * 128).fill(FREESECT);
    let next = 0;
    const chain = (count) => {
      const first = count ? next : ENDOFCHAIN;
      for (let i = 0; i < count; i++) { fat[next] = i === count - 1 ? ENDOFCHAIN : next + 1; next++; }
      return first;
    };
    const dirStart = chain(dirSectors);
    const miniFatStart = chain(miniFatSectors);
    const miniStreamStart = chain(miniStreamSectors);
    bigStreams.forEach((e, i) => { e.start = chain(bigSectors[i]); });
    const fatStart = next;
    for (let i = 0; i < fatSectors; i++) fat[next++] = FATSECT;

    dir[rootIdx].start = miniStreamSectors ? miniStreamStart : ENDOFCHAIN;
    dir[rootIdx].size = miniStream.length;

    // 4) 직렬화
    const file = new Uint8Array(SECTOR * (1 + totalSectors));
    const dv = new DataView(file.buffer);
    file.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1], 0);
    dv.setUint16(24, 0x003e, true); // 마이너 버전
    dv.setUint16(26, 0x0003, true); // 메이저 버전 3 (512바이트 섹터)
    dv.setUint16(28, 0xfffe, true); // 바이트 순서
    dv.setUint16(30, 9, true);      // 섹터 크기 2^9
    dv.setUint16(32, 6, true);      // 미니 섹터 크기 2^6
    dv.setUint32(44, fatSectors, true);
    dv.setUint32(48, dirStart, true);
    dv.setUint32(56, MINI_CUTOFF, true);
    dv.setUint32(60, miniFatSectors ? miniFatStart : ENDOFCHAIN, true);
    dv.setUint32(64, miniFatSectors, true);
    dv.setUint32(68, ENDOFCHAIN, true); // DIFAT 없음
    dv.setUint32(72, 0, true);
    for (let i = 0; i < 109; i++) dv.setUint32(76 + 4 * i, i < fatSectors ? fatStart + i : FREESECT, true);

    const sectorOffset = (n) => SECTOR * (n + 1);

    dir.forEach((e, i) => {
      const o = sectorOffset(dirStart) + 128 * i;
      for (let k = 0; k < e.name.length; k++) dv.setUint16(o + 2 * k, e.name.charCodeAt(k), true);
      dv.setUint16(o + 64, (e.name.length + 1) * 2, true);
      file[o + 66] = e.type;
      file[o + 67] = e.color;
      dv.setUint32(o + 68, e.left, true);
      dv.setUint32(o + 72, e.right, true);
      dv.setUint32(o + 76, e.child, true);
      dv.setUint32(o + 116, e.start, true);
      dv.setUint32(o + 120, e.size, true);
    });
    // 남는 디렉터리 슬롯은 "미사용" 항목
    for (let i = dir.length; i < dirSectors * 4; i++) {
      const o = sectorOffset(dirStart) + 128 * i;
      dv.setUint32(o + 68, NOSTREAM, true);
      dv.setUint32(o + 72, NOSTREAM, true);
      dv.setUint32(o + 76, NOSTREAM, true);
    }

    for (let i = 0; i < miniFat.length; i++) dv.setUint32(sectorOffset(miniFatStart) + 4 * i, miniFat[i], true);
    if (miniStreamSectors) file.set(miniStream, sectorOffset(miniStreamStart));
    for (const e of bigStreams) file.set(e.data, sectorOffset(e.start));
    for (let i = 0; i < fat.length; i++) dv.setUint32(sectorOffset(fatStart) + 4 * i, fat[i], true);

    return file;
  }

  /* ---------- 공개 API ---------- */

  const MIN_PASSWORD_LENGTH = 4;
  const MAX_PASSWORD_LENGTH = 255; // Excel 제한

  function validatePassword(pw) {
    if (typeof pw !== 'string' || pw.length < MIN_PASSWORD_LENGTH) {
      return { ok: false, error: '비밀번호는 ' + MIN_PASSWORD_LENGTH + '자 이상으로 입력해 주세요.' };
    }
    if (pw.length > MAX_PASSWORD_LENGTH) {
      return { ok: false, error: '비밀번호가 너무 깁니다. (최대 ' + MAX_PASSWORD_LENGTH + '자)' };
    }
    return { ok: true };
  }

  // password는 NFC로 정규화한다 (기기마다 한글 조합 방식이 달라도 같은 비밀번호로 인식되도록)
  function encryptXlsx(xlsxBytes, password, opts) {
    const v = validatePassword(password);
    if (!v.ok) return Promise.reject(new Error(v.error));
    return encryptAgile(xlsxBytes, password.normalize('NFC'), opts);
  }

  return {
    SPIN_COUNT, MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH,
    validatePassword, encryptXlsx, sha512, buildCfb, dataSpaceStreams,
  };
});
