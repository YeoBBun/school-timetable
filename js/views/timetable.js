// 시간표 · 반 관리
import { h, append, toast, showError, confirmDialog, WEEKDAYS, PALETTE, todayStr, fmtDateLong } from '../ui.js';
import { showDate } from './home.js';
import * as S from '../store.js';
import { go } from '../app.js';

// 붓처럼 반을 고른 뒤 시간표 칸을 클릭(또는 드래그)해서 칠한다
let brush = null; // 반 id 또는 'erase'
let activeCommit = null;
let activeMove = null;
document.addEventListener('pointerup', () => activeCommit?.());
document.addEventListener('pointercancel', () => activeCommit?.());
document.addEventListener('pointermove', (e) => activeMove?.(e));

// 올해 학년도 반만 다룬다 (지난 학년도 반은 기록 보존용으로 아래에 따로 보여 준다)
const thisYear = () => S.termOf(todayStr()).year;

export default function render(root) {
  const st = S.settings();
  const classes = S.classesOfYear(thisYear());
  if (brush !== 'erase' && !classes.some((c) => c.id === brush)) brush = classes[0]?.id || null;

  append(root,
    h('div', { class: 'page-head' }, h('h2', {}, '시간표 · 반')),
    h('div', { class: 'cols' },
      h('div', {},
        classes.length
          ? [brushBar(classes), grid(st)]
          : h('div', { class: 'empty' }, '오른쪽에서 먼저 수업하는 반을 추가하세요.'),
        h('p', { class: 'muted small' }, '위에서 반을 고르고 수업 있는 칸을 클릭하세요. 여러 칸을 드래그해서 한 번에 칠할 수도 있습니다. 같은 반이 칠해진 칸을 다시 클릭하면 지워집니다. 하루 교시 수와 토요일 수업은 설정에서 바꿀 수 있습니다.')),
      h('div', {}, classPanel(classes), changesPanel(), pastClassesPanel())));
}

// 날짜별 시간표 변경 내역 (오늘 이후)
function changesPanel() {
  const today = todayStr();
  const upcoming = S.data.timetable_changes.filter((c) => c.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date) || a.period - b.period);
  const byDate = new Map();
  for (const c of upcoming) {
    if (!byDate.has(c.date)) byDate.set(c.date, []);
    byDate.get(c.date).push(c);
  }
  return h('div', { class: 'card' },
    h('h3', {}, '날짜별 시간표 변경'),
    h('p', { class: 'muted small', style: { marginTop: 0 } }, "교체 · 보강 · 결강은 '오늘' 화면에서 날짜를 고른 뒤 '이날 시간표 바꾸기'로 입력합니다."),
    byDate.size
      ? [...byDate].map(([d, list]) => h('div', { style: { padding: '6px 0', borderTop: '1px solid var(--border)' } },
        h('a', { href: '#/today', onClick: (e) => { e.preventDefault(); showDate(d); } }, fmtDateLong(d)),
        list.map((c) => h('div', { class: 'small', style: { display: 'flex', gap: '6px', alignItems: 'center' } },
          h('span', {}, `${c.period}교시 → ${c.class_id ? S.classLabel(S.classById(c.class_id)) : '수업 없음'}${c.note ? ` (${c.note})` : ''}`),
          h('span', { class: 'grow' }),
          h('button', {
            class: 'icon-btn danger', title: '변경 취소 (주간 시간표대로)',
            onClick: async () => { try { await S.remove('timetable_changes', { id: c.id }); } catch (err) { showError(err); } },
          }, '✕')))))
      : h('p', { class: 'muted small' }, '예정된 변경이 없습니다.'));
}

function brushBar(classes) {
  const hours = (id) => S.data.timetable_slots.filter((s) => s.class_id === id).length;
  const pick = (id) => { brush = id; go('timetable'); };
  const clearAll = async () => {
    if (!S.data.timetable_slots.length) return;
    if (!await confirmDialog('시간표의 모든 칸을 비울까요? (수업 기록은 그대로 남습니다)', { okLabel: '모두 비우기' })) return;
    try {
      const { error } = await S.db.from('timetable_slots').delete().eq('user_id', S.session.user.id);
      if (error) throw error;
      await S.reload('timetable_slots');
    } catch (err) { showError(err); }
  };
  return h('div', { class: 'brush-bar' },
    classes.map((c) => h('button', {
      class: `brush ${brush === c.id ? 'active' : ''}`,
      style: { '--c': c.color },
      onClick: () => pick(c.id),
    }, h('span', { class: 'dot', style: { background: c.color } }), h('strong', {}, S.classLabel(c)), h('span', { class: 'muted small' }, ` · 주 ${hours(c.id)}`))),
    h('button', { class: `brush erase ${brush === 'erase' ? 'active' : ''}`, onClick: () => pick('erase') }, '지우개'),
    h('span', { class: 'grow' }),
    h('button', { class: 'btn btn-sm btn-danger', onClick: clearAll }, '모두 비우기'));
}

function grid(st) {
  const days = Array.from({ length: st.weekdays }, (_, i) => i + 1);
  const periods = Array.from({ length: st.periods }, (_, i) => i + 1);
  const slotAt = (wd, p) => S.data.timetable_slots.find((s) => s.weekday === wd && s.period === p);

  // 드래그하는 동안 바뀐 칸: key -> 반 id 또는 null(비우기)
  const pending = new Map();
  let mode = null; // 'paint' | 'erase'

  const show = (cell, classId) => {
    const cls = classId && S.classById(classId);
    cell.classList.toggle('filled', !!cls);
    cell.style.background = cls ? cls.color + '26' : '';
    cell.style.borderColor = cls ? cls.color + '66' : '';
    cell.replaceChildren(...(cls
      ? [h('div', { class: 'tt-name', style: { color: cls.color } }, cls.grade ? `${cls.grade}-${cls.room}` : cls.name), h('div', { class: 'tt-sub' }, cls.subject)]
      : []));
  };
  const current = (cell) => (pending.has(cell.dataset.key) ? pending.get(cell.dataset.key) : cell.dataset.classId || null);
  const apply = (cell) => {
    const next = mode === 'paint' ? brush : null;
    if (current(cell) === next) return;
    pending.set(cell.dataset.key, next);
    show(cell, next);
  };

  const commit = async () => {
    if (!mode) return;
    mode = null;
    document.body.classList.remove('painting');
    if (!pending.size) return;
    const upserts = [];
    const deletes = [];
    for (const [key, classId] of pending) {
      const [wd, p] = key.split('-').map(Number);
      const slot = slotAt(wd, p);
      if (classId) { if (slot?.class_id !== classId) upserts.push({ user_id: S.session.user.id, weekday: wd, period: p, class_id: classId }); }
      else if (slot) deletes.push(slot.id);
    }
    pending.clear();
    try {
      if (upserts.length) {
        const { error } = await S.db.from('timetable_slots').upsert(upserts, { onConflict: 'user_id,weekday,period' });
        if (error) throw error;
      }
      if (deletes.length) {
        const { error } = await S.db.from('timetable_slots').delete().in('id', deletes);
        if (error) throw error;
      }
    } catch (err) { showError(err); }
    await S.reload('timetable_slots');
  };
  activeCommit = commit;
  activeMove = (e) => {
    if (!mode) return;
    const target = document.elementFromPoint(e.clientX, e.clientY)?.closest('td.tt-cell');
    if (target) apply(target);
  };

  const cell = (wd, p) => {
    const slot = slotAt(wd, p);
    const el = h('td', { class: 'tt-cell', 'data-key': `${wd}-${p}`, 'data-class-id': slot?.class_id || '' });
    show(el, slot?.class_id);
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || !brush) return;
      e.preventDefault();
      // 이미 같은 반이 칠해진 칸에서 시작하면 지우기 모드
      mode = brush === 'erase' || current(el) === brush ? 'erase' : 'paint';
      document.body.classList.add('painting');
      apply(el);
    });
    return el;
  };

  const brushCls = brush !== 'erase' && S.classById(brush);
  return h('div', { class: 'table-wrap', style: { '--brush': brushCls ? brushCls.color : '#999' } },
    h('table', { class: 'tt tt-visual' },
      h('thead', {}, h('tr', {}, h('th', {}, ''), days.map((d) => h('th', {}, WEEKDAYS[d])))),
      h('tbody', {}, periods.map((p) => h('tr', {}, h('td', { class: 'period' }, `${p}교시`), days.map((d) => cell(d, p)))))));
}

// '1~5', '1-3', '1,3,5', '2' → [1,2,3,4,5] 등
function parseRooms(text) {
  const out = new Set();
  for (const part of text.split(/[,\s]+/).filter(Boolean)) {
    const m = /^(\d{1,2})\s*[~-]\s*(\d{1,2})$/.exec(part);
    if (m) for (let i = Number(m[1]); i <= Number(m[2]); i++) out.add(i);
    else if (/^\d{1,2}$/.test(part)) out.add(Number(part));
  }
  return [...out].filter((n) => n > 0);
}

const GRADES = [1, 2, 3, 4, 5, 6];

function classPanel(classes) {
  const subjects = S.subjects();

  const row = (c) => {
    const save = async (patch) => {
      try {
        const next = { ...c, ...patch };
        if (next.grade && next.room) patch.name = `${next.grade}학년 ${next.room}반`;
        await S.update('classes', c.id, patch);
      } catch (err) { showError(err); }
    };
    return h('div', { class: 'row class-row' },
      h('input', { type: 'color', value: c.color, onChange: (e) => save({ color: e.target.value }) }),
      h('select', { value: String(c.grade || ''), onChange: (e) => save({ grade: Number(e.target.value) || null }) },
        c.grade ? null : h('option', { value: '' }, c.name || '학년'),
        GRADES.map((g) => h('option', { value: String(g) }, `${g}학년`))),
      h('input', { type: 'number', min: 1, max: 30, value: c.room ?? '', placeholder: '반', style: { width: '56px' }, onChange: (e) => Number(e.target.value) > 0 && save({ room: Number(e.target.value) }) }),
      h('span', { class: 'small muted' }, '반'),
      h('input', { type: 'text', value: c.subject, list: 'subject-list', style: { width: '72px' }, onChange: (e) => e.target.value.trim() && save({ subject: e.target.value.trim() }) }),
      h('span', { class: 'grow' }),
      h('button', {
        class: 'icon-btn danger', title: '삭제',
        onClick: async () => {
          const n = S.data.lessons.filter((l) => l.class_id === c.id).length;
          const ok = await confirmDialog(`'${S.classLabel(c)}' 반을 삭제할까요?${n ? `\n⚠️ 이 반의 수업 기록 ${n}건과 반 메모도 함께 삭제됩니다.\n새 학년도가 되어도 지난 반은 지우지 않아도 됩니다. (자동으로 '지난 학년도 반'으로 넘어갑니다)` : ''}`);
          if (!ok) return;
          try { await S.remove('classes', { id: c.id }); toast('삭제했습니다.'); } catch (err) { showError(err); }
        },
      }, '✕'));
  };

  const last = classes[classes.length - 1];
  const grade = h('select', { value: String(last?.grade || 1) }, GRADES.map((g) => h('option', { value: String(g) }, `${g}학년`)));
  const rooms = h('input', { type: 'text', placeholder: '반 (예: 3 또는 1~5)', style: { width: '150px' } });
  const subject = h('input', { type: 'text', placeholder: '과목', list: 'subject-list', style: { width: '90px' }, value: last?.subject || subjects[0] || '' });
  const add = async (e) => {
    e.preventDefault();
    const g = Number(grade.value);
    const list = parseRooms(rooms.value);
    const sj = subject.value.trim();
    if (!list.length || !sj) return toast('반 번호와 과목을 입력하세요.', 'error');
    const year = thisYear();
    const exists = (r) => S.classesOfYear(year).some((c) => c.grade === g && c.room === r && c.subject === sj);
    const fresh = list.filter((r) => !exists(r));
    if (!fresh.length) return toast('이미 있는 반입니다.', 'error');
    try {
      let i = S.classesOfYear(year).length;
      await S.db.from('classes').insert(fresh.map((r) => ({
        name: `${g}학년 ${r}반`, grade: g, room: r, subject: sj, year, color: PALETTE[i++ % PALETTE.length], sort: i,
      })));
      rooms.value = '';
      toast(`${g}학년 ${fresh.join(', ')}반 ${sj}을(를) 추가했습니다.`, 'ok');
    } catch (err) { showError(err); }
  };

  return h('div', { class: 'card' },
    h('h3', {}, `${thisYear()}학년도 담당 반`),
    h('datalist', { id: 'subject-list' }, subjects.map((sj) => h('option', { value: sj }))),
    classes.length ? classes.map(row) : h('p', { class: 'muted' }, '아직 반이 없습니다.'),
    h('form', { class: 'row', style: { marginTop: '12px' }, onSubmit: add },
      grade, rooms, subject, h('button', { class: 'btn btn-primary', type: 'submit' }, '추가')),
    h('p', { class: 'muted small', style: { marginBottom: 0 } }, '반 칸에 1~5 처럼 쓰면 여러 반을 한 번에 추가합니다. 같은 반이라도 과목이 다르면 따로 추가하세요(예: 1학년 1반 국어, 1학년 1반 독서). 반은 학년도마다 따로 만들고, 지난 학년도 반의 기록은 그대로 남습니다.'));
}

// 지난 학년도 반: 기록을 볼 수 있게 링크만 둔다
function pastClassesPanel() {
  const years = [...new Set(S.data.classes.map(S.classYear))].filter((y) => y < thisYear()).sort((a, b) => b - a);
  if (!years.length) return null;
  return h('div', { class: 'card' },
    h('h3', {}, '지난 학년도 반'),
    years.map((y) => h('div', { class: 'row', style: { marginBottom: '6px' } },
      h('strong', { class: 'small' }, `${y}학년도`),
      S.classesOfYear(y).map((c) => h('a', { href: `#/class/${c.id}` }, S.classLabel(c))))));
}
