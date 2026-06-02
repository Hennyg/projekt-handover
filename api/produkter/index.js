// api/produkter/index.js
const XLSX = require("xlsx");
const { firstEnv, required } = require("../_env");
const { getGraphToken } = require("../_graph");

const SPO_SITE_ID = () => required("DELING_SPO_SITE_ID", firstEnv("DELING_SPO_SITE_ID", "KUNDER_SPO_SITE_ID"));
const SPO_DRIVE_ID = () => required("DELING_SPO_DRIVE_ID", firstEnv("DELING_SPO_DRIVE_ID", "KUNDER_SPO_DRIVE_ID"));
const EXCEL_PATH = () => required("KUNDER_SPO_FILE_PATH", firstEnv("KUNDER_SPO_FILE_PATH", "KUNDELISTE_SPO_FILE_PATH"));
const SHEET_NAME = firstEnv("KUNDER_SPO_SHEET", "KUNDELISTE_SPO_SHEET") || "Lely Center Herrup";

let cache = null;
let cacheTime = 0;
const CACHE_TTL = 5 * 60 * 1000;

function json(context, status, body) {
  context.res = { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "private, max-age=300" }, body };
}

function cell(row, i) {
  return String(row[i] ?? "").trim();
}

async function downloadExcel() {
  const token = await getGraphToken();
  const base = `https://graph.microsoft.com/v1.0/sites/${SPO_SITE_ID()}/drives/${SPO_DRIVE_ID()}/root:/${EXCEL_PATH()}`;
  const r = await fetch(`${base}:/content`, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`Excel download fejl ${r.status}: ${await r.text()}`);
  return Buffer.from(await r.arrayBuffer());
}

function parseProducts(buf) {
  const wb = XLSX.read(buf, { type: "buffer" });
  const ws = wb.Sheets[SHEET_NAME] || wb.Sheets[wb.SheetNames[0]];
  if (!ws) throw new Error("Ingen ark fundet i Excel-filen.");

  const rows = XLSX.utils.sheet_to_json(ws, { defval: "", header: 1 });
  const dataRows = rows.slice(2);

  return dataRows.map(row => ({
    kundenavn: cell(row, 0),
    kundenr: cell(row, 5),
    produkt: cell(row, 6),
    produktnr: cell(row, 7),
    serienr: cell(row, 8),
    installDato: cell(row, 9),
    currentInstDato: cell(row, 10),
    kontrakt: cell(row, 14)
  })).filter(p => p.kundenavn || p.kundenr || p.produkt);
}

async function getProducts() {
  const now = Date.now();
  if (!cache || now - cacheTime > CACHE_TTL) {
    cache = parseProducts(await downloadExcel());
    cacheTime = now;
  }
  return cache;
}

module.exports = async function (context, req) {
  try {
    const kundenr = String(req.query.kundenr || "").trim().toLowerCase();
    const kundenavn = String(req.query.kundenavn || "").trim().toLowerCase();

    if (!kundenr && !kundenavn) {
      return json(context, 400, { error: "kundenr eller kundenavn mangler", produkter: [] });
    }

    const all = await getProducts();
    const validSerial = /^\d{2}-\d{2}-\d{4}$/;

    const seen = new Set();
    const produkter = all.filter(p => {
      const customerMatch = kundenr
        ? String(p.kundenr || "").trim().toLowerCase() === kundenr
        : String(p.kundenavn || "").trim().toLowerCase() === kundenavn;

      if (!customerMatch) return false;
      if (!validSerial.test(String(p.serienr || "").trim())) return false;
      if (!p.produkt) return false;

      const key = [p.produkt, p.produktnr, p.serienr].join("|").toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return json(context, 200, { produkter, total: produkter.length });
  } catch (e) {
    context.log("produkter error:", e.message);
    return json(context, 500, { error: e.message, produkter: [] });
  }
};
