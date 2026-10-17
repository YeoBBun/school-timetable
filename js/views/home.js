// 첫 화면: 오늘 시간표 + 담당 반 목록 (반마다 한 줄 기록 · 반 메모 · 최근 기록)
import { h, append, toast, showError, modal, todayStr, addDays, weekdayOf, fmtDateLong, fmtMD, classChip } from '../ui.js';
import * as S from '../store.js';
import { go } from '../app.js';
import { attachDialog, matLink, unitSelect } from './materials.js';
import { addRecord, recordDialog, copyDialog, noteDialog, noteItem } from './records.js';

const RECENT = 6; // 반마다 보여 줄 최근 기록 수
let date = todayStr();
const drafts = new Map(); // 반 id → 입력 중인 글
const unitPick = new Map(); // '반 id|학년도|학기' → 고른 단원 id
let focusClass = null; // 다시 그린 뒤 입력칸에 커서를 둘 반

export function showDate(d) {
  date = d;
  go('today');
}

export default function render(root) {
  const term = S.termOf(date);
  const classes = S.classesOfYear(term.year);
  const off = S.data.days_off.find((d) => d.date === date);
  const slots = off ? [] : S.effectiveSlots(date, weekdayOf(date));
  const isToday = date === todayStr();

  append(root,
    h('div', { class: 'page-head' },
      h('h2', {}, fmtDateLong(date), h('span', { class: 'muted small term-label' }, S.termLabel(term))),
      h('button', { class: 'btn', title: '전날', onClick: () => showDate(addDays(date, -1)) }, '◀'),
      isToday ? null : h('button', { class: 'btn', onClick: () => showDate(todayStr()) }, '오늘'),
      h('button', { class: 'btn', title: '다음 날', onClick: () => showDate(addDays(date, 1)) }, '▶'),
      h('input', { type: 'date', value: date, onChange: (e) => e.target.value && showDate(e.target.value) })),
    timetableBar(slots, off, isToday, classes),
    classes.length
      ? h('div', { class: 'class-cols' }, classes.map((c) => classColumn(c, term, slots)))
      : h('div', { class: 'empty' }, `${term.year}학년도에 담당하는 반이 없습니다. '시간표 · 반' 화면에서 반을 추가하세요.`));

  if (focusClass) {
    root.querySelector(`[data-input="${focusClass}"]`)?.focus();
    focusClass = null;
  }
}

// ---- 오늘 시간표 ----
function timetableBar(slots, off, isToday, classes) {
  const title = isToday ? '오늘 시간표' : '이날 시간표';
  if (off) return h('div', { class: 'tt-bar' }, h('strong', {}, title), h('span', { class: 'muted' }, `수업 없는 날${off.note ? ` · ${off.note}` : ''}`));
  const items = slots.map((s) => {
    const cls = S.classById(s.class_id);
    if (!cls) return null;
    const rec = S.data.lessons.find((l) => l.class_id === cls.id && l.date === date && l.period === s.period);
    return h('button', {
      class: `slot ${rec ? 'done' : ''} ${s.changed ? 'changed' : ''}`, style: { '--c': cls.color },
      title: s.changed ? `시간표 변경${s.note ? ` · ${s.note}` : ''}` : '',
      onClick: () => {
        const input = document.querySelector(`[data-input="${cls.id}"]`);
        input?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        input?.focus();
      },
    },
    h('span', { class: 'slot-p' }, `${s.period}교시`),
    h('strong', {}, S.classLabel(cls)),
    h('span', { class: 'slot-text' }, rec ? `✓ ${S.lessonText(rec)}` : (s.changed ? '변경' : '')));
  });
  return h('div', { class: 'tt-bar' },
    h('strong', {}, title),
    items.length ? h('div', { class: 'slots' }, items) : h('span', { class: 'muted' }, '수업 없음'),
    h('span', { class: 'grow' }),
    classes.length ? h('button', { class: 'btn btn-sm', onClick: () => changeDialog(date) }, '이날 시간표 바꾸기') : null);
}

// ---- 반 칸 ----
function classColumn(cls, term, slots) {
  const key = `${cls.id}|${term.year}|${term.semester}`;
  const unitId = unitPick.has(key) ? unitPick.get(key) : (S.lastUnitOf(cls.id, term) || '');
  const periods = slots.filter((s) => s.class_id === cls.id).map((s) => s.period);
  const lessons = S.lessonsOfClass(cls.id);
  const recent = lessons.slice(-RECENT).reverse();
  const notes = S.notesOfClass(cls.id).filter((n) => !n.done);

  const input = h('input', {
    type: 'text', class: 'quick-input', 'data-input': cls.id, value: drafts.get(cls.id) || '',
    placeholder: date === todayStr() ? '오늘 한 내용 (Enter)' : `${fmtMD(date)} 한 내용 (Enter)`,
    onInput: (e) => drafts.set(cls.id, e.target.value),
    onKeydown: async (e) => {
      // 한글 입력 중의 Enter 는 글자 확정이므로 건너뛴다
      if (e.key !== 'Enter' || e.isComposing) return;
      e.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      try {
        drafts.delete(cls.id);
        focusClass = cls.id;
        await addRecord(cls, date, text, unitId);
      } catch (err) { showError(err); }
    },
  });

  // 기록에 파일을 끌어다 놓으면 그 기록에 붙인다
  const dropTarget = (l) => ({
    onDragover: (e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); e.currentTarget.classList.add('over'); } },
    onDragleave: (e) => e.currentTarget.classList.remove('over'),
    onDrop: (e) => { e.preventDefault(); e.currentTarget.classList.remove('over'); if (e.dataTransfer.files.length) attachDialog(l, [...e.dataTransfer.files]); },
  });

  const recRows = [];
  recent.forEach((l, i) => {
    // 단원이 바뀌는 곳에 단원 이름을 한 번씩 보여 준다
    const prev = recent[i - 1];
    if (l.unit_id && (!prev || prev.unit_id !== l.unit_id)) recRows.push(h('div', { class: 'rec-unit' }, S.unitById(l.unit_id)?.name || ''));
    const mats = S.materialsOfLesson(l.id);
    recRows.push(h('div', { class: `rec ${l.date === date ? 'on-date' : ''}`, ...dropTarget(l) },
      h('div', { class: 'rec-head' },
        h('span', { class: 'rec-date' }, `${fmtMD(l.date)}${l.period ? ` · ${l.period}교시` : ''}`),
        h('span', { class: 'grow' }),
        h('span', { class: 'rec-actions' },
          h('button', { class: 'icon-btn', title: '자료 붙이기 (파일을 여기로 끌어다 놓아도 됩니다)', onClick: () => attachDialog(l) }, '📎'),
          h('button', { class: 'icon-btn', title: '다른 반에도 쓰기', onClick: () => copyDialog(l) }, '⇉'),
          h('button', { class: 'icon-btn', title: '수정 · 삭제', onClick: () => recordDialog(l) }, '✎'))),
      h('div', { class: 'rec-text', onClick: () => recordDialog(l) }, S.lessonText(l) || h('span', { class: 'muted' }, '(내용 없음)')),
      mats.length ? h('div', { class: 'mat-list' }, mats.map(matLink)) : null));
  });

  return h('div', { class: 'card class-col', style: { '--c': cls.color } },
    h('div', { class: 'col-head' },
      h('a', { href: `#/class/${cls.id}`, class: 'col-name', title: '이 반 전체 기록 보기' }, classChip(cls, S.classLabel(cls))),
      periods.length ? h('span', { class: 'badge badge-info' }, `${periods.join('·')}교시`) : null,
      h('span', { class: 'grow' }),
      h('button', { class: 'icon-btn', title: '반 메모 추가', onClick: () => noteDialog(cls) }, '📝')),
    h('div', { class: 'col-unit' }, unitSelect(term, cls.subject, unitId, (v) => { unitPick.set(key, v); go('today'); }, { emptyLabel: '— 단원 고르기 —' })),
    input,
    notes.length ? h('div', { class: 'notes' }, notes.map((n) => noteItem(n, cls))) : null,
    recRows.length ? h('div', { class: 'recs' }, recRows) : h('p', { class: 'muted small', style: { margin: '6px 2px' } }, '아직 기록이 없습니다.'),
    lessons.length > RECENT ? h('a', { class: 'small more', href: `#/class/${cls.id}` }, `전체 기록 ${lessons.length}개 보기 →`) : null);
}

// ---- 이날 시간표 바꾸기: 교시마다 '주간 시간표대로 / 수업 없음 / 다른 반'을 고른다 ----
function changeDialog(d) {
  const st = S.settings();
  const wd = weekdayOf(d);
  const classes = S.classesOfYear(S.termOf(d).year);
  const base = new Map(S.data.timetable_slots.filter((s) => s.weekday === wd).map((s) => [s.period, s.class_id]));
  const existing = new Map(S.data.timetable_changes.filter((c) => c.date === d).map((c) => [c.period, c]));
  const maxPeriod = Math.max(st.periods, ...existing.keys(), ...base.keys());
  const label = (id) => S.classLabel(S.classById(id));

  const rows = [];
  for (let p = 1; p <= maxPeriod; p++) {
    const ch = existing.get(p);
    const value = ch ? (ch.class_id || 'none') : 'base';
    const select = h('select', { value },
      h('option', { value: 'base' }, base.get(p) ? `주간 시간표대로 (${label(base.get(p))})` : '주간 시간표대로 (수업 없음)'),
      base.get(p) ? h('option', { value: 'none' }, '수업 없음 (결강 · 교체로 빠짐)') : null,
      classes.map((c) => h('option', { value: c.id }, `${S.classLabel(c)}${c.id === base.get(p) ? '' : ' 로 바꾸기'}`)));
    const note = h('input', { type: 'text', placeholder: '사유 (예: 교체, 보강, 행사)', value: ch?.note || '', style: { flex: 1 } });
    const row = h('div', { class: 'change-row' }, h('strong', { class: 'period-lbl' }, `${p}교시`), select, note);
    const mark = () => row.classList.toggle('changed', select.value !== 'base');
    select.addEventListener('change', mark);
    mark();
    rows.push({ p, select, note, row });
  }

  const save = async () => {
    const upserts = [];
    const deletes = [];
    for (const { p, select, note } of rows) {
      const ch = existing.get(p);
      let classId = select.value === 'base' ? undefined : select.value === 'none' ? null : select.value;
      // 고른 반이 주간 시간표와 같으면 변경이 아니다
      if (classId !== undefined && classId === (base.get(p) || null)) classId = undefined;
      if (classId === undefined) { if (ch) deletes.push(ch.id); continue; }
      upserts.push({ date: d, period: p, class_id: classId, note: note.value.trim() });
    }
    if (upserts.length) await S.db.from('timetable_changes').upsert(upserts, { onConflict: 'user_id,date,period' });
    if (deletes.length) await S.db.from('timetable_changes').delete().in('id', deletes);
    toast(upserts.length ? `${fmtDateLong(d)} 시간표를 바꿨습니다.` : '주간 시간표대로 되돌렸습니다.', 'ok');
  };

  modal(`${fmtDateLong(d)} 시간표 바꾸기`, [
    h('p', { class: 'muted small' }, '이날만 바뀌는 교시를 고르세요. 다른 날의 시간표에는 영향이 없습니다.'),
    rows.map((r) => r.row),
  ], [
    existing.size ? { label: '모두 주간 시간표대로', danger: true, onClick: async () => { rows.forEach((r) => { r.select.value = 'base'; }); await save(); } } : null,
    { label: '취소' },
    { label: '저장', primary: true, onClick: save },
  ].filter(Boolean), { wide: true });
}
