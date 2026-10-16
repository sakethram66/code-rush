import { api } from './api.js';
import { el, clear, toast } from './util.js';
import { route, startRouter, navigate, currentPath, setUnauthorizedHandler, rerender } from './router.js';
import { renderLogin } from './pages/login.js';
import { renderAdminOverview } from './pages/adminOverview.js';
import { renderAdminQuestions } from './pages/adminQuestions.js';
import { renderAdminQuestionEditor } from './pages/adminQuestionEditor.js';
import { renderAdminBatches } from './pages/adminBatches.js';
import { renderAdminBatchDetail } from './pages/adminBatchDetail.js';
import { renderAdminTeams } from './pages/adminTeams.js';
import { renderAdminAudit } from './pages/adminAudit.js';
import { renderAdminSettings } from './pages/adminSettings.js';
import { renderTeamDashboard } from './pages/teamDashboard.js';
import { renderTeamProblem } from './pages/teamProblem.js';
import { renderLeaderboard } from './pages/leaderboard.js';

export let session = { role: null, admin: null, team: null };

async function refreshSession() {
  try {
    const r = await api.get('/api/auth/me');
    session = r;
  } catch (_) {
    session = { role: null };
  }
  return session;
}

const sidebarEl = document.getElementById('sidebar');
const topbarEl = document.getElementById('topbar');
const viewEl = document.getElementById('view');
const shellEl = document.getElementById('shell');
const loginScreenEl = document.getElementById('login-screen');

function closeSidebar() {
  sidebarEl.classList.remove('open');
  const menuBtn = topbarEl.querySelector('.menu-toggle');
  if (menuBtn) menuBtn.setAttribute('aria-expanded', 'false');
}

const ADMIN_NAV = [
  ['/admin', 'Overview'],
  ['/admin/questions', 'Question Bank'],
  ['/admin/batches', 'Batches'],
  ['/admin/teams', 'Teams'],
  ['/leaderboard', 'Leaderboard'],
  ['/admin/audit', 'Audit Log'],
  ['/admin/settings', 'Settings'],
];
const TEAM_NAV = [
  ['/team', 'Dashboard'],
];

function buildSidebar(role) {
  clear(sidebarEl);
  const nav = el('nav');
  const items = role === 'admin' ? ADMIN_NAV : TEAM_NAV;
  const path = currentPath();
  items.forEach(([href, label]) => {
    const a = el('a', { href: `#${href}` }, label);
    a.addEventListener('click', closeSidebar);
    const active = href === '/admin' ? path === '/admin' : href === '/team' ? path === '/team' : path.startsWith(href);
    if (active) a.classList.add('active');
    nav.appendChild(a);
  });
  sidebarEl.appendChild(el('div', { class: 'sidebar-brand' }, [
    el('div', { class: 'mark' }, ['Code', el('em', {}, 'Rush')]),
    el('div', { class: 'sub' }, role === 'admin' ? 'Organiser console' : 'Team console'),
  ]));
  sidebarEl.appendChild(nav);
  const who = role === 'admin' ? session.admin && session.admin.username : session.team && session.team.name;
  sidebarEl.appendChild(el('div', { class: 'sidebar-foot' }, [
    el('div', { style: 'margin-bottom:8px;color:var(--text-dim)' }, who || ''),
    el('button', { class: 'btn btn-ghost btn-sm btn-block', onclick: doLogout }, 'Log out'),
  ]));
}

function buildTopbar(role) {
  clear(topbarEl);
  const menuBtn = el('button', {
    class: 'btn btn-icon menu-toggle',
    'aria-label': 'Menu',
    'aria-expanded': 'false',
    onclick: () => {
      const open = sidebarEl.classList.toggle('open');
      menuBtn.setAttribute('aria-expanded', String(open));
    },
  }, '☰');
  const title = el('div', { style: 'font-weight:600;font-family:var(--font-display);font-size:18px;letter-spacing:.3px' },
    role === 'admin' ? 'Organiser Console' : 'Code Rush');
  topbarEl.appendChild(el('div', { style: 'display:flex;align-items:center;gap:10px' }, [menuBtn, title]));
  topbarEl.appendChild(el('div'));
}

export function showAppShell(role) {
  loginScreenEl.hidden = true;
  shellEl.hidden = false;
  buildSidebar(role);
  buildTopbar(role);
}

export function showLoginScreen() {
  shellEl.hidden = true;
  loginScreenEl.hidden = false;
}

async function doLogout() {
  try { await api.post('/api/auth/logout'); } catch (_) { /* ignore */ }
  session = { role: null };
  navigate('/login');
}

function requireRole(role) {
  if (session.role !== role) {
    navigate(session.role === 'admin' ? '/admin' : session.role === 'team' ? '/team' : '/login');
    return false;
  }
  showAppShell(role);
  return true;
}

// ---- routes ----
route('/login', async (root) => {
  if (session.role) { navigate(session.role === 'admin' ? '/admin' : '/team'); return; }
  showLoginScreen();
  renderLogin(root === viewEl ? loginScreenEl : root, {
    session,
    onLoggedIn: async (res) => { session = { role: res.role, admin: res.admin, team: res.team }; navigate(res.role === 'admin' ? '/admin' : '/team'); },
  });
});

route('/', async () => {
  navigate(session.role === 'admin' ? '/admin' : session.role === 'team' ? '/team' : '/login');
});

route('/leaderboard', async (root) => {
  if (session.role !== 'admin') { navigate(session.role === 'team' ? '/team' : '/login'); return; }
  showAppShell('admin');
  return renderLeaderboard(root, { session });
});

route('/admin', async (root) => { if (requireRole('admin')) return renderAdminOverview(root); });
route('/admin/questions', async (root) => { if (requireRole('admin')) return renderAdminQuestions(root); });
route('/admin/questions/new', async (root) => { if (requireRole('admin')) return renderAdminQuestionEditor(root, {}); });
route('/admin/questions/:id', async (root, params) => { if (requireRole('admin')) return renderAdminQuestionEditor(root, params); });
route('/admin/batches', async (root) => { if (requireRole('admin')) return renderAdminBatches(root); });
route('/admin/batches/:id', async (root, params) => { if (requireRole('admin')) return renderAdminBatchDetail(root, params); });
route('/admin/teams', async (root) => { if (requireRole('admin')) return renderAdminTeams(root); });
route('/admin/audit', async (root) => { if (requireRole('admin')) return renderAdminAudit(root); });
route('/admin/settings', async (root) => { if (requireRole('admin')) return renderAdminSettings(root); });

route('/team', async (root) => { if (requireRole('team')) return renderTeamDashboard(root); });
route('/team/questions/:id', async (root, params) => { if (requireRole('team')) return renderTeamProblem(root, params); });

setUnauthorizedHandler(() => {
  session = { role: null };
  toast('Your session has expired. Please log in again.', 'error');
  navigate('/login');
});

(async () => {
  await refreshSession();
  startRouter(viewEl);
  if (!session.role && currentPath() === '/') navigate('/login');
})();
