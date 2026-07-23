// api/kundedata/index.js
const { fetchAllCore } = require("../_dv");

const KUNDE_TABLE = "cr1eb_lch_kundes";
const ADRESSE_TABLE = "cr1eb_lch_kundeadresses";
const PRODUKT_TABLE = "cr1eb_lch_kundeprodukts";

const KUNDE_SELECT = [
  "cr1eb_lch_kundeid",
  "cr1eb_lch_kundenr",
  "cr1eb_lch_navn",
  "cr1eb_lch_omraade"
].join(",");

const ADRESSE_SELECT = [
  "cr1eb_lch_kundeadresseid",
  "cr1eb_lch_adressekey",
  "cr1eb_lch_adresse",
  "cr1eb_lch_postnr",
  "cr1eb_lch_by",
  "cr1eb_lch_omraade",
  "_cr1eb_lch_kunde_value"
].join(",");

// Kun produkter hvor installationsdato stadig er en uudfyldt placeholder ("xx-xx-xxxx")
// OG der ikke allerede er lavet en handover (cr1eb_lch_handover_status = nej/tomt)
const PRODUKT_SELECT = [
  "cr1eb_lch_kundeproduktid",
  "cr1eb_lch_kundenr",
  "cr1eb_lch_adressekey",
  "cr1eb_lch_produkt",
  "cr1eb_lch_produktnr",
  "cr1eb_lch_serienr",
  "cr1eb_lch_kontrakt",
  "cr1eb_lch_installationsdato",
  "cr1eb_lch_garantiudloeb"
].join(",");

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

async function loadFromDataverse() {
  const [kundeRows, adresseRows, produktRows] = await Promise.all([
    fetchAllCore(`${KUNDE_TABLE}?$select=${KUNDE_SELECT}&$top=5000`),
    fetchAllCore(`${ADRESSE_TABLE}?$select=${ADRESSE_SELECT}&$top=5000`),
    fetchAllCore(`${PRODUKT_TABLE}?$select=${PRODUKT_SELECT}&$filter=${encodeURIComponent("cr1eb_lch_installationsdato eq 'xx-xx-xxxx' and (cr1eb_lch_handover_status eq false or cr1eb_lch_handover_status eq null)")}&$top=5000`)
  ]);

  // Kundekort pr. kunde-id (guid), så adresser kan grupperes korrekt
  const kundeById = new Map();
  const kundenrToId = new Map();

  for (const r of kundeRows) {
    const id = r.cr1eb_lch_kundeid;
    const kundenr = r.cr1eb_lch_kundenr || "";
    kundeById.set(id, {
      kundenr,
      navn: r.cr1eb_lch_navn || "",
      omraade: r.cr1eb_lch_omraade || "",
      adresse: "",
      postnr: "",
      bynavn: "",
      by: "",
      kontrakt: "",
      _kontraktSet: new Set(),
      _adresseKeys: new Set(),
      adresser: []
    });
    if (kundenr) kundenrToId.set(kundenr, id);
  }

  for (const r of adresseRows) {
    const kundeId = r._cr1eb_lch_kunde_value;
    const kunde = kundeById.get(kundeId);
    if (!kunde) continue;

    const adresse = r.cr1eb_lch_adresse || "";
    const postnr = r.cr1eb_lch_postnr || "";
    const bynavn = r.cr1eb_lch_by || "";
    const by = [postnr, bynavn].filter(Boolean).join(" ");
    const adresseKey = [adresse, postnr, bynavn].join("|");

    if (adresse && !kunde._adresseKeys.has(adresseKey)) {
      kunde._adresseKeys.add(adresseKey);
      kunde.adresser.push({
        adresse,
        postnr,
        bynavn,
        by,
        label: [adresse, postnr, bynavn].filter(Boolean).join(", ")
      });
    }
  }

  // Primær adresse pr. kunde = første adresse (bruges til flade felter/søgning)
  for (const kunde of kundeById.values()) {
    const first = kunde.adresser[0];
    if (first) {
      kunde.adresse = first.adresse;
      kunde.postnr = first.postnr;
      kunde.bynavn = first.bynavn;
      kunde.by = first.by;
    }
  }

  const produkter = [];
  for (const r of produktRows) {
    const kundenr = r.cr1eb_lch_kundenr || "";
    const kundeId = kundenrToId.get(kundenr);
    const kunde = kundeId ? kundeById.get(kundeId) : null;
    const kontrakt = r.cr1eb_lch_kontrakt || "";

    if (kunde && kontrakt) kunde._kontraktSet.add(kontrakt);

    produkter.push({
      id: r.cr1eb_lch_kundeproduktid,
      kundenr,
      kundenavn: kunde ? kunde.navn : "",
      adressekey: r.cr1eb_lch_adressekey || "",
      produkt: r.cr1eb_lch_produkt || "",
      produktnr: r.cr1eb_lch_produktnr || "",
      serienr: r.cr1eb_lch_serienr || "",
      installDato: r.cr1eb_lch_installationsdato || "",
      garantiIndtil: r.cr1eb_lch_garantiudloeb || "",
      kontrakt
    });
  }

  const kunder = Array.from(kundeById.values())
    .map(({ _adresseKeys, _kontraktSet, ...rest }) => ({
      ...rest,
      kontrakt: Array.from(_kontraktSet).join(", ")
    }))
    .sort((a, b) => String(a.navn || "").localeCompare(String(b.navn || ""), "da", { sensitivity: "base" }));

  produkter.sort((a, b) =>
    [a.kundenavn, a.produkt, a.produktnr].join(" ")
      .localeCompare([b.kundenavn, b.produkt, b.produktnr].join(" "), "da", { numeric: true })
  );

  return {
    kunder,
    produkter,
    totalKunder: kunder.length,
    totalProdukter: produkter.length
  };
}

async function getData() {
  const now = Date.now();

  if (!cache || now - cacheTime > CACHE_TTL) {
    cache = await loadFromDataverse();
    cacheTime = now;
  }

  return cache;
}

module.exports = async function (context, req) {
  try {
    if (req.query.refresh === "1") {
      cache = null;
    }

    const data = await getData();

    // ?debug=produkter&kundenr=0080002192 — vis produkter for en kunde
    if (req.query.debug === "produkter") {
      const kundenr = req.query.kundenr || "";
      const sample = data.produkter
        .filter(p => !kundenr || p.kundenr === kundenr)
        .slice(0, 5);
      return json(context, 200, { sample });
    }

    return json(context, 200, {
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
