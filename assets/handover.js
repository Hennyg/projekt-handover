// assets/handover.js
let currentUser = "";
let selectedCustomer = null;
let selectedAddress = null;   // { adresse, postnr, bynavn, by, label }
let selectedTeam = "";
let selectedProduct = null;
let images = [];
let searchTimer = null;

let kundeDataLoaded = false;
let allCustomers = [];
let allProducts = [];

const el = id => document.getElementById(id);

function setStepNumbers(hasAddressStep) {
  const teamTitle = el("teamTitle");
  const productTitle = el("productTitle");
  const detailsTitle = el("detailsTitle");
  const imageTitle = el("imageTitle");

  if (!teamTitle) return;

  teamTitle.textContent =
    hasAddressStep ? "3. Vælg team" : "2. Vælg team";

  productTitle.textContent =
    hasAddressStep ? "4. Produkt" : "3. Produkt";

  detailsTitle.textContent =
    hasAddressStep ? "5. Oplysninger" : "4. Oplysninger";

  imageTitle.textContent =
    hasAddressStep ? "6. Billeder" : "5. Billeder";
}

// Null-safe classList helpers — no crash if element isn't in DOM yet
function hide(...ids) { ids.forEach(id => { const e = el(id); if (e) e.classList.add("hidden"); }); }
function show(id) { const e = el(id); if (e) e.classList.remove("hidden"); }

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, m => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
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

function setSaveStatus(type, msg, percent = 0) {
  const tile = el("saveStatusTile");
  const text = el("saveStatusText");
  const bar = el("saveProgressInner");

  if (!msg) {
    tile.className = "saveStatusTile hidden";
    text.textContent = "";
    bar.style.width = "0%";
    return;
  }

  tile.className = `saveStatusTile ${type || ""}`;
  text.textContent = msg;
  bar.style.width = `${Math.max(0, Math.min(100, percent))}%`;

  setTimeout(() => {
    tile.scrollIntoView({ behavior: "smooth", block: "center" });
  }, 50);
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
  el("customerTile").classList.add("hidden");
  setStatus("loading", "Henter kundeliste og produkter...");

  try {
    const r = await fetch("/api/kundedata");
    const j = await r.json();

    if (!r.ok || j.error) {
      throw new Error(j.error || `HTTP ${r.status}`);
    }

    allCustomers = j.kunder || [];
    allProducts = j.produkter || [];
    kundeDataLoaded = true;

    setStatus("", "");
    el("customerTile").classList.remove("hidden");
    el("customerSearch").focus();
  } catch (e) {
    kundeDataLoaded = false;
    el("customerTile").classList.add("hidden");
    setStatus("error", "Kundedata kunne ikke hentes: " + e.message);
  }
}

function bind() {
  el("customerSearch").addEventListener("input", onCustomerSearch);
  el("productSelect").addEventListener("change", onProductChange);
  el("manualProduct").addEventListener("input", updateProductNextVisibility);
  el("ldn").addEventListener("input", updateDetailsNextVisibility);

  el("btnTeamMilk").addEventListener("click", () => selectTeam("Milk & cooling"));
  el("btnTeamFeed").addEventListener("click", () => selectTeam("Feed & barn"));

  el("btnProductNext").addEventListener("click", showDetailsStepFromManualProduct);
  el("btnDetailsNext").addEventListener("click", showImageStep);

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
      .filter(k =>
        [
          k.navn,
          k.adresse,
          k.by,
          k.kundenr,
          k.omraade,
          k.kontrakt
        ].join(" ").toLowerCase().includes(q)
      )
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
  selectedAddress = null;
  selectedTeam = "";
  selectedProduct = null;
  setSaveStatus("", "");

  el("customerResults").innerHTML = "";
  el("customerSearch").value = "";

  el("selectedCustomer").classList.remove("hidden");
  el("selectedCustomer").innerHTML = `
    <b>${esc(k.navn)}</b><br>
    ${esc(k.kundenr)} · ${esc(k.adresse)} · ${esc(k.by)}
  `;

  // Hide downstream tiles
  hide("addressTile", "teamTile", "productTile", "detailsTile", "imageTile", "saveTile");

  setTeamButtonState();

  // Decide: single address → skip address tile; multiple → show it
const adresser = k.adresser || [];
const uniqueAdresser = adresser.filter(a => a.adresse);

// Ret trin-numre afhængigt af om adressevalget vises
setStepNumbers(uniqueAdresser.length > 1);

  if (uniqueAdresser.length <= 1) {
    // Only one (or zero) address — auto-select and go directly to team
    selectedAddress = uniqueAdresser[0] || null;
    show("teamTile");
    setTimeout(() => {
      el("teamTile").scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
  } else {
    // Multiple addresses — show address tile
    renderAddressButtons(uniqueAdresser);
    show("addressTile");
    setTimeout(() => {
      el("addressTile").scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
  }
}

function renderAddressButtons(adresser) {
  el("addressButtons").innerHTML = adresser.map(a => `
    <button
      type="button"
      class="addressButton"
      onclick='selectAddress(${JSON.stringify(a).replace(/'/g, "&#39;")})'
    >${esc(a.label || a.adresse)}</button>
  `).join("");
}

function selectAddress(a) {
  selectedAddress = a;
  selectedTeam = "";
  selectedProduct = null;
  setSaveStatus("", "");

  // Highlight active button
  document.querySelectorAll(".addressButton").forEach(btn => {
    btn.classList.toggle("active", btn.textContent.trim() === (a.label || a.adresse).trim());
  });

  show("teamTile");
  hide("productTile", "detailsTile", "imageTile", "saveTile");

  setTeamButtonState();

  setTimeout(() => {
    el("teamTile").scrollIntoView({ behavior: "smooth", block: "start" });
  }, 50);
}

function selectTeam(team) {
  selectedTeam = team;
  selectedProduct = null;
  setSaveStatus("", "");

  setTeamButtonState();

  show("productTile");
  hide("detailsTile", "imageTile", "saveTile");
  el("btnProductNext").classList.add("hidden");

  loadProductsLocal(selectedCustomer.kundenr);

  setTimeout(() => {
    el("productTile").scrollIntoView({ behavior: "smooth", block: "start" });
  }, 50);
}

function setTeamButtonState() {
  document.querySelectorAll(".teamButton").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.team === selectedTeam);
  });
}

function loadProductsLocal(kundenr) {
  // Show ALL matching rows — no deduplication
  const produkter = allProducts.filter(p =>
    String(p.kundenr || "").trim().toLowerCase() === String(kundenr || "").trim().toLowerCase()
  );

  el("manualProduct").classList.add("hidden");
  el("manualProduct").value = "";
  el("productSelect").dataset.products = JSON.stringify(produkter);

  hide("detailsTile", "imageTile", "saveTile");
  el("btnDetailsNext").classList.add("hidden");
  el("btnProductNext").classList.add("hidden");

  if (!produkter.length) {
    el("productSelect").innerHTML = `<option value="__manual__">Ingen produkter fundet - tilføj</option>`;
    el("manualProduct").classList.remove("hidden");
    el("productHelp").textContent = "Der er ingen produkter med xx-xx-xxxx i Install. dato på kunden.";
    selectedProduct = {
      produkt: "",
      produktnr: "",
      serienr: ""
    };

    setTimeout(() => {
      el("manualProduct").focus();
    }, 50);

    return;
  }

  // Kolonne I (serienr) vises IKKE i dropdown-teksten
  el("productSelect").innerHTML =
    `<option value="">Vælg produkt</option>` +
    produkter.map((p, i) => `
      <option value="${i}">
        ${esc(p.produkt)}
        ${p.produktnr ? " · " + esc(p.produktnr) : ""}
      </option>
    `).join("") +
    `<option value="__manual__">Tilføj andet produkt</option>`;

  el("productHelp").textContent = `${produkter.length} produkt(er) fundet`;
}

function onProductChange() {
  const val = el("productSelect").value;
  setSaveStatus("", "");

  hide("detailsTile", "imageTile", "saveTile");
  el("btnDetailsNext").classList.add("hidden");
  el("btnProductNext").classList.add("hidden");

  if (val === "__manual__") {
    selectedProduct = {
      produkt: "",
      produktnr: "",
      serienr: ""
    };
    el("manualProduct").classList.remove("hidden");
    el("manualProduct").focus();
    updateProductNextVisibility();
    return;
  }

  el("manualProduct").classList.add("hidden");
  el("manualProduct").value = "";

  const products = JSON.parse(el("productSelect").dataset.products || "[]");
  selectedProduct = products[Number(val)] || null;

  if (selectedProduct) {
    showDetailsStep();
  }
}

function updateProductNextVisibility() {
  const isManualMode = !el("manualProduct").classList.contains("hidden");
  const hasManualProduct = el("manualProduct").value.trim().length > 0;

  el("btnProductNext").classList.toggle("hidden", !(isManualMode && hasManualProduct));

  if (!hasManualProduct) {
    hide("detailsTile", "imageTile", "saveTile");
    el("btnDetailsNext").classList.add("hidden");
  }
}

function showDetailsStepFromManualProduct() {
  const manualProduct = el("manualProduct").value.trim();

  if (!manualProduct) {
    el("manualProduct").focus();
    return;
  }

  selectedProduct = {
    produkt: "",
    produktnr: "",
    serienr: ""
  };

  showDetailsStep();
}

function showDetailsStep() {
  show("detailsTile");
  updateDetailsNextVisibility();

  setTimeout(() => {
    el("detailsTile").scrollIntoView({ behavior: "smooth", block: "start" });
    el("ldn").focus();
  }, 50);
}

function updateDetailsNextVisibility() {
  const hasLdn = el("ldn").value.trim().length > 0;

  el("btnDetailsNext").classList.toggle("hidden", !hasLdn);

  if (!hasLdn) {
    hide("imageTile", "saveTile");
  }
}

function showImageStep() {
  const ldn = el("ldn").value.trim();

  if (!ldn) {
    setStatus("error", "LDN nummer skal udfyldes.");
    el("ldn").focus();
    return;
  }

  setStatus("", "");

  show("imageTile");
  updateSaveVisibility();

  setTimeout(() => {
    el("imageTile").scrollIntoView({ behavior: "smooth", block: "start" });
  }, 50);
}

function updateSaveVisibility() {
  const hasImages = images.length > 0;
  const imageTileVisible = !el("imageTile").classList.contains("hidden");

  el("saveTile").classList.toggle("hidden", !(imageTileVisible && hasImages));

  if (!hasImages) {
    setSaveStatus("", "");
  }
}

function addFiles(fileList) {
  const files = Array.from(fileList || []);

  for (const file of files) {
    if (!file.type.startsWith("image/")) continue;

    images.push({
      file,
      name: file.name || `billede-${Date.now()}.jpg`,
      previewUrl: URL.createObjectURL(file)
    });
  }

  el("fileAlbum").value = "";
  el("fileCamera").value = "";

  renderPreview();
  updateSaveVisibility();
}

function renderPreview() {
  el("imagePreview").innerHTML = images.map((img, i) => `
    <div class="previewCard">
      <img src="${esc(img.previewUrl)}" alt="">
      <button type="button" onclick="removeImage(${i})">✕</button>
    </div>
  `).join("");
}

function removeImage(i) {
  const img = images[i];

  if (img?.previewUrl) {
    URL.revokeObjectURL(img.previewUrl);
  }

  images.splice(i, 1);
  renderPreview();
  updateSaveVisibility();
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

// Byg adresse-streng til Dataverse: "<adresse>, <postnr> <by>"
function buildAdresseString() {
  if (!selectedAddress) return "";
  const parts = [selectedAddress.adresse, [selectedAddress.postnr, selectedAddress.bynavn].filter(Boolean).join(" ")].filter(Boolean);
  return parts.join(", ");
}

async function saveHandover() {
  if (!selectedCustomer) {
    return setStatus("error", "Vælg kunde først.");
  }

  if (!selectedTeam) {
    return setStatus("error", "Vælg team.");
  }

  if (!images.length) {
    return setStatus("error", "Tilføj mindst ét billede.");
  }

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

  if (!produkt) {
    return setStatus("error", "Vælg eller skriv produkt.");
  }

  if (!ldn) {
    return setStatus("error", "Udfyld LDN nummer.");
  }

  el("btnSave").disabled = true;
  setStatus("", "");
  setSaveStatus("loading", "Opretter handover i Dataverse...", 5);

  try {
    const createResp = await fetch("/api/handovers", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        lch_kundenavn: selectedCustomer.navn,
        lch_kundenummer: selectedCustomer.kundenr,
        lch_adresse: buildAdresseString(),
        lch_team: selectedTeam,
        lch_produkt: produkt,
        lch_produktnr: produktnr,
        lch_serienr: serienr,
        lch_ldn: ldn,
        lch_kommentar: kommentar,
        lch_tekniker: currentUser
      })
    });

    const created = await createResp.json();

    if (!createResp.ok || created.error) {
      throw new Error(created.error || `HTTP ${createResp.status}`);
    }

    const handoverId = created.id;
    const uploaded = [];

    for (let i = 0; i < images.length; i++) {
      const percent = Math.round(10 + ((i + 1) / images.length) * 70);
      setSaveStatus("loading", `Uploader billede ${i + 1} af ${images.length}...`, percent);

      const img = images[i];
      const base64 = await fileToBase64(img.file);

      const upResp = await fetch("/api/uploadimage", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          handoverId,
          kundenummer: selectedCustomer.kundenr,
          fileName: img.name,
          contentType: img.file.type || "image/jpeg",
          base64
        })
      });

      const up = await upResp.json();

      if (!upResp.ok || up.error) {
        throw new Error(up.error || `Upload HTTP ${upResp.status}`);
      }

      uploaded.push(up.image);
    }

    if (uploaded.length) {
      setSaveStatus("loading", "Gemmer billedreferencer...", 90);

      const patchResp = await fetch(`/api/handovers?id=${encodeURIComponent(handoverId)}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          lch_billeder: JSON.stringify(uploaded)
        })
      });

      const patch = await patchResp.json();

      if (!patchResp.ok || patch.error) {
        throw new Error(patch.error || `PATCH HTTP ${patchResp.status}`);
      }
    }

    setSaveStatus("ok", "Handover er gemt.", 100);
    setTimeout(() => {
      resetForm();
      setSaveStatus("ok", "Handover er gemt.", 100);
    }, 500);
  } catch (e) {
    setSaveStatus("error", e.message, 100);
  } finally {
    el("btnSave").disabled = false;
  }
}

function resetForm() {
  selectedCustomer = null;
  selectedAddress = null;
  selectedTeam = "";
  selectedProduct = null;

  images.forEach(img => img.previewUrl && URL.revokeObjectURL(img.previewUrl));
  images = [];

  el("selectedCustomer").classList.add("hidden");
  hide("addressTile", "teamTile", "productTile", "detailsTile", "imageTile", "saveTile");
  el("btnDetailsNext").classList.add("hidden");
  el("btnProductNext").classList.add("hidden");

  el("customerSearch").value = "";
  el("productSelect").innerHTML = "";
  el("manualProduct").value = "";
  el("manualProduct").classList.add("hidden");
  el("ldn").value = "";
  el("comment").value = "";

  setTeamButtonState();
  renderPreview();
}

init();
