// api/downloadimage/index.js
const { firstEnv, required } = require("../_env");
const { getGraphToken } = require("../_graph");

const SITE_ID = () =>
  required(
    "DELING_SPO_SITE_ID",
    firstEnv("DELING_SPO_SITE_ID")
  );

const DRIVE_ID = () =>
  required(
    "DELING_SPO_DRIVE_ID",
    firstEnv("DELING_SPO_DRIVE_ID")
  );

function safeFileName(value) {
  const name = String(value || "billede.jpg")
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);

  return name || "billede.jpg";
}

// Content-Disposition-headeren må kun indeholde ASCII i "filename=".
// Danske tegn (æ/ø/å) og andre specialtegn (fx "·") skal enten fjernes
// fra ASCII-fallbacken eller sendes via det encodede filename*=UTF-8''-format.
// Uden dette crasher Node/Azure Functions med "Invalid character in header
// content", hvilket giver et tomt 500-svar uden om vores egen fejlhåndtering.
function buildContentDisposition(disposition, fileName) {
  const asciiFallback = String(fileName)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7E]/g, "_")
    .trim() || "billede.jpg";

  const encoded = encodeURIComponent(fileName);

  return `${disposition}; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;
}

function json(context, status, body) {
  context.res = {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    },
    body
  };
}

module.exports = async function (context, req) {
  try {
    const image =
      req.method === "GET"
        ? {
            path: req.query.path || "",
            name: req.query.name || ""
          }
        : req.body?.image || {};

    const requestedFileName =
      req.method === "GET"
        ? req.query.fileName || image.name
        : req.body?.fileName || image.name;

    const fileName = safeFileName(
      requestedFileName ||
      String(image.path || "").split("/").pop() ||
      "billede.jpg"
    );

    const imagePath = String(image.path || "").trim();

    if (!imagePath) {
      return json(context, 400, {
        error: "image.path mangler"
      });
    }

    const token = await getGraphToken();

    const graphUrl =
      `https://graph.microsoft.com/v1.0/sites/${encodeURIComponent(SITE_ID())}` +
      `/drives/${encodeURIComponent(DRIVE_ID())}` +
      `/root:/${encodeURI(imagePath)}:/content`;

    const response = await fetch(graphUrl, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });

    if (!response.ok) {
      const errorText = await response.text();

      throw new Error(
        `Graph download fejl ${response.status}: ${errorText}`
      );
    }

    const buffer = Buffer.from(
      await response.arrayBuffer()
    );

    const inline =
      req.method === "GET" &&
      String(req.query.download || "") !== "1";

    context.res = {
      status: 200,
      isRaw: true,
      headers: {
        "Content-Type":
          response.headers.get("content-type") ||
          "application/octet-stream",

        "Content-Disposition":
          buildContentDisposition(inline ? "inline" : "attachment", fileName),

        "Cache-Control": "private, max-age=300"
      },
      body: buffer
    };
  } catch (error) {
    context.log(
      "downloadimage error:",
      error?.stack || error?.message || error
    );

    return json(context, 500, {
      error: error?.message || "Kunne ikke hente billedet"
    });
  }
};
