import { api } from '../api.js';
import { el, clear, escapeHtml, toast, debounce, difficultyBadge } from '../util.js';

export async function renderAdminQuestions(root) {
  clear(root);
  const state = { difficulty: '', search: '', usage: 'any', archived: 'no', page: 1, pageSize: 25 };

  const header = el('div', { class: 'panel-head' }, [
    el('h1', {}, 'Question Bank'),
    el('div', { style: 'display:flex;gap:8px' }, [
      el('button', { class: 'btn', onclick: doExport }, 'Export JSON'),
      el('button', { class: 'btn', onclick: () => openImport() }, 'Import JSON'),
      el('a', { href: '#/admin/questions/new', class: 'btn btn-primary' }, '+ New Question'),
    ]),
  ]);
  root.appendChild(header);

  const filterBar = el('div', { class: 'row', style: 'margin-bottom:16px' });
  const searchInput = el('input', { type: 'search', placeholder: 'Search by title, topic or #id…' });
  const diffSelect = el('select', {}, [
    el('option', { value: '' }, 'All difficulties'),
    el('option', { value: 'easy' }, 'Easy'), el('option', { value: 'medium' }, 'Medium'), el('option', { value: 'hard' }, 'Hard'),
  ]);
  const usageSelect = el('select', {}, [
    el('option', { value: 'any' }, 'Any usage'),
    el('option', { value: 'unused' }, 'Never used in a started batch'),
    el('option', { value: 'used' }, 'Used in a started batch'),
  ]);
  const archivedSelect = el('select', {}, [
    el('option', { value: 'no' }, 'Active only'), el('option', { value: 'only' }, 'Archived only'), el('option', { value: 'all' }, 'All'),
  ]);
  filterBar.append(searchInput, diffSelect, usageSelect, archivedSelect);
  root.appendChild(filterBar);

  const listBox = el('div', { class: 'panel' });
  root.appendChild(listBox);

  searchInput.addEventListener('input', debounce(() => { state.search = searchInput.value.trim(); state.page = 1; load(); }, 300));
  diffSelect.addEventListener('change', () => { state.difficulty = diffSelect.value; state.page = 1; load(); });
  usageSelect.addEventListener('change', () => { state.usage = usageSelect.value; state.page = 1; load(); });
  archivedSelect.addEventListener('change', () => { state.archived = archivedSelect.value; state.page = 1; load(); });

  async function load() {
    clear(listBox);
    listBox.appendChild(el('div', { class: 'empty' }, [el('span', { class: 'spinner' })]));
    const q = new URLSearchParams({
      page: state.page, pageSize: state.pageSize, usage: state.usage, archived: state.archived,
      ...(state.difficulty ? { difficulty: state.difficulty } : {}), ...(state.search ? { search: state.search } : {}),
    });
    const data = await api.get(`/api/admin/questions?${q}`);
    clear(listBox);
    if (!data.items.length) { listBox.appendChild(el('div', { class: 'empty' }, 'No questions match these filters.')); return; }

    const wrap = el('div', { class: 'table-wrap' });
    const table = el('table');
    table.appendChild(el('thead', {}, [el('tr', {}, [
      el('th', {}, '#'), el('th', {}, 'Title'), el('th', {}, 'Difficulty'), el('th', {}, 'Topic'),
      el('th', {}, 'Tests'), el('th', {}, 'Used in'), el('th', {}, 'Planned in'), el('th', {}, ''),
    ])]));
    const tbody = el('tbody');
    data.items.forEach((qn) => {
      tbody.appendChild(el('tr', {}, [
        el('td', { class: 'mono muted' }, `Q${qn.id}`),
        el('td', {}, el('a', { href: `#/admin/questions/${qn.id}` }, qn.title)),
        el('td', {}, difficultyBadge(qn.difficulty)),
        el('td', { class: 'muted' }, qn.topic || '—'),
        el('td', { class: 'mono' }, String(qn.test_count)),
        el('td', { class: 'mono' }, qn.used_in.length ? qn.used_in.map((n) => `#${n}`).join(', ') : '—'),
        el('td', { class: 'mono muted' }, qn.planned_in.length ? qn.planned_in.map((n) => `#${n}`).join(', ') : '—'),
        el('td', { style: 'text-align:right;white-space:nowrap' }, [
          el('button', { class: 'btn btn-sm btn-ghost', onclick: () => toggleArchive(qn) }, qn.archived ? 'Restore' : 'Archive'),
          !qn.archived && !qn.used_in.length
            ? el('button', { class: 'btn btn-sm btn-ghost', onclick: () => remove(qn) }, 'Delete') : null,
        ]),
      ]));
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    listBox.appendChild(wrap);

    const totalPages = Math.max(1, Math.ceil(data.total / data.pageSize));
    if (totalPages > 1) {
      const pager = el('div', { style: 'display:flex;justify-content:space-between;align-items:center;margin-top:14px' }, [
        el('span', { class: 'muted mono' }, `Page ${data.page} of ${totalPages} · ${data.total} questions`),
        el('div', { style: 'display:flex;gap:8px' }, [
          el('button', { class: 'btn btn-sm', disabled: data.page <= 1, onclick: () => { state.page--; load(); } }, 'Previous'),
          el('button', { class: 'btn btn-sm', disabled: data.page >= totalPages, onclick: () => { state.page++; load(); } }, 'Next'),
        ]),
      ]);
      listBox.appendChild(pager);
    }
  }

  async function toggleArchive(qn) {
    try {
      await api.post(`/api/admin/questions/${qn.id}/archive`, { archived: !qn.archived });
      toast(qn.archived ? 'Question restored.' : 'Question archived.', 'success');
      load();
    } catch (e) { toast(e.message, 'error'); }
  }
  async function remove(qn) {
    if (!confirm(`Delete "${qn.title}" permanently? This cannot be undone.`)) return;
    try { await api.del(`/api/admin/questions/${qn.id}`); toast('Question deleted.', 'success'); load(); }
    catch (e) { toast(e.message, 'error'); }
  }
  async function doExport() {
    const data = await api.get('/api/admin/questions/export');
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = el('a', { href: url, download: 'code-rush-questions.json' });
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }
  function openImport() {
    const fileInput = el('input', { type: 'file', accept: 'application/json' });
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        const parsed = JSON.parse(text);
        const report = await api.post('/api/admin/questions/import', { questions: Array.isArray(parsed) ? parsed : parsed.questions });
        if (report.aborted) {
          toast(`Import failed: ${report.errors.length} question(s) had errors (e.g. "${report.errors[0].error}").`, 'error', 7000);
        } else {
          toast(`Imported ${report.created} question(s), skipped ${report.skipped} duplicate(s).`, 'success');
          load();
        }
      } catch (e) { toast('Import failed: ' + (e.message || 'invalid JSON file'), 'error'); }
    });
    fileInput.click();
  }

  load();
}
