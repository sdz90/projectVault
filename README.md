# Vault — personal file browser

A private, Dropbox-style file browser. Google login, drag-and-drop upload,
nested folders, shareable links, and image/video previews. Files live in
**Cloudinary**, folder structure and metadata in **Firestore**, hosted on **Netlify**.

```
You ── Google login ──> Vault (Netlify static site)
                          │
                          ├─ Firestore: folders + file metadata (per-user)
                          └─ Upload: browser → Netlify function (signs) → Cloudinary CDN
```

The Cloudinary secret never touches the browser — a Netlify function verifies your
Firebase login and signs each upload server-side.

---

## 1. Cloudinary (file storage)

1. Make a free account at cloudinary.com.
2. Dashboard → copy your **Cloud name**, **API Key**, **API Secret**.

## 2. Firebase (auth + metadata)

1. console.firebase.google.com → **Add project**.
2. **Build → Authentication → Get started → Google → Enable.**
   - Under Authentication → Settings → Authorized domains, add your Netlify
     domain (e.g. `yourvault.netlify.app`) once you have it.
3. **Build → Firestore Database → Create database** (production mode).
4. **Project settings → General → Your apps → Web (`</>`)** to get the web config.
   Paste those values into `public/js/config.js`.
5. Publish the security rules in `firestore.rules`:
   - Firestore → Rules → paste the file contents → **Publish**.
6. Firestore needs one composite index for the listing query. Either:
   - Run the app once, open the browser console, and click the auto-generated
     "create index" link Firestore prints, **or**
   - Create it manually: Collection `items`, fields `owner` (Asc),
     `parent` (Asc), `type` (Asc), `name` (Asc).

## 3. Configure

Edit `public/js/config.js`:
- `firebaseConfig` — from step 2.4
- `CLOUDINARY_CLOUD_NAME` — from step 1
- `ALLOWED_EMAIL` — optional; set to your Gmail to lock the vault to just you.

## 4. Deploy to Netlify

1. Push this folder to a GitHub repo.
2. Netlify → **Add new site → Import from Git** → pick the repo.
   Build settings are read from `netlify.toml` automatically.
3. **Site settings → Environment variables**, add:
   - `CLOUDINARY_API_KEY`
   - `CLOUDINARY_API_SECRET`
   - `FIREBASE_PROJECT_ID` (same as in config.js)
   - `ALLOWED_EMAIL` (optional — match config.js)
4. Deploy. Add the Netlify domain to Firebase authorized domains (step 2.2).

That's it. Visit the site, sign in with Google, start uploading.

---

## Notes

- **Sharing:** every file's Cloudinary URL is public-but-unguessable. "Copy share
  link" puts it on your clipboard. Anyone with the link can view; no login needed.
- **Deleting files** removes both the Firestore record **and** the blob in
  Cloudinary, so you get the storage space back. Deleting a folder recursively
  cleans up every file inside it. This is handled by the `delete-file` function,
  which verifies your login and only allows deleting files under your own
  `vault/<uid>/` path.
- **Limits:** Cloudinary free tier is generous for personal use; large video may need
  a paid plan. Netlify functions cover the signing calls easily.
- **Local dev:** `npm i -g netlify-cli` then `netlify dev` (loads env vars + functions).
