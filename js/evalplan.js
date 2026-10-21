// 평가계획서 해석 · 세부 기준 채점 · 과세특 문장 만들기 (화면 없이 계산만)
//
// 평가 항목(assessment)의 kind · rubric
//   plain    : 점수만 입력
//   count    : 요소 개수형  rubric = { elements: [글], map: [{ label, n, score }], specials: [{ label, score }] }
//   criteria : 기준별 수준형 rubric = { criteria: [{ text, levels: [점수…] }], specials }
//   grade    : 등급형       rubric = { criteria: [{ text, levels }], grades: [{ grade, min, max, rule, desc }] }
// 학생 결과(scores 행): checks{기준 번호: true | 점수}, special(특수 항목 이름), grade(A~E), note(관찰 메모), score(계산값)

export const KINDS = { plain: '점수 입력', count: '요소 개수', criteria: '기준별 점수', grade: '등급(과정평가)' };
export const GRADES = ['A', 'B', 'C', 'D', 'E'];

const sp = (s) => String(s ?? '').replace(/[\s ]+/g, ' ').trim();
const nums = (s) => (String(s).match(/\d+/g) || []).map(Number);
const CIRCLED = /[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮]/;
// 평가 이름 비교용: 띄어쓰기 · 괄호 · '(30점)' · '<말하기>' 무시
export const titleKey = (s) => sp(s).replace(/<[^>]*>/g, '').replace(/\(\s*\d+\s*점\s*\)/g, '').replace(/[\s()·․.,]/g, '');
const cleanTitle = (s) => sp(String(s).replace(/<[^>]*>/g, '').replace(/\(\s*\d+\s*점\s*\)/g, ''));
const semOf = (s) => { const m = String(s).replace(/\s/g, '').match(/([12])학기|^([12])학/); return m ? Number(m[1] || m[2]) : null; };
const SPECIAL = /결시|결석|표절|미제출|미응시/;

// '① …? (7,5,3,1점) ② …' → [{ text, levels }]
function splitCriteria(text) {
  // 한글 문서에서 줄바꿈 자리에 공백이 여러 개 들어가 낱말이 끊긴 것('현실적이     고')은 붙인다
  return String(text).replace(/(\S) {3,}(\S)/g, '$1$2').split(CIRCLED).map(sp).filter(Boolean).map((part) => {
    const m = part.match(/\(([\d\s,]+)점?\)\s*$/);
    return { text: sp(m ? part.slice(0, m.index) : part), levels: m ? nums(m[1]) : [] };
  });
}

function gradeRange(rule) {
  const m = rule.match(/(\d+)\s*~\s*(\d+)/);
  if (m) return { min: Number(m[1]), max: Number(m[2]) };
  const ns = nums(rule);
  if (ns.length >= 2) return { min: Math.min(ns[0], ns[1]), max: Math.max(ns[0], ns[1]) };
  if (ns.length === 1) return { min: 0, max: ns[0] };
  return { min: null, max: null };
}

const emptyItem = (title) => ({ title: cleanTitle(title), period: '', area: '', standards: [], points: '', weight: '', kind: 'plain', rubric: {} });

// hwpx 표들 → { grade, subject, semesters: { 1: { levels, items, exams }, 2: { … } } }
// exams: 정기시험(지필평가) [{ title, standards }] — 과세특 AI 프롬프트에 성취기준만 쓴다
export function parsePlan(tables) {
  const out = { grade: null, subject: null, semesters: { 1: { levels: {}, items: [], exams: [] }, 2: { levels: {}, items: [], exams: [] } } };
  const item = (sem, title) => {
    const list = out.semesters[sem].items;
    let it = list.find((x) => titleKey(x.title) === titleKey(title));
    if (!it) list.push((it = emptyItem(title)));
    return it;
  };
  for (const { rows, origin } of tables) {
    if (!rows.length) continue;
    const head = rows.slice(0, 2).map((r) => r.map(sp));
    const has = (re) => head.some((r) => r.some((v) => re.test(v)));
    const colOf = (re) => { for (const r of head) { const i = r.findIndex((v) => re.test(v)); if (i >= 0) return i; } return -1; };
    const isOrigin = (r, c) => origin[r]?.[c];

    // 과목: '국어 1학기' 같은 칸
    for (const r of rows) for (const v of r) { const m = sp(v).match(/^(\S+)\s*[12]학기$/); if (m && !out.subject && !/학년|학기/.test(m[1])) out.subject = m[1]; }

    if (has(/학기 단위 성취수준/)) {
      for (const r of rows) {
        const sem = semOf(r[0]);
        const lv = r.map(sp).find((v) => /^[A-E]$/.test(v));
        if (sem && lv) out.semesters[sem].levels[lv] = sp(r[r.length - 1]);
      }
    } else if (has(/평가방법 및 내용/) && has(/성취기준/)) {
      // 연간 평가 계획: 수행 · 과정평가는 평가 항목으로, 지필(정기시험)은 성취기준만
      const cSem = colOf(/^학기$/); const cGrade = colOf(/^학년$/); const cMethod = colOf(/평가방법 및 내용/);
      const cArea = colOf(/교육과정 영역/); const cStd = colOf(/성취기준/); const cPts = colOf(/^배점$/); const cW = colOf(/반영비율/);
      rows.slice(1).forEach((r) => {
        const sem = semOf(r[cSem]);
        if (sem && /지필|정기|고사/.test(r[cMethod])) {
          const codes = String(r[cStd]).match(/\[[^\]]+\]/g) || [];
          if (!codes.length) return;
          const title = sp(r[cMethod + 1]) && sp(r[cMethod + 1]) !== sp(r[cMethod]) ? sp(r[cMethod + 1]) : `${sem}학기 정기시험`;
          const ex = out.semesters[sem].exams.find((x) => x.title === title) || (out.semesters[sem].exams.push({ title, standards: [] }), out.semesters[sem].exams.at(-1));
          ex.standards = [...new Set([...ex.standards, ...codes])];
          return;
        }
        if (!sem || !/수행|과정/.test(r[cMethod])) return;
        const raw = r[cMethod + 1];
        if (!sp(raw) || sp(raw) === sp(r[cMethod])) return;
        const g = nums(r[cGrade])[0];
        if (g && !out.grade) out.grade = g;
        const it = item(sem, raw);
        const bracket = String(raw).match(/<([^>]+)>/);
        it.area ||= bracket ? bracket[1] : sp(r[cArea]).replace(/\s/g, ', ');
        it.standards = [...new Set([...it.standards, ...(String(r[cStd]).match(/\[[^\]]+\]/g) || [])])];
        if (cPts >= 0 && /\d/.test(r[cPts])) it.points ||= sp(r[cPts]);
        if (cW >= 0 && /\d/.test(r[cW])) it.weight ||= sp(r[cW]);
      });
    } else if (has(/^등급$/) && has(/성취수준기술/)) {
      // 등급형(과정평가) 세부 계획
      const cSem = colOf(/^학기$/); const cPeriod = colOf(/평가\s*시기/); const cTitle = colOf(/평가내용/);
      const cGr = colOf(/^등급$/); const cRule = colOf(/세부평가기준/); const cDesc = colOf(/성취수준기술/);
      rows.forEach((r, ri) => {
        if (ri === 0) return;
        const g = sp(r[cGr]);
        if (!/^[A-E]$/.test(g)) return;
        const sem = semOf(r[cSem]) || 2;
        const it = item(sem, r[cTitle]);
        it.kind = 'grade';
        it.period ||= sp(r[cPeriod]);
        it.rubric.grades ||= [];
        it.rubric.criteria ||= [];
        const rule = sp(r[cRule]);
        it.rubric.grades.push({ grade: g, ...gradeRange(rule), rule, desc: sp(r[cDesc]) });
        // '세부평가기준' 두 칸 중 둘째 칸이 따로 있으면(점수 구간 칸과 합쳐지지 않았으면) 채점 기준 목록
        if (!it.rubric.criteria.length && cRule + 1 < cDesc && isOrigin(ri, cRule + 1)) it.rubric.criteria = splitCriteria(r[cRule + 1]);
      });
    } else if (has(/세부평가기준/) && has(/^배점$/)) {
      // 점수형 세부 계획: 요소 개수형 또는 기준별 수준형
      const cSem = colOf(/^학기$/); const cPeriod = colOf(/평가\s*시기/); const cTitle = colOf(/평가내용/);
      const cCrit = colOf(/^평가기준$/) >= 0 ? colOf(/^평가기준$/) : colOf(/세부평가기준/) + 1;
      const cPts = colOf(/^배점$/);
      const last = rows[0].length - 1;
      rows.forEach((r, ri) => {
        if (ri < 2 || !sp(r[cTitle])) return;
        const sem = semOf(r[cSem]) || 1;
        const it = item(sem, r[cTitle]);
        it.period ||= sp(r[cPeriod]);
        const pts = String(r[cTitle]).match(/\(\s*(\d+)\s*점\s*\)/);
        if (pts) it.points ||= `${pts[1]}점`;
        const crit = r[cCrit];
        const firstOfGroup = ri === 2 || sp(rows[ri - 1][cTitle]) !== sp(r[cTitle]);
        if (firstOfGroup) it.kind = CIRCLED.test(crit) ? 'count' : 'criteria';
        if (it.kind === 'count') {
          if (firstOfGroup) it.rubric = { elements: splitCriteria(crit).map((c) => c.text), map: [], specials: [] };
          const label = sp(r[cPts]);
          const score = nums(r[last])[0];
          if (!label || score == null) return;
          const n = /모든 요소 만족/.test(label) ? it.rubric.elements.length : /모든 요소 부족/.test(label) ? 0 : nums(label.match(/(\d+)\s*요소/)?.[1])[0];
          if (SPECIAL.test(label) || n == null) it.rubric.specials.push({ label, score });
          else it.rubric.map.push({ label, n, score });
        } else {
          if (firstOfGroup) it.rubric = { criteria: [], specials: [] };
          const text = sp(crit);
          const levels = [];
          for (let c = cPts; c < last; c++) if (isOrigin(ri, c) && /^\d+$/.test(sp(r[c]))) levels.push(Number(sp(r[c])));
          const lastNum = isOrigin(ri, last) && /^\d+$/.test(sp(r[last])) ? Number(sp(r[last])) : null;
          if (SPECIAL.test(text) || (!levels.length && lastNum != null)) {
            // 메모가 섞인 칸이면 마지막 줄을 이름으로
            const label = sp(String(crit).split('\n').filter(Boolean).pop() || text);
            if (lastNum != null) it.rubric.specials.push({ label: label.length > 30 ? label.slice(-30) : label, score: lastNum });
          } else if (text && levels.length) it.rubric.criteria.push({ text, levels });
        }
      });
    }
  }
  return out;
}

// 학생 결과 계산 → { score, grade, met: [충족한 기준 글] }
export function rubricResult(a, row = {}) {
  const rb = a.rubric || {};
  const checks = row.checks || {};
  if (a.kind === 'count') {
    if (row.special) return { score: rb.specials?.find((s) => s.label === row.special)?.score ?? null, grade: null, met: [] };
    const met = (rb.elements || []).filter((_, i) => checks[i]);
    if (!Object.keys(checks).length && row.score == null) return { score: null, grade: null, met };
    const map = [...(rb.map || [])].sort((x, y) => y.n - x.n);
    return { score: (map.find((m) => met.length >= m.n) || map[map.length - 1])?.score ?? null, grade: null, met };
  }
  if (a.kind === 'criteria' || a.kind === 'grade') {
    if (row.special) return { score: rb.specials?.find((s) => s.label === row.special)?.score ?? null, grade: null, met: [] };
    const crit = rb.criteria || [];
    const chosen = crit.map((_, i) => checks[i]).filter((v) => typeof v === 'number');
    const sum = chosen.length ? chosen.reduce((x, y) => x + y, 0) : null;
    const met = crit.filter((c, i) => typeof checks[i] === 'number' && checks[i] === Math.max(...c.levels));
    let grade = row.grade || null;
    if (!grade && a.kind === 'grade' && sum != null) grade = (rb.grades || []).find((g) => g.min != null && sum >= g.min && sum <= g.max)?.grade || null;
    return { score: sum, grade, met: met.map((c) => c.text) };
  }
  return { score: row.score ?? null, grade: row.grade || null, met: [] };
}

export function maxScore(a) {
  const rb = a.rubric || {};
  if (a.kind === 'count') return Math.max(0, ...(rb.map || []).map((m) => m.score));
  if (a.kind === 'criteria' || a.kind === 'grade') {
    const s = (rb.criteria || []).reduce((n, c) => n + (c.levels.length ? Math.max(...c.levels) : 0), 0);
    return s || a.max_score;
  }
  return a.max_score;
}

// ---- 과세특 문장: 평가 기준 · 성취수준 문장을 '~함' 체로 ----
const ENDINGS = [
  [/할 수 있다$/, '함'], [/될 수 있다$/, '됨'], [/쓸 수 있다$/, '씀'], [/들을 수 있다$/, '들음'], [/수 있다$/, '수 있음'],
  [/하였는가$/, '함'], [/했는가$/, '함'], [/되었는가$/, '됨'], [/지켰는가$/, '지킴'], [/있는가$/, '있음'], [/없는가$/, '없음'], [/인가$/, '임'],
  [/하였다$/, '함'], [/했다$/, '함'], [/되었다$/, '됨'], [/지녔다$/, '지님'], [/있다$/, '있음'], [/없다$/, '없음'],
  [/한다$/, '함'], [/된다$/, '됨'], [/쓴다$/, '씀'], [/는다$/, '음'], [/다$/, '음'],
];
export function toNoun(sentence) {
  return sp(sentence).split(/(?<=[.?!])\s+/).map((s) => {
    let t = s.replace(/[.?!]+$/, '').replace(/\s*\([^)]*\)\s*$/, '');
    for (const [re, rep] of ENDINGS) if (re.test(t)) { t = t.replace(re, rep); break; }
    return `${t}.`;
  }).join(' ');
}

// ---- 확인 · 수정 창에서 쓰는 한 줄 형식 ----
export function rubricToText(it) {
  const rb = it.rubric || {};
  if (it.kind === 'count') {
    return {
      a: (rb.elements || []).join('\n'),
      b: (rb.map || []).map((m) => `${m.label} | ${m.n} | ${m.score}`).join('\n'),
      c: (rb.specials || []).map((s) => `${s.label} | ${s.score}`).join('\n'),
    };
  }
  if (it.kind === 'criteria') return { a: (rb.criteria || []).map((c) => `${c.text} | ${c.levels.join(',')}`).join('\n'), b: '', c: (rb.specials || []).map((s) => `${s.label} | ${s.score}`).join('\n') };
  if (it.kind === 'grade') {
    return {
      a: (rb.criteria || []).map((c) => `${c.text} | ${c.levels.join(',')}`).join('\n'),
      b: (rb.grades || []).map((g) => `${g.grade} | ${g.min ?? ''} | ${g.max ?? ''} | ${g.desc}`).join('\n'),
      c: '',
    };
  }
  return { a: '', b: '', c: '' };
}

const lines = (t) => String(t || '').split(/\r?\n/).map((l) => l.split('|').map(sp)).filter((l) => l[0]);
export function rubricFromText(kind, { a, b, c }) {
  const specials = lines(c).map(([label, score]) => ({ label, score: Number(score) || 0 }));
  if (kind === 'count') {
    return {
      elements: String(a || '').split(/\r?\n/).map(sp).filter(Boolean),
      map: lines(b).map(([label, n, score]) => ({ label, n: Number(n) || 0, score: Number(score) || 0 })),
      specials,
    };
  }
  const criteria = lines(a).map(([text, lv]) => ({ text, levels: nums(lv || '') }));
  if (kind === 'criteria') return { criteria, specials };
  if (kind === 'grade') {
    return {
      criteria,
      grades: lines(b).map(([grade, min, max, ...desc]) => ({ grade, min: min === '' ? null : Number(min), max: max === '' ? null : Number(max), rule: '', desc: desc.join(' | ') })),
    };
  }
  return {};
}
