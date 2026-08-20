const VPS_BASE = 'http://54.210.94.74/qinject';

export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api/, '');
  const target = VPS_BASE + '/api' + path + url.search;

  const headers = new Headers(request.headers);
  headers.delete('host');
  headers.set('Accept', 'application/json');

  const opts = { method: request.method, headers };
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    opts.body = await request.text();
  }

  try {
    const resp = await fetch(target, opts);
    const body = await resp.text();
    return new Response(body, {
      status: resp.status,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      }
    });
  } catch(e) {
    return new Response(JSON.stringify({error: e.message}), {
      status: 502,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
