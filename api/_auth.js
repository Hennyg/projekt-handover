// api/_auth.js
function getPrincipal(req) {
  const b64 = req.headers["x-ms-client-principal"];
  if (!b64) return null;
  try {
    return JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

function getUserName(req) {
  const cp = getPrincipal(req);
  return cp?.userDetails || "";
}

module.exports = { getPrincipal, getUserName };
