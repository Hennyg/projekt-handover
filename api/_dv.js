// api/_dv.js
const { getTenantId, getClientId, getClientSecret, getDvUrl, getDvCoreDataUrl } = require("./_env");

// token-cache pr. resource-url, så vi ikke henter et nyt token for hvert kald
const tokenCache = new Map();

async function getDvToken(resource) {
  const cached = tokenCache.get(resource);
  if (cached && cached.expiresAt > Date.now()) return cached.token;

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

  tokenCache.set(resource, {
    token: j.access_token,
    // lidt margin før udløb
    expiresAt: Date.now() + (Number(j.expires_in || 3600) - 60) * 1000
  });

  return j.access_token;
}

async function dvFetchAgainst(resource, path, { method = "GET", body = null, headers = {} } = {}) {
  const token = await getDvToken(resource);
  const url = `${resource}/api/data/v9.2/${path.replace(/^\//, "")}`;

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

async function fetchAllAgainst(resource, path) {
  const baseUrl = `${resource}/api/data/v9.2/`;
  let rows = [];
  let next = path;
  while (next) {
    const data = await dvFetchAgainst(resource, next);
    rows = rows.concat(data.value || []);
    const nl = data["@odata.nextLink"];
    next = nl && nl.startsWith(baseUrl) ? nl.slice(baseUrl.length) : null;
  }
  return rows;
}

// ---- Handover-miljøet (DV_URL) — bruges af api/handovers ----
async function dvFetch(path, opts) {
  return dvFetchAgainst(getDvUrl(), path, opts);
}

async function fetchAll(path) {
  return fetchAllAgainst(getDvUrl(), path);
}

// ---- Stamdata-miljøet (DV_COREDATA) — kunder/adresser/produkter ----
async function dvCoreFetch(path, opts) {
  return dvFetchAgainst(getDvCoreDataUrl(), path, opts);
}

async function fetchAllCore(path) {
  return fetchAllAgainst(getDvCoreDataUrl(), path);
}

module.exports = { dvFetch, fetchAll, dvCoreFetch, fetchAllCore };
