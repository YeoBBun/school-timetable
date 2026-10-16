import * as G from './google.js';
import * as S from './store.js';
import { h, toast, showError } from './ui.js';
import today from './views/today.js';
import timetable from './views/timetable.js';
import progress from './views/progress.js';
import curriculum from './views/curriculum.js';
import materials from './views/materials.js';
import settings from './views/settings.js';

const ROUTES = [
  { path: 'today', label: '오늘 수업', view: today },
  { path: 'progress', label: '반별 진도', view: progress },
  { path: 'timetable', label: '시간표 · 반', view: timetable },
  { path: 'curriculum', label: '단원 · 차시', view: curriculum },
  { path: 'materials', label: '수업 자료', view: materials },
  { path: 'settings', label: '설정', view: settings },
];

const app = document.getElementById('app');
let viewEl = null;
let renderPending = false;

export function go(path) {
  if (location.hash === `#/${path}`) render();
  else location.hash = `#/${path}`;
}

function currentRoute() {
  const path = location.hash.replace(/^#\/?/, '');
  return ROUTES.find((r) => r.path === path) || ROUTES[0];
}

const SYNC_LABEL = { on: '드라이브에 저장됨', saving: '저장 중…', error: '저장 실패 · 다시 시도 중', auth: '구글 다시 연결 필요', off: '연결 중…' };

function syncBadge() {
  const st = S.sync.status;
  const badge = h('div', { class: `sync sync-${st}`, id: 'sync-badge', title: S.sync.message || '구글 드라이브의 진도관리 폴더에 자동으로 저장됩니다' },
    h('span', { class: 'dot' }), SYNC_LABEL[st] || st);
  if (st !== 'auth') return badge;
  return h('div', { id: 'sync-badge' }, badge,
    h('button', { class: 'btn btn-sm btn-primary', style: { marginTop: '6px' }, onClick: reconnect }, '다시 연결'));
}

// 로그인이 만료되면(약 1시간) 버튼을 눌러 다시 연결하고 밀린 저장을 이어서 한다
async function reconnect() {
  try {
    await G.signIn();
    await S.resume();
    toast('다시 연결했습니다.', 'ok');
  } catch (err) { showError(err); }
}

function shell() {
  const route = currentRoute();
  viewEl = h('main', { class: 'view', id: 'view' });
  const nav = h('nav', { class: 'nav' },
    ROUTES.map((r) => h('a', { href: `#/${r.path}`, class: r === route ? 'active' : '' }, r.label)));
  const side = h('aside', { class: 'sidebar' },
    h('div', { class: 'brand' }, '진도관리'),
    nav,
    h('div', { class: 'side-footer' },
      syncBadge(),
      h('div', { class: 'muted small' }, S.session.user?.email || '')));
  app.replaceChildren(h('div', { class: 'layout' }, side, viewEl));
}

export function render({ remote = false } = {}) {
  if (!S.session.user) return;
  if (!viewEl || !viewEl.isConnected) shell();
  // 다른 기기의 변경은 입력 중일 때 미뤘다가 포커스가 빠질 때 반영한다. 모달이 열려 있을 때도 미룬다
  const active = document.activeElement;
  const typing = remote && viewEl.contains(active) && active.matches('textarea, input[type=text], input[type=number], input[type=search], input:not([type])');
  if (typing || document.querySelector('.modal-overlay')) {
    renderPending = true;
    return;
  }
  renderPending = false;
  const route = currentRoute();
  document.querySelectorAll('.nav a').forEach((a) => a.classList.toggle('active', a.getAttribute('href') === `#/${route.path}`));
  const scroll = viewEl.scrollTop;
  const sameView = viewEl.dataset.route === route.path;
  viewEl.dataset.route = route.path;
  viewEl.replaceChildren();
  try {
    route.view(viewEl);
  } catch (err) {
    showError(err);
  }
  if (sameView) viewEl.scrollTop = scroll;
  else viewEl.scrollTop = 0;
}

// 포커스가 빠지거나 모달이 닫히면 미뤄둔 렌더링 실행
document.addEventListener('focusout', () => setTimeout(() => { if (renderPending) render(); }, 50));
new MutationObserver(() => {
  if (renderPending && !document.querySelector('.modal-overlay')) setTimeout(render, 0);
}).observe(document.body, { childList: true });

document.addEventListener('sync-status', () => {
  const old = document.getElementById('sync-badge');
  if (old) old.replaceWith(syncBadge());
});

window.addEventListener('hashchange', () => {
  if (document.activeElement && viewEl?.contains(document.activeElement)) document.activeElement.blur();
  render();
});

S.onChange(render);

// ---- 로그인 ----
function loginView(message) {
  const btn = h('button', {
    class: 'btn btn-primary btn-block',
    onClick: async () => {
      btn.disabled = true;
      btn.textContent = '구글 로그인 창을 확인하세요…';
      try {
        await G.signIn();
        await onSignedIn();
      } catch (err) {
        showError(err);
        btn.disabled = false;
        btn.textContent = '구글 계정으로 로그인';
      }
    },
  }, '구글 계정으로 로그인');
  app.replaceChildren(h('div', { class: 'login-wrap' },
    h('div', { class: 'login-card' },
      h('h1', {}, '진도관리'),
      h('p', { class: 'muted' }, '반별 진도 · 시간표 · 수업 자료'),
      message ? h('div', { class: 'banner', style: { margin: 0 } }, message) : null,
      btn,
      h('p', { class: 'muted small' }, "모든 기록과 수업 자료는 내 구글 드라이브의 '진도관리' 폴더에 저장됩니다. 앱은 그 폴더에만 접근합니다."))));
  viewEl = null;
}

function notConfiguredView() {
  app.replaceChildren(h('div', { class: 'login-wrap' },
    h('div', { class: 'login-card' },
      h('h1', {}, '설정이 필요합니다'),
      h('p', {}, 'js/config.js 파일에 구글 OAuth 클라이언트 ID를 입력하세요.'),
      h('p', { class: 'muted' }, '자세한 방법은 README.md 를 참고하세요.'))));
}

async function onSignedIn() {
  app.replaceChildren(h('div', { class: 'loading' }, '구글 드라이브에서 불러오는 중…'));
  viewEl = null;
  try {
    const email = await G.userEmail();
    S.session.user = { id: 'me', email };
    await S.loadAll();
    S.startSync();
    render();
  } catch (err) {
    S.session.user = null;
    console.error(err);
    loginView(err.code === 'auth' ? '구글 로그인이 만료되었습니다. 다시 로그인해 주세요.' : `불러오지 못했습니다: ${err.message}`);
  }
}

export async function signOut() {
  if (S.hasUnsaved()) await S.save();
  G.signOut();
  S.session.user = null;
  S.stopSync();
  S.clearData();
  loginView();
}

// 저장이 끝나기 전에 창을 닫으려 하면 경고
window.addEventListener('beforeunload', (e) => {
  if (S.session.user && S.hasUnsaved()) { e.preventDefault(); e.returnValue = ''; }
});

async function start() {
  if (!G.isConfigured) return notConfiguredView();
  try {
    await G.init();
  } catch (err) {
    return loginView(err.message);
  }
  if (G.hasToken()) await onSignedIn();
  else loginView();
}

start();
