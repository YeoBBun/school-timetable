// 과세특 AI 초안: 한 화면에 할 일 하나, 위의 단계 표시를 따라 '다음 →'만 누르면 되게 (반 화면 → 과세특 → '🤖 AI로 반 전체 초안')
// 단계: 학기 종류 → 관찰 누르기(학기 단위, 자동 배정 가능) → 쓸 학생(일반 학기만) → 문장 만들기(반 전체 한 번에: 복사 → AI → 붙여넣기) → 확인 · 나이스
// 보는 학기를 따른다. 지금 단계는 반마다 메모리에만 둔다
import { h, append, toast, showError, confirmDialog } from '../ui.js';
import * as S from '../store.js';
import { go } from '../app.js';
import { rubricResult } from '../evalplan.js';
import {
  aiSettings, linesOf, promptText, parseResult, overlaps, saveDrafts, aiTextOf, byteLen,
  evidenceOf, EVIDENCE_LABEL, recommended, targetsOf, setTargets, lintText, similarPairs,
  tagList, DEFAULT_TAGS, autoTagList, DEFAULT_AUTO_TAGS, obsOf, saveObs, autoPlan,
} from '../seteukAI.js';

const wiz = new Map(); // 반 id → { step } (지금 보는 단계)
const copied = new Set(); // 복사한 프롬프트 (✓ 표시용)
const AI_LINKS = [['클로드', 'https://claude.ai/new'], ['제미나이', 'https://gemini.google.com/app'], ['챗지피티', 'https://chatgpt.com/']];

export function renderSeteukAI(root, cls, back, { fillNeis } = {}) {
  const students = S.studentsOf(cls);
  const term = { year: S.classYear(cls), semester: S.viewTerm().semester };
  const st = wiz.get(cls.id) || { step: 'kind' };
  wiz.set(cls.id, st);
  const ctx = {
    cls, term, students, st, fillNeis,
    rowOf: (s) => S.seteukOf(s.id, term, cls.subject),
    free: S.isFreeTerm(term, cls.grade),
    kindChosen: (S.settings().free_terms_seen || []).includes(`${term.year}-${term.semester}-${cls.grade}`),
    redraw: () => go(`class/${cls.id}/seteuk`),
  };
  ctx.targets = targetsOf(cls, term, students);
  ctx.assess = S.assessmentsOf(cls, term);

  const steps = [
    { key: 'kind', label: '학기 종류', view: stepKind },
    { key: 'observe', label: '관찰 누르기', view: stepObserve },
    ctx.free ? null : { key: 'targets', label: '쓸 학생 고르기', view: stepTargets },
    { key: 'write', label: '문장 만들기', view: stepWrite },
    { key: 'finish', label: '확인 · 나이스', view: stepFinish },
  ].filter(Boolean);
  let i = steps.findIndex((x) => x.key === st.step);
  if (i < 0) { i = 0; st.step = steps[0].key; }
  const goStep = (k) => { st.step = steps[Math.max(0, Math.min(steps.length - 1, k))].key; ctx.redraw(); window.scrollTo({ top: 0 }); };
  ctx.next = () => goStep(i + 1);

  if (!ctx.assess.length) {
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
    h('p', { class: 'muted small' }, `이 반: 학생 ${students.length}명 · 수행평가 ${ctx.assess.length}개`));
}

// ---- 2. 관찰 누르기: 학기 전체에 대해 학생마다 관찰 낱말 · 한 줄 메모 (글이 서로 달라지는 가장 큰 열쇠) ----
// 자동으로 넣기: 관찰이 비어 있는 학생에게 '자동 배정용 낱말'(좋은 것만)을 2개씩. 자동으로 넣은 낱말은 점선으로 보이고, 누르면 빠진다
function stepObserve(root, ctx) {
  const { cls, term, students, assess } = ctx;
  const tags = tagList();
  const obs = new Map(students.map((s) => [s.id, obsOf(s, cls, term)]));
  const withObs = students.filter((s) => { const o = obs.get(s.id); return o.tags.length || o.obs; }).length;
  const autoCount = students.filter((s) => obs.get(s.id).auto.size).length;
  const toggle = (s, t) => {
    const o = obs.get(s.id);
    const on = o.tags.includes(t);
    saveObs(s, cls, term, { tags: on ? o.tags.filter((x) => x !== t) : [...o.tags, t], auto: [...o.auto].filter((x) => x !== t) }).catch(showError);
  };
  const runAuto = async () => {
    const { plan, skipLow } = autoPlan(cls, term, students);
    if (!plan.length) return toast(skipLow.length ? `관찰이 빈 학생은 모두 결과가 낮아 건너뛰었습니다(${skipLow.length}명). 직접 눌러 주세요.` : '관찰이 비어 있는 학생이 없습니다. (결과가 없는 학생은 넣지 않습니다)');
    try {
      for (const { s, tags: add } of plan) await saveObs(s, cls, term, { tags: add, auto: add });
      toast(`${plan.length}명에게 넣었습니다. 점선 낱말이 맞는지 훑어보고 틀린 것만 눌러 빼세요.${skipLow.length ? ` (결과가 낮은 ${skipLow.length}명은 건너뜀)` : ''}`, 'ok');
    } catch (err) { showError(err); }
  };
  const clearAuto = async (drop) => {
    const list = students.filter((s) => obs.get(s.id).auto.size);
    if (drop && !await confirmDialog(`자동으로 넣은 낱말을 ${list.length}명에게서 모두 뺄까요? (직접 누른 낱말은 그대로)`, { okLabel: '빼기' })) return;
    try {
      for (const s of list) {
        const o = obs.get(s.id);
        await saveObs(s, cls, term, drop ? { tags: o.tags.filter((t) => !o.auto.has(t)), auto: [] } : { auto: [] });
      }
      toast(drop ? '자동으로 넣은 낱말을 뺐습니다.' : '확인했습니다. 점선 표시를 지웠습니다.', 'ok');
    } catch (err) { showError(err); }
  };
  const resultsOf = (s) => assess.map((a) => {
    const cur = S.scoreOf(a.id, s.id) || {};
    const r = rubricResult(a, cur);
    return cur.special || r.grade || (r.score != null ? `${r.score}점` : '-');
  }).join(' · ');
  const notesOf = (s) => assess.map((a) => (S.scoreOf(a.id, s.id)?.note || '').trim()).filter(Boolean);

  append(root, ...title('학생마다 관찰을 눌러 주세요 (학기 전체)',
    '학생마다 다른 정보가 있어야 글이 서로 달라집니다. 이 학기 전체를 떠올리며 눌러 주세요. 다 하지 않아도 되고, 눈에 띈 학생만 눌러도 됩니다.'),
    h('div', { class: 'wiz-box', style: { marginBottom: '12px' } },
      h('div', { class: 'row' },
        h('button', { class: 'btn btn-primary', onClick: runAuto }, '🎲 빈 학생에게 자동으로 넣기'),
        autoCount ? h('button', { class: 'btn', onClick: () => clearAuto(false) }, `✓ 다 확인함 (점선 지우기 ${autoCount}명)`) : null,
        autoCount ? h('button', { class: 'btn', onClick: () => clearAuto(true) }, '자동으로 넣은 것 모두 빼기') : null),
      h('p', { class: 'muted small', style: { margin: '8px 0 0' } },
        "관찰이 하나도 없는 학생에게 '자동 배정용 낱말'(좋은 낱말만) 중 2개씩 넣습니다. 결과가 낮은 학생(D · E 또는 60% 미만)은 결과와 어긋나서 건너뜁니다. ",
        h('strong', {}, '자동으로 넣은 낱말은 점선'), '으로 보입니다. 생기부에 그대로 들어가니 훑어보고 틀린 것만 눌러 빼세요.')),
    h('p', { class: 'small' }, `관찰 있는 학생 ${withObs}/${students.length}명`),
    h('table', { class: 'table obs-table' }, h('tbody', {}, students.map((s) => {
      const o = obs.get(s.id);
      const chips = [...tags, ...o.tags.filter((t) => !tags.includes(t))];
      const notes = notesOf(s);
      return h('tr', {},
        h('td', { class: 'nowrap' }, h('strong', {}, `${s.number}`), ` ${s.name}`, h('div', { class: 'muted small' }, resultsOf(s))),
        h('td', {},
          h('div', { class: 'tag-row' }, chips.map((t) => h('button', {
            class: `pick-chip ${o.tags.includes(t) ? 'on' : ''} ${o.auto.has(t) ? 'auto' : ''}`,
            title: o.auto.has(t) ? '자동으로 넣은 낱말입니다. 틀리면 눌러서 빼세요' : '',
            onClick: () => toggle(s, t),
          }, t))),
          h('input', { type: 'text', class: 'obs-note', placeholder: '한 줄 메모 (예: 시의 비유를 자기 경험과 연결해 설명함)', value: o.obs, 'data-fk': `obs-${s.id}`, onChange: (e) => saveObs(s, cls, term, { obs: e.target.value.trim() }).catch(showError) }),
          notes.length ? h('div', { class: 'muted small', style: { marginTop: '4px' } }, '채점 때 쓴 메모: ', notes.join(' / ')) : null));
    }))),
    h('details', { class: 'small', style: { marginTop: '10px' } }, h('summary', {}, '관찰 낱말 고치기'),
      h('p', { class: 'muted' }, '한 줄에 하나씩. 비우면 처음 목록으로 돌아갑니다.'),
      h('div', { class: 'tag-lists' },
        h('label', {}, h('strong', {}, '누르는 낱말'),
          h('textarea', { rows: 8, value: tags.join('\n'), onChange: (e) => S.upsert('settings', { seteuk_tags: e.target.value.split('\n').map((x) => x.trim()).filter(Boolean) }, 'user_id').catch(showError) })),
        h('label', {}, h('strong', {}, '자동 배정용 낱말 (좋은 것만 넣으세요)'),
          h('textarea', { rows: 8, value: autoTagList().join('\n'), onChange: (e) => S.upsert('settings', { seteuk_auto_tags: e.target.value.split('\n').map((x) => x.trim()).filter(Boolean) }, 'user_id').catch(showError) }))),
      h('p', { class: 'muted' }, `처음 목록: ${DEFAULT_TAGS.join(', ')}`),
      h('p', { class: 'muted' }, `자동 배정 처음 목록: ${DEFAULT_AUTO_TAGS.join(', ')}`)));
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

// ---- 4. 문장 만들기: 반 전체를 한 번에 (복사 → AI → 붙여넣기) ----
function stepWrite(root, ctx) {
  const { cls, term, targets, rowOf } = ctx;
  const { lines, missing } = linesOf(cls, term, targets);
  const pending = lines.filter((l) => !rowOf(l.s)?.ai);
  const done = lines.length - pending.length;
  const upper = Math.floor(Math.max(0, aiSettings().bytes - aiSettings().reserve) / 3);
  const autoLeft = targets.filter((s) => obsOf(s, cls, term).auto.size).length;

  append(root, ...title('문장 만들기', `①복사 → ②AI에 붙여넣기 → ③답 붙여넣기, 한 번이면 됩니다. 쓸 학생 ${lines.length}명 · 학생당 약 ${upper}자 · 이 학기 수행평가 모두와 관찰을 한 문단으로.`),
    autoLeft ? h('p', { class: 'warn-text small' }, `자동으로 넣은 관찰을 아직 확인하지 않은 학생이 ${autoLeft}명 있습니다. 이전 단계에서 점선 낱말을 훑어보세요.`) : null,
    missing.length ? h('p', { class: 'muted small' }, `결과 · 관찰 · 메모가 하나도 없어 빠지는 학생: ${missing.map((s) => `${s.number}번`).join(', ')}`) : null,
    lines.length ? h('div', { class: 'wiz-three' },
      h('div', { class: 'wiz-box' },
        h('div', { class: 'wiz-box-title' }, h('span', { class: 'wiz-num' }, '1'), '복사하기'),
        copyRow(`all:${cls.id}`, promptText(cls, term, lines), `📋 ${lines.length}명 모두 복사`),
        done && pending.length ? [
          h('p', { class: 'warn-text small', style: { margin: '8px 0 4px' } }, `답에 빠진 학생 ${pending.length}명: ${pending.map((l) => `${l.s.number}번`).join(', ')}. AI 답이 중간에 끊겼을 수 있습니다.`),
          copyRow(`missing:${cls.id}`, promptText(cls, term, pending), `📋 빠진 ${pending.length}명만 다시 복사`)] : null,
        h('p', { class: 'muted small', style: { margin: '8px 0 0' } }, '학생이 많으면 AI 답이 길어서 중간에 끊길 수 있습니다(특히 챗지피티 무료판). 끊기면 받은 데까지 붙여넣고 위에 나오는 \'빠진 학생만 다시 복사\'를 쓰세요.')),
      h('div', { class: 'wiz-box' },
        h('div', { class: 'wiz-box-title' }, h('span', { class: 'wiz-num' }, '2'), 'AI를 열어 붙여넣고 보내기'),
        h('div', { class: 'row' }, AI_LINKS.map(([label, href]) => h('a', { class: 'btn btn-lg', href, target: '_blank', rel: 'noopener' }, `${label} 열기`))),
        h('p', { class: 'muted small' }, "새 창에서 입력칸을 누르고 Ctrl+V → 보내기. 답이 다 나오면 답 아래의 '복사' 단추를 누르세요.")),
      pasteBox(ctx, lines.map((l) => l.s)),
      done ? h('p', { class: 'small' }, h('span', { class: `badge ${pending.length ? 'badge-warn' : 'badge-ok'}` }, `글 받은 학생 ${done}/${lines.length}명`), pending.length ? '' : '  다 받았습니다. 다음 → 에서 확인하세요.') : null)
      : h('p', { class: 'empty' }, '글을 만들 학생이 없습니다. 수행평가 결과나 관찰을 먼저 넣으세요.'));
}

function copyRow(key, text, label) {
  const ck = `${key}:${text.length}`;
  return h('div', { class: 'row', style: { marginBottom: '6px' } },
    h('button', { class: `btn btn-lg ${copied.has(ck) ? '' : 'btn-primary'}`, onClick: (e) => copy(text, e.currentTarget).then((ok) => { if (ok) copied.add(ck); }) },
      copied.has(ck) ? '✓ 복사함 (다시 복사)' : label),
    h('details', { class: 'small' }, h('summary', { class: 'muted' }, '내용 보기'), h('pre', { class: 'prompt-pre' }, text)));
}

// ③ AI 답 붙여넣기 (붙여넣으면 바로 들어감). 선생님이 고친 글이 있으면 바꿀지 묻는다
function pasteBox(ctx, students) {
  const { cls, term } = ctx;
  const status = h('div', { class: 'small' });
  const area = h('textarea', { rows: 6, class: 'paste-area', placeholder: 'AI가 준 답을 여기에 붙여넣으세요 (Ctrl+V). 붙여넣으면 바로 들어갑니다.' });
  const take = async () => {
    if (!area.value.trim()) return;
    const r = parseResult(area.value, students);
    if (!r.got.size) { status.replaceChildren(h('span', { class: 'warn-text' }, '읽은 학생이 없습니다. AI 답을 통째로 붙여넣었는지 확인하세요.')); return; }
    try {
      const edited = [...r.got.keys()].filter((id) => { const row = S.seteukOf(id, term, cls.subject); return row?.edited && (row.text || '').trim() && row.text.trim() !== r.got.get(id); });
      const overwrite = edited.length ? await confirmDialog(`직접 고친 글이 있는 학생이 ${edited.length}명 있습니다. 그 학생들도 새 AI 글로 바꿀까요?\n('취소'를 누르면 고친 글은 그대로 두고, 나머지 학생만 넣습니다)`, { okLabel: '새 글로 바꾸기' }) : false;
      await saveDrafts(cls, term, r.got, { overwrite });
      toast(`${r.got.size}명 넣었습니다.`, 'ok');
    } catch (err) { showError(err); }
  };
  area.addEventListener('paste', () => setTimeout(take, 0));
  return h('div', { class: 'wiz-box' },
    h('div', { class: 'wiz-box-title' }, h('span', { class: 'wiz-num' }, '3'), 'AI 답 붙여넣기'),
    area, h('div', { class: 'row', style: { marginTop: '6px' } }, status, h('span', { class: 'grow' }), h('button', { class: 'btn', onClick: take }, '넣기')));
}

// ---- 5. 확인 · 나이스 ----
function stepFinish(root, ctx) {
  const { cls, term, students, targets, rowOf, fillNeis } = ctx;
  const st = aiSettings();
  const names = students.map((s) => s.name).filter(Boolean);
  const rows = targets.map((s) => ({ s, row: rowOf(s), text: (rowOf(s)?.text || '').trim() }));
  const texts = new Map(rows.map((r) => [r.s.id, r.text]));
  const similar = similarPairs(texts);
  const dup = overlaps(texts);
  const byId = new Map(students.map((s) => [s.id, s]));
  const issuesOf = (r) => {
    if (!r.text) return ['아직 없음'];
    const out = lintText(r.text, { names });
    if (byteLen(r.text) > st.bytes) out.push(`너무 김(${byteLen(r.text)}/${st.bytes}바이트)`);
    if (dup.ids.has(r.s.id)) out.push('첫머리가 다른 학생과 같음');
    const sim = [...(similar.get(r.s.id) || [])].map((id) => `${byId.get(id)?.number}번`);
    if (sim.length) out.push(`${sim.join(', ')}과 비슷함`);
    return out;
  };
  const checked = rows.map((r) => ({ ...r, issues: issuesOf(r) }));
  const bad = checked.filter((r) => r.issues.length);
  const good = checked.filter((r) => !r.issues.length);
  const need = S.seteukRequired(term, cls.grade, students.length);
  const written = students.filter((s) => (rowOf(s)?.text || '').trim()).length;
  const edited = rows.filter((r) => r.row?.edited && aiTextOf(r.row) && aiTextOf(r.row) !== r.text);
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
            if (!edited.length) return toast('되돌릴 것이 없습니다. 아직 고친 글이 없습니다.');
            if (!await confirmDialog(`고친 ${edited.length}명의 글을 버리고 AI가 처음 쓴 글로 되돌릴까요?`, { okLabel: '되돌리기' })) return;
            for (const r of edited) await S.saveSeteuk(r.s.id, term, cls.subject, { text: aiTextOf(r.row), edited: false, polished: false });
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
    h('label', {}, '직접 쓸 몫(바이트)', num('reserve', 0, 6000, 50)));
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
