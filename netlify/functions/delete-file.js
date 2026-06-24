// Netlify Function: deletes a file from Cloudinary.
// Verifies the caller's Firebase ID token, then calls Cloudinary's destroy API
// with a server-side signature. The api_secret never reaches the browser.

const crypto = require("crypto");

const {
  CLOUDINARY_CLOUD_NAME,
  CLOUDINARY_API_KEY,
  CLOUDINARY_API_SECRET,
  FIREBASE_PROJECT_ID,
  ALLOWED_EMAIL, // optional
} = process.env;

exports.handler = async (event) => {
  if (event.httpMethod !== "POST")
    return json(405, { error: "Method not allowed" });

  // --- Verify Firebase ID token ---
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

  // --- Validate request ---
  const body = JSON.parse(event.body || "{}");
  const publicId = body.publicId;
  const resourceType = ["image", "video", "raw"].includes(body.resourceType)
    ? body.resourceType
    : "image";
  if (!publicId) return json(400, { error: "Missing publicId" });

  // Defence in depth: only allow deleting files inside this user's folder.
  // (uploads are stored under vault/<uid>/...)
  if (!publicId.startsWith(`vault/${claims.user_id || claims.sub}`))
    return json(403, { error: "Not your file" });

  // --- Build Cloudinary destroy signature (params sorted alphabetically) ---
  const timestamp = Math.round(Date.now() / 1000);
  const toSign = `public_id=${publicId}&timestamp=${timestamp}`;
  const signature = crypto
    .createHash("sha1")
    .update(toSign + CLOUDINARY_API_SECRET)
    .digest("hex");

  const form = new URLSearchParams({
    public_id: publicId,
    timestamp: String(timestamp),
    api_key: CLOUDINARY_API_KEY,
    signature,
  });

  const res = await fetch(
    `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/${resourceType}/destroy`,
    { method: "POST", body: form }
  );
  const result = await res.json();

  // Cloudinary returns { result: "ok" } on success, "not found" if already gone.
  if (result.result === "ok" || result.result === "not found")
    return json(200, { ok: true, result: result.result });

  return json(502, { error: "Cloudinary: " + (result.result || "unknown") });
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

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp < now) throw new Error("expired");
  if (payload.aud !== projectId) throw new Error("bad audience");
  if (payload.iss !== `https://securetoken.google.com/${projectId}`)
    throw new Error("bad issuer");

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
