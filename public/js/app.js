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

function renderGrid(items) {
  const grid = $("grid");
  grid.innerHTML = "";
  $("empty").classList.toggle("hidden", items.length > 0);

  for (const it of items) {
    const el = document.createElement("div");
    el.className = "item" + (it.type === "folder" ? " folder" : "");

    const thumb = document.createElement("div");
    thumb.className = "thumb";
    if (it.type === "folder") {
      thumb.innerHTML = `<span class="glyph">▤</span>`;
      thumb.onclick = () => openFolder(it.id, it.name);
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

    const meta = document.createElement("div");
    meta.className = "meta";
    meta.innerHTML =
      `<span class="name">${esc(it.name)}</span>` +
      (it.type === "file" ? `<span class="size">${fmtSize(it.bytes)}</span>` : "");

    const kebab = document.createElement("button");
    kebab.className = "kebab"; kebab.textContent = "⋯";
    kebab.onclick = (e) => { e.stopPropagation(); toggleMenu(el, it); };

    el.append(kebab, thumb, meta);
    grid.appendChild(el);
  }
}

/* ---------------- Item menu ---------------- */
function toggleMenu(parent, it) {
  document.querySelectorAll(".menu").forEach((m) => m.remove());
  const m = document.createElement("div");
  m.className = "menu";
  if (it.type === "file") {
    const copy = btn("Copy share link", () => {
      navigator.clipboard.writeText(it.url);
      copy.textContent = "Copied ✓";
      setTimeout(() => (copy.textContent = "Copy share link"), 1200);
    });
    const open = btn("Open in new tab", () => window.open(it.url, "_blank"));
    m.append(copy, open);
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

/* ---------------- CRUD ---------------- */
$("new-folder").onclick = async () => {
  const name = prompt("Folder name");
  if (!name) return;
  await addDoc(collection(db, "items"), {
    owner: user.uid, parent: cwd, type: "folder",
    name: name.trim(), createdAt: serverTimestamp(),
  });
};

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
    <a class="btn-primary" href="${it.url}" target="_blank" rel="noopener">Download</a></div>`;
  $("preview").classList.remove("hidden");
}
$("preview-close").onclick = () => $("preview").classList.add("hidden");
$("preview").onclick = (e) => { if (e.target.id === "preview") $("preview").classList.add("hidden"); };

/* ---------------- Helpers ---------------- */
function thumbUrl(it) {
  // On-the-fly Cloudinary thumbnail transform.
  return it.url.replace("/upload/", "/upload/c_fill,w_400,h_300,q_auto,f_auto/");
}
function fmtSize(b) {
  if (!b) return "";
  const u = ["B", "KB", "MB", "GB"];
  let i = 0; while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; }
  return b.toFixed(b < 10 && i > 0 ? 1 : 0) + " " + u[i];
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
