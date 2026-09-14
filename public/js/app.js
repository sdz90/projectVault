import { firebaseConfig, CLOUDINARY_CLOUD_NAME, ALLOWED_EMAIL } from "/js/config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, collection, addDoc, deleteDoc, doc, query, where,
  orderBy, onSnapshot, serverTimestamp, getDocs
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const fb = initializeApp(firebaseConfig);
const auth = getAuth(fb);
const db = getFirestore(fb);

let user = null;
let cwd = "root";                       // current folder id
let path = [{ id: "root", name: "Vault" }];
let unsub = null;

const $ = (id) => document.getElementById(id);

/* ---------------- Auth ---------------- */
$("google-btn").onclick = () =>
  signInWithPopup(auth, new GoogleAuthProvider()).catch((e) => alert(e.message));
$("signout").onclick = () => signOut(auth);

onAuthStateChanged(auth, (u) => {
  if (u && (!ALLOWED_EMAIL || u.email === ALLOWED_EMAIL)) {
    user = u;
    $("login").classList.add("hidden");
    $("app").classList.remove("hidden");
    $("user").textContent = u.email;
    openFolder("root", "Vault", true);
  } else {
    if (u) { signOut(auth); alert("This vault is private."); }
    user = null;
    $("app").classList.add("hidden");
    $("login").classList.remove("hidden");
  }
});

/* ---------------- Navigation ---------------- */
function openFolder(id, name, reset) {
  cwd = id;
  if (reset) path = [{ id: "root", name: "Vault" }];
  else if (!path.find((p) => p.id === id)) path.push({ id, name });
  else path = path.slice(0, path.findIndex((p) => p.id === id) + 1);
  renderCrumbs();
  watchItems();
}

function renderCrumbs() {
  const c = $("crumbs");
  c.innerHTML = "";
  path.forEach((p, i) => {
    const b = document.createElement("button");
    b.className = "crumb" + (i === path.length - 1 ? " active" : "");
    b.textContent = p.name;
    b.onclick = () => openFolder(p.id, p.name);
    c.appendChild(b);
    if (i < path.length - 1) {
      const s = document.createElement("span");
      s.className = "sep"; s.textContent = "/";
      c.appendChild(s);
    }
  });
}

/* ---------------- Live listing ---------------- */
function watchItems() {
  if (unsub) unsub();
  const q = query(
    collection(db, "items"),
    where("owner", "==", user.uid),
    where("parent", "==", cwd),
    orderBy("type"),        // folders ('folder') vs files ('file') — folders first alphabetically
    orderBy("name")
  );
  unsub = onSnapshot(q, (snap) => {
    const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderGrid(items);
  });
}

let currentItems = [];
let viewMode = "grid";
let selectMode = false;
let selected = new Set();

function renderGrid(items) {
  currentItems = items;
  const grid = $("grid");
  grid.innerHTML = "";
  grid.className = "grid" + (viewMode === "list" ? " list" : "") + (selectMode ? " selecting" : "");
  $("empty").classList.toggle("hidden", items.length > 0);

  // Remove any previous list header, then add one if in list view.
  document.getElementById("list-head")?.remove();
  if (viewMode === "list" && items.length) {
    const head = document.createElement("div");
    head.id = "list-head";
    head.className = "list-head";
    head.innerHTML =
      `<span class="h-name">Name</span>` +
      `<span class="h-type col-type">Type</span>` +
      `<span class="h-date col-date">Modified</span>` +
      `<span class="h-size">Size</span>` +
      `<span></span>`;
    grid.before(head);
  }

  for (const it of items) {
    const el = document.createElement("div");
    el.className = "item" +
      (it.type === "folder" ? " folder" : "") +
      (it.type === "note" ? " note-item" : "") +
      (selected.has(it.id) ? " selected" : "");

    // Selection checkbox (visible only in select mode).
    if (selectMode) {
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.className = "sel-box";
      cb.checked = selected.has(it.id);
      cb.onclick = (e) => {
        e.stopPropagation();
        if (cb.checked) selected.add(it.id); else selected.delete(it.id);
        el.classList.toggle("selected", cb.checked);
        updateBulkBar();
      };
      el.appendChild(cb);
    }

    const thumb = document.createElement("div");
    thumb.className = "thumb";
    if (it.type === "folder") {
      thumb.innerHTML = `<span class="glyph">▤</span>`;
      thumb.onclick = () => openFolder(it.id, it.name);
    } else if (it.type === "note") {
      thumb.innerHTML = `<span class="glyph">✎</span>`;
      thumb.onclick = () => openNote(it);
    } else if (it.resourceType === "image") {
      thumb.innerHTML = `<img loading="lazy" src="${thumbUrl(it)}" alt="${esc(it.name)}" />`;
      thumb.onclick = () => preview(it);
    } else if (it.resourceType === "video") {
      thumb.innerHTML = `<video muted preload="metadata" src="${it.url}#t=0.1"></video>`;
      thumb.onclick = () => preview(it);
    } else {
      thumb.innerHTML = `<span class="glyph">${glyphFor(it.name)}</span>`;
      thumb.onclick = () => preview(it);
    }

    const kebab = document.createElement("button");
    kebab.className = "kebab"; kebab.textContent = "⋯";
    kebab.onclick = (e) => { e.stopPropagation(); toggleMenu(el, it); };

    if (viewMode === "list") {
      const rowName = document.createElement("div");
      rowName.className = "row-name";
      const nm = document.createElement("span");
      nm.className = "name"; nm.textContent = it.name;
      rowName.append(thumb, nm);
      if (it.type === "folder") rowName.onclick = () => openFolder(it.id, it.name);
      else if (it.type === "note") rowName.onclick = () => openNote(it);

      el.append(
        rowName,
        col("col-type", it.type === "folder" ? "Folder" : (it.type === "note" ? "Note" : typeLabel(it))),
        col("col-date", fmtDate(it.createdAt)),
        col("", it.type === "file" ? fmtSize(it.bytes) : "—"),
        kebab
      );
    } else {
      const meta = document.createElement("div");
      meta.className = "meta";
      meta.innerHTML =
        `<span class="name">${esc(it.name)}</span>` +
        (it.type === "file" ? `<span class="size">${fmtSize(it.bytes)}</span>` : "");

      // Quick-action overlay on hover (files only, not folders).
      if (it.type === "file") {
        const actions = document.createElement("div");
        actions.className = "hover-actions";

        const dl = document.createElement("button");
        dl.className = "ha-btn"; dl.title = "Download"; dl.setAttribute("aria-label", "Download");
        dl.innerHTML = "↓";
        dl.onclick = (e) => { e.stopPropagation(); downloadFile(it); };

        const share = document.createElement("button");
        share.className = "ha-btn"; share.title = "Copy share link"; share.setAttribute("aria-label", "Copy share link");
        share.innerHTML = "🔗";
        share.onclick = async (e) => {
          e.stopPropagation();
          try { await navigator.clipboard.writeText(it.url); } catch { fallbackCopy(it.url); }
          share.innerHTML = "✓"; share.title = "Link copied";
          setTimeout(() => { share.innerHTML = "🔗"; share.title = "Copy share link"; }, 1200);
        };

        const del = document.createElement("button");
        del.className = "ha-btn ha-danger"; del.title = "Delete"; del.setAttribute("aria-label", "Delete");
        del.innerHTML = "🗑";
        del.onclick = (e) => { e.stopPropagation(); remove(it); };

        actions.append(dl, share, del);
        thumb.appendChild(actions);
      }

      el.append(kebab, thumb, meta);
    }

    grid.appendChild(el);
  }
}

function col(cls, text) {
  const d = document.createElement("div");
  d.className = "col " + cls;
  d.textContent = text;
  return d;
}

/* ---------------- View toggle ---------------- */
$("view-toggle").addEventListener("click", (e) => {
  const b = e.target.closest(".vt-btn");
  if (!b) return;
  viewMode = b.dataset.view;
  document.querySelectorAll(".vt-btn").forEach((x) =>
    x.classList.toggle("active", x === b));
  renderGrid(currentItems);
});

/* ---------------- Selection / bulk delete ---------------- */
$("select-toggle").onclick = () => setSelectMode(true);
$("select-cancel").onclick = () => setSelectMode(false);

function setSelectMode(on) {
  selectMode = on;
  selected.clear();
  $("bulk-bar").classList.toggle("hidden", !on);
  $("select-toggle").classList.toggle("hidden", on);
  $("select-all").checked = false;
  updateBulkBar();
  renderGrid(currentItems);
}

function updateBulkBar() {
  const n = selected.size;
  $("bulk-count").textContent = `${n} selected`;
  $("bulk-delete").disabled = n === 0;
  // Keep "select all" checkbox in sync.
  $("select-all").checked = n > 0 && n === currentItems.length;
}

$("select-all").onclick = (e) => {
  if (e.target.checked) currentItems.forEach((it) => selected.add(it.id));
  else selected.clear();
  updateBulkBar();
  renderGrid(currentItems);
};

$("bulk-delete").onclick = async () => {
  const ids = [...selected];
  if (!ids.length) return;
  const items = currentItems.filter((it) => selected.has(it.id));
  const hasFolder = items.some((it) => it.type === "folder");
  const msg = `Delete ${ids.length} item${ids.length > 1 ? "s" : ""}?` +
    (hasFolder ? " Folders will be deleted with everything inside them." : "");
  if (!confirm(msg)) return;

  const btn = $("bulk-delete");
  btn.disabled = true;
  btn.textContent = "Deleting…";
  // Delete sequentially so Cloudinary cleanup runs for each file.
  for (const it of items) {
    try {
      if (it.type === "folder") await deleteTree(it.id);
      else if (it.type === "file") await destroyInCloudinary(it);
      await deleteDoc(doc(db, "items", it.id));
    } catch (err) {
      console.error("Failed to delete", it.name, err);
    }
  }
  btn.textContent = "Delete selected";
  setSelectMode(false);
};


/* ---------------- Item menu ---------------- */
function toggleMenu(parent, it) {
  document.querySelectorAll(".menu").forEach((m) => m.remove());
  const m = document.createElement("div");
  m.className = "menu";
  if (it.type === "file") {
    const download = btn("Download", () => downloadFile(it));
    const copy = btn("Copy share link", async () => {
      try { await navigator.clipboard.writeText(it.url); }
      catch { fallbackCopy(it.url); }
      copy.textContent = "Link copied ✓";
      setTimeout(() => (copy.textContent = "Copy share link"), 1400);
    });
    const open = btn("Open in new tab", () => window.open(it.url, "_blank"));
    m.append(download, copy, open);
  }
  if (it.type === "note") {
    const openEdit = btn("Open / edit", () => openNote(it));
    const copyText = btn("Copy text", async () => {
      try { await navigator.clipboard.writeText(it.content || ""); }
      catch {}
      copyText.textContent = "Copied ✓";
      setTimeout(() => (copyText.textContent = "Copy text"), 1200);
    });
    m.append(openEdit, copyText);
  }
  const ren = btn("Rename", () => rename(it));
  const del = btn("Delete", () => remove(it));
  del.className = "danger";
  m.append(ren, del);
  parent.appendChild(m);
  setTimeout(() => document.addEventListener("click", () => m.remove(), { once: true }), 0);
}
function btn(label, fn) {
  const b = document.createElement("button");
  b.textContent = label;
  b.onclick = (e) => { e.stopPropagation(); fn(); };
  return b;
}

// Clipboard fallback for insecure contexts / older browsers.
function fallbackCopy(text) {
  const ta = document.createElement("textarea");
  ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
  document.body.appendChild(ta); ta.select();
  try { document.execCommand("copy"); } catch {}
  ta.remove();
}

/* ---------------- CRUD ---------------- */
$("new-folder").onclick = async () => {
  const name = prompt("Folder name");
  if (!name) return;
  await addDoc(collection(db, "items"), {
    owner: user.uid, parent: cwd, type: "folder",
    name: name.trim(), createdAt: serverTimestamp(),
  });
};

$("new-note").onclick = () => openNote(null);

/* ---------------- Notes ---------------- */
let editingNoteId = null;

// Open the note editor. Pass an existing note item to edit, or null to create.
function openNote(it) {
  editingNoteId = it ? it.id : null;
  $("note-title").value = it ? it.name : "";
  $("note-text").value = it ? (it.content || "") : "";
  $("note-status").textContent = "";
  $("note-modal").classList.remove("hidden");
  // Focus the body for a new note, title stays empty; for existing, focus body too.
  setTimeout(() => $("note-text").focus(), 50);
}

function closeNote() {
  $("note-modal").classList.add("hidden");
  editingNoteId = null;
}

$("note-close").onclick = closeNote;
$("note-modal").onclick = (e) => { if (e.target.id === "note-modal") closeNote(); };

$("note-copy").onclick = async () => {
  const text = $("note-text").value;
  try {
    await navigator.clipboard.writeText(text);
    flashStatus("Copied to clipboard ✓");
  } catch {
    // Fallback for older browsers / insecure contexts.
    $("note-text").select();
    document.execCommand("copy");
    flashStatus("Copied ✓");
  }
};

$("note-save").onclick = async () => {
  const name = ($("note-title").value.trim()) || "Untitled note";
  const content = $("note-text").value;
  if (editingNoteId) {
    const { updateDoc } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
    await updateDoc(doc(db, "items", editingNoteId), { name, content, updatedAt: serverTimestamp() });
    flashStatus("Saved ✓");
  } else {
    const ref = await addDoc(collection(db, "items"), {
      owner: user.uid, parent: cwd, type: "note",
      name, content, createdAt: serverTimestamp(),
    });
    editingNoteId = ref.id;   // stay open, now editing the saved note
    flashStatus("Saved ✓");
  }
};

function flashStatus(msg) {
  const s = $("note-status");
  s.textContent = msg;
  setTimeout(() => { if (s.textContent === msg) s.textContent = ""; }, 1800);
}


async function rename(it) {
  const name = prompt("Rename to", it.name);
  if (!name || name === it.name) return;
  const { updateDoc } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
  await updateDoc(doc(db, "items", it.id), { name: name.trim() });
}

async function remove(it) {
  if (it.type === "folder") {
    const kids = await getDocs(query(collection(db, "items"),
      where("owner", "==", user.uid), where("parent", "==", it.id)));
    if (!kids.empty && !confirm(`"${it.name}" isn't empty. Delete it and everything inside?`)) return;
    await deleteTree(it.id);
  } else {
    if (!confirm(`Delete "${it.name}"?`)) return;
    await destroyInCloudinary(it);
  }
  await deleteDoc(doc(db, "items", it.id));
}

async function deleteTree(parentId) {
  const kids = await getDocs(query(collection(db, "items"),
    where("owner", "==", user.uid), where("parent", "==", parentId)));
  for (const k of kids.docs) {
    const data = k.data();
    if (data.type === "folder") await deleteTree(k.id);
    else await destroyInCloudinary(data);
    await deleteDoc(doc(db, "items", k.id));
  }
}

// Remove the actual blob from Cloudinary so it stops using storage.
async function destroyInCloudinary(it) {
  if (!it.publicId) return;            // nothing stored (shouldn't happen)
  try {
    const res = await fetch("/.netlify/functions/delete-file", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Token": await user.getIdToken() },
      body: JSON.stringify({ publicId: it.publicId, resourceType: it.resourceType }),
    }).then((r) => r.json());
    if (res.error) throw new Error(res.error);
  } catch (err) {
    // Don't block the Firestore delete, but let the user know cleanup failed.
    console.error("Cloudinary cleanup failed:", err);
    alert(`"${it.name}" was removed from your vault, but Cloudinary cleanup failed (${err.message}). The file may still use storage.`);
  }
}

/* ---------------- Upload (drag + picker) ---------------- */
const dz = $("dropzone");
["dragenter", "dragover"].forEach((ev) =>
  dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add("dragging"); }));
["dragleave", "drop"].forEach((ev) =>
  dz.addEventListener(ev, (e) => {
    e.preventDefault();
    if (ev === "dragleave" && dz.contains(e.relatedTarget)) return;
    dz.classList.remove("dragging");
  }));
dz.addEventListener("drop", (e) => handleFiles(e.dataTransfer.files));
$("file-input").onchange = (e) => { handleFiles(e.target.files); e.target.value = ""; };

function handleFiles(files) {
  [...files].forEach(uploadOne);
}

async function uploadOne(file) {
  const toast = makeToast(file.name);
  try {
    // 1. Ask our Netlify function to sign the upload.
    const sig = await fetch("/.netlify/functions/sign-upload", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Token": await user.getIdToken() },
      body: JSON.stringify({ folder: `vault/${user.uid}` }),
    }).then((r) => r.json());
    if (sig.error) throw new Error(sig.error);

    // 2. Upload directly to Cloudinary with the signature.
    const form = new FormData();
    form.append("file", file);
    form.append("api_key", sig.apiKey);
    form.append("timestamp", sig.timestamp);
    form.append("signature", sig.signature);
    form.append("folder", sig.folder);

    const res = await xhrUpload(
      `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/auto/upload`,
      form,
      (pct) => setToast(toast, pct)
    );

    // 3. Record metadata in Firestore.
    await addDoc(collection(db, "items"), {
      owner: user.uid, parent: cwd, type: "file",
      name: file.name,
      url: res.secure_url,
      publicId: res.public_id,
      resourceType: res.resource_type,     // image | video | raw
      format: res.format || "",
      bytes: res.bytes || file.size,
      createdAt: serverTimestamp(),
    });
    finishToast(toast, true);
  } catch (err) {
    console.error(err);
    finishToast(toast, false, err.message);
  }
}

function xhrUpload(url, form, onProgress) {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open("POST", url);
    x.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
    x.onload = () => (x.status < 300 ? resolve(JSON.parse(x.responseText)) : reject(new Error("Upload failed")));
    x.onerror = () => reject(new Error("Network error"));
    x.send(form);
  });
}

/* ---------------- Upload toasts ---------------- */
function makeToast(name) {
  const t = document.createElement("div");
  t.className = "toast";
  t.innerHTML = `<div class="tname">${esc(name)}</div><div class="bar"><i></i></div>`;
  $("uploads").appendChild(t);
  return t;
}
function setToast(t, pct) { t.querySelector("i").style.width = pct + "%"; }
function finishToast(t, ok, msg) {
  if (ok) { t.classList.add("done"); setToast(t, 100); }
  else { t.classList.add("err"); t.querySelector(".tname").textContent += " — " + (msg || "failed"); }
  setTimeout(() => t.remove(), ok ? 1800 : 5000);
}

/* ---------------- Preview ---------------- */
function preview(it) {
  const body = $("preview-body");
  if (it.resourceType === "image") body.innerHTML = `<img src="${it.url}" alt="${esc(it.name)}" />`;
  else if (it.resourceType === "video") body.innerHTML = `<video src="${it.url}" controls autoplay></video>`;
  else body.innerHTML = `<div class="file-fallback"><p>${esc(it.name)}</p>
    <a class="btn-primary" href="${downloadUrl(it)}">Download</a></div>`;
  $("preview").classList.remove("hidden");
}
$("preview-close").onclick = () => $("preview").classList.add("hidden");
$("preview").onclick = (e) => { if (e.target.id === "preview") $("preview").classList.add("hidden"); };

/* ---------------- Helpers ---------------- */
function thumbUrl(it) {
  // On-the-fly Cloudinary thumbnail transform.
  return it.url.replace("/upload/", "/upload/c_fill,w_400,h_300,q_auto,f_auto/");
}

// Build a URL that forces a download using the original filename.
// For image/video, Cloudinary's fl_attachment injects the name (extension kept
// automatically, so we strip it and any dots, which the flag disallows).
function downloadUrl(it) {
  if (it.resourceType === "image" || it.resourceType === "video") {
    const base = it.name.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9_-]/g, "_");
    return it.url.replace("/upload/", `/upload/fl_attachment:${base}/`);
  }
  // Raw files (txt/pdf/zip): fl_attachment (no name) still forces download;
  // the raw public_id already carries the original name + extension.
  return it.url.replace("/upload/", "/upload/fl_attachment/");
}

// Trigger a download without navigating away.
function downloadFile(it) {
  const a = document.createElement("a");
  a.href = downloadUrl(it);
  a.download = it.name;          // hint for same-origin; Cloudinary header wins cross-origin
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function fmtSize(b) {
  if (!b) return "";
  const u = ["B", "KB", "MB", "GB"];
  let i = 0; while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; }
  return b.toFixed(b < 10 && i > 0 ? 1 : 0) + " " + u[i];
}
// Short human-readable type label for the list view.
function typeLabel(it) {
  const ext = (it.name.split(".").pop() || "").toUpperCase();
  if (ext && ext !== it.name.toUpperCase()) return ext;
  return it.resourceType ? it.resourceType : "File";
}
// Format Firestore timestamp (or fall back gracefully if not yet set).
function fmtDate(ts) {
  const d = ts && typeof ts.toDate === "function" ? ts.toDate() : null;
  if (!d) return "—";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
function glyphFor(name) {
  const ext = (name.split(".").pop() || "").toLowerCase();
  if (["pdf"].includes(ext)) return "▦";
  if (["zip", "rar", "7z"].includes(ext)) return "▣";
  if (["mp3", "wav", "flac", "m4a"].includes(ext)) return "♪";
  if (["doc", "docx", "txt", "md"].includes(ext)) return "▤";
  return "▢";
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
