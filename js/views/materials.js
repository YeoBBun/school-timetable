// 수업 자료: 드라이브 '수업 자료/학년도/학기/단원/수업·평가' 폴더로 정리해서 올리고, 수업 기록에 붙인다
import { h, append, toast, showError, modal, confirmDialog, fmtSize, fmtMD, todayStr } from '../ui.js';
import * as G from '../google.js';
import * as S from '../store.js';

const PURPOSE = { lesson: '수업', eval: '평가' };
// 자료 화면 상태
const view = { term: null, subject: '', unitId: '', purpose: 'lesson', q: '' };

// ---- 공용 함수 (다른 화면에서도 사용) ----

// 자료의 학기 (예전 자료는 올린 날짜로 정한다)
export function materialTerm(m) {
  return m.year ? { year: m.year, semester: m.semester } : S.termOf(m.created_at.slice(0, 10));
}

export function materialPlace(m) {
  const unit = S.unitById(m.unit_id);
  return [S.termLabel(materialTerm(m)), m.subject, unit?.name, unit ? PURPOSE[m.purpose] || '수업' : null].filter(Boolean).join(' · ');
}

export async function uploadFiles(files, { term, subject = null, unitId = null, purpose = 'lesson' }) {
  const list = [...files];
  if (!list.length) return [];
  const folder = await S.materialFolder({ ...term, subject, unitId, purpose });
  const created = [];
  for (let i = 0; i < list.length; i++) {
    const f = list[i];
    const label = () => `드라이브에 올리는 중 (${i + 1}/${list.length}) ${f.name}`;
    const t = toast(label());
    try {
      const up = await G.uploadFile(f, folder, (p) => { t.textContent = `${label()} · ${Math.round(p * 100)}%`; });
      created.push(await S.insert('materials', {
        name: f.name, kind: 'file', drive_id: up.id, url: up.webViewLink || G.fileViewUrl(up.id), size: f.size, mime: f.type || null,
        year: term.year, semester: term.semester, subject: subject || null, unit_id: unitId || null, purpose, folder_id: folder,
      }));
    } catch (err) {
      showError(new Error(`${f.name}: ${err.message}`));
    } finally {
      t.remove();
    }
  }
  if (created.length) toast(`${created.length}개 파일을 드라이브에 올렸습니다.`, 'ok');
  return created;
}

export function openMaterial(m, download = false) {
  if (m.kind === 'link') { window.open(m.url, '_blank', 'noopener'); return; }
  if (!m.drive_id) { toast('파일 위치를 찾을 수 없습니다.', 'error'); return; }
  window.open(download ? G.fileDownloadUrl(m.drive_id) : (m.url || G.fileViewUrl(m.drive_id)), '_blank', 'noopener');
}

export function matLink(m) {
  return h('a', { class: 'mat-link', title: `${m.name}\n${materialPlace(m)}`, onClick: () => openMaterial(m) }, `${m.kind === 'link' ? '🔗' : '📄'} ${m.name}`);
}

// 링크 주소 정리: http(s):// 로 시작하지 않으면 https:// 를 붙임(javascript: 같은 주소 차단)
function normalizeUrl(v) {
  const u = v.trim();
  if (!u) return '';
  return /^https?:\/\//i.test(u) ? u : `https://${u}`;
}

// 단원 고르기 (맨 아래 '+ 새 단원'을 고르면 바로 만든다)
export function unitSelect(term, subject, value, onChange, { emptyLabel = '— 단원 없음 —' } = {}) {
  const sel = h('select', {
    class: 'unit-select', value: value || '',
    onChange: async () => {
      if (sel.value !== '__new') return onChange(sel.value);
      sel.value = value || '';
      const unit = await newUnitDialog(term, subject);
      if (unit) onChange(unit.id);
    },
  },
  h('option', { value: '' }, emptyLabel),
  S.unitsOf(term, subject).map((u) => h('option', { value: u.id }, u.name)),
  h('option', { value: '__new' }, '+ 새 단원 만들기…'));
  return sel;
}

export function newUnitDialog(term, subject) {
  return new Promise((resolve) => {
    let result = null;
    const name = h('input', { type: 'text', placeholder: '예: 1. 갈등과 소통' });
    const m = modal(`${S.termLabel(term)}${subject ? ` ${subject}` : ''} · 새 단원`, [
      h('label', {}, '단원 이름', name),
      h('p', { class: 'muted small' }, '앞에 번호를 붙이면 순서대로 정렬됩니다. 드라이브에도 같은 이름의 폴더가 생깁니다.'),
    ], [
      { label: '취소' },
      {
        label: '만들기', primary: true,
        onClick: async () => {
          const n = name.value.trim();
          if (!n) { toast('단원 이름을 입력하세요.'); return false; }
          if (S.unitsOf(term, subject).some((u) => u.name === n)) { toast('같은 이름의 단원이 이미 있습니다.', 'error'); return false; }
          result = await S.addUnit(term, subject, n);
        },
      },
    ]);
    new MutationObserver((_, obs) => { if (!m.overlay.isConnected) { obs.disconnect(); resolve(result); } })
      .observe(document.body, { childList: true });
  });
}

function purposeToggle(value, onChange) {
  return h('div', { class: 'seg' }, Object.entries(PURPOSE).map(([k, label]) =>
    h('button', { type: 'button', class: k === value ? 'active' : '', onClick: () => onChange(k) }, label)));
}

function fileInput(onFiles, text = '여기로 파일을 끌어다 놓거나 클릭해서 고르기') {
  const input = h('input', { type: 'file', multiple: true, style: { display: 'none' }, onChange: () => { onFiles(input.files); input.value = ''; } });
  const zone = h('div', {
    class: 'dropzone',
    onClick: () => input.click(),
    onDragover: (e) => { e.preventDefault(); zone.classList.add('over'); },
    onDragleave: () => zone.classList.remove('over'),
    onDrop: (e) => { e.preventDefault(); zone.classList.remove('over'); if (e.dataTransfer.files.length) onFiles(e.dataTransfer.files); },
  }, text, input);
  return zone;
}

export function linkDialog({ term, subject = null, unitId = null, purpose = 'lesson' }) {
  return new Promise((resolve) => {
    const url = h('input', { type: 'url', placeholder: 'https://…' });
    const name = h('input', { type: 'text', placeholder: '이름 (예: 수업 영상, 패들렛)' });
    let result = null;
    const m = modal('링크 추가', [h('label', {}, '주소', url), h('label', {}, '이름', name)], [
      { label: '취소' },
      {
        label: '추가', primary: true,
        onClick: async () => {
          const u = normalizeUrl(url.value);
          if (!u) return false;
          result = await S.insert('materials', { name: name.value.trim() || u, kind: 'link', url: u, year: term.year, semester: term.semester, subject: subject || null, unit_id: unitId || null, purpose });
        },
      },
    ]);
    new MutationObserver((_, obs) => { if (!m.overlay.isConnected) { obs.disconnect(); resolve(result); } })
      .observe(document.body, { childList: true });
  });
}

async function linkLesson(lesson, ids) {
  if (!ids.length) return;
  await S.upsert('lesson_materials', ids.map((id) => ({ lesson_id: lesson.id, material_id: id })), 'lesson_id,material_id');
}

// 수업 기록에 자료 붙이기: 새로 올리기 · 링크 · 이미 올린 자료에서 고르기
// files 가 있으면(기록에 끌어다 놓은 경우) 올릴 위치만 확인하고 바로 올린다
export function attachDialog(lesson, files = null) {
  const term = S.termOf(lesson.date);
  const subject = S.classById(lesson.class_id)?.subject || null;
  const st = { unitId: lesson.unit_id || '', purpose: 'lesson', all: false };
  const already = new Set(S.materialsOfLesson(lesson.id).map((m) => m.id));
  const chosen = new Set();
  const place = h('div', { class: 'row' });
  const listBox = h('div', { class: 'picker-list' });
  const search = h('input', { type: 'search', placeholder: '이름 검색', style: { flex: 1 }, onInput: () => drawList() });

  const drawPlace = () => place.replaceChildren(
    h('span', { class: 'muted small' }, '올릴 곳'),
    unitSelect(term, subject, st.unitId, (v) => { st.unitId = v; drawPlace(); drawList(); }),
    purposeToggle(st.purpose, (v) => { st.purpose = v; drawPlace(); }));

  const drawList = () => {
    const q = search.value.trim().toLowerCase();
    const rows = S.data.materials
      .filter((m) => !already.has(m.id))
      .filter((m) => st.all || (!subject || !m.subject || m.subject === subject) && (!st.unitId || m.unit_id === st.unitId))
      .filter((m) => !q || m.name.toLowerCase().includes(q))
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    listBox.replaceChildren(...(rows.length
      ? rows.map((m) => h('label', {},
        h('input', { type: 'checkbox', checked: chosen.has(m.id), onChange: (e) => (e.target.checked ? chosen.add(m.id) : chosen.delete(m.id)) }),
        h('span', { class: 'grow' }, `${m.kind === 'link' ? '🔗' : '📄'} ${m.name}`, h('span', { class: 'muted small' }, `  · ${materialPlace(m)}`)),
        h('span', { class: 'muted small' }, m.kind === 'file' ? fmtSize(m.size) : '링크')))
      : [h('div', { class: 'muted', style: { padding: '16px', textAlign: 'center' } }, '해당하는 자료가 없습니다.')]));
  };

  // 기록에 단원이 없었으면 고른 단원을 기록에도 적어 준다
  const finish = async (ids) => {
    if (!ids.length) return;
    await linkLesson(lesson, ids);
    if (!lesson.unit_id && st.unitId) await S.update('lessons', lesson.id, { unit_id: st.unitId });
    toast(`자료 ${ids.length}개를 붙였습니다.`, 'ok');
  };
  const upload = async (fs) => {
    const created = await uploadFiles(fs, { term, subject, unitId: st.unitId || null, purpose: st.purpose });
    await finish(created.map((m) => m.id));
  };

  drawPlace();
  if (files) {
    modal('자료 올리기', [
      h('div', {}, [...files].map((f) => h('div', {}, `📄 ${f.name}`, h('span', { class: 'muted small' }, ` · ${fmtSize(f.size)}`)))),
      place,
      h('p', { class: 'muted small' }, `드라이브의 '수업 자료/${term.year}학년도/${term.semester}학기/${subject ? `${subject}/` : ''}단원/수업·평가' 폴더에 들어갑니다.`),
    ], [
      { label: '취소' },
      { label: '올리고 붙이기', primary: true, onClick: async (close) => { close(); await upload(files); } },
    ]);
    return;
  }

  let m;
  const allBox = h('label', { class: 'inline' },
    h('input', { type: 'checkbox', onChange: (e) => { st.all = e.target.checked; drawList(); } }), '다른 단원 · 과목 자료도 보기');
  m = modal('자료 붙이기', [
    place,
    fileInput(async (fs) => { m.close(); await upload(fs); }),
    h('button', {
      class: 'btn', style: { alignSelf: 'flex-start' },
      onClick: async () => { const r = await linkDialog({ term, subject, unitId: st.unitId, purpose: st.purpose }); if (r) { m.close(); await finish([r.id]); } },
    }, '🔗 링크로 붙이기'),
    h('div', { class: 'section-title', style: { marginBottom: 0 } }, '이미 올린 자료에서 고르기'),
    h('div', { class: 'row' }, search, allBox),
    listBox,
  ], [
    { label: '취소' },
    { label: '고른 자료 붙이기', primary: true, onClick: async () => { if (!chosen.size) { toast('붙일 자료를 고르세요.'); return false; } await finish([...chosen]); } },
  ], { wide: true });
  drawList();
}

async function deleteMaterial(m) {
  const used = S.lessonsOfMaterial(m.id).length;
  const ok = await confirmDialog(`'${m.name}'을(를) 삭제할까요?${used ? `\n붙어 있던 수업 기록 ${used}곳에서도 빠집니다.` : ''}${m.kind === 'file' ? '\n파일은 구글 드라이브 휴지통으로 이동합니다 (30일 안에 되살릴 수 있음).' : ''}`);
  if (!ok) return;
  try {
    if (m.kind === 'file' && m.drive_id) await G.trashFile(m.drive_id);
    await S.remove('materials', { id: m.id });
    toast('삭제했습니다.');
  } catch (err) { showError(err); }
}

// 이름 · 단원 · 수업/평가 바꾸기 (파일이면 드라이브에서도 이름을 바꾸고 폴더를 옮긴다)
function editDialog(m) {
  const term = materialTerm(m);
  const st = { unitId: m.unit_id || '', purpose: m.purpose || 'lesson' };
  const name = h('input', { type: 'text', value: m.name });
  const url = m.kind === 'link' ? h('input', { type: 'url', value: m.url }) : null;
  const place = h('div', { class: 'row' });
  const drawPlace = () => place.replaceChildren(
    unitSelect(term, m.subject, st.unitId, (v) => { st.unitId = v; drawPlace(); }),
    purposeToggle(st.purpose, (v) => { st.purpose = v; drawPlace(); }));
  drawPlace();
  modal('자료 수정', [
    h('label', {}, '이름', name),
    url ? h('label', {}, '주소', url) : null,
    h('div', { class: 'muted small' }, `${S.termLabel(term)}${m.subject ? ` ${m.subject}` : ''} 자료`),
    place,
  ], [
    { label: '취소' },
    {
      label: '저장', primary: true,
      onClick: async () => {
        const patch = { name: name.value.trim() || m.name, unit_id: st.unitId || null, purpose: st.purpose };
        if (url) {
          patch.url = normalizeUrl(url.value);
          if (!patch.url) { toast('주소를 입력하세요.'); return false; }
        }
        if (m.kind === 'file' && m.drive_id) {
          if (patch.name !== m.name) await G.renameFile(m.drive_id, patch.name);
          if (patch.unit_id !== (m.unit_id || null) || patch.purpose !== (m.purpose || 'lesson')) {
            const folder = await S.materialFolder({ ...term, subject: m.subject, unitId: patch.unit_id, purpose: patch.purpose });
            await G.moveFile(m.drive_id, folder, m.folder_id || S.drive.materialsId);
            patch.folder_id = folder;
          }
        }
        await S.update('materials', m.id, patch);
      },
    },
  ]);
}

async function renameUnitDialog(unit) {
  const name = h('input', { type: 'text', value: unit.name });
  modal('단원 이름 바꾸기', [h('label', {}, '단원 이름', name), h('p', { class: 'muted small' }, '드라이브 폴더 이름도 함께 바뀝니다.')], [
    { label: '취소' },
    {
      label: '저장', primary: true,
      onClick: async () => {
        const n = name.value.trim();
        if (!n || n === unit.name) return;
        await S.renameUnit(unit, n);
      },
    },
  ]);
}

async function deleteUnit(unit) {
  const mats = S.data.materials.filter((m) => m.unit_id === unit.id).length;
  const ok = await confirmDialog(`'${unit.name}' 단원을 지울까요?\n이 단원의 기록과 자료는 지워지지 않고 '단원 없음'으로 옮겨집니다.${mats ? `\n(드라이브의 파일 ${mats}개는 원래 폴더에 그대로 남습니다)` : ''}`, { okLabel: '단원 지우기' });
  if (!ok) return;
  try { await S.remove('units', { id: unit.id }); } catch (err) { showError(err); }
}

// ---- 자료 화면 ----

// 자료나 단원이 있는 학기 + 지금 학기 (최근 학기부터)
function knownTerms() {
  const map = new Map();
  const add = (t) => map.set(`${t.year}-${t.semester}`, t);
  add(S.termOf(todayStr()));
  S.data.units.forEach((u) => add({ year: u.year, semester: u.semester }));
  S.data.materials.forEach((m) => add(materialTerm(m)));
  return [...map.values()].sort((a, b) => b.year - a.year || b.semester - a.semester);
}

// 그 학기에 쓰는 과목들 (담당 반 + 단원 + 자료)
function termSubjects(term) {
  const set = new Set(S.subjectsOfYear(term.year));
  S.data.units.filter((u) => S.sameTerm(u, term) && u.subject).forEach((u) => set.add(u.subject));
  S.data.materials.filter((m) => m.subject && S.sameTerm(materialTerm(m), term)).forEach((m) => set.add(m.subject));
  return [...set].sort((a, b) => a.localeCompare(b, 'ko'));
}

export default function render(root) {
  const terms = knownTerms();
  if (!view.term || !terms.some((t) => S.sameTerm(t, view.term))) view.term = terms[0];
  const term = view.term;
  const subjects = termSubjects(term);
  if (!subjects.includes(view.subject)) { view.subject = subjects[0] || ''; view.unitId = ''; }
  const subject = view.subject || null;
  if (view.unitId && !S.unitById(view.unitId)) view.unitId = '';
  const rerender = () => { root.replaceChildren(); render(root); };

  const termSel = h('select', {
    value: `${term.year}-${term.semester}`,
    onChange: (e) => { const [y, s] = e.target.value.split('-').map(Number); view.term = { year: y, semester: s }; view.unitId = ''; rerender(); },
  }, terms.map((t) => h('option', { value: `${t.year}-${t.semester}` }, S.termLabel(t))));
  const subjectTabs = subjects.length > 1
    ? h('div', { class: 'seg' }, subjects.map((sj) => h('button', { class: sj === subject ? 'active' : '', onClick: () => { view.subject = sj; view.unitId = ''; rerender(); } }, sj)))
    : null;

  const where = [`${term.year}학년도`, `${term.semester}학기`, subject, S.unitById(view.unitId)?.name || '(단원 없음)', view.unitId ? PURPOSE[view.purpose] : null].filter(Boolean).join('/');
  const upload = h('div', { class: 'card' },
    h('h3', {}, '자료 올리기'),
    h('div', { class: 'row', style: { marginBottom: '10px' } },
      unitSelect(term, subject, view.unitId, (v) => { view.unitId = v; rerender(); }),
      purposeToggle(view.purpose, (v) => { view.purpose = v; rerender(); }),
      h('span', { class: 'grow' }),
      h('button', { class: 'btn', onClick: () => linkDialog({ term, subject, unitId: view.unitId, purpose: view.purpose }) }, '🔗 링크 추가')),
    fileInput((files) => uploadFiles(files, { term, subject, unitId: view.unitId || null, purpose: view.purpose }).catch(showError),
      `여기로 파일을 끌어다 놓거나 클릭해서 고르기 → ${where}`));

  const listBox = h('div', {});
  const drawList = () => {
    const q = view.q.trim().toLowerCase();
    const inTerm = S.data.materials.filter((m) => S.sameTerm(materialTerm(m), term))
      .filter((m) => !subject || !m.subject || m.subject === subject)
      .filter((m) => !q || m.name.toLowerCase().includes(q))
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    const units = S.unitsOf(term, subject);
    const groups = [...units.map((u) => ({ unit: u, list: inTerm.filter((m) => m.unit_id === u.id) })),
      { unit: null, list: inTerm.filter((m) => !m.unit_id || !S.unitById(m.unit_id)) }];
    listBox.replaceChildren(...groups.filter((g) => g.unit || g.list.length).map((g) => unitBlock(g.unit, g.list)),
      h('button', { class: 'btn', onClick: () => newUnitDialog(term, subject) }, '+ 새 단원'));
  };
  const search = h('input', { type: 'search', placeholder: '자료 이름 검색', value: view.q, style: { width: '220px' }, onInput: (e) => { view.q = e.target.value; drawList(); } });
  drawList();

  append(root,
    h('div', { class: 'page-head' },
      h('h2', {}, '수업 자료'), termSel, subjectTabs, search,
      S.drive.materialsId ? h('a', { class: 'btn', href: G.folderUrl(S.drive.materialsId), target: '_blank', rel: 'noopener' }, '드라이브 폴더 열기') : null),
    upload,
    h('div', { class: 'section-title' }, `${S.termLabel(term)}${subject ? ` ${subject}` : ''} 단원별 자료`),
    listBox);
}

function unitBlock(unit, list) {
  const part = (purpose) => {
    const rows = list.filter((m) => (m.purpose || 'lesson') === purpose);
    return rows.length ? h('div', { class: 'mat-part' }, h('div', { class: 'mat-part-title' }, PURPOSE[purpose]), rows.map(materialRow)) : null;
  };
  return h('div', { class: 'card unit-block' },
    h('div', { class: 'row' },
      h('h3', { style: { margin: 0 } }, unit ? unit.name : '단원 없음'),
      h('span', { class: 'muted small' }, `자료 ${list.length}개`),
      h('span', { class: 'grow' }),
      unit ? h('button', { class: 'icon-btn', title: '이름 바꾸기', onClick: () => renameUnitDialog(unit) }, '✎') : null,
      unit ? h('button', { class: 'icon-btn danger', title: '단원 지우기', onClick: () => deleteUnit(unit) }, '✕') : null),
    list.length ? [part('lesson'), part('eval')] : h('p', { class: 'muted small', style: { margin: '8px 0 0' } }, '아직 자료가 없습니다.'));
}

function materialRow(m) {
  const used = S.lessonsOfMaterial(m.id);
  return h('div', { class: 'mat-row' },
    h('span', { class: 'file-name grow', onClick: () => openMaterial(m) }, `${m.kind === 'link' ? '🔗' : '📄'} ${m.name}`),
    h('span', { class: 'muted small', title: used.map((l) => `${fmtMD(l.date)} ${S.classLabel(S.classById(l.class_id))}`).join('\n') },
      used.length ? `쓴 수업 ${used.length}회 · ${[...new Set(used.map((l) => S.classLabel(S.classById(l.class_id))))].join(', ')}` : '아직 안 씀'),
    h('span', { class: 'muted small', style: { width: '64px', textAlign: 'right' } }, m.kind === 'file' ? fmtSize(m.size) : '링크'),
    m.kind === 'file' ? h('button', { class: 'icon-btn', title: '내려받기', onClick: () => openMaterial(m, true) }, '⬇') : null,
    h('button', { class: 'icon-btn', title: '수정', onClick: () => editDialog(m) }, '✎'),
    h('button', { class: 'icon-btn danger', title: '삭제', onClick: () => deleteMaterial(m) }, '✕'));
}
