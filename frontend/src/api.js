const BASE = import.meta.env.VITE_API_URL || '';

// Web addresses: "/" home, "/signup" onboarding, "/platform" platform admin, "/b/<slug>" a business
// In one-business mode the server marks the page, and the business lives at the root address
export const SINGLE = window.__SINGLE__ || null;
export const SLUG = SINGLE || (window.location.pathname.match(/^\/b\/([^/]+)/) || [])[1] || null;
// Public address of the current business
export const bizUrl = () => window.location.origin + (SINGLE ? '/' : '/b/' + SLUG);

const keyFor = (scope) => 'session:' + (scope || 'platform');

// A login belongs to one business (or to the platform admin), so sessions are stored per scope
export function getSession(scope = SLUG) {
  try {
    return JSON.parse(localStorage.getItem(keyFor(scope)));
  } catch {
    return null;
  }
}
export const setSession = (s, scope = SLUG) =>
  s ? localStorage.setItem(keyFor(scope), JSON.stringify(s)) : localStorage.removeItem(keyFor(scope));

async function request(method, url, body, scope) {
  const s = getSession(scope);
  const res = await fetch(BASE + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(s && { Authorization: 'Bearer ' + s.token }) },
    body: body && JSON.stringify(body),
  });
  if (res.status === 401 && s) {
    // token expired: sign out cleanly instead of showing broken screens
    setSession(null, scope);
    window.location.reload();
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong');
  return data;
}

// Calls inside the current business: /api/b/<slug>/...
export const api = (method, path, body) => request(method, `/api/b/${SLUG}${path}`, body, SLUG);

// Calls that are not tied to a business: sign-up, slug check, platform admin
export const gapi = (method, path, body, scope = null) => request(method, '/api' + path, body, scope);

// Download a file the API returns (for example the CSV export), sending the login token
export async function download(path, filename) {
  const s = getSession();
  const res = await fetch(BASE + `/api/b/${SLUG}${path}`, { headers: s ? { Authorization: 'Bearer ' + s.token } : {} });
  if (!res.ok) throw new Error('Download failed');
  const url = URL.createObjectURL(await res.blob());
  Object.assign(document.createElement('a'), { href: url, download: filename }).click();
  URL.revokeObjectURL(url);
}
