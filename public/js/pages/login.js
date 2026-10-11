import { api } from '../api.js';
import { el, toast } from '../util.js';

export function renderLogin(root, { session, onLoggedIn }) {
  root.innerHTML = '';
  let roleTab = 'team';

  const errorBox = el('div', { class: 'alert alert-error', style: 'display:none' });
  const userInput = el('input', { type: 'text', autocomplete: 'username', placeholder: 'yourteam' });
  const passInput = el('input', { type: 'password', autocomplete: 'current-password', placeholder: '••••••••' });
  const submitBtn = el('button', { class: 'btn btn-primary btn-block', type: 'submit' }, 'Log in');

  const teamTab = el('button', { type: 'button', class: 'active', onclick: () => setTab('team') }, 'Team');
  const adminTab = el('button', { type: 'button', onclick: () => setTab('admin') }, 'Organiser');

  function setTab(r) {
    roleTab = r;
    teamTab.classList.toggle('active', r === 'team');
    adminTab.classList.toggle('active', r === 'admin');
    userInput.placeholder = r === 'team' ? 'yourteam' : 'admin';
    errorBox.style.display = 'none';
  }

  const form = el('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      errorBox.style.display = 'none';
      const username = userInput.value.trim();
      const password = passInput.value;
      if (!username || !password) return;
      submitBtn.disabled = true; submitBtn.textContent = 'Logging in…';
      try {
        const res = await api.post(`/api/auth/${roleTab}/login`, { username, password });
        toast(`Welcome, ${res.admin ? res.admin.username : res.team.name}.`, 'success');
        onLoggedIn(res);
      } catch (err) {
        errorBox.textContent = err.message;
        errorBox.style.display = '';
      } finally {
        submitBtn.disabled = false; submitBtn.textContent = 'Log in';
      }
    },
  }, [
    el('div', { class: 'role-switch' }, [teamTab, adminTab]),
    errorBox,
    el('div', { class: 'field' }, [el('label', {}, 'Username'), userInput]),
    el('div', { class: 'field' }, [el('label', {}, 'Password'), passInput]),
    submitBtn,
  ]);

  root.appendChild(el('div', { class: 'login-wrap' }, [
    el('div', { class: 'login-mark' }, [
      el('div', { class: 'mark' }, ['Code', el('em', {}, 'Rush')]),
      el('div', { class: 'tag' }, 'Sign in to enter the competition'),
    ]),
    el('div', { class: 'panel' }, [form]),
  ]));
  userInput.focus();
}
