// 과세특(교과 세부능력 및 특기사항) 쓰기: 학생 한 명의 메모 · 수행평가 · 칭찬 스티커 · 조 활동 · 배운 단원을 모아 보고 옆에서 초안을 쓴다
import { h, append, toast, showError, fmtMD, todayStr } from '../ui.js';
import * as S from '../store.js';
import { go } from '../app.js';
import { studentDialog } from './students.js';
import { noteDate } from './records.js';
import { downloadXlsx } from '../xlsx.js';

const picked = new Map(); // 반 id → 보고 있는 학생 id
const opts = { allSubjects: false };
const drafts = new Map(); // 저장 전 초안 (학생 id|학년도|과목 → 글)

// 나이스 방식 바이트: 한글 등 3, 영문 · 숫자 · 공백 · 기호 1, 줄바꿈 2
export function neisBytes(text) {
  let n = 0;
  for (const ch of text.replace(/\r\n/g, '\n')) n += ch === '\n' ? 2 : ch.charCodeAt(0) > 127 ? 3 : 1;
  return n;
}
const charCount = (text) => [...text.replace(/\r\n/g, '\n')].length;

const seteukOf = (s, year, subject) => S.data.seteuk.find((x) => x.student_id === s.id && x.year === year && x.subject === subject);

// 이 학생의 자료 모으기 (이 반의 학년도 · 과목 기준)
function gather(s, cls) {
  const year = S.classYear(cls);
  const subject = cls.subject;
  const inYear = (d) => S.termOf(d).year === year;
  const notes = S.notesOfStudent(s.id).filter((n) => inYear(n.date) && (opts.allSubjects || !n.subject || n.subject === subject));
  const assessments = S.data.assessments.filter((a) => a.year === year && a.subject === subject && a.grade === cls.grade)
    .sort((a, b) => a.semester - b.semester || a.created_at.localeCompare(b.created_at));
  const stickers = S.data.stickers.filter((x) => x.class_id === cls.id && x.student_id === s.id && inYear(x.date))
    .sort((a, b) => b.date.localeCompare(a.date));
  const groups = S.data.groupings.filter((g) => g.class_id === cls.id && inYear(g.date))
    .map((g) => { const gi = g.groups.findIndex((ids) => ids.includes(s.id)); return gi < 0 ? null : { g, gi, leader: g.leaders?.[gi] === s.id }; })
    .filter(Boolean).sort((a, b) => b.g.date.localeCompare(a.g.date));
  return { year, subject, notes, assessments, stickers, groups };
}

// 학생 탭 등에서 이 학생의 종합 화면으로 바로 가기
export function showStudent(cls, s) {
  picked.set(cls.id, s.id);
  go(`class/${cls.id}/seteuk`);
}

export function renderSeteukTab(root, cls) {
  const students = S.studentsOf(cls);
  if (!students.length) {
    append(root, h('div', { class: 'empty' }, '학생 명단이 없습니다. ', h('a', { href: `#/class/${cls.id}/students` }, '학생 탭에서 먼저 넣으세요.')));
    return;
  }
  let sel = students.find((s) => s.id === picked.get(cls.id)) || students[0];
  picked.set(cls.id, sel.id);
  const year = S.classYear(cls);
  const pick = (s) => { picked.set(cls.id, s.id); go(`class/${cls.id}/seteuk`); };

  const list = h('div', { class: 'card seteuk-list' }, students.map((s) => {
    const d = gather(s, cls);
    const scored = d.assessments.filter((a) => S.scoreOf(a.id, s.id)?.score != null).length;
    const draft = seteukOf(s, year, cls.subject)?.text || '';
    return h('button', { class: `seteuk-student ${s === sel ? 'active' : ''}`, onClick: () => pick(s) },
      h('div', { class: 'row' }, h('strong', {}, `${s.number}. ${s.name}`), h('span', { class: 'grow' }),
        draft ? h('span', { class: 'badge badge-ok' }, `초안 ${charCount(draft)}자`) : null),
      h('div', { class: 'small muted' }, `메모 ${d.notes.length} · 점수 ${scored}/${d.assessments.length} · ⭐ ${d.stickers.reduce((n, x) => n + (x.n || 1), 0)}`));
  }));

  append(root,
    h('div', { class: 'row', style: { marginBottom: '12px' } },
      h('strong', {}, `${year}학년도 ${cls.subject} 과세특`),
      h('span', { class: 'muted small' }, '학생을 고르면 그 학생의 기록을 모아 보여 줍니다.'),
      h('span', { class: 'grow' }),
      h('button', { class: 'btn', onClick: () => exportDrafts(cls) }, '초안 모아 엑셀로')),
    h('div', { class: 'seteuk-cols' }, list, profile(sel, cls, students)));
}

function profile(s, cls, students) {
  const d = gather(s, cls);
  const i = students.indexOf(s);
  const move = (k) => { const t = students[i + k]; if (t) { picked.set(cls.id, t.id); go(`class/${cls.id}/seteuk`); } };
  return h('div', { class: 'seteuk-main' },
    h('div', { class: 'card' },
      h('div', { class: 'row' },
        h('h2', { style: { margin: 0 } }, `${s.number}. ${s.name}`),
        h('span', { class: 'muted' }, [S.classLabel(cls), s.gender === 'M' ? '남' : s.gender === 'F' ? '여' : ''].filter(Boolean).join(' · ')),
        h('span', { class: 'grow' }),
        h('button', { class: 'btn', disabled: i === 0, onClick: () => move(-1) }, '◀ 앞 학생'),
        h('button', { class: 'btn', disabled: i === students.length - 1, onClick: () => move(1) }, '다음 학생 ▶'))),
    h('div', { class: 'seteuk-grid' },
      h('div', {}, draftCard(s, cls, d), assessCard(s, cls, d), lessonsCard(cls, d)),
      h('div', {}, notesCard(s, cls, d), stickersCard(d), groupsCard(d))));
}

function draftCard(s, cls, d) {
  const key = `${s.id}|${d.year}|${d.subject}`;
  const saved = seteukOf(s, d.year, d.subject)?.text || '';
  const value = drafts.has(key) ? drafts.get(key) : saved;
  const counter = h('span', { class: 'small muted' });
  const state = h('span', { class: 'small' });
  const ta = h('textarea', {
    rows: 9, class: 'seteuk-text', value, 'data-fk': `seteuk-${key}`,
    placeholder: '왼쪽 · 아래 기록을 보며 세특 초안을 쓰세요. 칸을 벗어나면 자동으로 저장됩니다.',
    onInput: () => { drafts.set(key, ta.value); update(); },
    onChange: () => save(),
  });
  const update = () => {
    counter.textContent = `${charCount(ta.value)}자 · ${neisBytes(ta.value)}바이트`;
    const dirty = ta.value !== (seteukOf(s, d.year, d.subject)?.text || '');
    state.textContent = dirty ? '저장 안 됨' : (ta.value ? '저장됨' : '');
    state.className = `small ${dirty ? 'warn-text' : 'muted'}`;
  };
  const save = async () => {
    try {
      const text = ta.value;
      if (text === (seteukOf(s, d.year, d.subject)?.text || '')) { drafts.delete(key); return update(); }
      await S.upsert('seteuk', { student_id: s.id, year: d.year, subject: d.subject, text }, 'student_id,year,subject');
      drafts.delete(key);
      update();
    } catch (err) { showError(err); }
  };
  update();
  return h('div', { class: 'card' },
    h('div', { class: 'row', style: { marginBottom: '8px' } },
      h('h3', { style: { margin: 0 } }, '세특 초안'), state, h('span', { class: 'grow' }), counter,
      h('button', { class: 'btn btn-sm', onClick: () => save() }, '저장'),
      h('button', {
        class: 'btn btn-sm',
        onClick: () => navigator.clipboard.writeText(ta.value).then(() => toast('복사했습니다. 나이스에 붙여넣으세요.', 'ok'), () => toast('복사하지 못했습니다.', 'error')),
      }, '복사')),
    ta,
    h('p', { class: 'muted small', style: { margin: '6px 0 0' } }, '바이트는 나이스 방식(한글 3, 영문 · 숫자 · 공백 1, 줄바꿈 2)으로 셉니다. 글자 수 한도는 학교 지침을 확인하세요.'));
}

function assessCard(s, cls, d) {
  const avg = (a) => {
    const v = S.studentsOf(cls).map((x) => S.scoreOf(a.id, x.id)?.score).filter((x) => x != null);
    return v.length ? (v.reduce((x, y) => x + y, 0) / v.length).toFixed(1) : '-';
  };
  return h('div', { class: 'card' },
    h('h3', {}, `수행평가 (${d.assessments.length})`),
    d.assessments.length
      ? h('table', { class: 'table' },
        h('thead', {}, h('tr', {}, ['학기', '평가', '평가일', '점수', '반 평균'].map((t) => h('th', {}, t)))),
        h('tbody', {}, d.assessments.map((a) => {
          const sc = S.scoreOf(a.id, s.id)?.score;
          return h('tr', {},
            h('td', {}, `${a.semester}학기`), h('td', {}, a.title),
            h('td', { class: 'small' }, a.dates?.[cls.id] ? fmtMD(a.dates[cls.id]) : '-'),
            h('td', {}, sc != null ? h('strong', {}, `${sc}`) : h('span', { class: 'muted' }, '미입력'), h('span', { class: 'muted small' }, ` / ${a.max_score}`)),
            h('td', { class: 'small muted' }, avg(a)));
        })))
      : h('p', { class: 'muted small' }, '올해 이 과목 수행평가가 없습니다.'));
}

function notesCard(s, cls, d) {
  return h('div', { class: 'card' },
    h('div', { class: 'row', style: { marginBottom: '8px' } },
      h('h3', { style: { margin: 0 } }, `학생 메모 (${d.notes.length})`),
      h('span', { class: 'grow' }),
      h('label', { class: 'inline small' }, h('input', { type: 'checkbox', checked: opts.allSubjects, onChange: (e) => { opts.allSubjects = e.target.checked; go(`class/${cls.id}/seteuk`); } }), '다른 과목 메모도'),
      h('button', { class: 'btn btn-sm', onClick: () => studentDialog(s, cls) }, '📝 메모 쓰기')),
    d.notes.length
      ? d.notes.map((n) => h('div', { class: 'student-note' },
        h('span', { class: 'muted small nowrap' }, fmtMD(n.date)),
        n.subject && n.subject !== cls.subject ? h('span', { class: 'badge' }, n.subject) : null,
        h('span', { class: 'grow' }, n.text)))
      : h('p', { class: 'muted small' }, '올해 메모가 없습니다.'));
}

function stickersCard(d) {
  const total = d.stickers.reduce((n, x) => n + (x.n || 1), 0);
  const bySem = [1, 2].map((sem) => d.stickers.filter((x) => S.termOf(x.date).semester === sem).reduce((n, x) => n + (x.n || 1), 0));
  const reasons = new Map();
  for (const x of d.stickers) if (x.reason) reasons.set(x.reason, (reasons.get(x.reason) || 0) + (x.n || 1));
  return h('div', { class: 'card' },
    h('h3', {}, `칭찬 스티커 ⭐ ${total}`),
    total
      ? [
        h('p', { class: 'small', style: { marginTop: 0 } }, `1학기 ${bySem[0]} · 2학기 ${bySem[1]}`),
        reasons.size ? h('div', { class: 'row' }, [...reasons].sort((a, b) => b[1] - a[1]).map(([r, n]) => h('span', { class: 'date-chip' }, `${r} ${n}`))) : null,
        h('div', { class: 'small muted', style: { marginTop: '8px' } }, d.stickers.slice(0, 12).map((x) => `${fmtMD(x.date)}${x.reason ? ` ${x.reason}` : ''}`).join(' · ')),
      ]
      : h('p', { class: 'muted small' }, '올해 받은 스티커가 없습니다.'));
}

function groupsCard(d) {
  return h('div', { class: 'card' },
    h('h3', {}, `조 활동 (${d.groups.length})`),
    d.groups.length
      ? d.groups.map(({ g, gi, leader }) => h('div', { class: 'row small log-row' },
        h('span', { class: 'muted' }, fmtMD(g.date)), h('span', {}, g.name), h('span', { class: 'grow' }),
        h('span', {}, `${gi + 1}조`), leader ? h('span', { class: 'badge badge-warn' }, '👑 조장') : null))
      : h('p', { class: 'muted small' }, '저장한 조 편성이 없습니다.'));
}

// 이 반이 올해 배운 단원과 활동 (세특의 '무엇을 했는지' 참고용)
function lessonsCard(cls, d) {
  const lessons = S.lessonsOfClass(cls.id).filter((l) => S.termOf(l.date).year === d.year);
  const byUnit = new Map();
  for (const l of lessons) {
    const k = S.unitById(l.unit_id)?.name || '단원 없음';
    if (!byUnit.has(k)) byUnit.set(k, []);
    byUnit.get(k).push(l);
  }
  return h('div', { class: 'card' },
    h('h3', {}, `이 반 수업 (${lessons.length}회)`),
    byUnit.size
      ? [...byUnit].map(([u, ls]) => h('div', { class: 'unit-summary' },
        h('strong', { class: 'small' }, u), h('span', { class: 'muted small' }, ` ${fmtMD(ls[0].date)}~${fmtMD(ls[ls.length - 1].date)}`),
        h('div', { class: 'small' }, [...new Set(ls.map(S.lessonText).filter(Boolean))].join(' · '))))
      : h('p', { class: 'muted small' }, '올해 수업 기록이 없습니다.'));
}

async function exportDrafts(cls) {
  const year = S.classYear(cls);
  const rows = [['번호', '이름', '과세특 초안', '글자 수', '바이트']];
  for (const s of S.studentsOf(cls)) {
    const t = seteukOf(s, year, cls.subject)?.text || '';
    rows.push([s.number, s.name, t, charCount(t), neisBytes(t)]);
  }
  try { await downloadXlsx(`${S.classLabel(cls)}-${cls.subject}-과세특-${todayStr()}.xlsx`, rows, '과세특'); } catch (err) { showError(err); }
}
