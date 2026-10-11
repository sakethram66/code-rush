import { api } from '../api.js';
import { el, clear, toast, statusBadge, fmtDuration, fmtDateTime } from '../util.js';

export async function renderAdminBatches(root) {
  clear(root);
  root.appendChild(el('div', { class: 'panel-head' }, [el('h1', {}, 'Batches')]));
  root.appendChild(el('p', {}, 'Each batch is a fixed set of exactly 5 Easy, 10 Medium and 10 Hard questions that you select by hand. Once a batch starts, its question set is locked and every assigned team sees the same 25 questions in the same order.'));

  const createBox = el('div', { class: 'panel' });
  const nameInput = el('input', { type: 'text', placeholder: 'e.g. Morning Round' });
  const durationInput = el('input', { type: 'number', value: 25, min: 1, max: 600 });
  createBox.appendChild(el('div', { class: 'panel-head' }, [el('h3', {}, 'Create a new batch')]));
  createBox.appendChild(el('form', {
    class: 'row', style: 'align-items:end',
    onsubmit: async (e) => {
      e.preventDefault();
      try {
        const r = await api.post('/api/admin/batches', { name: nameInput.value.trim(), duration_minutes: Number(durationInput.value) });
        toast(`Batch #${r.batch.number} created.`, 'success');
        location.hash = `#/admin/batches/${r.id}`;
      } catch (err) { toast(err.message, 'error'); }
    },
  }, [
    el('div', { class: 'field', style: 'flex:2' }, [el('label', {}, 'Name (optional)'), nameInput]),
    el('div', { class: 'field', style: 'flex:1' }, [el('label', {}, 'Duration (minutes)'), durationInput]),
    el('button', { class: 'btn btn-primary', type: 'submit', style: 'margin-bottom:16px' }, '+ Create batch'),
  ]));
  root.appendChild(createBox);

  const listBox = el('div', { class: 'panel' });
  root.appendChild(listBox);

  const data = await api.get('/api/admin/batches');
  clear(listBox);
  if (!data.batches.length) { listBox.appendChild(el('div', { class: 'empty' }, 'No batches yet.')); return; }

  const wrap = el('div', { class: 'table-wrap' });
  const table = el('table');
  table.appendChild(el('thead', {}, [el('tr', {}, [
    el('th', {}, '#'), el('th', {}, 'Name'), el('th', {}, 'Status'), el('th', {}, 'Question set'),
    el('th', {}, 'Teams'), el('th', {}, 'Duration'), el('th', {}, 'Started'), el('th', {}, ''),
  ])]));
  const tbody = el('tbody');
  data.batches.forEach((b) => {
    tbody.appendChild(el('tr', {}, [
      el('td', { class: 'mono' }, `#${b.number}`),
      el('td', {}, b.name || el('span', { class: 'muted' }, '—')),
      el('td', {}, statusBadge(b.status)),
      el('td', { class: 'mono' }, `${b.selection.easy}/${b.selection.medium}/${b.selection.hard}` + (b.selection.valid ? '' : ' (incomplete)')),
      el('td', { class: 'mono' }, String(b.team_count)),
      el('td', { class: 'mono' }, `${b.duration_minutes}m`),
      el('td', { class: 'muted' }, fmtDateTime(b.started_at)),
      el('td', { style: 'text-align:right' }, el('a', { href: `#/admin/batches/${b.id}`, class: 'btn btn-sm' }, b.status === 'draft' ? 'Configure' : 'View')),
    ]));
  });
  table.appendChild(tbody);
  wrap.appendChild(table);
  listBox.appendChild(wrap);
}
