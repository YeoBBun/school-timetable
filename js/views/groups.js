// 조 편성: 무작위로 짜거나 직접 짜기(학생을 눌러 조에 넣기 · 끌어다 놓기), 저장 · TV 로 보기
import { h, append, toast, showError, confirmDialog, todayStr, fmtMD, tvOverlay } from '../ui.js';
import * as S from '../store.js';
import { go } from '../app.js';

// 반마다 화면 상태 (저장 전 결과 · 옵션). draft.groups = [[학생id]], 어느 조에도 없는 학생은 '조 없는 학생'
const states = new Map();
function stateOf(cls) {
  if (!states.has(cls.id)) states.set(cls.id, { mode: 'count', count: 4, size: 4, draft: null, pick: null });
  return states.get(cls.id);
}
const refresh = (cls) => go(`class/${cls.id}/groups`);

const savedOf = (cls) => S.data.groupings.filter((g) => g.class_id === cls.id).sort((a, b) => b.created_at.localeCompare(a.created_at));

const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};
const groupCount = (n, opt) => Math.max(1, Math.min(n, opt.mode === 'count' ? opt.count : Math.ceil(n / Math.max(1, opt.size))));
const byNumber = (byId) => (a, b) => byId.get(a).number - byId.get(b).number;

// 무작위: 섞어서 한 명씩 돌아가며 나눠 준다 (조 인원 차이는 많아야 1명)
export function makeGroups(students, opt) {
  const k = groupCount(students.length, opt);
  const groups = Array.from({ length: k }, () => []);
  shuffle(students).forEach((s, i) => groups[i % k].push(s.id));
  const byId = new Map(students.map((s) => [s.id, s]));
  groups.forEach((g) => g.sort(byNumber(byId)));
  return groups;
}

// ---- 화면 ----
export function renderGroupsTab(root, cls) {
  const students = S.studentsOf(cls);
  if (!students.length) {
    append(root, h('div', { class: 'empty' }, '학생 명단이 없습니다. ', h('a', { href: `#/class/${cls.id}/students` }, '학생 탭에서 먼저 넣으세요.')));
    return;
  }
  const st = stateOf(cls);
  const byId = new Map(students.map((s) => [s.id, s]));
  // 그사이 지워진 학생은 결과에서 뺀다
  if (st.draft) st.draft.groups = st.draft.groups.map((g) => g.filter((id) => byId.has(id)));

  const start = (random) => {
    st.draft = { groups: random ? makeGroups(students, st) : Array.from({ length: groupCount(students.length, st) }, () => []) };
    st.pick = null;
    refresh(cls);
  };

  append(root, h('div', { class: 'cols groups-cols' },
    h('div', {}, st.draft ? resultView(cls, st, students, byId) : h('div', { class: 'empty' }, "오른쪽에서 조 수를 정하고 '무작위로 짜기' 또는 '직접 짜기'를 누르세요."), savedList(cls, byId)),
    h('div', {}, optionsCard(cls, st, start))));
}

function optionsCard(cls, st, start) {
  const set = (patch) => { Object.assign(st, patch); refresh(cls); };
  const numInput = (key) => h('input', { type: 'number', min: 1, max: 20, value: st[key], style: { width: '70px' }, onChange: (e) => { st[key] = Math.max(1, Number(e.target.value) || 1); } });
  return h('div', { class: 'card' },
    h('h3', {}, '조 짜기'),
    h('div', { class: 'row' },
      h('div', { class: 'seg' },
        h('button', { class: st.mode === 'count' ? 'active' : '', onClick: () => set({ mode: 'count' }) }, '조 수로'),
        h('button', { class: st.mode === 'size' ? 'active' : '', onClick: () => set({ mode: 'size' }) }, '조 인원으로')),
      st.mode === 'count' ? [numInput('count'), h('span', { class: 'small' }, '개 조')] : [numInput('size'), h('span', { class: 'small' }, '명씩')]),
    h('div', { class: 'row', style: { marginTop: '12px' } },
      h('button', { class: 'btn btn-primary grow', onClick: () => start(true) }, '🎲 무작위로 짜기'),
      h('button', { class: 'btn grow', onClick: () => start(false) }, '✋ 직접 짜기')),
    h('p', { class: 'muted small', style: { margin: '8px 0 0' } }, '직접 짜기는 빈 조를 만들고, 학생을 눌러 고른 뒤 넣을 조를 누르면 됩니다(끌어다 놓아도 됩니다).'));
}

function resultView(cls, st, students, byId) {
  const d = st.draft;
  const placed = new Set(d.groups.flat());
  const pool = students.filter((s) => !placed.has(s.id)).map((s) => s.id);
  let dragging = null;
  // to: 조 번호, -1 이면 '조 없는 학생'으로
  const move = (id, to) => {
    d.groups = d.groups.map((g) => g.filter((x) => x !== id));
    if (to >= 0) d.groups[to] = [...d.groups[to], id].sort(byNumber(byId));
    st.pick = null;
    refresh(cls);
  };
  const name = h('input', { type: 'text', value: `${fmtMD(todayStr())} 조`, style: { width: '160px' } });
  const save = async () => {
    try {
      await S.insert('groupings', { class_id: cls.id, name: name.value.trim() || `${fmtMD(todayStr())} 조`, date: todayStr(), groups: d.groups.filter((g) => g.length) });
      toast(pool.length ? `저장했습니다. 조 없는 학생 ${pool.length}명은 빠졌습니다.` : '조 편성을 저장했습니다.', 'ok');
    } catch (err) { showError(err); }
  };
  const member = (id) => h('div', {
    class: `member ${st.pick === id ? 'picked' : ''}`, draggable: 'true',
    onDragstart: () => { dragging = id; },
    onClick: (e) => { e.stopPropagation(); st.pick = st.pick === id ? null : id; refresh(cls); },
    title: '눌러서 고른 뒤 넣을 조를 누르기 (끌어다 놓아도 됩니다)',
  }, `${byId.get(id).number} ${byId.get(id).name}`);
  const box = (gi, title, ids, extra = '') => h('div', {
    class: `group-card ${extra} ${st.pick ? 'can-drop' : ''}`,
    onClick: () => { if (st.pick) move(st.pick, gi); },
    onDragover: (e) => { e.preventDefault(); e.currentTarget.classList.add('over'); },
    onDragleave: (e) => e.currentTarget.classList.remove('over'),
    onDrop: (e) => { e.preventDefault(); if (dragging) move(dragging, gi); },
  },
  h('div', { class: 'row' }, h('strong', {}, title), h('span', { class: 'muted small' }, `${ids.length}명`)),
  ids.map(member));
  return h('div', { class: 'card' },
    h('div', { class: 'row', style: { marginBottom: '10px' } },
      h('h3', { style: { margin: 0 } }, `결과 · ${d.groups.length}개 조`),
      h('span', { class: 'grow' }),
      name,
      h('button', { class: 'btn btn-primary', onClick: save }, '저장'),
      h('button', { class: 'btn', onClick: () => showGroupsTv(cls, name.value.trim() || '조 편성', d) }, '📺 크게 보기')),
    pool.length || st.pick ? box(-1, '조 없는 학생', pool, 'pool') : null,
    h('div', { class: 'group-grid' }, d.groups.map((g, gi) => box(gi, `${gi + 1}조`, g))),
    h('p', { class: 'muted small', style: { margin: '8px 0 0' } }, '학생을 눌러 고른 뒤 다른 조를 누르면 옮겨집니다. 끌어다 놓아도 됩니다.'));
}

function savedList(cls, byId) {
  const list = savedOf(cls);
  if (!list.length) return null;
  const st = stateOf(cls);
  return h('div', { class: 'card' },
    h('h3', {}, '저장한 조'),
    list.map((g) => h('div', { class: 'row saved-row' },
      h('strong', {}, g.name), h('span', { class: 'muted small' }, `${g.groups.length}개 조 · ${g.groups.reduce((n, x) => n + x.length, 0)}명`),
      h('span', { class: 'grow' }),
      h('button', { class: 'btn btn-sm', onClick: () => { st.draft = { groups: g.groups.map((x) => x.filter((id) => byId.has(id))) }; st.pick = null; refresh(cls); } }, '불러오기'),
      h('button', { class: 'btn btn-sm', onClick: () => showGroupsTv(cls, g.name, g) }, '📺'),
      h('button', {
        class: 'icon-btn danger', title: '지우기',
        onClick: async () => { if (await confirmDialog(`'${g.name}'을(를) 지울까요?`)) S.remove('groupings', { id: g.id }).catch(showError); },
      }, '✕'))));
}

export function showGroupsTv(cls, title, g) {
  tvOverlay(`${S.classLabel(cls)} · ${title}`, (body) => {
    body.append(h('div', { class: 'tv-groups' }, g.groups.map((ids, gi) => h('div', { class: 'tv-group' },
      h('div', { class: 'tv-group-title' }, `${gi + 1}조`),
      ids.map((id) => {
        const s = S.studentById(id);
        return s ? h('div', { class: 'tv-member' }, s.name) : null;
      })))));
  });
}
