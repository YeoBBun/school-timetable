// 과세특(교과 세부능력 및 특기사항) 쓰기: 학생 한 명의 이 학기 수행평가 결과 · 관찰 메모 · 학생 메모를 보며 초안을 고쳐 쓴다
// 반 전체 초안은 '🤖 AI로 반 전체 초안'(views/seteukAI.js)에서 만든다
import { h, append, toast, showError, modal, confirmDialog, fmtMD } from '../ui.js';
import * as S from '../store.js';
import { go } from '../app.js';
import { studentDialog } from './students.js';
import { openWorkbook, saveWorkbook } from '../xlsx.js';
import { rubricResult, maxScore, toNoun } from '../evalplan.js';
import { byteLen, aiTextOf, aiSettings, evidenceOf, EVIDENCE_LABEL, targetsOf } from '../seteukAI.js';
import { renderSeteukAI, requirementBadge } from './seteukAI.js';

const picked = new Map(); // 반 id → 보고 있는 학생 id
const opts = { allSubjects: false };
const drafts = new Map(); // 저장 전 초안 (학생 id|학년도|학기|과목 → 글)
const aiMode = new Set(); // AI 초안 화면을 보고 있는 반 id

// 나이스 방식 바이트(UTF-8): 한글 3, 영문 · 숫자 · 공백 · 문장부호 1, 줄바꿈 2
export const neisBytes = byteLen;
const charCount = (text) => [...text.replace(/\r\n/g, '\n')].length;

// 과세특은 학기마다 하나: 보는 학기(왼쪽 위 학기 고르기)를 따른다
const termFor = (cls) => ({ year: S.classYear(cls), semester: S.viewTerm().semester });
const seteukOf = (s, term, subject) => S.seteukOf(s.id, term, subject);

// 이 학생의 자료 모으기 (이 반의 학년도 · 학기 · 과목 기준)
function gather(s, cls) {
  const term = termFor(cls);
  const { year } = term;
  const subject = cls.subject;
  const inTerm = (d) => S.sameTerm(S.termOf(d), term);
  const notes = S.notesOfStudent(s.id).filter((n) => inTerm(n.date) && (opts.allSubjects || !n.subject || n.subject === subject));
  const assessments = S.assessmentsOf(cls, term);
  return { term, year, subject, notes, assessments };
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
    renderSeteukAI(root, cls, () => { aiMode.delete(cls.id); go(`class/${cls.id}/seteuk`); }, { fillNeis: () => fillNeisForm(cls) });
    return;
  }
  let sel = students.find((s) => s.id === picked.get(cls.id)) || students[0];
  picked.set(cls.id, sel.id);
  const term = termFor(cls);
  const pick = (s) => { picked.set(cls.id, s.id); go(`class/${cls.id}/seteuk`); };

  const targets = new Set(targetsOf(cls, term, students).map((x) => x.id));
  const list = h('div', { class: 'card seteuk-list' }, students.map((s) => {
    const e = evidenceOf(s, cls, term);
    const draft = seteukOf(s, term, cls.subject)?.text || '';
    return h('button', { class: `seteuk-student ${s === sel ? 'active' : ''}`, onClick: () => pick(s) },
      h('div', { class: 'row' }, h('strong', {}, `${s.number}. ${s.name}`), h('span', { class: 'grow' }),
        targets.has(s.id) ? h('span', { class: 'badge' }, '대상') : null,
        draft ? h('span', { class: 'badge badge-ok' }, `${byteLen(draft)}B`) : null),
      h('div', { class: 'small muted' }, `${EVIDENCE_LABEL[e.level]} · 평가 ${e.results} · 관찰 ${e.notes} · 메모 ${e.memos}`));
  }));

  append(root,
    h('div', { class: 'row', style: { marginBottom: '12px' } },
      h('strong', {}, `${term.year}학년도 ${term.semester}학기 ${cls.subject} 과세특`),
      requirementBadge(cls, term, students, (s) => seteukOf(s, term, cls.subject)),
      h('span', { class: 'grow' }),
      h('button', { class: 'btn btn-primary btn-lg', onClick: () => { aiMode.add(cls.id); go(`class/${cls.id}/seteuk`); }, title: '단계를 따라 누르면 반 전체 과세특 초안이 만들어집니다' }, '🤖 AI로 반 전체 과세특 만들기'),
      h('button', { class: 'btn', onClick: () => fillNeisForm(cls), title: '나이스에서 내려받은 과세특 일괄입력 양식을 올리면 초안을 채워 내려줍니다' }, '나이스 양식에 채우기')),
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
      h('div', {}, draftCard(s, cls, d), assessCard(s, cls, d)),
      h('div', {}, notesCard(s, cls, d))));
}

function draftCard(s, cls, d) {
  const key = `${s.id}|${d.year}|${d.term.semester}|${d.subject}`;
  const row = seteukOf(s, d.term, d.subject);
  const saved = row?.text || '';
  const value = drafts.has(key) ? drafts.get(key) : saved;
  const counter = h('span', { class: 'small muted' });
  const state = h('span', { class: 'small' });
  const ta = h('textarea', {
    rows: 9, class: 'seteuk-text', value, 'data-fk': `seteuk-${key}`,
    placeholder: "'🤖 AI로 반 전체 초안'으로 만들거나 아래 기록을 보며 직접 쓰세요. 칸을 벗어나면 자동으로 저장됩니다.",
    onInput: () => { drafts.set(key, ta.value); update(); },
    onChange: () => save(),
  });
  const update = () => {
    const b = neisBytes(ta.value);
    counter.textContent = `${charCount(ta.value)}자 · ${b}/${aiSettings().bytes}바이트`;
    counter.className = `small ${b > aiSettings().bytes ? 'warn-text' : 'muted'}`;
    const dirty = ta.value !== (seteukOf(s, d.term, d.subject)?.text || '');
    state.textContent = dirty ? '저장 안 됨' : (ta.value ? '저장됨' : '');
    state.className = `small ${dirty ? 'warn-text' : 'muted'}`;
  };
  const save = async () => {
    try {
      const text = ta.value;
      if (text === (seteukOf(s, d.term, d.subject)?.text || '')) { drafts.delete(key); return update(); }
      // 직접 고친 초안은 AI 글을 다시 넣을 때 물어본 뒤에만 바꾼다
      await S.saveSeteuk(s.id, d.term, d.subject, { text, edited: true });
      drafts.delete(key);
      update();
    } catch (err) { showError(err); }
  };
  update();
  return h('div', { class: 'card' },
    h('div', { class: 'row', style: { marginBottom: '8px' } },
      h('h3', { style: { margin: 0 } }, '세특 초안'), state, h('span', { class: 'grow' }), counter,
      h('button', { class: 'btn btn-sm', onClick: () => save() }, '저장'),
      row?.edited && aiTextOf(row) && aiTextOf(row) !== (row.text || '') ? h('button', {
        class: 'btn btn-sm', title: 'AI가 처음 쓴 글로 되돌립니다',
        onClick: async () => {
          if (!await confirmDialog('고쳐 쓴 초안을 버리고 AI가 처음 쓴 글로 되돌릴까요?', { okLabel: '되돌리기' })) return;
          drafts.delete(key);
          await S.saveSeteuk(s.id, d.term, d.subject, { text: aiTextOf(row), edited: false, polished: false }).catch(showError);
        },
      }, '고친 것 되돌리기') : null,
      h('button', {
        class: 'btn btn-sm',
        onClick: () => navigator.clipboard.writeText(ta.value).then(() => toast('복사했습니다. 나이스에 붙여넣으세요.', 'ok'), () => toast('복사하지 못했습니다.', 'error')),
      }, '복사')),
    ta,
    h('p', { class: 'muted small', style: { margin: '6px 0 0' } }, '바이트는 나이스 방식(한글 3, 영문 · 숫자 · 공백 1, 줄바꿈 2)으로 셉니다. 글자 수 한도는 학교 지침을 확인하세요.'));
}

const cleanTitle = (t) => t.replace(/\s*\([^)]*점\)\s*/g, '').trim();

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
      : h('p', { class: 'muted small' }, '이 학기 이 과목 수행평가가 없습니다. 수행평가 메뉴에서 평가계획서를 올리면 만들어집니다.'));
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
      : h('p', { class: 'muted small' }, '이 학기 메모가 없습니다.'));
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
        const c = { year: col(/^학년도$/), grade: col(/^학년$/), rn: col(/^(반\/번호|번호)$/), room: col(/^반$/), name: col(/^(성명|이름)$/), subject: col(/^과목명?$/), sem: col(/^학기$/), text: col(/세부능력/) };
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
          // 양식의 '학기' 칸을 따른다 (없으면 보는 학기)
          const semester = (c.sem >= 0 && Number(r[c.sem])) || S.viewTerm().semester;
          const text = seteukOf(st, { year, semester }, subject)?.text || '';
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

