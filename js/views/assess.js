// 수행평가: 평가계획서(hwpx) 불러오기, 평가 만들기(학기 · 과목 · 학년), 반별 날짜, 세부 기준 채점 · 관찰 메모, 구글 시트 채점표
import { h, append, toast, showError, modal, confirmDialog, fmtMD, classChip } from '../ui.js';
import * as S from '../store.js';
import { describeChange, hasResult, gradeSheetId, createGradeSheet, readGradeSheet } from '../gradebook.js';
import { sheetUrl } from '../google.js';
import { go } from '../app.js';
import { KINDS, GRADES, rubricResult, maxScore, parsePlan } from '../evalplan.js';
import { readHwpxTables } from '../hwpx.js';
import { openPlanEditor, planFromApp } from './planEditor.js';

const view = { term: null, subject: '', openId: '', classId: '' };

// 평가 대상 반: 그 학년도 · 과목 · 학년의 반
const targetClasses = (a) => S.classesOfYear(a.year).filter((c) => c.subject === a.subject && c.grade === a.grade);


// ---- 수행평가 메뉴 ----
export default function render(root) {
  // 학기는 왼쪽 위에서 고른 학기를 따른다
  const term = S.viewTerm();
  if (!view.term || !S.sameTerm(view.term, term)) { view.term = term; view.openId = ''; }
  const subjects = S.subjectsOfYear(term.year);
  if (!subjects.includes(view.subject)) view.subject = subjects[0] || '';
  const rerender = () => { root.replaceChildren(); render(root); };
  const open = S.data.assessments.find((a) => a.id === view.openId);

  const subjectTabs = subjects.length > 1
    ? h('div', { class: 'seg' }, subjects.map((sj) => h('button', { class: sj === view.subject ? 'active' : '', onClick: () => { view.subject = sj; view.openId = ''; rerender(); } }, sj)))
    : null;

  if (open) {
    append(root,
      h('div', { class: 'page-head' },
        h('h2', {}, open.title), h('span', { class: 'muted small' }, [S.termLabel(open), open.subject, `${open.grade}학년`, KINDS[open.kind || 'plain'], open.period].filter(Boolean).join(' · ')),
        h('button', { class: 'btn', onClick: () => { view.openId = ''; rerender(); } }, '← 목록'),
        h('button', { class: 'btn', onClick: () => assessmentDialog(open) }, '수정'),
        h('button', { class: 'btn btn-primary', onClick: () => openGradeSheet(open) }, '📊 구글 시트로 채점'),
        open.sheet_id ? h('button', { class: 'btn btn-primary', onClick: () => importGradeSheet(open) }, '📥 시트에서 가져오기') : null),
      open.sheet_id ? h('p', { class: 'muted small' }, "구글 시트에서 채점한 뒤 '📥 시트에서 가져오기'를 누르면 바뀌는 내용을 보여 주고 반영합니다. 학생 명단 · 채점 기준이 바뀌었으면 ",
        h('a', { href: '#', onClick: (e) => { e.preventDefault(); remakeGradeSheet(open); } }, '시트 새로 만들기'), '.') : null,
      scoreBoard(open));
    return;
  }

  const list = S.data.assessments.filter((a) => S.sameTerm(a, term) && a.subject === view.subject)
    .sort((a, b) => a.grade - b.grade || a.created_at.localeCompare(b.created_at));
  append(root,
    h('div', { class: 'page-head' },
      h('h2', {}, '수행평가'), h('span', { class: 'muted' }, S.termLabel(term)), subjectTabs,
      h('span', { class: 'grow' }),
      view.subject ? h('button', { class: 'btn btn-primary', onClick: () => importPlan(term) }, '📄 평가계획서 올리기') : null,
      view.subject ? h('button', { class: 'btn', onClick: () => editPlan(term) }, '평가계획 보기 · 고치기') : null,
      view.subject ? h('button', { class: 'btn', onClick: () => assessmentDialog(null, { term, subject: view.subject }) }, '+ 새 수행평가') : null),
    !view.subject
      ? h('div', { class: 'empty' }, `${term.year}학년도 담당 반이 없습니다. '설정 → 시간표 · 반'에서 먼저 반을 추가하세요.`)
      : list.length
        ? list.map((a) => assessmentCard(a, () => { view.openId = a.id; view.classId = ''; rerender(); }))
        : h('div', { class: 'empty' }, "아직 수행평가가 없습니다. 학기 초에 만든 평가계획서(hwpx)를 '📄 평가계획서 올리기'로 넣으면 평가와 채점 기준이 한 번에 만들어집니다."),
    h('p', { class: 'muted small' }, '평가계획서를 올리면 1 · 2학기 평가가 함께 만들어집니다(이미 있는 같은 이름 평가는 기준만 새로 바뀝니다). 나이스 수행평가 일괄 입력 양식은 내년에 추가할 예정입니다.'));
}

// 평가계획서(hwpx) 올리기 → 읽은 내용을 확인 창에서 고친 뒤 반영
function importPlan(term) {
  const input = h('input', { type: 'file', accept: '.hwpx' });
  input.addEventListener('change', async () => {
    const file = input.files[0];
    if (!file) return;
    try {
      const plan = parsePlan(await readHwpxTables(file));
      const n = plan.semesters[1].items.length + plan.semesters[2].items.length;
      if (!n) throw new Error('평가계획서에서 수행평가 표를 찾지 못했습니다. 학교 평가계획서 양식이 맞는지 확인해 주세요. (hwp 파일이면 한글에서 hwpx 로 저장해 주세요)');
      openPlanEditor({ plan, year: term.year, fileName: file.name });
    } catch (err) { showError(err); }
  });
  input.click();
}

function editPlan(term) {
  const grades = [...new Set(S.classesOfYear(term.year).filter((c) => c.subject === view.subject).map((c) => c.grade).filter(Boolean))].sort();
  if (!grades.length) return toast('반의 학년이 정해지지 않았습니다.', 'error');
  openPlanEditor({ plan: planFromApp(term.year, view.subject, grades[0]), year: term.year });
}

// 결과가 들어간 학생인가 (점수 · 등급 · 체크 · 특수 · 관찰 메모 중 하나라도)

function progressOf(a, classes) {
  let total = 0;
  let done = 0;
  for (const c of classes) {
    for (const st of S.studentsOf(c)) {
      total++;
      if (hasResult(S.scoreOf(a.id, st.id))) done++;
    }
  }
  return { total, done };
}

function assessmentCard(a, onOpen) {
  const classes = targetClasses(a);
  const { total, done } = progressOf(a, classes);
  return h('div', { class: 'card clickable assess-card', onClick: onOpen },
    h('div', { class: 'row' },
      h('h3', { style: { margin: 0 } }, a.title),
      h('span', { class: 'badge' }, KINDS[a.kind || 'plain']),
      h('span', { class: 'muted small' }, [`${a.grade}학년`, a.kind === 'grade' ? '' : `만점 ${maxScore(a)}`, a.period, a.area].filter(Boolean).join(' · ')),
      h('span', { class: 'grow' }),
      h('span', { class: `badge ${total && done === total ? 'badge-ok' : ''}` }, `입력 ${done} / ${total}`)),
    a.standards?.length ? h('div', { class: 'muted small', style: { marginTop: '4px' } }, a.standards.join(' ')) : null,
    h('div', { class: 'row small', style: { marginTop: '8px' } }, classes.map((c) => h('span', { class: 'date-chip' },
      S.classLabel(c), ' ', a.dates?.[c.id] ? h('strong', {}, fmtMD(a.dates[c.id])) : h('span', { class: 'muted' }, '날짜 미정')))),
    a.note ? h('p', { class: 'muted small', style: { margin: '6px 0 0' } }, a.note) : null);
}

// 반을 고르는 탭 + 점수 표
function scoreBoard(a) {
  const classes = targetClasses(a);
  if (!classes.length) return h('div', { class: 'empty' }, '이 평가를 볼 반이 없습니다.');
  if (!classes.some((c) => c.id === view.classId)) view.classId = classes[0].id;
  const cls = S.classById(view.classId);
  return h('div', {},
    h('div', { class: 'tabs' }, classes.map((c) => {
      const p = progressOf(a, [c]);
      return h('button', { class: `tab ${c === cls ? 'active' : ''}`, onClick: () => { view.classId = c.id; go('assess'); } },
        `${S.classLabel(c)} `, h('span', { class: 'small' }, `${p.done}/${p.total}`));
    })),
    scoreTable(a, cls));
}

// 채점 기준 안내 (표 위에 접어 둠)
function rubricGuide(a) {
  const rb = a.rubric || {};
  if (a.kind === 'count') {
    return h('details', { class: 'rubric-guide' }, h('summary', {}, '채점 기준 보기'),
      h('ol', {}, (rb.elements || []).map((e) => h('li', {}, e))),
      h('div', { class: 'small' }, [...(rb.map || []).map((m) => `${m.label} ${m.score}점`), ...(rb.specials || []).map((x) => `${x.label} ${x.score}점`)].join(' · ')));
  }
  if (a.kind === 'criteria' || a.kind === 'grade') {
    return h('details', { class: 'rubric-guide' }, h('summary', {}, '채점 기준 보기'),
      (rb.criteria || []).length ? h('ol', {}, rb.criteria.map((c) => h('li', {}, c.text, c.levels.length ? h('span', { class: 'muted' }, ` (${c.levels.join(' · ')})`) : null))) : null,
      (rb.grades || []).map((g) => h('div', { class: 'small grade-desc' }, h('strong', {}, `${g.grade} `), g.min != null ? h('span', { class: 'muted' }, `${g.min}~${g.max} `) : null, g.desc)),
      (rb.specials || []).length ? h('div', { class: 'small' }, rb.specials.map((x) => `${x.label} ${x.score}점`).join(' · ')) : null);
  }
  return null;
}

const detailOpen = new Set(); // 등급형에서 '세부 기준으로 채점' 을 켠 평가

export function scoreTable(a, cls) {
  const students = S.studentsOf(cls);
  if (!students.length) {
    return h('div', { class: 'empty' }, `${S.classLabel(cls)} 학생 명단이 없습니다. `, h('a', { href: `#/class/${cls.id}/students` }, '학생 탭에서 넣기'));
  }
  const kind = a.kind || 'plain';
  const rb = a.rubric || {};
  const max = maxScore(a);
  const date = h('input', {
    type: 'date', value: a.dates?.[cls.id] || '',
    onChange: (e) => S.update('assessments', a.id, { dates: { ...(a.dates || {}), [cls.id]: e.target.value || null } }).catch(showError),
  });
  const results = students.map((st) => rubricResult(a, S.scoreOf(a.id, st.id) || {}));
  const scores = results.map((r) => r.score).filter((v) => v != null);
  const avg = scores.length ? (scores.reduce((x, y) => x + y, 0) / scores.length).toFixed(1) : '-';
  const dist = GRADES.map((g) => `${g} ${results.filter((r) => r.grade === g).length}`).join(' · ');
  const done = students.filter((st) => hasResult(S.scoreOf(a.id, st.id))).length;

  // 한 학생 결과 저장: 기존 값에 patch 를 합치고 점수 · 등급을 다시 계산한다
  const save = async (st, patch) => {
    const cur = S.scoreOf(a.id, st.id) || {};
    const next = { checks: cur.checks || {}, special: cur.special || '', grade: cur.grade || '', note: cur.note || '', score: cur.score ?? null, ...patch };
    if (kind !== 'plain') next.score = rubricResult(a, next).score;
    if (!hasResult(next)) { if (S.scoreOf(a.id, st.id)) await S.remove('scores', { assessment_id: a.id, student_id: st.id }); return; }
    await S.upsert('scores', { assessment_id: a.id, student_id: st.id, ...next }, 'assessment_id,student_id');
  };
  const specialSel = (st, cur) => ((rb.specials || []).length
    ? h('select', { class: 'special-sel', value: cur.special || '', title: '결시 · 표절 등', onChange: (e) => save(st, { special: e.target.value }).catch(showError) },
      h('option', { value: '' }, '—'), rb.specials.map((x) => h('option', { value: x.label }, `${x.label} (${x.score})`)))
    : null);
  const noteIn = (st, cur, i) => h('input', {
    type: 'text', class: 'note-input', value: cur.note || '', placeholder: '관찰 메모 (과세특에 쓰입니다)', 'data-fk': `note-${a.id}-${st.id}`,
    onChange: (e) => save(st, { note: e.target.value.trim() }).catch(showError),
    onKeydown: (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); notes[i + 1]?.focus(); } },
  });
  const notes = [];
  const showDetail = kind === 'grade' && detailOpen.has(a.id);

  // 점수 입력형 (예전 방식)
  const inputs = [];
  const commit = async (input, st) => {
    const raw = input.value.trim();
    if (raw === '') return save(st, { score: null });
    const v = Number(raw);
    if (Number.isNaN(v) || v < 0 || v > a.max_score) {
      toast(`0 ~ ${a.max_score} 사이 숫자를 입력하세요.`, 'error');
      input.value = S.scoreOf(a.id, st.id)?.score ?? '';
      return;
    }
    await save(st, { score: v });
  };

  const head = ['번호', '이름'];
  if (kind === 'plain') head.push('점수');
  if (kind === 'count') head.push(...(rb.elements || []).map((_, i) => '①②③④⑤⑥⑦⑧⑨⑩'[i] || i + 1), '특수', '점수');
  if (kind === 'criteria' || showDetail) head.push(...(rb.criteria || []).map((_, i) => '①②③④⑤⑥⑦⑧⑨⑩'[i] || i + 1));
  if (kind === 'criteria') head.push('특수', '점수');
  if (kind === 'grade') head.push('등급');
  head.push('관찰 메모');

  const rows = students.map((st, i) => {
    const cur = S.scoreOf(a.id, st.id) || {};
    const res = results[i];
    const checks = cur.checks || {};
    const cells = [h('td', { class: 'center' }, st.number), h('td', { class: 'nowrap' }, st.name)];
    if (kind === 'plain') {
      const input = h('input', {
        type: 'number', min: 0, max: a.max_score, step: 'any', value: cur.score ?? '', class: 'score-input', 'data-fk': `score-${a.id}-${st.id}`,
        onChange: () => commit(input, st).catch(showError),
        // Enter · ↓ 는 다음 학생, ↑ 는 앞 학생
        onKeydown: (e) => {
          const step = e.key === 'Enter' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
          if (!step) return;
          e.preventDefault();
          const next = inputs[i + step];
          if (next) { next.focus(); next.select(); } else input.blur();
        },
      });
      inputs.push(input);
      cells.push(h('td', {}, input, h('span', { class: 'muted small' }, ` / ${a.max_score}`)));
    }
    if (kind === 'count') {
      (rb.elements || []).forEach((el, k) => cells.push(h('td', { class: 'center' }, h('input', {
        type: 'checkbox', title: el, checked: !!checks[k], disabled: !!cur.special,
        onChange: (e) => { const c = { ...checks }; if (e.target.checked) c[k] = true; else delete c[k]; save(st, { checks: c }).catch(showError); },
      }))));
      cells.push(h('td', {}, specialSel(st, cur)), h('td', { class: 'center' }, h('strong', {}, res.score ?? '')));
    }
    if (kind === 'criteria' || showDetail) {
      (rb.criteria || []).forEach((c, k) => cells.push(h('td', {}, h('select', {
        class: 'level-sel', title: c.text, value: checks[k] != null ? String(checks[k]) : '', disabled: !!cur.special,
        onChange: (e) => { const ch = { ...checks }; if (e.target.value === '') delete ch[k]; else ch[k] = Number(e.target.value); save(st, { checks: ch }).catch(showError); },
      }, h('option', { value: '' }, '—'), [...c.levels].sort((x, y) => y - x).map((lv) => h('option', { value: String(lv) }, lv))))));
    }
    if (kind === 'criteria') cells.push(h('td', {}, specialSel(st, cur)), h('td', { class: 'center' }, h('strong', {}, res.score ?? '')));
    if (kind === 'grade') {
      cells.push(h('td', { class: 'nowrap' }, h('div', { class: 'grade-btns' }, GRADES.map((g) => h('button', {
        class: `${res.grade === g ? 'on' : ''} ${cur.grade === g ? 'manual' : ''}`,
        title: (rb.grades || []).find((x) => x.grade === g)?.desc || '',
        onClick: () => save(st, { grade: cur.grade === g ? '' : g }).catch(showError),
      }, g))), showDetail && res.score != null ? h('span', { class: 'muted small' }, ` ${res.score}점`) : null));
    }
    const ni = noteIn(st, cur, i);
    notes.push(ni);
    cells.push(h('td', { class: 'note-cell' }, ni));
    return h('tr', {}, cells);
  });

  return h('div', { class: 'card' },
    h('div', { class: 'row', style: { marginBottom: '10px' } },
      classChip(cls, S.classLabel(cls)),
      h('label', { class: 'inline small' }, '평가일', date),
      h('span', { class: 'muted small' }, kind === 'grade' ? `입력 ${done}/${students.length}명 · ${dist}` : `입력 ${done}/${students.length}명 · 평균 ${avg}${max ? ` / ${max}` : ''}`),
      h('span', { class: 'grow' }),
      kind === 'grade' && (rb.criteria || []).length
        ? h('label', { class: 'inline small' }, h('input', { type: 'checkbox', checked: showDetail, onChange: (e) => { if (e.target.checked) detailOpen.add(a.id); else detailOpen.delete(a.id); go(location.hash.slice(2)); } }), '세부 기준으로 채점')
        : null,
      h('button', { class: 'btn btn-sm', title: '이 평가의 모든 반 채점표(구글 시트)', onClick: () => openGradeSheet(a) }, '📊 구글 시트로 채점'),
      a.sheet_id ? h('button', { class: 'btn btn-sm', onClick: () => importGradeSheet(a) }, '📥 시트에서 가져오기') : null),
    rubricGuide(a),
    h('div', { class: 'table-wrap' }, h('table', { class: 'table score-table' },
      h('thead', {}, h('tr', {}, head.map((t, k) => h('th', { title: kind === 'count' && k >= 2 && k < 2 + (rb.elements || []).length ? rb.elements[k - 2] : (rb.criteria || [])[k - 2]?.text || '' }, t)))),
      h('tbody', {}, rows))),
    h('p', { class: 'muted small', style: { margin: '8px 0 0' } },
      kind === 'grade' ? '등급 버튼을 누르면 정해지고, 한 번 더 누르면 지워집니다. 관찰 메모는 과세특 화면에 모여 초안 재료가 됩니다.'
        : kind === 'plain' ? 'Enter 또는 ↓ 를 누르면 다음 학생으로 넘어갑니다. 칸을 비우면 점수가 지워집니다.'
          : '요소에 체크하거나 수준을 고르면 점수가 자동으로 계산됩니다. 관찰 메모는 과세특 초안 재료가 됩니다.'));
}

// 구글 시트 채점표 열기 (없으면 만든다). 새 탭은 누른 순간 열어 둬야 팝업 차단에 걸리지 않는다
async function openGradeSheet(a, remake = false) {
  const win = window.open('', '_blank');
  if (win) win.document.write('<p style="font:16px sans-serif;padding:24px">구글 시트를 준비하는 중…</p>');
  try {
    let id = remake ? null : await gradeSheetId(a);
    if (!id) {
      toast('구글 시트 채점표를 만드는 중…');
      id = await createGradeSheet(a, targetClasses(a));
    }
    if (win) win.location.href = sheetUrl(id);
    else modal('구글 시트 채점표', h('p', {}, '새 탭이 막혀서 열지 못했습니다. ', h('a', { href: sheetUrl(id), target: '_blank', rel: 'noopener' }, '여기를 눌러 여세요.')));
  } catch (err) {
    win?.close();
    showError(err);
  }
}

async function remakeGradeSheet(a) {
  const ok = await confirmDialog("지금 앱에 있는 결과로 구글 시트를 새로 만듭니다.\n예전 시트는 드라이브 휴지통으로 갑니다(30일 동안 되살릴 수 있음).\n예전 시트에서 아직 가져오지 않은 채점이 있으면 먼저 '📥 시트에서 가져오기'를 하세요.", { okLabel: '새로 만들기', danger: false });
  if (ok) openGradeSheet(a, true);
}

async function importGradeSheet(a) {
  try {
    const id = await gradeSheetId(a);
    if (!id) { toast("구글 시트를 찾지 못했습니다(지워졌거나 휴지통에 있음). '📊 구글 시트로 채점'을 눌러 새로 만드세요.", 'error'); return; }
    toast('구글 시트를 읽는 중…');
    showImport(a, await readGradeSheet(a, targetClasses(a), id), '구글 시트에서 가져오기');
  } catch (err) { showError(err); }
}

// 읽은 채점 결과 → 바뀌는 내용 미리보기 → 반영
function showImport(a, res, title) {
  if (!res.sheets) { toast("이 평가의 반 시트를 찾지 못했습니다. 이 평가 화면에서 받은 채점표인지 확인하세요.", 'error'); return; }
  const added = res.changes.filter((c) => c.isNew).length;
  const list = (label, items, cls = '') => (items.length ? h('details', { open: items.length <= 10 }, h('summary', { class: cls }, `${label} ${items.length}`), h('ul', { class: 'small' }, items.slice(0, 100).map((t) => h('li', {}, t)))) : null);
  modal(title, [
    h('p', {}, h('strong', {}, `새로 들어감 ${added}명 · 바뀜 ${res.changes.length - added}명`), h('span', { class: 'muted' }, ` · 그대로 ${res.same}명`)),
    list('바뀌는 학생', res.changes.map((c) => `${S.classLabel(c.cls)} ${c.st.number}번 ${c.st.name}: ${c.isNew ? '새로 · ' : ''}${describeChange(a, c)}`)),
    list('⚠️ 넣지 않는 값 (목록에 없는 값)', res.errors, 'warn-text'),
    list('⚠️ 번호 · 이름이 명단과 달라 건너뛴 줄', res.unknown, 'warn-text'),
    res.skipped.length ? h('p', { class: 'muted small' }, `반을 알 수 없어 건너뛴 시트: ${res.skipped.join(', ')}`) : null,
    h('p', { class: 'muted small' }, '빈칸은 앱에 있던 값을 그대로 둡니다. 점수 · 등급은 앱의 채점 기준으로 다시 계산합니다.'),
  ], [
    { label: '취소' },
    res.changes.length ? {
      label: `반영 (${res.changes.length}명)`, primary: true,
      onClick: async () => {
        for (const c of res.changes) await S.upsert('scores', { assessment_id: a.id, student_id: c.st.id, ...c.next }, 'assessment_id,student_id');
        toast(`${res.changes.length}명 결과를 넣었습니다.`, 'ok');
      },
    } : null,
  ].filter(Boolean), { wide: true });
}

// 수행평가 만들기 · 고치기
export function assessmentDialog(a, { term, subject } = {}) {
  term = a ? { year: a.year, semester: a.semester } : term;
  subject = a ? a.subject : subject;
  const grades = [...new Set(S.classesOfYear(term.year).filter((c) => c.subject === subject && c.grade).map((c) => c.grade))].sort();
  if (!grades.length) { toast(`${subject} 반의 학년이 정해지지 않았습니다.`, 'error'); return; }
  const title = h('input', { type: 'text', value: a?.title || '', placeholder: '예: 갈등 해결 글쓰기' });
  const max = h('input', { type: 'number', min: 1, value: a?.max_score ?? 100, style: { width: '100px' } });
  const grade = h('select', { value: String(a?.grade || grades[0]), disabled: !!a, onChange: () => drawDates() }, grades.map((g) => h('option', { value: String(g) }, `${g}학년`)));
  const note = h('input', { type: 'text', value: a?.note || '', placeholder: '메모 (예: 채점 기준표는 자료실에)' });
  const dates = { ...(a?.dates || {}) };
  const dateBox = h('div', { class: 'date-grid' });
  const drawDates = () => {
    const classes = S.classesOfYear(term.year).filter((c) => c.subject === subject && c.grade === Number(grade.value));
    dateBox.replaceChildren(...classes.map((c) => h('label', {}, S.classLabel(c),
      h('input', { type: 'date', value: dates[c.id] || '', onChange: (e) => { dates[c.id] = e.target.value || null; } }))));
  };
  drawDates();
  modal(a ? '수행평가 고치기' : `${S.termLabel(term)} ${subject} 새 수행평가`, [
    h('label', {}, '평가 이름', title),
    h('div', { class: 'row' }, h('label', {}, '학년', grade), h('label', {}, '만점', max)),
    h('div', { class: 'section-title', style: { margin: '4px 0 0' } }, '반별 평가일 (모르면 비워 두세요 · 일정과 캘린더에 나옵니다)'),
    dateBox,
    h('label', {}, '메모', note),
  ], [
    a ? {
      label: '삭제', danger: true,
      onClick: async () => {
        if (!await confirmDialog(`'${a.title}'과(와) 입력한 점수를 모두 지울까요?`)) return false;
        await S.remove('assessments', { id: a.id });
        view.openId = '';
      },
    } : null,
    { label: '취소' },
    {
      label: '저장', primary: true,
      onClick: async () => {
        const t = title.value.trim();
        const m = Number(max.value);
        if (!t || !(m > 0)) { toast('평가 이름과 만점을 입력하세요.', 'error'); return false; }
        const row = { title: t, max_score: m, dates, note: note.value.trim() };
        if (a) await S.update('assessments', a.id, row);
        else await S.insert('assessments', { ...row, year: term.year, semester: term.semester, subject, grade: Number(grade.value) });
      },
    },
  ].filter(Boolean), { wide: true });
  title.focus();
}

// ---- 반 화면의 '수행평가' 탭: 이 반이 보는 평가마다 점수 표 ----
export function renderClassAssess(root, cls) {
  const term = S.viewTerm();
  const list = cls.grade ? S.assessmentsOf(cls, term) : [];
  append(root,
    h('div', { class: 'row', style: { marginBottom: '12px' } },
      h('strong', {}, `${S.termLabel(term)} ${cls.subject} 수행평가 ${list.length}개`),
      h('span', { class: 'grow' }),
      cls.grade ? h('button', { class: 'btn btn-primary', onClick: () => assessmentDialog(null, { term, subject: cls.subject }) }, '+ 새 수행평가') : null),
    list.length
      ? list.map((a) => h('div', { class: 'assess-block' },
        h('div', { class: 'row' }, h('h3', { style: { margin: '0 0 8px' } }, a.title), h('span', { class: 'muted small' }, `만점 ${a.max_score}`),
          h('span', { class: 'grow' }), h('button', { class: 'btn btn-sm', onClick: () => assessmentDialog(a) }, '수정')),
        scoreTable(a, cls)))
      : h('div', { class: 'empty' }, '이번 학기 수행평가가 없습니다.'));
}
