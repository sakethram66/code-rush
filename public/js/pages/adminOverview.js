import { api } from '../api.js';
import { el, clear } from '../util.js';

export async function renderAdminOverview(root) {
  clear(root);
  root.appendChild(el('h1', {}, 'Overview'));
  root.appendChild(el('p', {}, 'A snapshot of the question bank, batches and judging system.'));

  const o = await api.get('/api/admin/overview');

  const statGrid = el('div', { class: 'grid grid-4', style: 'margin-bottom:20px' }, [
    stat(o.questions.total, 'Questions in bank'),
    stat(`${o.questions.easy}/${o.questions.medium}/${o.questions.hard}`, 'Easy / Medium / Hard'),
    stat((o.batches.find((b) => b.status === 'running') || { n: 0 }).n, 'Batches running'),
    stat(o.teams.n, 'Teams registered'),
  ]);
  root.appendChild(statGrid);

  const batchCounts = { draft: 0, running: 0, completed: 0 };
  o.batches.forEach((b) => { batchCounts[b.status] = b.n; });

  root.appendChild(el('div', { class: 'grid grid-3' }, [
    panel('Batches', [
      kv('Draft', batchCounts.draft), kv('Running', batchCounts.running), kv('Completed', batchCounts.completed),
    ], '/admin/batches', 'Manage batches'),
    panel('Teams', [
      kv('Registered', o.teams.n), kv('Unassigned to a batch', o.teams.unassigned || 0),
    ], '/admin/teams', 'Manage teams'),
    panel('Submissions', [
      kv('Total judged', o.submissions.total - (o.submissions.pending || 0)),
      kv('Pending in queue', o.submissions.pending || 0),
      kv('Judge concurrency', o.judge.queue.concurrency),
    ]),
  ]));

  root.appendChild(el('div', { class: 'panel' }, [
    el('div', { class: 'panel-head' }, [el('h2', {}, 'Judge sandbox status')]),
    el('div', { class: 'grid grid-3' }, [
      langStatus('C', o.judge.languages.c), langStatus('Java', o.judge.languages.java), langStatus('Python', o.judge.languages.python),
    ]),
    el('hr', { class: 'divider' }),
    el('div', { class: 'kv' }, [el('span', { class: 'k' }, 'Linux host for sandboxed judging'), boolBadge(o.judge.sandbox.linuxHost)]),
    el('div', { class: 'kv' }, [el('span', { class: 'k' }, 'Privilege drop (unprivileged sandbox user)'), boolBadge(o.judge.sandbox.privilegeDrop)]),
    el('div', { class: 'kv' }, [el('span', { class: 'k' }, 'Network isolation'), boolBadge(o.judge.sandbox.network_isolation)]),
    el('div', { class: 'kv' }, [el('span', { class: 'k' }, 'CPU / memory resource limits (prlimit)'), boolBadge(o.judge.sandbox.rlimits)]),
    !o.judge.sandbox.linuxHost
      ? el('p', { style: 'margin-top:10px' }, 'Judging is disabled on this host. Run Code Rush on Linux or in Docker before accepting student submissions.')
      : !o.judge.sandbox.privilegeDrop || !o.judge.sandbox.network_isolation || !o.judge.sandbox.rlimits
        ? el('p', { style: 'margin-top:10px' }, 'The judge is missing one or more sandbox protections. Review the README security requirements before accepting student submissions.')
      : null,
  ]));

  function stat(n, l) { return el('div', { class: 'stat' }, [el('div', { class: 'n' }, String(n)), el('div', { class: 'l' }, l)]); }
  function kv(k, v) { return el('div', { class: 'kv' }, [el('span', { class: 'k' }, k), el('span', { class: 'mono' }, String(v))]); }
  function panel(title, rows, href, linkLabel) {
    return el('div', { class: 'panel' }, [
      el('div', { class: 'panel-head' }, [el('h3', {}, title)]),
      ...rows,
      href ? el('a', { href: `#${href}`, style: 'display:block;margin-top:12px;font-size:13px' }, linkLabel + ' →') : null,
    ]);
  }
  function langStatus(name, ok) {
    return el('div', { class: 'stat' }, [
      el('div', { style: 'display:flex;align-items:center;gap:8px' }, [el('span', { class: `status-dot ${ok ? 'accepted' : 'bad'}` }), el('span', { style: 'font-weight:600' }, name)]),
      el('div', { class: 'l', style: 'margin-top:6px' }, ok ? 'Ready' : 'Not available'),
    ]);
  }
  function boolBadge(v) { return el('span', { class: `badge ${v ? 'badge-solved' : 'badge-hard'}` }, v ? 'Yes' : 'No'); }
}
