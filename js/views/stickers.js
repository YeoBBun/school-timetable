// 칭찬 스티커: 수업 중 TV 에 띄워 학생(또는 조)을 누르면 +1. 학기마다 센다
import { h, append, showError, modal, todayStr, fmtMD, tvOverlay } from '../ui.js';
import * as S from '../store.js';

const DEFAULT_REASONS = ['발표', '협동', '과제', '바른 태도'];
const reasons = () => S.settings().sticker_reasons || DEFAULT_REASONS;

export function renderStickersTab(root, cls) {
  const students = S.studentsOf(cls);
  const term = S.termOf(todayStr());
  if (!students.length) {
    append(root, h('div', { class: 'empty' }, '학생 명단이 없습니다. ', h('a', { href: `#/class/${cls.id}/students` }, '학생 탭에서 먼저 넣으세요.')));
    return;
  }
  const log = S.data.stickers.filter((s) => s.class_id === cls.id && S.sameTerm(S.termOf(s.date), term))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const counts = students.map((s) => ({ s, n: S.stickerCount(cls.id, s.id, term) }));
  const max = Math.max(1, ...counts.map((c) => c.n));
  append(root,
    h('div', { class: 'row', style: { marginBottom: '12px' } },
      h('strong', {}, `${S.termLabel(term)} 칭찬 스티커 ${log.reduce((n, s) => n + (s.n || 1), 0)}개`),
      h('span', { class: 'grow' }),
      h('button', { class: 'btn', onClick: () => reasonsDialog() }, '칭찬 이유 버튼 고치기'),
      h('button', { class: 'btn btn-primary', onClick: () => openStickerBoard(cls) }, '📺 칭찬 스티커 띄우기')),
    h('div', { class: 'cols' },
      h('div', { class: 'card' }, counts.map(({ s, n }) => h('div', { class: 'sticker-row' },
        h('span', { class: 'sticker-name' }, `${s.number} ${s.name}`),
        h('div', { class: 'sticker-bar' }, h('div', { style: { width: `${(n / max) * 100}%` } })),
        h('strong', { class: 'sticker-n' }, n)))),
      h('div', { class: 'card' },
        h('h3', {}, '최근 기록'),
        log.length
          ? log.slice(0, 30).map((x) => h('div', { class: 'row small log-row' },
            h('span', { class: 'muted' }, fmtMD(x.date)),
            h('span', { class: 'grow' }, S.studentById(x.student_id)?.name || '?', x.reason ? h('span', { class: 'muted' }, ` · ${x.reason}`) : null),
            h('button', { class: 'icon-btn danger', title: '취소', onClick: () => S.remove('stickers', { id: x.id }).catch(showError) }, '✕')))
          : h('p', { class: 'muted small' }, '아직 없습니다.'))));
}

function reasonsDialog() {
  const ta = h('textarea', { rows: 6, value: reasons().join('\n') });
  modal('칭찬 이유 버튼', [h('p', { class: 'muted small' }, '한 줄에 하나씩 적으세요. TV 화면에서 이유를 고르고 학생을 누를 수 있습니다(안 골라도 됩니다).'), ta], [
    { label: '취소' },
    { label: '저장', primary: true, onClick: () => S.upsert('settings', { sticker_reasons: ta.value.split('\n').map((v) => v.trim()).filter(Boolean) }, 'user_id') },
  ]);
}

export function openStickerBoard(cls) {
  const term = S.termOf(todayStr());
  const st = { mode: 'student', groupingId: '', reason: '', sort: 'number', pop: new Set() };
  const groupings = () => S.data.groupings.filter((g) => g.class_id === cls.id).sort((a, b) => b.created_at.localeCompare(a.created_at));

  const give = async (ids) => {
    st.pop = new Set(ids); // 다시 그릴 때 누른 카드가 톡 튀도록
    await S.db.from('stickers').insert(ids.map((id) => ({ class_id: cls.id, student_id: id, date: todayStr(), reason: st.reason })));
  };
  // 학생마다 이번 학기 가장 최근 스티커 하나씩 지운다
  const take = async (ids) => {
    const del = [];
    for (const id of ids) {
      const last = S.data.stickers.filter((x) => x.class_id === cls.id && x.student_id === id && S.sameTerm(S.termOf(x.date), term))
        .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
      if (last) del.push(last.id);
    }
    st.pop = new Set();
    if (del.length) await S.db.from('stickers').delete().in('id', del);
  };
  // 카드를 누르면 '부여할까요, 삭제할까요?' 를 TV 화면 안에 크게 묻는다 (전체 화면에서도 보이도록)
  const ask = (title, ids) => {
    const has = ids.some((id) => S.stickerCount(cls.id, id, term) > 0);
    const close = () => box.remove();
    const run = (fn) => async () => { close(); try { await fn(ids); } catch (err) { showError(err); } };
    const box = h('div', { class: 'tv-ask', onClick: (e) => { if (e.target === box) close(); } },
      h('div', { class: 'tv-ask-card' },
        h('div', { class: 'tv-ask-title' }, title),
        h('div', { class: 'tv-ask-sub' }, st.reason ? `이유: ${st.reason}` : '칭찬 스티커를'),
        h('div', { class: 'tv-ask-btns' },
          h('button', { class: 'tv-ask-give', onClick: run(give) }, '⭐ 부여하기'),
          h('button', { class: 'tv-ask-del', disabled: !has, onClick: run(take) }, '삭제하기'),
          h('button', { class: 'tv-ask-cancel', onClick: close }, '취소'))));
    board.overlay.append(box);
    box.querySelector('.tv-ask-give').focus();
  };

  const build = (body) => {
    const students = S.studentsOf(cls);
    const count = (id) => S.stickerCount(cls.id, id, term);
    const gs = groupings();
    const grouping = gs.find((g) => g.id === st.groupingId) || gs[0];
    const bar = h('div', { class: 'tv-bar' },
      h('div', { class: 'seg seg-big' },
        h('button', { class: st.mode === 'student' ? 'active' : '', onClick: () => { st.mode = 'student'; board.redraw(); } }, '학생별'),
        h('button', { class: st.mode === 'group' ? 'active' : '', disabled: !gs.length, title: gs.length ? '' : '조 편성 탭에서 조를 먼저 저장하세요', onClick: () => { st.mode = 'group'; board.redraw(); } }, '조별')),
      st.mode === 'group' && gs.length > 1
        ? h('select', { value: grouping.id, onChange: (e) => { st.groupingId = e.target.value; board.redraw(); } }, gs.map((g) => h('option', { value: g.id }, g.name)))
        : null,
      st.mode === 'student'
        ? h('div', { class: 'seg' },
          h('button', { class: st.sort === 'number' ? 'active' : '', onClick: () => { st.sort = 'number'; board.redraw(); } }, '번호순'),
          h('button', { class: st.sort === 'count' ? 'active' : '', onClick: () => { st.sort = 'count'; board.redraw(); } }, '많은 순'))
        : null,
      h('span', { class: 'grow' }),
      h('div', { class: 'reason-chips' }, ['', ...reasons()].map((r) => h('button', {
        class: `pick-chip ${st.reason === r ? 'on' : ''}`, onClick: () => { st.reason = r; board.redraw(); },
      }, r || '이유 없음'))),
      h('span', { class: 'muted small' }, '카드를 누르면 부여 · 삭제를 고릅니다'));

    let cards;
    if (st.mode === 'group' && grouping) {
      cards = grouping.groups.map((ids, gi) => {
        const members = ids.map((id) => S.studentById(id)).filter(Boolean);
        const total = members.reduce((n, s) => n + count(s.id), 0);
        return h('button', { class: `tv-card group ${members.some((s) => st.pop.has(s.id)) ? 'pop' : ''}`, onClick: () => ask(`${gi + 1}조 (${members.length}명)`, members.map((s) => s.id)) },
          h('div', { class: 'tv-card-name' }, `${gi + 1}조`),
          h('div', { class: 'tv-card-sub' }, members.map((s) => s.name).join(' · ')),
          h('div', { class: 'tv-card-n' }, `⭐ ${total}`));
      });
    } else {
      const list = [...students];
      if (st.sort === 'count') list.sort((a, b) => count(b.id) - count(a.id) || a.number - b.number);
      cards = list.map((s) => {
        const n = count(s.id);
        return h('button', { class: `tv-card ${st.pop.has(s.id) ? 'pop' : ''}`, onClick: () => ask(s.name, [s.id]) },
          h('div', { class: 'tv-card-name' }, s.name),
          h('div', { class: 'tv-card-stars' }, '⭐'.repeat(Math.min(n, 10)), n > 10 ? '+' : ''),
          h('div', { class: 'tv-card-n' }, n));
      });
    }
    body.append(bar, students.length ? h('div', { class: `tv-cards ${st.mode}` }, cards) : h('p', {}, '학생 명단이 없습니다.'));
    st.pop = new Set();
  };

  const onData = () => board.redraw();
  const board = tvOverlay(`${S.classLabel(cls)} 칭찬 스티커`, build, { onClose: () => S.offChange(onData) });
  S.onChange(onData);
}
