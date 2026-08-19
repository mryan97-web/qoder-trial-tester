// Generate PKCE pair and login URL for Qoder device login flow
// No machineToken needed — just generate a random machine_id

function base64UrlEncode(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function generatePKCE() {
  const verifierBytes = crypto.getRandomValues(new Uint8Array(32));
  const verifier = base64UrlEncode(verifierBytes);
  const challengeBuf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  const challenge = base64UrlEncode(challengeBuf);
  return { verifier, challenge };
}

function uuidv4() {
  const r = crypto.getRandomValues(new Uint8Array(16));
  r[6] = (r[6] & 0x0f) | 0x40;
  r[8] = (r[8] & 0x3f) | 0x80;
  const h = [...r].map(b => b.toString(16).padStart(2, '0'));
  return `${h.slice(0,4).join('')}-${h.slice(4,6).join('')}-${h.slice(6,8).join('')}-${h.slice(8,10).join('')}-${h.slice(10,16).join('')}`;
}

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const body = await request.json().catch(() => ({}));

    // Generate a random machine_id — we don't need a real machineToken for login
    const machineId = uuidv4();

    const { verifier, challenge } = await generatePKCE();
    const nonce = uuidv4();
    const sessionId = uuidv4();

    const CLI_CLIENT_ID = 'e883ade2-e6e3-4d6d-adf7-f92ceff5fdcb';
    const loginUrl = `https://qoder.com/device/selectAccounts?challenge=${challenge}&challenge_method=S256&nonce=${nonce}&machine_id=${machineId}&client_id=${CLI_CLIENT_ID}`;

    const sessionData = {
      sessionId,
      verifier,
      challenge,
      nonce,
      machineId,
      machineToken: body.machineToken || '',
      created: Date.now(),
    };

    if (env.SESSION_KV) {
      await env.SESSION_KV.put(sessionId, JSON.stringify(sessionData), { expirationTtl: 300 });
    }

    return new Response(JSON.stringify({
      sessionId,
      loginUrl,
      nonce,
      challenge,
      machineId,
      clientId: CLI_CLIENT_ID,
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
