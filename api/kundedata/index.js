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

// Kun produkter hvor:
// 1. Installationsdato stadig er "xx-xx-xxxx"
// 2. Der ikke allerede er lavet en handover
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

function json(context, status, body) {
  context.res = {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",

      // Kundedata må ikke genbruges fra browser- eller proxy-cache.
      // Dermed får andre brugere altid den aktuelle handover-status.
      "Cache-Control": "no-store, no-cache, must-revalidate",
      "Pragma": "no-cache",
      "Expires": "0"
    },
    body
  };
}

async function loadFromDataverse() {
  const productFilter =
    "cr1eb_lch_installationsdato eq 'xx-xx-xxxx' " +
    "and (cr1eb_lch_handover_status eq false " +
    "or cr1eb_lch_handover_status eq null)";

  const [kundeRows, adresseRows, produktRows] = await Promise.all([
    fetchAllCore(
      `${KUNDE_TABLE}?$select=${KUNDE_SELECT}&$top=5000`
    ),

    fetchAllCore(
      `${ADRESSE_TABLE}?$select=${ADRESSE_SELECT}&$top=5000`
    ),

    fetchAllCore(
      `${PRODUKT_TABLE}` +
      `?$select=${PRODUKT_SELECT}` +
      `&$filter=${encodeURIComponent(productFilter)}` +
      `&$top=5000`
    )
  ]);

  // Kunder grupperet efter Dataverse kunde-id.
  const kundeById = new Map();

  // Kundenummer bruges til at koble produkter til kunden.
  const kundenrToId = new Map();

  for (const row of kundeRows) {
    const kundeId = row.cr1eb_lch_kundeid;
    const kundenr = row.cr1eb_lch_kundenr || "";

    if (!kundeId) {
      continue;
    }

    kundeById.set(kundeId, {
      kundenr,
      navn: row.cr1eb_lch_navn || "",
      omraade: row.cr1eb_lch_omraade || "",

      adresse: "",
      postnr: "",
      bynavn: "",
      by: "",

      kontrakt: "",

      _kontraktSet: new Set(),
      _adresseKeys: new Set(),

      adresser: []
    });

    if (kundenr) {
      kundenrToId.set(kundenr, kundeId);
    }
  }

  // Tilføj adresser til den tilhørende kunde.
  for (const row of adresseRows) {
    const kundeId = row._cr1eb_lch_kunde_value;
    const kunde = kundeById.get(kundeId);

    if (!kunde) {
      continue;
    }

    const adresse = row.cr1eb_lch_adresse || "";
    const postnr = row.cr1eb_lch_postnr || "";
    const bynavn = row.cr1eb_lch_by || "";
    const by = [postnr, bynavn]
      .filter(Boolean)
      .join(" ");

    const adresseKey = [
      adresse,
      postnr,
      bynavn
    ].join("|");

    if (!adresse) {
      continue;
    }

    if (kunde._adresseKeys.has(adresseKey)) {
      continue;
    }

    kunde._adresseKeys.add(adresseKey);

    kunde.adresser.push({
      adresse,
      postnr,
      bynavn,
      by,
      label: [adresse, postnr, bynavn]
        .filter(Boolean)
        .join(", ")
    });
  }

  // Første adresse bruges som kundens primære flade adresse.
  for (const kunde of kundeById.values()) {
    const firstAddress = kunde.adresser[0];

    if (!firstAddress) {
      continue;
    }

    kunde.adresse = firstAddress.adresse;
    kunde.postnr = firstAddress.postnr;
    kunde.bynavn = firstAddress.bynavn;
    kunde.by = firstAddress.by;
  }

  const produkter = [];

  for (const row of produktRows) {
    const kundenr = row.cr1eb_lch_kundenr || "";
    const kundeId = kundenrToId.get(kundenr);
    const kunde = kundeId
      ? kundeById.get(kundeId)
      : null;

    const kontrakt = row.cr1eb_lch_kontrakt || "";

    if (kunde && kontrakt) {
      kunde._kontraktSet.add(kontrakt);
    }

    produkter.push({
      // Dette id skal sendes som coreProductId,
      // når handoveren gemmes.
      id: row.cr1eb_lch_kundeproduktid,

      kundenr,
      kundenavn: kunde ? kunde.navn : "",

      adressekey: row.cr1eb_lch_adressekey || "",

      produkt: row.cr1eb_lch_produkt || "",
      produktnr: row.cr1eb_lch_produktnr || "",
      serienr: row.cr1eb_lch_serienr || "",

      installDato:
        row.cr1eb_lch_installationsdato || "",

      garantiIndtil:
        row.cr1eb_lch_garantiudloeb || "",

      kontrakt
    });
  }

  const kunder = Array.from(kundeById.values())
    .map(kunde => {
      const {
        _adresseKeys,
        _kontraktSet,
        ...result
      } = kunde;

      return {
        ...result,
        kontrakt: Array
          .from(_kontraktSet)
          .join(", ")
      };
    })
    .sort((a, b) =>
      String(a.navn || "").localeCompare(
        String(b.navn || ""),
        "da",
        {
          sensitivity: "base"
        }
      )
    );

  produkter.sort((a, b) =>
    [
      a.kundenavn,
      a.produkt,
      a.produktnr,
      a.serienr
    ]
      .join(" ")
      .localeCompare(
        [
          b.kundenavn,
          b.produkt,
          b.produktnr,
          b.serienr
        ].join(" "),
        "da",
        {
          numeric: true,
          sensitivity: "base"
        }
      )
  );

  return {
    kunder,
    produkter,
    totalKunder: kunder.length,
    totalProdukter: produkter.length
  };
}

module.exports = async function (context, req) {
  try {
    // Der bruges bevidst ingen servercache.
    // Hver åbning af handover-siden får aktuelle data fra Dataverse.
    const data = await loadFromDataverse();

    // Eksempel:
    // /api/kundedata?debug=produkter&kundenr=0080002192
    if (req.query.debug === "produkter") {
      const kundenr = String(
        req.query.kundenr || ""
      ).trim();

      const sample = data.produkter
        .filter(product =>
          !kundenr ||
          String(product.kundenr || "").trim() === kundenr
        )
        .slice(0, 20);

      return json(context, 200, {
        kundenr,
        totalMatches: data.produkter.filter(product =>
          !kundenr ||
          String(product.kundenr || "").trim() === kundenr
        ).length,
        sample
      });
    }

    return json(context, 200, {
      kunder: data.kunder,
      produkter: data.produkter,
      totalKunder: data.totalKunder,
      totalProdukter: data.totalProdukter
    });
  } catch (error) {
    context.log(
      "kundedata error:",
      error?.stack || error?.message || error
    );

    return json(context, 500, {
      error: error?.message || "Ukendt fejl ved hentning af kundedata",
      kunder: [],
      produkter: [],
      totalKunder: 0,
      totalProdukter: 0
    });
  }
};
