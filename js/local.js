// 로컬 폴더 저장 (로그인 없이 이 PC에서만): 크롬 · 엣지(PC)의 '폴더 접근'(File System Access API)
// google.js 와 같은 이름의 함수를 둬서 store.js 가 그대로 쓴다. 파일 · 폴더 id 는 고른 폴더 기준 경로('수업관리/수업 자료/…')
// 폴더 이름 바꾸기 · 옮기기는 하지 않는다(경로가 id 라서 바꾸면 자료를 못 찾는다). 지운 자료는 '수업관리/휴지통'으로 옮긴다
import { AuthError } from './google.js';

export const isSupported = () => typeof window.showDirectoryPicker === 'function';

const DB_NAME = 'jindo-local';
let dir = null; // 사용자가 고른 폴더
let granted = false;

// ---- 고른 폴더를 IndexedDB 에 기억 (폴더 핸들은 localStorage 에 못 넣는다) ----
function idb(mode, fn) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB_NAME, 1);
    open.onupgradeneeded = () => open.result.createObjectStore('kv');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const tx = open.result.transaction('kv', mode);
      const req = fn(tx.objectStore('kv'));
      tx.oncomplete = () => { open.result.close(); resolve(req?.result); };
      tx.onerror = () => { open.result.close(); reject(tx.error); };
    };
  });
}
const loadHandle = () => idb('readonly', (s) => s.get('dir')).catch(() => null);
const saveHandle = (h) => idb('readwrite', (s) => s.put(h, 'dir'));
const dropHandle = () => idb('readwrite', (s) => s.delete('dir')).catch(() => {});

export async function init() {
  dir = await loadHandle();
  granted = !!dir && (await dir.queryPermission({ mode: 'readwrite' })) === 'granted';
}
export const hasToken = () => granted;
export const folderName = () => dir?.name || '';
export const hasFolder = () => !!dir;

// 처음: 폴더 고르기 (버튼 클릭 안에서 불러야 한다)
export async function pickFolder() {
  if (!isSupported()) throw new Error('이 브라우저는 폴더 저장을 지원하지 않습니다. PC의 크롬이나 엣지에서 열어 주세요.');
  let h;
  try { h = await window.showDirectoryPicker({ id: 'sueop', mode: 'readwrite' }); } catch (err) {
    if (err.name === 'AbortError') throw new Error('폴더를 고르지 않았습니다.');
    throw err;
  }
  dir = h;
  granted = true;
  await saveHandle(h);
}

// 다시 열 때 브라우저가 권한을 다시 물으면 (버튼 클릭 안에서)
export async function signIn() {
  if (!dir) await init();
  if (!dir) throw new Error('저장할 폴더가 없습니다. 처음 화면에서 폴더를 다시 골라 주세요.');
  granted = (await dir.requestPermission({ mode: 'readwrite' })) === 'granted';
  if (!granted) throw new Error('폴더 접근을 허락해야 저장할 수 있습니다.');
}

export async function signOut() {
  dir = null;
  granted = false;
  await dropHandle();
}

export async function userEmail() { return dir ? `내 컴퓨터 · ${dir.name} 폴더` : ''; }

// ---- 경로 → 핸들 ----
const notFound = (path) => { const e = new Error(`찾을 수 없습니다: ${path}`); e.status = 404; return e; };
const parts = (path) => String(path || '').split('/').filter(Boolean);
async function root() {
  if (!dir) throw new AuthError('저장할 폴더가 없습니다. 처음 화면에서 폴더를 골라 주세요.');
  if (!granted) {
    granted = (await dir.queryPermission({ mode: 'readwrite' })) === 'granted';
    if (!granted) throw new AuthError('폴더 접근 권한이 필요합니다. 다시 열기를 눌러 주세요.');
  }
  return dir;
}
async function dirAt(path, create = false) {
  let d = await root();
  for (const p of parts(path)) {
    try { d = await d.getDirectoryHandle(p, { create }); } catch (err) {
      if (err.name === 'NotFoundError' || err.name === 'TypeMismatchError') throw notFound(path);
      throw err;
    }
  }
  return d;
}
const split = (path) => { const p = parts(path); return { parent: p.slice(0, -1).join('/'), name: p[p.length - 1] }; };
async function fileAt(path) {
  const { parent, name } = split(path);
  try { return await (await dirAt(parent)).getFileHandle(name); } catch (err) {
    if (err.status === 404 || err.name === 'NotFoundError' || err.name === 'TypeMismatchError') throw notFound(path);
    throw err;
  }
}
const join = (a, b) => [...parts(a), b].join('/');
// 파일 이름에 못 쓰는 글자 바꾸기 (윈도우 기준)
const safe = (name) => String(name).replace(/[\\/:*?"<>|]/g, '_').trim() || '이름 없음';

// ---- google.js 와 같은 함수들 ----
export const ROOT_FOLDER = '수업관리';
export async function ensureFolder(name, parentId) {
  const path = join(parentId || '', safe(name));
  await dirAt(path, true);
  return path;
}
export async function ensureFolders() {
  const root = await ensureFolder(ROOT_FOLDER);
  return { root, materials: await ensureFolder('수업 자료', root) };
}

export async function findFile(name, parentId) {
  try {
    const f = await (await fileAt(join(parentId, name))).getFile();
    return { id: join(parentId, name), name, version: String(f.lastModified) };
  } catch (err) {
    if (err.status === 404) return null;
    throw err;
  }
}

// 파일이면 수정 시각을 버전으로, 폴더면 있는지만
export async function fileMeta(id) {
  try { return { name: split(id).name, version: String((await (await fileAt(id)).getFile()).lastModified), trashed: false }; } catch (err) {
    if (err.status !== 404) throw err;
    await dirAt(id);
    return { name: split(id).name, trashed: false };
  }
}
export async function fileVersion(id) { return String((await (await fileAt(id)).getFile()).lastModified); }

export async function readJson(id) {
  return JSON.parse(await (await (await fileAt(id)).getFile()).text());
}

async function writeTo(fh, content) {
  const w = await fh.createWritable();
  await w.write(content);
  await w.close();
}

export async function writeJson({ fileId, name, parentId, data }) {
  const id = fileId || join(parentId, name);
  const { parent, name: n } = split(id);
  const fh = await (await dirAt(parent, true)).getFileHandle(n, { create: true });
  await writeTo(fh, JSON.stringify(data));
  return { id, version: String((await fh.getFile()).lastModified) };
}

// 같은 이름이 있으면 '이름 (2).확장자'
async function freeName(d, name) {
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  for (let i = 1; ; i++) {
    const n = i === 1 ? name : `${base} (${i})${ext}`;
    try { await d.getFileHandle(n); } catch { return n; }
  }
}

export async function uploadFile(file, parentId, onProgress) {
  const d = await dirAt(parentId, true);
  const name = await freeName(d, safe(file.name));
  await writeTo(await d.getFileHandle(name, { create: true }), file);
  onProgress?.(1);
  return { id: join(parentId, name), name, size: file.size, mimeType: file.type };
}

// 경로가 id 라서 이름 바꾸기 · 옮기기는 하지 않는다 (파일은 처음 넣은 자리에 그대로)
export async function renameFile() {}
export async function moveFile() {}

// 지우기: '수업관리/휴지통'으로 옮긴다 (폴더는 그대로 둔다)
export async function trashFile(id) {
  let fh;
  try { fh = await fileAt(id); } catch (err) { if (err.status === 404) return; throw err; }
  const file = await fh.getFile();
  const bin = await dirAt(join(ROOT_FOLDER, '휴지통'), true);
  await writeTo(await bin.getFileHandle(await freeName(bin, file.name), { create: true }), file);
  const { parent, name } = split(id);
  await (await dirAt(parent)).removeEntry(name);
}

// 파일 내용 읽기 (엑셀 채점표 가져오기)
export async function readBytes(id) { return (await (await fileAt(id)).getFile()).arrayBuffer(); }

// 파일 열기 · 내려받기: 브라우저 주소로 열 수 없어서 읽어서 연다
export async function openFile(id, { download = false, name = '' } = {}) {
  const win = download ? null : window.open('', '_blank');
  try {
    const file = await (await fileAt(id)).getFile();
    const url = URL.createObjectURL(file);
    if (download || !win) {
      const a = Object.assign(document.createElement('a'), { href: url, download: name || file.name });
      document.body.append(a);
      a.click();
      a.remove();
      win?.close();
    } else win.location.href = url;
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (err) {
    win?.close();
    if (err.status === 404) throw new Error(`파일이 폴더에 없습니다(옮겼거나 지웠을 수 있습니다): ${id}`);
    throw err;
  }
}

// 구글에만 있는 기능
export const hasCalendar = () => false;
const googleOnly = async () => { throw new Error('구글 드라이브로 쓸 때만 되는 기능입니다.'); };
export const createSheetFromXlsx = googleOnly;
export const exportXlsx = googleOnly;
export const createCalendar = googleOnly;
export const saveEvent = googleOnly;
export const deleteEvent = googleOnly;
