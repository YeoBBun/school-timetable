// 반별 진도: 과목별로 반마다 어디까지 나갔는지 비교하고, 반별 수업 기록을 본다
import { h, append, fmtMD, WEEKDAYS, weekdayOf, classChip, downloadText, todayStr } from '../ui.js';
import * as S from '../store.js';
import { go } from '../app.js';
import { showDate } from './today.js';
import { openMaterial } from './materials.js';

let subject = null;
let logClassId = null;

export default function render(root) {
  const subjects = [...new Set(S.sortedClasses().map((c) => c.subject))];
  if (!subjects.includes(subject)) subject = subjects[0] || null;

  append(root, h('div', { class: 'page-head' }, h('h2', {}, '반별 진도')));
  if (!subject) {
    append(root, h('div', { class: 'empty' }, '시간표 · 반 화면에서 반을 추가하세요.'));
    return;
  }

  append(root, h('div', { class: 'tabs' },
    subjects.map((s) => h('button', { class: `tab ${s === subject ? 'active' : ''}`, onClick: () => { subject = s; go('progress'); } }, s))));

  const classes = S.sortedClasses(subject);
  const items = S.itemsOf(subject);
  const indexOf = new Map(items.map((it, i) => [it.id, i]));

  const stats = classes.map((c) => {
    const lessons = S.lessonsOfClass(c.id);
    const covered = new Map(); // itemId -> lessons[]
    for (const l of lessons) {
      if (!l.curriculum_item_id || !indexOf.has(l.curriculum_item_id)) continue;
      if (!covered.has(l.curriculum_item_id)) covered.set(l.curriculum_item_id, []);
      covered.get(l.curriculum_item_id).push(l);
    }
    let maxIdx = -1;
    for (const id of covered.keys()) maxIdx = Math.max(maxIdx, indexOf.get(id));
    return { cls: c, lessons, covered, maxIdx, last: lessons[lessons.length - 1] };
  });
  const lead = Math.max(-1, ...stats.map((s) => s.maxIdx));

  append(root, h('div', { class: 'summary-grid' }, stats.map((s) => {
    const cur = items[s.maxIdx];
    const pct = items.length ? ((s.maxIdx + 1) / items.length) * 100 : 0;
    const gap = lead - s.maxIdx;
    const skipped = s.maxIdx + 1 - s.covered.size;
    return h('div', { class: 'card summary-card' },
      h('div', { class: 'row' }, classChip(s.cls), h('span', { class: 'grow' }),
        gap > 0 ? h('span', { class: 'badge badge-warn' }, `${gap}차시 뒤`) : (lead >= 0 && stats.some((o) => o.maxIdx < lead) ? h('span', { class: 'badge badge-ok' }, '가장 앞') : null)),
      h('div', { class: 'cur', title: cur ? S.itemLabel(cur) : '' }, cur ? `${s.maxIdx + 1}. ${cur.title}` : '아직 기록 없음'),
      h('div', { class: 'bar' }, h('div', { style: { width: `${pct}%`, background: s.cls.color } })),
      h('div', { class: 'small muted' },
        `${s.maxIdx + 1} / ${items.length}차시 · 수업 ${s.lessons.length}회`,
        s.last ? ` · 최근 ${fmtMD(s.last.date)}` : '',
        skipped > 0 ? ` · 건너뜀 ${skipped}` : ''));
  })));

  // 차시 × 반 표
  if (items.length) {
    let unit = null;
    const rows = [];
    items.forEach((it, i) => {
      if (it.unit !== unit) {
        unit = it.unit;
        rows.push(h('tr', { class: 'unit-row' }, h('td', { colspan: classes.length + 2 }, unit || '(단원 없음)')));
      }
      rows.push(h('tr', {},
        h('td', { class: 'no' }, i + 1),
        h('td', {}, it.title),
        stats.map((s) => {
          const ls = s.covered.get(it.id);
          if (!ls) return h('td', { class: 'cell muted' }, i < s.maxIdx ? '–' : '');
          return h('td', {
            class: 'cell done',
            style: { background: s.cls.color + '1f', color: s.cls.color, cursor: 'pointer' },
            title: ls.map((l) => `${fmtMD(l.date)} ${l.period ? `${l.period}교시` : ''} ${l.memo}`).join('\n'),
            onClick: () => showDate(ls[0].date),
          }, ls.map((l) => fmtMD(l.date)).join(', '));
        })));
    });
    append(root, 
      h('div', { class: 'section-title' }, '차시별 진행 현황 (날짜를 누르면 그날 수업으로 이동)'),
      h('div', { class: 'table-wrap', style: { maxHeight: '60vh' } },
        h('table', { class: 'matrix' },
          h('thead', {}, h('tr', {}, h('th', {}, ''), h('th', { style: { textAlign: 'left' } }, '차시'), classes.map((c) => h('th', { style: { color: c.color } }, c.name)))),
          h('tbody', {}, rows))));
  } else {
    append(root, h('div', { class: 'empty' }, h('span', {}, `${subject} 과목의 단원 · 차시 목록을 먼저 만들면 반끼리 진도를 비교할 수 있습니다. `), h('a', { href: '#/curriculum' }, '단원 · 차시 입력하기')));
  }

  // 반별 수업 기록
  if (!classes.some((c) => c.id === logClassId)) logClassId = classes[0]?.id;
  const sel = stats.find((s) => s.cls.id === logClassId);
  append(root, 
    h('div', { class: 'section-title', style: { marginTop: '32px' } }, '반별 수업 기록'),
    h('div', { class: 'row', style: { marginBottom: '10px' } },
      h('div', { class: 'tabs', style: { margin: 0 } },
        classes.map((c) => h('button', { class: `tab ${c.id === logClassId ? 'active' : ''}`, onClick: () => { logClassId = c.id; go('progress'); } }, c.name))),
      h('span', { class: 'grow' }),
      sel?.lessons.length ? h('button', { class: 'btn btn-sm', onClick: () => exportCsv(sel) }, 'CSV 내보내기') : null),
    sel ? logList(sel) : null);
}

function logList(s) {
  if (!s.lessons.length) return h('div', { class: 'empty' }, '아직 기록한 수업이 없습니다.');
  const items = S.itemsOf(s.cls.subject);
  return h('div', { class: 'card' }, [...s.lessons].reverse().map((l) => {
    const it = S.itemById(l.curriculum_item_id);
    const no = it ? items.indexOf(it) + 1 : null;
    const mats = S.lessonAllMaterials(l);
    return h('div', { class: 'log-item' },
      h('div', {},
        h('a', { class: 'log-date', href: '#/today', onClick: (e) => { e.preventDefault(); showDate(l.date); } }, `${fmtMD(l.date)} (${WEEKDAYS[weekdayOf(l.date)]})`),
        h('div', { class: 'small muted' }, l.period ? `${l.period}교시` : '')),
      h('div', {},
        it ? h('div', {}, h('strong', {}, `${no}. ${it.title}`), it.unit ? h('span', { class: 'muted small' }, `  ${it.unit}`) : null)
          : h('div', { class: 'muted' }, '(차시 없음)'),
        l.memo ? h('div', { class: 'pre', style: { marginTop: '4px' } }, l.memo) : null,
        mats.length ? h('div', { class: 'mat-list', style: { marginTop: '6px' } },
          mats.map((m) => h('span', { class: 'mat-chip', style: { paddingRight: '9px' } }, h('a', { onClick: () => openMaterial(m) }, `${m.kind === 'link' ? '🔗' : '📄'} ${m.name}`)))) : null));
  }));
}

function exportCsv(s) {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [['날짜', '요일', '교시', '단원', '차시', '메모', '자료'].map(esc).join(',')];
  for (const l of s.lessons) {
    const it = S.itemById(l.curriculum_item_id);
    lines.push([l.date, WEEKDAYS[weekdayOf(l.date)], l.period ?? '', it?.unit ?? '', it?.title ?? '', l.memo, S.lessonAllMaterials(l).map((m) => m.name).join(' / ')].map(esc).join(','));
  }
  downloadText(`${s.cls.name}_${s.cls.subject}_진도_${todayStr()}.csv`, '﻿' + lines.join('\r\n'), 'text/csv');
}
