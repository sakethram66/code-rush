import { api } from '../api.js';
import { el, clear, toast, difficultyBadge, statusBadge, fmtDuration, fmtDateTime } from '../util.js';

const DIFF_LABEL = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };
const DIFF_REQUIRED = { easy: 5, medium: 10, hard: 10 };

export async function renderAdminBatchDetail(root, params) {
  clear(root);
  const batchId = params.id;
  const batch = await api.get(`/api/admin/batches/${batchId}`);

  root.appendChild(el('div', { class: 'panel-head' }, [
    el('div', {}, [
      el('h1', {}, `Batch #${batch.number}${batch.name ? ' — ' + batch.name : ''}`),
      el('div', { style: 'margin-top:4px' }, statusBadge(batch.status)),
    ]),
    el('a', { href: '#/admin/batches', class: 'btn btn-ghost' }, '← All batches'),
  ]));

  if (batch.status === 'draft') await renderDraft(root, batch);
  else await renderStarted(root, batch);
}

// ============================================================ DRAFT: selection + team assignment
async function renderDraft(root, batch) {
  const state = { tab: 'easy', search: '', selected: new Set() };
  const sel = await api.get(`/api/admin/batches/${batch.id}/selection`);
  sel.questions.forEach((q) => state.selected.add(q.id));

  const layout = el('div', { class: 'selection-layout' });
  const left = el('div');
  const rightSticky = el('div', { class: 'sticky-side' });
  layout.append(left, rightSticky);
  root.appendChild(layout);

  // ---- settings panel ----
  const nameInput = el('input', { type: 'text', value: batch.name || '' });
  const numberInput = el('input', { type: 'number', value: batch.number, min: 1 });
  const durationInput = el('input', { type: 'number', value: batch.duration_minutes, min: 1, max: 600 });
  left.appendChild(el('div', { class: 'panel' }, [
    el('div', { class: 'panel-head' }, [el('h3', {}, 'Batch settings')]),
    el('form', {
      class: 'row', style: 'align-items:end',
      onsubmit: async (e) => {
        e.preventDefault();
        try {
          await api.put(`/api/admin/batches/${batch.id}`, { name: nameInput.value.trim(), number: Number(numberInput.value), duration_minutes: Number(durationInput.value) });
          toast('Settings saved.', 'success');
        } catch (err) { toast(err.message, 'error'); }
      },
    }, [
      el('div', { class: 'field' }, [el('label', {}, 'Batch number'), numberInput]),
      el('div', { class: 'field' }, [el('label', {}, 'Name'), nameInput]),
      el('div', { class: 'field' }, [el('label', {}, 'Duration (minutes)'), durationInput]),
      el('button', { class: 'btn', type: 'submit', style: 'margin-bottom:16px' }, 'Save'),
    ]),
  ]));

  // ---- question picker ----
  const pickerPanel = el('div', { class: 'panel' });
  left.appendChild(pickerPanel);
  const tabs = el('div', { class: 'pill-tabs' }, Object.keys(DIFF_REQUIRED).map((d) =>
    el('button', { type: 'button', class: state.tab === d ? 'active' : '', onclick: () => { state.tab = d; renderTabs(); loadCandidates(); } }, `${DIFF_LABEL[d]} (${DIFF_REQUIRED[d]})`)));
  const searchInput = el('input', { type: 'search', placeholder: 'Search this difficulty…', style: 'margin-bottom:12px' });
  const listBox = el('div');
  pickerPanel.append(
    el('div', { class: 'panel-head' }, [el('h3', {}, 'Select questions')]),
    el('p', {}, 'Nothing is selected automatically. Check exactly the questions you want; the counts on the right must reach 5 / 10 / 10 before you can start the batch.'),
    tabs, searchInput, listBox,
  );
  function renderTabs() {
    [...tabs.children].forEach((btn, i) => btn.classList.toggle('active', Object.keys(DIFF_REQUIRED)[i] === state.tab));
  }
  searchInput.addEventListener('input', () => { state.search = searchInput.value.trim(); loadCandidates(); });

  async function loadCandidates() {
    clear(listBox);
    listBox.appendChild(el('div', { class: 'empty' }, el('span', { class: 'spinner' })));
    const q = new URLSearchParams({ difficulty: state.tab, pageSize: 100, ...(state.search ? { search: state.search } : {}) });
    const data = await api.get(`/api/admin/batches/${batch.id}/candidates?${q}`);
    clear(listBox);
    if (!data.items.length) { listBox.appendChild(el('div', { class: 'empty' }, 'No questions match.')); return; }
    data.items.forEach((qn) => {
      const checked = state.selected.has(qn.id);
      const cb = el('input', { type: 'checkbox', checked, onchange: () => toggle(qn.id, cb) });
      listBox.appendChild(el('div', { class: 'qpicker-row' }, [
        cb,
        el('div', { class: 'title' }, [qn.title, el('span', { class: 'muted mono', style: 'margin-left:8px;font-size:11.5px' }, `Q${qn.id}`)]),
        el('div', { class: 'usage' }, qn.times_used ? `Used in batch${qn.used_in.length > 1 ? 'es' : ''} ${qn.used_in.map((n) => '#' + n).join(', ')}`
          : (qn.planned_in.length ? `Planned in #${qn.planned_in.join(', #')}` : 'Never used')),
      ]));
    });
  }

  async function toggle(id, checkboxEl) {
    const before = new Set(state.selected);
    if (checkboxEl.checked) state.selected.add(id); else state.selected.delete(id);
    try {
      const v = await api.put(`/api/admin/batches/${batch.id}/selection`, { question_ids: [...state.selected] });
      updateCounters(v.validation);
    } catch (err) {
      state.selected = before;
      checkboxEl.checked = before.has(id);
      toast(err.message, 'error');
    }
  }

  // ---- right column: live counters + start + teams ----
  const counters = el('div', { class: 'counter-row' });
  const startMsg = el('div', { class: 'alert alert-info' });
  const startBtn = el('button', { class: 'btn btn-primary btn-block', onclick: doStart }, 'Start Batch');
  rightSticky.appendChild(el('div', { class: 'panel' }, [
    el('h3', {}, 'Selection status'),
    counters, startMsg, startBtn,
  ]));

  function updateCounters(v) {
    clear(counters);
    Object.keys(DIFF_REQUIRED).forEach((d) => {
      const ok = v[d] === DIFF_REQUIRED[d];
      counters.appendChild(el('div', { class: `counter ${ok ? 'ok' : 'short'}` }, [
        el('div', { class: 'v' }, `${v[d]}/${DIFF_REQUIRED[d]}`), el('div', { class: 'k' }, DIFF_LABEL[d]),
      ]));
    });
    startMsg.textContent = v.valid ? 'Selection is complete. Ready to start once at least one team is assigned.' : v.message;
    startMsg.className = `alert ${v.valid ? 'alert-success' : 'alert-info'}`;
  }
  updateCounters(sel.validation);

  async function doStart() {
    startBtn.disabled = true;
    try {
      await api.post(`/api/admin/batches/${batch.id}/start`);
      toast('Batch started! The question set is now locked.', 'success');
      location.hash = `#/admin/batches/${batch.id}`;
      location.reload();
    } catch (err) {
      toast(err.message, 'error');
    } finally { startBtn.disabled = false; }
  }

  // ---- team assignment ----
  const teamsPanel = el('div', { class: 'panel' });
  rightSticky.appendChild(teamsPanel);
  await renderTeamAssignment(teamsPanel, batch);

  renderTabs();
  await loadCandidates();
}

async function renderTeamAssignment(panel, batch) {
  clear(panel);
  panel.appendChild(el('h3', {}, 'Teams in this batch'));
  const [assigned, unassigned] = await Promise.all([
    api.get(`/api/admin/teams?batch=${batch.id}`), api.get('/api/admin/teams?unassigned=1'),
  ]);
  const list = el('div');
  if (!assigned.teams.length) list.appendChild(el('p', { class: 'muted' }, 'No teams assigned yet.'));
  assigned.teams.forEach((t) => {
    list.appendChild(el('div', { class: 'kv' }, [
      el('span', {}, t.name),
      el('button', { class: 'btn btn-sm btn-ghost', onclick: async () => { await api.put(`/api/admin/teams/${t.id}`, { batch_id: null }); renderTeamAssignment(panel, batch); } }, 'Remove'),
    ]));
  });
  panel.appendChild(list);

  if (unassigned.teams.length) {
    const sel = el('select', {}, [el('option', { value: '' }, '— choose a team —'), ...unassigned.teams.map((t) => el('option', { value: t.id }, t.name))]);
    panel.appendChild(el('form', {
      style: 'display:flex;gap:8px;margin-top:10px',
      onsubmit: async (e) => { e.preventDefault(); if (!sel.value) return; await api.put(`/api/admin/teams/${sel.value}`, { batch_id: batch.id }); renderTeamAssignment(panel, batch); },
    }, [sel, el('button', { class: 'btn btn-sm', type: 'submit' }, 'Assign')]));
  }
  panel.appendChild(el('a', { href: '#/admin/teams', style: 'display:block;margin-top:10px;font-size:13px' }, 'Manage all teams →'));
}

// ============================================================ RUNNING / COMPLETED: locked results view
async function renderStarted(root, batch) {
  if (batch.status === 'running') {
    const bar = el('div', { class: 'panel', style: 'display:flex;justify-content:space-between;align-items:center' });
    const timer = el('div', { class: 'timer' }, fmtDuration(batch.remaining_ms));
    bar.append(
      el('div', {}, [el('div', { class: 'muted', style: 'font-size:12px' }, 'Time remaining'), timer]),
      el('button', { class: 'btn btn-danger', onclick: async () => { if (confirm('End this batch early for all teams?')) { await api.post(`/api/admin/batches/${batch.id}/end`); location.reload(); } } }, 'End batch now'),
    );
    root.appendChild(bar);
    const t = setInterval(() => {
      batch.remaining_ms = Math.max(0, batch.remaining_ms - 1000);
      timer.textContent = fmtDuration(batch.remaining_ms);
      if (batch.remaining_ms <= 0) { clearInterval(t); location.reload(); }
    }, 1000);
  }

  const h = await api.get(`/api/admin/batches/${batch.id}/history`);

  root.appendChild(el('div', { class: 'panel' }, [
    el('div', { class: 'panel-head' }, [el('h2', {}, 'Locked question set'), el('span', { class: 'muted mono' }, '25 questions · fixed order')]),
    el('div', { class: 'grid grid-3' }, Object.keys(DIFF_REQUIRED).map((d) => el('div', {}, [
      el('div', { class: 'qgroup-label' }, [DIFF_LABEL[d], el('span', { class: 'n' }, `${h.questions[d].length}`)]),
      ...h.questions[d].map((q) => el('div', { class: 'qrow', style: 'cursor:default' }, [
        el('span', { class: 'pos' }, `Q${q.position}`),
        el('span', { class: 'title' }, q.title),
        el('span', { class: 'mono muted', style: 'font-size:12px' }, `${q.solved_by} solved`),
      ])),
    ]))),
  ]));

  root.appendChild(el('div', { class: 'panel' }, [
    el('div', { class: 'panel-head' }, [
      el('h2', {}, 'Results'),
      el('a', { href: `/api/admin/batches/${batch.id}/results.csv`, class: 'btn btn-sm' }, 'Download CSV'),
    ]),
    resultsTable(h.results),
  ]));

  root.appendChild(el('div', { class: 'panel' }, [
    el('h3', {}, `Teams (${h.teams.length})`),
    ...h.teams.map((t) => el('div', { class: 'kv' }, [el('span', {}, t.name), el('span', { class: 'muted' }, t.members.join(', '))])),
  ]));
}

function resultsTable(rows) {
  if (!rows.length) return el('div', { class: 'empty' }, 'No results yet.');
  const wrap = el('div', { class: 'table-wrap' });
  const table = el('table');
  table.appendChild(el('thead', {}, [el('tr', {}, [el('th', {}, 'Rank'), el('th', {}, 'Team'), el('th', {}, 'Solved'), el('th', {}, 'Score'), el('th', {}, 'Time')])]));
  const tbody = el('tbody');
  rows.forEach((r) => tbody.appendChild(el('tr', {}, [
    el('td', { class: 'mono' }, String(r.rank)), el('td', {}, r.team), el('td', { class: 'mono' }, `${r.solved}/25`),
    el('td', { class: 'mono' }, String(r.score)), el('td', { class: 'mono' }, r.time),
  ])));
  table.appendChild(tbody); wrap.appendChild(table);
  return wrap;
}
