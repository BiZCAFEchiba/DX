const GAS_WEB_APP_URL =
  'https://script.google.com/macros/s/AKfycbz1-u0KjsXGA8RXjD8eLHA8amJg3oesL_ahcyvbXU7TX53y_qec3MR6pClR6uj5wIPS/exec';

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
  const requestBody =
    request.method !== 'GET' && request.method !== 'HEAD'
      ? await request.arrayBuffer()
      : null;

  const init = {
    method: request.method,
    headers: buildProxyHeaders(request),
    redirect: 'manual',
  };

  if (requestBody) {
    init.body = requestBody.slice(0);
  }

  let response = await fetch(targetUrl.toString(), init);
  if (isRedirectResponse(response.status)) {
    const location = response.headers.get('location');
    if (location) {
      const redirectUrl = new URL(location, targetUrl);
      if (!redirectUrl.search && url.search) {
        redirectUrl.search = url.search;
      }
      const redirectInit = {
        method: request.method,
        headers: buildProxyHeaders(request),
        redirect: 'manual',
      };
      if (requestBody) {
        redirectInit.body = requestBody.slice(0);
      }
      response = await fetch(redirectUrl.toString(), redirectInit);
    }
  }

  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'no-store');

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
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
