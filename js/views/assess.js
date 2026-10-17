// 수행평가: 평가 만들기(학기 · 과목 · 학년), 반별 날짜, 점수 입력, 엑셀 내려받기
import { h, append, toast, showError, modal, confirmDialog, todayStr, fmtMD, classChip } from '../ui.js';
import * as S from '../store.js';
import { downloadXlsx } from '../xlsx.js';
import { go } from '../app.js';

const view = { term: null, subject: '', openId: '', classId: '' };

// 평가 대상 반: 그 학년도 · 과목 · 학년의 반
const targetClasses = (a) => S.classesOfYear(a.year).filter((c) => c.subject === a.subject && c.grade === a.grade);

function knownTerms() {
  const map = new Map();
  const add = (t) => map.set(`${t.year}-${t.semester}`, t);
  add(S.termOf(todayStr()));
  S.data.assessments.forEach((a) => add({ year: a.year, semester: a.semester }));
  return [...map.values()].sort((a, b) => b.year - a.year || b.semester - a.semester);
}

// ---- 수행평가 메뉴 ----
export default function render(root) {
  const terms = knownTerms();
  if (!view.term || !terms.some((t) => S.sameTerm(t, view.term))) view.term = terms[0];
  const term = view.term;
  const subjects = S.subjectsOfYear(term.year);
  if (!subjects.includes(view.subject)) view.subject = subjects[0] || '';
  const rerender = () => { root.replaceChildren(); render(root); };
  const open = S.data.assessments.find((a) => a.id === view.openId);

  const termSel = h('select', {
    value: `${term.year}-${term.semester}`,
    onChange: (e) => { const [y, s] = e.target.value.split('-').map(Number); view.term = { year: y, semester: s }; view.openId = ''; rerender(); },
  }, terms.map((t) => h('option', { value: `${t.year}-${t.semester}` }, S.termLabel(t))));
  const subjectTabs = subjects.length > 1
    ? h('div', { class: 'seg' }, subjects.map((sj) => h('button', { class: sj === view.subject ? 'active' : '', onClick: () => { view.subject = sj; view.openId = ''; rerender(); } }, sj)))
    : null;

  if (open) {
    append(root,
      h('div', { class: 'page-head' },
        h('h2', {}, open.title), h('span', { class: 'muted small' }, `${S.termLabel(open)} · ${open.subject} · ${open.grade}학년 · 만점 ${open.max_score}`),
        h('button', { class: 'btn', onClick: () => { view.openId = ''; rerender(); } }, '← 목록'),
        h('button', { class: 'btn', onClick: () => assessmentDialog(open) }, '수정'),
        h('button', { class: 'btn', onClick: () => exportScores(open, targetClasses(open)) }, '전체 반 엑셀')),
      scoreBoard(open));
    return;
  }

  const list = S.data.assessments.filter((a) => S.sameTerm(a, term) && a.subject === view.subject)
    .sort((a, b) => a.grade - b.grade || a.created_at.localeCompare(b.created_at));
  append(root,
    h('div', { class: 'page-head' },
      h('h2', {}, '수행평가'), termSel, subjectTabs,
      view.subject ? h('button', { class: 'btn btn-primary', onClick: () => assessmentDialog(null, { term, subject: view.subject }) }, '+ 새 수행평가') : null),
    !view.subject
      ? h('div', { class: 'empty' }, `${term.year}학년도 담당 반이 없습니다. '설정 → 시간표 · 반'에서 먼저 반을 추가하세요.`)
      : list.length
        ? list.map((a) => assessmentCard(a, () => { view.openId = a.id; view.classId = ''; rerender(); }))
        : h('div', { class: 'empty' }, '아직 수행평가가 없습니다. 오른쪽 위 \'+ 새 수행평가\'로 만드세요.'),
    h('p', { class: 'muted small' }, '나이스 일괄 입력용 엑셀은 나이스 양식 견본을 받은 뒤 그 양식 그대로 채워 주도록 바꿀 예정입니다. 지금은 학년 · 반 · 번호 · 이름 · 점수 엑셀을 내려받습니다.'));
}

function progressOf(a, classes) {
  let total = 0;
  let done = 0;
  for (const c of classes) {
    for (const st of S.studentsOf(c)) {
      total++;
      if (S.scoreOf(a.id, st.id)?.score != null) done++;
    }
  }
  return { total, done };
}

function assessmentCard(a, onOpen) {
  const classes = targetClasses(a);
  const { total, done } = progressOf(a, classes);
  return h('div', { class: 'card clickable assess-card', onClick: onOpen },
    h('div', { class: 'row' },
      h('h3', { style: { margin: 0 } }, a.title),
      h('span', { class: 'muted small' }, `${a.grade}학년 · 만점 ${a.max_score}`),
      h('span', { class: 'grow' }),
      h('span', { class: `badge ${total && done === total ? 'badge-ok' : ''}` }, `점수 ${done} / ${total}`)),
    h('div', { class: 'row small', style: { marginTop: '8px' } }, classes.map((c) => h('span', { class: 'date-chip' },
      S.classLabel(c), ' ', a.dates?.[c.id] ? h('strong', {}, fmtMD(a.dates[c.id])) : h('span', { class: 'muted' }, '날짜 미정')))),
    a.note ? h('p', { class: 'muted small', style: { margin: '6px 0 0' } }, a.note) : null);
}

// 반을 고르는 탭 + 점수 표
function scoreBoard(a) {
  const classes = targetClasses(a);
  if (!classes.length) return h('div', { class: 'empty' }, '이 평가를 볼 반이 없습니다.');
  if (!classes.some((c) => c.id === view.classId)) view.classId = classes[0].id;
  const cls = S.classById(view.classId);
  return h('div', {},
    h('div', { class: 'tabs' }, classes.map((c) => {
      const p = progressOf(a, [c]);
      return h('button', { class: `tab ${c === cls ? 'active' : ''}`, onClick: () => { view.classId = c.id; go('assess'); } },
        `${S.classLabel(c)} `, h('span', { class: 'small' }, `${p.done}/${p.total}`));
    })),
    scoreTable(a, cls));
}

export function scoreTable(a, cls) {
  const students = S.studentsOf(cls);
  if (!students.length) {
    return h('div', { class: 'empty' }, `${S.classLabel(cls)} 학생 명단이 없습니다. `, h('a', { href: `#/class/${cls.id}/students` }, '학생 탭에서 넣기'));
  }
  const date = h('input', {
    type: 'date', value: a.dates?.[cls.id] || '',
    onChange: (e) => S.update('assessments', a.id, { dates: { ...(a.dates || {}), [cls.id]: e.target.value || null } }).catch(showError),
  });
  const scores = students.map((st) => S.scoreOf(a.id, st.id)?.score).filter((v) => v != null);
  const avg = scores.length ? (scores.reduce((x, y) => x + y, 0) / scores.length).toFixed(1) : '-';

  const commit = async (input, st) => {
    const raw = input.value.trim();
    const cur = S.scoreOf(a.id, st.id);
    if (raw === '') { if (cur) await S.remove('scores', { assessment_id: a.id, student_id: st.id }); return; }
    const v = Number(raw);
    if (Number.isNaN(v) || v < 0 || v > a.max_score) {
      toast(`0 ~ ${a.max_score} 사이 숫자를 입력하세요.`, 'error');
      input.value = cur?.score ?? '';
      return;
    }
    if (cur?.score !== v) await S.upsert('scores', { assessment_id: a.id, student_id: st.id, score: v }, 'assessment_id,student_id');
  };
  const inputs = [];
  const rows = students.map((st, i) => {
    const cur = S.scoreOf(a.id, st.id);
    const input = h('input', {
      type: 'number', min: 0, max: a.max_score, step: 'any', value: cur?.score ?? '', class: 'score-input', 'data-fk': `score-${a.id}-${st.id}`,
      onChange: () => commit(input, st).catch(showError),
      // Enter · ↓ 는 다음 학생, ↑ 는 앞 학생
      onKeydown: (e) => {
        const step = e.key === 'Enter' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
        if (!step) return;
        e.preventDefault();
        const next = inputs[i + step];
        if (next) { next.focus(); next.select(); } else input.blur();
      },
    });
    inputs.push(input);
    return h('tr', {},
      h('td', { class: 'center' }, st.number), h('td', {}, st.name),
      h('td', {}, input, h('span', { class: 'muted small' }, ` / ${a.max_score}`)));
  });
  return h('div', { class: 'card' },
    h('div', { class: 'row', style: { marginBottom: '10px' } },
      classChip(cls, S.classLabel(cls)),
      h('label', { class: 'inline small' }, '평가일', date),
      h('span', { class: 'muted small' }, `입력 ${scores.length}/${students.length}명 · 평균 ${avg}`),
      h('span', { class: 'grow' }),
      h('button', { class: 'btn btn-sm', onClick: () => exportScores(a, [cls]) }, '이 반 엑셀')),
    h('table', { class: 'table score-table' },
      h('thead', {}, h('tr', {}, h('th', { style: { width: '60px' } }, '번호'), h('th', {}, '이름'), h('th', {}, '점수'))),
      h('tbody', {}, rows)),
    h('p', { class: 'muted small', style: { margin: '8px 0 0' } }, 'Enter 또는 ↓ 를 누르면 다음 학생으로 넘어갑니다. 칸을 비우면 점수가 지워집니다.'));
}

async function exportScores(a, classes) {
  const rows = [['학년', '반', '번호', '이름', '점수']];
  for (const c of classes) {
    for (const st of S.studentsOf(c)) rows.push([c.grade, c.room, st.number, st.name, S.scoreOf(a.id, st.id)?.score ?? '']);
  }
  const who = classes.length === 1 ? S.classLabel(classes[0]) : `${a.grade}학년 전체`;
  try { await downloadXlsx(`${a.title}-${who}.xlsx`, rows, '점수'); } catch (err) { showError(err); }
}

// 수행평가 만들기 · 고치기
export function assessmentDialog(a, { term, subject } = {}) {
  term = a ? { year: a.year, semester: a.semester } : term;
  subject = a ? a.subject : subject;
  const grades = [...new Set(S.classesOfYear(term.year).filter((c) => c.subject === subject && c.grade).map((c) => c.grade))].sort();
  if (!grades.length) { toast(`${subject} 반의 학년이 정해지지 않았습니다.`, 'error'); return; }
  const title = h('input', { type: 'text', value: a?.title || '', placeholder: '예: 갈등 해결 글쓰기' });
  const max = h('input', { type: 'number', min: 1, value: a?.max_score ?? 100, style: { width: '100px' } });
  const grade = h('select', { value: String(a?.grade || grades[0]), disabled: !!a, onChange: () => drawDates() }, grades.map((g) => h('option', { value: String(g) }, `${g}학년`)));
  const note = h('input', { type: 'text', value: a?.note || '', placeholder: '메모 (예: 채점 기준표는 자료실에)' });
  const dates = { ...(a?.dates || {}) };
  const dateBox = h('div', { class: 'date-grid' });
  const drawDates = () => {
    const classes = S.classesOfYear(term.year).filter((c) => c.subject === subject && c.grade === Number(grade.value));
    dateBox.replaceChildren(...classes.map((c) => h('label', {}, S.classLabel(c),
      h('input', { type: 'date', value: dates[c.id] || '', onChange: (e) => { dates[c.id] = e.target.value || null; } }))));
  };
  drawDates();
  modal(a ? '수행평가 고치기' : `${S.termLabel(term)} ${subject} 새 수행평가`, [
    h('label', {}, '평가 이름', title),
    h('div', { class: 'row' }, h('label', {}, '학년', grade), h('label', {}, '만점', max)),
    h('div', { class: 'section-title', style: { margin: '4px 0 0' } }, '반별 평가일 (모르면 비워 두세요 · 일정과 캘린더에 나옵니다)'),
    dateBox,
    h('label', {}, '메모', note),
  ], [
    a ? {
      label: '삭제', danger: true,
      onClick: async () => {
        if (!await confirmDialog(`'${a.title}'과(와) 입력한 점수를 모두 지울까요?`)) return false;
        await S.remove('assessments', { id: a.id });
        view.openId = '';
      },
    } : null,
    { label: '취소' },
    {
      label: '저장', primary: true,
      onClick: async () => {
        const t = title.value.trim();
        const m = Number(max.value);
        if (!t || !(m > 0)) { toast('평가 이름과 만점을 입력하세요.', 'error'); return false; }
        const row = { title: t, max_score: m, dates, note: note.value.trim() };
        if (a) await S.update('assessments', a.id, row);
        else await S.insert('assessments', { ...row, year: term.year, semester: term.semester, subject, grade: Number(grade.value) });
      },
    },
  ].filter(Boolean), { wide: true });
  title.focus();
}

// ---- 반 화면의 '수행평가' 탭: 이 반이 보는 평가마다 점수 표 ----
export function renderClassAssess(root, cls) {
  const term = S.termOf(todayStr());
  const list = cls.grade ? S.assessmentsOf(cls, term) : [];
  append(root,
    h('div', { class: 'row', style: { marginBottom: '12px' } },
      h('strong', {}, `${S.termLabel(term)} ${cls.subject} 수행평가 ${list.length}개`),
      h('span', { class: 'grow' }),
      cls.grade ? h('button', { class: 'btn btn-primary', onClick: () => assessmentDialog(null, { term, subject: cls.subject }) }, '+ 새 수행평가') : null),
    list.length
      ? list.map((a) => h('div', { class: 'assess-block' },
        h('div', { class: 'row' }, h('h3', { style: { margin: '0 0 8px' } }, a.title), h('span', { class: 'muted small' }, `만점 ${a.max_score}`),
          h('span', { class: 'grow' }), h('button', { class: 'btn btn-sm', onClick: () => assessmentDialog(a) }, '수정')),
        scoreTable(a, cls)))
      : h('div', { class: 'empty' }, '이번 학기 수행평가가 없습니다.'));
}
