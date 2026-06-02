// api/downloadimages/index.js
const JSZip = require("jszip");
const { firstEnv, required } = require("../_env");
const { getGraphToken } = require("../_graph");

const SITE_ID = () => required("DELING_SPO_SITE_ID", firstEnv("DELING_SPO_SITE_ID"));
const DRIVE_ID = () => required("DELING_SPO_DRIVE_ID", firstEnv("DELING_SPO_DRIVE_ID"));

function safeFileName(s) {
  return String(s || "billede.jpg").replace(/[<>:"/\\|?*\x00-\x1F]/g, "-").slice(0, 120);
}

module.exports = async function (context, req) {
  try {
    const images = Array.isArray(req.body?.images) ? req.body.images : [];
    if (!images.length) {
      context.res = { status: 400, headers: { "Content-Type": "application/json; charset=utf-8" }, body: { error: "Ingen billeder markeret" } };
      return;
    }

    const token = await getGraphToken();
    const zip = new JSZip();

    for (const img of images) {
      if (!img.path) continue;
      const url = `https://graph.microsoft.com/v1.0/sites/${SITE_ID()}/drives/${DRIVE_ID()}/root:/${encodeURI(img.path)}:/content`;
      const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!r.ok) continue;
      const buf = Buffer.from(await r.arrayBuffer());
      zip.file(safeFileName(img.name || img.path.split("/").pop()), buf);
    }

    const zipBuf = await zip.generateAsync({ type: "nodebuffer" });
    const zipName = safeFileName(req.body?.zipName || "handover-billeder.zip");

    context.res = {
      status: 200,
      isRaw: true,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${zipName}"`
      },
      body: zipBuf
    };
  } catch (e) {
    context.log("downloadimages error:", e.message);
    context.res = { status: 500, headers: { "Content-Type": "application/json; charset=utf-8" }, body: { error: e.message } };
  }
};
