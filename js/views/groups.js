// 조 편성: 조건(붙이기 · 떼어 놓기 · 성별 · 수준 · 지난 조와 덜 겹치기 · 결석)을 반영해 자동으로 짜고, 끌어다 옮기고, 저장 · TV 로 보기
import { h, append, toast, showError, confirmDialog, todayStr, fmtMD, tvOverlay } from '../ui.js';
import * as S from '../store.js';
import { go } from '../app.js';

const LEADER = { none: '안 정함', random: '무작위', level: '수준 높은 학생' };
// 반마다 화면 상태 (저장 전 결과 · 옵션)
const states = new Map();
function stateOf(cls) {
  if (!states.has(cls.id)) {
    states.set(cls.id, {
      mode: 'count', count: 4, size: 4, gender: true, level: true, repeat: true, leader: 'none',
      absent: new Set(), draft: null, warnings: [], ruleA: '', ruleB: '', ruleType: 'apart',
    });
  }
  return states.get(cls.id);
}
const refresh = (cls) => go(`class/${cls.id}/groups`);

const roomKey = (cls) => ({ year: S.classYear(cls), grade: cls.grade, room: cls.room });
const rulesOf = (cls) => S.data.group_rules.filter((r) => r.year === S.classYear(cls) && r.grade === cls.grade && r.room === cls.room);
const savedOf = (cls) => S.data.groupings.filter((g) => g.class_id === cls.id).sort((a, b) => b.created_at.localeCompare(a.created_at));

// ---- 편성 알고리즘 ----
const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};

export function makeGroups(students, opt, rules, history) {
  const n = students.length;
  if (!n) return { groups: [], leaders: {}, warnings: [] };
  const k = Math.max(1, Math.min(n, opt.mode === 'count' ? opt.count : Math.ceil(n / Math.max(1, opt.size))));
  const ids = students.map((s) => s.id);
  const byId = new Map(students.map((s) => [s.id, s]));
  const present = new Set(ids);
  const together = rules.filter((r) => r.type === 'together' && present.has(r.a) && present.has(r.b));
  const apart = rules.filter((r) => r.type === 'apart' && present.has(r.a) && present.has(r.b));
  // 지난 조에서 함께였던 짝 (최근 3번)
  const pastPairs = new Map();
  for (const g of history.slice(0, 3)) {
    for (const grp of g.groups) for (const a of grp) for (const b of grp) if (a < b) pastPairs.set(`${a}|${b}`, (pastPairs.get(`${a}|${b}`) || 0) + 1);
  }
  const males = students.filter((s) => s.gender === 'M').length;
  const leveled = students.filter((s) => s.level);
  const avgLevel = leveled.length ? leveled.reduce((x, s) => x + Number(s.level), 0) / leveled.length : 0;
  const base = Math.floor(n / k);
  const extra = n % k;

  const cost = (where) => {
    const groups = Array.from({ length: k }, () => []);
    ids.forEach((id) => groups[where.get(id)].push(id));
    let c = 0;
    for (const r of apart) if (where.get(r.a) === where.get(r.b)) c += 1000;
    for (const r of together) if (where.get(r.a) !== where.get(r.b)) c += 1000;
    // 조 크기: 큰 조가 extra 개, 나머지는 base 명
    const sizes = groups.map((g) => g.length).sort((a, b) => b - a);
    sizes.forEach((sz, i) => { c += Math.abs(sz - (i < extra ? base + 1 : base)) * 300; });
    for (const g of groups) {
      if (opt.gender) {
        const m = g.filter((id) => byId.get(id).gender === 'M').length;
        c += Math.abs(m - (g.length * males) / n) * 12;
      }
      if (opt.level && leveled.length) {
        const lv = g.map((id) => Number(byId.get(id).level)).filter(Boolean);
        if (lv.length) c += Math.abs(lv.reduce((x, y) => x + y, 0) / lv.length - avgLevel) * 15;
      }
      if (opt.repeat) for (const a of g) for (const b of g) if (a < b) c += (pastPairs.get(`${a}|${b}`) || 0) * 6;
    }
    return c;
  };

  let best = null;
  let bestCost = Infinity;
  for (let round = 0; round < 6; round++) {
    const where = new Map();
    shuffle(ids).forEach((id, i) => where.set(id, i % k));
    let cur = cost(where);
    for (let it = 0; it < 2500; it++) {
      const a = ids[Math.floor(Math.random() * n)];
      if (Math.random() < 0.7) {
        // 두 학생 자리 바꾸기
        const b = ids[Math.floor(Math.random() * n)];
        if (where.get(a) === where.get(b)) continue;
        const ga = where.get(a);
        where.set(a, where.get(b)); where.set(b, ga);
        const next = cost(where);
        if (next <= cur) cur = next; else { where.set(b, where.get(a)); where.set(a, ga); }
      } else {
        // 한 학생을 다른 조로 옮기기
        const from = where.get(a);
        const to = Math.floor(Math.random() * k);
        if (to === from) continue;
        where.set(a, to);
        const next = cost(where);
        if (next <= cur) cur = next; else where.set(a, from);
      }
    }
    if (cur < bestCost) { bestCost = cur; best = new Map(where); }
  }

  const groups = Array.from({ length: k }, () => []);
  shuffle(ids).forEach((id) => groups[best.get(id)].push(id));
  groups.forEach((g) => g.sort((a, b) => byId.get(a).number - byId.get(b).number));
  const leaders = {};
  groups.forEach((g, i) => {
    if (!g.length || opt.leader === 'none') return;
    const pool = opt.leader === 'level' ? (() => { const top = Math.max(...g.map((id) => Number(byId.get(id).level) || 0)); return g.filter((id) => (Number(byId.get(id).level) || 0) === top); })() : g;
    leaders[i] = pool[Math.floor(Math.random() * pool.length)];
  });
  const warnings = [];
  const label = (id) => byId.get(id)?.name;
  for (const r of apart) if (best.get(r.a) === best.get(r.b)) warnings.push(`${label(r.a)} · ${label(r.b)} 떼어 놓기를 지키지 못했습니다.`);
  for (const r of together) if (best.get(r.a) !== best.get(r.b)) warnings.push(`${label(r.a)} · ${label(r.b)} 붙이기를 지키지 못했습니다(조 인원이 모자랍니다).`);
  return { groups, leaders, warnings };
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

  const run = () => {
    const present = students.filter((s) => !st.absent.has(s.id));
    if (!present.length) return toast('참여하는 학생이 없습니다.', 'error');
    const r = makeGroups(present, st, rulesOf(cls), savedOf(cls));
    st.draft = { groups: r.groups, leaders: r.leaders };
    st.warnings = r.warnings;
    refresh(cls);
  };

  append(root, h('div', { class: 'cols groups-cols' },
    h('div', {}, st.draft ? resultView(cls, st, byId) : h('div', { class: 'empty' }, "오른쪽에서 조건을 고르고 '조 짜기'를 누르세요."), savedList(cls, byId)),
    h('div', {}, optionsCard(cls, st, students, run), rulesCard(cls, st, students))));
}

function optionsCard(cls, st, students, run) {
  const set = (patch) => { Object.assign(st, patch); refresh(cls); };
  const numInput = (key) => h('input', { type: 'number', min: 1, max: 20, value: st[key], style: { width: '70px' }, onChange: (e) => { st[key] = Math.max(1, Number(e.target.value) || 1); } });
  const check = (key, label) => h('label', { class: 'inline' }, h('input', { type: 'checkbox', checked: st[key], onChange: (e) => { st[key] = e.target.checked; } }), label);
  return h('div', { class: 'card' },
    h('h3', {}, '조건'),
    h('div', { class: 'row' },
      h('div', { class: 'seg' },
        h('button', { class: st.mode === 'count' ? 'active' : '', onClick: () => set({ mode: 'count' }) }, '조 수로'),
        h('button', { class: st.mode === 'size' ? 'active' : '', onClick: () => set({ mode: 'size' }) }, '조 인원으로')),
      st.mode === 'count' ? [numInput('count'), h('span', { class: 'small' }, '개 조')] : [numInput('size'), h('span', { class: 'small' }, '명씩')]),
    h('div', { class: 'opt-list' },
      check('gender', '성별 고르게'),
      check('level', '수준 고르게'),
      check('repeat', '지난 조와 덜 겹치게 (최근 3번)'),
      h('label', { class: 'inline' }, '조장',
        h('select', { value: st.leader, onChange: (e) => { st.leader = e.target.value; } }, Object.entries(LEADER).map(([k, v]) => h('option', { value: k }, v))))),
    h('div', { class: 'section-title', style: { margin: '12px 0 6px' } }, `오늘 빠지는 학생 (${st.absent.size}명)`),
    h('div', { class: 'row absent-list' }, students.map((s) => h('button', {
      class: `pick-chip ${st.absent.has(s.id) ? 'off' : ''}`,
      onClick: () => { if (st.absent.has(s.id)) st.absent.delete(s.id); else st.absent.add(s.id); refresh(cls); },
    }, `${s.number} ${s.name}`))),
    h('button', { class: 'btn btn-primary btn-block', style: { marginTop: '12px' }, onClick: run }, st.draft ? '다시 짜기' : '조 짜기'),
    h('p', { class: 'muted small', style: { margin: '8px 0 0' } }, '성별 · 수준은 학생 탭에서 넣습니다. 비어 있는 학생은 따지지 않습니다.'));
}

function rulesCard(cls, st, students) {
  const rules = rulesOf(cls);
  const name = (id) => S.studentById(id)?.name || '?';
  const sel = (key) => h('select', { value: st[key], onChange: (e) => { st[key] = e.target.value; } },
    h('option', { value: '' }, '학생'), students.map((s) => h('option', { value: s.id }, `${s.number} ${s.name}`)));
  const add = async () => {
    if (!st.ruleA || !st.ruleB || st.ruleA === st.ruleB) return toast('서로 다른 두 학생을 고르세요.', 'error');
    const [a, b] = [st.ruleA, st.ruleB].sort();
    const old = rules.find((r) => r.a === a && r.b === b);
    try {
      if (old) await S.update('group_rules', old.id, { type: st.ruleType });
      else await S.insert('group_rules', { ...roomKey(cls), a, b, type: st.ruleType });
      st.ruleA = ''; st.ruleB = '';
    } catch (err) { showError(err); }
  };
  return h('div', { class: 'card' },
    h('h3', {}, '짝 규칙'),
    rules.length
      ? rules.map((r) => h('div', { class: 'row rule-row' },
        h('span', { class: `badge ${r.type === 'together' ? 'badge-ok' : 'badge-warn'}` }, r.type === 'together' ? '붙이기' : '떼어 놓기'),
        h('span', { class: 'grow' }, `${name(r.a)} · ${name(r.b)}`),
        h('button', { class: 'icon-btn danger', title: '규칙 지우기', onClick: () => S.remove('group_rules', { id: r.id }).catch(showError) }, '✕')))
      : h('p', { class: 'muted small' }, '규칙이 없습니다.'),
    h('div', { class: 'row', style: { marginTop: '8px' } }, sel('ruleA'), sel('ruleB')),
    h('div', { class: 'row', style: { marginTop: '6px' } },
      h('div', { class: 'seg' },
        h('button', { class: st.ruleType === 'apart' ? 'active' : '', onClick: () => { st.ruleType = 'apart'; refresh(cls); } }, '떼어 놓기'),
        h('button', { class: st.ruleType === 'together' ? 'active' : '', onClick: () => { st.ruleType = 'together'; refresh(cls); } }, '붙이기')),
      h('button', { class: 'btn', onClick: add }, '규칙 추가')),
    h('p', { class: 'muted small', style: { margin: '8px 0 0' } }, '규칙은 같은 반의 다른 과목 수업에서도 함께 씁니다.'));
}

function groupStats(ids, byId) {
  const m = ids.filter((id) => byId.get(id)?.gender === 'M').length;
  const f = ids.filter((id) => byId.get(id)?.gender === 'F').length;
  const lv = ids.map((id) => Number(byId.get(id)?.level)).filter(Boolean);
  return [m || f ? `남${m} 여${f}` : '', lv.length ? `수준 ${(lv.reduce((x, y) => x + y, 0) / lv.length).toFixed(1)}` : ''].filter(Boolean).join(' · ');
}

function resultView(cls, st, byId) {
  const d = st.draft;
  let dragging = null;
  const move = (id, to) => {
    d.groups = d.groups.map((g) => g.filter((x) => x !== id));
    d.groups[to].push(id);
    d.groups[to].sort((a, b) => byId.get(a).number - byId.get(b).number);
    for (const [gi, lid] of Object.entries(d.leaders)) if (lid === id && Number(gi) !== to) delete d.leaders[gi];
    refresh(cls);
  };
  const name = h('input', { type: 'text', value: `${fmtMD(todayStr())} 조`, style: { width: '160px' } });
  const save = async () => {
    try {
      await S.insert('groupings', { class_id: cls.id, name: name.value.trim() || `${fmtMD(todayStr())} 조`, date: todayStr(), groups: d.groups, leaders: d.leaders });
      toast('조 편성을 저장했습니다.', 'ok');
    } catch (err) { showError(err); }
  };
  return h('div', { class: 'card' },
    h('div', { class: 'row', style: { marginBottom: '10px' } },
      h('h3', { style: { margin: 0 } }, `결과 · ${d.groups.length}개 조`),
      h('span', { class: 'grow' }),
      name,
      h('button', { class: 'btn btn-primary', onClick: save }, '저장'),
      h('button', { class: 'btn', onClick: () => showGroupsTv(cls, name.value.trim() || '조 편성', d) }, '📺 크게 보기')),
    st.warnings.length ? h('div', { class: 'banner' }, st.warnings.map((w) => h('div', {}, w))) : null,
    h('div', { class: 'group-grid' }, d.groups.map((g, gi) => h('div', {
      class: 'group-card',
      onDragover: (e) => { e.preventDefault(); e.currentTarget.classList.add('over'); },
      onDragleave: (e) => e.currentTarget.classList.remove('over'),
      onDrop: (e) => { e.preventDefault(); if (dragging) move(dragging, gi); },
    },
    h('div', { class: 'row' }, h('strong', {}, `${gi + 1}조`), h('span', { class: 'muted small' }, `${g.length}명`), h('span', { class: 'grow' }), h('span', { class: 'muted small' }, groupStats(g, byId))),
    g.map((id) => {
      const s = byId.get(id);
      const leader = d.leaders[gi] === id;
      return h('div', {
        class: `member ${leader ? 'leader' : ''}`, draggable: 'true',
        onDragstart: () => { dragging = id; },
        title: '끌어서 다른 조로 옮기기 · 👑 를 누르면 조장',
      },
      h('span', { class: 'grow' }, `${s.number} ${s.name}`),
      h('button', { class: 'icon-btn crown', title: leader ? '조장 해제' : '조장으로', onClick: () => { if (leader) delete d.leaders[gi]; else d.leaders[gi] = id; refresh(cls); } }, leader ? '👑' : '♔'));
    })))),
    h('p', { class: 'muted small', style: { margin: '8px 0 0' } }, '학생을 끌어다 다른 조에 놓으면 옮겨집니다.'));
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
      h('button', { class: 'btn btn-sm', onClick: () => { st.draft = { groups: g.groups.map((x) => x.filter((id) => byId.has(id))), leaders: { ...g.leaders } }; st.warnings = []; refresh(cls); } }, '불러오기'),
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
        return s ? h('div', { class: `tv-member ${g.leaders?.[gi] === id ? 'leader' : ''}` }, g.leaders?.[gi] === id ? '👑 ' : '', s.name) : null;
      })))));
  });
}
