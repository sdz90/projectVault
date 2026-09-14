// Netlify Function: signs Cloudinary uploads.
// Verifies the caller's Firebase ID token so only your account can upload,
// then returns a short-lived signature. Cloudinary api_secret never reaches the browser.

const crypto = require("crypto");

const {
  CLOUDINARY_API_KEY,
  CLOUDINARY_API_SECRET,
  FIREBASE_PROJECT_ID,
  ALLOWED_EMAIL, // optional
} = process.env;

exports.handler = async (event) => {
  if (event.httpMethod !== "POST")
    return json(405, { error: "Method not allowed" });

  // --- Verify Firebase ID token (lightweight, no extra deps) ---
  const token = event.headers["x-token"] || event.headers["X-Token"];
  if (!token) return json(401, { error: "Missing token" });

  let claims;
  try {
    claims = await verifyFirebaseToken(token, FIREBASE_PROJECT_ID);
  } catch (e) {
    return json(401, { error: "Invalid token: " + e.message });
  }
  if (ALLOWED_EMAIL && claims.email !== ALLOWED_EMAIL)
    return json(403, { error: "Not allowed" });

  // --- Build Cloudinary signature ---
  const body = JSON.parse(event.body || "{}");
  const folder = (body.folder || "vault").replace(/[^a-zA-Z0-9/_-]/g, "");
  const timestamp = Math.round(Date.now() / 1000);

  // use_filename: base the stored name on the original filename (readable URLs).
  // unique_filename: still append random chars so names don't collide.
  const useFilename = "true";
  const uniqueFilename = "true";

  // Params to sign must be sorted alphabetically.
  const toSign =
    `folder=${folder}&timestamp=${timestamp}` +
    `&unique_filename=${uniqueFilename}&use_filename=${useFilename}`;
  const signature = crypto
    .createHash("sha1")
    .update(toSign + CLOUDINARY_API_SECRET)
    .digest("hex");

  return json(200, {
    signature,
    timestamp,
    folder,
    useFilename,
    uniqueFilename,
    apiKey: CLOUDINARY_API_KEY,
  });
};

function json(statusCode, obj) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(obj),
  };
}

/* --- Minimal Firebase ID token verification (RS256, Google public keys) --- */
let keyCache = { keys: null, exp: 0 };

async function verifyFirebaseToken(token, projectId) {
  const [h, p, s] = token.split(".");
  if (!h || !p || !s) throw new Error("malformed");
  const header = JSON.parse(b64url(h));
  const payload = JSON.parse(b64url(p));

  // Standard Firebase claim checks
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp < now) throw new Error("expired");
  if (payload.aud !== projectId) throw new Error("bad audience");
  if (payload.iss !== `https://securetoken.google.com/${projectId}`)
    throw new Error("bad issuer");

  // Fetch Google's public certs (cached)
  if (!keyCache.keys || keyCache.exp < now) {
    const r = await fetch(
      "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com"
    );
    keyCache.keys = await r.json();
    const cc = r.headers.get("cache-control") || "";
    const maxAge = parseInt((cc.match(/max-age=(\d+)/) || [])[1] || "3600", 10);
    keyCache.exp = now + maxAge;
  }
  const cert = keyCache.keys[header.kid];
  if (!cert) throw new Error("unknown key");

  const verifier = crypto.createVerify("RSA-SHA256");
  verifier.update(`${h}.${p}`);
  const ok = verifier.verify(cert, b64urlToBuf(s));
  if (!ok) throw new Error("bad signature");

  return payload;
}

const b64url = (str) =>
  Buffer.from(str.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
const b64urlToBuf = (str) =>
  Buffer.from(str.replace(/-/g, "+").replace(/_/g, "/"), "base64");
