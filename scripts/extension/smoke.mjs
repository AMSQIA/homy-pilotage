#!/usr/bin/env node
/**
 * Test d'affichage du tableau de bord construit sur les ventes Shopify, sur le build de production (dossier dist/).
 *
 *   npx vite build && node scripts/extension/smoke.mjs [--shots dossier] [--racine dossier]
 *
 * Lance un petit serveur statique, ouvre l'application dans Chromium (Playwright) et vérifie :
 *   - le bandeau « Données Shopify à jour » (date de dernière donnée, source unique, graphique des 30 derniers jours,
 *     notes de méthode) en français, anglais, espagnol et chinois, sans variable de modèle restante ;
 *   - les chiffres affichés = ceux que calcule socle.js sur les vrais fichiers du dépôt (CA cumulé, unités, % de l'objectif,
 *     comparaison avec 2025, filtres Site Web et Leroy Merlin) ;
 *   - la pastille « non actualisé » quand l'extraction a plus de 2 jours ;
 *   - l'écran « Données Shopify indisponibles » quand l'extraction est illisible (le build est altéré à la volée) ;
 *   - les 7 onglets s'ouvrent sans erreur JavaScript ; affichage mobile sans débordement horizontal.
 *
 * Codes de sortie : 0 ok · 2 échec d'affichage · 77 test impossible (Playwright ou Chromium indisponible : à
 * signaler, ce n'est pas un échec de l'application).
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { createRequire } from "node:module";
import { execSync } from "node:child_process";

const argRacine = process.argv.includes("--racine") ? process.argv[process.argv.indexOf("--racine") + 1] : null;
if (argRacine) process.env.HOMY_RACINE = path.resolve(argRacine); // doit précéder l'import de lib_app.mjs
const { construireDepuisDepot, RACINE } = await import("./lib_app.mjs");

const DIST = path.join(RACINE, "dist");
const shotsDir = process.argv.includes("--shots") ? process.argv[process.argv.indexOf("--shots") + 1] : null;

function chargerPlaywright() {
  const racines = [process.env.NODE_PATH, "/opt/npm-tools/node_modules"].filter(Boolean);
  try { racines.push(execSync("npm root -g", { encoding: "utf8" }).trim()); } catch { /* ignoré */ }
  racines.push(path.join(RACINE, "node_modules"));
  for (const r of racines) {
    try { return createRequire(path.join(r, "_.js"))("playwright"); } catch { /* suivant */ }
  }
  return null;
}

const norm = (s) => String(s).replace(/[  ]/g, " ").replace(/\s+/g, " ").trim();
const contient = (texte, motif) => norm(texte).toLowerCase().includes(norm(motif).toLowerCase());
const PLACEHOLDERS = /\{(odp|du|au|date|n|dmax|mp|site)\}/;
const fmtNum = (n) => norm(new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(Math.round(n)));
const lieu = (lang) => (lang === "zh" ? "zh-CN" : lang);
const jour = (iso, lang) => new Date(iso + "T12:00:00").toLocaleDateString(lieu(lang), { day: "numeric", month: "short" });
const fmtPct = (n) => `${n > 0 ? "+" : ""}${n.toFixed(1)} %`;

/** Chiffres attendus : exactement ce que calcule l'application au chargement, depuis les fichiers du dépôt. */
function attendus() {
  const { ext, rap } = construireDepuisDepot();
  if (!rap.appliquee) return { rap, ext };
  const D = rap.C.DATA;
  const mp = (nom) => D.mp_vs_objectif.find((m) => m.marketplace === nom);
  const debut30 = new Date(Date.parse(rap.dmax + "T00:00:00Z") - 29 * 864e5).toISOString().slice(0, 10);
  const ca30 = { mp: 0, site: 0 };
  let siteDepuis = null;
  for (const [d, im, , , c] of ext.lignes) {
    const site = ext.mp[im] === "Site Web";
    if (site && (siteDepuis === null || d < siteDepuis)) siteDepuis = d;
    if (d >= debut30 && d <= rap.dmax) ca30[site ? "site" : "mp"] += c;
  }
  const n1 = D.total_yoy_comparable[2025];
  return {
    rap, ext, ca30, siteDepuis,
    cumul: D.kpi.ca_total_2026, qte: D.kpi.qte_total_2026, pct: Math.round(D.kpi.pct_objectif_atteint),
    n1, yoy: n1 > 0 ? (D.kpi.ca_total_2026 / n1 - 1) * 100 : null,
    site: mp("Site Web")?.ca ?? 0, leroy: mp("Leroy Merlin")?.ca ?? 0,
  };
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

async function ouvrir(browser, { largeur = 1280, hauteur = 900, avance = 0, langue = "fr-FR" } = {}) {
  const ctx = await browser.newContext({ locale: langue, viewport: { width: largeur, height: hauteur } });
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
  }, avance);
  return { ctx, page, erreurs };
}

const TITRES = { fr: "Données Shopify à jour", en: "Shopify data up to date", es: "Datos de Shopify actualizados", zh: "Shopify 数据已更新" };
const SOURCES = { fr: "Source unique : Shopify", en: "Single source: Shopify", es: "Fuente única: Shopify", zh: "唯一数据来源：Shopify" };

async function ouvrirDashboard(page, base, { lang = "fr", tab = "apercu", marketplace } = {}) {
  const q = new URLSearchParams({ lang, tab });
  if (marketplace) q.set("marketplace", marketplace);
  await page.goto(`${base}?${q}`, { waitUntil: "load" });
  await page.waitForFunction(() => document.body && document.body.innerText.length > 400, null, { timeout: 30000 });
  await page.waitForTimeout(600); // animations d'entrée
}

// Texte de la carte « Données Shopify » (on remonte du titre jusqu'au conteneur de la carte)
const texteBandeau = (page, lang) => page.evaluate((titre) => {
  const el = [...document.querySelectorAll("span")].find((s) => s.textContent.trim().toLowerCase() === titre.toLowerCase());
  let n = el;
  for (let i = 0; i < 8 && n; i++, n = n.parentElement) if (n.className && String(n.className).includes("p-4") && String(n.className).includes("mb-5")) return n.innerText;
  return "";
}, TITRES[lang]).then(norm);

async function main() {
  if (!fs.existsSync(path.join(DIST, "index.html"))) { console.error("dist/ introuvable : lancer « npx vite build » d'abord"); return 2; }
  const E = attendus();
  if (!E.rap.appliquee) { console.log(`ÉCHEC · le tableau de bord ne se construit pas avec les données du dépôt : ${(E.rap.erreurs || []).join(" ; ")}`); return 2; }
  const pw = chargerPlaywright();
  if (!pw) { console.log("TEST IMPOSSIBLE · Playwright introuvable"); return 77; }
  let browser;
  try { browser = await pw.chromium.launch(); } catch (e) { console.log(`TEST IMPOSSIBLE · Chromium indisponible (${String(e.message).split("\n")[0]})`); return 77; }
  const srv = await serveur();
  const base = `http://127.0.0.1:${srv.address().port}/`;
  const dmax = E.rap.dmax;
  try {
    // 1) français, bureau : bandeau, chiffres du bandeau déplié, KPI
    {
      const { ctx, page, erreurs } = await ouvrir(browser);
      await ouvrirDashboard(page, base);
      let b = await texteBandeau(page, "fr");
      verifier(b.length > 40, "bandeau « Données Shopify à jour » introuvable");
      verifier(contient(b, `jusqu'au ${jour(dmax, "fr")}`), `FR · bandeau : « jusqu'au ${jour(dmax, "fr")} » absent (${b.slice(0, 100)})`);
      verifier(contient(b, SOURCES.fr) && contient(b, String(dmax.slice(0, 4))), `FR · bandeau : source unique / période absentes (${b.slice(0, 160)})`);
      verifier(!/Non actualisé/.test(b), "FR · pastille « non actualisé » affichée alors que l'extraction est fraîche");
      await page.locator("button", { hasText: TITRES.fr }).first().click();
      await page.waitForTimeout(500);
      b = await texteBandeau(page, "fr");
      verifier(contient(b, `Marketplaces ${Math.round(E.ca30.mp / 1000)}k€`) && contient(b, `Site web ${Math.round(E.ca30.site / 1000)}k€`), `FR · bandeau déplié : totaux Marketplaces ${Math.round(E.ca30.mp / 1000)}k€ / Site web ${Math.round(E.ca30.site / 1000)}k€ absents`);
      verifier(contient(b, "Bricoman ne se distingue pas") && contient(b, "Ne viennent pas de Shopify"), "FR · bandeau déplié : notes de méthode absentes");
      verifier(!E.siteDepuis || E.siteDepuis <= "2024-01-01" || contient(b, "Le site web n'existe dans Shopify que depuis le"), "FR · bandeau déplié : note sur le début de l'historique du site absente");
      verifier((await page.locator(".recharts-bar-rectangle").count()) >= 25, "FR · graphique des jours : barres manquantes");
      verifier(!PLACEHOLDERS.test(b), "FR · bandeau : variable de modèle non remplacée");
      verifier(!/ODP|Excel/i.test(b), "FR · bandeau : mention d'un fichier ODP / Excel");
      if (shotsDir) { fs.mkdirSync(shotsDir, { recursive: true }); await page.screenshot({ path: path.join(shotsDir, "bureau-fr.png") }); }
      const t = norm(await page.evaluate(() => document.body.innerText));
      verifier(t.includes(`${fmtNum(E.cumul)} € HT`), `FR · CA cumulé « ${fmtNum(E.cumul)} € HT » absent`);
      verifier(t.includes(`${fmtNum(E.qte)} unités vendues`), `FR · « ${fmtNum(E.qte)} unités vendues » absent`);
      verifier(t.includes(`${E.pct}%`), `FR · ${E.pct}% de l'objectif absent`);
      if (E.yoy !== null) verifier(t.includes(fmtPct(E.yoy)) && t.includes(`${fmtNum(E.n1)} €`), `FR · comparaison 2025 (${fmtPct(E.yoy)}, ${fmtNum(E.n1)} €) absente`);
      verifier(t.includes(`→ ${dmax}`) && t.includes(`→ ${dmax.replace(/^\d{4}/, "2025")}`), `FR · période affichée ≠ jusqu'au ${dmax}`);
      verifier(erreurs.length === 0, `erreurs JavaScript (bureau) : ${erreurs.slice(0, 3).join(" | ")}`);
      await ctx.close();
    }

    // 2) trois autres langues
    for (const lang of ["en", "es", "zh"]) {
      const { ctx, page, erreurs } = await ouvrir(browser);
      await ouvrirDashboard(page, base, { lang });
      const b = await texteBandeau(page, lang);
      verifier(b.length > 40, `${lang.toUpperCase()} · bandeau introuvable`);
      verifier(contient(b, jour(dmax, lang)) && contient(b, SOURCES[lang]), `${lang.toUpperCase()} · date ou source du bandeau absentes (${b.slice(0, 120)})`);
      verifier(!PLACEHOLDERS.test(b), `${lang.toUpperCase()} · variable de modèle non remplacée`);
      verifier(!/ODP|Excel/i.test(b), `${lang.toUpperCase()} · mention d'un fichier ODP / Excel`);
      verifier(erreurs.length === 0, `erreurs JavaScript (${lang}) : ${erreurs.slice(0, 3).join(" | ")}`);
      await ctx.close();
    }

    // 3) filtres marketplace : le CA affiché suit la marketplace
    for (const [mp, ca] of [["Site Web", E.site], ["Leroy Merlin", E.leroy]]) {
      const { ctx, page, erreurs } = await ouvrir(browser);
      await ouvrirDashboard(page, base, { marketplace: mp });
      const t = norm(await page.evaluate(() => document.body.innerText));
      verifier(t.includes(`${fmtNum(ca)} € HT`), `filtre ${mp} : CA « ${fmtNum(ca)} € HT » absent`);
      verifier(contient(await texteBandeau(page, "fr"), `jusqu'au ${jour(dmax, "fr")}`), `filtre ${mp} : bandeau absent`);
      verifier(erreurs.length === 0, `erreurs JavaScript (filtre ${mp}) : ${erreurs.slice(0, 3).join(" | ")}`);
      await ctx.close();
    }

    // 4) pastille « non actualisé » : extraction vieille de 3 jours (horloge avancée)
    {
      const extraitMs = Date.parse(E.ext.extrait_a);
      const avance = Number.isFinite(extraitMs) ? Math.max(0, extraitMs + 3.2 * 864e5 - Date.now()) : 3 * 864e5;
      const { ctx, page, erreurs } = await ouvrir(browser, { avance });
      await ouvrirDashboard(page, base);
      const b = await texteBandeau(page, "fr");
      verifier(/Non actualisé depuis [34] j/.test(b), `pastille « non actualisé » absente après 3 jours (${b.slice(0, 120)})`);
      verifier(erreurs.length === 0, `erreurs JavaScript (horloge +3 j) : ${erreurs.slice(0, 3).join(" | ")}`);
      await ctx.close();
    }

    // 5) chaque onglet s'ouvre sans erreur
    for (const tab of ["apercu", "marketplaces", "marques", "prix", "ads", "concurrence", "data"]) {
      const { ctx, page, erreurs } = await ouvrir(browser);
      await ouvrirDashboard(page, base, { tab });
      await page.waitForTimeout(700);
      const t = norm(await page.evaluate(() => document.body.innerText));
      verifier(t.length > 600, `onglet ${tab} : contenu vide (${t.length} caractères)`);
      verifier(!/NaN|undefined|Infinity/.test(t), `onglet ${tab} : « NaN / undefined / Infinity » affiché`);
      verifier(erreurs.length === 0, `erreurs JavaScript (onglet ${tab}) : ${erreurs.slice(0, 3).join(" | ")}`);
      if (shotsDir) await page.screenshot({ path: path.join(shotsDir, `onglet-${tab}.png`) });
      await ctx.close();
    }

    // 6) mobile : pas de défilement horizontal de la page
    {
      const { ctx, page, erreurs } = await ouvrir(browser, { largeur: 390, hauteur: 844 });
      await ouvrirDashboard(page, base);
      const defil = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      verifier(defil <= 1, `mobile : débordement horizontal de ${defil}px`);
      verifier(contient(await texteBandeau(page, "fr"), `jusqu'au ${jour(dmax, "fr")}`), "mobile : bandeau absent");
      if (shotsDir) await page.screenshot({ path: path.join(shotsDir, "mobile-fr.png") });
      verifier(erreurs.length === 0, `erreurs JavaScript (mobile) : ${erreurs.slice(0, 3).join(" | ")}`);
      await ctx.close();
    }

    // 7) extraction illisible : écran « Données Shopify indisponibles » à la place du tableau de bord (le build est altéré à la volée)
    {
      const { ctx, page, erreurs } = await ouvrir(browser);
      let altere = false;
      await page.route("**/assets/*.js", async (route) => {
        const rep = await route.fetch();
        let corps = await rep.text();
        for (const [de, vers] of [['schema:2,extrait_le', 'schema:9,extrait_le'], ['\\"schema\\":2,\\"extrait_le', '\\"schema\\":9,\\"extrait_le'], ['"schema":2,"extrait_le"', '"schema":9,"extrait_le"']]) {
          if (corps.includes(de)) { corps = corps.replace(de, vers); altere = true; break; }
        }
        await route.fulfill({ response: rep, body: corps });
      });
      await page.goto(`${base}?lang=fr`, { waitUntil: "load" });
      await page.waitForTimeout(1500);
      if (!altere) console.log("AVIS · écran « Données indisponibles » non testé : marque de schéma introuvable dans le build");
      else {
        const t = norm(await page.evaluate(() => document.body.innerText));
        verifier(contient(t, "Données Shopify indisponibles"), `extraction illisible : écran d'erreur absent (${t.slice(0, 120)})`);
        verifier(!contient(t, "Données Shopify à jour"), "extraction illisible : le tableau de bord s'affiche malgré tout");
        verifier(erreurs.length === 0, `extraction illisible : erreurs JavaScript : ${erreurs.slice(0, 3).join(" | ")}`);
      }
      await ctx.close();
    }
  } finally {
    await browser.close();
    srv.close();
  }
  if (echecs.length) { for (const e of echecs) console.log(`ÉCHEC · ${e}`); return 2; }
  console.log(`SMOKE_OK · bandeau « Données Shopify à jour » jusqu'au ${dmax} (4 langues, pastille de fraîcheur), chiffres = ${fmtNum(E.cumul)} € HT / ${fmtNum(E.qte)} unités / ${E.pct} % de l'objectif${E.yoy !== null ? ` / ${E.yoy.toFixed(1)} % vs 2025` : ""}, filtres marketplace, 7 onglets, mobile, écran d'erreur`);
  return 0;
}

main().then((c) => process.exit(c), (e) => { console.error(e); process.exit(2); });
