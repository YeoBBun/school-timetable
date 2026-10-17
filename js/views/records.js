// 수업 기록 · 반 메모 공용 창 (첫 화면과 반 화면에서 함께 쓴다)
import { h, toast, showError, modal, confirmDialog, weekdayOf, fmtDateLong } from '../ui.js';
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

// 같은 내용을 다른 반에도 기록한다 (자료도 함께)
export function copyDialog(l) {
  const src = S.classById(l.class_id);
  const others = S.classesOfYear(S.classYear(src)).filter((c) => c.id !== src.id);
  const mats = S.materialsOfLesson(l.id);
  const date = h('input', { type: 'date', value: l.date });
  const picked = new Set();
  const withMats = h('input', { type: 'checkbox', checked: true });
  modal(`'${S.lessonText(l)}' 다른 반에도 쓰기`, [
    h('div', { class: 'row' }, others.map((c) => h('label', { class: 'inline check-chip' },
      h('input', { type: 'checkbox', onChange: (e) => (e.target.checked ? picked.add(c.id) : picked.delete(c.id)) }), S.classLabel(c)))),
    h('label', {}, '날짜', date),
    mats.length ? h('label', { class: 'inline' }, withMats, `붙인 자료 ${mats.length}개도 함께`) : null,
  ], [
    { label: '취소' },
    {
      label: '기록하기', primary: true,
      onClick: async () => {
        if (!picked.size) { toast('반을 고르세요.'); return false; }
        if (!date.value) return false;
        for (const id of picked) {
          const rec = await addRecord(S.classById(id), date.value, S.lessonText(l), l.unit_id);
          if (mats.length && withMats.checked) {
            await S.upsert('lesson_materials', mats.map((mt) => ({ lesson_id: rec.id, material_id: mt.id })), 'lesson_id,material_id');
          }
        }
        toast(`${picked.size}개 반에 기록했습니다.`, 'ok');
      },
    },
  ]);
}

// 반 메모 (예: 활동지 아직 안 걷음). 체크하면 끝난 메모로 넘어간다
export function noteDialog(cls, note = null) {
  const text = h('input', { type: 'text', value: note?.text || '', placeholder: '예: 활동지 아직 안 걷음, 다음 시간 발표부터' });
  modal(`${S.classLabel(cls)} 반 메모`, [h('label', {}, '메모', text)], [
    note ? { label: '삭제', danger: true, onClick: () => S.remove('class_notes', { id: note.id }) } : null,
    { label: '취소' },
    {
      label: '저장', primary: true,
      onClick: async () => {
        const t = text.value.trim();
        if (!t) { toast('메모를 입력하세요.'); return false; }
        if (note) await S.update('class_notes', note.id, { text: t });
        else await S.insert('class_notes', { class_id: cls.id, text: t });
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
    h('span', { class: 'grow note-text', onClick: () => noteDialog(cls, n) }, n.text));
}

export const fmtRecordDate = (l) => `${fmtDateLong(l.date)}${l.period ? ` ${l.period}교시` : ''}`;
