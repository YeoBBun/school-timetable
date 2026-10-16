// 설정: 교시 수, 수업 요일, 휴업일, 백업, 로그아웃
import { h, append, toast, showError, confirmDialog, fmtDateLong, todayStr, downloadText } from '../ui.js';
import * as S from '../store.js';
import { signOut } from '../app.js';
import * as G from '../google.js';

export default function render(root) {
  const st = S.settings();

  const saveSettings = async (patch) => {
    try {
      await S.upsert('settings', { user_id: S.session.user.id, periods: st.periods, weekdays: st.weekdays, ...patch }, 'user_id');
      toast('저장했습니다.', 'ok');
    } catch (err) { showError(err); }
  };

  const periods = h('select', { value: String(st.periods), onChange: (e) => saveSettings({ periods: Number(e.target.value) }) },
    [4, 5, 6, 7, 8, 9, 10].map((n) => h('option', { value: String(n) }, `${n}교시`)));
  const weekdays = h('select', { value: String(st.weekdays), onChange: (e) => saveSettings({ weekdays: Number(e.target.value) }) },
    h('option', { value: '5' }, '월 ~ 금'), h('option', { value: '6' }, '월 ~ 토'));

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
    h('div', { class: 'page-head' }, h('h2', {}, '설정')),
    h('div', { class: 'cols' },
      h('div', {},
        h('div', { class: 'card' },
          h('h3', {}, '휴업일 · 수업 없는 날'),
          h('p', { class: 'muted small', style: { marginTop: 0 } }, '여기 등록한 날은 오늘 수업 화면에 시간표가 나타나지 않습니다.'),
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
          h('h3', {}, '데이터'),
          h('p', { class: 'muted small', style: { marginTop: 0 } }, "모든 기록은 구글 드라이브 '진도관리' 폴더의 '진도관리-데이터.json' 파일에 자동으로 저장됩니다. 따로 백업해 두려면 아래에서 내려받으세요. (수업 자료 파일은 '수업 자료' 폴더에 있습니다)"),
          h('div', { class: 'row' },
            h('button', { class: 'btn', onClick: backup }, '백업 파일 내려받기'),
            h('button', { class: 'btn', onClick: restore }, '백업 파일 불러오기'),
            S.drive.rootId ? h('a', { class: 'btn', href: G.folderUrl(S.drive.rootId), target: '_blank', rel: 'noopener' }, '드라이브 폴더 열기') : null)),
        h('div', { class: 'card' },
          h('h3', {}, '계정'),
          h('p', { style: { marginTop: 0 } }, S.session.user?.email),
          h('button', {
            class: 'btn btn-danger',
            onClick: async () => { if (await confirmDialog('로그아웃할까요?', { okLabel: '로그아웃' })) signOut(); },
          }, '로그아웃')))));
}
