// /api/data — Vercel Serverless Function (Node.js runtime).
// Ne renvoie les données de l'entreprise que si un cookie de session valide
// (émis par /api/login) est présent. lecture via fs plutôt qu'un import JSON
// ESM pour rester compatible sans dépendre d'une syntaxe d'import spécifique
// à une version de Node.

import crypto from "crypto";
import fs from "fs";
import path from "path";

function sign(value, secret) {
  return crypto.createHmac("sha256", secret).update(value).digest("hex");
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  header.split(";").forEach((part) => {
    const idx = part.indexOf("=");
    if (idx === -1) return;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  });
  return out;
}

function sessionValide(req, secret) {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies.homy_session;
  if (!token) return false;
  const idx = token.lastIndexOf(".");
  if (idx === -1) return false;
  const payload = token.slice(0, idx);
  const signature = token.slice(idx + 1);
  const attendu = sign(payload, secret);
  if (signature.length !== attendu.length) return false;
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(attendu))) return false;
  const expiry = Number(payload);
  return Number.isFinite(expiry) && expiry > Date.now();
}

export default function handler(req, res) {
  const sessionSecret = process.env.SESSION_SECRET;
  if (!sessionSecret) {
    res.status(500).json({ error: "server_not_configured" });
    return;
  }
  if (!sessionValide(req, sessionSecret)) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const dataPath = path.join(process.cwd(), "api", "_data.json");
  const raw = fs.readFileSync(dataPath, "utf-8");
  res.setHeader("Content-Type", "application/json");
  res.status(200).send(raw);
}
