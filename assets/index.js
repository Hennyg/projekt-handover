// assets/index.js
let rows = [];
let filtered = [];
let sortField = "createdon";
let sortDir = "desc";
let pendingDownload = null;
let selectedRowIds = new Set();

const el = id => document.getElementById(id);

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, m => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[m]));
}

function fmtDate(s) {
  if (!s) return "";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString("da-DK", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
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

function extensionFromName(name) {
  const s = String(name || "").trim();
  const m = s.match(/\.([a-zA-Z0-9]{2,8})$/);
  return m ? "." + m[1].toLowerCase() : ".jpg";
}

function cleanFileBaseName(name) {
  return String(name || "")
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/\.+$/g, "")
    .slice(0, 90);
}

function buildDownloadFileName(inputName, originalName, index) {
  const ext = extensionFromName(originalName);
  let base = cleanFileBaseName(inputName);
  if (!base) base = `Billede ${index + 1}`;
  return base.toLowerCase().endsWith(ext.toLowerCase()) ? base : base + ext;
}

function setDownloadProgress(text, percent) {
  el("downloadProgressText").textContent = text;
  el("downloadProgressInner").style.width = `${Math.max(0, Math.min(100, percent))}%`;
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
  el("btnDownloadRows").addEventListener("click", startSelectedRowsDownload);

  el("btnReset").addEventListener("click", () => {
    el("q").value = "";
    el("statusFilter").value = "active";
    selectedRowIds.clear();
    applyFilters();
  });

  el("selectAllRows").addEventListener("change", e => {
    if (e.target.checked) filtered.forEach(r => selectedRowIds.add(r.id));
    else filtered.forEach(r => selectedRowIds.delete(r.id));
    render();
  });

  el("detailClose").addEventListener("click", closeDetail);
  el("detailBackdrop").addEventListener("click", closeDetail);

  el("btnQr").addEventListener("click", openQr);
  el("qrClose").addEventListener("click", closeQr);
  el("qrBackdrop").addEventListener("click", closeQr);
  el("qrUrl").addEventListener("click", () => el("qrUrl").select());

  el("nameClose").addEventListener("click", closeNameModal);
  el("btnCancelNames").addEventListener("click", closeNameModal);
  el("nameBackdrop").addEventListener("click", closeNameModal);
  el("btnDownloadNamed").addEventListener("click", saveNamedImagesToFolder);

  document.querySelectorAll("th.sortable").forEach(th => {
    th.addEventListener("click", () => {
      const f = th.dataset.sort;
      if (sortField === f) sortDir = sortDir === "asc" ? "desc" : "asc";
      else {
        sortField = f;
        sortDir = "asc";
      }
      applyFilters();
    });
  });
}

async function loadRows() {
  el("tbody").innerHTML = `<tr><td colspan="12">Henter...</td></tr>`;

  const r = await fetch("/api/handovers");
  const j = await r.json();

  if (!r.ok || j.error) {
    el("tbody").innerHTML = `<tr><td colspan="12">Fejl: ${esc(j.error || r.status)}</td></tr>`;
    return;
  }

  rows = j.value || [];
  selectedRowIds = new Set([...selectedRowIds].filter(id => rows.some(r => r.id === id)));
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
      r.lch_team,
      r.lch_produkt,
      r.lch_produktnr,
      r.lch_serienr,
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

function updateSelectAllState() {
  const cb = el("selectAllRows");
  if (!filtered.length) {
    cb.checked = false;
    cb.indeterminate = false;
    return;
  }
  const selectedCount = filtered.filter(r => selectedRowIds.has(r.id)).length;
  cb.checked = selectedCount === filtered.length;
  cb.indeterminate = selectedCount > 0 && selectedCount < filtered.length;
}

function render() {
  const selectedVisible = filtered.filter(r => selectedRowIds.has(r.id)).length;
  el("countText").textContent = `${filtered.length} vist / ${rows.length} total${selectedVisible ? " · " + selectedVisible + " markeret" : ""}`;

  if (!filtered.length) {
    el("tbody").innerHTML = `<tr><td colspan="12">Ingen linjer fundet</td></tr>`;
    updateSelectAllState();
    return;
  }

  el("tbody").innerHTML = filtered.map(r => {
    const imgs = parseImages(r.lch_billeder);
    const hasComment = String(r.lch_kommentar || "").trim().length > 0;

    return `
      <tr>
        <td class="checkCol">
          <input type="checkbox" ${r.lch_aktiv === false ? "checked" : ""} onchange="setDone('${esc(r.id)}', this.checked)">
        </td>
        <td>${esc(fmtDate(r.createdon))}</td>
        <td>${esc(r.lch_kundenummer)}</td>
        <td>${esc(r.lch_kundenavn)}</td>
        <td>${esc(r.lch_team)}</td>
        <td>
          <div>${esc(r.lch_produkt)}</div>
          <div style="font-size:12px;color:#6b7280;">${esc(r.lch_produktnr || "")}${r.lch_serienr ? " · " + esc(r.lch_serienr) : ""}</div>
        </td>
        <td>${esc(r.lch_ldn)}</td>
        <td>${esc(r.lch_tekniker)}</td>
        <td>${hasComment ? "Se vis" : "Ingen"}</td>
        <td class="rowSelectCol">
          <input type="checkbox" ${selectedRowIds.has(r.id) ? "checked" : ""} onchange="toggleRowSelected('${esc(r.id)}', this.checked)">
        </td>
        <td class="imagesLeft">${imgs.length}</td>
        <td><button type="button" onclick="openDetail('${esc(r.id)}')">Vis</button></td>
      </tr>
    `;
  }).join("");

  updateSelectAllState();
}

function toggleRowSelected(id, checked) {
  if (checked) selectedRowIds.add(id);
  else selectedRowIds.delete(id);
  render();
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
      ${detail("Team", r.lch_team)}
      ${detail("Produkt", r.lch_produkt)}
      ${detail("Produktnr.", r.lch_produktnr)}
      ${detail("Serienr.", r.lch_serienr)}
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
        <button type="button" class="primary" onclick="startNamedDownload('${esc(r.id)}')">Gem markerede</button>
      </div>
      <div class="imageGrid">
        ${
          imgs.length
            ? imgs.map((img, i) => `
                <div class="imageCard">
                  <a href="${esc(img.url || "#")}" target="_blank" rel="noopener">
                    <img src="${esc(img.url || "")}" alt="">
                  </a>
                  <label class="imageOnlyCheck">
                    <input class="imageCheck" type="checkbox" data-index="${i}">
                    <span>Vælg</span>
                  </label>
                </div>
              `).join("")
            : "<p>Ingen billeder.</p>"
        }
      </div>
    </div>
  `;

  el("detailBackdrop").classList.remove("hidden");
  el("detailDrawer").classList.remove("hidden");
}

function detail(label, value) {
  return `
    <div>
      <div class="detailLabel">${esc(label)}</div>
      <div class="detailValue">${esc(value || "")}</div>
    </div>
  `;
}

function closeDetail() {
  el("detailBackdrop").classList.add("hidden");
  el("detailDrawer").classList.add("hidden");
}

function selectAllImages(value) {
  document.querySelectorAll(".imageCheck").forEach(cb => {
    cb.checked = value;
  });
}

function startSelectedRowsDownload() {
  const selectedRows = rows.filter(r => selectedRowIds.has(r.id));
  if (!selectedRows.length) {
    alert("Marker mindst én række.");
    return;
  }

  const selected = [];
  for (const row of selectedRows) {
    const imgs = parseImages(row.lch_billeder);
    imgs.forEach((image, index) => selected.push({ row, image, index }));
  }

  if (!selected.length) {
    alert("De markerede rækker har ingen billeder.");
    return;
  }

  openNameModal(selected);
}

function startNamedDownload(id) {
  const row = rows.find(x => x.id === id);
  if (!row) return;

  const imgs = parseImages(row.lch_billeder);
  const selected = Array.from(document.querySelectorAll(".imageCheck:checked"))
    .map(cb => {
      const index = Number(cb.dataset.index);
      return { row, image: imgs[index], index };
    })
    .filter(x => x.image);

  if (!selected.length) {
    alert("Marker mindst ét billede.");
    return;
  }

  openNameModal(selected);
}

function openNameModal(selected) {
  pendingDownload = { selected };

  el("nameContent").classList.remove("hidden");
  el("downloadProgress").classList.add("hidden");
  setDownloadProgress("", 0);

  el("folderInfo").textContent = "Næste trin: tryk Gem billeder og vælg den mappe billederne skal gemmes i.";
  if (!window.showDirectoryPicker) {
    el("folderInfo").textContent = "Din browser understøtter ikke mappevalg. Der bruges almindelig download i stedet. Brug Edge eller Chrome på PC for mappevalg.";
  }

  el("nameList").innerHTML = selected.map((x, i) => {
    const defaultName = `${x.row.lch_kundenummer || "kunde"} - ${x.row.lch_produkt || "produkt"} - ${i + 1}`;
    return `
      <div class="nameItem">
        <img src="${esc(x.image.url || "")}" alt="">
        <div>
          <label>Filnavn ${i + 1}</label>
          <input class="nameInput" type="text" value="${esc(defaultName)}" data-pos="${i}">
          <div class="hint">Original filtype bevares automatisk</div>
        </div>
      </div>
    `;
  }).join("");

  el("nameBackdrop").classList.remove("hidden");
  el("nameModal").classList.remove("hidden");

  const first = document.querySelector(".nameInput");
  if (first) {
    first.focus();
    first.select();
  }
}

function closeNameModal() {
  pendingDownload = null;
  el("nameBackdrop").classList.add("hidden");
  el("nameModal").classList.add("hidden");
  el("nameContent").classList.remove("hidden");
  el("downloadProgress").classList.add("hidden");
}

async function fetchImageBlob(image, fileName) {
  const r = await fetch("/api/downloadimage", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image, fileName })
  });

  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw new Error(j.error || `Download fejl ${r.status}`);
  }

  return await r.blob();
}

async function saveNamedImagesToFolder() {
  if (!pendingDownload) return;

  const inputs = Array.from(document.querySelectorAll(".nameInput"));
  const selected = pendingDownload.selected;

  el("nameContent").classList.add("hidden");
  el("downloadProgress").classList.remove("hidden");
  setDownloadProgress("Forbereder...", 0);

  try {
    if (window.showDirectoryPicker) {
      const dirHandle = await window.showDirectoryPicker({ mode: "readwrite" });

      for (let i = 0; i < selected.length; i++) {
        const item = selected[i];
        const input = inputs[i];
        const fileName = buildDownloadFileName(input?.value || "", item.image.name || item.image.path || "", i);
        const pctFetch = Math.round((i / selected.length) * 100);
        setDownloadProgress(`Henter billede ${i + 1} af ${selected.length}...`, pctFetch);

        const blob = await fetchImageBlob(item.image, fileName);

        setDownloadProgress(`Gemmer billede ${i + 1} af ${selected.length}...`, Math.round(((i + .75) / selected.length) * 100));

        const fileHandle = await dirHandle.getFileHandle(fileName, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(blob);
        await writable.close();
      }

      setDownloadProgress("Færdig. Billederne er gemt.", 100);
      setTimeout(closeNameModal, 900);
      return;
    }

    for (let i = 0; i < selected.length; i++) {
      const item = selected[i];
      const input = inputs[i];
      const fileName = buildDownloadFileName(input?.value || "", item.image.name || item.image.path || "", i);
      setDownloadProgress(`Downloader billede ${i + 1} af ${selected.length}...`, Math.round((i / selected.length) * 100));

      const blob = await fetchImageBlob(item.image, fileName);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();

      setTimeout(() => URL.revokeObjectURL(a.href), 30000);
      await new Promise(resolve => setTimeout(resolve, 350));
    }

    setDownloadProgress("Færdig.", 100);
    setTimeout(closeNameModal, 900);
  } catch (e) {
    if (e?.name === "AbortError") {
      el("nameContent").classList.remove("hidden");
      el("downloadProgress").classList.add("hidden");
      return;
    }

    setDownloadProgress("Fejl: " + e.message, 100);
  }
}

function openQr() {
  const handoverUrl = `${location.origin}/handover.html`;
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=280x280&margin=12&data=${encodeURIComponent(handoverUrl)}`;

  el("qrImage").src = qrUrl;
  el("qrUrl").value = handoverUrl;

  el("qrBackdrop").classList.remove("hidden");
  el("qrModal").classList.remove("hidden");
}

function closeQr() {
  el("qrBackdrop").classList.add("hidden");
  el("qrModal").classList.add("hidden");
}

init();
