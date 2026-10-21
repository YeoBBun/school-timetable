// 평가계획 확인 · 고치기 창: 평가계획서(hwpx)를 읽은 결과나 앱에 저장된 평가계획을 보여 주고, 고친 뒤 앱에 반영한다
import { h, toast, showError, modal } from '../ui.js';
import * as S from '../store.js';
import { KINDS, GRADES, titleKey, rubricToText, rubricFromText, maxScore } from '../evalplan.js';

// 앱에 저장된 평가계획을 창에서 쓰는 모양으로
export function planFromApp(year, subject, grade) {
  const semesters = {};
  for (const semester of [1, 2]) {
    const term = { year, semester };
    const items = S.data.assessments
      .filter((a) => S.sameTerm(a, term) && a.subject === subject && a.grade === grade)
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map((a) => ({ id: a.id, title: a.title, period: a.period || '', area: a.area || '', standards: a.standards || [], points: a.points || '', weight: a.weight || '', kind: a.kind || 'plain', rubric: a.rubric || {}, max_score: a.max_score }));
    const plan = S.planOf(term, subject, grade);
    semesters[semester] = { levels: { ...(plan?.levels || {}) }, exams: (plan?.exams || []).map((x) => ({ ...x })), items };
  }
  return { grade, subject, semesters };
}

const RUBRIC_LABELS = {
  count: ['평가 요소 (한 줄에 하나)', '만족한 요소 수 → 점수 (이름 | 요소 수 | 점수)', '특수 경우 (이름 | 점수) 예: 질병결시 | 6'],
  criteria: ['채점 기준 (기준 | 수준별 점수) 예: 영상의 내용이 통일성을 지녔다. | 1,3,5', null, '특수 경우 (이름 | 점수)'],
  grade: ['채점 기준 (기준 | 수준별 점수, 비워도 됨)', '등급 (등급 | 최저 | 최고 | 성취수준 기술)', null],
};

export function openPlanEditor({ plan, year, fileName = '' }) {
  const subjects = S.subjectsOfYear(year);
  const grades = [...new Set(S.classesOfYear(year).map((c) => c.grade).filter(Boolean))].sort();
  const st = {
    sem: plan.semesters[S.viewTerm().semester]?.items.length ? S.viewTerm().semester : (plan.semesters[1].items.length ? 1 : 2),
    grade: plan.grade && grades.includes(plan.grade) ? plan.grade : grades[0],
    subject: plan.subject && subjects.includes(plan.subject) ? plan.subject : subjects[0],
  };
  // 창 안에서 고치는 내용 (항목마다 rubric 은 글 상자 세 칸으로)
  for (const sem of [1, 2]) {
    for (const it of plan.semesters[sem].items) {
      it.text ||= rubricToText(it);
      it.keep ??= true;
    }
  }
  if (!st.grade || !st.subject) { toast(`${year}학년도 반이 없습니다. '설정 → 시간표 · 반'에서 먼저 반을 만드세요.`, 'error'); return; }

  // 이미 앱에 있는 평가 중 이 항목이 고칠 대상: 이름이 같거나, (평가계획서의 오타를 앱에서 고쳤어도) 학기 · 시기 · 채점 방식이 같으면
  const existingOf = (semester) => S.data.assessments.filter((a) => S.sameTerm(a, { year, semester }) && a.subject === st.subject && a.grade === st.grade);
  const autoTarget = (it, semester) => {
    const list = existingOf(semester);
    return (it.id && list.find((a) => a.id === it.id))
      || list.find((a) => titleKey(a.title) === titleKey(it.title))
      || list.find((a) => it.period && a.period === it.period && (a.kind || 'plain') === it.kind);
  };
  // 항목의 대상을 정한다 (앱에서 고친 이름은 그대로 둔다)
  const ensureTarget = (it, semester) => {
    if (it.target !== undefined) return;
    const found = autoTarget(it, semester);
    it.target = found?.id || '';
    if (found && titleKey(found.title) !== titleKey(it.title)) it.title = found.title;
  };
  const resetTargets = () => { for (const n of [1, 2]) for (const it of plan.semesters[n].items) delete it.target; };

  const body = h('div', { class: 'plan-editor' });
  const draw = () => {
    const s = plan.semesters[st.sem];
    body.replaceChildren(
      h('div', { class: 'row' },
        h('label', {}, '학년', h('select', { value: String(st.grade), onChange: (e) => { st.grade = Number(e.target.value); resetTargets(); draw(); } }, grades.map((g) => h('option', { value: String(g) }, `${g}학년`)))),
        h('label', {}, '과목', h('select', { value: st.subject, onChange: (e) => { st.subject = e.target.value; resetTargets(); draw(); } }, subjects.map((x) => h('option', { value: x }, x)))),
        h('span', { class: 'muted small grow' }, `${year}학년도${fileName ? ` · ${fileName}` : ''}`)),
      h('div', { class: 'seg' }, [1, 2].map((n) => h('button', { class: st.sem === n ? 'active' : '', onClick: () => { st.sem = n; draw(); } }, `${n}학기 (평가 ${plan.semesters[n].items.length}개)`))),
      h('details', { class: 'plan-levels', open: !Object.keys(s.levels).length },
        h('summary', {}, `학기 단위 성취수준 (${Object.keys(s.levels).length ? Object.keys(s.levels).join('·') : '없음'})`),
        GRADES.map((g) => h('label', { class: 'level-row' }, h('strong', {}, g),
          h('textarea', { rows: 2, value: s.levels[g] || '', onInput: (e) => { s.levels[g] = e.target.value; } })))),
      examCard(s),
      ...(s.items.length ? s.items.map((it, i) => itemCard(it, i)) : [h('p', { class: 'muted' }, '이 학기 수행평가가 없습니다.')]),
      h('button', { class: 'btn', onClick: () => { s.items.push({ title: '새 수행평가', period: '', area: '', standards: [], points: '', weight: '', kind: 'grade', rubric: {}, text: { a: '', b: '', c: '' }, keep: true }); draw(); } }, '+ 평가 추가'));
  };

  // 정기시험(지필): 성취기준만 (과세특 AI 프롬프트에 씀). 한 줄에 하나 '이름 | [9국01-01] [9국02-03]'
  const examCard = (s) => {
    s.exams ||= [];
    s.examText ??= s.exams.map((x) => `${x.title} | ${(x.standards || []).join(' ')}`).join('\n');
    return h('details', { class: 'plan-levels', open: false },
      h('summary', {}, `정기시험 성취기준 (${s.exams.length ? s.exams.map((x) => x.title).join(' · ') : '없음'})`),
      h('label', {}, "한 줄에 시험 하나: '이름 | 성취기준 코드들'  예) 2학기 지필평가 | [9국02-02] [9국05-01]",
        h('textarea', { rows: 3, value: s.examText, onInput: (e) => { s.examText = e.target.value; } })));
  };
  const examsFrom = (s) => (s.examText == null ? (s.exams || []) : s.examText.split('\n').map((line) => {
    const [title, codes] = line.includes('|') ? line.split('|') : ['', line];
    return { title: title.trim(), standards: String(codes).match(/\[[^\]]+\]/g) || [] };
  }).filter((x) => x.standards.length).map((x, i) => ({ ...x, title: x.title || `정기시험 ${i + 1}` })));

  const itemCard = (it, i) => {
    ensureTarget(it, st.sem);
    const targets = existingOf(st.sem);
    const field = (label, key, attrs = {}) => h('label', {}, label, h('input', { type: 'text', value: Array.isArray(it[key]) ? it[key].join(', ') : it[key] || '', ...attrs,
      onInput: (e) => { it[key] = key === 'standards' ? e.target.value.split(/[,\s]+/).filter(Boolean) : e.target.value; } }));
    const labels = RUBRIC_LABELS[it.kind] || [];
    const box = (k, idx) => (labels[idx] ? h('label', {}, labels[idx], h('textarea', { rows: k === 'b' && it.kind === 'grade' ? 6 : 4, value: it.text[k] || '', onInput: (e) => { it.text[k] = e.target.value; } })) : null);
    return h('div', { class: `card plan-item ${it.keep ? '' : 'off'}` },
      h('div', { class: 'row' },
        h('strong', {}, `${i + 1}.`),
        h('input', { type: 'text', class: 'grow plan-title', value: it.title, onInput: (e) => { it.title = e.target.value; } }),
        h('label', { class: 'inline small' }, h('input', { type: 'checkbox', checked: it.keep, onChange: (e) => { it.keep = e.target.checked; draw(); } }), '넣기')),
      it.keep ? h('div', { class: 'row small' }, h('span', { class: 'muted' }, '앱에서'),
        h('select', { value: it.target, onChange: (e) => { it.target = e.target.value; draw(); } },
          h('option', { value: '' }, '새 평가로 만들기'),
          targets.map((a) => h('option', { value: a.id }, `'${a.title}' 고치기 (입력한 결과는 그대로)`)))) : null,
      it.keep ? [
        h('div', { class: 'row' },
          field('평가 시기', 'period', { style: { width: '150px' } }), field('영역', 'area', { style: { width: '90px' } }),
          field('배점', 'points', { style: { width: '70px' } }), field('반영 비율', 'weight', { style: { width: '70px' } }),
          h('label', {}, '채점 방식', h('select', { value: it.kind, onChange: (e) => { it.kind = e.target.value; draw(); } }, Object.entries(KINDS).map(([k, v]) => h('option', { value: k }, v))))),
        field('성취기준', 'standards'),
        it.kind === 'plain' ? null : h('div', { class: 'plan-rubric' }, box('a', 0), box('b', 1), box('c', 2)),
      ] : null);
  };

  const apply = async () => {
    const { grade, subject } = st;
    let added = 0;
    let updated = 0;
    for (const semester of [1, 2]) {
      const s = plan.semesters[semester];
      const term = { year, semester };
      const levels = Object.fromEntries(Object.entries(s.levels).filter(([, v]) => String(v).trim()));
      const exams = examsFrom(s);
      const old = S.planOf(term, subject, grade);
      if (old) await S.update('eval_plans', old.id, { levels, exams });
      else if (Object.keys(levels).length || exams.length) await S.insert('eval_plans', { year, semester, subject, grade, levels, exams });
      for (const it of s.items) {
        if (!it.keep) continue;
        ensureTarget(it, semester); // 창에서 열어 보지 않은 학기도 대상 · 이름을 먼저 정한다
        if (!it.title.trim()) continue;
        const rubric = it.kind === 'plain' ? {} : rubricFromText(it.kind, it.text);
        const row = { title: it.title.trim(), period: it.period, area: it.area, standards: it.standards, points: it.points, weight: it.weight, kind: it.kind, rubric };
        row.max_score = maxScore({ ...row, max_score: Number(String(it.points).match(/\d+/)?.[0]) || it.max_score || 100 }) || 100;
        const same = it.target ? S.data.assessments.find((a) => a.id === it.target) : null;
        if (same) { await S.update('assessments', same.id, row); updated++; } else { await S.insert('assessments', { ...row, year, semester, subject, grade, dates: {} }); added++; }
      }
    }
    toast(`평가계획을 반영했습니다. 새 평가 ${added}개 · 고친 평가 ${updated}개`, 'ok');
  };

  draw();
  modal('평가계획 확인 · 고치기', [
    h('p', { class: 'muted small' }, '읽어 온 내용을 확인하고, 틀린 곳은 고친 뒤 반영하세요. 이미 있는 평가(같은 이름)는 새 내용으로 바뀌고, 입력해 둔 채점 결과는 그대로 남습니다.'),
    body,
  ], [
    { label: '취소' },
    { label: '앱에 반영', primary: true, onClick: () => apply().catch(showError) },
  ], { wide: true });
}
