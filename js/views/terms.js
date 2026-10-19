// 설정 → 학년도 · 학기: 학기 목록, 2학기 시작일, 단원 관리(여러 개 한 번에 · 순서 · 다른 학기에서 복사)
import { h, append, toast, showError, confirmDialog, todayStr } from '../ui.js';
import * as S from '../store.js';
import { go } from '../app.js';
import { newUnitDialog } from './materials.js';

const state = { subject: '', from: '' };
const refresh = () => go('settings/terms');

export default function render(root) {
  const term = S.viewTerm();
  const subjects = subjectsOf(term);
  if (!subjects.includes(state.subject)) state.subject = subjects[0] || '';
  append(root, h('div', { class: 'cols' },
    h('div', {}, unitsCard(term), copyCard(term)),
    h('div', {}, termsCard(term), sem2Card(), newYearCard())));
}

// 그 학기에 쓰는 과목: 그 학년도 반 + 그 학기 단원
function subjectsOf(term) {
  const set = new Set(S.subjectsOfYear(term.year));
  S.data.units.filter((u) => S.sameTerm(u, term) && u.subject).forEach((u) => set.add(u.subject));
  return [...set].sort((a, b) => a.localeCompare(b, 'ko'));
}

function subjectTabs(term) {
  const subjects = subjectsOf(term);
  if (subjects.length < 2) return null;
  return h('div', { class: 'seg' }, subjects.map((sj) => h('button', { class: sj === state.subject ? 'active' : '', onClick: () => { state.subject = sj; refresh(); } }, sj)));
}

// 정렬 번호를 10, 20, 30 … 으로 다시 매긴다
async function renumber(list) {
  for (let i = 0; i < list.length; i++) {
    const want = (i + 1) * 10;
    if (list[i].sort !== want) await S.update('units', list[i].id, { sort: want });
  }
}

function unitsCard(term) {
  const subject = state.subject || null;
  const units = S.unitsOf(term, subject);
  const move = async (i, k) => {
    const list = [...units];
    [list[i], list[i + k]] = [list[i + k], list[i]];
    try { await renumber(list); } catch (err) { showError(err); }
  };
  const ta = h('textarea', { rows: 6, placeholder: '한 줄에 단원 하나씩 (교과서 목차를 붙여 넣어도 됩니다)\n1. 문학의 즐거움\n2. 설득하는 글 쓰기\n3. …' });
  const addMany = async () => {
    const names = ta.value.split(/\r?\n/).map((v) => v.trim()).filter(Boolean);
    if (!names.length) return toast('단원 이름을 입력하세요.');
    const have = new Set(units.map((u) => u.name));
    const fresh = [...new Set(names)].filter((n) => !have.has(n));
    if (!fresh.length) return toast('모두 이미 있는 단원입니다.');
    try {
      for (const n of fresh) await S.addUnit(term, subject, n);
      ta.value = '';
      toast(`단원 ${fresh.length}개를 만들었습니다.`, 'ok');
    } catch (err) { showError(err); }
  };
  return h('div', { class: 'card' },
    h('div', { class: 'row', style: { marginBottom: '10px' } },
      h('h3', { style: { margin: 0 } }, `${S.termLabel(term)}${subject ? ` ${subject}` : ''} 단원`),
      h('span', { class: 'muted small' }, `${units.length}개`),
      h('span', { class: 'grow' }), subjectTabs(term)),
    units.length
      ? units.map((u, i) => h('div', { class: 'row unit-row' },
        h('span', { class: 'muted small', style: { width: '22px' } }, i + 1),
        h('input', {
          type: 'text', value: u.name, class: 'grow', 'data-fk': `unit-${u.id}`,
          onChange: (e) => { const n = e.target.value.trim(); if (n && n !== u.name) S.renameUnit(u, n).catch(showError); },
        }),
        h('button', { class: 'icon-btn', title: '위로', disabled: i === 0, onClick: () => move(i, -1) }, '↑'),
        h('button', { class: 'icon-btn', title: '아래로', disabled: i === units.length - 1, onClick: () => move(i, 1) }, '↓'),
        h('button', {
          class: 'icon-btn danger', title: '단원 지우기',
          onClick: async () => {
            if (await confirmDialog(`'${u.name}' 단원을 지울까요?\n이 단원의 기록과 자료는 지워지지 않고 '단원 없음'으로 옮겨집니다.`, { okLabel: '단원 지우기' })) S.remove('units', { id: u.id }).catch(showError);
          },
        }, '✕')))
      : h('p', { class: 'muted small' }, '아직 단원이 없습니다. 아래에 붙여 넣거나, 오른쪽 아래에서 다른 학기 단원을 복사하세요.'),
    h('div', { class: 'section-title', style: { margin: '14px 0 6px' } }, '여러 단원 한 번에 만들기'),
    ta,
    h('div', { class: 'row', style: { marginTop: '8px' } },
      h('button', { class: 'btn btn-primary', onClick: addMany }, '단원 만들기'),
      h('button', { class: 'btn', onClick: () => newUnitDialog(term, subject) }, '+ 하나만 만들기'),
      h('span', { class: 'muted small' }, '이름을 고치면 드라이브 폴더 이름도 바뀝니다.')));
}

// 다른 학기에서 단원 이름 복사 (기본: 작년 같은 학기)
function copyCard(term) {
  const subject = state.subject || null;
  const sources = S.allTerms().filter((t) => !S.sameTerm(t, term) && S.unitsOf(t, subject).length);
  if (!sources.length) {
    return h('div', { class: 'card' }, h('h3', {}, '다른 학기 단원 복사'), h('p', { class: 'muted small', style: { margin: 0 } }, '복사해 올 단원이 있는 다른 학기가 아직 없습니다. 내년부터 작년 단원을 그대로 가져올 수 있습니다.'));
  }
  const lastYear = sources.find((t) => t.year === term.year - 1 && t.semester === term.semester);
  if (!sources.some((t) => S.termKey(t) === state.from)) state.from = S.termKey(lastYear || sources[0]);
  const from = S.parseTermKey(state.from);
  const list = S.unitsOf(from, subject);
  const have = new Set(S.unitsOf(term, subject).map((u) => u.name));
  const todo = list.filter((u) => !have.has(u.name));
  const copy = async () => {
    try {
      for (const u of todo) await S.addUnit(term, subject, u.name);
      toast(`단원 ${todo.length}개를 복사했습니다.`, 'ok');
    } catch (err) { showError(err); }
  };
  return h('div', { class: 'card' },
    h('h3', {}, '다른 학기 단원 복사'),
    h('div', { class: 'row' },
      h('select', { value: state.from, onChange: (e) => { state.from = e.target.value; refresh(); } },
        sources.map((t) => h('option', { value: S.termKey(t) }, `${S.termLabel(t)}${lastYear && S.sameTerm(t, lastYear) ? ' (작년 같은 학기)' : ''}`))),
      h('span', { class: 'muted small' }, `→ ${S.termLabel(term)}${subject ? ` ${subject}` : ''}`)),
    h('div', { class: 'copy-preview' }, list.map((u) => h('div', { class: `small ${have.has(u.name) ? 'muted' : ''}` }, have.has(u.name) ? `✓ ${u.name} (이미 있음)` : `+ ${u.name}`))),
    h('button', { class: 'btn btn-primary', disabled: !todo.length, onClick: copy }, todo.length ? `단원 ${todo.length}개 복사하기` : '모두 이미 있습니다'),
    h('p', { class: 'muted small', style: { margin: '8px 0 0' } }, '단원 이름만 복사합니다. 작년 자료는 수업 자료 화면의 각 단원에서 "작년 이 단원 자료"로 볼 수 있습니다.'));
}

function termsCard(term) {
  const cur = S.termOf(todayStr());
  const count = (t) => ({
    classes: S.classesOfYear(t.year).length,
    slots: S.slotsOf(t).filter((x) => x.year != null).length,
    units: S.unitsOf(t).length,
    lessons: S.data.lessons.filter((l) => S.sameTerm(S.termOf(l.date), t)).length,
  });
  return h('div', { class: 'card' },
    h('h3', {}, '학기 목록'),
    h('p', { class: 'muted small', style: { marginTop: 0 } }, '엑셀 시트처럼 학기마다 따로 봅니다. 왼쪽 위에서 고르거나 아래 "보기"를 누르세요.'),
    S.allTerms().map((t) => {
      const c = count(t);
      const on = S.sameTerm(t, term);
      return h('div', { class: `term-row ${on ? 'on' : ''}` },
        h('div', { class: 'grow' },
          h('div', {}, h('strong', {}, S.termLabel(t)), S.sameTerm(t, cur) ? h('span', { class: 'badge badge-info', style: { marginLeft: '6px' } }, '지금') : null),
          h('div', { class: 'muted small' }, `반 ${c.classes} · 시간표 ${c.slots}칸 · 단원 ${c.units} · 기록 ${c.lessons}`)),
        on ? h('span', { class: 'muted small nowrap' }, '보는 중') : h('button', { class: 'btn btn-sm', onClick: () => S.setViewTerm(t) }, '보기'));
    }));
}

function sem2Card() {
  const st = S.settings();
  const year = new Date().getFullYear();
  const sem2 = h('input', {
    type: 'date', value: `${year}-${st.sem2_start}`,
    onChange: (e) => e.target.value && S.upsert('settings', { sem2_start: e.target.value.slice(5) }, 'user_id').then(() => toast('저장했습니다.', 'ok'), showError),
  });
  return h('div', { class: 'card' },
    h('h3', {}, '학기 나누는 날'),
    h('div', { class: 'row' }, h('label', {}, '2학기 시작일', sem2)),
    h('p', { class: 'muted small', style: { marginBottom: 0 } }, '학년도는 3월 1일에 시작합니다. 기록과 자료는 날짜에 따라 학기별로 정리됩니다(1~2월은 앞 학년도 2학기).'));
}

function newYearCard() {
  const next = S.nextTerm(S.termOf(todayStr()));
  return h('div', { class: 'card' },
    h('h3', {}, '다음 학기 · 새 학년도 준비'),
    h('ol', { class: 'small', style: { margin: 0, paddingLeft: '18px' } },
      h('li', {}, `왼쪽 위에서 ${S.termLabel(next)}를 고릅니다(또는 `, h('a', { href: '#/settings/terms', onClick: (e) => { e.preventDefault(); S.setViewTerm(next); } }, '바로 가기'), ').'),
      h('li', {}, "새 학년도라면 '시간표 · 반' 탭에서 반을 만듭니다. 지난 반은 지우지 마세요."),
      h('li', {}, "'시간표 · 반' 탭에서 시간표를 칠하거나 지난 학기 시간표를 가져옵니다."),
      h('li', {}, '이 탭에서 단원을 만들거나 작년 단원을 복사합니다.')));
}
