// 저장 방식 고르기: 구글 드라이브(google.js) 또는 이 PC 폴더(local.js). 고른 방식은 이 브라우저에만 기억(jindo.mode)
// 다른 파일은 google.js 대신 이 파일을 불러 쓰고, 함수마다 지금 방식으로 넘겨준다
import * as google from './google.js';
import * as local from './local.js';

export { AuthError, isConfigured, sheetUrl, fileViewUrl, folderUrl, calendarUrl, ROOT_FOLDER } from './google.js';
export { isSupported as localSupported, pickFolder, folderName, hasFolder } from './local.js';

const MODE_KEY = 'jindo.mode';
export function mode() {
  try { return localStorage.getItem(MODE_KEY) === 'local' ? 'local' : 'google'; } catch { return 'google'; }
}
export const isLocal = () => mode() === 'local';
export function setMode(m) {
  try { if (m === 'local') localStorage.setItem(MODE_KEY, 'local'); else localStorage.removeItem(MODE_KEY); } catch { /* 저장 불가 환경 */ }
}
const B = () => (isLocal() ? local : google);

export const init = (...a) => B().init(...a);
export const hasToken = () => B().hasToken();
export const signIn = (...a) => B().signIn(...a);
export const signOut = (...a) => B().signOut(...a);
export const userEmail = () => B().userEmail();
export const ensureFolder = (...a) => B().ensureFolder(...a);
export const ensureFolders = () => B().ensureFolders();
export const findFile = (...a) => B().findFile(...a);
export const fileVersion = (...a) => B().fileVersion(...a);
export const fileMeta = (...a) => B().fileMeta(...a);
export const readJson = (...a) => B().readJson(...a);
export const writeJson = (...a) => B().writeJson(...a);
export const uploadFile = (...a) => B().uploadFile(...a);
export const readBytes = (...a) => local.readBytes(...a); // 로컬 폴더에서만 (엑셀 채점표)
export const renameFile = (...a) => B().renameFile(...a);
export const moveFile = (...a) => B().moveFile(...a);
export const trashFile = (...a) => B().trashFile(...a);
export const createSheetFromXlsx = (...a) => B().createSheetFromXlsx(...a);
export const exportXlsx = (...a) => B().exportXlsx(...a);
export const hasCalendar = () => B().hasCalendar();
export const createCalendar = (...a) => B().createCalendar(...a);
export const saveEvent = (...a) => B().saveEvent(...a);
export const deleteEvent = (...a) => B().deleteEvent(...a);

// 수업 자료 파일 열기 · 내려받기
export function openFile(id, { download = false, url = '', name = '' } = {}) {
  if (isLocal()) return local.openFile(id, { download, name });
  window.open(download ? google.fileDownloadUrl(id) : (url || google.fileViewUrl(id)), '_blank', 'noopener');
  return Promise.resolve();
}
