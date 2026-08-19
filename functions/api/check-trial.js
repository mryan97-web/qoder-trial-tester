// Check trial activation status via Qoder userinfo endpoint
// GET /api/v1/userinfo with auth token + machineToken headers

const OPENAPI_BASE = 'https://openapi.qoder.sh';
const CLI_VERSION = '1.1.26';

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const body = await request.json();
    const sessionId = body.sessionId;
    const clientType = body.clientType || '5';
    const machineOs = body.machineOs || 'x86_64_linux';
    const spoofVm = body.spoofVm || false;
    const machineTokenBody = body.machineToken || '';

    // Get session data
    let session;
    let machineToken = machineTokenBody;
    let tokenData = body.tokenData;

    if (env.SESSION_KV && sessionId) {
      const stored = await env.SESSION_KV.get(sessionId);
      if (stored) {
        session = JSON.parse(stored);
        machineToken = machineToken || session.machineToken || '';
        tokenData = tokenData || session.token;
      }
    }

    // Extract auth token from login response
    const authToken = (tokenData && (tokenData.token || tokenData.access_token || tokenData.security_oauth_token)) || '';

    const effectiveOs = spoofVm ? 'arm64_darwin' : machineOs;

    const headers = {
      'Accept': 'application/json',
      'X-Request-ID': crypto.randomUUID().toUpperCase(),
      'Cosy-Version': CLI_VERSION,
      'Cosy-ClientType': clientType,
      'Cosy-MachineOS': effectiveOs,
    };
    if (machineToken) headers['Cosy-MachineToken'] = machineToken;
    if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

    const userinfoUrl = `${OPENAPI_BASE}/api/v1/userinfo`;
    const resp = await fetch(userinfoUrl, { method: 'GET', headers });

    let respBody;
    const ct = resp.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
      respBody = await resp.json();
    } else {
      respBody = await resp.text();
    }

    const analysis = {
      spoofed: spoofVm,
      effectiveMachineOS: effectiveOs,
      apiCall: {
        url: userinfoUrl,
        headers: {
          'Cosy-ClientType': clientType,
          'Cosy-MachineOS': effectiveOs,
          'Cosy-MachineToken': machineToken ? machineToken.substring(0, 20) + '...' : 'none',
          'Authorization': authToken ? `Bearer ${authToken.substring(0, 20)}...` : 'none',
        },
      },
      apiResponse: {
        status: resp.status,
        body: respBody,
      },
    };

    if (resp.status === 200) {
      const bd = typeof respBody === 'object' ? respBody : {};
      analysis.trialActivated = true;
      analysis.planType = bd.planType || bd.plan || 'unknown';
      analysis.credits = bd.credits || bd.remainingCredits || 'unknown';
    } else if (resp.status === 401) {
      analysis.trialActivated = false;
      analysis.errorCode = '401';
      analysis.errorDesc = 'Unauthorized — invalid or expired token';
    } else if (resp.status === 403 || resp.status === 429) {
      const bd = typeof respBody === 'object' ? respBody : {};
      const errCode = bd.errorCode || bd.code || String(resp.status);
      const errMsg = bd.errorMessage || bd.message || '';
      analysis.trialActivated = false;
      analysis.errorCode = errCode;
      analysis.errorDesc = errMsg;
      if (String(errCode) === '114') {
        analysis.errorDesc = 'freeTrialAccountsExceeded — VM detected or multiple trial accounts';
      }
    } else {
      analysis.trialActivated = false;
      analysis.errorCode = String(resp.status || 'unknown');
      analysis.errorDesc = 'Unexpected response';
    }

    return json(analysis);
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
