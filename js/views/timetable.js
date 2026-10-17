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
          h('span', {}, `${c.period}교시 → ${c.class_id ? S.classById(c.class_id)?.name || '' : '수업 없음'}${c.note ? ` (${c.note})` : ''}`),
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
    }, h('span', { class: 'dot', style: { background: c.color } }), h('strong', {}, c.name), ` ${c.subject}`, h('span', { class: 'muted small' }, ` · 주 ${hours(c.id)}`))),
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
      ? [h('div', { class: 'tt-name', style: { color: cls.color } }, cls.name), h('div', { class: 'tt-sub' }, cls.subject)]
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

function classPanel(classes) {
  const hours = (id) => S.data.timetable_slots.filter((s) => s.class_id === id).length;
  const subjects = S.subjects();

  const row = (c) => {
    const save = async (patch) => {
      try { await S.update('classes', c.id, patch); } catch (err) { showError(err); }
    };
    return h('div', { class: 'row', style: { padding: '6px 0', borderBottom: '1px solid var(--border)' } },
      h('input', { type: 'color', value: c.color, onChange: (e) => save({ color: e.target.value }) }),
      h('input', { type: 'text', value: c.name, style: { width: '80px' }, onChange: (e) => e.target.value.trim() && save({ name: e.target.value.trim() }) }),
      h('input', { type: 'text', value: c.subject, list: 'subject-list', style: { width: '90px' }, onChange: (e) => e.target.value.trim() && save({ subject: e.target.value.trim() }) }),
      h('span', { class: 'muted small grow', style: { whiteSpace: 'nowrap' } }, `주 ${hours(c.id)}시간`),
      h('button', {
        class: 'icon-btn danger', title: '삭제',
        onClick: async () => {
          const n = S.data.lessons.filter((l) => l.class_id === c.id).length;
          const ok = await confirmDialog(`'${c.name} ${c.subject}' 반을 삭제할까요?${n ? `\n⚠️ 이 반의 수업 기록 ${n}건과 반 메모도 함께 삭제됩니다.\n새 학년도가 되어도 지난 반은 지우지 않아도 됩니다. (자동으로 '지난 학년도 반'으로 넘어갑니다)` : ''}`);
          if (!ok) return;
          try { await S.remove('classes', { id: c.id }, ['timetable_slots', 'lessons', 'lesson_materials']); toast('삭제했습니다.'); } catch (err) { showError(err); }
        },
      }, '✕'));
  };

  const name = h('input', { type: 'text', placeholder: '반 (예: 2-3)', style: { width: '110px' } });
  const subject = h('input', { type: 'text', placeholder: '과목', list: 'subject-list', style: { width: '100px' }, value: subjects[0] || '' });
  const add = async (e) => {
    e.preventDefault();
    const n = name.value.trim();
    const s = subject.value.trim();
    if (!n || !s) return toast('반 이름과 과목을 입력하세요.', 'error');
    try {
      await S.insert('classes', { name: n, subject: s, year: thisYear(), color: PALETTE[classes.length % PALETTE.length], sort: classes.length });
      toast(`${n} ${s} 반을 추가했습니다.`, 'ok');
    } catch (err) { showError(err); }
  };

  return h('div', { class: 'card' },
    h('h3', {}, `${thisYear()}학년도 담당 반`),
    h('datalist', { id: 'subject-list' }, subjects.map((s) => h('option', { value: s }))),
    classes.length ? classes.map(row) : h('p', { class: 'muted' }, '아직 반이 없습니다.'),
    h('form', { class: 'row', style: { marginTop: '12px' }, onSubmit: add },
      name, subject, h('button', { class: 'btn btn-primary', type: 'submit' }, '추가')),
    h('p', { class: 'muted small', style: { marginBottom: 0 } }, '같은 반이라도 과목이 다르면 따로 추가하세요. 반은 학년도마다 따로 만들고, 지난 학년도 반의 기록은 그대로 남습니다.'));
}

// 지난 학년도 반: 기록을 볼 수 있게 링크만 둔다
function pastClassesPanel() {
  const years = [...new Set(S.data.classes.map(S.classYear))].filter((y) => y < thisYear()).sort((a, b) => b - a);
  if (!years.length) return null;
  return h('div', { class: 'card' },
    h('h3', {}, '지난 학년도 반'),
    years.map((y) => h('div', { class: 'row', style: { marginBottom: '6px' } },
      h('strong', { class: 'small' }, `${y}학년도`),
      S.classesOfYear(y).map((c) => h('a', { href: `#/class/${c.id}` }, c.name)))));
}
