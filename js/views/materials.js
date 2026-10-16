// 수업 자료: 구글 드라이브 '진도관리/수업 자료' 폴더에 업로드 · 링크 · 검색 · 수업에 첨부
import { h, append, toast, showError, modal, confirmDialog, fmtSize, fmtMD } from '../ui.js';
import * as G from '../google.js';
import * as S from '../store.js';
import { showDate } from './today.js';

const filter = { subject: '', itemId: '', q: '' };

// ---- 공용 함수 (오늘 수업 화면에서도 사용) ----

export async function uploadFiles(files, { subject = null, itemId = null } = {}) {
  const list = [...files];
  const created = [];
  for (let i = 0; i < list.length; i++) {
    const f = list[i];
    const t = toast(`드라이브에 올리는 중 (${i + 1}/${list.length}) ${f.name}`);
    try {
      const up = await G.uploadFile(f, S.drive.materialsId, (p) => { t.textContent = `드라이브에 올리는 중 (${i + 1}/${list.length}) ${f.name} · ${Math.round(p * 100)}%`; });
      created.push(await S.insert('materials', {
        name: f.name, kind: 'file', drive_id: up.id, url: up.webViewLink || G.fileViewUrl(up.id), size: f.size, mime: f.type || null, subject,
      }));
    } catch (err) {
      showError(new Error(`${f.name}: ${err.message}`));
    } finally {
      t.remove();
    }
  }
  await S.linkItemMaterials(itemId, created.map((m) => m.id));
  if (created.length) toast(`${created.length}개 파일을 드라이브에 올렸습니다.`, 'ok');
  return created;
}

export function openMaterial(m, download = false) {
  if (m.kind === 'link') { window.open(m.url, '_blank', 'noopener'); return; }
  if (!m.drive_id) { toast('파일 위치를 찾을 수 없습니다.', 'error'); return; }
  window.open(download ? G.fileDownloadUrl(m.drive_id) : (m.url || G.fileViewUrl(m.drive_id)), '_blank', 'noopener');
}

export function linkDialog({ subject = null, itemId = null } = {}) {
  return new Promise((resolve) => {
    const url = h('input', { type: 'url', placeholder: 'https://…' });
    const name = h('input', { type: 'text', placeholder: '이름 (예: 수업 영상, 패들렛)' });
    let result = null;
    const m = modal('링크 추가', [h('label', {}, '주소', url), h('label', {}, '이름', name)], [
      { label: '취소' },
      {
        label: '추가', primary: true,
        onClick: async () => {
          let u = url.value.trim();
          if (!u) return false;
          if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
          result = await S.insert('materials', { name: name.value.trim() || u, kind: 'link', url: u, subject });
          await S.linkItemMaterials(itemId, [result.id]);
        },
      },
    ]);
    new MutationObserver((_, obs) => { if (!m.overlay.isConnected) { obs.disconnect(); resolve(result); } })
      .observe(document.body, { childList: true });
  });
}

async function deleteMaterial(m) {
  const used = S.itemsOfMaterial(m.id).length + S.data.lesson_materials.filter((lm) => lm.material_id === m.id).length;
  const ok = await confirmDialog(`'${m.name}'을(를) 삭제할까요?${used ? `\n붙어 있던 차시 · 수업 ${used}곳에서도 빠집니다.` : ''}\n파일은 구글 드라이브 휴지통으로 이동합니다 (30일 안에 되살릴 수 있음).`);
  if (!ok) return;
  try {
    if (m.kind === 'file' && m.drive_id) await G.trashFile(m.drive_id);
    await S.remove('materials', { id: m.id });
    toast('삭제했습니다.');
  } catch (err) { showError(err); }
}

function itemSelect(subject, value, onChange, emptyLabel = '— 차시 지정 안 함 —') {
  const items = subject ? S.itemsOf(subject) : [];
  return h('select', { value: value || '', onChange: (e) => onChange(e.target.value), disabled: !subject },
    h('option', { value: '' }, emptyLabel),
    items.map((it, i) => h('option', { value: it.id }, `${i + 1}. ${S.itemLabel(it)}`)));
}

function subjectSelect(value, onChange, emptyLabel = '— 과목 없음 —') {
  return h('select', { value: value || '', onChange: (e) => onChange(e.target.value) },
    h('option', { value: '' }, emptyLabel),
    S.subjects().map((s) => h('option', { value: s }, s)));
}

function fileInput(onFiles) {
  const input = h('input', { type: 'file', multiple: true, style: { display: 'none' }, onChange: () => { onFiles(input.files); input.value = ''; } });
  const zone = h('div', {
    class: 'dropzone',
    onClick: () => input.click(),
    onDragover: (e) => { e.preventDefault(); zone.classList.add('over'); },
    onDragleave: () => zone.classList.remove('over'),
    onDrop: (e) => { e.preventDefault(); zone.classList.remove('over'); if (e.dataTransfer.files.length) onFiles(e.dataTransfer.files); },
  }, '여기로 파일을 끌어다 놓거나 클릭해서 선택 (구글 드라이브에 저장됩니다)', input);
  return zone;
}

// 수업에 자료 첨부: 새로 올리기 / 자료실에서 고르기 / 링크
// 기본은 차시에 붙여서 그 차시를 수업하는 모든 반에 보이게 한다.
// 차시가 없거나 '이 반만'을 고르면 onPick 으로 이 수업 기록에만 붙인다.
export function openMaterialPicker({ subject, item, exclude = [], onPick }) {
  let shared = !!item;
  let scope = 'subject';
  const chosen = new Set();
  const listBox = h('div', { class: 'picker-list' });
  const search = h('input', { type: 'search', placeholder: '이름 검색', style: { flex: 1 }, onInput: () => drawList() });

  const scopeSel = h('select', { value: scope, onChange: (e) => { scope = e.target.value; drawList(); } },
    h('option', { value: 'subject' }, `${subject} 자료`),
    h('option', { value: 'all' }, '모든 자료'));

  const modeBox = item
    ? h('div', { class: 'mode-box' },
      h('label', {}, h('input', { type: 'radio', name: 'mat-mode', checked: true, onChange: () => { shared = true; } }),
        h('span', {}, h('strong', {}, `'${item.title}' 차시에 붙이기`), h('span', { class: 'muted small' }, ' · 이 차시를 수업하는 모든 반에 자동으로 보입니다 (추천)'))),
      h('label', {}, h('input', { type: 'radio', name: 'mat-mode', onChange: () => { shared = false; } }),
        h('span', {}, h('strong', {}, '이 반 수업에만 붙이기'), h('span', { class: 'muted small' }, ' · 예: 이 반 활동 결과물'))))
    : h('div', { class: 'banner', style: { margin: 0 } }, '차시를 고르지 않아서 이 반 수업에만 붙습니다. 차시를 먼저 고르면 다른 반에도 자동으로 보입니다.');

  function drawList() {
    const q = search.value.trim().toLowerCase();
    const rows = S.data.materials
      .filter((m) => !exclude.includes(m.id))
      .filter((m) => scope === 'all' || m.subject === subject)
      .filter((m) => !q || m.name.toLowerCase().includes(q))
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    listBox.replaceChildren(...(rows.length
      ? rows.map((m) => {
        const its = S.itemsOfMaterial(m.id);
        return h('label', {},
          h('input', { type: 'checkbox', checked: chosen.has(m.id), onChange: (e) => (e.target.checked ? chosen.add(m.id) : chosen.delete(m.id)) }),
          h('span', { class: 'grow' }, `${m.kind === 'link' ? '🔗' : '📄'} ${m.name}`,
            its.length ? h('span', { class: 'muted small' }, `  · ${its.map((i) => i.title).join(', ')}`) : null),
          h('span', { class: 'muted small' }, m.kind === 'file' ? fmtSize(m.size) : '링크'));
      })
      : [h('div', { class: 'muted', style: { padding: '16px', textAlign: 'center' } }, '해당하는 자료가 없습니다.')]));
  }

  const finish = async (ids, close) => {
    if (!ids.length) return;
    try {
      if (shared) await S.linkItemMaterials(item.id, ids);
      else await onPick(ids);
      toast(shared ? `'${item.title}' 차시에 자료 ${ids.length}개를 붙였습니다. 다른 반에도 보입니다.` : `자료 ${ids.length}개를 첨부했습니다.`, 'ok');
      close();
    } catch (err) { showError(err); }
  };

  let m;
  const zone = fileInput(async (files) => {
    const created = await uploadFiles(files, { subject });
    await finish(created.map((x) => x.id), m.close);
  });

  m = modal('자료 첨부', [
    modeBox,
    h('div', { class: 'section-title', style: { margin: 0 } }, '새 파일 올리기'),
    zone,
    h('button', {
      class: 'btn', style: { alignSelf: 'flex-start' },
      onClick: async () => { const r = await linkDialog({ subject }); if (r) await finish([r.id], m.close); },
    }, '🔗 링크로 첨부'),
    h('div', { class: 'section-title', style: { marginBottom: 0 } }, '자료실에서 고르기'),
    h('div', { class: 'row' }, scopeSel, search),
    listBox,
  ], [
    { label: '취소' },
    { label: '선택한 자료 첨부', primary: true, onClick: async (close) => { if (!chosen.size) { toast('첨부할 자료를 고르세요.'); return false; } await finish([...chosen], close); return false; } },
  ], { wide: true });
  drawList();
}

// ---- 자료실 화면 ----

export default function render(root) {
  if (filter.subject && !S.subjects().includes(filter.subject)) filter.subject = '';
  if (filter.itemId && !S.itemById(filter.itemId)) filter.itemId = '';

  const used = S.data.materials.reduce((sum, m) => sum + (m.size || 0), 0);
  const rerender = () => { root.replaceChildren(); render(root); };

  const uploadBar = h('div', { class: 'card' },
    h('h3', {}, '자료 올리기'),
    h('div', { class: 'row', style: { marginBottom: '10px' } },
      h('span', { class: 'muted small' }, '분류:'),
      subjectSelect(filter.subject, (v) => { filter.subject = v; filter.itemId = ''; rerender(); }),
      itemSelect(filter.subject, filter.itemId, (v) => { filter.itemId = v; rerender(); }),
      h('span', { class: 'grow' }),
      h('button', { class: 'btn', onClick: () => linkDialog({ subject: filter.subject || null, itemId: filter.itemId || null }) }, '🔗 링크 추가')),
    fileInput((files) => uploadFiles(files, { subject: filter.subject || null, itemId: filter.itemId || null }).catch(showError)));

  const filtered = () => {
    const q = filter.q.trim().toLowerCase();
    return S.data.materials
      .filter((m) => !filter.subject || m.subject === filter.subject)
      .filter((m) => !filter.itemId || S.itemsOfMaterial(m.id).some((i) => i.id === filter.itemId))
      .filter((m) => !q || m.name.toLowerCase().includes(q))
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  };

  const count = h('span', { class: 'muted' });
  const tableBox = h('div', {});
  const drawTable = () => {
    const list = filtered();
    count.textContent = `${list.length}개`;
    tableBox.replaceChildren(list.length ? materialTable(list) : h('div', { class: 'empty' }, S.data.materials.length ? '조건에 맞는 자료가 없습니다.' : '아직 올린 자료가 없습니다.'));
  };
  const search = h('input', {
    type: 'search', placeholder: '이름 검색', value: filter.q, style: { width: '220px' },
    onInput: (e) => { filter.q = e.target.value; drawTable(); },
  });
  drawTable();
  append(root, 
    h('div', { class: 'page-head' },
      h('h2', {}, '수업 자료'),
      h('span', { class: 'small muted' }, `자료 ${S.data.materials.length}개 · ${fmtSize(used)}`),
      S.drive.materialsId ? h('a', { class: 'btn', href: G.folderUrl(S.drive.materialsId), target: '_blank', rel: 'noopener' }, '드라이브 폴더 열기') : null),
    uploadBar,
    h('div', { class: 'row', style: { margin: '20px 0 10px' } },
      h('strong', {}, filter.subject ? `${filter.subject}${filter.itemId ? ` · ${S.itemById(filter.itemId)?.title}` : ''} 자료` : '모든 자료'),
      count,
      h('span', { class: 'grow' }),
      search),
    tableBox);
}

function materialTable(list) {
  // 이 자료가 쓰인 수업: 붙어 있는 차시를 수업한 기록 + 직접 붙인 수업 기록
  const lessonsOf = (mid) => {
    const itemIds = new Set(S.itemsOfMaterial(mid).map((i) => i.id));
    const direct = new Set(S.data.lesson_materials.filter((lm) => lm.material_id === mid).map((lm) => lm.lesson_id));
    return S.data.lessons.filter((l) => itemIds.has(l.curriculum_item_id) || direct.has(l.id)).sort(S.lessonOrder);
  };

  return h('div', { class: 'table-wrap' },
    h('table', { class: 'table' },
      h('thead', {}, h('tr', {}, h('th', {}, '이름'), h('th', {}, '과목 · 차시'), h('th', {}, '사용한 수업'), h('th', {}, '크기'), h('th', {}, '올린 날'), h('th', {}, ''))),
      h('tbody', {}, list.map((m) => {
        const ls = lessonsOf(m.id);
        const items = S.itemsOfMaterial(m.id);
        return h('tr', {},
          h('td', {}, h('span', { class: 'file-name', onClick: () => openMaterial(m) }, `${m.kind === 'link' ? '🔗' : '📄'} ${m.name}`)),
          h('td', { class: 'small' }, m.subject || h('span', { class: 'muted' }, '-'), items.map((it) => h('div', { class: 'muted' }, it.title))),
          h('td', { class: 'small' }, ls.length
            ? ls.slice(-3).map((l) => {
              const c = S.classById(l.class_id);
              return h('div', {}, h('a', { href: '#/today', onClick: (e) => { e.preventDefault(); showDate(l.date); } }, `${fmtMD(l.date)} ${c?.name || ''}`));
            }).concat(ls.length > 3 ? [h('div', { class: 'muted' }, `외 ${ls.length - 3}회`)] : [])
            : h('span', { class: 'muted' }, '-')),
          h('td', { class: 'small muted' }, m.kind === 'file' ? fmtSize(m.size) : '링크'),
          h('td', { class: 'small muted' }, fmtMD(m.created_at.slice(0, 10))),
          h('td', { style: { whiteSpace: 'nowrap', textAlign: 'right' } },
            m.kind === 'file' ? h('button', { class: 'btn btn-sm', onClick: () => openMaterial(m, true) }, '다운로드') : null, ' ',
            h('button', { class: 'btn btn-sm', onClick: () => editDialog(m) }, '수정'), ' ',
            h('button', { class: 'btn btn-sm btn-danger', onClick: () => deleteMaterial(m) }, '삭제')));
      }))));
}

function editDialog(m) {
  const before = new Set(S.itemsOfMaterial(m.id).map((i) => i.id));
  const state = { subject: m.subject || '', itemIds: new Set(before) };
  const name = h('input', { type: 'text', value: m.name });
  const url = m.kind === 'link' ? h('input', { type: 'url', value: m.url }) : null;
  const itemBox = h('div', {});
  const drawItems = () => {
    const items = state.subject ? S.itemsOf(state.subject) : [];
    itemBox.replaceChildren(h('div', { class: 'small muted', style: { marginBottom: '4px' } }, '붙일 차시 (여러 개 가능)'),
      items.length
        ? h('div', { class: 'picker-list', style: { maxHeight: '220px' } }, items.map((it, i) => h('label', {},
          h('input', { type: 'checkbox', checked: state.itemIds.has(it.id), onChange: (e) => (e.target.checked ? state.itemIds.add(it.id) : state.itemIds.delete(it.id)) }),
          h('span', {}, `${i + 1}. ${S.itemLabel(it)}`))))
        : h('div', { class: 'muted small' }, state.subject ? '이 과목에 차시가 없습니다.' : '과목을 먼저 고르세요.'));
  };
  drawItems();
  modal('자료 정보 수정', [
    h('label', {}, '이름', name),
    url ? h('label', {}, '주소', url) : null,
    h('label', {}, '과목', subjectSelect(state.subject, (v) => { state.subject = v; drawItems(); })),
    itemBox,
  ], [
    { label: '취소' },
    {
      label: '저장', primary: true,
      onClick: async () => {
        const patch = { name: name.value.trim() || m.name, subject: state.subject || null };
        if (url) patch.url = url.value.trim();
        await S.update('materials', m.id, patch);
        for (const id of before) if (!state.itemIds.has(id)) await S.remove('item_materials', { item_id: id, material_id: m.id });
        for (const id of state.itemIds) if (!before.has(id)) await S.linkItemMaterials(id, [m.id]);
      },
    },
  ]);
}
