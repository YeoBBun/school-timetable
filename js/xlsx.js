// 엑셀 읽기 · 쓰기 (SheetJS 를 필요할 때만 불러온다)
const SRC = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
let loading = null;

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

// 첫 번째 시트를 [[칸, 칸, ...], ...] 로 (합친 칸 · 빈 줄 포함, 글자는 앞뒤 공백 제거)
export async function readRows(file) {
  const X = await load();
  const wb = X.read(await file.arrayBuffer(), { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return X.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' })
    .map((r) => r.map((v) => String(v ?? '').replace(/\s+/g, ' ').trim()));
}

export async function downloadXlsx(filename, rows, sheetName = 'Sheet1') {
  const X = await load();
  const wb = X.utils.book_new();
  X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(rows), sheetName);
  const blob = new Blob([X.write(wb, { type: 'array', bookType: 'xlsx' })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
}
