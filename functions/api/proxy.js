// Proxy endpoint — forwards requests to Qoder API servers
// Allows: openapi.qoder.sh + center.qoder.sh
export async function onRequestPost(context) {
  const { request } = context;
  try {
    const body = await request.json();
    const url = body.url;
    const method = body.method || 'GET';
    const headers = body.headers || {};
    const reqBody = body.body || null;

    const ALLOWED = [
      'https://openapi.qoder.sh/',
      'https://center.qoder.sh/',
    ];

    if (!url || !ALLOWED.some(prefix => url.startsWith(prefix))) {
      return new Response(JSON.stringify({ error: 'Invalid URL: ' + url }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const fetchOpts = { method, headers };
    if (reqBody && method !== 'GET') {
      fetchOpts.body = reqBody;
    }

    const resp = await fetch(url, fetchOpts);
    const respBody = await resp.text();

    return new Response(JSON.stringify({
      status: resp.status,
      body: respBody,
      headers: {
        'content-type': resp.headers.get('content-type') || '',
      },
    }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
