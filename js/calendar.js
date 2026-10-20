// 구글 캘린더로 보내기: 앱의 일정 · 수행평가 날짜를 내 구글 캘린더의 '수업관리' 캘린더에 맞춘다(앱 → 캘린더 한 방향)
import * as G from './google.js';
import * as S from './store.js';
import { toast, todayStr, addDays } from './ui.js';

const CAL_NAME = '수업관리';
let timer = null;
let running = false;
let again = false;
let warned = false;

export const connected = () => !!S.settings().gcal_id;

// 버튼 클릭 안에서 불러야 한다(구글 권한 창)
export async function connect() {
  await G.signIn(true);
  if (!G.hasCalendar()) throw new Error("캘린더 권한을 받지 못했습니다. 구글 창에서 캘린더 항목을 체크해 주세요.");
  if (!S.settings().gcal_id) {
    const id = await G.createCalendar(CAL_NAME);
    await S.upsert('settings', { gcal_id: id }, 'user_id');
  }
  await syncNow();
  toast("구글 캘린더의 '수업관리' 캘린더에 일정을 보냈습니다.", 'ok');
}

// 연결만 끊는다 (구글 캘린더에 이미 들어간 일정은 남는다)
export async function disconnect() {
  await S.upsert('settings', { gcal_id: null }, 'user_id');
  if (S.data.gcal_map.length) await S.db.from('gcal_map').delete().in('key', S.data.gcal_map.map((m) => m.key));
}

// 캘린더에 있어야 할 일정: 지난 30일 ~ 앞으로 400일
function desired() {
  const out = new Map();
  for (const it of S.agenda(addDays(todayStr(), -30), addDays(todayStr(), 400))) {
    const cls = S.classById(it.class_id);
    const key = it.kind === 'event' ? `e:${it.ref.id}` : `a:${it.ref.id}:${it.class_id}`;
    out.set(key, { date: it.date, summary: cls ? `[${S.classLabel(cls)}] ${it.title}` : it.title, description: it.ref.note || '' });
  }
  return out;
}

// 앱에서 지워졌거나 날짜가 빠진 일정인가 (기간 밖으로 지나간 일정은 그대로 둔다)
function gone(key) {
  const [kind, id, classId] = key.split(':');
  if (kind === 'e') return !S.data.events.some((e) => e.id === id);
  const a = S.data.assessments.find((x) => x.id === id);
  return !a || !a.dates?.[classId] || !S.classById(classId);
}

export async function syncNow() {
  const calId = S.settings().gcal_id;
  if (!calId || !G.hasCalendar()) return;
  if (running) { again = true; return; }
  running = true;
  try {
    const want = desired();
    for (const [key, ev] of want) {
      const sig = `${ev.date}|${ev.summary}|${ev.description}`;
      const m = S.data.gcal_map.find((x) => x.key === key);
      if (m && m.sig === sig && m.cal === calId) continue;
      let eventId = m?.cal === calId ? m.event_id : null;
      try {
        eventId = await G.saveEvent(calId, eventId, ev);
      } catch (err) {
        // 캘린더에서 직접 지운 일정이면 새로 만든다
        if (eventId && (err.status === 404 || err.status === 410)) eventId = await G.saveEvent(calId, null, ev);
        else throw err;
      }
      await S.upsert('gcal_map', { key, event_id: eventId, sig, cal: calId }, 'key');
    }
    for (const m of [...S.data.gcal_map]) {
      if (want.has(m.key) || !gone(m.key)) continue;
      if (m.cal === calId) await G.deleteEvent(calId, m.event_id);
      await S.remove('gcal_map', { key: m.key });
    }
  } finally {
    running = false;
    if (again) { again = false; schedule(); }
  }
}

function schedule() {
  clearTimeout(timer);
  timer = setTimeout(() => syncNow().catch(onError), 2000);
}

function onError(err) {
  if (err?.code === 'auth') return; // 배지의 '다시 연결'로 이어진다
  console.error(err);
  if (warned) return;
  warned = true;
  toast(err?.status === 403
    ? '구글 캘린더로 보내지 못했습니다. 구글 클라우드 콘솔에서 Google Calendar API 를 사용 설정했는지 확인해 주세요.'
    : `구글 캘린더로 보내지 못했습니다: ${err.message}`, 'error');
}

// 이 기기에서 바꾼 내용만 보낸다(두 기기가 같은 일정을 겹쳐 만들지 않도록)
S.onChange(({ remote }) => { if (!remote && connected() && G.hasCalendar()) schedule(); });
