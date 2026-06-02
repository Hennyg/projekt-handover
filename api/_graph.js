// api/_graph.js
const { getTenantId, getClientId, getClientSecret } = require("./_env");

async function getGraphToken() {
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: getClientId(),
    client_secret: getClientSecret(),
    scope: "https://graph.microsoft.com/.default"
  });

  const r = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(getTenantId())}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });

  const j = await r.json();
  if (!r.ok) throw new Error(`Graph token fejl ${r.status}: ${JSON.stringify(j)}`);
  return j.access_token;
}

async function graphFetch(url, options = {}) {
  const token = await getGraphToken();
  const r = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.headers || {})
    }
  });

  const contentType = r.headers.get("content-type") || "";
  if (!r.ok) {
    const errText = await r.text();
    throw new Error(`Graph fejl ${r.status}: ${errText}`);
  }

  if (contentType.includes("application/json")) return r.json();
  return Buffer.from(await r.arrayBuffer());
}

module.exports = { getGraphToken, graphFetch };
