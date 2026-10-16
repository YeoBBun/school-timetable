// 데이터 저장소: 모든 데이터를 메모리에 두고, 구글 드라이브의 '진도관리/진도관리-데이터.json' 파일 하나에 저장한다.
// 다른 기기에서 바꾼 내용은 30초마다(또는 창으로 돌아올 때) 드라이브 파일을 확인해서 합친다.
// 합칠 때는 항목마다 마지막으로 바뀐 시각(_u)이 더 늦은 쪽을 남기고, 지운 항목은 지운 시각(tomb)으로 기억한다.
import * as G from './google.js';

export const TABLES = ['classes', 'curriculum_items', 'timetable_slots', 'timetable_changes', 'lessons', 'materials', 'item_materials', 'lesson_materials', 'days_off', 'settings'];
const DATA_FILE = '진도관리-데이터.json';
const POLL_MS = 30_000;
const TOMB_KEEP_MS = 90 * 24 * 3600 * 1000;

// 기본키가 id 가 아닌 테이블
const KEYS = { item_materials: ['item_id', 'material_id'], lesson_materials: ['lesson_id', 'material_id'], settings: ['user_id'] };
const DEFAULTS = {
  classes: { color: '#4f7cff', sort: 0 },
  curriculum_items: { unit: '', seq: 0 },
  timetable_changes: { note: '', class_id: null },
  lessons: { memo: '', period: null, curriculum_item_id: null },
  materials: { kind: 'file', subject: null },
  days_off: { note: '' },
  settings: { periods: 7, weekdays: 5 },
};

export const data = Object.fromEntries(TABLES.map((t) => [t, []]));
let tomb = Object.fromEntries(TABLES.map((t) => [t, {}]));
export const session = { user: null };
export const drive = { rootId: null, materialsId: null, fileId: null };

const listeners = new Set();
export const onChange = (fn) => listeners.add(fn);
// remote: 다른 기기에서 온 변경이면 true (입력 중에는 화면 갱신을 미룬다)
const emit = (remote = false) => listeners.forEach((fn) => fn({ remote }));

// ---- 동기화 상태 ----
// status: off | on(저장됨) | saving | error | auth(다시 로그인 필요)
export const sync = { status: 'off', message: '' };
function setStatus(status, message = '') {
  sync.status = status;
  sync.message = message;
  document.dispatchEvent(new CustomEvent('sync-status'));
}

const keyOf = (table, row) => (KEYS[table] || ['id']).map((k) => row[k]).join('|');
const uuid = () => crypto.randomUUID();
const now = () => Date.now();

// ---- 드라이브에 저장 / 불러오기 ----
let remoteVersion = null;
let dirty = false;
let saving = false;
let saveTimer = null;
let pollTimer = null;

function snapshot() {
  const cutoff = now() - TOMB_KEEP_MS;
  for (const t of TABLES) {
    for (const [k, ts] of Object.entries(tomb[t])) if (ts < cutoff) delete tomb[t][k];
  }
  return { app: 'jindo', version: 1, saved_at: new Date().toISOString(), tables: data, tomb };
}

function applyRemote(remote) {
  const rTables = remote?.tables || {};
  const rTomb = remote?.tomb || {};
  for (const t of TABLES) {
    const local = new Map(data[t].map((r) => [keyOf(t, r), r]));
    const other = new Map((rTables[t] || []).map((r) => [keyOf(t, r), r]));
    const tombs = { ...(rTomb[t] || {}) };
    for (const [k, ts] of Object.entries(tomb[t])) tombs[k] = Math.max(ts, tombs[k] || 0);
    const merged = [];
    for (const k of new Set([...local.keys(), ...other.keys()])) {
      const a = local.get(k);
      const b = other.get(k);
      const rec = !b || (a && (a._u || 0) >= (b._u || 0)) ? a : b;
      if (tombs[k] && tombs[k] >= (rec._u || 0)) continue;
      merged.push(rec);
    }
    data[t] = merged;
    tomb[t] = tombs;
  }
}

export async function loadAll() {
  const folders = await G.ensureFolders();
  drive.rootId = folders.root;
  drive.materialsId = folders.materials;
  const file = await G.findFile(DATA_FILE, drive.rootId);
  if (file) {
    drive.fileId = file.id;
    const remote = await G.readJson(file.id);
    for (const t of TABLES) data[t] = remote?.tables?.[t] || [];
    tomb = Object.fromEntries(TABLES.map((t) => [t, remote?.tomb?.[t] || {}]));
    remoteVersion = await G.fileVersion(file.id);
  } else {
    resetTables();
    const created = await G.writeJson({ name: DATA_FILE, parentId: drive.rootId, data: snapshot() });
    drive.fileId = created.id;
    remoteVersion = created.version;
  }
  setStatus('on');
  emit();
}

function scheduleSave() {
  dirty = true;
  setStatus('saving');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 700);
}

export async function save() {
  if (saving || !drive.fileId) return;
  saving = true;
  try {
    while (dirty) {
      dirty = false;
      // 다른 기기가 먼저 저장했으면 그 내용과 합친 뒤 저장한다
      const v = await G.fileVersion(drive.fileId);
      if (v !== remoteVersion) {
        applyRemote(await G.readJson(drive.fileId));
        emit(true);
      }
      const res = await G.writeJson({ fileId: drive.fileId, data: snapshot() });
      remoteVersion = res.version;
    }
    setStatus('on');
  } catch (err) {
    dirty = true;
    handleSyncError(err);
  } finally {
    saving = false;
  }
}

async function poll() {
  if (saving || dirty || !drive.fileId || !G.hasToken()) return;
  try {
    const v = await G.fileVersion(drive.fileId);
    if (v !== remoteVersion) {
      applyRemote(await G.readJson(drive.fileId));
      remoteVersion = v;
      emit(true);
    }
    if (sync.status !== 'on') setStatus('on');
  } catch (err) {
    handleSyncError(err);
  }
}

function handleSyncError(err) {
  console.error(err);
  if (err?.code === 'auth') setStatus('auth', err.message);
  else {
    setStatus('error', err?.message || String(err));
    // 네트워크 문제일 수 있으니 잠시 뒤 다시 시도
    clearTimeout(saveTimer);
    if (dirty) saveTimer = setTimeout(save, 10_000);
  }
}

const onFocus = () => { if (document.visibilityState === 'visible') poll(); };

export function startSync() {
  stopSync();
  pollTimer = setInterval(poll, POLL_MS);
  document.addEventListener('visibilitychange', onFocus);
  window.addEventListener('focus', onFocus);
}

export function stopSync() {
  clearInterval(pollTimer);
  document.removeEventListener('visibilitychange', onFocus);
  window.removeEventListener('focus', onFocus);
}

// 다시 로그인한 뒤 밀린 저장과 확인을 이어서 한다
export async function resume() {
  if (dirty) await save();
  else await poll();
}

export const hasUnsaved = () => dirty || saving;

function resetTables() {
  for (const t of TABLES) data[t] = [];
  tomb = Object.fromEntries(TABLES.map((t) => [t, {}]));
}

// 로그아웃할 때: 메모리와 드라이브 위치 정보를 모두 비운다
export function clearData() {
  resetTables();
  remoteVersion = null;
  dirty = false;
  Object.assign(drive, { rootId: null, materialsId: null, fileId: null });
}

// 백업 파일에서 전부 되살리기 (지금 데이터를 덮어쓴다)
export function importBackup(json) {
  const src = json?.tables || json;
  const stamp = now();
  for (const t of TABLES) {
    for (const r of data[t]) tomb[t][keyOf(t, r)] = stamp;
    data[t] = (src?.[t] || []).map((r) => ({ ...r, _u: stamp + 1 }));
    for (const r of data[t]) delete tomb[t][keyOf(t, r)];
  }
  scheduleSave();
  emit();
}

// ---- 메모리 DB: supabase-js 와 비슷한 체인 방식 (from().insert/update/upsert/delete + eq/in/match) ----
function cascadeDelete(table, row, stamp) {
  const del = (t, pred) => {
    const keep = [];
    for (const r of data[t]) {
      if (pred(r)) { tomb[t][keyOf(t, r)] = stamp; cascadeDelete(t, r, stamp); } else keep.push(r);
    }
    data[t] = keep;
  };
  if (table === 'classes') {
    del('timetable_slots', (r) => r.class_id === row.id);
    del('timetable_changes', (r) => r.class_id === row.id);
    del('lessons', (r) => r.class_id === row.id);
  }
  if (table === 'lessons') del('lesson_materials', (r) => r.lesson_id === row.id);
  if (table === 'materials') {
    del('item_materials', (r) => r.material_id === row.id);
    del('lesson_materials', (r) => r.material_id === row.id);
  }
  if (table === 'curriculum_items') {
    del('item_materials', (r) => r.item_id === row.id);
    for (const l of data.lessons) if (l.curriculum_item_id === row.id) { l.curriculum_item_id = null; l._u = stamp; }
  }
}

function makeRow(table, row, stamp) {
  const r = { ...(DEFAULTS[table] || {}), user_id: 'me', created_at: new Date(stamp).toISOString(), ...row, _u: stamp };
  if (!KEYS[table] && !r.id) r.id = uuid();
  return r;
}

class Query {
  constructor(table) { this.t = table; this.op = 'select'; this.filters = []; }
  select() { return this; }
  insert(rows) { this.op = 'insert'; this.payload = rows; return this; }
  update(patch) { this.op = 'update'; this.payload = patch; return this; }
  upsert(rows, opts) { this.op = 'upsert'; this.payload = rows; this.conflict = opts?.onConflict; return this; }
  delete() { this.op = 'delete'; return this; }
  eq(k, v) { this.filters.push((r) => r[k] === v); return this; }
  in(k, vs) { this.filters.push((r) => vs.includes(r[k])); return this; }
  match(obj) { for (const [k, v] of Object.entries(obj)) this.eq(k, v); return this; }
  matches(r) { return this.filters.every((f) => f(r)); }

  run() {
    const t = this.t;
    const stamp = now();
    const list = (p) => (Array.isArray(p) ? p : [p]);
    let out = [];
    if (this.op === 'select') return data[t].filter((r) => this.matches(r)).map((r) => ({ ...r }));
    if (this.op === 'insert') {
      out = list(this.payload).map((r) => makeRow(t, r, stamp));
      for (const r of out) delete tomb[t][keyOf(t, r)];
      data[t].push(...out);
    } else if (this.op === 'update') {
      out = data[t].filter((r) => this.matches(r));
      for (const r of out) Object.assign(r, this.payload, { _u: stamp });
    } else if (this.op === 'upsert') {
      const keys = this.conflict ? this.conflict.split(',').map((s) => s.trim()) : (KEYS[t] || ['id']);
      for (const row of list(this.payload)) {
        const full = { user_id: 'me', ...row };
        const found = data[t].find((r) => keys.every((k) => r[k] === full[k]));
        if (found) { Object.assign(found, row, { _u: stamp }); out.push(found); } else {
          const r = makeRow(t, row, stamp);
          delete tomb[t][keyOf(t, r)];
          data[t].push(r);
          out.push(r);
        }
      }
    } else if (this.op === 'delete') {
      const keep = [];
      for (const r of data[t]) {
        if (this.matches(r)) { out.push(r); tomb[t][keyOf(t, r)] = stamp; cascadeDelete(t, r, stamp); } else keep.push(r);
      }
      data[t] = keep;
    }
    if (out.length || this.op === 'delete') { scheduleSave(); emit(); }
    return out.map((r) => ({ ...r }));
  }

  then(resolve, reject) {
    try { resolve({ data: this.run(), error: null }); } catch (err) { reject ? reject(err) : resolve({ data: null, error: err }); }
  }
}

export const db = { from: (table) => new Query(table) };

// ---- 쓰기 도우미 (예전 이름 그대로) ----
export async function insert(table, row) {
  const { data: rows } = await db.from(table).insert(row);
  return Array.isArray(row) ? rows : rows[0];
}
export async function update(table, id, patch) { await db.from(table).update(patch).eq('id', id); }
export async function upsert(table, row, onConflict) { return (await db.from(table).upsert(row, onConflict ? { onConflict } : undefined)).data; }
export async function remove(table, match) { await db.from(table).delete().match(match); }
// 메모리에 이미 최신 상태가 있으므로 화면만 다시 그린다
export async function reload() { emit(); }

// ---- 조회 도우미 ----
const koSort = (a, b) => a.localeCompare(b, 'ko', { numeric: true });

export const classById = (id) => data.classes.find((c) => c.id === id);
export const itemById = (id) => data.curriculum_items.find((i) => i.id === id);
export const materialById = (id) => data.materials.find((m) => m.id === id);

export function sortedClasses(subject) {
  return data.classes
    .filter((c) => !subject || c.subject === subject)
    .sort((a, b) => a.sort - b.sort || koSort(a.subject, b.subject) || koSort(a.name, b.name));
}

export function itemsOf(subject) {
  return data.curriculum_items
    .filter((i) => i.subject === subject)
    .sort((a, b) => a.seq - b.seq || a.created_at.localeCompare(b.created_at));
}

export function subjects() {
  const set = new Set([...data.classes.map((c) => c.subject), ...data.curriculum_items.map((i) => i.subject)]);
  return [...set].filter(Boolean).sort(koSort);
}

// 그날 실제 시간표: 주간 시간표에 그날의 변경(교체 · 보강 · 결강)을 덮어쓴다
// 반환: [{ period, class_id, changed, note, base_class_id }] (수업 있는 교시만, 교시 순)
export function effectiveSlots(date, weekday) {
  const base = new Map(data.timetable_slots.filter((s) => s.weekday === weekday).map((s) => [s.period, s.class_id]));
  const changes = new Map(data.timetable_changes.filter((c) => c.date === date).map((c) => [c.period, c]));
  const periods = new Set([...base.keys(), ...changes.keys()]);
  const out = [];
  for (const period of periods) {
    const ch = changes.get(period);
    const classId = ch ? ch.class_id : base.get(period);
    if (!classId) continue;
    out.push({ period, class_id: classId, changed: !!ch, note: ch?.note || '', base_class_id: base.get(period) || null });
  }
  return out.sort((a, b) => a.period - b.period);
}

export function settings() {
  return data.settings[0] || { periods: 7, weekdays: 5 };
}

export const lessonOrder = (a, b) => a.date.localeCompare(b.date) || (a.period ?? 99) - (b.period ?? 99);

export function lessonsOfClass(classId) {
  return data.lessons.filter((l) => l.class_id === classId).sort(lessonOrder);
}

export function materialsOfLesson(lessonId) {
  return data.lesson_materials
    .filter((lm) => lm.lesson_id === lessonId)
    .map((lm) => materialById(lm.material_id))
    .filter(Boolean);
}

// 차시에 붙은 자료 (모든 반 공용)
export function materialsOfItem(itemId) {
  if (!itemId) return [];
  return data.item_materials
    .filter((im) => im.item_id === itemId)
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map((im) => materialById(im.material_id))
    .filter(Boolean);
}

export function itemsOfMaterial(materialId) {
  return data.item_materials
    .filter((im) => im.material_id === materialId)
    .map((im) => itemById(im.item_id))
    .filter(Boolean);
}

export async function linkItemMaterials(itemId, materialIds) {
  if (!itemId || !materialIds.length) return;
  await upsert('item_materials', materialIds.map((id) => ({ item_id: itemId, material_id: id, user_id: session.user.id })), 'item_id,material_id');
}

// 차시 추가 (목록 맨 뒤)
export async function addItem(subject, unit, title) {
  const seq = itemsOf(subject).reduce((m, i) => Math.max(m, i.seq), 0) + 10;
  return insert('curriculum_items', { subject, unit, title, seq });
}

export function itemLabel(item) {
  if (!item) return '';
  return item.unit ? `${item.unit} · ${item.title}` : item.title;
}

// 수업 기록에 보이는 모든 자료: 차시 자료 + 이 반에만 붙인 자료
export function lessonAllMaterials(lesson) {
  const list = [...materialsOfItem(lesson.curriculum_item_id), ...materialsOfLesson(lesson.id)];
  return [...new Set(list)];
}
