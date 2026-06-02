// api/getroles/index.js
const { getPrincipal } = require("../_auth");
const { getGraphToken } = require("../_graph");

const ROLE_NAMES = ["portal_projekt-handover", "portal_admin"];

function json(context, status, body) {
  context.res = { status, headers: { "Content-Type": "application/json; charset=utf-8" }, body };
}

async function getUserIdByUpn(token, upn) {
  const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(upn)}?$select=id,userPrincipalName`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const j = await r.json();
  if (!r.ok) throw new Error(`Graph user lookup fejl ${r.status}: ${JSON.stringify(j)}`);
  return j.id;
}

async function getRoleGroups(token) {
  const filter = ROLE_NAMES.map(n => `displayName eq '${n.replace(/'/g, "''")}'`).join(" or ");
  const url = `https://graph.microsoft.com/v1.0/groups?$select=id,displayName&$filter=${encodeURIComponent(filter)}`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}`, ConsistencyLevel: "eventual" } });
  const j = await r.json();
  if (!r.ok) throw new Error(`Graph groups fejl ${r.status}: ${JSON.stringify(j)}`);

  const map = new Map();
  for (const g of j.value || []) map.set(String(g.id).toLowerCase(), String(g.displayName).toLowerCase());
  return map;
}

async function getMemberGroups(token, userId) {
  const r = await fetch(`https://graph.microsoft.com/v1.0/users/${userId}/getMemberGroups`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ securityEnabledOnly: false })
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`Graph getMemberGroups fejl ${r.status}: ${JSON.stringify(j)}`);
  return (j.value || []).map(x => String(x).toLowerCase());
}

module.exports = async function (context, req) {
  try {
    const cp = getPrincipal(req);
    if (!cp) return json(context, 200, []);

    const roles = new Set();

    for (const r of cp.userRoles || []) {
      const role = String(r).toLowerCase();
      if (ROLE_NAMES.includes(role)) roles.add(role);
    }

    for (const c of cp.claims || []) {
      const t = String(c.typ || "").toLowerCase();
      if (t === "roles" || t === "role" || t.endsWith("/identity/claims/role")) {
        const role = String(c.val || "").toLowerCase();
        if (ROLE_NAMES.includes(role)) roles.add(role);
      }
    }

    try {
      const token = await getGraphToken();
      const userId = await getUserIdByUpn(token, cp.userDetails);
      const roleGroups = await getRoleGroups(token);
      const memberGroupIds = await getMemberGroups(token, userId);

      for (const id of memberGroupIds) {
        const roleName = roleGroups.get(id);
        if (roleName) roles.add(roleName);
      }
    } catch (e) {
      context.log("Graph rolleopslag fejlede:", e.message);
    }

    return json(context, 200, Array.from(roles));
  } catch (e) {
    context.log("getroles error:", e.message);
    return json(context, 200, []);
  }
};
