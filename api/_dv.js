// api/_dv.js
const { getTenantId, getClientId, getClientSecret, getDvUrl } = require("./_env");

async function getDvToken() {
  const resource = getDvUrl();

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: getClientId(),
    client_secret: getClientSecret(),
    scope: `${resource}/.default`
  });

  const r = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(getTenantId())}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });

  const j = await r.json();
  if (!r.ok) throw new Error(`Dataverse token fejl ${r.status}: ${JSON.stringify(j)}`);
  return j.access_token;
}

async function dvFetch(path, { method = "GET", body = null, headers = {} } = {}) {
  const token = await getDvToken();
  const url = `${getDvUrl()}/api/data/v9.2/${path.replace(/^\//, "")}`;

  const r = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json; charset=utf-8",
      "OData-MaxVersion": "4.0",
      "OData-Version": "4.0",
      ...headers
    },
    body: body ? JSON.stringify(body) : undefined
  });

  const txt = await r.text();
  let data = null;
  try { data = txt ? JSON.parse(txt) : null; } catch { data = txt; }

  if (!r.ok) {
    const msg = data?.error?.message || data?.message || txt;
    const e = new Error(`Dataverse fejl ${r.status}: ${msg}`);
    e.status = r.status;
    e.data = data;
    throw e;
  }

  return data;
}

module.exports = { dvFetch };
