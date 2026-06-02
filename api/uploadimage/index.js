// api/uploadimage/index.js
const { firstEnv, required } = require("../_env");
const { getGraphToken } = require("../_graph");

const SITE_ID = () => required("DELING_SPO_SITE_ID", firstEnv("DELING_SPO_SITE_ID"));
const DRIVE_ID = () => required("DELING_SPO_DRIVE_ID", firstEnv("DELING_SPO_DRIVE_ID"));
const ROOT_PATH = () => required("DELING_SPO_FILE_PATH", firstEnv("DELING_SPO_FILE_PATH"));

function json(context, status, body) {
  context.res = { status, headers: { "Content-Type": "application/json; charset=utf-8" }, body };
}

function safePart(s) {
  return String(s || "ukendt")
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "-")
    .replace(/\s+/g, " ")
    .slice(0, 80) || "ukendt";
}

function safeFileName(s) {
  const base = safePart(s || "billede.jpg");
  return base.includes(".") ? base : `${base}.jpg`;
}

async function getWebUrl(token, path) {
  const url = `https://graph.microsoft.com/v1.0/sites/${SITE_ID()}/drives/${DRIVE_ID()}/root:/${encodeURI(path)}`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) return "";
  const j = await r.json();
  return j.webUrl || "";
}

module.exports = async function (context, req) {
  try {
    const b = req.body || {};
    const handoverId = safePart(b.handoverId);
    const kundenummer = safePart(b.kundenummer);
    const fileName = `${Date.now()}-${safeFileName(b.fileName)}`;
    const year = new Date().getFullYear();

    if (!b.base64) return json(context, 400, { error: "base64 mangler" });

    const buffer = Buffer.from(String(b.base64), "base64");
    const relativePath = `${ROOT_PATH()}/${year}/${kundenummer}/${handoverId}/${fileName}`;

    const token = await getGraphToken();
    const uploadUrl = `https://graph.microsoft.com/v1.0/sites/${SITE_ID()}/drives/${DRIVE_ID()}/root:/${encodeURI(relativePath)}:/content`;

    const r = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": b.contentType || "application/octet-stream"
      },
      body: buffer
    });

    const j = await r.json();
    if (!r.ok) throw new Error(`Upload fejl ${r.status}: ${JSON.stringify(j)}`);

    const image = {
      name: fileName,
      path: relativePath,
      url: j.webUrl || await getWebUrl(token, relativePath),
      driveItemId: j.id || ""
    };

    return json(context, 200, { ok: true, image });
  } catch (e) {
    context.log("uploadimage error:", e.message);
    return json(context, 500, { error: e.message });
  }
};
