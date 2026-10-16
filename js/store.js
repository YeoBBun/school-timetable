// 데이터 저장소: 로그인한 사용자의 모든 데이터를 메모리에 올려두고,
// 변경 시 다시 불러온 뒤 화면을 갱신한다. 다른 기기의 변경은 Realtime으로 받는다.
import { supabase } from './db.js';

export const TABLES = ['classes', 'curriculum_items', 'timetable_slots', 'timetable_changes', 'lessons', 'materials', 'item_materials', 'lesson_materials', 'days_off', 'settings'];

export const data = Object.fromEntries(TABLES.map((t) => [t, []]));
export const session = { user: null };
export const missingTables = new Set();

const listeners = new Set();
export const onChange = (fn) => listeners.add(fn);
// remote: 다른 기기에서 온 변경이면 true (입력 중에는 화면 갱신을 미룬다)
const emit = (remote = false) => listeners.forEach((fn) => fn({ remote }));

async function fetchTable(table) {
  const rows = [];
  const size = 1000;
  for (let from = 0; ; from += size) {
    const { data: page, error } = await supabase.from(table).select('*').range(from, from + size - 1);
    if (error) {
      // 아직 마이그레이션을 실행하지 않아 테이블이 없으면 빈 목록으로 두고 계속 동작한다
      if (error.code === 'PGRST205' || error.code === '42P01') {
        console.warn(`'${table}' 테이블이 없습니다. supabase 폴더의 마이그레이션 SQL을 실행하세요.`);
        missingTables.add(table);
        data[table] = [];
        return;
      }
      throw error;
    }
    rows.push(...page);
    if (page.length < size) break;
  }
  data[table] = rows;
}

export async function loadAll() {
  await Promise.all(TABLES.map(fetchTable));
  emit();
}

export async function reload(...tables) {
  await Promise.all(tables.map(fetchTable));
  emit();
}

export function clearData() {
  for (const t of TABLES) data[t] = [];
}

let channel = null;
export const sync = { status: 'off' };

export function startRealtime() {
  stopRealtime();
  const pending = new Set();
  let timer;
  channel = supabase
    .channel('db-changes')
    .on('postgres_changes', { event: '*', schema: 'public' }, (payload) => {
      if (!TABLES.includes(payload.table)) return;
      pending.add(payload.table);
      clearTimeout(timer);
      timer = setTimeout(() => {
        const tables = [...pending];
        pending.clear();
        Promise.all(tables.map(fetchTable)).then(() => emit(true)).catch(console.error);
      }, 300);
    })
    .subscribe((status) => {
      sync.status = status === 'SUBSCRIBED' ? 'on' : status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' ? 'error' : 'off';
      document.dispatchEvent(new CustomEvent('sync-status'));
    });
}

export function stopRealtime() {
  if (channel) supabase.removeChannel(channel);
  channel = null;
}

// ---- 쓰기 도우미: 실행 후 해당 테이블을 다시 불러온다 ----
function check({ data: d, error }) {
  if (error) throw error;
  return d;
}

export async function insert(table, row) {
  const rows = check(await supabase.from(table).insert(row).select());
  await reload(table);
  return Array.isArray(row) ? rows : rows[0];
}

export async function update(table, id, patch) {
  check(await supabase.from(table).update(patch).eq('id', id));
  await reload(table);
}

export async function upsert(table, row, onConflict) {
  const rows = check(await supabase.from(table).upsert(row, onConflict ? { onConflict } : undefined).select());
  await reload(table);
  return rows;
}

export async function remove(table, match, alsoReload = []) {
  check(await supabase.from(table).delete().match(match));
  await reload(table, ...alsoReload);
}

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
