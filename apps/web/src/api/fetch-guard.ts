const originalFetch = window.fetch.bind(window);
let sessionPromise: Promise<void> | null = null;

function isLocalApi(input: RequestInfo | URL) {
  const value = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  const url = new URL(value, window.location.origin);
  return url.origin === window.location.origin && url.pathname.startsWith('/api/');
}

function requestMethod(input: RequestInfo | URL, init?: RequestInit) {
  return String(init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
}

async function ensureSession() {
  if (!sessionPromise) {
    sessionPromise = originalFetch('/api/session', { credentials: 'include' }).then((response) => {
      if (!response.ok) throw new Error('Unable to initialize the local Frakio Work session.');
    }).catch((error) => {
      sessionPromise = null;
      throw error;
    });
  }
  return sessionPromise;
}

export function installLocalApiFetchGuard() {
  window.fetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
    if (!isLocalApi(input)) return originalFetch(input, init);
    const method = requestMethod(input, init);
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) await ensureSession();
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(init.headers).forEach((value, key) => headers.set(key, value));
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) headers.set('X-Frakio-Request', '1');
    return originalFetch(input, { ...init, headers, credentials: 'include' });
  };
}
