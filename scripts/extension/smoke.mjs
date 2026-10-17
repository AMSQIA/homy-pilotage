#!/usr/bin/env node
/**
 * Test d'affichage du tableau de bord prolongé avec les ventes Shopify, sur le build de production (dossier dist/).
 *
 *   npx vite build && node scripts/extension/smoke.mjs [--shots dossier]
 *
 * Lance un petit serveur statique, ouvre l'application dans Chromium (Playwright) et vérifie :
 *   - le bloc « Données à jour » (titre, date de dernière donnée, pastille de fraîcheur, graphique du CA par jour ouvert par défaut
 *     et repliable) en français, anglais, espagnol et chinois, sans variable de modèle restante, et sans les phrases explicatives
 *     retirées le 17 octobre 2026 ;
 *   - les trois vues conservées à la demande de l'utilisateur : liste des produits classés par CA, % de l'objectif par pays,
 *     comparaison « vs 2025 » (courbes et pastilles) ;
 *   - les chiffres affichés = ceux que calcule extension.js sur les vrais fichiers du dépôt (CA cumulé, unités,
 *     % de l'objectif, comparaison avec 2025, filtres Site Web et Leroy Merlin) ;
 *   - la pastille « non actualisé » quand l'extraction a plus de 2 jours ;
 *   - les 7 onglets s'ouvrent sans erreur JavaScript ; affichage mobile sans débordement horizontal, tableaux mensuels défilables.
 *
 * Codes de sortie : 0 ok · 2 échec d'affichage · 77 test impossible (Playwright ou Chromium indisponible : à
 * signaler, ce n'est pas un échec de l'application).
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import { etendre } from "../../extension.js";
import { lireApp, lireJson, RACINE } from "./lib_app.mjs";

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

const norm = (s) => String(s).replace(/[  ]/g, " ").replace(/\s+/g, " ").trim();
const contient = (texte, motif) => norm(texte).toLowerCase().includes(norm(motif).toLowerCase());
const PLACEHOLDERS = /\{(odp|du|au|date|n|dmax|mp|site)\}/;
const fmtNum = (n) => norm(new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(Math.round(n)));
const jour = (iso, lang) => new Date(iso + "T12:00:00").toLocaleDateString(lang === "zh" ? "zh-CN" : lang, { day: "numeric", month: "short" });

/** Chiffres attendus : exactement ce que calcule l'application au chargement, depuis les fichiers du dépôt. */
function attendus() {
  const app = lireApp();
  const C = app.constantes();
  const ext = lireJson("shopify_extension.json");
  const rap = etendre(C, ext, lireJson("data/n1_2025.json"), { dmaxOdp: app.dmaxOdp });
  if (!rap.appliquee) return { rap, app, ext };
  const D = C.DATA;
  const mp = (nom) => D.mp_vs_objectif.find((m) => m.marketplace === nom);
  let ca = { mp: 0, site: 0 };
  for (const [d, im, , , , c] of ext.lignes) if (d > app.dmaxOdp && d <= rap.dmax) ca[ext.mp[im] === "Site Web" ? "site" : "mp"] += c;
  return {
    rap, app, ext, ca,
    cumul: D.kpi.ca_total_2026, qte: D.kpi.qte_total_2026, pct: Math.round(D.kpi.pct_objectif_atteint),
    n1: D.total_yoy_comparable[2025], yoy: ((D.kpi.ca_total_2026 / D.total_yoy_comparable[2025] - 1) * 100).toFixed(1),
    site: mp("Site Web").ca, leroy: mp("Leroy Merlin").ca,
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
  }, avance);
  return { ctx, page, erreurs };
}

const TITRES = { fr: "Données à jour", en: "Data up to date", es: "Datos actualizados", zh: "数据已更新" };

async function ouvrirDashboard(page, base, { lang = "fr", tab = "apercu", marketplace } = {}) {
  const q = new URLSearchParams({ lang, tab });
  if (marketplace) q.set("marketplace", marketplace);
  await page.goto(`${base}?${q}`, { waitUntil: "load" });
  await page.waitForFunction(() => document.body && document.body.innerText.length > 400, null, { timeout: 30000 });
  await page.waitForTimeout(1600); // animations d'entrée (le compteur du CA monte jusqu'à sa valeur finale)
}

// Texte du bloc « Données à jour » : repéré par son attribut data-bandeau (le titre dépend de la langue)
const texteBandeau = (page) => page.evaluate(() => { const el = document.querySelector("[data-bandeau]"); return el ? el.innerText : ""; }).then(norm);
// Sous-informations retirées du tableau de bord : elles ne doivent pas réapparaître (interrupteur SOUS_INFOS de App.jsx)
const RETIRE = ["Actualisé chaque matin", "Tous les chiffres du tableau de bord", "Fichier ODP jusqu'au", "Bricoman ne se distingue", "Restent calculés sur le fichier ODP", "Panier moyen et meilleure vente ne suivent pas",
  "Zone en pointillés =", "% = part de l'objectif annuel du pays", "Pour actualiser : demande-le directement"];

async function main() {
  if (!fs.existsSync(path.join(DIST, "index.html"))) { console.error("dist/ introuvable : lancer « npx vite build » d'abord"); return 2; }
  const E = attendus();
  if (!E.rap.appliquee) { console.log(`Extension non appliquée (${(E.rap.erreurs || []).join(" ; ") || "extraction couverte par l'ODP"}) : rien à vérifier pour le bandeau`); return 0; }
  const pw = chargerPlaywright();
  if (!pw) { console.log("TEST IMPOSSIBLE · Playwright introuvable"); return 77; }
  let browser;
  try { browser = await pw.chromium.launch(); } catch (e) { console.log(`TEST IMPOSSIBLE · Chromium indisponible (${String(e.message).split("\n")[0]})`); return 77; }
  const srv = await serveur();
  const base = `http://127.0.0.1:${srv.address().port}/`;
  const dmax = E.rap.dmax, odp = E.app.dmaxOdp, du = E.rap.du;
  try {
    // 1) français, bureau : bandeau, chiffres du bandeau déplié, KPI
    {
      const { ctx, page, erreurs } = await ouvrir(browser);
      await ouvrirDashboard(page, base);
      const b = await texteBandeau(page);
      verifier(b.length > 15, "bandeau « Données à jour » introuvable");
      verifier(contient(b, TITRES.fr), `FR · bandeau : titre « ${TITRES.fr} » absent (${b.slice(0, 100)})`);
      verifier(contient(b, `jusqu'au ${jour(dmax, "fr")}`), `FR · bandeau : « jusqu'au ${jour(dmax, "fr")} » absent (${b.slice(0, 100)})`);
      verifier(!/Non actualisé/.test(b), "FR · pastille « non actualisé » affichée alors que l'extraction est fraîche");
      // le bloc garde son graphique du CA par jour (ouvert par défaut) ; ses phrases explicatives sont retirées
      verifier(contient(b, "CA HT par jour"), `FR · bloc « Données à jour » : titre du graphique absent (${b.slice(0, 160)})`);
      verifier(contient(b, "Marketplaces") && contient(b, "Site web"), "FR · bloc « Données à jour » : légende (Marketplaces / Site web) absente");
      const barres = await page.locator("[data-bandeau] .recharts-bar-rectangle").count();
      verifier(barres >= 10, `FR · bloc « Données à jour » : ${barres} barre(s) de CA par jour (au moins 10 attendues)`);
      const hauteurPanneau = () => page.evaluate(() => { const el = document.querySelector("[data-bandeau] .fold-panel"); return el ? Math.round(el.getBoundingClientRect().height) : -1; });
      verifier((await hauteurPanneau()) > 100, `FR · bloc « Données à jour » : graphique replié par défaut (hauteur ${await hauteurPanneau()})`);
      verifier(!PLACEHOLDERS.test(b), "FR · bandeau : variable de modèle non remplacée");
      verifier(!/ODP|Excel/i.test(b), "FR · bloc « Données à jour » : mention d'un fichier ODP / Excel");
      if (shotsDir) { fs.mkdirSync(shotsDir, { recursive: true }); await page.screenshot({ path: path.join(shotsDir, "bureau-fr.png") }); }
      const t = norm(await page.evaluate(() => document.body.innerText));
      verifier(t.includes(`${fmtNum(E.cumul)} € HT`), `FR · CA cumulé « ${fmtNum(E.cumul)} € HT » absent`);
      verifier(t.includes(`${fmtNum(E.qte)} unités vendues`), `FR · « ${fmtNum(E.qte)} unités vendues » absent`);
      verifier(t.includes(`${E.pct}%`), `FR · ${E.pct}% de l'objectif absent`);
      verifier(t.includes(`+${E.yoy} %`) && t.includes(`${fmtNum(E.n1)} €`), `FR · comparaison 2025 (+${E.yoy} %, ${fmtNum(E.n1)} €) absente`);
      verifier(t.includes("sur la même période 2025"), "FR · base de comparaison « vs … sur la même période 2025 » absente");
      for (const x of RETIRE) verifier(!contient(t, x), `FR · sous-information retirée réapparue : « ${x} »`);
      await page.locator("[data-bandeau] button").first().click(); await page.waitForTimeout(800);
      verifier((await hauteurPanneau()) < 5, `FR · bloc « Données à jour » : un clic sur l'en-tête ne replie pas le graphique (hauteur ${await hauteurPanneau()})`);
      await page.locator("[data-bandeau] button").first().click(); await page.waitForTimeout(800);
      verifier((await hauteurPanneau()) > 100, `FR · bloc « Données à jour » : un second clic ne rouvre pas le graphique (hauteur ${await hauteurPanneau()})`);
      verifier(erreurs.length === 0, `erreurs JavaScript (bureau) : ${erreurs.slice(0, 3).join(" | ")}`);
      await ctx.close();
    }

    // 2) trois autres langues
    for (const lang of ["en", "es", "zh"]) {
      const { ctx, page, erreurs } = await ouvrir(browser);
      await ouvrirDashboard(page, base, { lang });
      const b = await texteBandeau(page);
      verifier(b.length > 15, `${lang.toUpperCase()} · bandeau introuvable`);
      verifier(contient(b, TITRES[lang]) && contient(b, jour(dmax, lang)), `${lang.toUpperCase()} · titre ou date du bandeau absents (${b.slice(0, 120)})`);
      verifier(!PLACEHOLDERS.test(b), `${lang.toUpperCase()} · variable de modèle non remplacée`);
      verifier(erreurs.length === 0, `erreurs JavaScript (${lang}) : ${erreurs.slice(0, 3).join(" | ")}`);
      await ctx.close();
    }

    // 3) filtres marketplace : le CA affiché suit la marketplace (somme de ses ventes ODP + Shopify)
    for (const [mp, ca] of [["Site Web", E.site], ["Leroy Merlin", E.leroy]]) {
      const { ctx, page, erreurs } = await ouvrir(browser);
      await ouvrirDashboard(page, base, { marketplace: mp });
      const t = norm(await page.evaluate(() => document.body.innerText));
      verifier(t.includes(`${fmtNum(ca)} € HT`), `filtre ${mp} : CA « ${fmtNum(ca)} € HT » absent`);
      verifier(contient(await texteBandeau(page), `jusqu'au ${jour(dmax, "fr")}`), `filtre ${mp} : bandeau absent`);
      verifier(erreurs.length === 0, `erreurs JavaScript (filtre ${mp}) : ${erreurs.slice(0, 3).join(" | ")}`);
      await ctx.close();
    }

    // 4) pastille « non actualisé » : extraction vieille de 3 jours (horloge avancée)
    {
      const extraitMs = Date.parse(E.ext.extrait_a);
      const avance = Number.isFinite(extraitMs) ? Math.max(0, extraitMs + 3.2 * 864e5 - Date.now()) : 3 * 864e5;
      const { ctx, page, erreurs } = await ouvrir(browser, { avance });
      await ouvrirDashboard(page, base);
      const b = await texteBandeau(page);
      verifier(/Non actualisé depuis [34] j/.test(b), `pastille « non actualisé » absente après 3 jours (${b.slice(0, 120)})`);
      verifier(erreurs.length === 0, `erreurs JavaScript (horloge +3 j) : ${erreurs.slice(0, 3).join(" | ")}`);
      await ctx.close();
    }

    // 4 bis) les trois vues conservées à la demande de l'utilisateur (17 octobre 2026)
    {
      const { ctx, page, erreurs } = await ouvrir(browser);
      await ouvrirDashboard(page, base, { tab: "marques" });
      await page.goto(`${base}?${new URLSearchParams({ lang: "fr", tab: "marques", sousTab: "produits" })}`, { waitUntil: "load" });
      await page.waitForFunction(() => document.body && document.body.innerText.length > 400, null, { timeout: 30000 });
      await page.waitForTimeout(700);
      let t = norm(await page.evaluate(() => document.body.innerText));
      verifier(t.includes("Tous les produits"), "produits : liste « Tous les produits » absente");
      const lignes = await page.locator('div[style*="max-height: 520px"] > div').count();
      verifier(lignes >= 10, `produits : ${lignes} ligne(s) dans la liste classée (au moins 10 attendues)`);
      for (const x of RETIRE) verifier(!contient(t, x), `produits : sous-information retirée réapparue : « ${x} »`);
      await page.goto(`${base}?${new URLSearchParams({ lang: "fr", tab: "marketplaces" })}`, { waitUntil: "load" });
      await page.waitForFunction(() => document.body && document.body.innerText.length > 400, null, { timeout: 30000 });
      await page.waitForTimeout(700);
      t = norm(await page.evaluate(() => document.body.innerText));
      verifier(t.includes("Répartition par pays") && /\d+% obj\./.test(t), "marketplaces : répartition par pays avec « % obj. » absente");
      verifier(/[+-]\d+(\.\d)? %/.test(t), "marketplaces : comparaison « vs 2025 » (pastilles %) absente");
      for (const x of RETIRE) verifier(!contient(t, x), `marketplaces : sous-information retirée réapparue : « ${x} »`);
      verifier(erreurs.length === 0, `erreurs JavaScript (vues conservées) : ${erreurs.slice(0, 3).join(" | ")}`);
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
      verifier(contient(await texteBandeau(page), `jusqu'au ${jour(dmax, "fr")}`), "mobile : bandeau absent");
      if (shotsDir) await page.screenshot({ path: path.join(shotsDir, "mobile-fr.png") });
      // le tableau mensuel des prix est plus large que l'écran : il doit défiler dans sa carte (la carte rogne tout ce qui dépasse)
      await ouvrirDashboard(page, base, { tab: "prix" });
      const defile = await page.evaluate(() => { const el = document.querySelector(".overflow-x-auto"); return el ? [getComputedStyle(el).overflowX, el.scrollWidth - el.clientWidth] : null; });
      verifier(defile && defile[0] === "auto" && defile[1] > 0, `mobile : tableau mensuel des prix non défilable (${JSON.stringify(defile)})`);
      verifier(erreurs.length === 0, `erreurs JavaScript (mobile) : ${erreurs.slice(0, 3).join(" | ")}`);
      await ctx.close();
    }
  } finally {
    await browser.close();
    srv.close();
  }
  if (echecs.length) { for (const e of echecs) console.log(`ÉCHEC · ${e}`); return 2; }
  console.log(`SMOKE_OK · bloc « Données à jour » avec son graphique journalier jusqu'au ${dmax} (4 langues, pastille de fraîcheur), sous-informations absentes, vues conservées (produits, % par pays, vs 2025), chiffres = ${fmtNum(E.cumul)} € HT / ${fmtNum(E.qte)} unités / ${E.pct} % de l'objectif / ${E.yoy} % vs 2025, filtres marketplace, 7 onglets, mobile (tableaux défilables) : aucune erreur JavaScript`);
  return 0;
}

main().then((c) => process.exit(c), (e) => { console.error(e); process.exit(2); });
