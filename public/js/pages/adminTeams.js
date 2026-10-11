import { api } from '../api.js';
import { el, clear, toast, statusBadge } from '../util.js';

export async function renderAdminTeams(root) {
  clear(root);
  root.appendChild(el('div', { class: 'panel-head' }, [el('h1', {}, 'Teams')]));

  const batches = (await api.get('/api/admin/batches')).batches;
  const draftBatches = batches.filter((b) => b.status === 'draft');

  // ---- create single team ----
  const nameInput = el('input', { type: 'text', placeholder: 'Team name' });
  const membersInput = el('input', { type: 'text', placeholder: 'Member names, comma separated' });
  const usernameInput = el('input', { type: 'text', placeholder: 'auto-generated if left blank' });
  const passwordInput = el('input', { type: 'text', placeholder: 'auto-generated if left blank' });
  const batchSelect = el('select', {}, [el('option', { value: '' }, 'Unassigned (assign later)'), ...draftBatches.map((b) => el('option', { value: b.id }, `#${b.number} ${b.name || ''}`.trim()))]);

  root.appendChild(el('div', { class: 'panel' }, [
    el('div', { class: 'panel-head' }, [el('h3', {}, 'Add a team')]),
    el('form', {
      onsubmit: async (e) => {
        e.preventDefault();
        try {
          const t = await api.post('/api/admin/teams', {
            name: nameInput.value.trim(), members: membersInput.value, username: usernameInput.value.trim() || undefined,
            password: passwordInput.value.trim() || undefined, batch_id: batchSelect.value || null,
          });
          toast(`Team "${t.name}" created. Username: ${t.username} · Password: ${t.password}`, 'success', 9000);
          nameInput.value = ''; membersInput.value = ''; usernameInput.value = ''; passwordInput.value = '';
          load();
        } catch (err) { toast(err.message, 'error'); }
      },
    }, [
      el('div', { class: 'row' }, [
        el('div', { class: 'field' }, [el('label', {}, 'Team name'), nameInput]),
        el('div', { class: 'field' }, [el('label', {}, 'Members'), membersInput]),
      ]),
      el('div', { class: 'row' }, [
        el('div', { class: 'field' }, [el('label', {}, 'Username (optional)'), usernameInput]),
        el('div', { class: 'field' }, [el('label', {}, 'Password (optional)'), passwordInput]),
        el('div', { class: 'field' }, [el('label', {}, 'Assign to batch'), batchSelect]),
      ]),
      el('button', { class: 'btn btn-primary', type: 'submit' }, '+ Add team'),
    ]),
  ]));

  // ---- bulk create ----
  const bulkText = el('textarea', { rows: 5, placeholder: 'Team A | Alice, Bob\nTeam B | Carol, Dan' });
  const bulkBatchSelect = el('select', {}, [el('option', { value: '' }, 'Unassigned (assign later)'), ...draftBatches.map((b) => el('option', { value: b.id }, `#${b.number} ${b.name || ''}`.trim()))]);
  root.appendChild(el('div', { class: 'panel' }, [
    el('div', { class: 'panel-head' }, [el('h3', {}, 'Bulk add teams')]),
    el('p', {}, 'One team per line: Team name | Member 1, Member 2. Usernames and passwords are generated automatically.'),
    el('form', {
      onsubmit: async (e) => {
        e.preventDefault();
        try {
          const r = await api.post('/api/admin/teams/bulk', { text: bulkText.value, batch_id: bulkBatchSelect.value || null });
          toast(`Created ${r.created.length} team(s)${r.errors.length ? `, ${r.errors.length} line(s) had errors` : ''}.`, r.errors.length ? 'error' : 'success', 7000);
          bulkText.value = '';
          load();
        } catch (err) { toast(err.message, 'error'); }
      },
    }, [
      el('div', { class: 'field' }, [el('label', {}, 'Teams'), bulkText]),
      el('div', { class: 'row', style: 'align-items:end' }, [
        el('div', { class: 'field' }, [el('label', {}, 'Assign all to batch'), bulkBatchSelect]),
        el('button', { class: 'btn', type: 'submit', style: 'margin-bottom:16px' }, 'Add teams'),
      ]),
    ]),
  ]));

  const listBox = el('div', { class: 'panel' });
  root.appendChild(listBox);

  async function load() {
    clear(listBox);
    const data = await api.get('/api/admin/teams');
    if (!data.teams.length) { listBox.appendChild(el('div', { class: 'empty' }, 'No teams yet.')); return; }
    const wrap = el('div', { class: 'table-wrap' });
    const table = el('table');
    table.appendChild(el('thead', {}, [el('tr', {}, [
      el('th', {}, 'Team'), el('th', {}, 'Members'), el('th', {}, 'Username'), el('th', {}, 'Batch'), el('th', {}, 'Solved'), el('th', {}, ''),
    ])]));
    const tbody = el('tbody');
    data.teams.forEach((t) => {
      const canDelete = !t.batch_id || t.batch_status === 'draft';
      tbody.appendChild(el('tr', {}, [
        el('td', {}, t.name),
        el('td', { class: 'muted' }, t.members.join(', ')),
        el('td', { class: 'mono' }, t.username),
        el('td', {}, t.batch_number ? [`#${t.batch_number} `, statusBadge(t.batch_status)] : el('span', { class: 'muted' }, 'Unassigned')),
        el('td', { class: 'mono' }, String(t.solved)),
        el('td', { style: 'text-align:right;white-space:nowrap' }, [
          el('button', { class: 'btn btn-sm btn-ghost', onclick: () => resetPassword(t) }, 'Reset password'),
          canDelete ? el('button', { class: 'btn btn-sm btn-ghost', onclick: () => remove(t) }, 'Delete') : null,
        ]),
      ]));
    });
    table.appendChild(tbody); wrap.appendChild(table); listBox.appendChild(wrap);
  }

  async function resetPassword(t) {
    if (!confirm(`Reset the password for "${t.name}"? Their current session will be logged out.`)) return;
    try { const r = await api.post(`/api/admin/teams/${t.id}/reset-password`, {}); toast(`New password for ${t.name}: ${r.password}`, 'success', 9000); }
    catch (e) { toast(e.message, 'error'); }
  }
  async function remove(t) {
    if (!confirm(`Delete team "${t.name}"?`)) return;
    try { await api.del(`/api/admin/teams/${t.id}`); toast('Team deleted.', 'success'); load(); }
    catch (e) { toast(e.message, 'error'); }
  }

  load();
}
