// 반 화면: 탭으로 기록 · 학생 · 수행평가 · 조 편성 · 칭찬 스티커 · 과세특
import { h, append, fmtMD, todayStr, classChip, downloadText } from '../ui.js';
import * as S from '../store.js';
import { matLink } from './materials.js';
import { recordDialog, noteDialog, noteItem } from './records.js';
import { renderStudentsTab } from './students.js';
import { renderClassAssess } from './assess.js';
import { renderGroupsTab } from './groups.js';
import { renderStickersTab } from './stickers.js';
import { renderSeteukTab } from './seteuk.js';

const TABS = [
  { key: 'records', label: '수업 기록', view: renderRecords },
  { key: 'students', label: '학생', view: renderStudentsTab },
  { key: 'assess', label: '수행평가', view: renderClassAssess },
  { key: 'groups', label: '조 편성', view: renderGroupsTab },
  { key: 'stickers', label: '칭찬 스티커', view: renderStickersTab },
  { key: 'seteuk', label: '과세특', view: renderSeteukTab },
];

export default function render(root, id, sub) {
  const cls = S.classById(id);
  if (!cls) {
    append(root, h('div', { class: 'empty' }, '반을 찾을 수 없습니다. ', h('a', { href: '#/today' }, '홈으로')));
    return;
  }
  const tab = TABS.find((t) => t.key === sub) || TABS[0];
  const body = h('div', {});
  append(root,
    h('div', { class: 'page-head' },
      h('h2', { class: 'row' }, classChip(cls, S.classLabel(cls)), h('span', { class: 'muted small' }, [`${S.classYear(cls)}학년도`, cls.subject].filter(Boolean).join(' · '))),
      h('a', { class: 'btn', href: '#/today' }, '← 홈')),
    h('div', { class: 'tabs' }, TABS.map((t) => h('a', { class: `tab ${t === tab ? 'active' : ''}`, href: `#/class/${cls.id}/${t.key}` }, t.label))),
    body);
  tab.view(body, cls);
}

function renderRecords(root, cls) {
  const lessons = S.lessonsOfClass(cls.id).reverse();
  const notes = S.notesOfClass(cls.id);
  const open = notes.filter((n) => !n.done);
  const done = notes.filter((n) => n.done).reverse();

  // 학기마다 묶는다 (최근 학기부터)
  const groups = [];
  for (const l of lessons) {
    const t = S.termOf(l.date);
    const g = groups[groups.length - 1];
    if (g && S.sameTerm(g.term, t)) g.list.push(l);
    else groups.push({ term: t, list: [l] });
  }

  append(root,
    lessons.length ? h('div', { class: 'row', style: { justifyContent: 'flex-end', marginBottom: '10px' } }, h('button', { class: 'btn', onClick: () => exportCsv(cls) }, 'CSV 내려받기')) : null,
    h('div', { class: 'cols' },
      h('div', {},
        groups.length
          ? groups.map((g) => h('div', { class: 'card' },
            h('h3', {}, S.termLabel(g.term), h('span', { class: 'muted small' }, `  기록 ${g.list.length}개`)),
            h('table', { class: 'table rec-table' },
              h('thead', {}, h('tr', {}, h('th', {}, '날짜'), h('th', {}, '단원'), h('th', {}, '한 일'), h('th', {}, '자료'))),
              h('tbody', {}, g.list.map((l) => h('tr', { class: 'clickable', onClick: (e) => { if (!e.target.closest('a')) recordDialog(l); } },
                h('td', { class: 'nowrap' }, `${fmtMD(l.date)}${l.period ? ` ${l.period}교시` : ''}`),
                h('td', { class: 'small muted' }, S.unitById(l.unit_id)?.name || ''),
                h('td', {}, S.lessonText(l)),
                h('td', {}, h('div', { class: 'mat-list' }, S.materialsOfLesson(l.id).map(matLink)))))))))
          : h('div', { class: 'empty' }, '아직 기록이 없습니다. 홈 화면의 이 반 칸에 한 줄씩 적어 보세요.')),
      h('div', {},
        h('div', { class: 'card' },
          h('div', { class: 'row' }, h('h3', { style: { margin: 0 } }, '반 메모'), h('span', { class: 'grow' }),
            h('button', { class: 'btn btn-sm', onClick: () => noteDialog(cls) }, '+ 메모')),
          h('div', { class: 'notes', style: { marginTop: '10px' } },
            open.length ? open.map((n) => noteItem(n, cls)) : h('p', { class: 'muted small' }, '남은 메모가 없습니다.')),
          done.length ? h('details', { class: 'done-notes' }, h('summary', { class: 'small muted' }, `끝낸 메모 ${done.length}개`),
            h('div', { class: 'notes' }, done.map((n) => noteItem(n, cls)))) : null))));
}

function exportCsv(cls) {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [['날짜', '교시', '단원', '한 일', '자료']];
  for (const l of S.lessonsOfClass(cls.id)) {
    rows.push([l.date, l.period ?? '', S.unitById(l.unit_id)?.name || '', S.lessonText(l), S.materialsOfLesson(l.id).map((m) => m.name).join(', ')]);
  }
  // 엑셀에서 한글이 깨지지 않도록 BOM 을 붙인다
  downloadText(`${S.classLabel(cls)}-수업기록-${todayStr()}.csv`, `﻿${rows.map((r) => r.map(esc).join(',')).join('\r\n')}`, 'text/csv');
}
