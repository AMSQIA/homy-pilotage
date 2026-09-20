// /api/login — Vercel Serverless Function (Node.js runtime).
// Vérifie le mot de passe côté serveur (jamais dans le code client) et émet
// un cookie de session HttpOnly signé en cas de succès. Aucune donnée de
// l'entreprise ne transite ici — juste la vérification d'accès.

import crypto from "crypto";

const SESSION_HOURS = 12; // durée de validité de la session avant nouvelle connexion

function sign(value, secret) {
  return crypto.createHmac("sha256", secret).update(value).digest("hex");
}

function timingSafeEqual(a, b) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    // comparaison quand même effectuée (sur bufA vs bufA) pour garder un
    // temps d'exécution constant, indépendant du fait que les longueurs
    // diffèrent — évite de révéler la longueur du mot de passe via le timing
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

// lecture robuste du corps JSON — Vercel pré-analyse généralement req.body en
// objet quand Content-Type est application/json, mais ce n'est pas garanti
// selon la version du runtime : si req.body est absent ou vide, on relit le
// flux brut nous-mêmes plutôt que de retomber silencieusement sur un mot de
// passe vide (ce qui ferait échouer TOUTE tentative, même avec le bon mot de
// passe — exactement le symptôme "mot de passe incorrect" à tort)
function readBody(req) {
  return new Promise((resolve) => {
    if (req.body && typeof req.body === "object") { resolve(req.body); return; }
    if (typeof req.body === "string" && req.body.length) {
      try { resolve(JSON.parse(req.body)); return; } catch { /* on retente via le flux ci-dessous */ }
    }
    let raw = "";
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      try { resolve(JSON.parse(raw || "{}")); } catch { resolve({}); }
    });
    req.on("error", () => resolve({}));
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }

  const appPassword = process.env.APP_PASSWORD;
  const sessionSecret = process.env.SESSION_SECRET;
  if (!appPassword || !sessionSecret) {
    // configuration manquante côté Vercel — cf. instructions de déploiement
    res.status(500).json({ error: "server_not_configured" });
    return;
  }

  const body = await readBody(req);
  const password = (body && body.password) || "";

  if (!timingSafeEqual(password, appPassword)) {
    res.status(401).json({ error: "invalid_password" });
    return;
  }

  const expiry = Date.now() + SESSION_HOURS * 60 * 60 * 1000;
  const payload = String(expiry);
  const signature = sign(payload, sessionSecret);
  const token = `${payload}.${signature}`;

  res.setHeader(
    "Set-Cookie",
    `homy_session=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${SESSION_HOURS * 3600}`
  );
  res.status(200).json({ ok: true });
}
