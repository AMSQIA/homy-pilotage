#!/usr/bin/env node
/**
 * Test d'affichage du bloc « Flash Shopify » sur le build de production (dossier dist/).
 *
 *   node scripts/flash/smoke.mjs [--shots dossier]
 *
 * Lance un petit serveur statique, ouvre l'application dans Chromium (Playwright), passe
 * l'écran d'accès et vérifie : aucune erreur JavaScript, bloc Flash présent avec les chiffres
 * du bloc SHOPIFY_FLASH de App.jsx, quatre langues, pastille « non actualisé » après 3 jours,
 * affichage mobile sans débordement horizontal.
 *
 * Codes de sortie : 0 ok · 2 échec d'affichage · 77 test impossible (Playwright ou Chromium
 * indisponible : à signaler, ce n'est pas un échec de l'application).
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..", "..");
const DIST = path.join(REPO, "dist");
const shotsDir = process.argv.includes("--shots") ? process.argv[process.argv.indexOf("--shots") + 1] : null;

function chargerPlaywright() {
  const racines = [process.env.NODE_PATH, "/opt/npm-tools/node_modules"].filter(Boolean);
  try { racines.push(execSync("npm root -g", { encoding: "utf8" }).trim()); } catch { /* ignoré */ }
  racines.push(path.join(REPO, "node_modules"));
  for (const r of racines) {
    try { return createRequire(path.join(r, "_.js"))("playwright"); } catch { /* suivant */ }
  }
  return null;
}

const norm = (s) => s.replace(/[  ]/g, " ").replace(/\s+/g, " ").trim();
const contient = (texte, motif) => texte.toLowerCase().includes(norm(motif).toLowerCase());

function lireBloc() {
  const src = fs.readFileSync(path.join(REPO, "App.jsx"), "utf8");
  const F = JSON.parse(fs.readFileSync(path.join(REPO, "shopify_flash.json"), "utf8"));
  const dm = /DMAX = "(\d{4}-\d{2}-\d{2})"/.exec(src);
  const kpi = /"kpi":\{"ca_total_2026":([\d.]+),[^}]*"objectif_annuel_total":(\d+)/.exec(src);
  return { F, dmax: dm[1], ca: Number(kpi[1]), obj: Number(kpi[2]) };
}

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json", ".woff2": "font/woff2" };
function serveur() {
  return new Promise((ok) => {
    const s = http.createServer((req, res) => {
      let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
      if (p === "/") p = "/index.html";
      const f = path.join(DIST, path.normalize(p));
      if (!f.startsWith(DIST) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { "content-type": TYPES[path.extname(f)] ?? "application/octet-stream" });
      fs.createReadStream(f).pipe(res);
    });
    s.listen(0, "127.0.0.1", () => ok(s));
  });
}

const echecs = [];
const verifier = (cond, msg) => { if (!cond) echecs.push(msg); return cond; };

async function ouvrir(browser, { largeur = 1280, hauteur = 900, avance = 0 } = {}) {
  const ctx = await browser.newContext({ locale: "fr-FR", viewport: { width: largeur, height: hauteur } });
  const page = await ctx.newPage();
  const erreurs = [];
  page.on("pageerror", (e) => erreurs.push(`pageerror: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) erreurs.push(`console: ${m.text()}`); });
  page.on("response", (r) => {
    const u = new URL(r.url());
    if (r.status() >= 400 && !/favicon|^\/api\//.test(u.pathname)) erreurs.push(`ressource ${r.status()}: ${u.pathname}`);
  });
  await page.addInitScript((avanceMs) => {
    const reel = Date.now.bind(Date);
    if (avanceMs) Date.now = () => reel() + avanceMs;
    try { localStorage.setItem("homy_remember_until", String(reel() + 400 * 864e5)); } catch { /* ignoré */ }
  }, avance * 864e5);
  return { ctx, page, erreurs };
}

async function versDashboard(page, base) {
  await page.goto(base, { waitUntil: "load" });
  const passer = page.getByRole("button", { name: /Passer au dashboard|Skip to dashboard|跳到仪表盘|Ir al dashboard/ });
  await passer.first().click({ timeout: 20000 });
  await page.waitForSelector("text=/Flash Shopify|Shopify flash|Shopify 快报/", { timeout: 30000 });
}

async function textesCarte(page) {
  // Le texte de la carte entière : on remonte du titre jusqu'au conteneur de la carte
  return norm(await page.evaluate(() => {
    const el = [...document.querySelectorAll("span")].find((s) => /Flash Shopify|Shopify flash|Shopify 快报/.test(s.textContent));
    let n = el;
    for (let i = 0; i < 8 && n; i++, n = n.parentElement) if (n.className && String(n.className).includes("p-4") && String(n.className).includes("mb-5")) return n.innerText;
    return "";
  }));
}

async function main() {
  if (!fs.existsSync(path.join(DIST, "index.html"))) { console.error("dist/ introuvable : lancer « npx vite build » d'abord"); return 2; }
  const pw = chargerPlaywright();
  if (!pw) { console.log("TEST IMPOSSIBLE · Playwright introuvable"); return 77; }
  const { F, dmax, ca, obj } = lireBloc();
  if (!F) { console.log("Bloc Flash vide : rien à afficher, test sans objet"); return 0; }
  let browser;
  try { browser = await pw.chromium.launch(); } catch (e) { console.log(`TEST IMPOSSIBLE · Chromium indisponible (${String(e.message).split("\n")[0]})`); return 77; }
  const srv = await serveur();
  const base = `http://127.0.0.1:${srv.address().port}/`;
  try {
    const tot = F.jours.reduce((a, j) => ({ ca: a.ca + j.ca, cmd: a.cmd + j.cmd, qte: a.qte + j.qte }), { ca: 0, cmd: 0, qte: 0 });
    const attendu = {
      ca: `${Math.round(tot.ca / 1000)}k€`,
      cmd: norm(new Intl.NumberFormat("fr-FR").format(tot.cmd)),
      qte: norm(new Intl.NumberFormat("fr-FR").format(tot.qte)),
      panier: norm(new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(Math.round(tot.ca / tot.cmd)) + " €"),
      cumul: new Intl.NumberFormat("fr", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format((ca + tot.ca) / 1e6) + " M€",
      pctObj: ((ca + tot.ca) / obj * 100).toFixed(1) + " %",
      tendance: F.n1 && F.n1.ca > 0 ? Math.abs((tot.ca / F.n1.ca - 1) * 100).toFixed(0) + "%" : null,
    };

    // 1) français, bureau
    {
      const { ctx, page, erreurs } = await ouvrir(browser);
      await versDashboard(page, base);
      const t = await textesCarte(page);
      verifier(t.length > 50, "carte Flash introuvable ou vide");
      for (const [k, v] of Object.entries(attendu)) if (v) verifier(t.includes(norm(v)), `FR · « ${v} » (${k}) absent de la carte`);
      verifier(contient(t, "Cumul 2026 estimé"), "FR · libellé du cumul absent");
      verifier(!/Non actualisé/.test(t), "FR · pastille « non actualisé » affichée alors que les données sont fraîches");
      verifier(F.pays.slice(0, 5).every((p) => t.includes(p.nom)), "FR · un des 5 premiers pays est absent");
      verifier(F.produits.slice(0, 5).every((p) => t.includes(p.nom)), "FR · un des 5 premiers produits est absent");
      if (F.recoupement) verifier(/Contrôle .* Shopify .* vs fichier ODP hors site web/.test(t), "FR · phrase de contrôle absente");
      if (shotsDir) { fs.mkdirSync(shotsDir, { recursive: true }); await page.screenshot({ path: path.join(shotsDir, "bureau-fr.png"), fullPage: false }); }

      // 2) langues
      const marques = { en: ["Estimated 2026 total", "Same dates 2025 (Shopify)"], es: ["Acumulado 2026 estimado"], zh: ["2026 年预估累计"] };
      for (const [code, etiquette] of [["en", "EN"], ["es", "ES"], ["zh", "中文"]]) {
        await page.getByRole("button", { name: etiquette, exact: true }).last().click();
        await page.waitForTimeout(400);
        const tl = await textesCarte(page);
        for (const m of marques[code]) verifier(contient(tl, m), `${code.toUpperCase()} · « ${m} » absent de la carte`);
        verifier(!/\{(boutique|date|dmax|du|au|shopify|excel|ecart|n)\}/.test(tl), `${code.toUpperCase()} · variable de modèle non remplacée`);
      }
      verifier(erreurs.length === 0, `erreurs JavaScript (bureau) : ${erreurs.slice(0, 3).join(" | ")}`);
      await ctx.close();
    }

    // 3) pastille « non actualisé » : on avance l'horloge de 3 jours
    {
      const { ctx, page, erreurs } = await ouvrir(browser, { avance: 3 });
      await versDashboard(page, base);
      const t = await textesCarte(page);
      verifier(/Non actualisé depuis [34] j/.test(t), `pastille « non actualisé » absente après 3 jours (texte : ${t.slice(0, 120)})`);
      verifier(erreurs.length === 0, `erreurs JavaScript (horloge +3 j) : ${erreurs.slice(0, 3).join(" | ")}`);
      await ctx.close();
    }

    // 4) mobile : pas de défilement horizontal de la page
    {
      const { ctx, page, erreurs } = await ouvrir(browser, { largeur: 390, hauteur: 844 });
      await versDashboard(page, base);
      const defil = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      verifier(defil <= 1, `mobile : débordement horizontal de ${defil}px`);
      const t = await textesCarte(page);
      verifier(t.includes(norm(attendu.cumul)), "mobile : cumul absent");
      if (shotsDir) await page.screenshot({ path: path.join(shotsDir, "mobile-fr.png"), fullPage: false });
      verifier(erreurs.length === 0, `erreurs JavaScript (mobile) : ${erreurs.slice(0, 3).join(" | ")}`);
      await ctx.close();
    }
  } finally {
    await browser.close();
    srv.close();
  }
  if (echecs.length) { for (const e of echecs) console.log(`ÉCHEC · ${e}`); return 2; }
  console.log("SMOKE_OK · bloc Flash affiché (4 langues, pastille de fraîcheur, mobile), aucune erreur JavaScript");
  return 0;
}

main().then((c) => process.exit(c), (e) => { console.error(e); process.exit(2); });
