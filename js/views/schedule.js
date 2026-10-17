// 일정: 반별 수행평가 날짜 + 직접 넣은 수업 관련 일정, 그리고 구글 캘린더 연결
import { h, append, toast, showError, modal, todayStr, addDays, fmtDateLong, classChip } from '../ui.js';
import * as S from '../store.js';
import * as G from '../google.js';
import * as Cal from '../calendar.js';
import { go } from '../app.js';

export default function render(root) {
  const today = todayStr();
  const upcoming = S.agenda(today, addDays(today, 120));
  const past = S.agenda(addDays(today, -60), addDays(today, -1)).reverse();
  append(root,
    h('div', { class: 'page-head' },
      h('h2', {}, '일정'),
      h('button', { class: 'btn btn-primary', onClick: () => eventDialog() }, '+ 일정 추가')),
    h('div', { class: 'cols' },
      h('div', {},
        upcoming.length ? agendaList(upcoming) : h('div', { class: 'empty' }, '앞으로 넉 달 동안 일정이 없습니다.'),
        past.length ? h('details', { class: 'card', style: { marginTop: '12px' } }, h('summary', { class: 'muted' }, `지난 일정 (최근 60일, ${past.length}개)`), agendaList(past, true)) : null),
      h('div', {}, calendarCard(),
        h('div', { class: 'card' }, h('h3', {}, '수행평가 날짜'),
          h('p', { class: 'muted small', style: { margin: 0 } }, "수행평가 날짜는 '수행평가' 화면에서 반마다 넣으면 여기와 첫 화면에 자동으로 나옵니다.")))));
}

export function agendaList(items, muted = false) {
  const byDate = new Map();
  for (const it of items) {
    if (!byDate.has(it.date)) byDate.set(it.date, []);
    byDate.get(it.date).push(it);
  }
  return h('div', { class: `card agenda ${muted ? 'muted' : ''}` }, [...byDate].map(([d, list]) => h('div', { class: 'agenda-day' },
    h('div', { class: 'agenda-date' }, fmtDateLong(d), d === todayStr() ? h('span', { class: 'badge badge-info', style: { marginLeft: '6px' } }, '오늘') : null),
    list.map((it) => {
      const cls = S.classById(it.class_id);
      return h('div', { class: 'agenda-item clickable', onClick: () => (it.kind === 'event' ? eventDialog(it.ref) : go('assess')) },
        h('span', { class: `badge ${it.kind === 'assessment' ? 'badge-warn' : ''}` }, it.kind === 'assessment' ? '수행평가' : '일정'),
        cls ? classChip(cls, S.classLabel(cls)) : null,
        h('span', { class: 'grow' }, it.kind === 'assessment' ? it.ref.title : it.title),
        it.ref.note ? h('span', { class: 'muted small' }, it.ref.note) : null);
    }))));
}

function calendarCard() {
  const on = Cal.connected();
  const connect = async (e) => {
    e.target.disabled = true;
    try { await Cal.connect(); } catch (err) { showError(err); } finally { e.target.disabled = false; }
  };
  return h('div', { class: 'card' },
    h('h3', {}, '구글 캘린더'),
    on
      ? [
        h('p', { class: 'small', style: { marginTop: 0 } }, "일정과 수행평가 날짜를 내 구글 캘린더의 '진도관리' 캘린더에 자동으로 보냅니다. 휴대폰 캘린더 앱에서도 보입니다."),
        G.hasCalendar() ? null : h('div', { class: 'banner' }, '이 기기에서는 아직 캘린더 권한을 받지 않았습니다. 아래 버튼을 눌러 주세요.'),
        h('div', { class: 'row' },
          h('button', { class: 'btn', onClick: G.hasCalendar() ? () => Cal.syncNow().then(() => toast('맞췄습니다.', 'ok')).catch(showError) : connect }, G.hasCalendar() ? '지금 맞추기' : '캘린더 권한 받기'),
          h('a', { class: 'btn', href: G.calendarUrl(), target: '_blank', rel: 'noopener' }, '구글 캘린더 열기'),
          h('button', { class: 'btn btn-danger', onClick: () => Cal.disconnect().catch(showError) }, '연결 끊기')),
      ]
      : [
        h('p', { class: 'small', style: { marginTop: 0 } }, "연결하면 구글 캘린더에 '진도관리' 캘린더가 새로 생기고, 일정과 수행평가 날짜가 자동으로 들어갑니다. 앱은 이 캘린더만 다룰 수 있고 다른 캘린더는 볼 수 없습니다."),
        h('details', { class: 'small' }, h('summary', {}, '처음 한 번 해야 할 일 (구글 클라우드 콘솔)'),
          h('ol', {},
            h('li', {}, 'console.cloud.google.com → 진도관리 프로젝트'),
            h('li', {}, "'API 및 서비스' → '라이브러리' → Google Calendar API → '사용'"),
            h('li', {}, "'Google 인증 플랫폼' → '데이터 액세스' → '범위 추가 또는 삭제' → calendar.app.created 체크 → '업데이트' → 'Save'"),
            h('li', {}, "이 화면에서 '구글 캘린더 연결'을 누르고, 구글 창에서 캘린더 항목을 체크"))),
        h('button', { class: 'btn btn-primary', style: { marginTop: '8px' }, onClick: connect }, '구글 캘린더 연결'),
      ]);
}

export function eventDialog(ev = null, preset = {}) {
  const classes = S.classesOfYear(S.termOf(todayStr()).year);
  const date = h('input', { type: 'date', value: ev?.date || preset.date || todayStr() });
  const title = h('input', { type: 'text', value: ev?.title || '', placeholder: '예: 학교 축제(수업 없음), 독서 발표 준비물 확인' });
  const cls = h('select', { value: ev?.class_id || preset.classId || '' }, h('option', { value: '' }, '— 반 상관없음 —'), classes.map((c) => h('option', { value: c.id }, S.classLabel(c))));
  const note = h('input', { type: 'text', value: ev?.note || '', placeholder: '메모 (선택)' });
  modal(ev ? '일정 고치기' : '일정 추가', [
    h('label', {}, '내용', title),
    h('div', { class: 'row' }, h('label', {}, '날짜', date), h('label', { class: 'grow' }, '반', cls)),
    h('label', {}, '메모', note),
  ], [
    ev ? { label: '삭제', danger: true, onClick: () => S.remove('events', { id: ev.id }) } : null,
    { label: '취소' },
    {
      label: '저장', primary: true,
      onClick: async () => {
        const t = title.value.trim();
        if (!t || !date.value) { toast('날짜와 내용을 입력하세요.', 'error'); return false; }
        const row = { date: date.value, title: t, class_id: cls.value || null, note: note.value.trim() };
        if (ev) await S.update('events', ev.id, row); else await S.insert('events', row);
      },
    },
  ].filter(Boolean));
  title.focus();
}

