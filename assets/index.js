// assets/index.js
let rows = [];
let filtered = [];
let sortField = "createdon";
let sortDir = "desc";

const el = id => document.getElementById(id);

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, m => ({
    "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"
  }[m]));
}

function fmtDate(s) {
  if (!s) return "";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString("da-DK", { day:"2-digit", month:"2-digit", year:"numeric", hour:"2-digit", minute:"2-digit" });
}

function parseImages(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  try {
    const j = JSON.parse(v);
    return Array.isArray(j) ? j : [];
  } catch {
    return [];
  }
}

async function init() {
  await loadUser();
  bind();
  await loadRows();
}

async function loadUser() {
  try {
    const r = await fetch("/.auth/me");
    const j = await r.json();
    el("userDisplay").textContent = j?.clientPrincipal?.userDetails || "";
  } catch {}
}

function bind() {
  el("q").addEventListener("input", applyFilters);
  el("statusFilter").addEventListener("change", applyFilters);
  el("btnRefresh").addEventListener("click", loadRows);
  el("btnReset").addEventListener("click", () => {
    el("q").value = "";
    el("statusFilter").value = "active";
    applyFilters();
  });
  el("detailClose").addEventListener("click", closeDetail);
  el("detailBackdrop").addEventListener("click", closeDetail);
  document.querySelectorAll("th.sortable").forEach(th => {
    th.addEventListener("click", () => {
      const f = th.dataset.sort;
      if (sortField === f) sortDir = sortDir === "asc" ? "desc" : "asc";
      else { sortField = f; sortDir = "asc"; }
      applyFilters();
    });
  });
}

async function loadRows() {
  el("tbody").innerHTML = `<tr><td colspan="9">Henter...</td></tr>`;
  const r = await fetch("/api/handovers");
  const j = await r.json();
  if (!r.ok || j.error) {
    el("tbody").innerHTML = `<tr><td colspan="9">Fejl: ${esc(j.error || r.status)}</td></tr>`;
    return;
  }
  rows = j.value || [];
  applyFilters();
}

function applyFilters() {
  const q = el("q").value.trim().toLowerCase();
  const status = el("statusFilter").value;

  filtered = rows.filter(r => {
    const active = r.lch_aktiv !== false;
    if (status === "active" && !active) return false;
    if (status === "done" && active) return false;

    if (!q) return true;
    return [
      r.lch_kundenummer,
      r.lch_kundenavn,
      r.lch_produkt,
      r.lch_ldn,
      r.lch_tekniker,
      r.lch_kommentar
    ].join(" ").toLowerCase().includes(q);
  });

  filtered.sort((a, b) => {
    const av = String(a[sortField] ?? "").toLowerCase();
    const bv = String(b[sortField] ?? "").toLowerCase();
    const res = av.localeCompare(bv, "da", { numeric: true });
    return sortDir === "asc" ? res : -res;
  });

  render();
}

function render() {
  el("countText").textContent = `${filtered.length} vist / ${rows.length} total`;

  if (!filtered.length) {
    el("tbody").innerHTML = `<tr><td colspan="9">Ingen linjer fundet</td></tr>`;
    return;
  }

  el("tbody").innerHTML = filtered.map(r => {
    const imgs = parseImages(r.lch_billeder);
    return `
      <tr>
        <td class="checkCol">
          <input type="checkbox" ${r.lch_aktiv === false ? "checked" : ""} onchange="setDone('${esc(r.id)}', this.checked)">
        </td>
        <td>${esc(fmtDate(r.createdon))}</td>
        <td>${esc(r.lch_kundenummer)}</td>
        <td>${esc(r.lch_kundenavn)}</td>
        <td>${esc(r.lch_produkt)}</td>
        <td>${esc(r.lch_ldn)}</td>
        <td>${esc(r.lch_tekniker)}</td>
        <td class="num">${imgs.length}</td>
        <td><button type="button" onclick="openDetail('${esc(r.id)}')">Vis</button></td>
      </tr>
    `;
  }).join("");
}

async function setDone(id, done) {
  const r = await fetch(`/api/handovers?id=${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lch_aktiv: !done })
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) {
    alert("Kunne ikke opdatere: " + (j.error || r.status));
    await loadRows();
    return;
  }
  const row = rows.find(x => x.id === id);
  if (row) row.lch_aktiv = !done;
  applyFilters();
}

function openDetail(id) {
  const r = rows.find(x => x.id === id);
  if (!r) return;

  const imgs = parseImages(r.lch_billeder);
  const content = el("detailContent");

  content.innerHTML = `
    <h2>${esc(r.lch_kundenavn || "Handover")}</h2>
    <div class="detailGrid">
      ${detail("Kundenr.", r.lch_kundenummer)}
      ${detail("Produkt", r.lch_produkt)}
      ${detail("Produktnr.", r.lch_produktnr)}
      ${detail("Serienr.", r.lch_serienummer)}
      ${detail("LDN", r.lch_ldn)}
      ${detail("Tekniker", r.lch_tekniker)}
      ${detail("Oprettet", fmtDate(r.createdon))}
      ${detail("Status", r.lch_aktiv === false ? "Færdig" : "Aktiv")}
    </div>

    <div class="detailSection">
      <h3>Kommentar</h3>
      <div class="detailText">${esc(r.lch_kommentar || "")}</div>
    </div>

    <div class="detailSection">
      <h3>Billeder</h3>
      <div class="modalActions">
        <button type="button" onclick="selectAllImages(true)">Marker alle</button>
        <button type="button" onclick="selectAllImages(false)">Fjern markering</button>
        <button type="button" class="primary" onclick="downloadSelectedImages('${esc(r.id)}')">Download markerede</button>
      </div>
      <div class="imageGrid">
        ${imgs.length ? imgs.map((img, i) => `
          <div class="imageCard">
            <a href="${esc(img.url || "#")}" target="_blank" rel="noopener">
              <img src="${esc(img.url || "")}" alt="">
            </a>
            <label>
              <input class="imageCheck" type="checkbox" data-index="${i}">
              <span>${esc(img.name || img.path || "Billede")}</span>
            </label>
          </div>
        `).join("") : "<p>Ingen billeder.</p>"}
      </div>
    </div>
  `;

  el("detailBackdrop").classList.remove("hidden");
  el("detailDrawer").classList.remove("hidden");
}

function detail(label, value) {
  return `<div><div class="detailLabel">${esc(label)}</div><div class="detailValue">${esc(value || "")}</div></div>`;
}

function closeDetail() {
  el("detailBackdrop").classList.add("hidden");
  el("detailDrawer").classList.add("hidden");
}

function selectAllImages(value) {
  document.querySelectorAll(".imageCheck").forEach(cb => cb.checked = value);
}

async function downloadSelectedImages(id) {
  const row = rows.find(x => x.id === id);
  if (!row) return;

  const imgs = parseImages(row.lch_billeder);
  const selected = Array.from(document.querySelectorAll(".imageCheck:checked"))
    .map(cb => imgs[Number(cb.dataset.index)])
    .filter(Boolean);

  if (!selected.length) {
    alert("Marker mindst ét billede.");
    return;
  }

  const r = await fetch("/api/downloadimages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ images: selected, zipName: `handover-${row.lch_kundenummer || id}.zip` })
  });

  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    alert("Download fejlede: " + (j.error || r.status));
    return;
  }

  const blob = await r.blob();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `handover-${row.lch_kundenummer || id}.zip`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
}

init();
