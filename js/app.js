import * as G from './google.js';
import * as S from './store.js';
import { h, toast, showError, todayStr } from './ui.js';
import home from './views/home.js';
import classpage from './views/classpage.js';
import search from './views/search.js';
import assess from './views/assess.js';
import schedule from './views/schedule.js';
import './calendar.js';
import materials from './views/materials.js';
import settings from './views/settings.js';

// nav: false 인 화면은 메뉴에 없고 링크로만 들어간다 (#/class/반id)
const ROUTES = [
  { path: 'today', label: '홈', view: home },
  { path: 'materials', label: '수업 자료', view: materials },
  { path: 'assess', label: '수행평가', view: assess },
  { path: 'schedule', label: '일정', view: schedule },
  { path: 'search', label: '찾기', view: search },
  { path: 'settings', label: '설정', view: settings },
  // 시간표 · 반은 설정 안의 탭 (예전 주소 #/timetable 도 그대로 열린다)
  { path: 'timetable', view: (root) => settings(root, 'timetable'), nav: false, parent: 'settings' },
  { path: 'class', view: classpage, nav: false, parent: 'today' },
];

const app = document.getElementById('app');
let viewEl = null;
let renderPending = false;

export function go(path) {
  if (location.hash === `#/${path}`) render();
  else location.hash = `#/${path}`;
}

// '#/class/abc/students' → class 화면 + arg 'abc' + sub 'students'
function currentRoute() {
  const [path, arg, sub] = location.hash.replace(/^#\/?/, '').split('/');
  const route = ROUTES.find((r) => r.path === path) || ROUTES[0];
  const dec = (v) => (v ? decodeURIComponent(v) : undefined);
  return { ...route, arg: dec(arg), sub: dec(sub) };
}

const SYNC_LABEL = { on: '드라이브에 저장됨', saving: '저장 중…', error: '저장 실패 · 다시 시도 중', auth: '구글 다시 연결 필요', off: '연결 중…' };

function syncBadge() {
  const st = S.sync.status;
  const badge = h('div', { class: `sync sync-${st}`, id: st === 'auth' ? null : 'sync-badge', title: S.sync.message || '구글 드라이브의 진도관리 폴더에 자동으로 저장됩니다' },
    h('span', { class: 'dot' }), SYNC_LABEL[st] || st);
  if (st !== 'auth') return badge;
  return h('div', { id: 'sync-badge' }, badge,
    h('button', { class: 'btn btn-sm btn-primary', style: { marginTop: '6px' }, onClick: reconnect }, '다시 연결'));
}

// 로그인이 만료되면(약 1시간) 버튼을 눌러 다시 연결하고 밀린 저장을 이어서 한다
async function reconnect() {
  try {
    await G.signIn(!!S.settings().gcal_id);
    await S.resume();
    toast('다시 연결했습니다.', 'ok');
  } catch (err) { showError(err); }
}

function shell() {
  const route = currentRoute();
  viewEl = h('main', { class: 'view', id: 'view' });
  const nav = h('nav', { class: 'nav' },
    ROUTES.filter((r) => r.nav !== false).map((r) => h('a', { href: `#/${r.path}`, class: r.path === (route.parent || route.path) ? 'active' : '' }, r.label)));
  const side = h('aside', { class: 'sidebar' },
    h('div', { class: 'brand' }, '진도관리'),
    h('div', { class: 'term-picker', id: 'term-picker' }),
    nav,
    h('div', { class: 'side-footer' },
      syncBadge(),
      h('div', { class: 'muted small', id: 'user-email' }, S.session.user?.email || '')));
  app.replaceChildren(h('div', { class: 'layout' }, side, viewEl));
}

// 왼쪽 위 학기 고르기 (엑셀 시트 탭처럼 앱 전체가 그 학기를 보여 준다)
function drawTermPicker() {
  const box = document.getElementById('term-picker');
  if (!box) return;
  const cur = S.termOf(todayStr());
  const sel = h('select', {
    value: S.termKey(S.viewTerm()), title: '보는 학년도 · 학기',
    onChange: (e) => S.setViewTerm(S.parseTermKey(e.target.value)),
  }, S.allTerms().map((t) => h('option', { value: S.termKey(t) }, `${S.termLabel(t)}${S.sameTerm(t, cur) ? ' (지금)' : ''}`)));
  box.replaceChildren(sel);
}

function otherTermBanner() {
  if (S.isCurrentTerm()) return null;
  return h('div', { class: 'term-banner' },
    h('span', {}, `📂 ${S.termLabel(S.viewTerm())}를 보고 있습니다. 여기서 만든 단원 · 반 · 시간표는 이 학기에 들어갑니다.`),
    h('button', { class: 'btn btn-sm', onClick: () => S.setViewTerm(S.termOf(todayStr())) }, '이번 학기로 돌아가기'));
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
  document.querySelectorAll('.nav a').forEach((a) => a.classList.toggle('active', a.getAttribute('href') === `#/${route.parent || route.path}`));
  const scroll = viewEl.scrollTop;
  const key = `${route.path}/${route.arg ?? ''}/${route.sub ?? ''}`;
  const sameView = viewEl.dataset.route === key;
  viewEl.dataset.route = key;
  // data-fk 가 붙은 입력칸에 커서가 있으면 다시 그린 뒤에도 그 칸에 커서를 둔다 (표에서 Tab · Enter 로 이어 입력)
  const fk = sameView ? document.activeElement?.dataset?.fk : null;
  viewEl.replaceChildren();
  drawTermPicker();
  const banner = otherTermBanner();
  if (banner) viewEl.append(banner);
  try {
    route.view(viewEl, route.arg, route.sub);
  } catch (err) {
    showError(err);
  }
  if (sameView) viewEl.scrollTop = scroll;
  else viewEl.scrollTop = 0;
  if (fk) {
    const el = viewEl.querySelector(`[data-fk="${CSS.escape(fk)}"]`);
    if (el) {
      el.focus();
      if (el.tagName === 'TEXTAREA') el.setSelectionRange(el.value.length, el.value.length);
      else el.select?.();
    }
  }
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

// 바뀐 내용은 한 번에 모아 다음 순간에 그린다 (Tab 으로 옮겨 간 칸을 알고 나서 그리도록)
let renderTimer = null;
let renderRemote = true;
S.onChange(({ remote }) => {
  renderRemote &&= remote;
  if (renderTimer) return;
  renderTimer = setTimeout(() => {
    renderTimer = null;
    const r = renderRemote;
    renderRemote = true;
    render({ remote: r });
  }, 0);
});

// ---- 로그인 ----
function loginView(message) {
  const btn = h('button', {
    class: 'btn btn-primary btn-block',
    onClick: async () => {
      btn.disabled = true;
      btn.textContent = '구글 로그인 창을 확인하세요…';
      try {
        await G.signIn(!!S.settings().gcal_id);
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
  // 브라우저 사본으로 이미 화면을 보여 주고 있으면 그대로 두고 뒤에서 합친다
  if (S.session.user) {
    G.userEmail().then((email) => {
      S.session.user.email = email;
      const el = document.getElementById('user-email');
      if (el) el.textContent = email;
    }).catch(() => {});
    try { await S.loadAll(); } catch (err) { S.handleSyncError(err); }
    return;
  }
  app.replaceChildren(h('div', { class: 'loading' }, '구글 드라이브에서 불러오는 중…'));
  viewEl = null;
  try {
    // 이메일 확인과 드라이브 읽기를 동시에
    S.session.user = { id: 'me', email: '' };
    const [email] = await Promise.all([G.userEmail(), S.loadAll()]);
    S.session.user.email = email;
    viewEl = null; // 이메일이 들어간 화면으로 다시 그리기
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
  // 지난번 데이터가 이 PC에 있으면 구글 연결을 기다리지 않고 바로 보여 준다
  const cached = S.loadCache();
  if (cached) {
    S.session.user = { id: 'me', email: cached.email };
    render();
    S.startSync();
  }
  let initErr = null;
  try { await G.init(); } catch (err) { initErr = err; }
  if (initErr && !cached) return loginView(initErr.message);
  if (G.hasToken()) await onSignedIn();
  else if (cached) (initErr ? S.handleSyncError(initErr) : S.needAuth());
  else loginView();
}

start();
