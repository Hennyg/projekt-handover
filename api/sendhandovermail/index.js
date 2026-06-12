const { firstEnv, required } = require("../_env");
const { getGraphToken } = require("../_graph");

const MAIL_FROM = () => required("HANDOVER_MAIL_FROM", firstEnv("HANDOVER_MAIL_FROM"));
const MAIL_TO = () => required("HANDOVER_MAIL_TO", firstEnv("HANDOVER_MAIL_TO"));

function json(context, status, body) {
  context.res = {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body
  };
}

function esc(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

module.exports = async function (context, req) {
  try {
    const b = req.body || {};
    const images = Array.isArray(b.images) ? b.images : [];

    const subject = `Ny projekt handover - ${b.kundenummer || ""} ${b.kundenavn || ""}`.trim();

    const imageLinks = images.length
      ? images.map(img => `<li><a href="${esc(img.url)}">${esc(img.name)}</a></li>`).join("")
      : "<li>Ingen billeder</li>";

    const html = `
      <h2>Ny projekt handover</h2>
      <p><b>Kunde:</b> ${esc(b.kundenavn)}</p>
      <p><b>Kundenr.:</b> ${esc(b.kundenummer)}</p>
      <p><b>Adresse:</b> ${esc(b.adresse)}</p>
      <p><b>Team:</b> ${esc(b.team)}</p>
      <p><b>Produkt:</b> ${esc(b.produkt)}</p>
      <p><b>Produktnr.:</b> ${esc(b.produktnr)}</p>
      <p><b>Serienr.:</b> ${esc(b.serienr)}</p>
      <p><b>LDN:</b> ${esc(b.ldn)}</p>
      <p><b>Tekniker:</b> ${esc(b.tekniker)}</p>
      <p><b>Kommentar:</b><br>${esc(b.kommentar).replace(/\n/g, "<br>")}</p>
      <h3>Billeder</h3>
      <ul>${imageLinks}</ul>
    `;

    const token = await getGraphToken();

    const r = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(MAIL_FROM())}/sendMail`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        message: {
          subject,
          body: {
            contentType: "HTML",
            content: html
          },
          toRecipients: MAIL_TO().split(";").map(mail => ({
            emailAddress: { address: mail.trim() }
          })).filter(x => x.emailAddress.address)
        },
        saveToSentItems: true
      })
    });

    if (!r.ok) {
      throw new Error(`Mail.Send fejl ${r.status}: ${await r.text()}`);
    }

    return json(context, 200, { ok: true });
  } catch (e) {
    context.log("sendhandovermail error:", e.message);
    return json(context, 500, { error: e.message });
  }
};
