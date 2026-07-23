// api/_env.js
function firstEnv(...names) {
  for (const n of names) {
    const v = process.env[n];
    if (v) return v;
  }
  return "";
}

function required(name, value) {
  if (!value) throw new Error(`Environment variable mangler: ${name}`);
  return value;
}

function getTenantId() {
  return required("DV_TENANT_ID/TENANT_ID/AZURE_TENANT_ID", firstEnv("DV_TENANT_ID", "TENANT_ID", "AZURE_TENANT_ID"));
}

function getClientId() {
  return required("DV_CLIENT_ID/AZURE_CLIENT_ID", firstEnv("DV_CLIENT_ID", "AZURE_CLIENT_ID"));
}

function getClientSecret() {
  return required("DV_CLIENT_SECRET/AZURE_CLIENT_SECRET", firstEnv("DV_CLIENT_SECRET", "AZURE_CLIENT_SECRET"));
}

function getDvUrl() {
  return required("DV_URL", firstEnv("DV_URL")).replace(/\/$/, "");
}

// Separat Dataverse-miljø med stamdata (kunder, adresser, produkter).
// Samme app-registrering (tenant/client/secret) som DV_URL, bare en anden resource-url.
function getDvCoreDataUrl() {
  return required("DV_COREDATA", firstEnv("DV_COREDATA")).replace(/\/$/, "");
}

module.exports = {
  firstEnv,
  required,
  getTenantId,
  getClientId,
  getClientSecret,
  getDvUrl,
  getDvCoreDataUrl
};
