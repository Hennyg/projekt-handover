// api/handovers/index.js
const { dvFetch } = require("../_dv");
const { getUserName } = require("../_auth");

const TABLE = "crf91_lch_handovers";
const ID = "crf91_lch_handoverid";

const SELECT = [
  ID,
  "crf91_lch_name",
  "crf91_lch_kundenavn",
  "crf91_lch_kundenummer",
  "crf91_lch_produkt",
  "crf91_lch_produktnr",
  "crf91_lch_serienr",
  "crf91_lch_ldn",
  "crf91_lch_kommentar",
  "crf91_lch_tekniker",
  "crf91_lch_opstartsdato",
  "crf91_lch_billeder",
  "crf91_lch_aktiv",
  "createdon"
].join(",");

function json(context, status, body) {
  context.res = { status, headers: { "Content-Type": "application/json; charset=utf-8" }, body };
}

function mapRow(r) {
  return {
    id: r[ID],
    lch_name: r.crf91_lch_name || "",
    lch_kundenavn: r.crf91_lch_kundenavn || "",
    lch_kundenummer: r.crf91_lch_kundenummer || "",
    lch_produkt: r.crf91_lch_produkt || "",
    lch_produktnr: r.crf91_lch_produktnr || "",
    lch_serienr: r.crf91_lch_serienr || "",
    lch_ldn: r.crf91_lch_ldn || "",
    lch_kommentar: r.crf91_lch_kommentar || "",
    lch_tekniker: r.crf91_lch_tekniker || "",
    lch_opstartsdato: r.crf91_lch_opstartsdato || "",
    lch_billeder: r.crf91_lch_billeder || "[]",
    lch_aktiv: r.crf91_lch_aktiv !== false,
    createdon: r.createdon || ""
  };
}

module.exports = async function (context, req) {
  try {
    if (req.method === "GET") {
      const data = await dvFetch(`${TABLE}?$select=${SELECT}&$orderby=createdon desc&$top=5000`);
      return json(context, 200, { value: (data.value || []).map(mapRow) });
    }

    if (req.method === "POST") {
      const b = req.body || {};
      const now = new Date().toISOString();

      const payload = {
        crf91_lch_name: `${b.lch_kundenummer || ""} - ${b.lch_kundenavn || ""}`.trim(),
        crf91_lch_kundenavn: b.lch_kundenavn || "",
        crf91_lch_kundenummer: b.lch_kundenummer || "",
        crf91_lch_produkt: b.lch_produkt || "",
        crf91_lch_produktnr: b.lch_produktnr || "",
        crf91_lch_serienr: b.lch_serienr || "",
        crf91_lch_ldn: b.lch_ldn || "",
        crf91_lch_kommentar: b.lch_kommentar || "",
        crf91_lch_tekniker: b.lch_tekniker || getUserName(req),
        crf91_lch_opstartsdato: now.slice(0, 10),
        crf91_lch_billeder: "[]",
        crf91_lch_aktiv: true
      };

      const created = await dvFetch(TABLE, {
        method: "POST",
        body: payload,
        headers: { Prefer: "return=representation" }
      });

      return json(context, 200, { id: created[ID], row: mapRow(created) });
    }

    if (req.method === "PATCH") {
      const id = String(req.query.id || "").trim();
      if (!id) return json(context, 400, { error: "id mangler" });

      const b = req.body || {};
      const payload = {};

      if ("lch_aktiv" in b) payload.crf91_lch_aktiv = !!b.lch_aktiv;
      if ("lch_billeder" in b) payload.crf91_lch_billeder = String(b.lch_billeder || "[]");
      if ("lch_kommentar" in b) payload.crf91_lch_kommentar = String(b.lch_kommentar || "");
      if ("lch_ldn" in b) payload.crf91_lch_ldn = String(b.lch_ldn || "");

      await dvFetch(`${TABLE}(${id})`, { method: "PATCH", body: payload });
      return json(context, 200, { ok: true });
    }

    return json(context, 405, { error: "Method not allowed" });
  } catch (e) {
    context.log("handovers error:", e.message);
    return json(context, e.status || 500, { error: e.message });
  }
};
