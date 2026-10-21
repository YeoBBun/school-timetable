// 과세특 AI 초안 화면 (반 화면 → 과세특 → '🤖 AI로 반 전체 초안'). 보는 학기를 따른다
// 1 작성 대상 · 근거  2 수행평가마다 프롬프트 복사 → AI 결과 붙여넣기 → 검사  3 (선택) 이어 붙인 글 다듬기  4 최종 검사 → 나이스 양식에 채우기
import { h, append, toast, showError, confirmDialog } from '../ui.js';
import * as S from '../store.js';
import { normCode, standardText } from '../standards.js';
import {
  aiSettings, itemsOf, sharesOf, linesOf, promptText, polishPrompt, parseResult, overlaps, saveParts, assemble, byteLen, studentCode,
  WEIGHTS, evidenceOf, EVIDENCE_LABEL, recommended, targetsOf, setTargets, lintText, similarPairs,
} from '../seteukAI.js';

const openCards = new Set(['targets']); // 펼쳐 둔 칸 (다시 그려도 유지)
const pastes = new Map(); // 칸 key → 붙여넣는 중인 글
const AI_LINKS = [['클로드 열기', 'https://claude.ai/new'], ['제미나이 열기', 'https://gemini.google.com/app'], ['챗지피티 열기', 'https://chatgpt.com/']];

export function renderSeteukAI(root, cls, back, { fillNeis } = {}) {
  const students = S.studentsOf(cls);
  const st = aiSettings();
  const term = { year: S.classYear(cls), semester: S.viewTerm().semester };
  const rowOf = (s) => S.seteukOf(s.id, term, cls.subject);
  const targets = targetsOf(cls, term, students);
  const items = itemsOf(cls, term);
  const shares = sharesOf(items, st);
  const ctx = { cls, term, students, targets, rowOf, st };
  const saveSt = (patch) => S.upsert('settings', { seteuk_ai: { ...S.settings().seteuk_ai, ...patch } }, 'user_id').catch(showError);
  const num = (key, min, max, step) => h('input', { type: 'number', min, max, step, value: st[key], style: { width: '90px' }, onChange: (e) => saveSt({ [key]: Math.max(min, Number(e.target.value) || 0) }) });

  append(root,
    h('div', { class: 'row', style: { marginBottom: '12px' } },
      h('button', { class: 'btn', onClick: back }, '← 학생별 보기'),
      h('strong', {}, `${term.year}학년도 ${term.semester}학기 ${cls.subject} 과세특 · AI 초안`),
      h('span', { class: 'grow' }),
      AI_LINKS.map(([label, href]) => h('a', { class: 'btn btn-sm', href, target: '_blank', rel: 'noopener' }, label))),
    h('details', { class: 'card ai-item', open: openCards.has('settings'), onToggle: toggler('settings') },
      h('summary', {}, h('strong', {}, '설정'), h('span', { class: 'muted small' }, ` 세특 칸 ${st.bytes}바이트 · 직접 쓸 몫 ${st.reserve} · ${st.chunk ? `${st.chunk}명씩` : '전체 한 번에'} · 종합 · 성장 ${st.growth ? '켬' : '끔'}`)),
      h('div', { class: 'row ai-settings' },
        h('label', {}, '세특 칸 전체(바이트)', num('bytes', 300, 9000, 50)),
        h('label', {}, '직접 쓸 몫(바이트)', num('reserve', 0, 6000, 50)),
        h('label', {}, '한 번에 몇 명씩', h('select', { value: String(st.chunk), onChange: (e) => saveSt({ chunk: Number(e.target.value) }) },
          [10, 25, 0].map((n) => h('option', { value: String(n) }, n ? `${n}명` : '전체')))),
        h('label', { class: 'inline' }, h('input', { type: 'checkbox', checked: st.growth, onChange: (e) => saveSt({ growth: e.target.checked }) }), '종합 · 성장 문장')),
      h('p', { class: 'muted small', style: { margin: '8px 0 0' } },
        `길이는 수행평가 ${WEIGHTS.assess} : 종합 ${WEIGHTS.growth} 비율로 나눕니다. 한글 1자 3바이트, 띄어쓰기 · 문장부호 1바이트. `,
        "직접 쓸 몫은 AI 문장 뒤에 선생님이 덧붙일 자리입니다. 한꺼번에 많이 시킬수록 AI가 첫머리를 비슷하게 쓰기 쉬우니 결과가 마음에 안 들면 묶음을 줄여 보세요. 다른 학기는 왼쪽 위 학기 고르기에서 바꿉니다.")),
    targetsCard(ctx),
    items.length
      ? [h('div', { class: 'section-title' }, `2. 항목별 문장 — 작성 대상 ${targets.length}명`),
        items.map((it, i) => itemCard(ctx, it, i, shares.get(it.key)))]
      : h('div', { class: 'empty' }, '이 학기에 수행평가가 없습니다. 수행평가 메뉴에서 평가계획서를 올리세요.'),
    items.length ? polishCard(ctx) : null,
    items.length ? finalCard(ctx, fillNeis) : null);
}

const toggler = (key) => (e) => { if (e.currentTarget.open) openCards.add(key); else openCards.delete(key); };

// ---- 1. 작성 대상 · 근거 ----
function targetsCard({ cls, term, students, targets, rowOf }) {
  const free = S.isFreeTerm(term, cls.grade);
  const need = S.seteukRequired(term, cls.grade, students.length);
  const ids = new Set(targets.map((s) => s.id));
  const rec = recommended(cls, term, students);
  const ev = new Map(students.map((s) => [s.id, evidenceOf(s, cls, term)]));
  const thin = students.filter((s) => ids.has(s.id) && ['thin', 'none'].includes(ev.get(s.id).level));
  const toggle = (s, on) => { const next = new Set(ids); if (on) next.add(s.id); else next.delete(s.id); setTargets(cls, term, students, next).catch(showError); };
  return h('details', { class: 'card ai-item', open: openCards.has('targets'), onToggle: toggler('targets') },
    h('summary', {}, h('strong', {}, '1. 작성 대상 · 근거'), requirementBadge(cls, term, students, rowOf),
      h('span', { class: `badge ${targets.length >= need ? 'badge-ok' : 'badge-warn'}` }, `대상 ${targets.length}명`)),
    h('p', { class: 'muted small' }, free
      ? '자유학기라 모든 학생이 대상입니다. 근거가 적은 학생은 어떤 프롬프트를 써도 비슷한 글이 나오니, 생성하기 전에 관찰 메모 · 학생 메모를 더 남겨 두세요.'
      : `일반 학기는 학급 학생의 20% 이상(${need}명)을 씁니다. 처음에는 근거가 많은 순으로 ${need}명을 골라 둡니다. 체크해서 더하거나 뺄 수 있습니다.`),
    thin.length ? h('p', { class: 'warn-text small' }, `근거가 결과뿐이거나 없는 대상 ${thin.length}명: ${thin.map((s) => `${s.number}번`).join(', ')} — 관찰 메모(수행평가 표) · 학생 메모를 먼저 남기면 글이 좋아집니다.`) : null,
    free ? null : h('div', { class: 'row', style: { margin: '6px 0' } },
      h('button', { class: 'btn btn-sm', onClick: () => setTargets(cls, term, students, rec).catch(showError) }, `추천대로 (${rec.size}명)`),
      h('button', { class: 'btn btn-sm', onClick: () => setTargets(cls, term, students, new Set(students.map((s) => s.id))).catch(showError) }, '모두')),
    h('table', { class: 'table' }, h('tbody', {}, students.map((s) => {
      const e = ev.get(s.id);
      return h('tr', { class: ids.has(s.id) ? '' : 'muted' },
        h('td', { style: { width: '30px' } }, h('input', { type: 'checkbox', checked: ids.has(s.id), disabled: free, onChange: (x) => toggle(s, x.target.checked) })),
        h('td', { class: 'nowrap small' }, `${s.number}. ${s.name}`),
        h('td', { class: 'small' }, `평가 결과 ${e.results} · 관찰 ${e.notes} · 메모 ${e.memos}`),
        h('td', { class: 'small' }, h('span', { class: `badge ${e.level === 'rich' ? 'badge-ok' : e.level === 'some' ? '' : 'badge-warn'}` }, EVIDENCE_LABEL[e.level]),
          !free && rec.has(s.id) ? h('span', { class: 'muted small' }, ' 추천') : null));
    }))));
}

// 자유학기는 모든 학생, 일반 학기는 학급마다 20% 이상 (자유학기 여부는 학년마다 체크)
export function requirementBadge(cls, term, students, rowOf) {
  const free = S.isFreeTerm(term, cls.grade);
  const need = S.seteukRequired(term, cls.grade, students.length);
  const written = students.filter((s) => (rowOf(s)?.text || '').trim()).length;
  return h('span', { class: 'row', style: { gap: '6px' }, onClick: (e) => e.stopPropagation() },
    h('label', { class: 'inline small', title: '자유학기면 모든 학생, 일반 학기면 학급 학생의 20% 이상을 씁니다' },
      h('input', { type: 'checkbox', checked: free, onChange: (e) => S.setFreeTerm(term, cls.grade, e.target.checked).catch(showError) }), `${cls.grade}학년 ${term.semester}학기는 자유학기`),
    h('span', { class: `badge ${written >= need ? 'badge-ok' : 'badge-warn'}` }, `작성 ${written}/${students.length}명 · ${free ? '전원' : `20% 이상 = ${need}명`} 필요`));
}

// ---- 2. 항목별 문장 ----
function itemCard({ cls, term, targets, rowOf }, it, i, share) {
  const { lines, missing } = linesOf(it, cls, term, targets);
  const saved = new Map(targets.map((s) => [s.id, rowOf(s)?.parts?.[it.key] || '']).filter(([, t]) => t));
  const missingCodes = it.standards.map(normCode).filter((c) => !standardText(c));
  const blocks = promptBlocks(lines, (part) => promptText(it, cls, term, part, share));

  const paste = pasteBox(`item:${it.key}`, targets, async (got) => saveParts(cls, term, it, [...got]));

  const over = [...saved].filter(([, t]) => byteLen(t) > share).length;
  const empty = lines.filter((l) => !saved.has(l.s.id)).length;
  const dup = overlaps(saved);
  const checks = saved.size ? h('div', { class: 'row ai-checks small' },
    chip(!over, over ? `바이트 넘침 ${over}명` : '바이트 OK'),
    chip(!empty, empty ? `빠진 학생 ${empty}명` : '빠진 학생 없음'),
    chip(!dup.words.length, dup.words.length ? `첫머리 겹침 ${dup.words.join(', ')}` : '첫머리 겹침 없음')) : null;
  const table = lines.length ? h('table', { class: 'table ai-table' },
    h('tbody', {}, targets.filter((s) => saved.has(s.id) || lines.some((l) => l.s === s)).map((s) => {
      const t = saved.get(s.id) || '';
      return h('tr', { class: dup.ids.has(s.id) ? 'dup' : '' },
        h('td', { class: 'nowrap small' }, `${s.number}. ${s.name}`),
        h('td', {}, h('textarea', {
          rows: 2, value: t, placeholder: '(아직 없음)', 'data-fk': `ai-${it.key}-${s.id}`,
          onChange: (e) => saveParts(cls, term, it, [[s.id, e.target.value.trim()]]).catch(showError),
        })),
        h('td', { class: `nowrap small ${byteLen(t) > share ? 'warn-text' : 'muted'}` }, t ? `${byteLen(t)}B` : ''));
    }))) : null;

  const done = lines.filter((l) => saved.has(l.s.id)).length;
  return h('details', { class: 'card ai-item', open: openCards.has(it.key), onToggle: toggler(it.key) },
    h('summary', {},
      h('strong', {}, `${i + 1}. ${it.title}`),
      h('span', { class: 'badge' }, it.type === 'growth' ? '종합' : '수행평가'),
      it.standards.length ? h('span', { class: 'muted small' }, ` ${it.standards.join(' ')}`) : null,
      h('span', { class: 'muted small' }, ` · ${share}바이트(약 ${Math.floor(share / 3)}자)`),
      h('span', { class: `badge ${done && done === lines.length ? 'badge-ok' : ''}`, style: { marginLeft: '8px' } }, lines.length ? `${done}/${lines.length}명` : '넣을 학생 없음')),
    missingCodes.length ? h('p', { class: 'warn-text small' }, `원문이 없는 성취기준: ${missingCodes.join(' ')}`) : null,
    missing.length ? h('p', { class: 'muted small' }, it.type === 'growth'
      ? `결과가 바뀌지 않았고 메모도 없어 종합 문장을 만들지 않는 학생 ${missing.length}명 (근거 없이 쓰면 모두 '꾸준히 참여함'이 됩니다)`
      : `이 평가의 결과 · 관찰이 없어 빠지는 대상 ${missing.length}명: ${missing.map((s) => `${s.number}번`).join(', ')}`) : null,
    lines.length ? [
      h('div', { class: 'section-title' }, '① 프롬프트 복사 → AI에 붙여넣기'), blocks,
      h('div', { class: 'section-title' }, '② AI 결과 붙여넣기'), paste,
      h('div', { class: 'section-title' }, '③ 검사 · 고치기'), checks || h('p', { class: 'muted small' }, '아직 넣은 문장이 없습니다.'), table,
    ] : (it.type === 'assess' ? h('p', { class: 'muted small' }, '대상 학생의 결과가 없습니다. 수행평가 화면에서 등급 · 관찰 메모를 먼저 넣으세요.') : null));
}

// ---- 3. 이어 붙인 글 다듬기 (선택) ----
function polishCard({ cls, term, targets, rowOf, st }) {
  // 아직 손대지 않은(항목 문장을 이어 붙인 그대로인) 초안만 다듬는다
  const rows = targets.map((s) => ({ s, row: rowOf(s) }))
    .filter(({ row }) => row?.parts && (row.text || '').trim() && !row.edited)
    .map(({ s, row }) => ({ s, text: row.text }));
  const limit = Math.max(0, st.bytes - st.reserve);
  const blocks = promptBlocks(rows, (part) => polishPrompt(cls, part, limit));
  const paste = pasteBox('polish', targets, async (got) => {
    for (const [id, text] of got) await S.saveSeteuk(id, term, cls.subject, { text, edited: true, polished: true });
  });
  return h('details', { class: 'card ai-item', open: openCards.has('polish'), onToggle: toggler('polish') },
    h('summary', {}, h('strong', {}, '3. 이어 붙인 글 다듬기'), h('span', { class: 'muted small' }, ' (선택) 활동별 문장을 한 편의 글로 매끄럽게'),
      h('span', { class: 'badge', style: { marginLeft: '8px' } }, `다듬을 초안 ${rows.length}명`)),
    h('p', { class: 'muted small' }, "내용은 더하거나 빼지 않고 연결만 다듬게 합니다. 다듬은 글은 '다듬음'으로 표시되고, 그 뒤로는 항목 문장을 다시 넣어도 덮어쓰지 않습니다(최종 검사의 '되돌리기'로 이어 붙인 글로 돌아갈 수 있습니다). 다듬은 뒤에는 내용이 빠지거나 더해지지 않았는지 꼭 읽어 보세요."),
    rows.length ? [blocks, h('div', { class: 'section-title' }, 'AI 결과 붙여넣기'), paste] : h('p', { class: 'muted small' }, '다듬을 초안이 없습니다. 항목별 문장을 먼저 넣으세요.'));
}

// ---- 4. 최종 검사 ----
function finalCard({ cls, term, students, targets, rowOf, st }, fillNeis) {
  const names = students.map((s) => s.name).filter(Boolean);
  const rows = targets.map((s) => ({ s, row: rowOf(s), text: (rowOf(s)?.text || '').trim() }));
  const similar = similarPairs(new Map(rows.map((r) => [r.s.id, r.text])));
  const byId = new Map(students.map((s) => [s.id, s]));
  const edited = rows.filter((r) => r.row?.edited && r.row?.parts && Object.keys(r.row.parts).length);
  const problems = rows.filter((r) => r.text && (byteLen(r.text) > st.bytes || lintText(r.text, { names }).length || similar.has(r.s.id))).length;
  const reset = async (list) => {
    for (const { s, row } of list) await S.saveSeteuk(s.id, term, cls.subject, { text: assemble(cls, term, row.parts), edited: false, polished: false });
  };
  return h('div', { class: 'card' },
    h('div', { class: 'row' },
      h('h3', { style: { margin: 0 } }, '4. 최종 검사'),
      h('span', { class: `badge ${problems ? 'badge-warn' : 'badge-ok'}` }, problems ? `확인할 학생 ${problems}명` : '문제 없음'),
      h('span', { class: 'grow' }),
      h('button', {
        class: 'btn btn-sm',
        onClick: async () => {
          if (!edited.length) return toast('되돌릴 것이 없습니다. 아직 고치거나 다듬은 초안이 없습니다.');
          if (!await confirmDialog(`고치거나 다듬은 ${edited.length}명의 초안을 버리고 항목 문장을 이어 붙인 글로 되돌릴까요?`, { okLabel: '되돌리기' })) return;
          await reset(edited).catch(showError);
          toast(`${edited.length}명의 초안을 되돌렸습니다.`, 'ok');
        },
      }, `고친 것 되돌리기${edited.length ? ` (${edited.length}명)` : ''}`),
      fillNeis ? h('button', { class: 'btn btn-primary', onClick: fillNeis, title: '나이스에서 내려받은 과세특 일괄입력 양식을 올리면 초안을 채워 내려줍니다' }, '나이스 양식에 채우기') : null),
    h('p', { class: 'muted small' }, `바이트(한도 ${st.bytes}) · 금지 표현(성취기준 코드, 성취도 기호, 점수, 학번, '-다' · 존댓말, 학생 이름) · 다른 학생과 비슷한 글(같은 문장이 있거나 절반 이상 겹침)을 봅니다. 고쳐 쓰기는 '학생별 보기'의 세특 초안 칸에서 합니다.`),
    h('table', { class: 'table' }, h('tbody', {}, rows.map(({ s, row, text }) => {
      const b = byteLen(text);
      const issues = text ? lintText(text, { names }) : [];
      const sim = [...(similar.get(s.id) || [])].map((id) => `${byId.get(id)?.number}번`);
      return h('tr', {},
        h('td', { class: 'nowrap small' }, `${studentCode(s)} ${s.number}. ${s.name}`),
        h('td', { class: 'small' }, text ? text.slice(0, 80) + (text.length > 80 ? '…' : '') : h('span', { class: 'muted' }, '(없음)')),
        h('td', { class: `nowrap small ${b > st.bytes ? 'warn-text' : 'muted'}` }, text ? `${b}B` : ''),
        h('td', { class: 'small' },
          issues.map((x) => h('span', { class: 'badge badge-warn' }, x)),
          sim.length ? h('span', { class: 'badge badge-warn' }, `비슷함: ${sim.join(', ')}`) : null,
          row?.polished ? h('span', { class: 'badge' }, '다듬음') : row?.edited ? h('span', { class: 'badge' }, '고쳐 씀') : null));
    }))));
}

// ---- 공용: 프롬프트 묶음 · 결과 붙여넣기 칸 ----
function promptBlocks(rows, make) {
  const chunk = aiSettings().chunk || rows.length || 1;
  const out = [];
  for (let k = 0; k < rows.length; k += chunk) {
    const part = rows.slice(k, k + chunk);
    const text = make(part);
    out.push(h('div', { class: 'prompt-block' },
      h('div', { class: 'row' },
        h('strong', { class: 'small' }, `${part[0].s.number}번 ~ ${part[part.length - 1].s.number}번 · ${part.length}명`),
        h('span', { class: 'grow' }),
        h('button', { class: 'btn btn-sm btn-primary', onClick: (e) => copy(text, e.currentTarget) }, '복사')),
      h('details', {}, h('summary', { class: 'small muted' }, '프롬프트 보기'), h('pre', { class: 'prompt-pre' }, text))));
  }
  return out;
}

function pasteBox(key, students, apply) {
  const preview = h('div', { class: 'small' });
  const area = h('textarea', { rows: 5, placeholder: 'AI가 준 결과를 통째로 붙여넣으세요. (10112|문장 … 한 줄에 한 명)', value: pastes.get(key) || '' });
  const draw = () => {
    const r = parseResult(area.value, students);
    preview.replaceChildren(...(area.value.trim() ? [
      h('span', {}, `읽은 학생 ${r.got.size}명`),
      r.unread.length ? h('span', { class: 'warn-text' }, ` · 못 읽은 줄 ${r.unread.length}개`) : null,
      r.unknown.length ? h('span', { class: 'warn-text' }, ` · 대상이 아닌 학번 ${r.unknown.join(', ')}`) : null,
    ] : []));
    return r;
  };
  area.addEventListener('input', () => { pastes.set(key, area.value); draw(); });
  draw();
  const go = async () => {
    const r = draw();
    if (!r.got.size) return toast('읽은 학생이 없습니다. "학번|문장" 형식인지 확인하세요.', 'error');
    try {
      await apply(r.got);
      pastes.delete(key);
      toast(`${r.got.size}명의 글을 넣었습니다.`, 'ok');
    } catch (err) { showError(err); }
  };
  return h('div', {}, area, h('div', { class: 'row', style: { marginTop: '6px' } }, preview, h('span', { class: 'grow' }), h('button', { class: 'btn btn-primary', onClick: go }, '넣기')));
}

const chip = (ok, text) => h('span', { class: `badge ${ok ? 'badge-ok' : 'badge-warn'}` }, text);

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
  btn.textContent = ok ? '복사됨' : '직접 선택해 주세요';
  setTimeout(() => { btn.textContent = '복사'; }, 1600);
}
