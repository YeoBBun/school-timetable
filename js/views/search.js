// 찾기: 수업 기록 · 자료 · 반 메모를 학년도와 상관없이 검색하고, 단원별로 모아 본다
import { h, append, fmtMD, classChip } from '../ui.js';
import * as S from '../store.js';
import { matLink, materialPlace, openMaterial } from './materials.js';
import { recordDialog, noteDialog } from './records.js';

const LIMIT = 200;
const state = { q: '', unitId: '' };

export default function render(root) {
  if (state.unitId && !S.unitById(state.unitId)) state.unitId = '';
  const results = h('div', {});
  const input = h('input', {
    type: 'search', class: 'search-big', value: state.q, placeholder: '예: 갈등, 활동지, 수행평가',
    onInput: (e) => { state.q = e.target.value; state.unitId = ''; draw(); },
  });
  const draw = () => results.replaceChildren(...(state.q.trim() || state.unitId ? found() : browse()));
  draw();
  append(root, h('div', { class: 'page-head' }, h('h2', {}, '찾기')), input, results);
  if (!state.q) setTimeout(() => input.focus(), 0);

  function pickUnit(u) {
    state.unitId = u.id;
    state.q = '';
    input.value = '';
    draw();
  }

  // 검색어가 없을 때: 학기마다 단원 목록
  function browse() {
    const terms = new Map();
    for (const u of S.data.units) {
      const k = `${u.year}-${u.semester}`;
      if (!terms.has(k)) terms.set(k, { year: u.year, semester: u.semester });
    }
    const list = [...terms.values()].sort((a, b) => b.year - a.year || b.semester - a.semester);
    if (!list.length) return [h('p', { class: 'muted' }, '검색어를 입력하세요. 단원을 만들어 두면 여기에서 단원별로 모아 볼 수 있습니다.')];
    return [h('div', { class: 'section-title' }, '단원별로 보기'), ...list.map((t) => h('div', { class: 'card' },
      h('h3', {}, S.termLabel(t)),
      h('div', { class: 'row' }, S.unitsOf(t).map((u) => {
        const n = S.data.lessons.filter((l) => l.unit_id === u.id).length;
        const m = S.data.materials.filter((x) => x.unit_id === u.id).length;
        return h('button', { class: 'btn', onClick: () => pickUnit(u) }, u.subject && S.subjectsOfYear(t.year).length > 1 ? `${u.subject} · ${u.name}` : u.name, h('span', { class: 'muted small' }, ` 기록 ${n} · 자료 ${m}`));
      }))))];
  }

  function found() {
    const q = state.q.trim().toLowerCase();
    const has = (s) => (s || '').toLowerCase().includes(q);
    const unitName = (id) => S.unitById(id)?.name || '';
    const unit = S.unitById(state.unitId);
    const lessons = S.data.lessons
      .filter((l) => (unit ? l.unit_id === unit.id : has(S.lessonText(l)) || has(unitName(l.unit_id))))
      .sort((a, b) => b.date.localeCompare(a.date) || (a.period ?? 99) - (b.period ?? 99));
    const mats = S.data.materials
      .filter((m) => (unit ? m.unit_id === unit.id : has(m.name) || has(unitName(m.unit_id))))
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    const notes = unit ? [] : S.data.class_notes.filter((n) => has(n.text));

    const out = [];
    if (unit) out.push(h('div', { class: 'banner banner-info' }, `${S.termLabel(unit)}${unit.subject ? ` ${unit.subject}` : ''} · ${unit.name} 단원`));
    out.push(h('div', { class: 'section-title' }, `수업 기록 ${lessons.length}개`));
    if (lessons.length) {
      const groups = [];
      for (const l of lessons.slice(0, LIMIT)) {
        const t = S.termOf(l.date);
        const g = groups[groups.length - 1];
        if (g && S.sameTerm(g.term, t)) g.list.push(l); else groups.push({ term: t, list: [l] });
      }
      out.push(...groups.map((g) => h('div', { class: 'card' },
        h('h3', {}, S.termLabel(g.term)),
        g.list.map((l) => h('div', { class: 'found-row clickable', onClick: (e) => { if (!e.target.closest('a')) recordDialog(l); } },
          h('span', { class: 'nowrap small muted', style: { width: '64px' } }, fmtMD(l.date)),
          classChip(S.classById(l.class_id), S.classLabel(S.classById(l.class_id))),
          h('span', { class: 'grow' }, S.lessonText(l), l.unit_id ? h('span', { class: 'muted small' }, `  · ${unitName(l.unit_id)}`) : null),
          h('div', { class: 'mat-list' }, S.materialsOfLesson(l.id).map(matLink)))))));
    }
    out.push(h('div', { class: 'section-title' }, `자료 ${mats.length}개`));
    if (mats.length) {
      out.push(h('div', { class: 'card' }, mats.slice(0, LIMIT).map((m) => {
        const used = S.lessonsOfMaterial(m.id);
        return h('div', { class: 'found-row clickable', onClick: () => openMaterial(m) },
          h('span', { class: 'grow' }, `${m.kind === 'link' ? '🔗' : '📄'} ${m.name}`),
          h('span', { class: 'muted small' }, materialPlace(m)),
          h('span', { class: 'muted small' }, used.length ? `${used.map((l) => `${fmtMD(l.date)} ${S.classLabel(S.classById(l.class_id))}`).slice(-3).join(', ')}${used.length > 3 ? ' …' : ''}` : '아직 안 씀'));
      })));
    }
    if (notes.length) {
      out.push(h('div', { class: 'section-title' }, `반 메모 ${notes.length}개`),
        h('div', { class: 'card' }, notes.map((n) => {
          const cls = S.classById(n.class_id);
          return h('div', { class: 'found-row clickable', onClick: () => cls && noteDialog(cls, n) },
            classChip(cls, S.classLabel(cls)), h('span', { class: `grow ${n.done ? 'muted' : ''}` }, n.text, n.done ? ' (끝냄)' : ''));
        })));
    }
    return out;
  }
}
