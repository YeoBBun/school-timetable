// 구글 시트 채점표: 평가 하나를 반별 시트로 만들어(목록 고르기 · 자동 점수 · 평균) 드라이브에 올리고, 채점한 시트를 다시 읽어 앱에 넣을 내용을 만든다
import * as S from './store.js';
import { KINDS, GRADES, rubricResult, maxScore } from './evalplan.js';
import * as G from './backend.js';
import { loadXLSX, workbookBlob } from './xlsx.js';

const MARKS = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮';
const OK = /^(o|ㅇ|○|◯|v|✓|✔|1|true)$/i; // 요소 개수형에서 '만족' 으로 보는 값
const HEAD_ROW = 3; // 제목 줄(1부터 셈)
const short = (t, n = 14) => { const s = String(t || '').replace(/\s+/g, ' ').trim(); return s.length > n ? `${s.slice(0, n)}…` : s; };
const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const q = (t) => `"${String(t).replace(/"/g, '""')}"`; // 수식 안 글자
const listOf = (vals) => `"${vals.map((v) => String(v).replace(/[",]/g, ' ')).join(',')}"`;

export const hasResult = (row) => !!row && (row.score != null || !!row.grade || !!row.special || !!row.note || Object.keys(row.checks || {}).length > 0);

// 평가 종류에 따른 칸 구성
function columnsOf(a) {
  const rb = a.rubric || {};
  const kind = a.kind || 'plain';
  const cols = [{ key: 'number', head: '번호', wch: 5 }, { key: 'name', head: '이름', wch: 10 }];
  const specials = (rb.specials || []).map((x) => x.label);
  if (kind === 'plain') cols.push({ key: 'score', head: `점수 (${a.max_score}점 만점)`, wch: 12, input: true });
  if (kind === 'count') {
    (rb.elements || []).forEach((el, k) => cols.push({ key: `c${k}`, k, head: `${MARKS[k] || k + 1} ${short(el)}`, full: el, wch: 10, input: true, list: ['O'] }));
  }
  if (kind === 'criteria' || kind === 'grade') {
    (rb.criteria || []).forEach((c, k) => cols.push({ key: `c${k}`, k, head: `${MARKS[k] || k + 1} ${short(c.text)} (${[...c.levels].sort((x, y) => y - x).join('/')})`, full: c.text, wch: 14, input: true, list: [...c.levels].sort((x, y) => y - x) }));
  }
  if ((kind === 'count' || kind === 'criteria') && specials.length) cols.push({ key: 'special', head: '특수 (결시 등)', wch: 12, input: true, list: specials });
  if (kind === 'count' || kind === 'criteria') cols.push({ key: 'auto', head: `점수 (자동, ${maxScore(a)}점 만점)`, wch: 12 });
  if (kind === 'grade') {
    if ((rb.criteria || []).length) {
      cols.push({ key: 'sum', head: '합계 (자동)', wch: 9 });
      cols.push({ key: 'grade', head: '등급 (직접)', wch: 9, input: true, list: GRADES });
      cols.push({ key: 'final', head: '등급 (최종)', wch: 9 });
    } else cols.push({ key: 'grade', head: '등급', wch: 7, input: true, list: GRADES });
  }
  cols.push({ key: 'note', head: '관찰 메모', wch: 50, input: true });
  return cols;
}

// 한 줄(엑셀 r 번째 줄)의 자동 계산 수식
function formulaOf(a, col, cols, r, X) {
  const rb = a.rubric || {};
  const at = (key) => `${X.utils.encode_col(cols.findIndex((c) => c.key === key))}${r}`;
  const crit = cols.filter((c) => c.k != null);
  const range = crit.length ? `${X.utils.encode_col(cols.indexOf(crit[0]))}${r}:${X.utils.encode_col(cols.indexOf(crit[crit.length - 1]))}${r}` : '';
  const hasSp = cols.some((c) => c.key === 'special');
  const specialIf = (rest) => (hasSp ? (rb.specials || []).reduceRight((acc, x) => `IF(${at('special')}=${q(x.label)},${x.score},${acc})`, `IF(${at('special')}<>"","",${rest})`) : rest);
  if (col.key === 'auto' && a.kind === 'count') {
    const map = [...(rb.map || [])].sort((x, y) => y.n - x.n);
    const n = `COUNTIF(${range},"O")`;
    const pick = map.length ? map.slice(0, -1).reduceRight((acc, m) => `IF(${n}>=${m.n},${m.score},${acc})`, String(map[map.length - 1].score)) : n;
    return specialIf(range ? `IF(COUNTA(${range})=0,"",${pick})` : '""');
  }
  if (col.key === 'auto') return specialIf(range ? `IF(COUNT(${range})=0,"",SUM(${range}))` : '""');
  if (col.key === 'sum') return `IF(COUNT(${range})=0,"",SUM(${range}))`;
  if (col.key === 'final') {
    const s = at('sum');
    const gs = (rb.grades || []).filter((g) => g.min != null && g.max != null);
    const pick = gs.reduceRight((acc, g) => `IF(AND(${s}>=${g.min},${s}<=${g.max}),${q(g.grade)},${acc})`, '""');
    return `IF(${at('grade')}<>"",${at('grade')},IF(${s}="","",${pick}))`;
  }
  return null;
}

// 첫 시트: 채점 기준 (칸 제목은 줄여 쓰므로 원문을 여기 모아 둔다)
function guideSheet(a) {
  const rb = a.rubric || {};
  const rows = [[a.title], [[S.termLabel(a), a.subject, `${a.grade}학년`, KINDS[a.kind || 'plain'], a.period].filter(Boolean).join(' · ')], []];
  if ((a.standards || []).length) rows.push(['성취기준', a.standards.join(', ')], []);
  if (a.kind === 'count') {
    rows.push(['평가 요소']);
    (rb.elements || []).forEach((el, k) => rows.push([MARKS[k] || k + 1, el]));
    rows.push([], ['만족한 요소 수', '점수']);
    (rb.map || []).forEach((m) => rows.push([`${m.label} (${m.n}개 이상)`, m.score]));
  }
  if (a.kind === 'criteria' || a.kind === 'grade') {
    if ((rb.criteria || []).length) rows.push(['채점 기준', '', '수준별 점수']);
    (rb.criteria || []).forEach((c, k) => rows.push([MARKS[k] || k + 1, c.text, c.levels.join(' / ')]));
  }
  if ((rb.grades || []).length) {
    rows.push([], ['등급', '합계 범위', '성취수준 기술']);
    rb.grades.forEach((g) => rows.push([g.grade, g.min != null ? `${g.min}~${g.max}` : '', g.desc]));
  }
  if ((rb.specials || []).length) {
    rows.push([], ['특수 경우', '점수']);
    rb.specials.forEach((x) => rows.push([x.label, x.score]));
  }
  rows.push([], ['쓰는 법'],
    ['1', '반 시트에서 기준 칸을 누르면 나오는 목록(▼)에서 고르세요. 요소 개수형은 만족하면 O 를 고릅니다.'],
    ['2', '점수 · 합계 · 최종 등급 칸은 자동으로 계산됩니다. 맨 아래에 평균 · 등급별 인원이 나옵니다.'],
    ['3', "다 채점하면 앱의 같은 평가 화면에서 '📥 시트에서 가져오기'를 누르세요. 가져오기 전에 바뀌는 내용을 먼저 보여 줍니다."],
    ['4', '빈칸은 앱에 있던 값을 그대로 둡니다. 앱에 넣은 값을 지우려면 앱에서 지우세요. 번호 · 이름 · 시트 이름은 고치지 마세요.']);
  return rows;
}

// 채점표 만들기: 첫 시트 '채점 기준' + 반마다 시트 → xlsx Blob (구글 시트로 바꿔 올린다)
async function buildGradebook(a, classes) {
  const X = await loadXLSX();
  const wb = X.utils.book_new();
  const g = X.utils.aoa_to_sheet(guideSheet(a));
  g['!cols'] = [{ wch: 14 }, { wch: 70 }, { wch: 14 }];
  X.utils.book_append_sheet(wb, g, '채점 기준');
  const cols = columnsOf(a);
  const valid = []; // 시트마다 넣을 목록 고르기 XML
  for (const cls of classes) {
    const students = S.studentsOf(cls);
    // 다시 올릴 때 어떤 평가 · 반인지 알아보는 표시 (맨 오른쪽 숨긴 칸)
    const tag = [`${a.title} · ${S.classLabel(cls)} · ${S.termLabel(a)}`];
    tag[cols.length] = `jindo:${a.id}:${cls.id}`;
    const rows = [
      tag,
      [`▼ 목록에서 고르세요. 빈칸은 앱의 값을 그대로 둡니다. 다 쓰면 앱에서 '📥 시트에서 가져오기'.`],
      cols.map((c) => c.head),
    ];
    students.forEach((st) => {
      const cur = S.scoreOf(a.id, st.id) || {};
      const ch = cur.checks || {};
      rows.push(cols.map((c) => {
        if (c.key === 'number') return st.number;
        if (c.key === 'name') return st.name;
        // 빈칸은 null (빈 글자 칸을 만들면 COUNTA 가 센다)
        if (c.key === 'score') return cur.score ?? null;
        if (c.k != null) return ch[c.k] == null ? null : a.kind === 'count' ? (ch[c.k] ? 'O' : null) : ch[c.k];
        if (c.key === 'special') return cur.special || null;
        if (c.key === 'grade') return cur.grade || null;
        if (c.key === 'note') return cur.note || null;
        return null;
      }));
    });
    const first = HEAD_ROW + 1;
    const last = HEAD_ROW + students.length;
    // 맨 아래 평균 · 등급별 인원
    const numCols = cols.filter((c) => c.list && typeof c.list[0] === 'number' || ['score', 'auto', 'sum'].includes(c.key));
    rows.push([]);
    const avgRow = rows.length + 1;
    rows.push(['평균']);
    const gradeCol = cols.find((c) => c.key === 'final') || cols.find((c) => c.key === 'grade');
    const distRow = rows.length + 1;
    if (a.kind === 'grade') GRADES.forEach((gr) => rows.push([`${gr} 등급`]));
    const ws = X.utils.aoa_to_sheet(rows);
    cols.forEach((c, i) => {
      const L = X.utils.encode_col(i);
      for (let r = first; r <= last; r++) {
        const f = formulaOf(a, c, cols, r, X);
        if (f) ws[`${L}${r}`] = { t: 'n', f };
      }
      if (students.length && numCols.includes(c)) ws[`${L}${avgRow}`] = { t: 'n', f: `IFERROR(ROUND(AVERAGE(${L}${first}:${L}${last}),1),"")` };
    });
    if (a.kind === 'grade' && students.length) {
      const L = X.utils.encode_col(cols.indexOf(gradeCol));
      GRADES.forEach((gr, j) => { ws[`B${distRow + j}`] = { t: 'n', f: `COUNTIF(${L}${first}:${L}${last},${q(gr)})` }; });
    }
    ws['!ref'] = X.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length - 1, c: cols.length } });
    ws['!cols'] = [...cols.map((c) => ({ wch: c.wch })), { hidden: true }];
    // 목록 고르기 · 숫자 범위 (칸을 누르면 기준 원문이 뜬다)
    valid.push(students.length ? cols.map((c, i) => {
      const sq = `${X.utils.encode_col(i)}${first}:${X.utils.encode_col(i)}${last}`;
      const tip = c.full ? ` showInputMessage="1" promptTitle="${esc(short(c.head.split(' ')[0] + ' 채점 기준', 30))}" prompt="${esc(String(c.full).slice(0, 250))}"` : '';
      if (c.list) return `<dataValidation type="list" allowBlank="1" showErrorMessage="1" errorTitle="목록에 없는 값" error="${esc(`목록(${c.list.join(', ')})에서 고르세요.`)}"${tip} sqref="${sq}"><formula1>${esc(listOf(c.list))}</formula1></dataValidation>`;
      if (c.key === 'score') return `<dataValidation type="decimal" operator="between" allowBlank="1" showErrorMessage="1" errorTitle="점수 범위" error="${esc(`0 ~ ${a.max_score} 사이 숫자를 넣으세요.`)}" sqref="${sq}"><formula1>0</formula1><formula2>${Number(a.max_score) || 100}</formula2></dataValidation>`;
      return '';
    }).filter(Boolean) : []);
    X.utils.book_append_sheet(wb, ws, uniqueName(wb, S.classLabel(cls)));
  }
  const freeze = `<sheetView workbookViewId="0"><pane xSplit="2" ySplit="${HEAD_ROW}" topLeftCell="C${HEAD_ROW + 1}" activePane="bottomRight" state="frozen"/></sheetView>`;
  return workbookBlob(X, wb, (i, xml) => {
    if (i === 0) return xml;
    const dv = valid[i - 1];
    let out = xml.replace('<sheetView workbookViewId="0"/>', freeze);
    if (dv.length) {
      const tag = `<dataValidations count="${dv.length}">${dv.join('')}</dataValidations>`;
      out = out.includes('</mergeCells>') ? out.replace('</mergeCells>', `</mergeCells>${tag}`) : out.replace('</sheetData>', `</sheetData>${tag}`);
    }
    return out;
  });
}

const fileTitle = (a, classes) => `${a.title}-${classes.length === 1 ? S.classLabel(classes[0]) : `${a.grade}학년 전체`}-채점표`.replace(/[\\/:*?"<>|]/g, ' ');

// ---- 구글 시트 채점표: 드라이브 수업관리/채점표/2026학년도 2학기/ 에 평가마다 하나 (assessments.sheet_id) ----
// 시트가 휴지통에 있거나 없어졌으면 null
export async function gradeSheetId(a) {
  if (!a.sheet_id) return null;
  try { return (await G.fileMeta(a.sheet_id)).trashed ? null : a.sheet_id; } catch (err) { if (err.status === 404) return null; throw err; }
}

// 시트를 (새로) 만든다. 예전 시트는 휴지통으로 (30일 동안 되살릴 수 있다)
export async function createGradeSheet(a, classes) {
  const root = S.drive.rootId || (await G.ensureFolders()).root;
  const folder = await G.ensureFolder(`${a.year}학년도 ${a.semester}학기`, await G.ensureFolder('채점표', root));
  const id = await G.createSheetFromXlsx(await buildGradebook(a, classes), fileTitle(a, classes), folder);
  if (a.sheet_id && a.sheet_id !== id) await G.trashFile(a.sheet_id);
  await S.update('assessments', a.id, { sheet_id: id });
  return id;
}

export async function readGradeSheet(a, classes, id) {
  return readGradebook(a, classes, await G.exportXlsx(id));
}

// ---- 로컬 폴더 방식: 같은 채점표를 엑셀 파일로 폴더의 수업관리/채점표/2026학년도 2학기/ 에 (assessments.xlsx_id = 경로) ----
// 내려받기 · 올리기 대신 늘 같은 자리의 파일을 엑셀로 고치고, 앱이 그 파일을 읽어 온다
export async function gradeFileId(a) {
  if (!a.xlsx_id) return null;
  try { await G.fileMeta(a.xlsx_id); return a.xlsx_id; } catch (err) { if (err.status === 404) return null; throw err; }
}
export async function createGradeFile(a, classes) {
  const root = S.drive.rootId || (await G.ensureFolders()).root;
  const folder = await G.ensureFolder(`${a.year}학년도 ${a.semester}학기`, await G.ensureFolder('채점표', root));
  if (a.xlsx_id) await G.trashFile(a.xlsx_id); // 예전 파일은 수업관리/휴지통 으로
  const blob = await buildGradebook(a, classes);
  const up = await G.uploadFile(new File([blob], `${fileTitle(a, classes)}.xlsx`), folder);
  await S.update('assessments', a.id, { xlsx_id: up.id });
  return up.id;
}
export async function readGradeFile(a, classes, id) {
  return readGradebook(a, classes, await G.readBytes(id));
}
// 폴더 밖의 엑셀 파일을 골라 읽을 때
export async function readGradebookFile(a, classes, file) {
  return readGradebook(a, classes, await file.arrayBuffer());
}

function uniqueName(wb, base) {
  let name = base.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31);
  for (let n = 2; wb.SheetNames.includes(name); n++) name = `${base.slice(0, 27)} (${n})`;
  return name;
}

// ---- 구글 시트에서 받은 xlsx 읽기 → { changes: [{cls, st, cur, next, isNew}], same, errors, unknown, skipped, other } ----
async function readGradebook(a, classes, buf) {
  const X = await loadXLSX();
  const wb = X.read(buf, { type: 'array' });
  const kind = a.kind || 'plain';
  const rb = a.rubric || {};
  const out = { changes: [], same: 0, errors: [], unknown: [], skipped: [], sheets: 0 };
  for (const name of wb.SheetNames) {
    const rows = X.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: '' });
    const [, aid, cid] = String((rows[0] || []).find((v) => String(v).startsWith('jindo:')) || '').split(':');
    if (aid && aid !== a.id) {
      const other = S.data.assessments.find((x) => x.id === aid);
      throw new Error(`이 파일은 다른 평가${other ? `('${other.title}')` : ''}의 채점표입니다. 그 평가 화면에서 가져오세요.`);
    }
    const cls = classes.find((c) => c.id === cid) || classes.find((c) => S.classLabel(c) === name.trim());
    if (!cls) { if (name !== '채점 기준') out.skipped.push(name); continue; }
    const hr = rows.findIndex((r) => String(r[0]).trim() === '번호' && String(r[1]).trim() === '이름');
    if (hr < 0) { out.skipped.push(name); continue; }
    out.sheets++;
    // 칸 제목으로 칸을 찾는다
    const at = {};
    rows[hr].forEach((t, i) => {
      const s = String(t).trim();
      const m = MARKS.indexOf(s[0]);
      if (m >= 0) at[`c${m}`] = i;
      else if (s.startsWith('특수')) at.special = i;
      else if (s === '등급' || s.startsWith('등급 (직접)')) at.grade = i;
      else if (s.startsWith('점수') && !s.includes('자동')) at.score = i;
      else if (s.startsWith('관찰 메모')) at.note = i;
    });
    const students = S.studentsOf(cls);
    for (const r of rows.slice(hr + 1)) {
      const num = Number(r[0]);
      const nm = String(r[1] ?? '').trim();
      if (!num || !nm) continue; // 빈 줄 · 평균 줄
      const st = students.find((x) => Number(x.number) === num && x.name === nm);
      const where = `${S.classLabel(cls)} ${num}번`;
      if (!st) { out.unknown.push(`${where} ${nm}`); continue; }
      const cur = S.scoreOf(a.id, st.id) || {};
      const next = { checks: { ...(cur.checks || {}) }, special: cur.special || '', grade: cur.grade || '', note: cur.note || '', score: cur.score ?? null };
      const val = (key) => (at[key] == null ? '' : String(r[at[key]] ?? '').trim());
      const bad = (what, v) => out.errors.push(`${where} ${what}: '${v}'`);
      if (kind === 'plain' && val('score') !== '') {
        const v = Number(val('score'));
        if (Number.isNaN(v) || v < 0 || v > a.max_score) bad('점수', val('score')); else next.score = v;
      }
      if (kind === 'count') {
        const els = (rb.elements || []).map((_, k) => val(`c${k}`));
        // 요소 칸에 하나라도 적혀 있으면 그 줄의 요소를 새로 정한다 (O 를 지운 칸은 '못 함')
        if (els.some((v) => v !== '')) {
          els.forEach((v, k) => {
            if (v === '') delete next.checks[k];
            else if (OK.test(v)) next.checks[k] = true;
            else bad(MARKS[k], v);
          });
        }
      }
      if (kind === 'criteria' || kind === 'grade') {
        (rb.criteria || []).forEach((c, k) => {
          const v = val(`c${k}`);
          if (v === '') return;
          const n = Number(v);
          if (c.levels.includes(n)) next.checks[k] = n; else bad(`${MARKS[k]}(${c.levels.join('/')})`, v);
        });
      }
      const sp = val('special');
      if (sp) {
        const x = (rb.specials || []).find((y) => y.label === sp || sp.startsWith(`${y.label} `));
        if (x) next.special = x.label; else bad('특수', sp);
      }
      const gr = val('grade').toUpperCase();
      if (gr) { if (GRADES.includes(gr)) next.grade = gr; else bad('등급', val('grade')); }
      if (val('note')) next.note = val('note');
      if (kind !== 'plain') next.score = rubricResult(a, next).score;
      const sameRow = JSON.stringify(norm(cur)) === JSON.stringify(norm(next));
      if (sameRow || !hasResult(next)) { out.same++; continue; }
      out.changes.push({ cls, st, cur, next, isNew: !hasResult(cur) });
    }
  }
  return out;
}

const norm = (r) => ({
  checks: Object.fromEntries(Object.entries(r.checks || {}).sort(([x], [y]) => Number(x) - Number(y))),
  special: r.special || '', grade: r.grade || '', note: r.note || '', score: r.score ?? null,
});

// 바뀌는 내용을 한 줄로 (미리보기 창)
export function describeChange(a, { cur, next }) {
  const parts = [];
  const before = rubricResult(a, cur);
  const after = rubricResult(a, next);
  const diff = (label, b, v) => { if ((b ?? '') !== (v ?? '')) parts.push(b == null || b === '' ? `${label} ${v ?? '없음'}` : `${label} ${b} → ${v ?? '없음'}`); };
  if (a.kind === 'grade') diff('등급', before.grade, after.grade);
  diff(a.kind === 'grade' ? '합계' : '점수', before.score, after.score);
  if ((cur.special || '') !== next.special) parts.push(`특수 ${next.special || '없음'}`);
  if (!parts.length && JSON.stringify(norm(cur).checks) !== JSON.stringify(norm(next).checks)) parts.push('세부 기준');
  if ((cur.note || '') !== next.note) parts.push('관찰 메모');
  return parts.join(' · ') || '바뀜';
}
