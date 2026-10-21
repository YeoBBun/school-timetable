// 과세특 AI 초안 화면 (반 화면 → 과세특 → '🤖 AI로 반 전체 초안')
// 항목마다: 프롬프트 복사 → AI(클로드 · 제미나이 · 챗지피티)에 붙여넣기 → 결과를 통째로 붙여넣기 → 검사(바이트 · 빠진 학생 · 못 읽은 줄 · 첫 두 어절 겹침)
// 항목 문장은 seteuk.parts 에 두고 차례대로 이어 초안(seteuk.text)을 만든다. 선생님이 초안을 고친 학생은 덮어쓰지 않는다
import { h, append, toast, showError, confirmDialog } from '../ui.js';
import * as S from '../store.js';
import { normCode, standardText } from '../standards.js';
import { aiSettings, itemsOf, sharesOf, linesOf, promptText, parseResult, overlaps, saveParts, assemble, byteLen, studentCode, WEIGHTS } from '../seteukAI.js';

const openItems = new Set(); // 펼쳐 둔 항목 (다시 그려도 유지)
const pastes = new Map(); // 항목 key → 붙여넣는 중인 글
const AI_LINKS = [['클로드 열기', 'https://claude.ai/new'], ['제미나이 열기', 'https://gemini.google.com/app'], ['챗지피티 열기', 'https://chatgpt.com/']];

export function renderSeteukAI(root, cls, back) {
  const students = S.studentsOf(cls);
  const st = aiSettings();
  const term = { year: S.classYear(cls), semester: S.viewTerm().semester };
  const rowOf = (s) => S.seteukOf(s.id, term, cls.subject);
  const items = itemsOf(cls, term);
  const shares = sharesOf(items, st);
  const saveSt = (patch) => S.upsert('settings', { seteuk_ai: { ...S.settings().seteuk_ai, ...patch } }, 'user_id').catch(showError);
  const num = (key, min, max, step) => h('input', { type: 'number', min, max, step, value: st[key], style: { width: '90px' }, onChange: (e) => saveSt({ [key]: Math.max(min, Number(e.target.value) || 0) }) });

  append(root,
    h('div', { class: 'row', style: { marginBottom: '12px' } },
      h('button', { class: 'btn', onClick: back }, '← 학생별 보기'),
      h('strong', {}, `${term.year}학년도 ${term.semester}학기 ${cls.subject} 과세특 · AI 초안`),
      h('span', { class: 'grow' }),
      AI_LINKS.map(([label, href]) => h('a', { class: 'btn btn-sm', href, target: '_blank', rel: 'noopener' }, label))),
    h('div', { class: 'card' },
      h('div', { class: 'row ai-settings' },
        h('label', {}, '세특 칸 전체(바이트)', num('bytes', 300, 9000, 50)),
        h('label', {}, '직접 쓸 몫(바이트)', num('reserve', 0, 6000, 50)),
        h('label', {}, '한 번에 몇 명씩', h('select', { value: String(st.chunk), onChange: (e) => saveSt({ chunk: Number(e.target.value) }) },
          [10, 25, 0].map((n) => h('option', { value: String(n) }, n ? `${n}명` : '전체')))),
        h('label', { class: 'inline' }, h('input', { type: 'checkbox', checked: st.growth, onChange: (e) => saveSt({ growth: e.target.checked }) }), '종합 · 성장 문장도')),
      h('p', { class: 'muted small', style: { margin: '8px 0 0' } },
        `항목 ${items.length}개 · 길이 몫은 수행평가 ${WEIGHTS.assess} : 종합 ${WEIGHTS.growth} : 정기시험 ${WEIGHTS.exam} 비율로 나눕니다(항목마다 제목 옆에 표시). 한글 1자 3바이트, 띄어쓰기 · 문장부호 1바이트로 셉니다. 다른 학기는 왼쪽 위 학기 고르기에서 바꿉니다. `,
        '한꺼번에 많이 시킬수록 AI가 첫머리를 비슷하게 쓰거나 대충 쓰기 쉬워서, 결과가 마음에 안 들면 묶음을 줄여 보세요. ',
        'AI에게는 학번 · 성취도 · 관찰 메모만 갑니다(이름은 보내지 않고, 메모 속 학생 이름은 ○○로 가립니다).')),
    items.length
      ? items.map((it, i) => itemCard(cls, term, students, it, i, shares.get(it.key), rowOf))
      : h('div', { class: 'empty' }, "이 학기에 수행평가나 정기시험이 없습니다. 수행평가 메뉴에서 평가계획서를 올리거나 '평가계획 고치기'에서 정기시험 성취기준을 넣으세요."),
    items.length ? finishCard(cls, term, students, st, rowOf) : null);
}

function itemCard(cls, term, students, it, i, share, rowOf) {
  const { lines, missing } = linesOf(it, cls, students);
  const saved = new Map(students.map((s) => [s.id, rowOf(s)?.parts?.[it.key] || '']).filter(([, t]) => t));
  const typeLabel = { exam: '정기시험', assess: '수행평가', growth: '종합' }[it.type];
  const missingCodes = it.standards.map(normCode).filter((c) => !standardText(c));

  // 프롬프트: 몇 명씩 끊어서
  const chunk = aiSettings().chunk || lines.length || 1;
  const blocks = [];
  for (let k = 0; k < lines.length; k += chunk) {
    const part = lines.slice(k, k + chunk);
    const text = promptText(it, cls, part, share);
    blocks.push(h('div', { class: 'prompt-block' },
      h('div', { class: 'row' },
        h('strong', { class: 'small' }, `${part[0].s.number}번 ~ ${part[part.length - 1].s.number}번 · ${part.length}명`),
        h('span', { class: 'grow' }),
        h('button', { class: 'btn btn-sm btn-primary', onClick: (e) => copy(text, e.currentTarget) }, '복사')),
      h('details', {}, h('summary', { class: 'small muted' }, '프롬프트 보기'), h('pre', { class: 'prompt-pre' }, text))));
  }

  // 붙여넣기
  const preview = h('div', { class: 'small' });
  const area = h('textarea', { rows: 5, placeholder: 'AI가 준 결과를 통째로 붙여넣으세요. (10112|문장 … 한 줄에 한 명)', value: pastes.get(it.key) || '' });
  const drawPreview = () => {
    const r = parseResult(area.value, students);
    preview.replaceChildren(...(area.value.trim() ? [
      h('span', {}, `읽은 학생 ${r.got.size}명`),
      r.unread.length ? h('span', { class: 'warn-text' }, ` · 못 읽은 줄 ${r.unread.length}개`) : null,
      r.unknown.length ? h('span', { class: 'warn-text' }, ` · 이 반에 없는 학번 ${r.unknown.join(', ')}`) : null,
    ] : []));
    return r;
  };
  area.addEventListener('input', () => { pastes.set(it.key, area.value); drawPreview(); });
  drawPreview();
  const apply = async () => {
    const r = drawPreview();
    if (!r.got.size) return toast('읽은 학생이 없습니다. "학번|문장" 형식인지 확인하세요.', 'error');
    try {
      await saveParts(cls, term, it, [...r.got]);
      pastes.delete(it.key);
      toast(`${r.got.size}명의 문장을 넣었습니다.`, 'ok');
    } catch (err) { showError(err); }
  };

  // 검사: 넣은 문장 기준
  const over = [...saved].filter(([, t]) => byteLen(t) > share).length;
  const empty = lines.filter((l) => !saved.has(l.s.id)).length;
  const dup = overlaps(saved);
  const checks = saved.size ? h('div', { class: 'row ai-checks small' },
    chip(over ? 'warn' : 'ok', over ? `바이트 넘침 ${over}명` : '바이트 OK'),
    chip(empty ? 'warn' : 'ok', empty ? `빠진 학생 ${empty}명` : '빠진 학생 없음'),
    chip(dup.words.length ? 'warn' : 'ok', dup.words.length ? `첫머리 겹침 ${dup.words.join(', ')}` : '첫머리 겹침 없음')) : null;

  const table = saved.size || lines.length ? h('table', { class: 'table ai-table' },
    h('tbody', {}, students.filter((s) => saved.has(s.id) || lines.some((l) => l.s === s)).map((s) => {
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
  return h('details', {
    class: 'card ai-item', open: openItems.has(it.key),
    onToggle: (e) => { if (e.currentTarget.open) openItems.add(it.key); else openItems.delete(it.key); },
  },
  h('summary', {},
    h('strong', {}, `${i + 1}. ${it.title}`),
    h('span', { class: 'badge' }, typeLabel), it.semester ? h('span', { class: 'muted small' }, ` ${it.semester}학기`) : null,
    it.standards.length ? h('span', { class: 'muted small' }, ` ${it.standards.join(' ')}`) : null,
    h('span', { class: 'muted small' }, ` · ${share}바이트(약 ${Math.floor(share / 3)}자)`),
    h('span', { class: `badge ${done && done === lines.length ? 'badge-ok' : ''}`, style: { marginLeft: '8px' } }, lines.length ? `${done}/${lines.length}명` : '넣을 학생 없음')),
  missingCodes.length ? h('p', { class: 'warn-text small' }, `원문이 없는 성취기준: ${missingCodes.join(' ')}`) : null,
  missing.length ? h('p', { class: 'muted small' }, `${it.type === 'growth' ? '기록이' : '결과 · 관찰이'} 없어 빠지는 학생 ${missing.length}명: ${missing.map((s) => `${s.number}번`).join(', ')}`) : null,
  lines.length ? [
    h('div', { class: 'section-title' }, '① 프롬프트 복사 → AI에 붙여넣기'),
    blocks,
    h('div', { class: 'section-title' }, '② AI 결과 붙여넣기'),
    area,
    h('div', { class: 'row', style: { marginTop: '6px' } }, preview, h('span', { class: 'grow' }), h('button', { class: 'btn btn-primary', onClick: apply }, '넣기')),
    h('div', { class: 'section-title' }, '③ 검사 · 고치기'),
    checks || h('p', { class: 'muted small' }, '아직 넣은 문장이 없습니다.'),
    table,
  ] : h('p', { class: 'muted small' }, it.type === 'assess' ? '이 평가에 입력한 결과가 없습니다. 수행평가 화면에서 등급 · 관찰 메모를 먼저 넣으세요.' : '넣을 기록이 없습니다.'));
}

// 자유학기는 모든 학생, 일반 학기는 학급마다 20% 이상 (자유학기 여부는 학년마다 체크)
export function requirementBadge(cls, term, students, rowOf) {
  const free = S.isFreeTerm(term, cls.grade);
  const need = S.seteukRequired(term, cls.grade, students.length);
  const written = students.filter((s) => (rowOf(s)?.text || '').trim()).length;
  return h('span', { class: 'row', style: { gap: '6px' } },
    h('label', { class: 'inline small', title: '자유학기면 모든 학생, 일반 학기면 학급 학생의 20% 이상을 씁니다' },
      h('input', { type: 'checkbox', checked: free, onChange: (e) => S.setFreeTerm(term, cls.grade, e.target.checked).catch(showError) }), `${cls.grade}학년 ${term.semester}학기는 자유학기`),
    h('span', { class: `badge ${written >= need ? 'badge-ok' : 'badge-warn'}` }, `작성 ${written}/${students.length}명 · ${free ? '전원' : `20% 이상 = ${need}명`} 필요`));
}

const chip = (kind, text) => h('span', { class: `badge ${kind === 'ok' ? 'badge-ok' : 'badge-warn'}` }, text);

// 마무리: 학생마다 이어 붙인 초안 상태, 써야 할 인원(자유학기 전원 · 일반 학기 20% 이상), 고친 것 되돌리기
function finishCard(cls, term, students, st, rowOf) {
  const rows = students.map((s) => ({ s, row: rowOf(s) }));
  const edited = rows.filter((r) => r.row?.edited && r.row?.parts && Object.keys(r.row.parts).length);
  const reset = async (list) => {
    for (const { s, row } of list) await S.saveSeteuk(s.id, term, cls.subject, { text: assemble(cls, term, row.parts), edited: false });
  };
  return h('div', { class: 'card' },
    h('div', { class: 'row' },
      h('h3', { style: { margin: 0 } }, '마무리 · 이어 붙인 초안'),
      requirementBadge(cls, term, students, rowOf),
      h('span', { class: 'grow' }),
      h('button', {
        class: 'btn btn-sm',
        onClick: async () => {
          if (!edited.length) return toast('되돌릴 것이 없습니다. 아직 고쳐 쓴 초안이 없어서 항목 문장 그대로입니다.');
          if (!await confirmDialog(`고쳐 쓴 ${edited.length}명의 초안을 버리고 항목 문장을 이어 붙인 글로 되돌릴까요?`, { okLabel: '되돌리기' })) return;
          await reset(edited).catch(showError);
          toast(`${edited.length}명의 초안을 되돌렸습니다.`, 'ok');
        },
      }, `고친 것 되돌리기${edited.length ? ` (${edited.length}명)` : ''}`)),
    h('p', { class: 'muted small' }, `항목 문장이 차례대로 이어져 초안이 됩니다. 고쳐 쓰기는 '학생별 보기'의 세특 초안 칸에서 합니다(고친 학생은 AI 문장을 다시 넣어도 덮어쓰지 않습니다). 전체 한도 ${st.bytes}바이트.`),
    h('table', { class: 'table' }, h('tbody', {}, rows.map(({ s, row }) => {
      const t = row?.text || '';
      const b = byteLen(t);
      return h('tr', {},
        h('td', { class: 'nowrap small' }, `${studentCode(s)} ${s.number}. ${s.name}`),
        h('td', { class: 'small' }, t ? t.slice(0, 90) + (t.length > 90 ? '…' : '') : h('span', { class: 'muted' }, '(없음)')),
        h('td', { class: `nowrap small ${b > st.bytes ? 'warn-text' : 'muted'}` }, t ? `${b}B` : ''),
        h('td', { class: 'nowrap small' }, row?.edited ? h('span', { class: 'badge' }, '고쳐 씀') : ''));
    }))));
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
  btn.textContent = ok ? '복사됨' : '직접 선택해 주세요';
  setTimeout(() => { btn.textContent = '복사'; }, 1600);
}

