// 엑셀 읽기 · 쓰기 (SheetJS 를 필요할 때만 불러온다)
const SRC = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
let loading = null;

// 다른 모듈(hwpx 읽기)도 SheetJS 의 압축 풀기를 빌려 쓴다
export const loadXLSX = () => load();

function load() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  loading ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = SRC;
    s.onload = () => resolve(window.XLSX);
    s.onerror = () => { loading = null; reject(new Error('엑셀 도구를 불러오지 못했습니다. 인터넷 연결을 확인하세요.')); };
    document.head.append(s);
  });
  return loading;
}

// 원본 양식을 그대로 고쳐 쓸 때: 워크북 열기 · 내려받기
export async function openWorkbook(file) {
  const X = await load();
  return { X, wb: X.read(await file.arrayBuffer(), { type: 'array', cellNF: true }) };
}

// 워크북 → xlsx Blob. patchSheet(시트 순서, xml) 를 주면 저장 전에 시트 XML 을 고친다
// (SheetJS 무료판이 못 쓰는 목록 고르기 · 틀 고정용). 이때 엑셀이 열 때 수식을 다시 계산하게 한다.
export function workbookBlob(X, wb, patchSheet) {
  let data = X.write(wb, { type: 'array', bookType: 'xlsx' });
  if (patchSheet) {
    const zip = X.CFB.read(new Uint8Array(data), { type: 'array' });
    const edit = (path, fn) => {
      const e = zip.FileIndex[zip.FullPaths.findIndex((p) => p.endsWith(`/${path}`))];
      if (!e) return;
      e.content = new TextEncoder().encode(fn(new TextDecoder().decode(e.content)));
      e.size = e.content.length;
    };
    wb.SheetNames.forEach((_, i) => edit(`xl/worksheets/sheet${i + 1}.xml`, (xml) => patchSheet(i, xml)));
    edit('xl/workbook.xml', (xml) => (xml.includes('<calcPr') ? xml.replace(/<calcPr\b/, '<calcPr fullCalcOnLoad="1"') : xml.replace('</workbook>', '<calcPr fullCalcOnLoad="1"/></workbook>')));
    data = X.CFB.write(zip, { fileType: 'zip', type: 'array' });
  }
  return new Blob([data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

export function downloadBlob(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
}

export function saveWorkbook(X, wb, filename, patchSheet) {
  downloadBlob(workbookBlob(X, wb, patchSheet), filename);
}

// 첫 번째 시트를 [[칸, 칸, ...], ...] 로 (합친 칸 · 빈 줄 포함, 글자는 앞뒤 공백 제거)
export async function readRows(file) {
  const X = await load();
  const wb = X.read(await file.arrayBuffer(), { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return X.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '', blankrows: true })
    .map((r) => r.map((v) => String(v ?? '').replace(/\s+/g, ' ').trim()));
}

export async function downloadXlsx(filename, rows, sheetName = 'Sheet1') {
  const X = await load();
  const wb = X.utils.book_new();
  X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(rows), sheetName);
  downloadBlob(workbookBlob(X, wb), filename);
}
