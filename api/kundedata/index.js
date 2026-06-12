// api/kundedata/index.js
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
  context.res = {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "private, max-age=300"
    },
    body
  };
}

function cell(row, i) {
  const v = row[i];
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

function dateCell(row, i) {
  const v = row[i];
  if (v === null || v === undefined || v === "") return "";
  if (typeof v === "number") return XLSX.SSF.format("dd-mm-yyyy", v);
  return String(v).trim();
}

function hasXPlaceholder(value) {
  return String(value || "").trim().toLowerCase().includes("xx");
}

function makeAddress(adresse, postnr, bynavn) {
  return {
    adresse,
    postnr,
    bynavn,
    by: [postnr, bynavn].filter(Boolean).join(" "),
    label: [adresse, postnr, bynavn].filter(Boolean).join(", ")
  };
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

  if (!fileR.ok) {
    throw new Error(`Excel download fejl ${fileR.status}: ${await fileR.text()}`);
  }

  return {
    buf: Buffer.from(await fileR.arrayBuffer()),
    lastModified
  };
}

function parseWorkbook(buf, lastModified) {
  const wb = XLSX.read(buf, { type: "buffer" });
  const ws = wb.Sheets[SHEET_NAME] || wb.Sheets[wb.SheetNames[0]];

  if (!ws) {
    throw new Error("Ingen ark fundet i Excel-filen.");
  }

  const rows = XLSX.utils.sheet_to_json(ws, { defval: "", header: 1 });
  const dataRows = rows.slice(2);

  const kundeMap = new Map();
  const produkter = [];
  const firstCustomerRowSeen = new Set();

  let lastKundenavn = "";
  let lastAdresse = "";
  let lastPostnr = "";
  let lastBynavn = "";
  let lastOmraade = "";
  let lastKundenr = "";

  for (const row of dataRows) {
    const rawKundenavn = cell(row, 0);
    const rawAdresse = cell(row, 1);
    const rawPostnr = cell(row, 2);
    const rawBynavn = cell(row, 3);
    const rawOmraade = cell(row, 4);
    const rawKundenr = cell(row, 5);

    if (rawKundenavn) lastKundenavn = rawKundenavn;
    if (rawAdresse) lastAdresse = rawAdresse;
    if (rawPostnr) lastPostnr = rawPostnr;
    if (rawBynavn) lastBynavn = rawBynavn;
    if (rawOmraade) lastOmraade = rawOmraade;
    if (rawKundenr) lastKundenr = rawKundenr;

    const kundenavn = lastKundenavn;
    const adresse = lastAdresse;
    const postnr = lastPostnr;
    const bynavn = lastBynavn;
    const omraade = lastOmraade;
    const kundenr = lastKundenr;

    const produkt = cell(row, 6);
    const produktnr = cell(row, 7);
    const serienr = cell(row, 8);
    const installDato = dateCell(row, 9);
    const currentInstDato = dateCell(row, 10);
    const garantiIndtil = dateCell(row, 11);
    const chr = cell(row, 12);
    const note = cell(row, 13);
    const kontrakt = cell(row, 14);

    if (!kundenavn && !kundenr) continue;

    const kundeKey = kundenr || kundenavn;

    if (!kundeMap.has(kundeKey)) {
      kundeMap.set(kundeKey, {
        kundenr,
        navn: kundenavn,
        adresse,
        postnr,
        bynavn,
        by: [postnr, bynavn].filter(Boolean).join(" "),
        omraade,
        kontrakt,
        _adresseKeys: new Set(),
        adresser: []
      });
    }

    const kunde = kundeMap.get(kundeKey);

    const adresseKey = [adresse, postnr, bynavn].join("|").toLowerCase();
    if (adresse && !kunde._adresseKeys.has(adresseKey)) {
      kunde._adresseKeys.add(adresseKey);
      kunde.adresser.push(makeAddress(adresse, postnr, bynavn));
    }

    if (!firstCustomerRowSeen.has(kundeKey)) {
      firstCustomerRowSeen.add(kundeKey);
      continue;
    }

    if (!produkt) continue;
    if (!hasXPlaceholder(installDato)) continue;

    produkter.push({
      kundenr,
      kundenavn,
      adresse,
      postnr,
      bynavn,
      by: [postnr, bynavn].filter(Boolean).join(" "),
      produkt,
      produktnr,
      serienr,
      installDato,
      currentInstDato,
      garantiIndtil,
      chr,
      note,
      kontrakt
    });
  }

  const kunder = Array.from(kundeMap.values())
    .map(({ _adresseKeys, ...rest }) => rest)
    .sort((a, b) => String(a.navn || "").localeCompare(String(b.navn || ""), "da", { sensitivity: "base" }));

  produkter.sort((a, b) =>
    [a.kundenavn, a.produkt, a.produktnr].join(" ")
      .localeCompare([b.kundenavn, b.produkt, b.produktnr].join(" "), "da", { numeric: true })
  );

  return {
    lastModified,
    kunder,
    produkter,
    totalKunder: kunder.length,
    totalProdukter: produkter.length
  };
}

async function getData() {
  const now = Date.now();

  if (!cache || now - cacheTime > CACHE_TTL) {
    const { buf, lastModified } = await downloadExcel();
    cache = parseWorkbook(buf, lastModified);
    cacheTime = now;
  }

  return cache;
}

module.exports = async function (context, req) {
  try {
    const data = await getData();

    return json(context, 200, {
      lastModified: data.lastModified,
      kunder: data.kunder,
      produkter: data.produkter,
      totalKunder: data.totalKunder,
      totalProdukter: data.totalProdukter
    });
  } catch (e) {
    context.log("kundedata error:", e.message);

    return json(context, 500, {
      error: e.message,
      kunder: [],
      produkter: []
    });
  }
};
