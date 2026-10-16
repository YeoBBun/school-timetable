// 공통 UI 도우미: DOM 생성, 토스트, 모달, 날짜 포맷

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  let value;
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') {
      for (const [p, pv] of Object.entries(v)) {
        if (p.startsWith('--')) el.style.setProperty(p, pv);
        else el.style[p] = pv;
      }
    }
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value') value = v;
    else if (k === 'checked' || k === 'selected' || k === 'disabled' || k === 'multiple') el[k] = !!v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  appendChildren(el, children);
  if (value !== undefined) el.value = value;
  return el;
}

export function append(el, ...children) {
  appendChildren(el, children);
  return el;
}

function appendChildren(el, children) {
  for (const c of children) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) appendChildren(el, c);
    else el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function toast(message, type = 'info') {
  let box = document.getElementById('toasts');
  if (!box) {
    box = h('div', { id: 'toasts' });
    document.body.append(box);
  }
  const t = h('div', { class: `toast toast-${type}` }, message);
  box.append(t);
  setTimeout(() => t.classList.add('hide'), type === 'error' ? 5000 : 2500);
  setTimeout(() => t.remove(), type === 'error' ? 5400 : 2900);
  return t;
}

export function showError(err) {
  console.error(err);
  toast(err?.message || String(err), 'error');
}

// 모달 열기. actions: [{label, primary, danger, onClick(close) -> false 반환 시 닫지 않음}]
export function modal(title, body, actions = [], { wide = false } = {}) {
  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const footer = h('div', { class: 'modal-footer' },
    actions.map((a) => h('button', {
      class: `btn ${a.primary ? 'btn-primary' : ''} ${a.danger ? 'btn-danger' : ''}`,
      onClick: async (e) => {
        const btn = e.currentTarget;
        btn.disabled = true;
        try {
          const r = await a.onClick?.(close);
          if (r !== false) close();
        } catch (err) {
          showError(err);
        } finally {
          btn.disabled = false;
        }
      },
    }, a.label)));
  const overlay = h('div', { class: 'modal-overlay', onMousedown: (e) => { if (e.target === overlay) close(); } },
    h('div', { class: `modal ${wide ? 'modal-wide' : ''}` },
      h('div', { class: 'modal-header' }, h('h3', {}, title), h('button', { class: 'icon-btn', onClick: close, title: '닫기' }, '✕')),
      h('div', { class: 'modal-body' }, body),
      actions.length ? footer : null));
  document.body.append(overlay);
  document.addEventListener('keydown', onKey);
  overlay.querySelector('input, textarea, select')?.focus();
  return { close, overlay };
}

export function confirmDialog(message, { okLabel = '삭제', danger = true } = {}) {
  return new Promise((resolve) => {
    let answered = false;
    const m = modal('확인', h('p', { class: 'pre' }, message), [
      { label: '취소', onClick: () => { answered = true; resolve(false); } },
      { label: okLabel, primary: !danger, danger, onClick: () => { answered = true; resolve(true); } },
    ]);
    const observer = new MutationObserver(() => {
      if (!m.overlay.isConnected) { observer.disconnect(); if (!answered) resolve(false); }
    });
    observer.observe(document.body, { childList: true });
  });
}

// 날짜: 모두 로컬 기준 'YYYY-MM-DD' 문자열로 다룸
const pad = (n) => String(n).padStart(2, '0');
export const toDateStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const todayStr = () => toDateStr(new Date());
export const parseDate = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
export const addDays = (s, n) => { const d = parseDate(s); d.setDate(d.getDate() + n); return toDateStr(d); };
// 1=월 ... 7=일
export const weekdayOf = (s) => ((parseDate(s).getDay() + 6) % 7) + 1;
export const WEEKDAYS = ['', '월', '화', '수', '목', '금', '토', '일'];
export const fmtMD = (s) => { const d = parseDate(s); return `${d.getMonth() + 1}/${d.getDate()}`; };
export const fmtDateLong = (s) => { const d = parseDate(s); return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEKDAYS[weekdayOf(s)]})`; };
export const mondayOf = (s) => addDays(s, 1 - weekdayOf(s));

export function fmtSize(bytes) {
  if (bytes == null) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

export const PALETTE = ['#4f7cff', '#f2994a', '#27ae60', '#eb5757', '#9b51e0', '#2d9cdb', '#d4a72c', '#16a085', '#e84393', '#636e72'];

export function classChip(cls) {
  if (!cls) return h('span', { class: 'chip' }, '(삭제된 반)');
  return h('span', { class: 'chip', style: { background: cls.color + '22', color: cls.color, borderColor: cls.color + '55' } },
    h('span', { class: 'dot', style: { background: cls.color } }), cls.name);
}

export function downloadText(filename, text, mime = 'text/plain') {
  const blob = new Blob([text], { type: mime });
  const a = h('a', { href: URL.createObjectURL(blob), download: filename });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
}
