import { api } from '../api.js';
import { session } from '../app.js';
import { el, clear, toast } from '../util.js';

export async function renderAdminSettings(root) {
  clear(root);
  root.appendChild(el('div', { class: 'panel-head' }, [el('h1', {}, 'Settings')]));

  const settings = await api.get('/api/admin/overview').then((o) => o.settings);
  const toggle = el('input', { type: 'checkbox', checked: settings.public_leaderboard, onchange: async () => {
    try { await api.put('/api/admin/settings', { public_leaderboard: toggle.checked }); toast('Saved.', 'success'); }
    catch (e) { toggle.checked = !toggle.checked; toast(e.message, 'error'); }
  } });
  root.appendChild(el('div', { class: 'panel' }, [
    el('h3', {}, 'Leaderboard visibility'),
    el('label', { class: 'checkbox-row' }, [toggle, el('span', {}, 'Show the combined leaderboard to the public')]),
    el('p', { style: 'margin-top:8px' }, 'When turned off, only organisers can view the leaderboard.'),
  ]));

  const currentInput = el('input', { type: 'password', autocomplete: 'current-password' });
  const nextInput = el('input', { type: 'password', autocomplete: 'new-password', minlength: 8 });
  const errorBox = el('div', { class: 'alert alert-error', style: 'display:none' });
  root.appendChild(el('div', { class: 'panel' }, [
    el('h3', {}, 'Change your password'),
    errorBox,
    el('form', {
      onsubmit: async (e) => {
        e.preventDefault();
        errorBox.style.display = 'none';
        try {
          await api.post('/api/auth/admin/password', { current: currentInput.value, next: nextInput.value });
          toast('Password changed.', 'success');
          currentInput.value = ''; nextInput.value = '';
        } catch (err) { errorBox.textContent = err.message; errorBox.style.display = ''; }
      },
    }, [
      el('div', { class: 'row' }, [
        el('div', { class: 'field' }, [el('label', {}, 'Current password'), currentInput]),
        el('div', { class: 'field' }, [el('label', {}, 'New password (min 8 characters)'), nextInput]),
      ]),
      el('button', { class: 'btn btn-primary', type: 'submit' }, 'Change password'),
    ]),
  ]));

  root.appendChild(el('div', { class: 'panel' }, [
    el('h3', {}, 'Signed in as'),
    el('p', {}, session.admin ? session.admin.username : ''),
  ]));
}
