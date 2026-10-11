// Thin fetch wrapper. Throws ApiError with the server's message on non-2xx responses.
export class ApiError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra || null;
  }
}

async function request(method, url, body) {
  const opts = { method, headers: {}, credentials: 'same-origin' };
  if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  let res;
  try {
    res = await fetch(url, opts);
  } catch (e) {
    throw new ApiError(0, 'Could not reach the server. Check your connection and try again.');
  }
  const ct = res.headers.get('content-type') || '';
  const isJson = ct.includes('application/json');
  const data = isJson ? await res.json().catch(() => ({})) : await res.text();
  if (!res.ok) {
    const msg = isJson && data && data.error ? data.error : (typeof data === 'string' && data ? data : `Request failed (${res.status})`);
    throw new ApiError(res.status, msg, isJson ? data : null);
  }
  return data;
}

export const api = {
  get: (url) => request('GET', url),
  post: (url, body) => request('POST', url, body === undefined ? {} : body),
  put: (url, body) => request('PUT', url, body === undefined ? {} : body),
  del: (url) => request('DELETE', url),
};
