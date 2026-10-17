// 구글 로그인(Google Identity Services)과 구글 드라이브 API
// 권한은 drive.file: 이 앱이 만든 파일과 폴더에만 접근할 수 있다
import { GOOGLE_CLIENT_ID } from './config.js';

const SCOPE_DRIVE = 'https://www.googleapis.com/auth/drive.file';
const SCOPES = `${SCOPE_DRIVE} email`;
const TOKEN_KEY = 'jindo.google.token';
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER_MIME = 'application/vnd.google-apps.folder';

export const isConfigured = /\.apps\.googleusercontent\.com$/.test(GOOGLE_CLIENT_ID.trim());

// 로그인이 만료되어 다시 연결해야 할 때 던지는 오류
export class AuthError extends Error {
  constructor(message = '구글 연결이 만료되었습니다. 다시 연결해 주세요.') {
    super(message);
    this.code = 'auth';
  }
}

let token = null; // { access_token, expires_at }

function loadScript() {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts?.oauth2) return resolve();
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('구글 로그인 스크립트를 불러오지 못했습니다. 인터넷 연결을 확인하세요.'));
    document.head.append(s);
  });
}

function saveToken() {
  try { token ? localStorage.setItem(TOKEN_KEY, JSON.stringify(token)) : localStorage.removeItem(TOKEN_KEY); } catch { /* 저장 불가 환경 */ }
}

export async function init() {
  // 토큰부터 읽어 둔다(스크립트를 못 받아도 남은 토큰으로 드라이브는 쓸 수 있게)
  try {
    const t = JSON.parse(localStorage.getItem(TOKEN_KEY) || 'null');
    if (t && t.expires_at > Date.now() + 60_000) token = t;
  } catch { /* 무시 */ }
  await loadScript();
}

export const hasToken = () => !!token && token.expires_at > Date.now() + 30_000;

// 반드시 버튼 클릭 같은 사용자 동작 안에서 호출해야 팝업이 막히지 않는다
export function signIn() {
  return new Promise((resolve, reject) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID.trim(),
      scope: SCOPES,
      prompt: '',
      callback: (resp) => {
        if (resp.error) return reject(new Error(resp.error_description || resp.error));
        if (!window.google.accounts.oauth2.hasGrantedAllScopes(resp, SCOPE_DRIVE)) {
          return reject(new Error("구글 드라이브 권한이 필요합니다. 로그인 창에서 '드라이브' 항목을 체크해 주세요."));
        }
        token = { access_token: resp.access_token, expires_at: Date.now() + Number(resp.expires_in) * 1000 };
        saveToken();
        resolve();
      },
      error_callback: (err) => reject(new Error(err?.type === 'popup_closed' ? '로그인 창이 닫혔습니다.' : err?.type === 'popup_failed_to_open' ? '팝업이 차단되었습니다. 브라우저에서 팝업을 허용해 주세요.' : (err?.message || '구글 로그인에 실패했습니다.'))),
    });
    client.requestAccessToken();
  });
}

export function signOut() {
  if (token) {
    try { window.google.accounts.oauth2.revoke(token.access_token, () => {}); } catch { /* 무시 */ }
  }
  token = null;
  saveToken();
}

async function api(url, options = {}) {
  if (!hasToken()) throw new AuthError();
  const res = await fetch(url, { ...options, headers: { Authorization: `Bearer ${token.access_token}`, ...(options.headers || {}) } });
  if (res.status === 401) {
    token = null;
    saveToken();
    throw new AuthError();
  }
  if (!res.ok) {
    let msg = `구글 드라이브 오류 (${res.status})`;
    try { msg = (await res.json()).error?.message || msg; } catch { /* 무시 */ }
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return res;
}

export async function userEmail() {
  const res = await api('https://www.googleapis.com/oauth2/v3/userinfo');
  return (await res.json()).email || '';
}

const q = (s) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

async function findOne(query) {
  const res = await api(`${API}/files?q=${encodeURIComponent(query)}&fields=files(id,name,version)&spaces=drive&pageSize=10&orderBy=createdTime`);
  return (await res.json()).files[0] || null;
}

async function createFolder(name, parentId) {
  const res = await api(`${API}/files?fields=id`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: parentId ? [parentId] : undefined }),
  });
  return (await res.json()).id;
}

// 이름이 같은 폴더가 있으면 그것을, 없으면 새로 만든다
export async function ensureFolder(name, parentId) {
  const parent = parentId ? ` and '${q(parentId)}' in parents` : '';
  const found = await findOne(`name='${q(name)}' and mimeType='${FOLDER_MIME}' and trashed=false${parent}`);
  return found ? found.id : createFolder(name, parentId);
}

// 내 드라이브의 '진도관리' 폴더와 그 안의 '수업 자료' 폴더
export async function ensureFolders() {
  const root = await ensureFolder('진도관리');
  const materials = await ensureFolder('수업 자료', root);
  return { root, materials };
}

export async function findFile(name, parentId) {
  return findOne(`name='${q(name)}' and '${q(parentId)}' in parents and trashed=false`);
}

export async function fileVersion(fileId) {
  const res = await api(`${API}/files/${fileId}?fields=version`);
  return (await res.json()).version;
}

// 버전과 휴지통 여부 (없는 파일이면 status 404 오류)
export async function fileMeta(fileId) {
  const res = await api(`${API}/files/${fileId}?fields=version,trashed`);
  return res.json();
}

export async function readJson(fileId) {
  const res = await api(`${API}/files/${fileId}?alt=media`, { cache: 'no-store' });
  return res.json();
}

// JSON 파일 만들기(fileId 없음) 또는 덮어쓰기. { id, version } 반환
export async function writeJson({ fileId, name, parentId, data }) {
  const boundary = `jindo${Math.random().toString(36).slice(2)}`;
  const meta = fileId ? {} : { name, parents: [parentId], mimeType: 'application/json' };
  const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n`
    + `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(data)}\r\n--${boundary}--`;
  const url = fileId
    ? `${UPLOAD}/files/${fileId}?uploadType=multipart&fields=id,version`
    : `${UPLOAD}/files?uploadType=multipart&fields=id,version`;
  const res = await api(url, { method: fileId ? 'PATCH' : 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body });
  return res.json();
}

// 수업 자료 파일 업로드 (큰 파일도 되도록 resumable 방식)
export async function uploadFile(file, parentId, onProgress) {
  const start = await api(`${UPLOAD}/files?uploadType=resumable&fields=id,name,size,mimeType,webViewLink`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': file.type || 'application/octet-stream',
      'X-Upload-Content-Length': String(file.size),
    },
    body: JSON.stringify({ name: file.name, parents: [parentId], mimeType: file.type || undefined }),
  });
  const location = start.headers.get('Location');
  if (!location) throw new Error('업로드를 시작하지 못했습니다.');
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', location);
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress?.(e.loaded / e.total); };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve(JSON.parse(xhr.responseText));
      else if (xhr.status === 401) reject(new AuthError());
      else reject(new Error(`업로드 실패 (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error('업로드 중 네트워크 오류가 났습니다.'));
    xhr.send(file);
  });
}

// 이름 바꾸기 (폴더 · 파일 모두)
export async function renameFile(fileId, name) {
  await api(`${API}/files/${fileId}?fields=id`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
}

// 다른 폴더로 옮기기
export async function moveFile(fileId, toParentId, fromParentId) {
  const params = new URLSearchParams({ addParents: toParentId, fields: 'id' });
  if (fromParentId && fromParentId !== toParentId) params.set('removeParents', fromParentId);
  await api(`${API}/files/${fileId}?${params}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: '{}' });
}

// 삭제 대신 휴지통으로 (드라이브 휴지통에서 30일 동안 되살릴 수 있다)
export async function trashFile(fileId) {
  try {
    await api(`${API}/files/${fileId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trashed: true }) });
  } catch (err) {
    if (err.status !== 404) throw err;
  }
}

export const fileViewUrl = (id) => `https://drive.google.com/file/d/${id}/view`;
export const fileDownloadUrl = (id) => `https://drive.google.com/uc?export=download&id=${id}`;
export const folderUrl = (id) => `https://drive.google.com/drive/folders/${id}`;
