const GAS_WEB_APP_URL =
  'https://script.google.com/macros/s/AKfycbz7-u0KjsXGA8RXjD8eLHA8amJg3oesL_ahcyvbXU7TX53y_qec3MR6pClR6uj5wIPS/exec';

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
  const originalBody =
    request.method !== 'GET' && request.method !== 'HEAD'
      ? await request.text()
      : null;

  let currentUrl = targetUrl.toString();
  let currentMethod = request.method;
  let currentBody = originalBody;
  let response;

  for (let i = 0; i < 6; i++) {
    const headers = new Headers();
    const accept = request.headers.get('accept');
    if (accept) headers.set('Accept', accept);
    if (currentBody !== null) headers.set('Content-Type', request.headers.get('content-type') || 'text/plain');

    const init = { method: currentMethod, headers, redirect: 'manual' };
    if (currentBody !== null) init.body = currentBody;

    response = await fetch(currentUrl, init);
    if (!isRedirectResponse(response.status)) break;

    const location = response.headers.get('location');
    if (!location) break;

    // 301/302/303 は HTTP 仕様で POST→GET に変換する
    if (response.status === 301 || response.status === 302 || response.status === 303) {
      currentMethod = 'GET';
      currentBody = null;
    }

    const redirectUrl = new URL(location, currentUrl);
    if (!redirectUrl.search && url.search) redirectUrl.search = url.search;
    currentUrl = redirectUrl.toString();
  }

  const resHeaders = new Headers(response.headers);
  resHeaders.set('Cache-Control', 'no-store');

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: resHeaders,
  });
}

function isRedirectResponse(status) {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function buildProxyHeaders(request) {
  const headers = new Headers();
  // Acceptヘッダーは元のリクエストから引き継ぐか、制限を解除する
  const accept = request.headers.get('accept');
  if (accept) {
    headers.set('Accept', accept);
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    const contentType = request.headers.get('content-type');
    if (contentType) {
      headers.set('Content-Type', contentType);
    }
  }

  return headers;
}
