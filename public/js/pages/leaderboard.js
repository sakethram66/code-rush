import { api, ApiError } from '../api.js';
import { el, clear } from '../util.js';

export async function renderLeaderboard(root, { session }) {
  clear(root);
  const wrap = el('div', { style: 'width:100%;max-width:760px' });
  root.appendChild(wrap);

  wrap.appendChild(el('div', { class: 'panel-head' }, [
    el('h1', {}, 'Leaderboard'),
    !session.role ? el('a', { href: '#/login', class: 'btn btn-sm' }, 'Log in') : null,
  ]));
  wrap.appendChild(el('p', {}, 'Combined ranking across every batch. Easy = 2 points, Medium = 3 points, Hard = 5 points; 90 points maximum per batch.'));

  const box = el('div', { class: 'panel' });
  wrap.appendChild(box);
  box.appendChild(el('div', { class: 'empty' }, el('span', { class: 'spinner' })));

  let data;
  try {
    data = session.role === 'team' ? await api.get('/api/team/leaderboard') : await api.get('/api/leaderboard');
  } catch (e) {
    clear(box);
    box.appendChild(el('div', { class: 'empty' }, e instanceof ApiError && e.status === 403 ? 'The organiser has hidden the leaderboard for now.' : e.message));
    return;
  }

  clear(box);
  const rows = data.rows;
  if (!rows.length) { box.appendChild(el('div', { class: 'empty' }, 'No results yet — nobody has solved a question in a started batch.')); return; }

  const tableWrap = el('div', { class: 'table-wrap' });
  const table = el('table');
  table.appendChild(el('thead', {}, [el('tr', {}, [
    el('th', {}, 'Rank'), el('th', {}, 'Team'), el('th', {}, 'Batch'), el('th', {}, 'Solved'), el('th', {}, 'Score'), el('th', {}, 'Time'),
  ])]));
  const tbody = el('tbody');
  rows.forEach((r) => {
    tbody.appendChild(el('tr', { style: r.me ? 'background:var(--panel-2)' : '' }, [
      el('td', { class: 'mono' }, String(r.rank)),
      el('td', {}, r.me ? el('strong', {}, r.team + ' (you)') : r.team),
      el('td', { class: 'mono muted' }, `#${r.batch}`),
      el('td', { class: 'mono' }, `${r.solved}/25`),
      el('td', { class: 'mono' }, String(r.score)),
      el('td', { class: 'mono' }, r.time),
    ]));
  });
  table.appendChild(tbody); tableWrap.appendChild(table); box.appendChild(tableWrap);
}
