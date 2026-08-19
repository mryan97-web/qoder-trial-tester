// Poll Qoder openapi for device token
// Mirrors the CLI's polling behavior: GET /api/v1/deviceToken/poll

const OPENAPI_BASE = 'https://openapi.qoder.sh';
const CLI_VERSION = '1.1.26';

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const body = await request.json();
    const sessionId = body.sessionId;

    // Retrieve session data
    let session;
    if (env.SESSION_KV) {
      const stored = await env.SESSION_KV.get(sessionId);
      if (!stored) return json({ error: 'Session not found or expired' }, 400);
      session = JSON.parse(stored);
    } else {
      // KV not available — return error (frontend should pass session data)
      return json({ error: 'KV not configured, session data lost' }, 500);
    }

    // Build poll URL
    const pollUrl = `${OPENAPI_BASE}/api/v1/deviceToken/poll?nonce=${session.nonce}&verifier=${encodeURIComponent(session.verifier)}&challenge_method=S256`;

    // Build headers matching CLI traffic
    const headers = {
      'Accept': 'application/json',
      'X-Request-ID': crypto.randomUUID().toUpperCase(),
      'Cosy-Version': CLI_VERSION,
      'Cosy-ClientType': '5',
      'Cosy-MachineOS': 'x86_64_linux',
    };

    if (session.machineToken) {
      headers['Cosy-MachineToken'] = session.machineToken;
    }

    const resp = await fetch(pollUrl, { method: 'GET', headers });

    let respBody;
    const ct = resp.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
      respBody = await resp.json();
    } else {
      respBody = await resp.text();
    }

    // If token received, store it in session
    if (resp.status === 200 && respBody) {
      session.token = respBody;
      if (env.SESSION_KV) {
        await env.SESSION_KV.put(sessionId, JSON.stringify(session), { expirationTtl: 300 });
      }
    }

    return json({
      status: resp.status,
      body: respBody,
      url: pollUrl,
    });
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
