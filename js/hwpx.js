// 한글(hwpx) 파일의 표 읽기: hwpx 는 zip 안의 XML 이라 SheetJS 의 압축 풀기(CFB)를 빌려 쓴다
import { loadXLSX } from './xlsx.js';

const HP = 'http://www.hancom.co.kr/hwpml/2011/paragraph';

// 셀 안 글자: 셀 안의 다른 표와 메모(hp:ctrl 안의 글)는 빼고, 문단마다 줄을 바꾼다
function cellText(tc) {
  const lines = [];
  for (const p of tc.getElementsByTagNameNS(HP, 'p')) {
    if (outside(p, tc)) continue;
    let s = '';
    for (const t of p.getElementsByTagNameNS(HP, 't')) if (!outside(t, p)) s += t.textContent;
    if (s.trim()) lines.push(s);
  }
  return lines.join('\n');
}
// el 에서 위로 올라가며 stop 전에 다른 표 · 셀 · 컨트롤(메모 등)을 만나면 바깥 것
function outside(el, stop) {
  for (let n = el.parentNode; n && n !== stop; n = n.parentNode) {
    if (n.namespaceURI === HP && ['tbl', 'tc', 'ctrl'].includes(n.localName)) return true;
  }
  return false;
}

// 표 하나 → { rows: 글자 격자(합친 칸은 같은 글자로 채움), origin: 칸이 시작하는 자리인지 }
function readTable(tbl) {
  const nr = Number(tbl.getAttribute('rowCnt'));
  const nc = Number(tbl.getAttribute('colCnt'));
  const rows = Array.from({ length: nr }, () => Array(nc).fill(''));
  const origin = Array.from({ length: nr }, () => Array(nc).fill(false));
  for (const tr of tbl.children) {
    if (tr.localName !== 'tr') continue;
    for (const tc of tr.children) {
      if (tc.localName !== 'tc') continue;
      const addr = tc.getElementsByTagNameNS(HP, 'cellAddr')[0];
      const span = tc.getElementsByTagNameNS(HP, 'cellSpan')[0];
      const r0 = Number(addr.getAttribute('rowAddr'));
      const c0 = Number(addr.getAttribute('colAddr'));
      const rs = Number(span?.getAttribute('rowSpan') || 1);
      const cs = Number(span?.getAttribute('colSpan') || 1);
      const text = cellText(tc);
      for (let r = r0; r < Math.min(nr, r0 + rs); r++) for (let c = c0; c < Math.min(nc, c0 + cs); c++) rows[r][c] = text;
      if (r0 < nr && c0 < nc) origin[r0][c0] = true;
    }
  }
  return { rows, origin };
}

export async function readHwpxTables(file) {
  const X = await loadXLSX();
  const zip = X.CFB.read(new Uint8Array(await file.arrayBuffer()), { type: 'array' });
  const sections = zip.FullPaths
    .map((path, i) => ({ path, i }))
    .filter(({ path }) => /Contents\/section\d+\.xml$/i.test(path))
    .sort((a, b) => Number(a.path.match(/section(\d+)/i)[1]) - Number(b.path.match(/section(\d+)/i)[1]));
  if (!sections.length) throw new Error('한글(hwpx) 파일이 아니거나 내용을 찾지 못했습니다. 한글에서 "다른 이름으로 저장 → hwpx"로 저장해 주세요.');
  const tables = [];
  for (const { i } of sections) {
    const xml = new TextDecoder('utf-8').decode(zip.FileIndex[i].content);
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    for (const tbl of doc.getElementsByTagNameNS(HP, 'tbl')) tables.push(readTable(tbl));
  }
  return tables;
}
