// 과세특(교과 세부능력 및 특기사항) 쓰기: 학생 한 명의 메모 · 수행평가 · 칭찬 스티커 · 조 활동 · 배운 단원을 모아 보고 옆에서 초안을 쓴다
import { h, append, toast, showError, modal, confirmDialog, fmtMD, todayStr } from '../ui.js';
import * as S from '../store.js';
import { go } from '../app.js';
import { studentDialog } from './students.js';
import { noteDate } from './records.js';
import { downloadXlsx, openWorkbook, saveWorkbook } from '../xlsx.js';
import { GRADES, rubricResult, maxScore, toNoun } from '../evalplan.js';
import { byteLen, assemble, aiSettings } from '../seteukAI.js';
import { renderSeteukAI } from './seteukAI.js';

const picked = new Map(); // 반 id → 보고 있는 학생 id
const opts = { allSubjects: false };
const drafts = new Map(); // 저장 전 초안 (학생 id|학년도|과목 → 글)
const aiMode = new Set(); // AI 초안 화면을 보고 있는 반 id

// 나이스 방식 바이트(UTF-8): 한글 3, 영문 · 숫자 · 공백 · 문장부호 1, 줄바꿈 2
export const neisBytes = byteLen;
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
    .map((g) => { const gi = g.groups.findIndex((ids) => ids.includes(s.id)); return gi < 0 ? null : { g, gi }; })
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
  if (aiMode.has(cls.id)) {
    renderSeteukAI(root, cls, () => { aiMode.delete(cls.id); go(`class/${cls.id}/seteuk`); });
    return;
  }
  let sel = students.find((s) => s.id === picked.get(cls.id)) || students[0];
  picked.set(cls.id, sel.id);
  const year = S.classYear(cls);
  const pick = (s) => { picked.set(cls.id, s.id); go(`class/${cls.id}/seteuk`); };

  const list = h('div', { class: 'card seteuk-list' }, students.map((s) => {
    const d = gather(s, cls);
    const scored = d.assessments.filter((a) => S.scoreOf(a.id, s.id)).length;
    const draft = seteukOf(s, year, cls.subject)?.text || '';
    return h('button', { class: `seteuk-student ${s === sel ? 'active' : ''}`, onClick: () => pick(s) },
      h('div', { class: 'row' }, h('strong', {}, `${s.number}. ${s.name}`), h('span', { class: 'grow' }),
        draft ? h('span', { class: 'badge badge-ok' }, `초안 ${charCount(draft)}자`) : null),
      h('div', { class: 'small muted' }, [`메모 ${d.notes.length}`, `평가 ${scored}/${d.assessments.length}`,
        S.feature('stickers') ? `⭐ ${d.stickers.reduce((n, x) => n + (x.n || 1), 0)}` : null].filter(Boolean).join(' · ')));
  }));

  append(root,
    h('div', { class: 'row', style: { marginBottom: '12px' } },
      h('strong', {}, `${year}학년도 ${cls.subject} 과세특`),
      h('span', { class: 'muted small' }, '학생을 고르면 그 학생의 기록을 모아 보여 줍니다.'),
      h('span', { class: 'grow' }),
      h('button', { class: 'btn btn-primary', onClick: () => { aiMode.add(cls.id); go(`class/${cls.id}/seteuk`); }, title: '평가 항목마다 AI 프롬프트를 만들고, 결과를 붙여넣어 반 전체 초안을 한 번에 만듭니다' }, '🤖 AI로 반 전체 초안'),
      h('button', { class: 'btn btn-primary', onClick: () => fillNeisForm(cls), title: '나이스에서 내려받은 과세특 일괄입력 양식을 올리면 초안을 채워 내려줍니다' }, '나이스 양식에 채우기'),
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
      h('div', {}, draftCard(s, cls, d), levelCard(s, cls, d), assessCard(s, cls, d), lessonsCard(cls, d)),
      h('div', {}, notesCard(s, cls, d), S.feature('stickers') ? stickersCard(d) : null, groupsCard(d))));
}

function draftCard(s, cls, d) {
  const key = `${s.id}|${d.year}|${d.subject}`;
  const row = seteukOf(s, d.year, d.subject);
  const saved = row?.text || '';
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
    const b = neisBytes(ta.value);
    counter.textContent = `${charCount(ta.value)}자 · ${b}/${aiSettings().bytes}바이트`;
    counter.className = `small ${b > aiSettings().bytes ? 'warn-text' : 'muted'}`;
    const dirty = ta.value !== (seteukOf(s, d.year, d.subject)?.text || '');
    state.textContent = dirty ? '저장 안 됨' : (ta.value ? '저장됨' : '');
    state.className = `small ${dirty ? 'warn-text' : 'muted'}`;
  };
  const save = async () => {
    try {
      const text = ta.value;
      if (text === (seteukOf(s, d.year, d.subject)?.text || '')) { drafts.delete(key); return update(); }
      // 직접 고친 초안은 AI 항목 문장을 다시 넣어도 덮어쓰지 않는다
      await S.upsert('seteuk', { student_id: s.id, year: d.year, subject: d.subject, text, edited: true }, 'student_id,year,subject');
      drafts.delete(key);
      update();
    } catch (err) { showError(err); }
  };
  update();
  // 수행평가 결과(등급의 성취수준 문장 · 충족한 기준) + 관찰 메모 + 학생 메모를 문장으로 모아 초안 뒤에 붙인다
  const addMaterial = () => {
    const text = draftMaterial(s, cls, d);
    if (!text) return toast('넣을 재료가 없습니다. 수행평가 결과 · 관찰 메모 · 학생 메모를 먼저 입력하세요.');
    ta.value = ta.value.trim() ? `${ta.value.trim()}\n${text}` : text;
    drafts.set(key, ta.value);
    save();
  };
  return h('div', { class: 'card' },
    h('div', { class: 'row', style: { marginBottom: '8px' } },
      h('h3', { style: { margin: 0 } }, '세특 초안'), state, h('span', { class: 'grow' }), counter,
      h('button', { class: 'btn btn-sm btn-primary', title: '수행평가 결과 · 관찰 메모 · 학생 메모를 문장으로 모아 초안 뒤에 붙입니다', onClick: addMaterial }, '✨ 초안 재료 넣기'),
      h('button', { class: 'btn btn-sm', onClick: () => save() }, '저장'),
      row?.edited && row?.parts && Object.keys(row.parts).length ? h('button', {
        class: 'btn btn-sm', title: 'AI 항목 문장을 차례대로 이어 붙인 글로 되돌립니다',
        onClick: async () => {
          if (!await confirmDialog('고쳐 쓴 초안을 버리고 AI 항목 문장을 이어 붙인 글로 되돌릴까요?', { okLabel: '되돌리기' })) return;
          drafts.delete(key);
          await S.upsert('seteuk', { student_id: s.id, year: d.year, subject: d.subject, text: assemble(cls, row.parts), edited: false }, 'student_id,year,subject').catch(showError);
        },
      }, '고친 것 되돌리기') : null,
      h('button', {
        class: 'btn btn-sm',
        onClick: () => navigator.clipboard.writeText(ta.value).then(() => toast('복사했습니다. 나이스에 붙여넣으세요.', 'ok'), () => toast('복사하지 못했습니다.', 'error')),
      }, '복사')),
    ta,
    h('p', { class: 'muted small', style: { margin: '6px 0 0' } }, '바이트는 나이스 방식(한글 3, 영문 · 숫자 · 공백 1, 줄바꿈 2)으로 셉니다. 글자 수 한도는 학교 지침을 확인하세요.'));
}

const endDot = (t) => (/[.!?]$/.test(t.trim()) ? t.trim() : `${t.trim()}.`);
const cleanTitle = (t) => t.replace(/\s*\([^)]*점\)\s*/g, '').trim();

// 초안 재료: 평가마다 "'평가 이름'에서 (등급의 성취수준 문장 또는 충족한 기준). (관찰 메모)." + 이 과목 학생 메모
function draftMaterial(s, cls, d) {
  const parts = [];
  for (const a of d.assessments) {
    const cur = S.scoreOf(a.id, s.id);
    if (!cur || cur.special) continue;
    const r = rubricResult(a, cur);
    const bits = [];
    const gd = a.kind === 'grade' && r.grade ? (a.rubric?.grades || []).find((g) => g.grade === r.grade)?.desc : '';
    if (gd) bits.push(toNoun(gd));
    else if (r.met.length) bits.push(`${r.met.map((t) => toNoun(t).replace(/\.$/, '')).join(', ')}.`);
    if (cur.note) bits.push(endDot(cur.note));
    if (bits.length) parts.push(`'${cleanTitle(a.title)}'에서 ${bits.join(' ')}`);
  }
  const memos = S.notesOfStudent(s.id).filter((n) => S.termOf(n.date).year === d.year && (!n.subject || n.subject === d.subject)).reverse().map((n) => endDot(n.text));
  return [...parts, ...memos].join(' ');
}

// 학기 단위 성취수준: 평가계획의 A~E 중 이 학생 수준을 골라 두면 그 문장을 보고 초안에 넣을 수 있다
function levelCard(s, cls, d) {
  const row = seteukOf(s, d.year, d.subject);
  const chosen = row?.levels || {};
  const plans = [1, 2].map((semester) => ({ semester, plan: S.planOf({ year: d.year, semester }, d.subject, cls.grade) })).filter((x) => x.plan && Object.keys(x.plan.levels || {}).length);
  if (!plans.length) return null;
  const pick = (sem, g) => S.upsert('seteuk', { student_id: s.id, year: d.year, subject: d.subject, levels: { ...chosen, [sem]: chosen[sem] === g ? '' : g } }, 'student_id,year,subject').catch(showError);
  const insert = (text) => {
    const key = `${s.id}|${d.year}|${d.subject}`;
    const cur = drafts.has(key) ? drafts.get(key) : row?.text || '';
    S.upsert('seteuk', { student_id: s.id, year: d.year, subject: d.subject, text: cur.trim() ? `${cur.trim()}\n${text}` : text, edited: true }, 'student_id,year,subject').then(() => drafts.delete(key), showError);
  };
  return h('div', { class: 'card' },
    h('h3', {}, '학기 단위 성취수준'),
    plans.map(({ semester, plan }) => {
      const g = chosen[semester];
      return h('div', { class: 'level-pick' },
        h('div', { class: 'row' }, h('strong', { class: 'small' }, `${semester}학기`),
          h('div', { class: 'grade-btns' }, GRADES.filter((x) => plan.levels[x]).map((x) => h('button', { class: g === x ? 'on' : '', title: plan.levels[x], onClick: () => pick(semester, x) }, x)))),
        g ? h('div', { class: 'small level-text' }, toNoun(plan.levels[g]), ' ', h('button', { class: 'btn btn-sm', onClick: () => insert(toNoun(plan.levels[g])) }, '초안에 넣기')) : h('p', { class: 'muted small', style: { margin: '4px 0 0' } }, '수준을 고르면 평가계획의 문장이 보입니다.'));
    }));
}

function assessCard(s, cls, d) {
  return h('div', { class: 'card' },
    h('h3', {}, `수행평가 (${d.assessments.length})`),
    d.assessments.length
      ? d.assessments.map((a) => {
        const cur = S.scoreOf(a.id, s.id) || {};
        const r = rubricResult(a, cur);
        const gd = a.kind === 'grade' && r.grade ? (a.rubric?.grades || []).find((g) => g.grade === r.grade)?.desc : '';
        const result = cur.special ? h('span', { class: 'badge badge-warn' }, cur.special)
          : a.kind === 'grade' ? (r.grade ? h('span', { class: 'badge badge-info' }, `등급 ${r.grade}`) : h('span', { class: 'muted small' }, '미입력'))
            : r.score != null ? h('span', {}, h('strong', {}, r.score), h('span', { class: 'muted small' }, ` / ${maxScore(a)}`)) : h('span', { class: 'muted small' }, '미입력');
        return h('div', { class: 'assess-result' },
          h('div', { class: 'row' },
            h('span', { class: 'muted small' }, `${a.semester}학기`), h('strong', { class: 'grow' }, cleanTitle(a.title)),
            a.dates?.[cls.id] ? h('span', { class: 'muted small' }, fmtMD(a.dates[cls.id])) : null, result),
          r.met.length ? h('div', { class: 'small' }, '✓ ', r.met.map((t) => toNoun(t).replace(/\.$/, '')).join(' · ')) : null,
          gd ? h('div', { class: 'small level-text' }, toNoun(gd)) : null,
          cur.note ? h('div', { class: 'small' }, '👀 ', cur.note) : null,
          a.standards?.length ? h('div', { class: 'muted small' }, a.standards.join(' ')) : null);
      })
      : h('p', { class: 'muted small' }, '올해 이 과목 수행평가가 없습니다. 수행평가 메뉴에서 평가계획서를 올리면 만들어집니다.'));
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
      ? d.groups.map(({ g, gi }) => h('div', { class: 'row small log-row' },
        h('span', { class: 'muted' }, fmtMD(g.date)), h('span', {}, g.name), h('span', { class: 'grow' }),
        h('span', {}, `${gi + 1}조`)))
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

// 나이스 과세특 일괄입력 양식 채우기: 나이스에서 받은 빈 양식을 올리면 '세부능력 및 특기사항' 칸에만 초안을 넣어 내려준다.
// 다른 칸(학년도 · 학기 · 반/번호 · 학생개인번호 · 성명 · 과목명)과 시트 이름 · 줄 순서는 그대로 둔다.
// 학생은 학년도 · 학년 · 반 · 번호로 찾고, 이름이 앱의 명단과 같을 때만 채운다.
function fillNeisForm(cls) {
  const input = h('input', { type: 'file', accept: '.xlsx,.xls' });
  input.addEventListener('change', async () => {
    const file = input.files[0];
    if (!file) return;
    try {
      const { X, wb } = await openWorkbook(file);
      const res = { filled: 0, empty: [], unmatched: [] };
      let found = false;
      for (const sheetName of wb.SheetNames) {
        const ws = wb.Sheets[sheetName];
        if (!ws['!ref']) continue;
        const start = X.utils.decode_range(ws['!ref']).s;
        const rows = X.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '', blankrows: true }).map((r) => r.map((v) => String(v ?? '').trim()));
        const hi = rows.findIndex((r) => r.some((v) => /세부능력/.test(v)) && r.some((v) => /^(성명|이름)$/.test(v)));
        if (hi < 0) continue;
        found = true;
        const head = rows[hi];
        const col = (re) => head.findIndex((v) => re.test(v));
        const c = { year: col(/^학년도$/), grade: col(/^학년$/), rn: col(/^(반\/번호|번호)$/), room: col(/^반$/), name: col(/^(성명|이름)$/), subject: col(/^과목명?$/), text: col(/세부능력/) };
        rows.slice(hi + 1).forEach((r, i) => {
          const name = r[c.name];
          if (!name) return;
          let room = c.room >= 0 ? Number(r[c.room]) : cls.room;
          let num = Number(r[c.rn]);
          if (r[c.rn]?.includes('/')) [room, num] = r[c.rn].split('/').map((v) => Number(v.trim()));
          const year = (c.year >= 0 && Number(r[c.year])) || S.classYear(cls);
          const grade = (c.grade >= 0 && Number(r[c.grade])) || cls.grade;
          const subject = (c.subject >= 0 && r[c.subject]) || cls.subject;
          const label = `${room}반 ${num}번`;
          const st = S.data.students.find((s) => s.year === year && s.grade === grade && s.room === room && s.number === num);
          if (!st || st.name.replace(/\s/g, '') !== name.replace(/\s/g, '')) { res.unmatched.push(label); return; }
          const text = seteukOf(st, year, subject)?.text || '';
          if (!text) { res.empty.push(label); return; }
          ws[X.utils.encode_cell({ r: start.r + hi + 1 + i, c: start.c + c.text })] = { t: 's', v: text, z: '@' };
          res.filled++;
        });
      }
      if (!found) throw new Error("'성명'과 '세부능력 및 특기사항' 칸을 찾지 못했습니다. 나이스에서 내려받은 과세특 일괄입력 양식이 맞는지 확인해 주세요.");
      if (res.filled) saveWorkbook(X, wb, `${file.name.replace(/\.xlsx?$/i, '')}_초안채움.xlsx`);
      modal('나이스 양식 채우기', [
        h('p', {}, res.filled ? `${res.filled}명의 초안을 채운 파일을 내려받았습니다.` : '채울 초안이 없어 파일을 만들지 않았습니다.'),
        res.empty.length ? h('p', { class: 'small' }, `초안이 없어 비워 둔 학생 ${res.empty.length}명: ${res.empty.join(', ')}`) : null,
        res.unmatched.length ? h('p', { class: 'small warn-text' }, `앱 명단과 번호 · 이름이 맞지 않아 건너뛴 학생 ${res.unmatched.length}명: ${res.unmatched.join(', ')} — 학생 탭에서 이 양식으로 명단을 다시 넣으면 맞춰집니다.`) : null,
        h('p', { class: 'muted small' }, '나이스에 올리기 전에 엑셀에서 한 번 열어 내용을 확인하세요. 양식의 다른 칸은 바꾸지 않았습니다.'),
      ], [{ label: '닫기' }]);
    } catch (err) { showError(err); }
  });
  input.click();
}

