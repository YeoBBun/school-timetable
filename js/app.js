import { supabase, isConfigured } from './db.js';
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

function syncBadge() {
  const st = S.sync.status;
  const label = st === 'on' ? '실시간 동기화 중' : st === 'error' ? '동기화 연결 끊김' : '연결 중…';
  return h('div', { class: `sync sync-${st}`, id: 'sync-badge', title: '다른 기기에서 바꾼 내용이 자동으로 반영됩니다' },
    h('span', { class: 'dot' }), label);
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
function loginView() {
  const email = h('input', { type: 'email', placeholder: '이메일', autocomplete: 'username', required: true });
  const password = h('input', { type: 'password', placeholder: '비밀번호', autocomplete: 'current-password', required: true });
  const btn = h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, '로그인');
  const form = h('form', {
    class: 'login-card',
    onSubmit: async (e) => {
      e.preventDefault();
      btn.disabled = true;
      btn.textContent = '로그인 중…';
      const { error } = await supabase.auth.signInWithPassword({ email: email.value.trim(), password: password.value });
      btn.disabled = false;
      btn.textContent = '로그인';
      if (error) toast(error.message === 'Invalid login credentials' ? '이메일 또는 비밀번호가 올바르지 않습니다.' : error.message, 'error');
    },
  },
  h('h1', {}, '진도관리'),
  h('p', { class: 'muted' }, '반별 진도 · 시간표 · 수업 자료'),
  h('label', {}, '이메일', email),
  h('label', {}, '비밀번호', password),
  btn);
  app.replaceChildren(h('div', { class: 'login-wrap' }, form));
  viewEl = null;
  email.focus();
}

function notConfiguredView() {
  app.replaceChildren(h('div', { class: 'login-wrap' },
    h('div', { class: 'login-card' },
      h('h1', {}, '설정이 필요합니다'),
      h('p', {}, 'js/config.js 파일에 Supabase 프로젝트 URL과 anon 키를 입력하세요.'),
      h('p', { class: 'muted' }, '자세한 방법은 README.md 를 참고하세요.'))));
}

async function onSignedIn(user) {
  if (S.session.user?.id === user.id) return;
  S.session.user = user;
  app.replaceChildren(h('div', { class: 'loading' }, '데이터 불러오는 중…'));
  viewEl = null;
  try {
    await S.loadAll();
    S.startRealtime();
  } catch (err) {
    showError(err);
    if (/relation .* does not exist|Could not find the table/i.test(err.message)) {
      toast('DB 테이블이 없습니다. supabase/schema.sql 을 먼저 실행하세요.', 'error');
    }
  }
  render();
}

function onSignedOut() {
  S.session.user = null;
  S.stopRealtime();
  S.clearData();
  loginView();
}

export async function signOut() {
  await supabase.auth.signOut();
}

async function start() {
  if (!isConfigured) return notConfiguredView();
  const { data } = await supabase.auth.getSession();
  if (data.session) await onSignedIn(data.session.user);
  else loginView();
  supabase.auth.onAuthStateChange((event, sess) => {
    if (sess?.user) onSignedIn(sess.user);
    else if (event === 'SIGNED_OUT') onSignedOut();
  });
}

start();
