// api/kunder/index.js
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

async function downloadExcel() {
  const token = await getGraphToken();
  const base = `https://graph.microsoft.com/v1.0/sites/${SPO_SITE_ID()}/drives/${SPO_DRIVE_ID()}/root:/${EXCEL_PATH()}`;
  const [metaR, fileR] = await Promise.all([
    fetch(base, { headers: { Authorization: `Bearer ${token}` } }),
    fetch(`${base}:/content`, { headers: { Authorization: `Bearer ${token}` } })
  ]);

  let lastModified = null;
  if (metaR.ok) {
    const meta = await metaR.json();
    lastModified = meta.lastModifiedDateTime || null;
  }

  if (!fileR.ok) throw new Error(`Excel download fejl ${fileR.status}: ${await fileR.text()}`);
  const buf = Buffer.from(await fileR.arrayBuffer());
  return { buf, lastModified };
}

function cell(row, i) {
  return String(row[i] ?? "").trim();
}

function readWorkbook(buf, lastModified) {
  const wb = XLSX.read(buf, { type: "buffer" });
  const ws = wb.Sheets[SHEET_NAME] || wb.Sheets[wb.SheetNames[0]];
  if (!ws) throw new Error("Ingen ark fundet i Excel-filen.");

  const rows = XLSX.utils.sheet_to_json(ws, { defval: "", header: 1 });
  const dataRows = rows.slice(2);

  const kundeMap = new Map();

  for (const row of dataRows) {
    const navn = cell(row, 0);
    const kundenr = cell(row, 5);
    if (!navn && !kundenr) continue;

    const key = kundenr || navn;
    if (!kundeMap.has(key)) {
      kundeMap.set(key, {
        navn,
        adresse: cell(row, 1),
        postnr: cell(row, 2),
        bynavn: cell(row, 3),
        by: [cell(row, 2), cell(row, 3)].filter(Boolean).join(" "),
        omraade: cell(row, 4),
        kundenr,
        kontrakt: cell(row, 14)
      });
    }
  }

  return {
    kunder: Array.from(kundeMap.values()),
    total: kundeMap.size,
    lastModified
  };
}

async function getData() {
  const now = Date.now();
  if (!cache || now - cacheTime > CACHE_TTL) {
    const { buf, lastModified } = await downloadExcel();
    cache = readWorkbook(buf, lastModified);
    cacheTime = now;
  }
  return cache;
}

module.exports = async function (context, req) {
  try {
    const data = await getData();
    const q = String(req.query.q || "").trim().toLowerCase();

    const kunder = q.length >= 2
      ? data.kunder.filter(k => [k.navn, k.adresse, k.by, k.kundenr, k.omraade, k.kontrakt].join(" ").toLowerCase().includes(q)).slice(0, 50)
      : data.kunder;

    return json(context, 200, { kunder, total: data.total, lastModified: data.lastModified });
  } catch (e) {
    context.log("kunder error:", e.message);
    return json(context, 500, { error: e.message, kunder: [] });
  }
};
