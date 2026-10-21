// 과세특 AI 초안 (화면 없이 계산만)
// 흐름: 작성 대상 고르기(근거 많은 학생 추천) → 수행평가마다 프롬프트 → AI 결과 '학번|문장' 붙여넣기 → 항목 문장을 이어 초안
//       → (선택) 이어 붙인 글 다듬기 프롬프트 → 최종 검사(바이트 · 금지 표현 · 학생끼리 비슷한 글)
// (school-gwasetuk '과세특 작업대'에서 실제로 돌려 보고 다듬은 방식을 가져옴)
// 학생 정보는 학번 · 성취도 · 관찰 메모만 보낸다. 이름은 보내지 않고, 메모 속 학생 이름은 ○○로 가린다
import * as S from './store.js';
import { standardText, normCode } from './standards.js';
import { rubricResult, maxScore } from './evalplan.js';
import { fmtMD } from './ui.js';

// ---- 길이: 나이스 세특 칸은 UTF-8 바이트로 센다(한글 3, 띄어쓰기 · 문장부호 1, 줄바꿈은 넉넉히 2). AI 는 바이트를 못 세므로 지시만 자 수로 ----
const encoder = new TextEncoder();
export const byteLen = (text) => encoder.encode(String(text || '').replace(/\r?\n/g, '\r\n')).length;
const charsOf = (bytes) => Math.max(1, Math.floor(bytes / 3));

// 설정 (settings.seteuk_ai): bytes 세특 칸 전체, reserve 직접 쓸 몫, chunk 한 번에 몇 명(0 = 전체), growth 종합 · 성장 문장
export const AI_DEFAULTS = { bytes: 1500, reserve: 0, chunk: 25, growth: true };
export const aiSettings = () => ({ ...AI_DEFAULTS, ...S.settings().seteuk_ai });

// 학번: 학년 + 반 두 자리 + 번호 두 자리 (예: 1학년 1반 12번 → 10112)
export const studentCode = (s) => `${s.grade}${String(s.room).padStart(2, '0')}${String(s.number).padStart(2, '0')}`;
const cleanTitle = (t) => String(t || '').replace(/\s*\([^)]*점\)\s*/g, '').trim();

// ---- 항목: 이 학기 수행평가마다 하나 + 종합 · 성장(근거가 있는 학생만) ----
// 정기시험은 학생마다 다른 근거가 없어 따로 문장을 만들지 않고, 수행평가 프롬프트에 '함께 배운 성취기준'으로만 넣는다
export const WEIGHTS = { assess: 3, growth: 2 }; // 길이 몫 비율
export function itemsOf(cls, term) {
  const items = S.assessmentsOf(cls, term)
    .map((a) => ({ key: a.id, type: 'assess', title: cleanTitle(a.title), standards: a.standards || [], a }));
  if (aiSettings().growth && items.length) items.push({ key: 'growth', type: 'growth', title: '종합 · 성장', standards: [] });
  return items;
}

// 정기시험 성취기준 (평가계획 → 정기시험)
export function examCodes(cls, term) {
  const plan = S.planOf(term, cls.subject, cls.grade);
  return [...new Set((plan?.exams || []).flatMap((x) => x.standards || []).map(normCode))];
}

// 항목마다 쓸 수 있는 바이트: (전체 - 직접 쓸 몫)을 비율대로 나눈다 → Map(key → 바이트)
export function sharesOf(items, st = aiSettings()) {
  const total = items.reduce((n, it) => n + WEIGHTS[it.type], 0) || 1;
  const room = Math.max(0, st.bytes - st.reserve);
  return new Map(items.map((it) => [it.key, Math.floor((room * WEIGHTS[it.type]) / total)]));
}

// ---- 학생 이름 가리기: 이 학년도 학생 이름(성 + 이름, 세 글자 이상이면 이름만도) ----
export function nameMasker(year) {
  const names = new Set();
  for (const s of S.data.students) {
    if (s.year !== year || !s.name) continue;
    const n = s.name.replace(/\s/g, '');
    names.add(n);
    if (n.length >= 3) names.add(n.slice(1));
  }
  const list = [...names].filter((n) => n.length >= 2).sort((a, b) => b.length - a.length);
  if (!list.length) return (t) => String(t || '');
  const re = new RegExp(list.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g');
  return (t) => String(t || '').replace(re, '○○');
}

// ---- 근거: 이 학기 이 과목에서 학생에 대해 남긴 것 ----
const memosOf = (s, cls, term) => S.notesOfStudent(s.id).filter((n) => S.sameTerm(S.termOf(n.date), term) && (!n.subject || n.subject === cls.subject));
export function evidenceOf(s, cls, term) {
  let results = 0;
  let notes = 0;
  for (const a of S.assessmentsOf(cls, term)) {
    const cur = S.scoreOf(a.id, s.id);
    if (!cur || cur.special) continue;
    const r = rubricResult(a, cur);
    if (r.grade || r.score != null || r.met.length) results++;
    if ((cur.note || '').trim()) notes++;
  }
  const memos = memosOf(s, cls, term).length;
  const score = results + 2 * (notes + memos);
  const level = notes + memos >= 3 ? 'rich' : notes + memos >= 1 ? 'some' : results ? 'thin' : 'none';
  return { results, notes, memos, score, level };
}
export const EVIDENCE_LABEL = { rich: '근거 많음', some: '근거 보통', thin: '결과만 있음', none: '근거 없음' };

// ---- 작성 대상: 자유학기는 전원. 일반 학기는 선생님이 고른 학생(seteuk.target), 고른 적 없으면 근거 많은 순으로 필요한 인원만큼 추천 ----
export function recommended(cls, term, students) {
  const need = S.seteukRequired(term, cls.grade, students.length);
  return new Set(students.map((s) => ({ s, e: evidenceOf(s, cls, term) }))
    .filter((x) => x.e.score > 0)
    .sort((a, b) => b.e.score - a.e.score || a.s.number - b.s.number)
    .slice(0, need).map((x) => x.s.id));
}
export function targetsOf(cls, term, students) {
  if (S.isFreeTerm(term, cls.grade)) return students;
  const rows = students.map((s) => S.seteukOf(s.id, term, cls.subject));
  if (rows.some((r) => r?.target != null)) return students.filter((s, i) => rows[i]?.target);
  const rec = recommended(cls, term, students);
  return students.filter((s) => rec.has(s.id));
}
export async function setTargets(cls, term, students, ids) {
  for (const s of students) await S.saveSeteuk(s.id, term, cls.subject, { target: ids.has(s.id) });
}

// ---- 학생 한 명의 이 항목 결과 → 프롬프트 한 줄 (넣을 것이 없으면 null) ----
function resultLine(it, s, cls, term, mask) {
  if (it.type === 'growth') return growthLine(s, cls, term, mask);
  const cur = S.scoreOf(it.a.id, s.id);
  if (!cur || cur.special) return null;
  const r = rubricResult(it.a, cur);
  const rb = it.a.rubric || {};
  let result = '';
  if (r.grade) result = r.grade;
  else if (it.a.kind === 'count' && (rb.elements || []).length) result = `충족 ${r.met.length}/${rb.elements.length}: ${r.met.map(shortCrit).join(' / ') || '없음'}`;
  else if (it.a.kind === 'criteria' && (rb.criteria || []).length) result = `점수 ${r.score ?? '-'}/${maxScore(it.a)}${r.met.length ? `, 최고 수준 기준: ${r.met.map(shortCrit).join(' / ')}` : ''}`;
  else if (r.score != null) result = `점수 ${r.score}/${maxScore(it.a)}`;
  const note = cur.note ? `|관찰: ${mask(cur.note).trim()}` : '';
  if (!result && !note) return null;
  return `${studentCode(s)}|${result || '-'}${note}`;
}
const shortCrit = (t) => String(t).replace(/\s+/g, ' ').trim().slice(0, 40);

// 종합 · 성장: 결과가 바뀌었거나(수행평가 2개 이상) 교사 메모가 있는 학생만. 근거 없이 쓰면 모두 '꾸준히 참여함'이 된다
function growthLine(s, cls, term, mask) {
  const steps = [];
  for (const a of S.assessmentsOf(cls, term)) {
    const cur = S.scoreOf(a.id, s.id);
    if (!cur || cur.special) continue;
    const r = rubricResult(a, cur);
    const res = r.grade || (r.score != null ? `${r.score}/${maxScore(a)}점` : '');
    if (!res) continue;
    const when = a.dates?.[cls.id] ? fmtMD(a.dates[cls.id]) : a.period || '';
    // 견줄 값: 등급은 A=0 … E=4, 점수는 만점 대비 비율(높을수록 작게)
    const rank = r.grade ? 'ABCDE'.indexOf(r.grade) : -(r.score / (maxScore(a) || 1));
    steps.push({ text: `'${cleanTitle(a.title)}'${when ? `(${when})` : ''} ${res}`, rank });
  }
  const changed = steps.length >= 2 && new Set(steps.map((x) => x.rank.toFixed(2))).size > 1;
  const memos = memosOf(s, cls, term).reverse().map((n) => `${fmtMD(n.date)} ${mask(n.text).trim()}`);
  if (!changed && !memos.length) return null;
  const bits = [];
  if (steps.length) bits.push(`수행평가: ${steps.map((x) => x.text).join(' → ')}`);
  if (memos.length) bits.push(`교사 메모: ${memos.join('; ')}`);
  return `${studentCode(s)}|${bits.join(' / ')}`;
}

// 이 항목에 넣을 학생과 빠지는 학생 (students 는 작성 대상만)
export function linesOf(it, cls, term, students) {
  const mask = nameMasker(term.year);
  const lines = [];
  const missing = [];
  for (const s of students) {
    const line = resultLine(it, s, cls, term, mask);
    if (line) lines.push({ s, line }); else missing.push(s);
  }
  return { lines, missing };
}

// ---- 프롬프트 글 ----
// 규칙은 과세특 작업대에서 실제로 겪은 것: 명사형 종결과 소재 지어내기는 어긴 예를 보여 줘야 지킨다, 상한만 주면 훨씬 짧게 쓴다
function lengthAndStyle(out, n, upper, lower) {
  out.push(`${n++}. 학생당 한 문단, 공백 포함 ${lower}자 이상 ${upper}자 이내.`);
  out.push(`   ${upper}자에 최대한 가깝게 쓰라. ${lower}자보다 짧으면 안 된다.`);
  out.push(`${n++}. 모든 문장을 '-함.', '-음.' 꼴 명사형으로 맺어라.`);
  out.push("   존댓말과 '-다' 체를 쓰지 마라. 학교생활기록부 문체다.");
  out.push('   (X) 발표 자료를 꼼꼼하게 준비하였습니다.');
  out.push('   (X) 발표 자료를 꼼꼼하게 준비하였다.');
  out.push('   (O) 발표 자료를 꼼꼼하게 준비함.');
  return n;
}

export function promptText(it, cls, term, lines, share) {
  const upper = charsOf(share);
  const lower = Math.max(1, Math.floor(upper * 0.95));
  const out = [];
  out.push(`너는 중학교 ${cls.grade}학년 ${cls.subject} 교사를 돕는 조수다.`);
  out.push(it.type === 'growth'
    ? '아래 학생별 기록을 바탕으로, 이번 학기 동안의 변화와 성장을 정리하는 과목별 세부능력 및 특기사항 문장을 작성하라.'
    : '아래 평가 항목에 대한 학생별 과목별 세부능력 및 특기사항 문장을 작성하라.');
  out.push('');

  let hasLevels = false;
  out.push('[평가 항목]');
  if (it.type === 'growth') {
    out.push(`${term.year}학년도 ${term.semester}학기 ${cls.subject} 수행평가 전체에서 드러난 변화`);
    out.push('');
  } else {
    out.push(`${it.title}${it.a.period ? ` (${it.a.period})` : ''}${it.a.area ? ` — ${it.a.area} 영역` : ''}`);
    if (it.a.note) out.push(it.a.note);
    out.push('');
    out.push('[성취기준]');
    const own = it.standards.map(normCode);
    if (own.length) own.forEach((c) => out.push(`${c} ${standardText(c)}`.trim()));
    else out.push('(정해 둔 성취기준이 없습니다)');
    out.push('');
    const exams = examCodes(cls, term).filter((c) => !own.includes(c));
    if (exams.length) {
      out.push('[이번 학기에 함께 배운 성취기준 — 정기시험 범위, 참고용]');
      exams.forEach((c) => out.push(`${c} ${standardText(c)}`.trim()));
      out.push('');
    }
    const rb = it.a.rubric || {};
    const crit = it.a.kind === 'count' ? (rb.elements || []) : (rb.criteria || []).map((c) => c.text);
    if (crit.length) {
      out.push('[채점 기준]');
      crit.forEach((c, i) => out.push(`${'①②③④⑤⑥⑦⑧⑨⑩'[i] || i + 1} ${c}`));
      out.push('');
    }
    const grades = (rb.grades || []).filter((g) => g.desc);
    if (grades.length) {
      hasLevels = true;
      out.push('[성취도별 성취수준]');
      grades.forEach((g) => out.push(`${g.grade}: ${g.desc}`));
      out.push('');
    }
  }

  out.push('[작성 규칙]');
  let n = lengthAndStyle(out, 1, upper, lower);
  if (it.type === 'growth') {
    out.push(`${n++}. 기록에서 드러난 변화만 쓴다. 결과가 앞보다 나아졌거나 교사 메모에 변화가 적혀 있으면 '처음에는 ~했으나 ~하게 됨'처럼 쓰라.`);
    out.push('   결과가 낮아졌으면 노력한 점과 앞으로의 과제를 긍정적으로 쓰라. 근거 없이 "크게 성장함"이라고 쓰지 마라.');
    out.push('   개별 수행평가 활동을 다시 자세히 설명하지 마라. 그 내용은 다른 문장에 이미 있다.');
  } else {
    out.push(`${n++}. 구성: 이 활동에서 → 성취기준에 비추어 무엇을 해냈는지(구체적인 행동과 결과) → 드러난 역량이나 태도.`);
    out.push('   성취기준 문장을 그대로 베끼지 말고 학생의 행동으로 풀어 쓰라.');
    if (hasLevels) {
      out.push(`${n++}. 학생별 결과의 성취도(A~E)에 맞는 [성취도별 성취수준]을 기준으로 서술의 깊이와 범위를 달리하라.`);
      out.push('   그 기준에 없는 능력을 지어내지 마라.');
    } else {
      out.push(`${n++}. 학생별 결과(충족한 기준 · 점수)에 맞춰 서술의 깊이와 범위를 달리하라. 충족하지 못한 기준을 해낸 것처럼 쓰지 마라.`);
    }
    out.push(`${n++}. [이번 학기에 함께 배운 성취기준]은 학생 개인의 성취 근거가 아니다. 이 활동과 자연스럽게 이어질 때만 배경으로 짧게 쓰고, 그 기준을 잘 해냈다고 쓰지 마라.`);
  }
  out.push(`${n++}. "관찰:" · "교사 메모:"가 있는 학생은 그 내용을 반드시 살려 쓰라. 거기 없는 구체적인 행동은 지어내지 마라.`);
  out.push(`${n++}. "우수함", "미흡함", "뛰어남" 같은 평가어만으로 쓰지 말고 관찰된 행동과 결과로 서술하라.`);
  out.push(`${n++}. 학생마다 문장의 첫 어절을 서로 다르게 하라.`);
  out.push('   같은 표현으로 시작하는 학생이 둘 이상 있으면 안 된다. 성취도가 같은 학생끼리도 마찬가지다.');
  out.push(`${n++}. 학생이 다룬 구체적 소재를 지어내지 마라.`);
  out.push('   주제, 글감, 작품 이름, 대상 이름은 기록에 적힌 것만 쓴다.');
  out.push('   "축구를 소재로", "우리 학교 급식을 예로 들어"처럼 확인되지 않은 소재를 넣으면 안 된다.');
  out.push('   기록에 없으면 "자신이 고른 대상", "관심 있는 주제"처럼 소재를 특정하지 않는 표현을 쓰라.');
  out.push(`${n++}. 문장에 학번 · 이름 · 성취기준 코드 · 성취도 기호(A~E) · 점수를 쓰지 마라. 주어 없이 쓴다.`);
  out.push(`${n++}. 교외 활동, 수상, 자격증, 사교육, 가정 환경처럼 기록에 없는 내용은 쓰지 마라.`);
  out.push(`${n++}. 출력은 각 줄을 "학번|문장" 형식으로만. 학생 한 명이 한 줄이다.`);
  out.push('   설명이나 인사말, 제목을 붙이지 마라.');
  out.push('');
  out.push(it.type === 'growth' ? '[학생별 기록] 학번|기록' : '[학생별 결과] 학번|성취도 또는 결과|관찰');
  lines.forEach((l) => out.push(l.line));
  return out.join('\n');
}

// 이어 붙인 초안 다듬기: 내용은 그대로, 연결만 자연스럽게
export function polishPrompt(cls, rows, limitBytes) {
  const upper = charsOf(limitBytes);
  const out = [];
  out.push(`너는 중학교 ${cls.grade}학년 ${cls.subject} 교사를 돕는 조수다.`);
  out.push('아래 학생별 과목별 세부능력 및 특기사항 초안은 활동별 문장을 이어 붙인 것이라 연결이 매끄럽지 않다. 한 편의 글로 다듬어라.');
  out.push('');
  out.push('[다듬기 규칙]');
  out.push('1. 내용을 더하지 마라. 초안에 없는 활동, 소재, 능력, 평가를 새로 쓰면 안 된다.');
  out.push('2. 빼지도 마라. 활동마다 드러난 구체적인 행동과 결과는 모두 남긴다. 겹치는 말만 줄인다.');
  out.push('3. 같은 어미와 같은 낱말이 되풀이되지 않게 문장을 잇고 순서를 다듬어라.');
  out.push(`4. 학생당 한 문단, 공백 포함 ${upper}자 이내. 초안보다 길게 쓰지 마라.`);
  out.push("5. 모든 문장을 '-함.', '-음.' 꼴 명사형으로 맺어라. 존댓말과 '-다' 체를 쓰지 마라.");
  out.push('   (X) 꼼꼼하게 준비하였다.  (O) 꼼꼼하게 준비함.');
  out.push('6. 학생마다 첫 어절을 서로 다르게 하라.');
  out.push('7. 학번 · 이름 · 성취기준 코드 · 성취도 기호(A~E) · 점수를 쓰지 마라.');
  out.push('8. 출력은 각 줄을 "학번|다듬은 글" 형식으로만. 설명이나 인사말을 붙이지 마라.');
  out.push('');
  out.push('[초안] 학번|초안');
  rows.forEach(({ s, text }) => out.push(`${studentCode(s)}|${text.replace(/\s*\n\s*/g, ' ')}`));
  return out.join('\n');
}

// ---- AI 결과 읽기: "10112|문장" (별표 · 글머리표 · 전각 세로줄도 받음) ----
export function parseResult(text, students) {
  const byCode = new Map(students.map((s) => [studentCode(s), s]));
  const got = new Map();
  const unread = [];
  const unknown = [];
  for (const raw of String(text).split('\n')) {
    const line = raw.replace(/^[\s*\-•>#]+/, '').replace(/\*+$/, '').trim();
    if (!line) continue;
    const m = line.match(/^(\d{3,6})\s*[|｜]\s*(.+)$/);
    if (!m) { unread.push(line); continue; }
    const s = byCode.get(m[1]);
    if (!s) { unknown.push(m[1]); continue; }
    got.set(s.id, m[2].trim());
  }
  return { got, unread, unknown };
}

// 앞 두 어절이 같은 학생 찾기 (글자 수로 자르면 '대상을' · '대상의'를 다르게 봐서 놓친다)
const firstTwo = (t) => String(t).trim().split(/\s+/).slice(0, 2).join(' ');
export function overlaps(map) {
  const groups = new Map();
  for (const [id, t] of map) {
    if (!t) continue;
    const k = firstTwo(t);
    if (k.replace(/\s/g, '').length < 3) continue;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(id);
  }
  const ids = new Set();
  const words = [];
  for (const [k, list] of groups) if (list.length > 1) { words.push(`"${k}" ${list.length}명`); list.forEach((id) => ids.add(id)); }
  return { ids, words };
}

// ---- 최종 검사 ----
// 금지 표현: 성취기준 코드 · 성취도 기호 · 점수 · 학번 · '-다' 체 · 존댓말 · 학생 이름
export function lintText(text, { names = [] } = {}) {
  const t = String(text || '');
  const issues = [];
  if (/\[?\d국\d{2}-\d{2}\]?/.test(t)) issues.push('성취기준 코드');
  if (/(성취도|등급|수준)\s*[A-E](?![A-Za-z])|(?<![A-Za-z])[A-E]\s*(등급|수준)/.test(t)) issues.push('성취도 기호');
  if (/\d+\s*점(?!검)/.test(t)) issues.push('점수');
  if (/(?<!\d)\d{5}(?!\d)/.test(t)) issues.push('학번');
  if (/(습니다|입니다|했다|한다|이다|였다|되었다|보였다)\s*[.]?(\s|$)/.test(t)) issues.push("'-다' · 존댓말");
  if (names.some((n) => n && t.includes(n))) issues.push('학생 이름');
  return issues;
}

// 학생끼리 비슷한 글: 똑같은 문장(띄어쓰기 빼고 15자 이상)이 있거나, 세 글자 묶음이 절반 이상 겹치면
const sentencesOf = (t) => String(t).split(/(?<=[.!?])\s+/).map((x) => x.replace(/\s/g, '')).filter((x) => x.length >= 15);
const grams = (t) => { const x = String(t).replace(/\s/g, ''); const g = new Set(); for (let i = 0; i + 3 <= x.length; i++) g.add(x.slice(i, i + 3)); return g; };
export function similarPairs(map) {
  const list = [...map].filter(([, t]) => t && t.trim());
  const g = new Map(list.map(([id, t]) => [id, grams(t)]));
  const ss = new Map(list.map(([id, t]) => [id, new Set(sentencesOf(t))]));
  const out = new Map();
  const add = (a, b) => { if (!out.has(a)) out.set(a, new Set()); out.get(a).add(b); };
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i][0];
      const b = list[j][0];
      let inter = 0;
      for (const x of g.get(a)) if (g.get(b).has(x)) inter++;
      const jac = inter / ((g.get(a).size + g.get(b).size - inter) || 1);
      const sameSentence = [...ss.get(a)].some((x) => ss.get(b).has(x));
      if (jac >= 0.5 || sameSentence) { add(a, b); add(b, a); }
    }
  }
  return out;
}

// ---- 조각 저장 · 초안 조립 ----
// seteuk.parts{항목 key: 문장}, seteuk.edited: 선생님이 고쳤거나 다듬은 글이면 true (그때부터는 조립해도 덮어쓰지 않음)
export function assemble(cls, term, parts) {
  return itemsOf(cls, term).map((it) => (parts?.[it.key] || '').trim()).filter(Boolean).join(' ');
}

export async function saveParts(cls, term, it, entries) {
  for (const [studentId, text] of entries) {
    const row = S.seteukOf(studentId, term, cls.subject);
    const parts = { ...(row?.parts || {}), [it.key]: text };
    const patch = { parts };
    // 초안이 비었거나 지금까지의 항목 문장을 이어 붙인 그대로일 때만 새로 조립한다 (선생님이 쓴 글은 그대로)
    const untouched = !row?.edited && (!(row?.text || '').trim() || row.text.trim() === assemble(cls, term, row.parts || {}));
    if (untouched) patch.text = assemble(cls, term, parts);
    await S.saveSeteuk(studentId, term, cls.subject, patch);
  }
}
