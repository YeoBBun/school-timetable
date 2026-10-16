// 단원 · 차시 (과목별 교육과정 목록)
import { h, append, toast, showError, modal, confirmDialog } from '../ui.js';
import * as S from '../store.js';
import { go } from '../app.js';

let subject = null;
const extraSubjects = new Set();

export default function render(root) {
  const list = [...new Set([...S.subjects(), ...extraSubjects])].sort((a, b) => a.localeCompare(b, 'ko'));
  if (!list.includes(subject)) subject = list[0] || null;

  const addSubject = () => {
    const input = h('input', { type: 'text', placeholder: '과목 이름' });
    modal('과목 추가', input, [
      { label: '취소' },
      {
        label: '추가', primary: true,
        onClick: () => {
          const v = input.value.trim();
          if (!v) return false;
          extraSubjects.add(v);
          subject = v;
          setTimeout(() => go('curriculum'), 0);
        },
      },
    ]);
  };

  append(root, 
    h('div', { class: 'page-head' },
      h('h2', {}, '단원 · 차시'),
      subject ? h('button', { class: 'btn', onClick: () => bulkDialog(subject) }, '여러 줄 한 번에 입력') : null),
    h('div', { class: 'tabs' },
      list.map((s) => h('button', { class: `tab ${s === subject ? 'active' : ''}`, onClick: () => { subject = s; go('curriculum'); } }, s)),
      h('button', { class: 'tab', onClick: addSubject }, '+ 과목')),
    subject ? editor(subject) : h('div', { class: 'empty' }, '시간표 · 반 화면에서 반을 추가하면 과목이 생깁니다. 또는 + 과목을 눌러 직접 추가하세요.'));
}

function editor(subj) {
  const items = S.itemsOf(subj);
  const usedCount = (id) => S.data.lessons.filter((l) => l.curriculum_item_id === id).length;

  // 단원별로 묶기 (순서 유지)
  const groups = [];
  for (const it of items) {
    const last = groups[groups.length - 1];
    if (last && last.unit === it.unit) last.items.push(it);
    else groups.push({ unit: it.unit, items: [it] });
  }

  const move = async (item, dir) => {
    const order = [...items];
    const i = order.indexOf(item);
    const j = i + dir;
    if (j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    await renumber(order);
  };

  const renameUnit = async (oldUnit, newUnit) => {
    if (newUnit === oldUnit) return;
    try {
      const { error } = await S.db.from('curriculum_items').update({ unit: newUnit }).eq('subject', subj).eq('unit', oldUnit);
      if (error) throw error;
      await S.reload('curriculum_items');
    } catch (err) { showError(err); }
  };

  let no = 0;
  const itemRow = (it) => {
    no += 1;
    const used = usedCount(it.id);
    return h('div', { class: 'item-row' },
      h('span', { class: 'no' }, `${no}`),
      h('input', {
        type: 'text', class: 'title', value: it.title,
        onChange: async (e) => {
          const v = e.target.value.trim();
          if (!v) { e.target.value = it.title; return; }
          try { await S.update('curriculum_items', it.id, { title: v }); } catch (err) { showError(err); }
        },
      }),
      S.materialsOfItem(it.id).length ? h('span', { class: 'badge', title: S.materialsOfItem(it.id).map((m) => m.name).join('\n') }, `자료 ${S.materialsOfItem(it.id).length}`) : null,
      used ? h('span', { class: 'badge badge-ok', title: '이 차시를 기록한 수업 수' }, `${used}회 수업`) : null,
      h('div', { class: 'actions' },
        h('button', { class: 'icon-btn', title: '위로', onClick: () => move(it, -1) }, '↑'),
        h('button', { class: 'icon-btn', title: '아래로', onClick: () => move(it, 1) }, '↓'),
        h('button', {
          class: 'icon-btn danger', title: '삭제',
          onClick: async () => {
            const ok = await confirmDialog(`'${it.title}' 차시를 삭제할까요?${used ? `\n이 차시로 기록된 수업 ${used}건은 '차시 없음'으로 바뀝니다.` : ''}`);
            if (!ok) return;
            try { await S.remove('curriculum_items', { id: it.id }, ['lessons', 'item_materials']); } catch (err) { showError(err); }
          },
        }, '✕')));
  };

  const lastUnit = items[items.length - 1]?.unit || '';
  const unitIn = h('input', { type: 'text', placeholder: '단원', value: lastUnit, style: { width: '220px' } });
  const titleIn = h('input', { type: 'text', placeholder: '차시 제목 (예: 시의 운율과 심상)', style: { flex: 1 } });
  const add = async (e) => {
    e.preventDefault();
    const title = titleIn.value.trim();
    if (!title) return;
    try {
      const maxSeq = items.reduce((m, i) => Math.max(m, i.seq), 0);
      await S.insert('curriculum_items', { subject: subj, unit: unitIn.value.trim(), title, seq: maxSeq + 10 });
      extraSubjects.delete(subj);
      setTimeout(() => document.querySelector('#add-item-title')?.focus(), 0);
    } catch (err) { showError(err); }
  };
  titleIn.id = 'add-item-title';

  return h('div', { style: { maxWidth: '860px' } },
    items.length
      ? groups.map((g) => h('div', { class: 'unit-group' },
        h('div', { class: 'unit-head' },
          h('input', { type: 'text', value: g.unit, placeholder: '(단원 없음)', title: '단원 이름 바꾸기', onChange: (e) => renameUnit(g.unit, e.target.value.trim()) }),
          h('span', { class: 'muted small' }, `${g.items.length}차시`)),
        g.items.map(itemRow)))
      : h('div', { class: 'empty', style: { marginBottom: '14px' } }, `${subj} 과목의 차시가 아직 없습니다. 아래에서 하나씩 추가하거나 '여러 줄 한 번에 입력'을 사용하세요.`),
    h('form', { class: 'card row', onSubmit: add }, unitIn, titleIn, h('button', { class: 'btn btn-primary', type: 'submit' }, '차시 추가')));
}

async function renumber(order) {
  const rows = order.map((it, i) => ({ ...it, seq: (i + 1) * 10 }));
  const changed = rows.filter((r, i) => r.seq !== order[i].seq);
  if (!changed.length) return;
  try {
    const { error } = await S.db.from('curriculum_items').upsert(changed);
    if (error) throw error;
    await S.reload('curriculum_items');
  } catch (err) { showError(err); }
}

function bulkDialog(subj) {
  const ta = h('textarea', {
    rows: 14,
    placeholder: '# 1. 문학과 삶\n시의 운율과 심상\n소설의 시점과 거리\n# 2. 언어와 매체\n음운의 변동\n...',
  });
  modal(`${subj} · 여러 줄 한 번에 입력`, [
    h('p', { class: 'muted small' }, "한 줄에 차시 하나씩 입력하세요. '#'으로 시작하는 줄은 단원 이름이 됩니다. 기존 목록 뒤에 추가됩니다. 엑셀에서 '단원 ⇥ 차시' 두 열을 복사해 붙여넣어도 됩니다."),
    ta,
  ], [
    { label: '취소' },
    {
      label: '추가', primary: true,
      onClick: async () => {
        const items = S.itemsOf(subj);
        let unit = items[items.length - 1]?.unit || '';
        let seq = items.reduce((m, i) => Math.max(m, i.seq), 0);
        const rows = [];
        for (const raw of ta.value.split(/\r?\n/)) {
          const line = raw.trim();
          if (!line) continue;
          if (line.startsWith('#')) { unit = line.replace(/^#+\s*/, ''); continue; }
          const cols = raw.split('\t').map((c) => c.trim());
          if (cols.length >= 2) {
            if (cols[0]) unit = cols[0];
            if (!cols[1]) continue;
            seq += 10;
            rows.push({ subject: subj, unit, title: cols[1], seq });
          } else {
            seq += 10;
            rows.push({ subject: subj, unit, title: line, seq });
          }
        }
        if (!rows.length) { toast('추가할 차시가 없습니다.', 'error'); return false; }
        await S.insert('curriculum_items', rows);
        toast(`${rows.length}개 차시를 추가했습니다.`, 'ok');
      },
    },
  ], { wide: true });
}
