export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k === 'value') node.value = v;
    else if (k === 'checked') node.checked = !!v;
    else if (k === 'disabled') node.disabled = !!v;
    else node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c === undefined || c === null || c === false) continue;
    node.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
  return node;
}

export function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function fmtDuration(ms) {
  if (ms == null || ms < 0) ms = 0;
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

export function fmtDateTime(ms) {
  if (!ms) return '—';
  const d = new Date(ms);
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function debounce(fn, wait) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), wait); };
}

let toastHost = null;
export function toast(message, kind = 'info', ms = 4000) {
  if (!toastHost) {
    toastHost = el('div', { class: 'toast-stack' });
    document.body.appendChild(toastHost);
  }
  const node = el('div', { class: `toast ${kind === 'error' ? 'error' : kind === 'success' ? 'success' : ''}` }, message);
  toastHost.appendChild(node);
  setTimeout(() => node.remove(), ms);
}

export function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

export function difficultyBadge(diff) {
  return el('span', { class: `badge badge-${diff}` }, diff[0].toUpperCase() + diff.slice(1));
}

export function statusBadge(status) {
  const map = {
    solved: ['badge-solved', 'Solved'], attempted: ['badge-attempted', 'Attempted'], unsolved: ['badge-unsolved', 'Not attempted'],
    draft: ['badge-draft', 'Draft'], running: ['badge-running', 'Running'], completed: ['badge-completed', 'Completed'],
  };
  const [cls, label] = map[status] || ['badge-draft', status];
  return el('span', { class: `badge ${cls}` }, label);
}

export const SUBMISSION_LABELS = {
  queued: 'Queued', judging: 'Judging…', accepted: 'Accepted', wrong_answer: 'Wrong answer',
  compile_error: 'Compile error', runtime_error: 'Runtime error', time_limit: 'Time limit exceeded',
  memory_limit: 'Memory limit exceeded', output_limit: 'Output limit exceeded', internal_error: 'Judge error',
};
