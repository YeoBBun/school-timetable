// 수업 기록 · 반 메모 공용 창 (첫 화면과 반 화면에서 함께 쓴다)
import { h, toast, showError, modal, confirmDialog, weekdayOf, fmtDateLong, fmtMD, todayStr, toDateStr } from '../ui.js';
import * as S from '../store.js';
import { attachDialog, matLink, unitSelect } from './materials.js';

// 그날 그 반의 시간표 교시 중 아직 기록이 없는 첫 교시 (없으면 null)
export function freePeriod(classId, date) {
  const off = S.data.days_off.some((d) => d.date === date);
  const periods = off ? [] : S.effectiveSlots(date, weekdayOf(date)).filter((s) => s.class_id === classId).map((s) => s.period);
  return periods.find((p) => !S.data.lessons.some((l) => l.class_id === classId && l.date === date && l.period === p)) ?? null;
}

export async function addRecord(cls, date, text, unitId) {
  return S.insert('lessons', { class_id: cls.id, date, period: freePeriod(cls.id, date), memo: text, unit_id: unitId || null });
}

export function recordDialog(l) {
  const cls = S.classById(l.class_id);
  const term = S.termOf(l.date);
  const st = { unitId: l.unit_id || '' };
  const date = h('input', { type: 'date', value: l.date });
  const period = h('input', { type: 'number', min: 1, max: 12, value: l.period ?? '', placeholder: '없음', style: { width: '90px' } });
  const text = h('input', { type: 'text', value: S.lessonText(l) });
  const unitBox = h('span', {});
  const drawUnit = () => unitBox.replaceChildren(unitSelect(term, cls?.subject, st.unitId, (v) => { st.unitId = v; drawUnit(); }));
  drawUnit();
  const mats = S.materialsOfLesson(l.id);
  const m = modal(`${S.classLabel(cls)} 수업 기록`, [
    h('label', {}, '한 일', text),
    h('div', { class: 'row' }, h('label', {}, '날짜', date), h('label', {}, '교시', period), h('label', {}, '단원', unitBox)),
    h('div', { class: 'section-title', style: { margin: '4px 0 0' } }, '붙인 자료'),
    mats.length
      ? h('div', { class: 'mat-list' }, mats.map((mt) => h('span', { class: 'mat-chip' }, matLink(mt),
        h('button', {
          class: 'icon-btn', title: '이 기록에서 빼기 (파일은 남음)',
          onClick: async (e) => { await S.remove('lesson_materials', { lesson_id: l.id, material_id: mt.id }); e.target.closest('.mat-chip').remove(); },
        }, '✕'))))
      : h('p', { class: 'muted small' }, '없음'),
    h('button', { class: 'btn', style: { alignSelf: 'flex-start' }, onClick: () => { m.close(); attachDialog(l); } }, '📎 자료 붙이기'),
  ], [
    {
      label: '기록 삭제', danger: true,
      onClick: async () => {
        if (!await confirmDialog('이 기록을 삭제할까요? (붙인 자료 파일은 자료실에 남습니다)')) return false;
        await S.remove('lessons', { id: l.id });
      },
    },
    { label: '취소' },
    {
      label: '저장', primary: true,
      onClick: async () => {
        if (!date.value) { toast('날짜를 고르세요.'); return false; }
        await S.update('lessons', l.id, { date: date.value, period: period.value ? Number(period.value) : null, memo: text.value.trim(), unit_id: st.unitId || null });
      },
    },
  ]);
}

// 반 메모: 그 반 전체에 대한 메모 (예: 숙제, 활동지 아직 안 걷음). 체크하면 끝난 메모로 넘어간다
// 반 메모 날짜 (예전 메모는 만든 시각으로)
export const noteDate = (n) => n.date || toDateStr(new Date(n.created_at));

export function noteDialog(cls, note = null) {
  const text = h('input', { type: 'text', value: note?.text || '', placeholder: '반 전체에 대한 메모 (예: 숙제 — 활동지 3쪽까지, 다음 시간 발표부터)' });
  const date = h('input', { type: 'date', value: note ? noteDate(note) : todayStr() });
  modal(`${S.classLabel(cls)} 반 메모`, [h('label', {}, '메모', text), h('label', {}, '날짜', date)], [
    note ? { label: '삭제', danger: true, onClick: () => S.remove('class_notes', { id: note.id }) } : null,
    { label: '취소' },
    {
      label: '저장', primary: true,
      onClick: async () => {
        const t = text.value.trim();
        if (!t) { toast('메모를 입력하세요.'); return false; }
        const d = date.value || todayStr();
        if (note) await S.update('class_notes', note.id, { text: t, date: d });
        else await S.insert('class_notes', { class_id: cls.id, text: t, date: d });
      },
    },
  ].filter(Boolean));
  // Enter 로 바로 저장
  text.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing) text.closest('.modal').querySelector('.btn-primary').click();
  });
}

export function noteItem(n, cls) {
  return h('div', { class: `note ${n.done ? 'done' : ''}` },
    h('input', {
      type: 'checkbox', checked: n.done, title: n.done ? '다시 열기' : '끝냄',
      onChange: (e) => S.update('class_notes', n.id, { done: e.target.checked, done_at: e.target.checked ? new Date().toISOString() : null }).catch(showError),
    }),
    h('span', { class: 'grow note-text', onClick: () => noteDialog(cls, n) }, h('span', { class: 'note-date' }, fmtMD(noteDate(n))), n.text));
}

export const fmtRecordDate = (l) => `${fmtDateLong(l.date)}${l.period ? ` ${l.period}교시` : ''}`;
