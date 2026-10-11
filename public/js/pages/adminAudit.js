import { api } from '../api.js';
import { el, clear, fmtDateTime } from '../util.js';

export async function renderAdminAudit(root) {
  clear(root);
  root.appendChild(el('div', { class: 'panel-head' }, [el('h1', {}, 'Audit Log')]));
  root.appendChild(el('p', {}, 'Every login, question change, batch start and team change is recorded here for accountability.'));

  const listBox = el('div', { class: 'panel' });
  root.appendChild(listBox);
  const data = await api.get('/api/admin/audit?limit=300');
  clear(listBox);
  if (!data.entries.length) { listBox.appendChild(el('div', { class: 'empty' }, 'No activity recorded yet.')); return; }

  const wrap = el('div', { class: 'table-wrap' });
  const table = el('table');
  table.appendChild(el('thead', {}, [el('tr', {}, [el('th', {}, 'When'), el('th', {}, 'Actor'), el('th', {}, 'Action'), el('th', {}, 'Details')])]));
  const tbody = el('tbody');
  data.entries.forEach((e) => {
    tbody.appendChild(el('tr', {}, [
      el('td', { class: 'muted mono', style: 'white-space:nowrap' }, fmtDateTime(e.ts)),
      el('td', {}, `${e.actor_name || e.actor_type} (${e.actor_type})`),
      el('td', { class: 'mono' }, e.action),
      el('td', { class: 'muted', style: 'font-size:12.5px;max-width:420px' }, e.details ? JSON.stringify(e.details) : ''),
    ]));
  });
  table.appendChild(tbody); wrap.appendChild(table); listBox.appendChild(wrap);
}
