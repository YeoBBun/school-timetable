// 데이터 저장소: 모든 데이터를 메모리에 두고, 구글 드라이브의 '진도관리/진도관리-데이터.json' 파일 하나에 저장한다.
// 다른 기기에서 바꾼 내용은 30초마다(또는 창으로 돌아올 때) 드라이브 파일을 확인해서 합친다.
// 켤 때 기다리지 않도록 마지막 데이터를 이 PC 브라우저에 사본으로 두고(로그아웃하면 지움), 화면부터 보여 준 뒤 드라이브와 합친다.
// 합칠 때는 항목마다 마지막으로 바뀐 시각(_u)이 더 늦은 쪽을 남기고, 지운 항목은 지운 시각(tomb)으로 기억한다.
import * as G from './google.js';
import { todayStr, addDays } from './ui.js';

// curriculum_items · item_materials 는 예전 버전(차시 목록) 데이터를 보존하려고 남겨 둔다
export const TABLES = ['classes', 'curriculum_items', 'timetable_slots', 'timetable_changes', 'lessons', 'materials', 'item_materials', 'lesson_materials', 'days_off', 'settings',
  'units', 'class_notes', 'folders',
  'students', 'student_notes', 'assessments', 'scores', 'groupings', 'group_rules', 'stickers', 'events', 'gcal_map', 'seteuk', 'eval_plans'];
const DATA_FILE = '진도관리-데이터.json';
const POLL_MS = 30_000;
const TOMB_KEEP_MS = 90 * 24 * 3600 * 1000;
const CACHE_KEY = 'jindo.cache';
const CACHE_MAX_AGE = 60 * 24 * 3600 * 1000; // 지운 기록(90일)보다 짧게: 오래된 사본이 지운 항목을 되살리지 않도록

// 기본키가 id 가 아닌 테이블
// folders: 드라이브 폴더 위치 (key 예: 'y:2026', 's:2026:2', 'j:2026:2:국어', 'u:<단원 id>', 'p:<단원 id>:lesson')
const KEYS = { item_materials: ['item_id', 'material_id'], lesson_materials: ['lesson_id', 'material_id'], settings: ['user_id'], folders: ['key'], scores: ['assessment_id', 'student_id'], gcal_map: ['key'], seteuk: ['student_id', 'year', 'subject'] };
const DEFAULTS = {
  classes: { color: '#4f7cff', sort: 0 },
  curriculum_items: { unit: '', seq: 0 },
  timetable_changes: { note: '', class_id: null },
  lessons: { memo: '', period: null, curriculum_item_id: null },
  materials: { kind: 'file', subject: null, unit_id: null, purpose: 'lesson' },
  days_off: { note: '' },
  settings: { periods: 7, weekdays: 5, sem2_start: '08-01' },
  units: { sort: 0 },
  class_notes: { done: false },
  students: { gender: '', level: '', sample: false },
  assessments: { max_score: 100, dates: {}, kind: 'plain', rubric: {}, standards: [], period: '', area: '' },
  stickers: { n: 1, reason: '' },
  events: { note: '', class_id: null },
};

export const data = Object.fromEntries(TABLES.map((t) => [t, []]));
let tomb = Object.fromEntries(TABLES.map((t) => [t, {}]));
export const session = { user: null };
export const drive = { rootId: null, materialsId: null, fileId: null };

const listeners = new Set();
export const onChange = (fn) => listeners.add(fn);
export const offChange = (fn) => listeners.delete(fn);
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
let loaded = false; // 이번에 드라이브 파일을 한 번이라도 읽었는지
let loading = null;

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

// 지난번에 쓰던 데이터 파일이 그대로 있으면 그 버전, 없거나 휴지통이면 null
async function knownFileVersion() {
  if (!drive.fileId) return null;
  try {
    const meta = await G.fileMeta(drive.fileId);
    return meta.trashed ? null : meta.version;
  } catch (err) {
    if (err.status === 404) return null;
    throw err;
  }
}

// 드라이브 파일을 읽어 지금 데이터(브라우저 사본)와 합친다
export function loadAll() {
  loading ||= (async () => {
    let version = await knownFileVersion();
    if (version == null) {
      const folders = await G.ensureFolders();
      drive.rootId = folders.root;
      drive.materialsId = folders.materials;
      const file = await G.findFile(DATA_FILE, drive.rootId);
      drive.fileId = file?.id || null;
      version = file?.version ?? null;
    } else {
      // 폴더가 지워졌을 때를 대비해 뒤에서 다시 확인만 한다(기다리지 않음)
      G.ensureFolders().then((f) => { drive.rootId = f.root; drive.materialsId = f.materials; writeCache(); }).catch(() => {});
    }
    if (drive.fileId) {
      // 버전을 먼저 받고 내용을 읽어야, 그사이 다른 기기가 저장해도 다음 확인 때 놓치지 않는다
      applyRemote(await G.readJson(drive.fileId));
      remoteVersion = version;
    } else {
      const created = await G.writeJson({ name: DATA_FILE, parentId: drive.rootId, data: snapshot() });
      drive.fileId = created.id;
      remoteVersion = created.version;
    }
    loaded = true;
    migrate();
    writeCache();
    emit(true);
    if (dirty) await save(); // 사본에 밀린 수정이 있으면 이어서 저장
    else setStatus('on');
  })().finally(() => { loading = null; });
  return loading;
}

// ---- 이 PC 브라우저의 사본 ----
function writeCache() {
  if (!session.user) return;
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ at: now(), email: session.user.email, drive, dirty: dirty || saving, tables: data, tomb }));
  } catch { /* 저장 불가 환경이면 사본 없이 동작 */ }
}

// 사본이 있으면 메모리에 올리고 이메일을 돌려준다
export function loadCache() {
  try {
    const c = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    if (!c?.tables || now() - c.at > CACHE_MAX_AGE) return null;
    for (const t of TABLES) data[t] = c.tables[t] || [];
    tomb = Object.fromEntries(TABLES.map((t) => [t, c.tomb?.[t] || {}]));
    Object.assign(drive, c.drive);
    dirty = !!c.dirty;
    return { email: c.email || '' };
  } catch {
    return null;
  }
}

// 저장 대기 중에 창을 닫아도 사본에는 남도록
window.addEventListener('pagehide', () => { if (dirty || saving) writeCache(); });

export function clearCache() {
  try { localStorage.removeItem(CACHE_KEY); } catch { /* 무시 */ }
}

// 구글 연결이 끊긴 채로 사본만 보여 줄 때
export function needAuth() {
  setStatus('auth', '구글 연결이 만료되었습니다. 다시 연결해 주세요.');
}

function scheduleSave() {
  dirty = true;
  setStatus('saving');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 700);
}

export async function save() {
  writeCache();
  // 드라이브를 아직 못 읽었으면 읽은 뒤(loadAll 끝에서) 저장한다
  if (!loaded) { if (!G.hasToken()) needAuth(); return; }
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
    writeCache();
  }
}

async function poll() {
  if (saving || !G.hasToken()) return;
  try {
    if (!loaded) { await loadAll(); return; }
    if (dirty || !drive.fileId) return;
    const v = await G.fileVersion(drive.fileId);
    if (v !== remoteVersion) {
      applyRemote(await G.readJson(drive.fileId));
      remoteVersion = v;
      writeCache();
      emit(true);
    }
    if (sync.status !== 'on') setStatus('on');
  } catch (err) {
    handleSyncError(err);
  }
}

export function handleSyncError(err) {
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
  if (!loaded) await loadAll();
  else if (dirty) await save();
  else await poll();
}

export const hasUnsaved = () => dirty || saving;

function resetTables() {
  for (const t of TABLES) data[t] = [];
  tomb = Object.fromEntries(TABLES.map((t) => [t, {}]));
}

// 로그아웃할 때: 메모리, 드라이브 위치 정보, 브라우저 사본을 모두 비운다
export function clearData() {
  resetTables();
  clearCache();
  remoteVersion = null;
  dirty = false;
  loaded = false;
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
    del('class_notes', (r) => r.class_id === row.id);
    del('stickers', (r) => r.class_id === row.id);
    del('groupings', (r) => r.class_id === row.id);
    del('events', (r) => r.class_id === row.id);
  }
  if (table === 'students') {
    del('student_notes', (r) => r.student_id === row.id);
    del('scores', (r) => r.student_id === row.id);
    del('stickers', (r) => r.student_id === row.id);
    del('group_rules', (r) => r.a === row.id || r.b === row.id);
    del('seteuk', (r) => r.student_id === row.id);
  }
  if (table === 'assessments') del('scores', (r) => r.assessment_id === row.id);
  if (table === 'units') {
    for (const t of ['lessons', 'materials']) for (const r of data[t]) if (r.unit_id === row.id) { r.unit_id = null; r._u = stamp; }
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

// 과목 → 학년 → 반 순 (같은 과목 반끼리 나란히 놓여 진도를 비교하기 쉽다)
export function sortedClasses(subject) {
  return data.classes
    .filter((c) => !subject || c.subject === subject)
    .sort((a, b) => koSort(a.subject || '', b.subject || '') || (a.grade ?? 99) - (b.grade ?? 99)
      || (a.room ?? 99) - (b.room ?? 99) || a.sort - b.sort || koSort(a.name, b.name));
}

// '1학년 1반' (그 학년도에 과목이 여러 개면 '1학년 1반 독서'처럼 과목을 붙인다)
export function classLabel(c) {
  if (!c) return '(삭제된 반)';
  const base = c.grade ? `${c.grade}학년 ${c.room}반` : c.name;
  return subjectsOfYear(classYear(c)).length > 1 && c.subject ? `${base} ${c.subject}` : base;
}
export function subjectsOfYear(year) {
  return [...new Set(data.classes.filter((c) => classYear(c) === year).map((c) => c.subject).filter(Boolean))].sort(koSort);
}

// 예전 데이터 고치기 (드라이브를 읽은 뒤 한 번): 학기 없는 시간표 칸에 학기 붙이기, '101반' 같은 이름을 학년 · 반 숫자로 나누기
function migrate() {
  const stamp = now();
  let changed = false;
  for (const s of data.timetable_slots) {
    if (s.year != null) continue;
    Object.assign(s, termOf(s.created_at ? s.created_at.slice(0, 10) : todayStr()), { _u: stamp });
    changed = true;
  }
  for (const c of data.classes) {
    if (c.grade != null) continue;
    const m = /^(\d)(\d{2})반?$/.exec((c.name || '').trim()) || /^(\d)\s*-\s*(\d{1,2})$/.exec((c.name || '').trim());
    if (!m) continue;
    Object.assign(c, { grade: Number(m[1]), room: Number(m[2]), name: `${Number(m[1])}학년 ${Number(m[2])}반`, _u: stamp });
    changed = true;
  }
  if (changed) scheduleSave();
}

export function subjects() {
  const set = new Set([...data.classes.map((c) => c.subject), ...data.curriculum_items.map((i) => i.subject)]);
  return [...set].filter(Boolean).sort(koSort);
}

// 그날 실제 시간표: 주간 시간표에 그날의 변경(교체 · 보강 · 결강)을 덮어쓴다
// 반환: [{ period, class_id, changed, note, base_class_id }] (수업 있는 교시만, 교시 순)
export function effectiveSlots(date, weekday) {
  const base = new Map(slotsOf(termOf(date)).filter((s) => s.weekday === weekday).map((s) => [s.period, s.class_id]));
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
  return { periods: 7, weekdays: 5, sem2_start: '08-01', ...data.settings[0] };
}

// ---- 학년도 · 학기 ----
// 주간 시간표는 학기마다 따로 (예전 칸은 migrate 가 학기를 붙인다)
export const slotsOf = (term) => data.timetable_slots.filter((s) => s.year == null || sameTerm(s, term));
// 학년도는 3월에 시작한다(1~2월은 앞 학년도 2학기). 2학기 시작일은 설정에서 바꿀 수 있다
export function termOf(dateStr) {
  const [y, m] = dateStr.split('-').map(Number);
  const year = m < 3 ? y - 1 : y;
  const semester = m >= 3 && dateStr.slice(5) < settings().sem2_start ? 1 : 2;
  return { year, semester };
}
export const termLabel = (t) => `${t.year}학년도 ${t.semester}학기`;
export const termKey = (t) => `${t.year}-${t.semester}`;
export const parseTermKey = (k) => { const [year, semester] = k.split('-').map(Number); return { year, semester }; };
export const nextTerm = (t) => (t.semester === 1 ? { year: t.year, semester: 2 } : { year: t.year + 1, semester: 1 });
export const prevTerm = (t) => (t.semester === 2 ? { year: t.year, semester: 1 } : { year: t.year - 1, semester: 2 });

// 학기의 첫날 · 마지막 날
export function termRange(t) {
  const s2 = settings().sem2_start;
  return t.semester === 1
    ? { start: `${t.year}-03-01`, end: addDays(`${t.year}-${s2}`, -1) }
    : { start: `${t.year}-${s2}`, end: addDays(`${t.year + 1}-03-01`, -1) };
}

// ---- 보는 학기: 엑셀 시트처럼 앱 전체가 이 학기를 보여 준다 ----
// 기준은 홈 화면 날짜. 학기를 고르면 그 학기 안의 날짜(오늘이 들어 있으면 오늘, 아니면 첫날)로 옮긴다
export const view = { date: todayStr() };
export const viewTerm = () => termOf(view.date);
export const isCurrentTerm = () => sameTerm(viewTerm(), termOf(todayStr()));
export function setViewDate(d) {
  view.date = d;
  emit();
}
export function setViewTerm(t) {
  const today = todayStr();
  const r = termRange(t);
  if (today >= r.start && today <= r.end) return setViewDate(today);
  // 첫날이 주말이면 다음 월요일로
  let d = r.start;
  while ([0, 6].includes(new Date(`${d}T00:00:00`).getDay())) d = addDays(d, 1);
  setViewDate(d);
}

// 고를 수 있는 학기: 데이터가 있는 학기 + 지난 학기 · 이번 학기 · 다음 학기 (최근 학기부터)
export function allTerms() {
  const map = new Map();
  const add = (t) => t && t.year && map.set(termKey(t), { year: t.year, semester: t.semester });
  const cur = termOf(todayStr());
  [prevTerm(cur), cur, nextTerm(cur), viewTerm()].forEach(add);
  for (const c of data.classes) { const y = classYear(c); add({ year: y, semester: 1 }); add({ year: y, semester: 2 }); }
  data.units.forEach(add);
  data.assessments.forEach(add);
  data.timetable_slots.forEach(add);
  for (const m of data.materials) add(m.year ? m : termOf(m.created_at.slice(0, 10)));
  for (const l of data.lessons) add(termOf(l.date));
  return [...map.values()].sort((a, b) => b.year - a.year || b.semester - a.semester);
}
export const sameTerm = (a, b) => a.year === b.year && a.semester === b.semester;

// 반의 학년도 (예전 데이터는 만든 날짜로 정한다)
export const classYear = (c) => c.year ?? termOf(c.created_at.slice(0, 10)).year;

// 그 학년도의 반만 (지난 학년도 반은 기록 보존용으로 남는다)
export function classesOfYear(year) {
  return sortedClasses().filter((c) => classYear(c) === year);
}

// ---- 단원 (학년도 · 학기마다) ----
export const unitById = (id) => data.units.find((u) => u.id === id);
// 단원은 학기 + 과목마다 (과목이 비어 있으면 모든 과목에 보인다)
export function unitsOf(term, subject) {
  return data.units.filter((u) => sameTerm(u, term) && (!subject || !u.subject || u.subject === subject))
    .sort((a, b) => a.sort - b.sort || koSort(a.name, b.name));
}
export async function addUnit(term, subject, name) {
  const sort = unitsOf(term, subject).reduce((m, u) => Math.max(m, u.sort), 0) + 10;
  return insert('units', { year: term.year, semester: term.semester, subject: subject || null, name, sort });
}
// 단원 이름을 바꾸면 드라이브 폴더 이름도 바꾼다
export async function renameUnit(unit, name) {
  await update('units', unit.id, { name });
  const f = data.folders.find((r) => r.key === `u:${unit.id}`);
  if (f) await G.renameFile(f.folder_id, name);
}

// ---- 수업 기록 ----
// 기록에 보이는 글: 새 방식은 memo, 예전 방식은 차시 제목
export function lessonText(l) {
  return l.memo || itemById(l.curriculum_item_id)?.title || '';
}
// 그 반이 마지막으로 쓴 단원 (같은 학기 안에서)
export function lastUnitOf(classId, term) {
  const list = lessonsOfClass(classId).filter((l) => l.unit_id && sameTerm(termOf(l.date), term));
  return list.length ? list[list.length - 1].unit_id : null;
}
export const notesOfClass = (classId) => data.class_notes.filter((n) => n.class_id === classId)
  .sort((a, b) => a.created_at.localeCompare(b.created_at));
// 이 자료가 쓰인 수업 기록
export function lessonsOfMaterial(materialId) {
  const ids = new Set(data.lesson_materials.filter((lm) => lm.material_id === materialId).map((lm) => lm.lesson_id));
  return data.lessons.filter((l) => ids.has(l.id)).sort(lessonOrder);
}

// ---- 자료 폴더: 수업 자료/2026학년도/2학기/과목/단원/수업|평가 ----
async function folderFor(key, name, parentId) {
  const found = data.folders.find((f) => f.key === key);
  if (found) return found.folder_id;
  const id = await G.ensureFolder(name, parentId);
  await upsert('folders', { key, folder_id: id });
  return id;
}
// 드라이브에서 폴더를 지웠을 수도 있으니 이번 실행에서 처음 쓸 때 한 번 확인한다
const checkedFolders = new Set();
export async function materialFolder(where) {
  const id = await findMaterialFolder(where);
  if (checkedFolders.has(id)) return id;
  let ok = true;
  try { ok = !(await G.fileMeta(id)).trashed; } catch (err) { if (err.status === 404) ok = false; else throw err; }
  if (ok) { checkedFolders.add(id); return id; }
  // 기억해 둔 폴더 위치를 버리고 이름으로 다시 찾거나 만든다
  await db.from('folders').delete().in('key', data.folders.map((f) => f.key));
  return findMaterialFolder(where);
}
async function findMaterialFolder({ year, semester, subject, unitId, purpose }) {
  const y = await folderFor(`y:${year}`, `${year}학년도`, drive.materialsId);
  const s = await folderFor(`s:${year}:${semester}`, `${semester}학기`, y);
  const unit = unitId && unitById(unitId);
  const subj = unit?.subject || subject;
  const j = subj ? await folderFor(`j:${year}:${semester}:${subj}`, subj, s) : s;
  if (!unit) return j;
  const u = await folderFor(`u:${unit.id}`, unit.name, j);
  return folderFor(`p:${unit.id}:${purpose}`, purpose === 'eval' ? '평가' : '수업', u);
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

// ---- 학생 (학년도 + 학년 + 반 단위라서 같은 반의 국어 · 독서가 명단을 함께 쓴다) ----
export const studentById = (id) => data.students.find((s) => s.id === id);
export function studentsOf(cls) {
  if (!cls?.grade) return [];
  const year = classYear(cls);
  return data.students.filter((s) => s.year === year && s.grade === cls.grade && s.room === cls.room)
    .sort((a, b) => a.number - b.number || koSort(a.name, b.name));
}
export const studentLabel = (s) => (s ? `${s.number}. ${s.name}` : '(삭제된 학생)');
export const notesOfStudent = (id) => data.student_notes.filter((n) => n.student_id === id).sort((a, b) => b.date.localeCompare(a.date) || b.created_at.localeCompare(a.created_at));

// ---- 평가계획 (학년도 · 학기 · 과목 · 학년마다 하나: 학기 단위 성취수준 A~E) ----
export const planOf = (term, subject, grade) => data.eval_plans.find((p) => sameTerm(p, term) && p.subject === subject && p.grade === grade);

// ---- 수행평가 ----
export function assessmentsOf(cls, term) {
  return data.assessments.filter((a) => a.year === term.year && a.semester === term.semester && a.subject === cls.subject && a.grade === cls.grade)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
}
export const scoreOf = (assessmentId, studentId) => data.scores.find((s) => s.assessment_id === assessmentId && s.student_id === studentId);

// ---- 칭찬 스티커 (반-과목마다, 학기별로 센다) ----
export function stickerCount(classId, studentId, term) {
  return data.stickers.filter((s) => s.class_id === classId && s.student_id === studentId && sameTerm(termOf(s.date), term))
    .reduce((n, s) => n + (s.n || 1), 0);
}

// ---- 일정: 직접 넣은 일정 + 수행평가 날짜 ----
// 반환: [{ date, title, class_id, kind: 'event' | 'assessment', ref }]
export function agenda(from, to) {
  const out = [];
  for (const e of data.events) if (e.date >= from && e.date <= to) out.push({ date: e.date, title: e.title, class_id: e.class_id, kind: 'event', ref: e });
  for (const a of data.assessments) {
    for (const [classId, date] of Object.entries(a.dates || {})) {
      if (date && date >= from && date <= to && classById(classId)) out.push({ date, title: `수행평가 · ${a.title}`, class_id: classId, kind: 'assessment', ref: a });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || (classLabel(classById(a.class_id)) || '').localeCompare(classLabel(classById(b.class_id)) || '', 'ko'));
}

