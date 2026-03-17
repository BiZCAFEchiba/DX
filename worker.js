const GAS_WEB_APP_URL =
  'https://script.google.com/macros/s/AKfycbxc5QSSH2bHqX6cuHqClVMWfkBrfqW8Zi4AY2E_wYPjO2NWUD4oJXMihgR1XtVgR0vP/exec';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/gas') {
      return proxyToGas(request, url);
    }

    return env.ASSETS.fetch(request);
  },
};

async function proxyToGas(request, url) {
  const targetUrl = new URL(GAS_WEB_APP_URL);
  targetUrl.search = url.search;

  const init = {
    method: request.method,
    headers: filterHeaders(request.headers),
    redirect: 'follow',
  };

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    init.body = await request.arrayBuffer();
  }

  const response = await fetch(targetUrl.toString(), init);
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'no-store');

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function filterHeaders(headers) {
  const next = new Headers();
  headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (lower === 'host' || lower === 'content-length') return;
    next.set(key, value);
  });
  return next;
}
