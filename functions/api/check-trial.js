// Trial ACTIVATOR — calls /api/v1/userinfo to trigger trial grant
// KEY INSIGHT: /api/v1/userinfo does NOT require Cosy-MachineToken
// Trial is granted server-side when this endpoint is called with a new token
// VM check happens separately at /api/v3/user/status — we skip that

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
    const tokenData = body.tokenData;

    // Get session data from KV
    let session;
    let tokenDataResolved = tokenData;
    if (env.SESSION_KV && sessionId) {
      const stored = await env.SESSION_KV.get(sessionId);
      if (stored) {
        session = JSON.parse(stored);
        tokenDataResolved = tokenDataResolved || session.token;
      }
    }

    // Extract auth token
    const authToken = (tokenDataResolved && (tokenDataResolved.token || tokenDataResolved.access_token || tokenDataResolved.security_oauth_token)) || '';

    if (!authToken) {
      return json({ error: 'No auth token — login first' }, 400);
    }

    const effectiveOs = spoofVm ? 'arm64_darwin' : machineOs;

    // === STEP A: Call /api/v1/userinfo WITHOUT MachineToken ===
    // This is what triggers the trial grant server-side
    // openApiJsonRequest only sends: Accept, User-Agent, Authorization
    // The ko() wrapper adds: Cosy-Version, Cosy-ClientType, Cosy-MachineOS
    // NO Cosy-MachineToken is sent here!
    const userinfoHeaders = {
      'Accept': 'application/json',
      'User-Agent': `qoder/${CLI_VERSION}`,
      'Authorization': `Bearer ${authToken}`,
      'Cosy-Version': CLI_VERSION,
      'Cosy-ClientType': clientType,
      'Cosy-MachineOS': effectiveOs,
    };

    const userinfoUrl = `${OPENAPI_BASE}/api/v1/userinfo`;
    const userinfoResp = await fetch(userinfoUrl, { method: 'GET', headers: userinfoHeaders });

    let userinfoBody;
    const ct = userinfoResp.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
      userinfoBody = await userinfoResp.json();
    } else {
      userinfoBody = await userinfoResp.text();
    }

    const result = {
      stepA_activate: {
        url: userinfoUrl,
        method: 'GET',
        headersSent: {
          'Authorization': `Bearer ${authToken.substring(0, 20)}...`,
          'Cosy-Version': CLI_VERSION,
          'Cosy-ClientType': clientType,
          'Cosy-MachineOS': effectiveOs,
          'Cosy-MachineToken': 'NOT SENT (key: trial grant does not require this)',
        },
        status: userinfoResp.status,
        body: userinfoBody,
      },
    };

    if (userinfoResp.status === 200) {
      const bd = typeof userinfoBody === 'object' ? userinfoBody : {};
      result.stepA_activate.trialActivated = true;
      result.stepA_activate.uid = bd.uid || bd.id || bd.user_id || 'unknown';
      result.stepA_activate.email = bd.email || 'unknown';
      result.stepA_activate.organization = bd.organization_name || bd.orgName || 'unknown';
    }

    // === STEP B: Check /api/v2/user/plan (GET — shows plan + credits) ===
    const planHeaders = {
      'Accept': 'application/json',
      'Authorization': `Bearer ${authToken}`,
      'Cosy-Version': CLI_VERSION,
      'Cosy-ClientType': clientType,
      'Cosy-MachineOS': effectiveOs,
    };

    const planUrl = `${OPENAPI_BASE}/api/v2/user/plan`;
    const planResp = await fetch(planUrl, { method: 'GET', headers: planHeaders });

    let planBody;
    const ct2 = planResp.headers.get('content-type') || '';
    if (ct2.includes('application/json')) {
      planBody = await planResp.json();
    } else {
      planBody = await planResp.text();
    }

    result.stepB_plan = {
      url: planUrl,
      status: planResp.status,
      body: planBody,
    };

    if (planResp.status === 200 && typeof planBody === 'object') {
      result.stepB_plan.userType = planBody.user_type || planBody.userType || 'unknown';
      result.stepB_plan.plan = planBody.plan || planBody.plan_type || 'unknown';
    }

    // === STEP C: Check /api/v2/quota/usage (GET — shows credits) ===
    const quotaHeaders = {
      'Accept': 'application/json',
      'Authorization': `Bearer ${authToken}`,
      'Cosy-Version': CLI_VERSION,
      'Cosy-ClientType': clientType,
      'Cosy-MachineOS': effectiveOs,
    };

    const quotaUrl = `${OPENAPI_BASE}/api/v2/quota/usage`;
    const quotaResp = await fetch(quotaUrl, { method: 'GET', headers: quotaHeaders });

    let quotaBody;
    const ct3 = quotaResp.headers.get('content-type') || '';
    if (ct3.includes('application/json')) {
      quotaBody = await quotaResp.json();
    } else {
      quotaBody = await quotaResp.text();
    }

    result.stepC_credits = {
      url: quotaUrl,
      status: quotaResp.status,
      body: quotaBody,
    };

    // === STEP D (OPTIONAL): Call /api/v3/user/status WITH MachineToken ===
    // This is where VM check happens — we do this LAST and optionally
    // Only if user provided a machineToken
    if (machineTokenBody) {
      const statusHeaders = {
        'Accept': 'application/json',
        'Authorization': `Bearer ${authToken}`,
        'Cosy-Version': CLI_VERSION,
        'Cosy-ClientType': clientType,
        'Cosy-MachineOS': effectiveOs,
        'Cosy-MachineToken': machineTokenBody,
      };

      const statusUrl = `${OPENAPI_BASE}/api/v3/user/status`;
      const statusResp = await fetch(statusUrl, { method: 'GET', headers: statusHeaders });

      let statusBody;
      const ct4 = statusResp.headers.get('content-type') || '';
      if (ct4.includes('application/json')) {
        statusBody = await statusResp.json();
      } else {
        statusBody = await statusResp.text();
      }

      result.stepD_vmCheck = {
        url: statusUrl,
        status: statusResp.status,
        body: statusBody,
        note: 'This is where VM detection happens — MachineToken sent here',
      };

      if (statusResp.status === 403 && typeof statusBody === 'object') {
        const errCode = statusBody.errorCode || statusBody.code || '';
        if (String(errCode) === '114' || String(statusBody.message || '').includes('freeTrial')) {
          result.stepD_vmCheck.vmBlocked = true;
          result.stepD_vmCheck.errorCode = errCode;
          result.stepD_vmCheck.errorDesc = 'freeTrialAccountsExceeded — VM detected';
        }
      }
    }

    // Summary
    result.summary = {
      trialActivated: result.stepA_activate.trialActivated || false,
      uid: result.stepA_activate.uid || 'unknown',
      plan: result.stepB_plan.plan || 'unknown',
      credits: result.stepC_credits.body || 'unknown',
      vmChecked: !!machineTokenBody,
      vmBlocked: result.stepD_vmCheck?.vmBlocked || false,
    };

    return json(result);
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
