// api/rawdata/index.js
// Debug-API: læser regnearket og returnerer kolonne A-O som rådata uden nogen behandling.
// Brug: /api/rawdata?skip=0&take=20&kundenr=0080002192
// Slet denne fil når fejlfinding er færdig.

const XLSX = require("xlsx");
const { firstEnv, required } = require("../_env");
const { getGraphToken } = require("../_graph");

const SPO_SITE_ID = () => required("DELING_SPO_SITE_ID", firstEnv("DELING_SPO_SITE_ID", "KUNDER_SPO_SITE_ID"));
const SPO_DRIVE_ID = () => required("DELING_SPO_DRIVE_ID", firstEnv("DELING_SPO_DRIVE_ID", "KUNDER_SPO_DRIVE_ID"));
const EXCEL_PATH = () => required("KUNDER_SPO_FILE_PATH", firstEnv("KUNDER_SPO_FILE_PATH", "KUNDELISTE_SPO_FILE_PATH"));
const SHEET_NAME = firstEnv("KUNDER_SPO_SHEET", "KUNDELISTE_SPO_SHEET") || "Lely Center Herrup";

const HEADERS = ["A_navn","B_adresse","C_postnr","D_by","E_område","F_kundenr","G_produkt","H_produktnr","I_serienr","J_installDato","K_currentInst","L_garanti","M_chr","N_note","O_kontraktType"];

function json(context, status, body) {
  context.res = { status, headers: { "Content-Type": "application/json; charset=utf-8" }, body };
}

module.exports = async function (context, req) {
  try {
    const token = await getGraphToken();
    const base = `https://graph.microsoft.com/v1.0/sites/${SPO_SITE_ID()}/drives/${SPO_DRIVE_ID()}/root:/${EXCEL_PATH()}`;
    const fileR = await fetch(`${base}:/content`, { headers: { Authorization: `Bearer ${token}` } });
    if (!fileR.ok) throw new Error(`Download fejl ${fileR.status}`);

    const buf = Buffer.from(await fileR.arrayBuffer());
    const wb = XLSX.read(buf, { type: "buffer" });
    const ws = wb.Sheets[SHEET_NAME] || wb.Sheets[wb.SheetNames[0]];
    if (!ws) throw new Error("Ark ikke fundet");

    // Læs alle rækker som rådata — ingen formatering, ingen konvertering
    const allRows = XLSX.utils.sheet_to_json(ws, { defval: "", header: 1 });

    // Filtrér parametre
    const kundenr = String(req.query.kundenr || "").trim();
    const skip = parseInt(req.query.skip || "0", 10);
    const take = Math.min(parseInt(req.query.take || "50", 10), 200);

    // Konvertér til objekter med kolonnenavne A-O
    const rows = allRows.map((row, i) => {
      const obj = { _row: i + 1 };
      HEADERS.forEach((h, j) => { obj[h] = row[j]; });
      return obj;
    });

    // Filtrer på kundenr hvis angivet (søger i kolonne F)
    const filtered = kundenr
      ? rows.filter(r => String(r.F_kundenr || "").trim() === kundenr)
      : rows;

    return json(context, 200, {
      total: filtered.length,
      skip,
      take,
      rows: filtered.slice(skip, skip + take)
    });
  } catch (e) {
    context.log("rawdata error:", e.message);
    return json(context, 500, { error: e.message });
  }
};
