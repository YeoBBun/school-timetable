// 과세특 AI 초안: 한 화면에 할 일 하나, 위의 단계 표시를 따라 '다음 →'만 누르면 되게 (반 화면 → 과세특 → '🤖 AI로 반 전체 초안')
// 단계: 학기 종류 → 관찰 누르기 → 쓸 학생(일반 학기만) → 문장 만들기(수행평가마다: 복사 → AI → 붙여넣기) → 다듬기(선택) → 확인 · 나이스
// 보는 학기를 따른다. 단계 · 항목 위치는 반마다 메모리에만 둔다
import { h, append, toast, showError, confirmDialog } from '../ui.js';
import * as S from '../store.js';
import { go } from '../app.js';
import { rubricResult } from '../evalplan.js';
import {
  aiSettings, itemsOf, sharesOf, linesOf, promptText, polishPrompt, parseResult, overlaps, saveParts, assemble, byteLen,
  evidenceOf, EVIDENCE_LABEL, recommended, targetsOf, setTargets, lintText, similarPairs, tagList, DEFAULT_TAGS,
} from '../seteukAI.js';

const wiz = new Map(); // 반 id → { step, item, assess } (지금 보는 단계 · 문장 만들기 항목 · 관찰 누르기 평가)
const copied = new Set(); // 복사한 프롬프트 (✓ 표시용)
const AI_LINKS = [['클로드', 'https://claude.ai/new'], ['제미나이', 'https://gemini.google.com/app'], ['챗지피티', 'https://chatgpt.com/']];

export function renderSeteukAI(root, cls, back, { fillNeis } = {}) {
  const students = S.studentsOf(cls);
  const term = { year: S.classYear(cls), semester: S.viewTerm().semester };
  const st = wiz.get(cls.id) || { step: 'kind', item: 0, assess: 0 };
  wiz.set(cls.id, st);
  const ctx = {
    cls, term, students, st, fillNeis,
    rowOf: (s) => S.seteukOf(s.id, term, cls.subject),
    free: S.isFreeTerm(term, cls.grade),
    kindChosen: (S.settings().free_terms_seen || []).includes(`${term.year}-${term.semester}-${cls.grade}`),
    redraw: () => go(`class/${cls.id}/seteuk`),
  };
  ctx.targets = targetsOf(cls, term, students);
  ctx.items = itemsOf(cls, term);

  const steps = [
    { key: 'kind', label: '학기 종류', view: stepKind },
    { key: 'observe', label: '관찰 누르기', view: stepObserve },
    ctx.free ? null : { key: 'targets', label: '쓸 학생 고르기', view: stepTargets },
    { key: 'write', label: '문장 만들기', view: stepWrite },
    { key: 'polish', label: '다듬기 (선택)', view: stepPolish },
    { key: 'finish', label: '확인 · 나이스', view: stepFinish },
  ].filter(Boolean);
  let i = steps.findIndex((x) => x.key === st.step);
  if (i < 0) { i = 0; st.step = steps[0].key; }
  const goStep = (k) => { st.step = steps[Math.max(0, Math.min(steps.length - 1, k))].key; ctx.redraw(); window.scrollTo({ top: 0 }); };
  ctx.next = () => goStep(i + 1);

  if (!ctx.items.length) {
    append(root, h('div', { class: 'row', style: { marginBottom: '12px' } }, h('button', { class: 'btn', onClick: back }, '← 나가기')),
      h('div', { class: 'empty' }, `${term.year}학년도 ${term.semester}학기에 이 반의 수행평가가 없습니다. 수행평가 메뉴에서 평가계획서를 올리거나 평가를 만든 뒤 다시 오세요. (다른 학기는 왼쪽 위 학기 고르기에서 바꿉니다)`));
    return;
  }

  const body = h('div', { class: 'wiz-body' });
  append(root,
    h('div', { class: 'row', style: { marginBottom: '10px' } },
      h('button', { class: 'btn', onClick: back }, '← 나가기'),
      h('strong', {}, `${S.classLabel(cls)} · ${term.year}학년도 ${term.semester}학기 과세특 만들기`)),
    h('div', { class: 'wiz-steps' }, steps.map((x, k) => h('button', {
      class: `wiz-step ${k === i ? 'now' : ''} ${k < i ? 'done' : ''}`, onClick: () => goStep(k),
    }, h('span', { class: 'wiz-num' }, k < i ? '✓' : String(k + 1)), x.label))),
    body,
    h('div', { class: 'wiz-nav' },
      i > 0 ? h('button', { class: 'btn btn-lg', onClick: () => goStep(i - 1) }, '← 이전') : h('span', {}),
      h('span', { class: 'muted small' }, `${i + 1} / ${steps.length}`),
      i < steps.length - 1 ? h('button', { class: 'btn btn-primary btn-lg', onClick: () => goStep(i + 1) }, '다음 →') : h('span', {})));
  steps[i].view(body, ctx);
}

const title = (text, sub) => [h('h2', { class: 'wiz-title' }, text), sub ? h('p', { class: 'wiz-sub' }, sub) : null];

// ---- 1. 학기 종류 ----
function stepKind(root, ctx) {
  const { cls, term, students, free, kindChosen } = ctx;
  const pick = async (on) => {
    try {
      await S.setFreeTerm(term, cls.grade, on);
      const key = `${term.year}-${term.semester}-${cls.grade}`;
      const seen = S.settings().free_terms_seen || [];
      if (!seen.includes(key)) await S.upsert('settings', { free_terms_seen: [...seen, key] }, 'user_id');
      ctx.next();
    } catch (err) { showError(err); }
  };
  const need = Math.ceil(students.length * 0.2);
  append(root, ...title(`${cls.grade}학년 ${term.semester}학기는 어떤 학기인가요?`, '골라 주면 다음 단계로 넘어갑니다.'),
    h('div', { class: 'wiz-choices' },
      h('button', { class: `wiz-choice ${kindChosen && free ? 'on' : ''}`, onClick: () => pick(true) },
        h('strong', {}, '자유학기'), h('span', {}, `모든 학생(${students.length}명)을 씁니다`)),
      h('button', { class: `wiz-choice ${kindChosen && !free ? 'on' : ''}`, onClick: () => pick(false) },
        h('strong', {}, '일반 학기'), h('span', {}, `학급의 20% 이상(${need}명 이상)을 씁니다`))),
    h('p', { class: 'muted small' }, `이 반: 학생 ${students.length}명 · 수행평가 ${ctx.items.filter((x) => x.type === 'assess').length}개`));
}

// ---- 2. 관찰 누르기: 수행평가마다 학생에게 관찰 낱말을 눌러 준다 (글이 서로 달라지는 가장 큰 열쇠) ----
function stepObserve(root, ctx) {
  const { cls, term, students, st } = ctx;
  const assess = S.assessmentsOf(cls, term);
  const a = assess[Math.min(st.assess, assess.length - 1)];
  const tags = tagList();
  const list = ctx.free ? students : students; // 일반 학기도 여기서 근거를 모아야 쓸 학생을 고를 수 있다
  const save = (s, patch) => S.upsert('scores', { assessment_id: a.id, student_id: s.id, ...patch }, 'assessment_id,student_id').catch(showError);
  const withObs = list.filter((s) => { const c = S.scoreOf(a.id, s.id); return (c?.tags || []).length || (c?.note || '').trim(); }).length;

  append(root, ...title('학생마다 관찰을 눌러 주세요',
    '글이 서로 비슷해지는 가장 큰 이유는 학생마다 다른 정보가 없기 때문입니다. 학생마다 다르게 눌러 줄수록 다른 글이 나옵니다. 꼭 다 하지 않아도 되고, 눈에 띈 학생만 눌러도 됩니다.'),
    h('div', { class: 'wiz-tabs' }, assess.map((x, k) => {
      const n = list.filter((s) => { const c = S.scoreOf(x.id, s.id); return (c?.tags || []).length || (c?.note || '').trim(); }).length;
      return h('button', { class: `pick-chip ${x === a ? 'on' : ''}`, onClick: () => { st.assess = k; ctx.redraw(); } }, `${x.title} (${n}/${list.length})`);
    })),
    h('p', { class: 'small' }, h('strong', {}, a.title), ` — 관찰 있는 학생 ${withObs}/${list.length}명`),
    h('table', { class: 'table obs-table' }, h('tbody', {}, list.map((s) => {
      const cur = S.scoreOf(a.id, s.id) || {};
      const r = rubricResult(a, cur);
      const on = new Set(cur.tags || []);
      const res = cur.special || r.grade || (r.score != null ? `${r.score}점` : '-');
      return h('tr', {},
        h('td', { class: 'nowrap' }, h('strong', {}, `${s.number}`), ` ${s.name}`, h('div', { class: 'muted small' }, `결과 ${res}`)),
        h('td', {},
          h('div', { class: 'tag-row' }, tags.map((t) => h('button', {
            class: `pick-chip ${on.has(t) ? 'on' : ''}`,
            onClick: () => save(s, { tags: on.has(t) ? [...on].filter((x) => x !== t) : [...on, t] }),
          }, t))),
          h('input', { type: 'text', class: 'obs-note', placeholder: '한 줄 메모 (예: 시의 비유를 자기 경험과 연결해 설명함)', value: cur.note || '', 'data-fk': `obs-${a.id}-${s.id}`, onChange: (e) => save(s, { note: e.target.value.trim() }) })));
    }))),
    h('details', { class: 'small', style: { marginTop: '10px' } }, h('summary', {}, '관찰 낱말 고치기'),
      h('p', { class: 'muted' }, '한 줄에 하나씩. 비우면 처음 목록으로 돌아갑니다.'),
      h('textarea', {
        rows: 6, value: tags.join('\n'), style: { width: '100%' },
        onChange: (e) => S.upsert('settings', { seteuk_tags: e.target.value.split('\n').map((x) => x.trim()).filter(Boolean) }, 'user_id').catch(showError),
      }),
      h('p', { class: 'muted' }, `처음 목록: ${DEFAULT_TAGS.join(', ')}`)));
}

// ---- 3. 쓸 학생 고르기 (일반 학기) ----
function stepTargets(root, ctx) {
  const { cls, term, students, targets } = ctx;
  const need = S.seteukRequired(term, cls.grade, students.length);
  const ids = new Set(targets.map((s) => s.id));
  const rec = recommended(cls, term, students);
  const toggle = (s, on) => { const next = new Set(ids); if (on) next.add(s.id); else next.delete(s.id); setTargets(cls, term, students, next).catch(showError); };
  const sorted = [...students].sort((a, b) => evidenceOf(b, cls, term).score - evidenceOf(a, cls, term).score || a.number - b.number);
  append(root, ...title(`과세특을 쓸 학생을 고르세요 (${need}명 이상)`, '관찰이 많은 학생부터 미리 골라 두었습니다. 체크해서 더하거나 빼세요.'),
    h('div', { class: 'row', style: { margin: '8px 0' } },
      h('span', { class: `badge ${ids.size >= need ? 'badge-ok' : 'badge-warn'}` }, `고른 학생 ${ids.size}명 / 필요 ${need}명`),
      h('button', { class: 'btn btn-sm', onClick: () => setTargets(cls, term, students, rec).catch(showError) }, '추천대로'),
      h('button', { class: 'btn btn-sm', onClick: () => setTargets(cls, term, students, new Set(students.map((s) => s.id))).catch(showError) }, '모두')),
    h('table', { class: 'table' }, h('tbody', {}, sorted.map((s) => {
      const e = evidenceOf(s, cls, term);
      return h('tr', { class: ids.has(s.id) ? '' : 'muted' },
        h('td', { style: { width: '36px' } }, h('input', { type: 'checkbox', class: 'big-check', checked: ids.has(s.id), onChange: (x) => toggle(s, x.target.checked) })),
        h('td', { class: 'nowrap' }, `${s.number}. ${s.name}`),
        h('td', { class: 'small' }, h('span', { class: `badge ${e.level === 'rich' ? 'badge-ok' : e.level === 'some' ? '' : 'badge-warn'}` }, EVIDENCE_LABEL[e.level]), ` 평가 ${e.results} · 관찰 ${e.notes} · 메모 ${e.memos}`));
    }))));
}

// ---- 4. 문장 만들기: 항목 하나씩, 복사 → AI → 붙여넣기 ----
function stepWrite(root, ctx) {
  const { cls, term, targets, st, items, rowOf } = ctx;
  const shares = sharesOf(items, aiSettings());
  const k = Math.min(st.item, items.length - 1);
  const it = items[k];
  const share = shares.get(it.key);
  const { lines, missing } = linesOf(it, cls, term, targets);
  const saved = new Map(targets.map((s) => [s.id, rowOf(s)?.parts?.[it.key] || '']).filter(([, t]) => t));
  const doneOf = (x) => { const l = linesOf(x, cls, term, targets).lines; return l.length && l.every((y) => rowOf(y.s)?.parts?.[x.key]); };

  append(root, ...title('문장 만들기', `항목마다 ①복사 → ②AI에 붙여넣기 → ③결과 붙여넣기를 하면 됩니다. 쓸 학생 ${targets.length}명.`),
    h('div', { class: 'wiz-tabs' }, items.map((x, n) => h('button', { class: `pick-chip ${n === k ? 'on' : ''}`, onClick: () => { st.item = n; ctx.redraw(); } },
      `${n + 1}. ${x.title}${doneOf(x) ? ' ✓' : ''}`))),
    h('h3', {}, `${k + 1}. ${it.title}`, h('span', { class: 'muted small' }, `  학생당 약 ${Math.floor(share / 3)}자`)),
    missing.length ? h('p', { class: 'muted small' }, it.type === 'growth'
      ? `결과가 바뀌지 않았고 메모도 없는 ${missing.length}명은 이 문장을 만들지 않습니다(근거 없이 쓰면 모두 '꾸준히 참여함'이 됩니다).`
      : `결과 · 관찰이 없어 빠지는 학생: ${missing.map((s) => `${s.number}번`).join(', ')}`) : null,
    lines.length ? threeSteps(ctx, `item:${it.key}`, lines, (part) => promptText(it, cls, term, part, share), targets,
      async (got) => saveParts(cls, term, it, [...got])) : h('p', { class: 'empty' }, '이 항목에 넣을 학생이 없습니다. 다음 항목으로 넘어가세요.'),
    saved.size ? resultTable(ctx, it, saved, share) : null,
    k < items.length - 1 ? h('div', { style: { marginTop: '16px', textAlign: 'right' } },
      h('button', { class: 'btn btn-primary btn-lg', onClick: () => { st.item = k + 1; ctx.redraw(); window.scrollTo({ top: 0 }); } }, `다음 항목: ${items[k + 1].title} →`)) : null);
}

// ①②③ 세 칸: 복사 → AI 열기 → 결과 붙여넣기(붙여넣으면 바로 들어감)
function threeSteps(ctx, key, rows, make, students, apply) {
  const chunk = aiSettings().chunk || rows.length || 1;
  const parts = [];
  for (let k = 0; k < rows.length; k += chunk) parts.push(rows.slice(k, k + chunk));
  const status = h('div', { class: 'small' });
  const area = h('textarea', { rows: 6, class: 'paste-area', placeholder: 'AI가 준 답을 여기에 붙여넣으세요 (Ctrl+V). 붙여넣으면 바로 들어갑니다.' });
  const take = async () => {
    const r = parseResult(area.value, students);
    if (!area.value.trim()) return;
    if (!r.got.size) { status.replaceChildren(h('span', { class: 'warn-text' }, '읽은 학생이 없습니다. AI 답을 통째로 붙여넣었는지 확인하세요.')); return; }
    try {
      await apply(r.got);
      toast(`${r.got.size}명 넣었습니다.`, 'ok');
    } catch (err) { showError(err); }
  };
  area.addEventListener('paste', () => setTimeout(take, 0));
  return h('div', { class: 'wiz-three' },
    h('div', { class: 'wiz-box' },
      h('div', { class: 'wiz-box-title' }, h('span', { class: 'wiz-num' }, '1'), '복사하기'),
      parts.length > 1 ? h('p', { class: 'muted small' }, `학생이 많아 ${parts.length}번으로 나눴습니다. 하나씩 복사 → 붙여넣기를 반복하세요.`) : null,
      parts.map((p, n) => {
        const text = make(p);
        const ck = `${key}:${n}:${text.length}`;
        return h('div', { class: 'row', style: { marginBottom: '6px' } },
          h('button', { class: `btn btn-lg ${copied.has(ck) ? '' : 'btn-primary'}`, onClick: (e) => copy(text, e.currentTarget).then((ok) => { if (ok) copied.add(ck); }) },
            copied.has(ck) ? '✓ 복사함 (다시 복사)' : `📋 ${p[0].s.number}번~${p[p.length - 1].s.number}번 복사`),
          h('details', { class: 'small' }, h('summary', { class: 'muted' }, '내용 보기'), h('pre', { class: 'prompt-pre' }, text)));
      })),
    h('div', { class: 'wiz-box' },
      h('div', { class: 'wiz-box-title' }, h('span', { class: 'wiz-num' }, '2'), 'AI를 열어 붙여넣고 보내기'),
      h('div', { class: 'row' }, AI_LINKS.map(([label, href]) => h('a', { class: 'btn btn-lg', href, target: '_blank', rel: 'noopener' }, `${label} 열기`))),
      h('p', { class: 'muted small' }, "새 창에서 입력칸을 누르고 Ctrl+V → 보내기. 답이 다 나오면 답 아래의 '복사' 단추를 누르세요.")),
    h('div', { class: 'wiz-box' },
      h('div', { class: 'wiz-box-title' }, h('span', { class: 'wiz-num' }, '3'), 'AI 답 붙여넣기'),
      area, h('div', { class: 'row', style: { marginTop: '6px' } }, status, h('span', { class: 'grow' }), h('button', { class: 'btn', onClick: take }, '넣기'))));
}

// 넣은 문장 · 검사 (항목별)
function resultTable(ctx, it, saved, share) {
  const { cls, term, targets } = ctx;
  const over = [...saved].filter(([, t]) => byteLen(t) > share).length;
  const dup = overlaps(saved);
  const sim = similarPairs(saved);
  const bad = over + dup.ids.size + sim.size;
  return h('details', { class: 'card', open: bad > 0, style: { marginTop: '14px' } },
    h('summary', {}, h('strong', {}, `넣은 문장 ${saved.size}명 보기 · 고치기`), ' ',
      bad ? h('span', { class: 'badge badge-warn' }, [over ? `길이 넘침 ${over}` : null, dup.words.length ? `첫머리 겹침 ${dup.ids.size}` : null, sim.size ? `비슷한 글 ${sim.size}` : null].filter(Boolean).join(' · ')) : h('span', { class: 'badge badge-ok' }, '문제 없음')),
    h('table', { class: 'table ai-table' }, h('tbody', {}, targets.filter((s) => saved.has(s.id)).map((s) => {
      const t = saved.get(s.id);
      const warn = byteLen(t) > share || dup.ids.has(s.id) || sim.has(s.id);
      return h('tr', { class: warn ? 'dup' : '' },
        h('td', { class: 'nowrap small' }, `${s.number}. ${s.name}`),
        h('td', {}, h('textarea', { rows: 2, value: t, 'data-fk': `ai-${it.key}-${s.id}`, onChange: (e) => saveParts(cls, term, it, [[s.id, e.target.value.trim()]]).catch(showError) })),
        h('td', { class: `nowrap small ${byteLen(t) > share ? 'warn-text' : 'muted'}` }, `${Math.round(byteLen(t) / 3)}자쯤`));
    }))));
}

// ---- 5. 다듬기 (선택) ----
function stepPolish(root, ctx) {
  const { cls, term, targets, rowOf } = ctx;
  const st = aiSettings();
  const rows = targets.map((s) => ({ s, row: rowOf(s) }))
    .filter(({ row }) => row?.parts && (row.text || '').trim() && !row.edited)
    .map(({ s, row }) => ({ s, text: row.text }));
  append(root, ...title('다듬기 (건너뛰어도 됩니다)', '항목별 문장을 이어 붙인 글은 연결이 뚝뚝 끊깁니다. 내용은 그대로 두고 한 편의 글로 매끄럽게 만듭니다. 다듬은 뒤에는 빠진 내용이 없는지 꼭 읽어 보세요.'),
    rows.length
      ? threeSteps(ctx, 'polish', rows, (part) => polishPrompt(cls, part, Math.max(0, st.bytes - st.reserve)), targets,
        async (got) => { for (const [id, text] of got) await S.saveSeteuk(id, term, cls.subject, { text, edited: true, polished: true }); })
      : h('p', { class: 'empty' }, '다듬을 글이 없습니다. (이미 다듬었거나, 아직 문장을 만들지 않았습니다) 다음으로 넘어가세요.'));
}

// ---- 6. 확인 · 나이스 ----
function stepFinish(root, ctx) {
  const { cls, term, students, targets, rowOf, fillNeis } = ctx;
  const st = aiSettings();
  const names = students.map((s) => s.name).filter(Boolean);
  const rows = targets.map((s) => ({ s, row: rowOf(s), text: (rowOf(s)?.text || '').trim() }));
  const similar = similarPairs(new Map(rows.map((r) => [r.s.id, r.text])));
  const byId = new Map(students.map((s) => [s.id, s]));
  const issuesOf = (r) => {
    if (!r.text) return ['아직 없음'];
    const out = lintText(r.text, { names });
    if (byteLen(r.text) > st.bytes) out.push(`너무 김(${byteLen(r.text)}/${st.bytes}바이트)`);
    const sim = [...(similar.get(r.s.id) || [])].map((id) => `${byId.get(id)?.number}번`);
    if (sim.length) out.push(`${sim.join(', ')}과 비슷함`);
    return out;
  };
  const checked = rows.map((r) => ({ ...r, issues: issuesOf(r) }));
  const bad = checked.filter((r) => r.issues.length);
  const good = checked.filter((r) => !r.issues.length);
  const need = S.seteukRequired(term, cls.grade, students.length);
  const written = students.filter((s) => (rowOf(s)?.text || '').trim()).length;
  const edited = rows.filter((r) => r.row?.edited && r.row?.parts && Object.keys(r.row.parts).length);
  const editRow = (r) => h('div', { class: 'final-row' },
    h('div', { class: 'row' }, h('strong', {}, `${r.s.number}. ${r.s.name}`), r.issues.map((x) => h('span', { class: 'badge badge-warn' }, x)),
      h('span', { class: 'grow' }), h('span', { class: 'muted small' }, `${byteLen(r.text)}/${st.bytes}바이트`)),
    h('textarea', { rows: 4, value: r.text, 'data-fk': `final-${r.s.id}`, onChange: (e) => S.saveSeteuk(r.s.id, term, cls.subject, { text: e.target.value.trim(), edited: true }).catch(showError) }));

  append(root, ...title('확인하고 나이스로 보내기', '노란 표시가 있는 학생만 고치면 됩니다. 칸에서 바로 고치세요(칸을 벗어나면 저장).'),
    h('div', { class: 'row', style: { margin: '8px 0 14px' } },
      h('span', { class: `badge ${written >= need ? 'badge-ok' : 'badge-warn'}` }, `작성 ${written}/${students.length}명 · ${ctx.free ? '전원' : `${need}명 이상`} 필요`),
      h('span', { class: `badge ${bad.length ? 'badge-warn' : 'badge-ok'}` }, bad.length ? `고칠 학생 ${bad.length}명` : '고칠 것 없음')),
    bad.length ? [h('h3', {}, `고칠 학생 ${bad.length}명`), bad.map(editRow)] : null,
    good.length ? h('details', { class: 'card', style: { marginTop: '12px' } }, h('summary', {}, h('strong', {}, `문제 없는 학생 ${good.length}명 보기`)), good.map(editRow)) : null,
    h('div', { class: 'wiz-box', style: { marginTop: '16px' } },
      h('div', { class: 'wiz-box-title' }, '나이스에 올리기'),
      h('p', { class: 'small' }, '나이스: 교과담임 > 성적 > 성적처리 > 과목별세부능력및특기사항 > 조회 > 엑셀 내려받기 → 아래 단추로 그 파일을 넣으면 세특 칸이 채워진 파일이 내려받아집니다 → 같은 자리에서 엑셀 업로드.'),
      fillNeis ? h('button', { class: 'btn btn-primary btn-lg', onClick: fillNeis }, '📤 나이스 양식에 채우기') : null),
    h('details', { class: 'small', style: { marginTop: '14px' } }, h('summary', { class: 'muted' }, '더 보기: 되돌리기 · 설정'),
      h('div', { class: 'row', style: { margin: '8px 0' } },
        h('button', {
          class: 'btn btn-sm',
          onClick: async () => {
            if (!edited.length) return toast('되돌릴 것이 없습니다. 아직 고치거나 다듬은 글이 없습니다.');
            if (!await confirmDialog(`고치거나 다듬은 ${edited.length}명의 글을 버리고 항목 문장을 이어 붙인 글로 되돌릴까요?`, { okLabel: '되돌리기' })) return;
            for (const r of edited) await S.saveSeteuk(r.s.id, term, cls.subject, { text: assemble(cls, term, r.row.parts), edited: false, polished: false });
            toast(`${edited.length}명을 되돌렸습니다.`, 'ok');
          },
        }, `고친 것 되돌리기${edited.length ? ` (${edited.length}명)` : ''}`)),
      settingsBox()));
}

function settingsBox() {
  const st = aiSettings();
  const saveSt = (patch) => S.upsert('settings', { seteuk_ai: { ...S.settings().seteuk_ai, ...patch } }, 'user_id').catch(showError);
  const num = (key, min, max, step) => h('input', { type: 'number', min, max, step, value: st[key], style: { width: '90px' }, onChange: (e) => saveSt({ [key]: Math.max(min, Number(e.target.value) || 0) }) });
  return h('div', { class: 'row ai-settings' },
    h('label', {}, '세특 칸(바이트)', num('bytes', 300, 9000, 50)),
    h('label', {}, '직접 쓸 몫(바이트)', num('reserve', 0, 6000, 50)),
    h('label', {}, '한 번에 몇 명씩', h('select', { value: String(st.chunk), onChange: (e) => saveSt({ chunk: Number(e.target.value) }) },
      [5, 10, 25, 0].map((n) => h('option', { value: String(n) }, n ? `${n}명` : '전체')))),
    h('label', { class: 'inline' }, h('input', { type: 'checkbox', checked: st.growth, onChange: (e) => saveSt({ growth: e.target.checked }) }), '종합 · 성장 문장'));
}

// 학생별 보기 위쪽의 작성 인원 표시 (자유학기는 전원, 일반 학기는 20% 이상)
export function requirementBadge(cls, term, students, rowOf) {
  const free = S.isFreeTerm(term, cls.grade);
  const need = S.seteukRequired(term, cls.grade, students.length);
  const written = students.filter((s) => (rowOf(s)?.text || '').trim()).length;
  return h('span', { class: `badge ${written >= need ? 'badge-ok' : 'badge-warn'}` }, `${free ? '자유학기' : '일반 학기'} · 작성 ${written}/${students.length}명 · ${free ? '전원' : `${need}명 이상`} 필요`);
}

async function copy(text, btn) {
  let ok = false;
  try { await navigator.clipboard.writeText(text); ok = true; } catch {
    // 클립보드를 막아 둔 곳에서는 옛 방식으로 한 번 더
    const ta = h('textarea', { style: { position: 'fixed', opacity: '0' } });
    ta.value = text;
    document.body.append(ta);
    ta.select();
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
  }
  if (ok) { btn.textContent = '✓ 복사했습니다'; toast('복사했습니다. 이제 ② AI를 열어 붙여넣으세요.', 'ok'); } else btn.textContent = '복사가 막혔습니다. 내용 보기에서 직접 복사하세요';
  return ok;
}
