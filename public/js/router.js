// Minimal hash router. Routes are registered as {pattern, render(container, params)}.
// Pattern segments starting with ':' capture a param, e.g. '/admin/batches/:id/selection'.

const routes = [];
let container = null;
let current = null; // { destroy? } returned by the last render, if it provided cleanup
let unauthorizedHandler = null;

export function setUnauthorizedHandler(fn) { unauthorizedHandler = fn; }

export function route(pattern, render) {
  const parts = pattern.split('/').filter(Boolean);
  routes.push({ pattern, parts, render });
}

function match(pathParts) {
  for (const r of routes) {
    if (r.parts.length !== pathParts.length) continue;
    const params = {};
    let ok = true;
    for (let i = 0; i < r.parts.length; i++) {
      const p = r.parts[i];
      if (p.startsWith(':')) params[p.slice(1)] = decodeURIComponent(pathParts[i]);
      else if (p !== pathParts[i]) { ok = false; break; }
    }
    if (ok) return { route: r, params };
  }
  return null;
}

export function navigate(path) {
  if (location.hash.slice(1) === path) { render(); } else { location.hash = path; }
}

export function currentPath() {
  return location.hash.slice(1) || '/';
}

async function render() {
  const path = currentPath();
  const path0 = path === '/' ? '/' : path.replace(/\/+$/, '');
  const parts = path0.split('/').filter(Boolean);
  if (current && typeof current.destroy === 'function') { try { current.destroy(); } catch (_) { /* ignore */ } }
  current = null;
  const m = match(parts);
  container.setAttribute('data-path', path0);
  if (!m) {
    container.innerHTML = '<div class="empty"><h2>Page not found</h2><p>That page does not exist.</p></div>';
    return;
  }
  try {
    const result = await m.route.render(container, m.params);
    if (result && typeof result.destroy === 'function') current = result;
  } catch (e) {
    if (e && e.status === 401 && unauthorizedHandler) { unauthorizedHandler(); return; }
    console.error(e);
    container.innerHTML = `<div class="empty"><h2>Something went wrong</h2><p>${(e && e.message) || e}</p></div>`;
  }
}

export function startRouter(rootEl) {
  container = rootEl;
  window.addEventListener('hashchange', render);
  render();
}

export function rerender() { render(); }
