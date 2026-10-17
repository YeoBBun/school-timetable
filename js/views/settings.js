// 설정: 탭 두 개 — 기본 설정(교시 수, 수업 요일, 2학기 시작일, 휴업일, 백업, 로그아웃) · 시간표 · 반
import { h, append, toast, showError, confirmDialog, fmtDateLong, todayStr, downloadText } from '../ui.js';
import * as S from '../store.js';
import { signOut } from '../app.js';
import * as G from '../google.js';
import { addSamples, clearAllSamples } from './students.js';
import timetable from './timetable.js';

export default function render(root, sub) {
  const tabs = [{ key: '', label: '기본 설정' }, { key: 'timetable', label: '시간표 · 반' }];
  const cur = sub === 'timetable' ? 'timetable' : '';
  const body = h('div', {});
  append(root,
    h('div', { class: 'page-head' }, h('h2', {}, '설정')),
    h('div', { class: 'tabs' }, tabs.map((t) => h('a', { class: `tab ${t.key === cur ? 'active' : ''}`, href: t.key ? `#/settings/${t.key}` : '#/settings' }, t.label))),
    body);
  if (cur === 'timetable') timetable(body);
  else general(body);
}

function general(root) {
  const st = S.settings();

  const saveSettings = async (patch) => {
    try {
      await S.upsert('settings', { periods: st.periods, weekdays: st.weekdays, sem2_start: st.sem2_start, ...patch }, 'user_id');
      toast('저장했습니다.', 'ok');
    } catch (err) { showError(err); }
  };

  const periods = h('select', { value: String(st.periods), onChange: (e) => saveSettings({ periods: Number(e.target.value) }) },
    [4, 5, 6, 7, 8, 9, 10].map((n) => h('option', { value: String(n) }, `${n}교시`)));
  const weekdays = h('select', { value: String(st.weekdays), onChange: (e) => saveSettings({ weekdays: Number(e.target.value) }) },
    h('option', { value: '5' }, '월 ~ 금'), h('option', { value: '6' }, '월 ~ 토'));
  // 2학기 시작일: 올해 날짜로 보여 주고 월-일만 저장한다
  const year = new Date().getFullYear();
  const sem2 = h('input', {
    type: 'date', value: `${year}-${st.sem2_start}`,
    onChange: (e) => e.target.value && saveSettings({ sem2_start: e.target.value.slice(5) }),
  });

  // 휴업일
  const offDate = h('input', { type: 'date', value: todayStr() });
  const offNote = h('input', { type: 'text', placeholder: '사유 (예: 개교기념일, 중간고사)', style: { flex: 1 } });
  const addOff = async (e) => {
    e.preventDefault();
    if (!offDate.value) return;
    try {
      await S.upsert('days_off', { user_id: S.session.user.id, date: offDate.value, note: offNote.value.trim() }, 'user_id,date');
      offNote.value = '';
      toast('추가했습니다.', 'ok');
    } catch (err) { showError(err); }
  };
  const offs = [...S.data.days_off].sort((a, b) => a.date.localeCompare(b.date));

  const backup = () => {
    const json = JSON.stringify({ exported_at: new Date().toISOString(), ...S.data }, null, 2);
    downloadText(`진도관리-백업-${todayStr()}.json`, json, 'application/json');
  };

  const restore = () => {
    const input = h('input', { type: 'file', accept: '.json,application/json' });
    input.addEventListener('change', async () => {
      const file = input.files[0];
      if (!file) return;
      try {
        const json = JSON.parse(await file.text());
        if (!(json.tables || json.classes)) throw new Error('진도관리 백업 파일이 아닙니다.');
        if (!await confirmDialog(`'${file.name}' 백업으로 지금 데이터를 모두 바꿀까요?\n지금 있는 기록은 사라집니다.`, { okLabel: '불러오기' })) return;
        S.importBackup(json);
        toast('백업을 불러왔습니다.', 'ok');
      } catch (err) { showError(err); }
    });
    input.click();
  };

  append(root,
    h('div', { class: 'cols' },
      h('div', {},
        h('div', { class: 'card' },
          h('h3', {}, '휴업일 · 수업 없는 날'),
          h('p', { class: 'muted small', style: { marginTop: 0 } }, "여기 등록한 날은 '홈' 화면에 시간표가 나타나지 않습니다."),
          h('form', { class: 'row', onSubmit: addOff }, offDate, offNote, h('button', { class: 'btn btn-primary', type: 'submit' }, '추가')),
          offs.length
            ? h('table', { class: 'table', style: { marginTop: '12px' } }, h('tbody', {}, offs.map((o) => h('tr', {},
              h('td', { style: { width: '200px' } }, fmtDateLong(o.date)),
              h('td', {}, o.note || h('span', { class: 'muted' }, '-')),
              h('td', { style: { width: '40px' } }, h('button', {
                class: 'icon-btn danger', title: '삭제',
                onClick: async () => { try { await S.remove('days_off', { id: o.id }); } catch (err) { showError(err); } },
              }, '✕'))))))
            : null)),
      h('div', {},
        h('div', { class: 'card' },
          h('h3', {}, '시간표'),
          h('div', { class: 'row' }, h('label', {}, '하루 교시 수', periods), h('label', {}, '수업 요일', weekdays))),
        h('div', { class: 'card' },
          h('h3', {}, '학년도 · 학기'),
          h('div', { class: 'row' }, h('label', {}, '2학기 시작일', sem2)),
          h('p', { class: 'muted small', style: { marginBottom: 0 } }, '학년도는 3월 1일에 시작합니다. 기록과 자료는 날짜에 따라 학기별로 정리됩니다(1~2월은 앞 학년도 2학기).')),
        h('div', { class: 'card' },
          h('h3', {}, '데이터'),
          h('p', { class: 'muted small', style: { marginTop: 0 } }, "모든 기록은 구글 드라이브 '진도관리' 폴더의 '진도관리-데이터.json' 파일에 자동으로 저장됩니다. 따로 백업해 두려면 아래에서 내려받으세요. (수업 자료 파일은 '수업 자료' 폴더에 있습니다)"),
          h('div', { class: 'row' },
            h('button', { class: 'btn', onClick: backup }, '백업 파일 내려받기'),
            h('button', { class: 'btn', onClick: restore }, '백업 파일 불러오기'),
            S.drive.rootId ? h('a', { class: 'btn', href: G.folderUrl(S.drive.rootId), target: '_blank', rel: 'noopener' }, '드라이브 폴더 열기') : null)),
        h('div', { class: 'card' },
          h('h3', {}, '예시 학생 (시험용)'),
          h('p', { class: 'muted small', style: { marginTop: 0 } }, '학생이 없는 올해 반마다 가짜 학생 5명을 넣어 조 편성 · 칭찬 스티커 · 수행평가를 미리 써 볼 수 있습니다. 나중에 한 번에 지울 수 있습니다.'),
          h('div', { class: 'row' },
            h('button', { class: 'btn', onClick: () => addSamples(S.classesOfYear(S.termOf(todayStr()).year)).catch(showError) }, '모든 반에 예시 학생 넣기'),
            h('button', { class: 'btn btn-danger', onClick: () => clearAllSamples().catch(showError) }, '예시 학생 모두 지우기'))),
        h('div', { class: 'card' },
          h('h3', {}, '계정'),
          h('p', { style: { marginTop: 0 } }, S.session.user?.email),
          h('button', {
            class: 'btn btn-danger',
            onClick: async () => { if (await confirmDialog('로그아웃할까요?', { okLabel: '로그아웃' })) signOut(); },
          }, '로그아웃')))));
}
