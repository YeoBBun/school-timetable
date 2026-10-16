// 오늘 수업: 시간표에 따라 그날의 수업이 나오고, 각 수업의 진도·메모·자료를 기록한다
import { h, append, toast, showError, modal, confirmDialog, todayStr, addDays, weekdayOf, fmtDateLong, fmtMD, mondayOf, WEEKDAYS, classChip } from '../ui.js';
import * as S from '../store.js';
import { supabase } from '../db.js';
import { go } from '../app.js';
import { openMaterial, openMaterialPicker } from './materials.js';

let date = todayStr();
// 저장 전 입력 내용 (화면이 다시 그려져도 유지)
const drafts = new Map();

export function showDate(d) {
  date = d;
  go('today');
}

const keyOf = (classId, d, period) => `${classId}|${d}|${period ?? ''}`;

export default function render(root) {
  const st = S.settings();
  const wd = weekdayOf(date);
  const off = S.data.days_off.find((d) => d.date === date);
  const dayLessons = S.data.lessons.filter((l) => l.date === date);
  const slots = off ? [] : S.effectiveSlots(date, wd);
  const changes = S.data.timetable_changes.filter((c) => c.date === date);

  const entries = slots.map((s) => ({
    class_id: s.class_id,
    period: s.period,
    changed: s.changed,
    note: s.note,
    lesson: dayLessons.find((l) => l.class_id === s.class_id && l.period === s.period),
  }));
  for (const l of dayLessons) {
    if (!entries.some((e) => e.lesson === l)) entries.push({ class_id: l.class_id, period: l.period, lesson: l, extra: true });
  }
  entries.sort((a, b) => (a.period ?? 99) - (b.period ?? 99));

  const dateInput = h('input', { type: 'date', value: date, onChange: (e) => e.target.value && showDate(e.target.value) });

  append(root, 
    h('div', { class: 'page-head' },
      h('h2', {}, fmtDateLong(date)),
      h('button', { class: 'btn', onClick: () => showDate(addDays(date, -1)) }, '◀'),
      h('button', { class: 'btn', onClick: () => showDate(todayStr()) }, '오늘'),
      h('button', { class: 'btn', onClick: () => showDate(addDays(date, 1)) }, '▶'),
      dateInput,
      S.data.classes.length && !off ? h('button', { class: 'btn btn-primary', onClick: () => changeDialog(date) }, '이날 시간표 바꾸기') : null),
    weekStrip(st),
    off ? h('div', { class: 'banner' }, `수업 없는 날${off.note ? ` · ${off.note}` : ''}`) : null,
    !off && changes.length
      ? h('div', { class: 'banner banner-info' },
        `이날은 시간표가 바뀌었습니다: ${changes.sort((a, b) => a.period - b.period).map((c) => `${c.period}교시 ${c.class_id ? S.classById(c.class_id)?.name || '' : '수업 없음'}`).join(', ')}`,
        h('button', { class: 'btn btn-sm', style: { marginLeft: '10px' }, onClick: () => changeDialog(date) }, '수정'))
      : null,
    entries.length
      ? entries.map(lessonCard)
      : h('div', { class: 'empty' },
        S.data.classes.length
          ? (off ? '등록된 수업이 없습니다.' : `${WEEKDAYS[wd]}요일 시간표에 수업이 없습니다.`)
          : '먼저 시간표 · 반 화면에서 반과 시간표를 입력하세요.'),
    S.data.classes.length
      ? h('div', { style: { marginTop: '14px' } }, h('button', { class: 'btn', onClick: addExtraDialog }, '+ 시간표에 없는 수업 기록 (보강 · 교체 등)'))
      : null);
}

function weekStrip(st) {
  const mon = mondayOf(date);
  const days = Array.from({ length: st.weekdays }, (_, i) => addDays(mon, i));
  const today = todayStr();
  return h('div', { class: 'week-strip', style: { '--days': st.weekdays } },
    days.map((d) => {
      const off = S.data.days_off.find((o) => o.date === d);
      const planned = off ? 0 : S.effectiveSlots(d, weekdayOf(d)).length;
      const changed = !off && S.data.timetable_changes.some((c) => c.date === d);
      const done = S.data.lessons.filter((l) => l.date === d).length;
      const cls = ['day-btn', d === date && 'active', d === today && 'today', off && 'off', changed && 'changed'].filter(Boolean).join(' ');
      return h('button', { class: cls, onClick: () => showDate(d) },
        h('div', { class: 'day-name' }, `${WEEKDAYS[weekdayOf(d)]} ${fmtMD(d)}`),
        h('div', { class: 'day-count' }, off ? (off.note || '휴업') : `기록 ${done} / ${planned}${changed ? ' · 변경' : ''}`));
    }));
}

// 이 수업 이전까지 가장 멀리 나간 차시의 다음 차시를 추천
function suggestNext(cls, period) {
  const items = S.itemsOf(cls.subject);
  if (!items.length) return '';
  const before = S.lessonsOfClass(cls.id).filter((l) =>
    l.curriculum_item_id && (l.date < date || (l.date === date && (l.period ?? 99) < (period ?? 99))));
  let maxIdx = -1;
  for (const l of before) maxIdx = Math.max(maxIdx, items.findIndex((i) => i.id === l.curriculum_item_id));
  return items[maxIdx + 1]?.id || '';
}

function lessonCard(e) {
  const cls = S.classById(e.class_id);
  if (!cls) return null;
  const key = keyOf(cls.id, date, e.period);
  const saved = e.lesson ? { itemId: e.lesson.curriculum_item_id || '', memo: e.lesson.memo || '' } : null;
  const d = drafts.get(key) || { ...(saved || { itemId: suggestNext(cls, e.period), memo: '' }) };
  const isDirty = () => !saved || d.itemId !== saved.itemId || d.memo !== saved.memo;

  const items = S.itemsOf(cls.subject);
  const doneOn = new Map();
  for (const l of S.lessonsOfClass(cls.id)) {
    if (l.curriculum_item_id && l !== e.lesson && !doneOn.has(l.curriculum_item_id)) doneOn.set(l.curriculum_item_id, l.date);
  }

  const groups = [];
  for (const it of items) {
    const g = groups[groups.length - 1];
    if (g && g.unit === it.unit) g.items.push(it);
    else groups.push({ unit: it.unit, items: [it] });
  }
  let n = 0;
  const select = h('select', {
    class: 'item-select', value: d.itemId,
    // 차시를 바꾸면 그 차시의 자료가 바로 보이도록 다시 그린다
    onChange: () => { d.itemId = select.value; drafts.set(key, d); go('today'); },
  },
  h('option', { value: '' }, items.length ? '— 차시 선택 안 함 —' : "— 아직 차시가 없습니다. '+ 새 차시'로 만드세요 —"),
  groups.map((g) => h('optgroup', { label: g.unit || '(단원 없음)' },
    g.items.map((it) => {
      n += 1;
      const done = doneOn.get(it.id);
      return h('option', { value: it.id }, `${n}. ${it.title}${done ? `  ✓ ${fmtMD(done)}` : ''}`);
    }))));

  const memo = h('textarea', {
    rows: 2, placeholder: '메모 (예: 활동지 2번까지, 다음 시간 발표 / 진도 대신 다른 활동 등)', value: d.memo,
    onInput: () => { d.memo = memo.value; touch(); },
  });

  const status = h('span', {});
  const saveBtn = h('button', { class: 'btn btn-primary', onClick: () => save() });
  const card = h('div', { class: 'card lesson-card' });

  function refreshState() {
    const dirty = isDirty();
    card.classList.toggle('recorded', !!e.lesson && !dirty);
    card.classList.toggle('dirty', dirty && (!!e.lesson || drafts.has(key)));
    saveBtn.textContent = e.lesson ? '수정 저장' : '진도 기록';
    saveBtn.disabled = !!e.lesson && !dirty;
    status.replaceChildren(
      e.lesson
        ? (dirty ? h('span', { class: 'badge badge-warn' }, '저장 안 됨') : h('span', { class: 'badge badge-ok' }, '기록됨'))
        : h('span', { class: 'badge' }, '미기록'));
  }
  function touch() {
    drafts.set(key, d);
    refreshState();
  }

  async function persist() {
    const row = { class_id: cls.id, date, period: e.period ?? null, curriculum_item_id: d.itemId || null, memo: d.memo.trim() };
    if (e.lesson) {
      await S.update('lessons', e.lesson.id, { ...row, updated_at: new Date().toISOString() });
      return e.lesson;
    }
    drafts.delete(key);
    return S.insert('lessons', row);
  }
  async function save() {
    saveBtn.disabled = true;
    try {
      drafts.delete(key);
      await persist();
      toast(`${cls.name} ${cls.subject} 기록을 저장했습니다.`, 'ok');
    } catch (err) {
      drafts.set(key, d);
      showError(err);
      saveBtn.disabled = false;
    }
  }

  const item = S.itemById(d.itemId);
  const shared = S.materialsOfItem(d.itemId);
  const attached = e.lesson ? S.materialsOfLesson(e.lesson.id).filter((m) => !shared.includes(m)) : [];
  const attach = () => openMaterialPicker({
    subject: cls.subject,
    item,
    exclude: [...shared, ...attached].map((m) => m.id),
    onPick: async (ids) => {
      const lesson = e.lesson || await persist();
      if (e.lesson && isDirty()) { drafts.delete(key); await persist(); }
      await S.upsert('lesson_materials', ids.map((id) => ({ lesson_id: lesson.id, material_id: id, user_id: S.session.user.id })), 'lesson_id,material_id');
    },
  });
  const unlinkShared = async (m) => {
    const ok = await confirmDialog(`'${m.name}'을(를) '${item.title}' 차시에서 뺄까요?
이 차시를 수업하는 모든 반에서 안 보이게 됩니다. (파일은 자료실에 남습니다)`, { okLabel: '빼기' });
    if (!ok) return;
    try { await S.remove('item_materials', { item_id: item.id, material_id: m.id }); } catch (err) { showError(err); }
  };
  const detach = async (m) => {
    try { await S.remove('lesson_materials', { lesson_id: e.lesson.id, material_id: m.id }); } catch (err) { showError(err); }
  };
  const del = async () => {
    if (!await confirmDialog('이 수업 기록을 삭제할까요? (첨부한 자료 파일은 자료실에 남습니다)')) return;
    try {
      drafts.delete(key);
      await S.remove('lessons', { id: e.lesson.id }, ['lesson_materials']);
    } catch (err) { showError(err); }
  };

  card.append(
    h('div', { class: 'period-box' },
      h('div', { class: 'num' }, e.period ?? '-'),
      h('div', { class: 'lbl' }, e.period ? '교시' : '')),
    h('div', { class: 'lesson-body' },
      h('div', { class: 'row' },
        classChip(cls), h('strong', {}, cls.subject),
        e.extra ? h('span', { class: 'badge' }, '시간표 외') : null,
        e.changed ? h('span', { class: 'badge badge-info', title: e.note || '' }, `시간표 변경${e.note ? ` · ${e.note}` : ''}`) : null,
        status,
        h('span', { class: 'grow' }),
        e.lesson ? h('button', { class: 'icon-btn danger', title: '기록 삭제', onClick: del }, '✕') : null),
      h('div', { class: 'row', style: { flexWrap: 'nowrap' } },
        select,
        h('button', { class: 'btn', title: '이 과목에 새 차시를 만들고 바로 선택합니다', onClick: () => newItemDialog(cls, (it) => { d.itemId = it.id; drafts.set(key, d); }) }, '+ 새 차시')),
      memo,
      h('div', { class: 'row' },
        h('div', { class: 'mat-list grow' },
          shared.length ? h('div', { class: 'mat-group' }, h('span', { class: 'lbl', title: '이 차시를 수업하는 모든 반에 보이는 자료' }, '차시 자료'),
            shared.map((m) => matChip(m, 'shared', '차시에서 빼기', () => unlinkShared(m)))) : null,
          attached.length ? h('div', { class: 'mat-group' }, h('span', { class: 'lbl' }, '이 반만'),
            attached.map((m) => matChip(m, '', '첨부 해제', () => detach(m)))) : null),
        h('button', { class: 'btn', onClick: attach }, '자료 첨부'),
        saveBtn)));
  refreshState();
  return card;
}

function matChip(m, cls, removeTitle, onRemove) {
  return h('span', { class: `mat-chip ${cls}` },
    h('a', { title: m.name, onClick: () => openMaterial(m) }, `${m.kind === 'link' ? '🔗' : '📄'} ${m.name}`),
    h('button', { class: 'icon-btn', title: removeTitle, onClick: onRemove }, '✕'));
}

// 수업하면서 바로 차시 만들기 (목록 맨 뒤에 추가)
function newItemDialog(cls, onCreated) {
  const items = S.itemsOf(cls.subject);
  const units = [...new Set(items.map((i) => i.unit).filter(Boolean))];
  const unit = h('input', { type: 'text', list: 'unit-list', value: items[items.length - 1]?.unit || '', placeholder: '단원 (비워도 됨)' });
  const title = h('input', { type: 'text', placeholder: '차시 제목 (예: 시의 운율과 심상)' });
  modal(`${cls.subject} · 새 차시`, [
    h('datalist', { id: 'unit-list' }, units.map((u) => h('option', { value: u }))),
    h('label', {}, '차시 제목', title),
    h('label', {}, '단원', unit),
    h('p', { class: 'muted small' }, '만든 차시는 다른 반에서도 고를 수 있고, 여기에 붙인 자료도 함께 보입니다.'),
  ], [
    { label: '취소' },
    {
      label: '만들기', primary: true,
      onClick: async () => {
        const t = title.value.trim();
        if (!t) { toast('차시 제목을 입력하세요.', 'error'); return false; }
        const it = await S.addItem(cls.subject, unit.value.trim(), t);
        onCreated(it);
      },
    },
  ]);
  title.focus();
}

// 이날 시간표 바꾸기: 교시마다 '주간 시간표대로 / 수업 없음 / 다른 반'을 고른다
function changeDialog(d) {
  if (S.missingTables.has('timetable_changes')) {
    toast('시간표 변경 기능을 쓰려면 Supabase SQL Editor에서 supabase/migration_01_timetable_changes.sql 을 먼저 실행하세요.', 'error');
    return;
  }
  const st = S.settings();
  const wd = weekdayOf(d);
  const classes = S.sortedClasses();
  const base = new Map(S.data.timetable_slots.filter((s) => s.weekday === wd).map((s) => [s.period, s.class_id]));
  const existing = new Map(S.data.timetable_changes.filter((c) => c.date === d).map((c) => [c.period, c]));
  const maxPeriod = Math.max(st.periods, ...existing.keys(), ...base.keys());
  const label = (id) => { const c = S.classById(id); return c ? `${c.name} ${c.subject}` : ''; };

  const rows = [];
  for (let p = 1; p <= maxPeriod; p++) {
    const ch = existing.get(p);
    const value = ch ? (ch.class_id || 'none') : 'base';
    const select = h('select', { value },
      h('option', { value: 'base' }, base.get(p) ? `주간 시간표대로 (${label(base.get(p))})` : '주간 시간표대로 (수업 없음)'),
      base.get(p) ? h('option', { value: 'none' }, '수업 없음 (결강 · 교체로 빠짐)') : null,
      classes.map((c) => h('option', { value: c.id }, `${c.name} ${c.subject}${c.id === base.get(p) ? '' : ' 로 바꾸기'}`)));
    const note = h('input', { type: 'text', placeholder: '사유 (예: 교체, 보강, 행사)', value: ch?.note || '', style: { flex: 1 } });
    const row = h('div', { class: 'change-row' }, h('strong', { class: 'period-lbl' }, `${p}교시`), select, note);
    const mark = () => row.classList.toggle('changed', select.value !== 'base');
    select.addEventListener('change', mark);
    mark();
    rows.push({ p, select, note });
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
      upserts.push({ user_id: S.session.user.id, date: d, period: p, class_id: classId, note: note.value.trim() });
    }
    if (upserts.length) {
      const { error } = await supabase.from('timetable_changes').upsert(upserts, { onConflict: 'user_id,date,period' });
      if (error) throw error;
    }
    if (deletes.length) {
      const { error } = await supabase.from('timetable_changes').delete().in('id', deletes);
      if (error) throw error;
    }
    await S.reload('timetable_changes');
    toast(upserts.length ? `${fmtDateLong(d)} 시간표를 바꿨습니다.` : '주간 시간표대로 되돌렸습니다.', 'ok');
  };

  modal(`${fmtDateLong(d)} 시간표 바꾸기`, [
    h('p', { class: 'muted small' }, '이날만 바뀌는 교시를 고르세요. 다른 날의 시간표에는 영향이 없습니다.'),
    rows.map((r) => r.select.parentElement),
  ], [
    existing.size ? { label: '모두 주간 시간표대로', danger: true, onClick: async () => { rows.forEach((r) => { r.select.value = 'base'; }); await save(); } } : null,
    { label: '취소' },
    { label: '저장', primary: true, onClick: save },
  ].filter(Boolean), { wide: true });
}

function addExtraDialog() {
  const classes = S.sortedClasses();
  const cls = h('select', {}, classes.map((c) => h('option', { value: c.id }, `${c.name} ${c.subject}`)));
  const period = h('input', { type: 'number', min: 1, max: 12, placeholder: '교시 (비워도 됨)' });
  modal(`${fmtDateLong(date)} 수업 추가`, [
    h('label', {}, '반', cls),
    h('label', {}, '교시', period),
  ], [
    { label: '취소' },
    {
      label: '추가', primary: true,
      onClick: async () => {
        const c = S.classById(cls.value);
        const p = period.value ? Number(period.value) : null;
        if (S.data.lessons.some((l) => l.class_id === c.id && l.date === date && l.period === p)) {
          toast('이미 같은 교시 기록이 있습니다.', 'error');
          return false;
        }
        await S.insert('lessons', { class_id: c.id, date, period: p, curriculum_item_id: suggestNext(c, p) || null, memo: '' });
      },
    },
  ]);
}
