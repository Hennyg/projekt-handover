// assets/handover.js
let currentUser = "";
let selectedCustomer = null;
let selectedProduct = null;
let images = [];
let searchTimer = null;
let allCustomers = [];
let allProducts = [];
let kundeDataLoaded = false;

const el = id => document.getElementById(id);

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, m => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[m]));
}

function setStatus(type, msg) {
  const s = el("status");
  if (!msg) {
    s.className = "status hidden";
    s.textContent = "";
    return;
  }
  s.className = `status ${type}`;
  s.textContent = msg;
}

async function init() {
  await loadUser();
  bind();
  await loadKundeData();
}

async function loadUser() {
  try {
    const r = await fetch("/.auth/me");
    const j = await r.json();
    currentUser = j?.clientPrincipal?.userDetails || "";
  } catch {}
}

async function loadKundeData() {
  setStatus("loading", "Henter kundedata...");
  try {
    const r = await fetch("/api/kundedata");
    const j = await r.json();
    if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`);
    allCustomers = j.kunder || [];
    allProducts = j.produkter || [];
    kundeDataLoaded = true;
    setStatus("", "");
  } catch (e) {
    setStatus("error", "Kundedata kunne ikke hentes: " + e.message);
  }
}

function bind() {
  el("customerSearch").addEventListener("input", onCustomerSearch);
  el("productSelect").addEventListener("change", onProductChange);
  el("btnPick").addEventListener("click", () => el("fileAlbum").click());
  el("btnCamera").addEventListener("click", () => el("fileCamera").click());
  el("fileAlbum").addEventListener("change", e => addFiles(e.target.files));
  el("fileCamera").addEventListener("change", e => addFiles(e.target.files));
  el("btnSave").addEventListener("click", saveHandover);
}

function onCustomerSearch() {
  clearTimeout(searchTimer);
  const q = el("customerSearch").value.trim().toLowerCase();

  if (!kundeDataLoaded) {
    el("customerResults").innerHTML = `<div class="hint">Kundedata er ikke hentet endnu...</div>`;
    return;
  }

  if (q.length < 2) {
    el("customerResults").innerHTML = "";
    return;
  }

  searchTimer = setTimeout(() => {
    const kunder = allCustomers
      .filter(k => [k.navn, k.adresse, k.by, k.kundenr, k.omraade, k.kontrakt].join(" ").toLowerCase().includes(q))
      .slice(0, 50);

    el("customerResults").innerHTML = kunder.length
      ? kunder.map(k => `
          <div class="resultItem" onclick='selectCustomer(${JSON.stringify(k).replace(/'/g, "&#39;")})'>
            <div class="resultTitle">${esc(k.navn)}</div>
            <div class="resultSub">${esc(k.kundenr)} · ${esc(k.adresse)} · ${esc(k.by)}</div>
          </div>
        `).join("")
      : `<div class="hint">Ingen kunder fundet</div>`;
  }, 120);
}

function selectCustomer(k) {
  selectedCustomer = k;
  selectedProduct = null;
  el("customerResults").innerHTML = "";
  el("customerSearch").value = "";
  el("selectedCustomer").classList.remove("hidden");
  el("selectedCustomer").innerHTML = `<b>${esc(k.navn)}</b><br>${esc(k.kundenr)} · ${esc(k.adresse)} · ${esc(k.by)}`;
  el("productTile").classList.remove("hidden");
  el("detailsTile").classList.remove("hidden");
  el("imageTile").classList.remove("hidden");
  el("saveTile").classList.remove("hidden");
  loadProductsLocal(k.kundenr);
}

function loadProductsLocal(kundenr) {
  const produkter = allProducts.filter(p => String(p.kundenr || "").trim().toLowerCase() === String(kundenr || "").trim().toLowerCase());
  el("manualProduct").classList.add("hidden");
  el("manualProduct").value = "";
  el("productSelect").dataset.products = JSON.stringify(produkter);

  if (!produkter.length) {
    el("productSelect").innerHTML = `<option value="__manual__">Ingen produkter fundet - tilføj</option>`;
    el("manualProduct").classList.remove("hidden");
    el("productHelp").textContent = "Der er ingen produkter med Install. dato i formatet xx-xx-xxxx på kunden.";
    selectedProduct = { produkt: "", produktnr: "", serienr: "" };
    return;
  }

  el("productSelect").innerHTML =
    `<option value="">Vælg produkt</option>` +
    produkter.map((p, i) => `
      <option value="${i}">${esc(p.produkt)}${p.produktnr ? " · " + esc(p.produktnr) : ""}${p.serienr ? " · " + esc(p.serienr) : ""}</option>
    `).join("") +
    `<option value="__manual__">Tilføj andet produkt</option>`;

  el("productHelp").textContent = `${produkter.length} produkt(er) fundet`;
}

function onProductChange() {
  const val = el("productSelect").value;
  if (val === "__manual__") {
    selectedProduct = { produkt: "", produktnr: "", serienr: "" };
    el("manualProduct").classList.remove("hidden");
    return;
  }
  el("manualProduct").classList.add("hidden");
  const products = JSON.parse(el("productSelect").dataset.products || "[]");
  selectedProduct = products[Number(val)] || null;
}

function addFiles(fileList) {
  for (const file of Array.from(fileList || [])) {
    if (!file.type.startsWith("image/")) continue;
    images.push({ file, name: file.name || `billede-${Date.now()}.jpg`, previewUrl: URL.createObjectURL(file) });
  }
  el("fileAlbum").value = "";
  el("fileCamera").value = "";
  renderPreview();
}

function renderPreview() {
  el("imagePreview").innerHTML = images.map((img, i) => `
    <div class="previewCard"><img src="${esc(img.previewUrl)}" alt=""><button type="button" onclick="removeImage(${i})">✕</button></div>
  `).join("");
}

function removeImage(i) {
  const img = images[i];
  if (img?.previewUrl) URL.revokeObjectURL(img.previewUrl);
  images.splice(i, 1);
  renderPreview();
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const s = String(reader.result || "");
      resolve(s.includes(",") ? s.split(",")[1] : s);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function saveHandover() {
  if (!selectedCustomer) return setStatus("error", "Vælg kunde først.");

  let produkt = "";
  let produktnr = "";
  let serienr = "";

  if (el("manualProduct").classList.contains("hidden")) {
    produkt = selectedProduct?.produkt || "";
    produktnr = selectedProduct?.produktnr || "";
    serienr = selectedProduct?.serienr || "";
  } else {
    produkt = el("manualProduct").value.trim();
  }

  const ldn = el("ldn").value.trim();
  const kommentar = el("comment").value.trim();

  if (!produkt) return setStatus("error", "Vælg eller skriv produkt.");
  if (!ldn) return setStatus("error", "Udfyld LDN nummer.");

  el("btnSave").disabled = true;
  setStatus("loading", "Gemmer handover...");

  try {
    const createResp = await fetch("/api/handovers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lch_kundenavn: selectedCustomer.navn,
        lch_kundenummer: selectedCustomer.kundenr,
        lch_produkt: produkt,
        lch_produktnr: produktnr,
        lch_serienr: serienr,
        lch_ldn: ldn,
        lch_kommentar: kommentar,
        lch_tekniker: currentUser
      })
    });

    const created = await createResp.json();
    if (!createResp.ok || created.error) throw new Error(created.error || `HTTP ${createResp.status}`);
    const handoverId = created.id;
    const uploaded = [];

    for (let i = 0; i < images.length; i++) {
      setStatus("loading", `Uploader billede ${i + 1} af ${images.length}...`);
      const img = images[i];
      const base64 = await fileToBase64(img.file);
      const upResp = await fetch("/api/uploadimage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ handoverId, kundenummer: selectedCustomer.kundenr, fileName: img.name, contentType: img.file.type || "image/jpeg", base64 })
      });
      const up = await upResp.json();
      if (!upResp.ok || up.error) throw new Error(up.error || `Upload HTTP ${upResp.status}`);
      uploaded.push(up.image);
    }

    if (uploaded.length) {
      const patchResp = await fetch(`/api/handovers?id=${encodeURIComponent(handoverId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lch_billeder: JSON.stringify(uploaded) })
      });
      const patch = await patchResp.json();
      if (!patchResp.ok || patch.error) throw new Error(patch.error || `PATCH HTTP ${patchResp.status}`);
    }

    setStatus("ok", "Handover er gemt.");
    resetForm();
  } catch (e) {
    setStatus("error", e.message);
  } finally {
    el("btnSave").disabled = false;
  }
}

function resetForm() {
  selectedCustomer = null;
  selectedProduct = null;
  images.forEach(img => img.previewUrl && URL.revokeObjectURL(img.previewUrl));
  images = [];
  el("selectedCustomer").classList.add("hidden");
  el("productTile").classList.add("hidden");
  el("detailsTile").classList.add("hidden");
  el("imageTile").classList.add("hidden");
  el("saveTile").classList.add("hidden");
  el("customerSearch").value = "";
  el("productSelect").innerHTML = "";
  el("manualProduct").value = "";
  el("ldn").value = "";
  el("comment").value = "";
  renderPreview();
}

init();
