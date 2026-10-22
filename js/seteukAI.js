// 과세특 AI 초안 (화면 없이 계산만)
// 흐름: 학기 단위 관찰(낱말 · 메모, 원하면 자동 배정) → 작성 대상 고르기(근거 많은 학생 추천)
//       → 학기 전체(수행평가 모두 + 관찰 + 메모)를 한 프롬프트로 → AI 결과 '학번|글' 붙여넣기 → 최종 검사(바이트 · 금지 표현 · 학생끼리 비슷한 글)
// (school-gwasetuk '과세특 작업대'에서 실제로 돌려 보고 다듬은 규칙을 가져옴)
// 학생 정보는 학번 · 성취도 · 관찰 메모만 보낸다. 이름은 보내지 않고, 메모 속 학생 이름은 ○○로 가린다
import * as S from './store.js';
import { standardText, normCode } from './standards.js';
import { rubricResult, maxScore } from './evalplan.js';
import { fmtMD } from './ui.js';

// ---- 길이: 나이스 세특 칸은 UTF-8 바이트로 센다(한글 3, 띄어쓰기 · 문장부호 1, 줄바꿈은 넉넉히 2). AI 는 바이트를 못 세므로 지시만 자 수로 ----
const encoder = new TextEncoder();
export const byteLen = (text) => encoder.encode(String(text || '').replace(/\r?\n/g, '\r\n')).length;
const charsOf = (bytes) => Math.max(1, Math.floor(bytes / 3));

// 설정 (settings.seteuk_ai): bytes 세특 칸 전체, reserve 직접 쓸 몫 (예전 chunk · growth 는 안 씀)
export const AI_DEFAULTS = { bytes: 1500, reserve: 0 };
export const aiSettings = () => ({ ...AI_DEFAULTS, ...S.settings().seteuk_ai });

// 관찰 낱말: 학기 전체에 대해 학생에게 눌러 주는 짧은 관찰(seteuk.tags). 학생마다 다르게 눌러 줄수록 글이 달라진다
// 고쳐 쓴 목록은 settings.seteuk_tags
export const DEFAULT_TAGS = [
  '적극적으로 참여함', '끝까지 성실하게 완성함', '질문을 자주 함', '친구를 도와줌', '모둠 역할을 이끎', '피드백을 반영해 고침',
  '자료를 꼼꼼히 조사함', '근거를 들어 설명함', '자기 생각이 뚜렷함', '표현이 창의적임', '구성이 체계적임', '발표가 자신감 있음',
  '처음보다 나아짐', '어려워했지만 노력함', '도움을 받아 완성함',
];
export const tagList = () => (S.settings().seteuk_tags?.length ? S.settings().seteuk_tags : DEFAULT_TAGS);

// 자동 배정용 낱말(settings.seteuk_auto_tags): 확인 없이 붙어도 낭패가 없는 좋은 낱말만.
// '어려워했지만 노력함' 같은 말이나 '모둠 역할을 이끎'처럼 특정 행동을 단정하는 말은 뺐다
export const DEFAULT_AUTO_TAGS = [
  '적극적으로 참여함', '끝까지 성실하게 완성함', '피드백을 반영해 고침', '자료를 꼼꼼히 조사함',
  '근거를 들어 설명함', '자기 생각이 뚜렷함', '표현이 창의적임', '구성이 체계적임',
];
export const autoTagList = () => (S.settings().seteuk_auto_tags?.length ? S.settings().seteuk_auto_tags : DEFAULT_AUTO_TAGS);

// 학생마다 글의 짜임을 다르게 (같은 근거라도 글 모양이 달라지게). 학생 번호로 돌려 가며 고른다
const ORDERS = [
  '가장 눈에 띈 모습으로 시작 → 활동별 과정과 결과 → 학기 전체에서 드러난 태도',
  '첫 활동부터 시간 순서대로 → 활동마다 결과 → 끝에 드러난 변화',
  '가장 잘 해낸 활동으로 시작 → 그 결과를 만든 행동 → 다른 활동 → 다음 배움으로 이어질 점',
  '학기 내내 드러난 태도 · 역량으로 시작 → 그것이 보인 활동들 → 성장',
  '활동 내용 → 관찰된 모습 → 성취기준과의 연결 → 학기 전체 정리',
];

// 학번: 학년 + 반 두 자리 + 번호 두 자리 (예: 1학년 1반 12번 → 10112)
export const studentCode = (s) => `${s.grade}${String(s.room).padStart(2, '0')}${String(s.number).padStart(2, '0')}`;
export const cleanTitle = (t) => String(t || '').replace(/\s*\([^)]*점\)\s*/g, '').trim();

// 정기시험 성취기준 (평가계획 → 정기시험)
export function examCodes(cls, term) {
  const plan = S.planOf(term, cls.subject, cls.grade);
  return [...new Set((plan?.exams || []).flatMap((x) => x.standards || []).map(normCode))];
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

// ---- 학기 관찰 (seteuk.tags · seteuk.auto · seteuk.obs) ----
// auto: 자동으로 넣은 낱말(화면에 점선으로 표시). 선생님이 확인 표시를 지우면 빈 배열
export function obsOf(s, cls, term) {
  const row = S.seteukOf(s.id, term, cls.subject);
  const tags = row?.tags || [];
  const auto = new Set((row?.auto || []).filter((t) => tags.includes(t)));
  return { tags, auto, obs: (row?.obs || '').trim() };
}
export const saveObs = (s, cls, term, patch) => S.saveSeteuk(s.id, term, cls.subject, patch);

// ---- 근거: 이 학기 이 과목에서 학생에 대해 남긴 것 (자동으로 넣은 낱말은 근거로 세지 않는다) ----
const memosOf = (s, cls, term) => S.notesOfStudent(s.id).filter((n) => S.sameTerm(S.termOf(n.date), term) && (!n.subject || n.subject === cls.subject));
export function evidenceOf(s, cls, term) {
  let results = 0;
  let notes = 0;
  for (const a of S.assessmentsOf(cls, term)) {
    const cur = S.scoreOf(a.id, s.id);
    if (!cur || cur.special) continue;
    const r = rubricResult(a, cur);
    if (r.grade || r.score != null || r.met.length) results++;
    if ((cur.note || '').trim() || (cur.tags || []).length) notes++;
  }
  const o = obsOf(s, cls, term);
  if (o.obs) notes++;
  notes += o.tags.filter((t) => !o.auto.has(t)).length ? 1 : 0;
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

// ---- 수행평가 결과 한 줄 ----
const shortCrit = (t) => String(t).replace(/\s+/g, ' ').trim().slice(0, 40);
function resultOf(a, cur) {
  if (!cur || cur.special) return '';
  const r = rubricResult(a, cur);
  const rb = a.rubric || {};
  if (r.grade) return `성취도 ${r.grade}`;
  if (a.kind === 'count' && (rb.elements || []).length) return `충족 ${r.met.length}/${rb.elements.length}: ${r.met.map(shortCrit).join(' / ') || '없음'}`;
  if (a.kind === 'criteria' && (rb.criteria || []).length) return `점수 ${r.score ?? '-'}/${maxScore(a)}${r.met.length ? `, 최고 수준 기준: ${r.met.map(shortCrit).join(' / ')}` : ''}`;
  if (r.score != null) return `점수 ${r.score}/${maxScore(a)}`;
  return '';
}

// 결과가 낮은 학생(등급 D · E 또는 만점의 60% 미만이 하나라도): 좋은 낱말을 자동으로 붙이면 결과와 어긋난다
function lowResult(s, cls, term) {
  return S.assessmentsOf(cls, term).some((a) => {
    const cur = S.scoreOf(a.id, s.id);
    if (!cur || cur.special) return false;
    const r = rubricResult(a, cur);
    if (r.grade) return 'DE'.includes(r.grade);
    return r.score != null && r.score < maxScore(a) * 0.6;
  });
}
const hasResult = (s, cls, term) => S.assessmentsOf(cls, term).some((a) => resultOf(a, S.scoreOf(a.id, s.id)));

// ---- 관찰 자동 배정: 관찰이 하나도 없고 결과가 있는 학생에게 자동 배정용 낱말 n개씩 ----
// 낱말이 학생들에게 고르게 돌아가도록 섞은 목록을 차례로 나눠 준다. 결과가 낮은 학생은 건너뛴다
export function autoPlan(cls, term, students, n = 2) {
  const pool = autoTagList();
  const skipLow = [];
  const plan = [];
  let deck = [];
  for (const s of students) {
    const o = obsOf(s, cls, term);
    const perAssess = S.assessmentsOf(cls, term).some((a) => { const c = S.scoreOf(a.id, s.id); return (c?.note || '').trim() || (c?.tags || []).length; });
    if (o.tags.length || o.obs || perAssess || !hasResult(s, cls, term)) continue;
    if (lowResult(s, cls, term)) { skipLow.push(s); continue; }
    const pick = [];
    while (pick.length < Math.min(n, pool.length)) {
      if (!deck.length) deck = [...pool].sort(() => Math.random() - 0.5);
      const t = deck.shift();
      if (!pick.includes(t)) pick.push(t);
    }
    plan.push({ s, tags: pick });
  }
  return { plan, skipLow };
}

// ---- 학생 한 명의 학기 기록 → 프롬프트 묶음 (넣을 것이 없으면 null) ----
function studentBlock(s, cls, term, mask, order) {
  const lines = [];
  const steps = [];
  for (const a of S.assessmentsOf(cls, term)) {
    const cur = S.scoreOf(a.id, s.id);
    const res = resultOf(a, cur);
    const seen = [...(cur?.tags || []), ...(cur?.note ? [mask(cur.note).trim()] : [])].filter(Boolean);
    if (!res && !seen.length) continue;
    const when = a.dates?.[cls.id] ? fmtMD(a.dates[cls.id]) : a.period || '';
    lines.push(`- ${cleanTitle(a.title)}${when ? `(${when})` : ''}: ${res || '결과 없음'}${seen.length ? ` / 관찰: ${seen.join(', ')}` : ''}`);
    // 학기 흐름: 등급은 A=0 … E=4, 점수는 만점 대비 비율(높을수록 작게)
    const r = rubricResult(a, cur || {});
    if (!cur?.special && (r.grade || r.score != null)) steps.push({ text: `'${cleanTitle(a.title)}' ${r.grade || `${r.score}/${maxScore(a)}점`}`, rank: r.grade ? 'ABCDE'.indexOf(r.grade) : -(r.score / (maxScore(a) || 1)) });
  }
  const o = obsOf(s, cls, term);
  const obs = [o.tags.join(', '), o.obs ? mask(o.obs).trim() : ''].filter(Boolean).join(' / ');
  if (obs) lines.push(`- 학기 관찰: ${obs}`);
  if (steps.length >= 2 && new Set(steps.map((x) => x.rank.toFixed(2))).size > 1) lines.push(`- 학기 흐름: ${steps.map((x) => x.text).join(' → ')}`);
  const memos = memosOf(s, cls, term).reverse().map((n) => `${fmtMD(n.date)} ${mask(n.text).trim()}`);
  if (memos.length) lines.push(`- 교사 메모: ${memos.join('; ')}`);
  if (!lines.length) return null;
  return [`[${studentCode(s)}] 짜임: ${order}`, ...lines].join('\n');
}

// 프롬프트에 넣을 학생과 빠지는 학생 (students 는 작성 대상만)
export function linesOf(cls, term, students) {
  const mask = nameMasker(term.year);
  const lines = [];
  const missing = [];
  for (const s of students) {
    const line = studentBlock(s, cls, term, mask, ORDERS[s.number % ORDERS.length]);
    if (line) lines.push({ s, line }); else missing.push(s);
  }
  return { lines, missing };
}

// ---- 프롬프트 글: 학생마다 학기 전체를 한 문단으로 ----
// 규칙은 과세특 작업대에서 실제로 겪은 것: 명사형 종결과 소재 지어내기는 어긴 예를 보여 줘야 지킨다, 상한만 주면 훨씬 짧게 쓴다
export function promptText(cls, term, lines, st = aiSettings()) {
  const upper = charsOf(Math.max(0, st.bytes - st.reserve));
  const lower = Math.max(1, Math.floor(upper * 0.95));
  const assess = S.assessmentsOf(cls, term);
  const out = [];
  out.push(`너는 중학교 ${cls.grade}학년 ${cls.subject} 교사를 돕는 조수다.`);
  out.push(`아래 ${term.year}학년도 ${term.semester}학기 평가 정보와 학생별 기록을 바탕으로, 학생마다 과목별 세부능력 및 특기사항 한 문단을 작성하라.`);
  out.push('');

  let hasLevels = false;
  const own = new Set();
  out.push('[이번 학기 수행평가]');
  assess.forEach((a, k) => {
    out.push(`${k + 1}) ${cleanTitle(a.title)}${a.period ? ` (${a.period})` : ''}${a.area ? ` — ${a.area} 영역` : ''}`);
    if (a.note) out.push(`   ${a.note}`);
    const codes = (a.standards || []).map(normCode);
    codes.forEach((c) => { own.add(c); out.push(`   성취기준: ${c} ${standardText(c)}`.trimEnd()); });
    const rb = a.rubric || {};
    const crit = a.kind === 'count' ? (rb.elements || []) : (rb.criteria || []).map((c) => c.text);
    if (crit.length) out.push(`   채점 기준: ${crit.map((c, i) => `${'①②③④⑤⑥⑦⑧⑨⑩'[i] || i + 1} ${c}`).join(' ')}`);
    const grades = (rb.grades || []).filter((g) => g.desc);
    if (grades.length) {
      hasLevels = true;
      out.push('   성취도별 성취수준:');
      grades.forEach((g) => out.push(`     ${g.grade}: ${g.desc}`));
    }
  });
  out.push('');
  const exams = examCodes(cls, term).filter((c) => !own.has(c));
  if (exams.length) {
    out.push('[이번 학기에 함께 배운 성취기준 — 정기시험 범위, 참고용]');
    exams.forEach((c) => out.push(`${c} ${standardText(c)}`.trim()));
    out.push('');
  }

  out.push('[작성 규칙]');
  let n = 1;
  out.push(`${n++}. 학생당 한 문단, 공백 포함 ${lower}자 이상 ${upper}자 이내.`);
  out.push(`   ${upper}자에 최대한 가깝게 쓰라. ${lower}자보다 짧으면 안 된다.`);
  out.push(`${n++}. 모든 문장을 '-함.', '-음.' 꼴 명사형으로 맺어라.`);
  out.push("   존댓말과 '-다' 체를 쓰지 마라. 학교생활기록부 문체다.");
  out.push('   (X) 발표 자료를 꼼꼼하게 준비하였습니다.');
  out.push('   (X) 발표 자료를 꼼꼼하게 준비하였다.');
  out.push('   (O) 발표 자료를 꼼꼼하게 준비함.');
  out.push(`${n++}. 학생 기록에 결과가 있는 수행평가는 모두 한 번 이상 다루어라. 빠뜨리면 안 된다.`);
  out.push('   다만 평가를 하나씩 나열하지 말고 한 편의 글로 이어라. 평가마다 "~활동에서 ~함." 같은 같은 틀을 되풀이하지 마라.');
  out.push(`${n++}. 학생 묶음 첫 줄의 "짜임:" 순서대로 글을 짜라. 학생마다 짜임이 다르니 글 모양도 달라야 한다.`);
  out.push('   짜임은 순서만 정한다. 짜임에 있는 요소라도 기록에 없으면 지어내지 말고 빼라.');
  out.push('   성취기준 문장을 그대로 베끼지 말고 학생의 행동으로 풀어 쓰라.');
  if (hasLevels) {
    out.push(`${n++}. 평가마다 학생의 성취도(A~E)에 맞는 "성취도별 성취수준"을 기준으로 서술의 깊이와 범위를 달리하라.`);
    out.push('   그 기준에 없는 능력을 지어내지 마라.');
    out.push('   성취수준 문장을 학생마다 말만 바꿔 되풀이하지 마라. 그 학생의 관찰과 맞는 부분만 골라 쓰고, 글의 중심은 관찰 내용에 둔다.');
  }
  out.push(`${n++}. 결과(충족한 기준 · 점수)에 맞춰 서술의 깊이를 달리하라. 충족하지 못한 기준을 해낸 것처럼 쓰지 마라.`);
  out.push(`${n++}. "관찰:" · "학기 관찰:" · "교사 메모:"가 있는 학생은 그 내용을 반드시 살려 쓰라. 거기 없는 구체적인 행동은 지어내지 마라.`);
  out.push('   "학기 관찰:"은 특정 활동에 대한 기록이 아니다. 어느 활동에서 그랬다고 단정하지 말고, 학기 전체의 모습으로 쓰거나 자연스러운 곳에 녹여라.');
  out.push(`${n++}. "학기 흐름:"이나 "교사 메모:"에 변화가 드러난 학생만 성장을 쓰라. 나아졌으면 '처음에는 ~했으나 ~하게 됨'처럼 쓰고,`);
  out.push('   결과가 낮아졌으면 노력한 점과 앞으로의 과제를 긍정적으로 쓰라. 근거 없이 "크게 성장함"이라고 쓰지 마라.');
  out.push(`${n++}. [이번 학기에 함께 배운 성취기준]은 학생 개인의 성취 근거가 아니다. 활동과 자연스럽게 이어질 때만 배경으로 짧게 쓰고, 그 기준을 잘 해냈다고 쓰지 마라.`);
  out.push(`${n++}. "우수함", "미흡함", "뛰어남" 같은 평가어만으로 쓰지 말고 관찰된 행동과 결과로 서술하라.`);
  out.push(`${n++}. 학생마다 글의 첫 어절을 서로 다르게 하라.`);
  out.push('   같은 표현으로 시작하는 학생이 둘 이상 있으면 안 된다. 결과가 같은 학생끼리도 마찬가지다.');
  out.push(`${n++}. 학생이 다룬 구체적 소재를 지어내지 마라.`);
  out.push('   주제, 글감, 작품 이름, 대상 이름은 기록에 적힌 것만 쓴다.');
  out.push('   "축구를 소재로", "우리 학교 급식을 예로 들어"처럼 확인되지 않은 소재를 넣으면 안 된다.');
  out.push('   기록에 없으면 "자신이 고른 대상", "관심 있는 주제"처럼 소재를 특정하지 않는 표현을 쓰라.');
  out.push(`${n++}. 글에 학번 · 이름 · 성취기준 코드 · 성취도 기호(A~E) · 점수를 쓰지 마라. 주어 없이 쓴다.`);
  out.push(`${n++}. 교외 활동, 수상, 자격증, 사교육, 가정 환경처럼 기록에 없는 내용은 쓰지 마라.`);
  out.push(`${n++}. 출력은 각 줄을 "학번|글" 형식으로만. 학생 한 명이 한 줄이다. 아래 학생 ${lines.length}명을 모두 써라.`);
  out.push('   설명이나 인사말, 제목을 붙이지 마라.');
  out.push('');
  out.push('[학생별 기록]');
  lines.forEach((l) => { out.push(l.line); out.push(''); });
  return out.join('\n').trimEnd();
}

// ---- AI 결과 읽기: "10112|문장" (별표 · 글머리표 · 전각 세로줄 · [10112] 도 받음) ----
export function parseResult(text, students) {
  const byCode = new Map(students.map((s) => [studentCode(s), s]));
  const got = new Map();
  const unread = [];
  const unknown = [];
  for (const raw of String(text).split('\n')) {
    const line = raw.replace(/^[\s*\-•>#]+/, '').replace(/\*+$/, '').trim();
    if (!line) continue;
    const m = line.match(/^\[?(\d{3,6})\]?\s*[|｜]\s*(.+)$/);
    if (!m) { unread.push(line); continue; }
    const s = byCode.get(m[1]);
    if (!s) { unknown.push(m[1]); continue; }
    got.set(s.id, m[2].trim());
  }
  return { got, unread, unknown };
}

// AI 글 저장: seteuk.ai 에 원문을 두고(되돌리기용), 선생님이 고친 글(edited)은 overwrite 일 때만 바꾼다
export async function saveDrafts(cls, term, got, { overwrite = false } = {}) {
  for (const [studentId, text] of got) {
    const row = S.seteukOf(studentId, term, cls.subject);
    const patch = { ai: text };
    if (overwrite || !row?.edited || !(row?.text || '').trim()) Object.assign(patch, { text, edited: false, polished: false });
    await S.saveSeteuk(studentId, term, cls.subject, patch);
  }
}
// 되돌릴 AI 글: 새 방식은 seteuk.ai, 예전(항목별) 방식은 항목 문장을 이어 붙인 것
export const aiTextOf = (row) => row?.ai || Object.values(row?.parts || {}).map((t) => String(t || '').trim()).filter(Boolean).join(' ');

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
