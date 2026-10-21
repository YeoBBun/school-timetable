// 학생 명단: 직접 입력 · 여러 명 붙여넣기 · 나이스 엑셀 올리기, 그리고 학생 메모 (학생의 특이 행동 · 관찰)
import { h, append, toast, showError, modal, confirmDialog, todayStr, fmtMD } from '../ui.js';
import * as S from '../store.js';
import { readRows } from '../xlsx.js';
import { showStudent } from './seteuk.js';

const GENDER = { M: '남', F: '여' };

const roomOf = (cls) => ({ year: S.classYear(cls), grade: cls.grade, room: cls.room });

export function renderStudentsTab(root, cls) {
  if (!cls.grade) {
    append(root, h('div', { class: 'empty' }, "이 반은 학년 · 반이 정해지지 않았습니다. '설정 → 시간표 · 반'에서 학년과 반을 고르세요."));
    return;
  }
  const list = S.studentsOf(cls);
  const term = S.viewTerm();
  const stickers = S.feature('stickers');
  const others = S.classesOfYear(S.classYear(cls)).filter((c) => c.id !== cls.id && c.grade === cls.grade && c.room === cls.room);

  const save = (s, patch) => S.update('students', s.id, patch).catch(showError);
  const rows = list.map((s) => {
    const notes = S.notesOfStudent(s.id);
    return h('tr', {},
      h('td', {}, h('input', { type: 'number', min: 1, value: s.number, class: 'num-input', 'data-fk': `num-${s.id}`, onChange: (e) => Number(e.target.value) > 0 && save(s, { number: Number(e.target.value) }) })),
      h('td', {}, h('input', { type: 'text', value: s.name, class: 'name-input', 'data-fk': `name-${s.id}`, onChange: (e) => e.target.value.trim() && save(s, { name: e.target.value.trim() }) })),
      h('td', {}, h('select', { value: s.gender || '', onChange: (e) => save(s, { gender: e.target.value }) },
        h('option', { value: '' }, '-'), Object.entries(GENDER).map(([k, v]) => h('option', { value: k }, v)))),
      stickers ? h('td', { class: 'center' }, String(S.stickerCount(cls.id, s.id, term) || '')) : null,
      h('td', {}, h('div', { class: 'memo-cell' },
        h('button', { class: 'btn btn-sm', onClick: () => studentDialog(s, cls) }, notes.length ? `📝 메모 ${notes.length}` : '📝 메모 쓰기'),
        notes.length ? h('span', { class: 'small memo-last', onClick: () => studentDialog(s, cls) }, h('span', { class: 'muted' }, `${fmtMD(notes[0].date)} `), notes[0].text) : null)),
      h('td', { class: 'right nowrap' },
        h('button', { class: 'btn btn-sm', title: '메모 · 수행평가 · 스티커 · 과세특 초안을 한 화면에', onClick: () => showStudent(cls, s) }, '📋 종합'), ' ',
        h('button', { class: 'icon-btn danger', title: '학생 삭제', onClick: () => removeStudent(s) }, '✕')));
  });

  append(root,
    h('div', { class: 'row', style: { marginBottom: '12px' } },
      h('strong', {}, `학생 ${list.length}명`),
      others.length ? h('span', { class: 'muted small' }, `(${others.map((c) => c.subject).join(' · ')} 수업과 같은 명단)`) : null,
      h('span', { class: 'grow' }),
      h('button', { class: 'btn', onClick: () => addDialog(cls) }, '+ 학생 추가'),
      h('button', { class: 'btn', onClick: () => pasteDialog(cls) }, '여러 명 붙여넣기'),
      h('button', { class: 'btn', onClick: () => neisImport(cls) }, '나이스 엑셀로 명단 넣기')),
    list.length
      ? h('div', { class: 'table-wrap' }, h('table', { class: 'table student-table' },
        h('thead', {}, h('tr', {}, ['번호', '이름', '성별', stickers ? `스티커(${term.semester}학기)` : null, '메모', ''].filter((t) => t != null).map((t) => h('th', {}, t)))),
        h('tbody', {}, rows)))
      : h('div', { class: 'empty' }, '아직 학생이 없습니다. 위 버튼으로 직접 넣거나, 나이스에서 내려받은 명렬표 · 과세특 일괄입력 양식 엑셀을 올리세요.'),
    h('p', { class: 'muted small' }, '성별은 비워 둬도 됩니다. 명단은 학년도 · 학년 · 반마다 하나라서 같은 반의 다른 과목 수업과 함께 씁니다.'));
}

async function removeStudent(s) {
  if (!await confirmDialog(`${S.studentLabel(s)} 학생을 지울까요?\n이 학생의 메모 · 점수 · 스티커도 함께 지워집니다.`)) return;
  S.remove('students', { id: s.id }).catch(showError);
}

function nextNumber(cls) {
  return S.studentsOf(cls).reduce((m, s) => Math.max(m, s.number), 0) + 1;
}

function addDialog(cls) {
  const number = h('input', { type: 'number', min: 1, value: nextNumber(cls), style: { width: '90px' } });
  const name = h('input', { type: 'text', placeholder: '이름' });
  const m = modal(`${S.classLabel(cls)} 학생 추가`, [h('div', { class: 'row' }, h('label', {}, '번호', number), h('label', { class: 'grow' }, '이름', name)),
    h('p', { class: 'muted small' }, 'Enter 를 누르면 저장하고 다음 번호로 넘어갑니다.')], [
    { label: '닫기' },
    { label: '추가', primary: true, onClick: () => { add(); return false; } },
  ]);
  const add = async () => {
    const n = Number(number.value);
    const nm = name.value.trim();
    if (!n || !nm) return toast('번호와 이름을 입력하세요.');
    if (S.studentsOf(cls).some((s) => s.number === n)) return toast(`${n}번은 이미 있습니다.`, 'error');
    await S.insert('students', { ...roomOf(cls), number: n, name: nm });
    toast(`${n}. ${nm} 추가`, 'ok');
    number.value = n + 1;
    name.value = '';
    name.focus();
  };
  name.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) add().catch(showError); });
  name.focus();
  return m;
}

// '번호 이름 [성별]' 줄들 (엑셀에서 복사한 탭 구분도 됨)
function parseLines(text) {
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    const parts = line.split(/[\t,]+|\s+/).map((p) => p.trim()).filter(Boolean);
    const i = parts.findIndex((p) => /^\d{1,3}$/.test(p));
    if (i < 0 || !parts[i + 1]) continue;
    const g = parts.slice(i + 2).find((p) => /^(남|여|남자|여자|M|F)$/i.test(p));
    out.push({ number: Number(parts[i]), name: parts[i + 1], gender: g ? (/^(남|M)/i.test(g) ? 'M' : 'F') : undefined });
  }
  return out;
}

function pasteDialog(cls) {
  const ta = h('textarea', { rows: 12, placeholder: '1 김하늘 여\n2 이바다 남\n3 박구름\n…\n(엑셀에서 번호 · 이름 칸을 복사해 붙여넣어도 됩니다)' });
  modal(`${S.classLabel(cls)} 여러 명 붙여넣기`, [ta, h('p', { class: 'muted small' }, '같은 번호가 이미 있으면 이름(과 성별)을 새로 바꿉니다.')], [
    { label: '취소' },
    {
      label: '넣기', primary: true,
      onClick: async () => {
        const rows = parseLines(ta.value);
        if (!rows.length) { toast('번호와 이름이 있는 줄이 없습니다.', 'error'); return false; }
        await applyRoster(cls, rows, false);
      },
    },
  ], { wide: true });
}

// 명단 반영: 번호가 같으면 고치고, 없으면 추가. removeMissing 이면 명단에 없는 학생은 지운다
async function applyRoster(cls, rows, removeMissing) {
  const now = S.studentsOf(cls);
  let added = 0;
  let changed = 0;
  for (const r of rows) {
    const found = now.find((s) => s.number === r.number);
    if (found) {
      const patch = {};
      if (found.name !== r.name) patch.name = r.name;
      if (r.gender && found.gender !== r.gender) patch.gender = r.gender;
      if (Object.keys(patch).length) { await S.update('students', found.id, patch); changed++; }
    } else {
      await S.insert('students', { ...roomOf(cls), number: r.number, name: r.name, gender: r.gender || '' });
      added++;
    }
  }
  let removed = 0;
  if (removeMissing) {
    const keep = new Set(rows.map((r) => r.number));
    for (const s of now) if (!keep.has(s.number)) { await S.remove('students', { id: s.id }); removed++; }
  }
  toast(`추가 ${added}명 · 바뀜 ${changed}명${removed ? ` · 지움 ${removed}명` : ''}`, 'ok');
}

// 나이스 엑셀(명렬표 · 과세특 일괄입력 양식): '번호'(또는 '반/번호')와 '성명(이름)' 칸이 있는 줄을 제목 줄로 보고 그 아래를 읽는다.
// 학생개인번호 같은 다른 칸은 저장하지 않는다.
// '학년' · '반' 칸이 있으면 이 반 학생만 고른다.
export function parseRoster(rows, cls) {
  const isNum = (v) => /^\d{1,3}$/.test(v);
  const NUM = /^(번호|번|반\/번호)$/;
  const hi = rows.findIndex((r) => r.some((v) => NUM.test(v)) && r.some((v) => /^(성명|이름|학생명)$/.test(v)));
  if (hi < 0) return null;
  const head = rows[hi];
  const col = (re) => head.findIndex((v) => re.test(v));
  const cNum = col(NUM);
  const cName = col(/^(성명|이름|학생명)$/);
  const cGender = col(/^성별$/);
  const cGrade = col(/^학년$/);
  const cRoom = col(/^반$/);
  const out = [];
  for (const r of rows.slice(hi + 1)) {
    // 나이스 과세특 양식은 '반/번호' 칸에 '1/12' 처럼 들어 있다
    const [roomPart, numPart] = String(r[cNum] || '').includes('/') ? String(r[cNum]).split('/').map((v) => v.trim()) : [null, r[cNum]];
    if (!isNum(numPart || '') || !r[cName]) continue;
    if (roomPart != null && isNum(roomPart) && Number(roomPart) !== cls.room) continue;
    if (cGrade >= 0 && isNum(r[cGrade]) && Number(r[cGrade]) !== cls.grade) continue;
    if (cRoom >= 0 && isNum(r[cRoom]) && Number(r[cRoom]) !== cls.room) continue;
    const g = cGender >= 0 ? r[cGender] : '';
    out.push({ number: Number(numPart), name: r[cName], gender: /^남/.test(g) ? 'M' : /^여/.test(g) ? 'F' : undefined });
  }
  return out;
}

function neisImport(cls) {
  const input = h('input', { type: 'file', accept: '.xlsx,.xls,.csv' });
  input.addEventListener('change', async () => {
    const file = input.files[0];
    if (!file) return;
    try {
      const rows = parseRoster(await readRows(file), cls);
      if (!rows) throw new Error("'번호'(또는 '반/번호')와 '성명' 칸을 찾지 못했습니다. 나이스에서 내려받은 명렬표나 과세특 일괄입력 양식이 맞는지 확인해 주세요.");
      if (!rows.length) throw new Error(`${S.classLabel(cls)} 학생을 찾지 못했습니다.`);
      const missing = S.studentsOf(cls).filter((s) => !rows.some((r) => r.number === s.number));
      const del = h('input', { type: 'checkbox' });
      modal('명단 확인', [
        h('p', {}, `'${file.name}'에서 ${S.classLabel(cls)} 학생 ${rows.length}명을 찾았습니다.`),
        h('div', { class: 'picker-list', style: { maxHeight: '260px' } }, rows.map((r) => h('div', { class: 'small', style: { padding: '4px 12px' } },
          `${r.number}. ${r.name}${r.gender ? ` (${GENDER[r.gender]})` : ''}`))),
        missing.length ? h('label', { class: 'inline' }, del, `파일에 없는 학생 ${missing.length}명 지우기 (전학 등)`) : null,
        h('p', { class: 'muted small' }, '번호가 같은 학생은 이름 · 성별을 새로 바꾸고, 메모 · 점수 · 스티커는 그대로 둡니다.'),
      ], [
        { label: '취소' },
        { label: '반영하기', primary: true, onClick: () => applyRoster(cls, rows, del.checked) },
      ]);
    } catch (err) { showError(err); }
  });
  input.click();
}

// ---- 학생 메모 ----
export function studentDialog(s, cls) {
  const list = h('div', { class: 'notes' });
  const draw = () => {
    const notes = S.notesOfStudent(s.id);
    list.replaceChildren(...(notes.length ? notes.map((n) => h('div', { class: 'student-note' },
      h('span', { class: 'muted small nowrap' }, fmtMD(n.date)),
      n.subject ? h('span', { class: 'badge' }, n.subject) : null,
      h('span', { class: 'grow' }, n.text),
      h('button', { class: 'icon-btn danger', title: '삭제', onClick: async () => { await S.remove('student_notes', { id: n.id }); draw(); } }, '✕')))
      : [h('p', { class: 'muted small' }, '아직 메모가 없습니다.')]));
  };
  const date = h('input', { type: 'date', value: todayStr() });
  const text = h('input', { type: 'text', placeholder: '이 학생의 특이 행동 · 관찰 (예: 발표 적극적, 모둠 활동에서 갈등 조정)', class: 'grow' });
  const add = async () => {
    const t = text.value.trim();
    if (!t) return;
    await S.insert('student_notes', { student_id: s.id, date: date.value || todayStr(), text: t, subject: cls?.subject || null });
    text.value = '';
    draw();
  };
  text.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) add().catch(showError); });
  draw();
  modal(`${S.studentLabel(s)} 학생 메모`, [
    h('div', { class: 'row' }, date, text, h('button', { class: 'btn btn-primary', onClick: () => add().catch(showError) }, '추가')),
    list,
  ], [{ label: '닫기' }], { wide: true });
  text.focus();
}
