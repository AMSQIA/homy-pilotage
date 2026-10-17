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
 *   - le suivi quotidien du bloc : puces de période, histogramme du CA par jour avec la courbe « mêmes jours l'an dernier », jour touché,
 *     top 10 produits (variation en % et écart en € par produit, écart en € en tête) et part du CA par pays, filtre marketplace, 4 langues,
 *     jour touché avec choix « même date | même jour de la semaine », mobile (390 et 360 px : onglets « Top 10 | % par pays », un seul volet à la fois) ;
 *     les chiffres attendus sont recalculés
 *     dans le test, directement depuis les fichiers du dépôt, indépendamment du code de l'application ;
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
const PLACEHOLDERS = /\{(odp|du|au|date|n|dmax|mp|site|an|plage)\}/;
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
  // machine chargée (tests lancés en parallèle) : le compteur peut finir en retard ; on attend deux relevés identiques du texte de la page, à 400 ms d'écart
  await page.waitForFunction(() => { const t = document.body.innerText, avant = window.__homyTexte; window.__homyTexte = t; return avant === t; }, null, { polling: 400, timeout: 10000 }).catch(() => { /* texte gardé tel quel */ });
}

// Texte du bloc « Données à jour » : repéré par son attribut data-bandeau (le titre dépend de la langue)
const texteBandeau = (page) => page.evaluate(() => { const el = document.querySelector("[data-bandeau]"); return el ? el.innerText : ""; }).then(norm);
// Sous-informations retirées du tableau de bord : elles ne doivent pas réapparaître (interrupteur SOUS_INFOS de App.jsx)
const RETIRE = ["Actualisé chaque matin", "Tous les chiffres du tableau de bord", "Fichier ODP jusqu'au", "Bricoman ne se distingue", "Restent calculés sur le fichier ODP", "Panier moyen et meilleure vente ne suivent pas",
  "Zone en pointillés =", "% = part de l'objectif annuel du pays", "Pour actualiser : demande-le directement"];

// ---- Suivi quotidien (premier bloc) : chiffres attendus recalculés ICI, directement depuis les fichiers du dépôt, sans passer par le code de l'application ----
const addJ = (iso, n) => new Date(Date.parse(iso + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);
const jourAn = (iso) => { const [y, m, d] = iso.split("-").map(Number); const t = new Date(Date.UTC(y - 1, m - 1, d)); return (t.getUTCMonth() !== m - 1 ? new Date(Date.UTC(y - 1, m, 0)) : t).toISOString().slice(0, 10); };
const pctApp = (n) => `${n > 0 ? "+" : ""}${n.toFixed(1)} %`; // même format que fmtPct de l'application
const kApp = (n) => (n >= 1000 ? `${(n / 1000).toFixed(0)}k€` : `${Math.round(n)}€`);
const trier = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]);
const proche = (a, b, tol = 1) => Math.abs(a - b) <= tol;
// variation affichée (SuiviDelta) : « +7.6 % », dès 100 % sans décimale (« +128 % »), « ×12 » à partir de +500 %
const varApp = (p) => (p >= 500 ? `×${Math.round(p / 100 + 1)}` : Math.abs(p) >= 99.95 ? `${p > 0 ? "+" : ""}${Math.round(p)} %` : pctApp(p));
// écart en € posé à côté du % (suiviEcart) : « +19k€ » dès 10 000 €, « +4.2k€ » de 1 000 à 9 999 €, « +840€ » en dessous
const ecartApp = (n) => { const r = Math.round(Math.abs(n)); if (r === 0) return "0€"; const sg = n > 0 ? "+" : "-", k = r / 1000; return r < 1000 ? `${sg}${r}€` : `${sg}${k >= 9.95 ? Math.round(k) : k.toFixed(1)}k€`; };

// Production : ventes Shopify après la dernière ligne ODP (schéma 1) et fichier 2025 data/n1_2025.json. Le « Site Web » 2025 de l'ODP est
// très incomplet : l'an dernier ne se compare que sur les marketplaces (mode « mp »), ou « aucun » pour le site seul / une marketplace absente de 2025.
function suiviAttendu(E, n, jourSel, mpF, semaine = false) {
  const ext = E.ext, odp = E.app.dmaxOdp, dmax = E.rap.dmax;
  const au = jourSel || dmax, du = jourSel || addJ(dmax, 1 - n);
  const N1 = lireJson("data/n1_2025.json");
  const garde = (mp) => !mpF || mp === mpF;
  const r = { mp: 0, site: 0, prod: {}, prodMp: {}, prodN1: {}, prodN1Mp: {}, pays: {}, n1: { mp: 0, site: 0, all: null }, avecMp: mpF !== "Site Web", avecSite: !mpF || mpF === "Site Web", nbJours: jourSel ? 1 : n };
  const cumul = (o, nom, c) => { o[nom] = (o[nom] || 0) + c; };
  for (const [d, im, ip, ipa, , c] of ext.lignes) {
    if (d <= odp || d < du || d > au || !garde(ext.mp[im])) continue;
    const site = ext.mp[im] === "Site Web", nom = ext.produits[ip][0];
    if (site) r.site += c; else { r.mp += c; cumul(r.prodMp, nom, c); }
    cumul(r.prod, nom, c);
    const pa = ext.pays[ipa] ?? null; r.pays[pa] = (r.pays[pa] || 0) + c;
  }
  const a = semaine ? addJ(du, -364) : jourAn(du), b = semaine ? addJ(au, -364) : jourAn(au); // semaine : même jour de la semaine l'an dernier
  for (const [d, im, ip, , , c] of N1.lignes) if (d >= a && d <= b && N1.mp[im] !== "Site Web" && garde(N1.mp[im])) { r.n1.mp += c; cumul(r.prodN1, N1.produits[ip], c); cumul(r.prodN1Mp, N1.produits[ip], c); }
  const connu = !mpF || mpF === "Site Web" || N1.mp.includes(mpF);
  r.mode = mpF === "Site Web" || !connu || a < N1.du ? "aucun" : mpF ? "total" : "mp";
  if (r.mode === "total") r.n1.all = r.n1.mp;
  if (r.mode === "aucun") r.n1.mp = 0;
  r.total = r.mp + r.site;
  return r;
}


const lireSuivi = (page) => page.evaluate(() => {
  const q = (s) => document.querySelector(s), txt = (el) => (el ? el.innerText : "");
  return {
    bloc: txt(q('[data-suivi="bloc"]')), total: txt(q('[data-suivi="total"]')), valeur: Number((q('[data-suivi="total"]') || { dataset: {} }).dataset.valeur),
    legende: txt(q('[data-suivi="legende"]')), kpi: txt(q('[data-suivi="kpi"]')),
    puces: [...document.querySelectorAll('[data-suivi="puces"] button')].map((b) => ({ n: Number(b.dataset.n), actif: b.getAttribute("aria-pressed") === "true" })),
    produits: [...document.querySelectorAll('[data-suivi-ligne="produit"]')].map((r) => ({ nom: r.dataset.nom, ca: Number(r.dataset.ca), texte: r.innerText })),
    pays: [...document.querySelectorAll('[data-suivi-ligne="pays"]')].map((r) => ({ nom: r.dataset.nom, part: Number(r.dataset.part), ca: Number(r.dataset.ca) })),
    reset: Boolean(q('[data-suivi="reset"]')), vs: Boolean(q('[data-suivi="vs"]')), deltaMp: Boolean(q('[data-suivi="delta-mp"]')), ecart: Boolean(q('[data-suivi="ecart"]')), vsTexte: txt(q('[data-suivi="vs"]')),
    ligneN1: document.querySelectorAll('[data-suivi="graphique"] .recharts-line-curve').length,
    barres: document.querySelectorAll('[data-suivi="graphique"] .recharts-bar-rectangle').length,
  };
});
// clic au milieu de la i-ème colonne de l'histogramme (l'abscisse suffit : le graphique retrouve le jour le plus proche)
async function cliquerJour(page, i) {
  const pos = await page.evaluate((k) => {
    const r = document.querySelectorAll('[data-suivi="graphique"] .recharts-bar-rectangle')[k];
    const grille = document.querySelector('[data-suivi="graphique"] .recharts-cartesian-grid');
    if (!r || !grille) return null;
    const a = r.getBoundingClientRect(), g = grille.getBoundingClientRect();
    return { x: a.left + a.width / 2, y: g.top + g.height / 2 };
  }, i);
  if (!pos) return false;
  await page.mouse.click(pos.x, pos.y); await page.waitForTimeout(500);
  return true;
}
// volets visibles (onglets mobile, top 10, pays, note « Δ marketplaces ») et onglet actif
const voletsVisibles = (page) => page.evaluate(() => {
  const vis = (e) => { if (!e) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const actif = document.querySelector('[data-suivi="onglets"] [aria-selected="true"]');
  return {
    onglets: vis(document.querySelector('[data-suivi="onglets"]')), top: vis(document.querySelector('[data-suivi="top10"]')), pays: vis(document.querySelector('[data-suivi="pays"]')),
    deltaMp: [...document.querySelectorAll('[data-suivi="delta-mp"]')].some(vis), actif: actif ? actif.dataset.onglet : null,
  };
});
const decrireVolets = (e) => `onglets ${e.onglets ? "visibles" : "masqués"}, top 10 ${e.top ? "visible" : "masqué"}, pays ${e.pays ? "visibles" : "masqués"}, note Δ marketplaces ${e.deltaMp ? "visible" : "masquée"}, onglet actif « ${e.actif} »`;
// vérifie ce qui est affiché (en tête, légende, courbe de l'an dernier, top 10, pays) contre le calcul indépendant
function comparerSuivi(s, A, etiquette, jour = false) {
  const ok = (c, m) => verifier(c, `${etiquette} : ${m}`);
  const fm = (v) => (jour ? `${fmtNum(v)} €` : kApp(v)); // la légende donne les montants entiers pour un jour touché, en k€ pour une période
  ok(proche(s.valeur, A.total, 1.5) && contient(s.total, fmtNum(s.valeur) + " €"), `CA HT affiché « ${s.total} » (valeur ${s.valeur}) ≠ attendu ${fmtNum(A.total)} € (à 1 € d'arrondi près)`);
  if (A.avecMp) ok(contient(s.legende, fm(A.mp)), `légende : ${fm(A.mp)} attendu (${s.legende})`);
  if (A.avecSite) ok(contient(s.legende, fm(A.site)), `légende : ${fm(A.site)} attendu (${s.legende})`);
  ok(s.ligneN1 === (A.mode === "aucun" ? 0 : 1), `courbe de l'an dernier : ${s.ligneN1} tracé(s), ${A.mode === "aucun" ? 0 : 1} attendu (mode ${A.mode})`);
  const vsAttendu = A.mode === "total" || (jour && A.mode === "mp");
  ok(s.vs === vsAttendu, `mention « vs <dates de l'an dernier> » ${s.vs ? "affichée" : "absente"} en mode ${A.mode}${jour ? " (jour touché)" : ""}`);
  const enTete = A.mode === "total" && A.n1.all > 0;
  if (enTete) {
    const v = varApp((A.total / A.n1.all - 1) * 100), e = ecartApp(A.total - A.n1.all);
    ok(contient(s.kpi, v), `variation du total ${v} absente (${s.kpi})`);
    ok(contient(s.kpi, e), `écart du total ${e} absent (${s.kpi})`);
  }
  ok(s.ecart === enTete, `écart en € en tête ${s.ecart ? "affiché" : "absent"} (mode ${A.mode}, base ${A.n1.all})`);
  if (A.avecMp && A.avecSite && A.n1.mp > 0) ok(contient(s.legende, varApp((A.mp / A.n1.mp - 1) * 100)), `variation des marketplaces ${varApp((A.mp / A.n1.mp - 1) * 100)} absente (${s.legende})`);
  if (A.avecMp && A.avecSite && A.mode === "total" && A.n1.site > 0) ok(contient(s.legende, varApp((A.site / A.n1.site - 1) * 100)), `variation du site ${varApp((A.site / A.n1.site - 1) * 100)} absente (${s.legende})`);
  // top 10 : mêmes produits, mêmes montants, ordre décroissant
  const top = trier(A.prod).slice(0, 10);
  ok(s.produits.length === top.length, `top 10 : ${s.produits.length} ligne(s), ${top.length} attendue(s)`);
  // variation par produit, en % et en € (même base : marketplaces seules quand seules elles sont comparables) : sur 7 jours ou plus et quand l'an dernier existe
  const montrer = A.mode !== "aucun" && A.nbJours >= 7, mpSeules = A.mode === "mp";
  top.forEach(([nom, ca], i) => {
    const l = s.produits[i];
    ok(l && l.nom === nom && proche(l.ca, ca, 1.5), `top 10, rang ${i + 1} : « ${l && l.nom} » ${l && l.ca} € ≠ « ${nom} » ${Math.round(ca)} €`);
    if (!l) return;
    const cur = (mpSeules ? A.prodMp[nom] : A.prod[nom]) || 0, ref = (mpSeules ? A.prodN1Mp[nom] : A.prodN1[nom]) || 0, txt = norm(l.texte);
    if (!montrer || (cur === 0 && ref === 0)) { ok(!/[▲▼▬]|nouveau|[+-]\d[\d.]*k?€/i.test(txt), `top 10, « ${nom} » : variation affichée alors qu'il n'y a rien à comparer (${txt})`); return; }
    ok(contient(txt, ecartApp(cur - ref)), `top 10, « ${nom} » : écart ${ecartApp(cur - ref)} absent (${txt})`);
    if (ref > 0) ok(contient(txt, varApp((cur / ref - 1) * 100)), `top 10, « ${nom} » : variation ${varApp((cur / ref - 1) * 100)} absente (${txt})`);
    else ok(contient(txt, "nouveau"), `top 10, « ${nom} » : pastille « nouveau » absente (${txt})`);
  });
  // pays : la part de chaque pays = son CA ÷ le CA de la fenêtre (6 pays puis « Autres »)
  const ts = trier(A.pays), sommePays = ts.reduce((a, [, v]) => a + v, 0);
  ok(s.pays.length === Math.min(ts.length, 7), `pays : ${s.pays.length} ligne(s), ${Math.min(ts.length, 7)} attendue(s)`);
  ts.slice(0, 6).forEach(([nom, ca], i) => {
    const l = s.pays[i];
    ok(l && l.nom === nom && proche(l.part, (ca / sommePays) * 100, 0.02), `pays, rang ${i + 1} : « ${l && l.nom} » ${l && l.part} % ≠ « ${nom} » ${((ca / sommePays) * 100).toFixed(2)} %`);
  });
  ok(proche(s.pays.reduce((a, l) => a + l.part, 0), 100, 0.15), `pays : les parts font ${s.pays.reduce((a, l) => a + l.part, 0).toFixed(2)} % (100 attendus)`);
}

async function verifierSuivi(browser, base, E) {
  // a) bureau, français : période par défaut, puis autre période, puis un jour touché, puis retour
  {
    const { ctx, page, erreurs } = await ouvrir(browser);
    await ouvrirDashboard(page, base);
    let s = await lireSuivi(page);
    verifier(s.puces.length >= 1 && s.puces.filter((p) => p.actif).length === 1, `suivi : ${s.puces.length} puce(s) de période dont ${s.puces.filter((p) => p.actif).length} active(s) (une seule attendue)`);
    const n = (s.puces.find((p) => p.actif) || { n: 7 }).n;
    verifier(s.barres >= Math.min(n, 7), `suivi : ${s.barres} barre(s) dans l'histogramme pour ${n} jour(s)`);
    for (const m of ["Top 10 produits", "Part du CA par pays", "Touchez un jour"]) verifier(contient(s.bloc, m), `suivi : « ${m} » absent`);
    verifier(!/\{(n|an|plage|date)\}/.test(s.bloc), "suivi : variable de modèle non remplacée");
    comparerSuivi(s, suiviAttendu(E, n), `suivi ${n} j`);
    {
      const A0 = suiviAttendu(E, n), v0 = await voletsVisibles(page);
      verifier(!v0.onglets && v0.top && v0.pays, `suivi bureau : onglets masqués et deux volets visibles attendus (${decrireVolets(v0)})`);
      verifier(v0.deltaMp === (A0.mode === "mp" && A0.nbJours >= 7), `suivi bureau : note « Δ marketplaces » ${v0.deltaMp ? "affichée" : "absente"} en mode ${A0.mode}`);
    }
    const autre = s.puces.find((p) => p.n !== n);
    if (autre) {
      await page.locator(`[data-suivi="puces"] button[data-n="${autre.n}"]`).click(); await page.waitForTimeout(500);
      s = await lireSuivi(page);
      verifier(s.puces.find((p) => p.n === autre.n).actif, `suivi : la puce ${autre.n} j ne devient pas active`);
      comparerSuivi(s, suiviAttendu(E, autre.n), `suivi ${autre.n} j`);
      await page.locator(`[data-suivi="puces"] button[data-n="${n}"]`).click(); await page.waitForTimeout(400);
    }
    // toucher la 4e barre de la période = le jour du + 3
    const du = addJ(E.rap.dmax, 1 - n), jourTouche = addJ(du, Math.min(3, n - 1));
    if (verifier(await cliquerJour(page, Math.min(3, n - 1)), "suivi : barre introuvable")) {
      s = await lireSuivi(page);
      verifier(s.reset, "suivi : le bouton « Période entière » n'apparaît pas quand un jour est touché");
      comparerSuivi(s, suiviAttendu(E, n, jourTouche), `suivi jour ${jourTouche}`, true);
      // jour touché : choix « même date » (défaut) / « même jour de la semaine » ; le jour de la semaine comparé est indiqué dans « vs … »
      const A1 = suiviAttendu(E, n, jourTouche), vsJour = (iso) => new Date(iso + "T12:00:00").toLocaleDateString("fr", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
      const boutons = () => page.evaluate(() => [...document.querySelectorAll('[data-suivi="alignement"] button')].map((b) => ({ k: b.dataset.align, actif: b.getAttribute("aria-pressed") === "true" })));
      let bt = await boutons();
      verifier(bt.length === 2 && bt.find((b) => b.k === "date")?.actif && !bt.find((b) => b.k === "semaine")?.actif, `suivi jour : choix « même date / même jour de la semaine » absent ou mal initialisé (${JSON.stringify(bt)})`);
      if (s.vs) verifier(contient(s.vsTexte, vsJour(jourAn(jourTouche))), `suivi jour : « vs » devrait indiquer ${vsJour(jourAn(jourTouche))} (${norm(s.vsTexte)})`);
      await page.locator('[data-suivi="alignement"] [data-align="semaine"]').click(); await page.waitForTimeout(400);
      s = await lireSuivi(page);
      comparerSuivi(s, suiviAttendu(E, n, jourTouche, undefined, true), `suivi jour ${jourTouche} (même jour de la semaine)`, true);
      bt = await boutons();
      verifier(bt.find((b) => b.k === "semaine")?.actif && !bt.find((b) => b.k === "date")?.actif, `suivi jour : « même jour de la semaine » ne devient pas actif (${JSON.stringify(bt)})`);
      verifier(new Date(addJ(jourTouche, -364) + "T12:00:00").getDay() === new Date(jourTouche + "T12:00:00").getDay(), "suivi jour : le jour comparé n'a pas le même jour de la semaine");
      if (s.vs) verifier(contient(s.vsTexte, vsJour(addJ(jourTouche, -364))), `suivi jour : « vs » devrait indiquer ${vsJour(addJ(jourTouche, -364))} (${norm(s.vsTexte)})`);
      await page.locator('[data-suivi="alignement"] [data-align="date"]').click(); await page.waitForTimeout(400);
      s = await lireSuivi(page);
      comparerSuivi(s, A1, `suivi jour ${jourTouche} (retour aux mêmes dates)`, true);
      await page.locator('[data-suivi="reset"]').click(); await page.waitForTimeout(400);
      s = await lireSuivi(page);
      verifier(!s.reset, "suivi : « Période entière » reste affiché après le retour");
      verifier((await boutons()).length === 0, "suivi : le choix « même date / même jour de la semaine » reste affiché sans jour touché");
      comparerSuivi(s, suiviAttendu(E, n), `suivi ${n} j (après retour)`);
    }
    verifier(erreurs.length === 0, `erreurs JavaScript (suivi) : ${erreurs.slice(0, 3).join(" | ")}`);
    await ctx.close();
  }
  // a bis) le choix « même jour de la semaine » est mémorisé : après rechargement et nouveau jour touché, il est encore actif
  {
    const { ctx, page, erreurs } = await ouvrir(browser);
    await ouvrirDashboard(page, base);
    if (verifier(await cliquerJour(page, 2), "suivi : barre introuvable (mémorisation du choix)")) {
      await page.locator('[data-suivi="alignement"] [data-align="semaine"]').click(); await page.waitForTimeout(300);
      await ouvrirDashboard(page, base);
      if (verifier(await cliquerJour(page, 2), "suivi : barre introuvable après rechargement")) {
        const actif = await page.evaluate(() => (document.querySelector('[data-suivi="alignement"] [aria-pressed="true"]') || { dataset: {} }).dataset.align);
        verifier(actif === "semaine", `suivi : le choix « même jour de la semaine » n'est pas retrouvé après rechargement (actif : ${actif})`);
      }
    }
    verifier(erreurs.length === 0, `erreurs JavaScript (suivi, mémorisation du choix) : ${erreurs.slice(0, 3).join(" | ")}`);
    await ctx.close();
  }
  // b) filtre marketplace global : le suivi suit la marketplace (ou le site web)
  for (const mp of ["Leroy Merlin", "Site Web"]) {
    const { ctx, page, erreurs } = await ouvrir(browser);
    await ouvrirDashboard(page, base, { marketplace: mp });
    const s = await lireSuivi(page);
    const n = (s.puces.find((p) => p.actif) || { n: 7 }).n;
    verifier(contient(s.kpi, mp === "Site Web" ? "Site web" : mp), `suivi, filtre ${mp} : nom de la marketplace absent de l'en-tête (${s.kpi})`);
    comparerSuivi(s, suiviAttendu(E, n, null, mp), `suivi filtre ${mp}`);
    verifier(erreurs.length === 0, `erreurs JavaScript (suivi, filtre ${mp}) : ${erreurs.slice(0, 3).join(" | ")}`);
    await ctx.close();
  }
  // c) autres langues : titres traduits, aucune variable de modèle
  for (const [lang, titres] of [["en", ["Top 10 products", "Revenue share by country"]], ["es", ["Top 10 productos", "Cuota de ventas por país"]], ["zh", ["产品前 10 名", "各国销售占比"]]]) {
    const { ctx, page, erreurs } = await ouvrir(browser);
    await ouvrirDashboard(page, base, { lang });
    const s = await lireSuivi(page);
    for (const m of titres) verifier(contient(s.bloc, m), `suivi ${lang.toUpperCase()} : « ${m} » absent`);
    verifier(!/\{(n|an|plage|date)\}/.test(s.bloc), `suivi ${lang.toUpperCase()} : variable de modèle non remplacée`);
    verifier(erreurs.length === 0, `erreurs JavaScript (suivi ${lang}) : ${erreurs.slice(0, 3).join(" | ")}`);
    await ctx.close();
  }
  // d) mobile : onglets « Top 10 | % par pays » (un seul volet à la fois, le choix est mémorisé) ; rien ne dépasse de la carte
  //    (ni les montants, ni les variations en % et en €, ni les noms)
  const depassements = (page) => page.evaluate(() => {
    const b = document.querySelector('[data-suivi="bloc"]'); if (!b) return ["bloc absent"];
    const r = b.getBoundingClientRect(), mauvais = [];
    for (const el of b.querySelectorAll("*")) {
      if (el.closest(".recharts-wrapper")) continue;
      const e = el.getBoundingClientRect();
      if (e.width > 0 && (e.right > r.right + 1.5 || e.left < r.left - 1.5)) mauvais.push(`${el.tagName.toLowerCase()} « ${(el.innerText || "").slice(0, 24)} » dépasse de ${Math.round(Math.max(e.right - r.right, r.left - e.left))}px`);
    }
    return mauvais.slice(0, 4);
  });
  for (const largeur of [390, 360]) {
    const { ctx, page, erreurs } = await ouvrir(browser, { largeur, hauteur: 844 });
    await ouvrirDashboard(page, base);
    const s0 = await lireSuivi(page);
    const n = (s0.puces.find((p) => p.actif) || { n: 7 }).n, A = suiviAttendu(E, n), et = `suivi mobile ${largeur}px`;
    let e = await voletsVisibles(page);
    verifier(e.onglets && e.top && !e.pays && e.actif === "top", `${et} : au départ, onglets visibles et top 10 seul attendus (${decrireVolets(e)})`);
    verifier(e.deltaMp === (A.mode === "mp" && A.nbJours >= 7), `${et} : note « Δ marketplaces » ${e.deltaMp ? "affichée" : "absente"} en mode ${A.mode}`);
    verifier(s0.produits.length === Math.min(10, Object.keys(A.prod).length), `${et} : ${s0.produits.length} ligne(s) de top 10 (10 attendues, les 10 produits restent tous affichés)`);
    let trop = await depassements(page);
    verifier(trop.length === 0, `${et}, top 10 : contenu qui dépasse (${trop.join(" ; ")})`);
    if (verifier(await cliquerJour(page, 3), `${et} : barre introuvable`)) { // jour touché : le choix « même date / même jour de la semaine » ne doit rien faire dépasser
      trop = await depassements(page);
      verifier(trop.length === 0, `${et}, jour touché : contenu qui dépasse (${trop.join(" ; ")})`);
      await page.locator('[data-suivi="reset"]').click(); await page.waitForTimeout(300);
    }
    await page.locator('[data-suivi="onglets"] [data-onglet="pays"]').click(); await page.waitForTimeout(400);
    e = await voletsVisibles(page);
    verifier(e.onglets && !e.top && e.pays && e.actif === "pays" && !e.deltaMp, `${et} : après « % par pays », les pays seuls sont attendus (${decrireVolets(e)})`);
    const sp = await lireSuivi(page), ts = trier(A.pays), somme = ts.reduce((a, [, v]) => a + v, 0);
    verifier(sp.pays.length === Math.min(ts.length, 7) && ts.slice(0, 6).every(([nom, ca], k) => sp.pays[k] && sp.pays[k].nom === nom && proche(sp.pays[k].part, (ca / somme) * 100, 0.02)), `${et} : parts de pays affichées ≠ calcul indépendant`);
    trop = await depassements(page);
    verifier(trop.length === 0, `${et}, pays : contenu qui dépasse (${trop.join(" ; ")})`);
    await ouvrirDashboard(page, base); // le volet choisi est mémorisé dans le navigateur
    e = await voletsVisibles(page);
    verifier(e.actif === "pays" && !e.top && e.pays, `${et} : le volet « pays » n'est pas retrouvé après rechargement (${decrireVolets(e)})`);
    await page.locator('[data-suivi="onglets"] [data-onglet="top"]').click(); await page.waitForTimeout(400);
    e = await voletsVisibles(page);
    verifier(e.actif === "top" && e.top && !e.pays, `${et} : retour sur « Top 10 » (${decrireVolets(e)})`);
    verifier(erreurs.length === 0, `erreurs JavaScript (suivi mobile ${largeur}) : ${erreurs.slice(0, 3).join(" | ")}`);
    await ctx.close();
  }
  // libellés des onglets dans les autres langues, sans débordement sur le plus petit écran
  for (const [lang, onglets] of [["en", ["Top 10", "% by country"]], ["es", ["Top 10", "% por país"]], ["zh", ["前 10 名", "国家占比"]]]) {
    const { ctx, page, erreurs } = await ouvrir(browser, { largeur: 360, hauteur: 844 });
    await ouvrirDashboard(page, base, { lang });
    const txt = await page.evaluate(() => { const el = document.querySelector('[data-suivi="onglets"]'); return el ? el.innerText : ""; });
    for (const m of onglets) verifier(contient(txt, m), `suivi mobile ${lang.toUpperCase()} : onglet « ${m} » absent (${norm(txt)})`);
    let trop = await depassements(page);
    verifier(trop.length === 0, `suivi mobile 360px ${lang.toUpperCase()} : contenu qui dépasse (${trop.join(" ; ")})`);
    if (await cliquerJour(page, 3)) { // libellés du choix de comparaison dans chaque langue, jour touché
      const al = await page.evaluate(() => { const el = document.querySelector('[data-suivi="alignement"]'); return el ? el.innerText : ""; });
      verifier(al.trim().length > 4 && !/\{|undefined/.test(al), `suivi mobile ${lang.toUpperCase()} : libellés du choix de comparaison absents (${norm(al)})`);
      trop = await depassements(page);
      verifier(trop.length === 0, `suivi mobile 360px ${lang.toUpperCase()}, jour touché : contenu qui dépasse (${trop.join(" ; ")})`);
    }
    verifier(erreurs.length === 0, `erreurs JavaScript (suivi mobile ${lang}) : ${erreurs.slice(0, 3).join(" | ")}`);
    await ctx.close();
  }
}

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
      verifier(contient(b, "CA HT"), `FR · bloc « Données à jour » : en-tête « CA HT » absent (${b.slice(0, 160)})`);
      verifier(contient(b, "Marketplaces") && contient(b, "Site web"), "FR · bloc « Données à jour » : légende (Marketplaces / Site web) absente");
      const barres = await page.locator("[data-bandeau] .recharts-bar-rectangle").count();
      verifier(barres >= 10, `FR · bloc « Données à jour » : ${barres} barre(s) de CA par jour (au moins 10 attendues)`);
      const hauteurPanneau = () => page.evaluate(() => { const el = document.querySelector("[data-bandeau] .fold-panel"); return el ? Math.round(el.getBoundingClientRect().height) : -1; });
      const attendreHauteur = async (bon) => { for (let i = 0; i < 50 && !bon(await hauteurPanneau()); i++) await page.waitForTimeout(100); }; // l'animation de repli dure 0,5 s ; elle finit plus tard sur une machine chargée
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
      await page.locator("[data-bandeau] button").first().click(); await attendreHauteur((h) => h < 5);
      verifier((await hauteurPanneau()) < 5, `FR · bloc « Données à jour » : un clic sur l'en-tête ne replie pas le graphique (hauteur ${await hauteurPanneau()})`);
      await page.locator("[data-bandeau] button").first().click(); await attendreHauteur((h) => h > 100);
      verifier((await hauteurPanneau()) > 100, `FR · bloc « Données à jour » : un second clic ne rouvre pas le graphique (hauteur ${await hauteurPanneau()})`);
      verifier(erreurs.length === 0, `erreurs JavaScript (bureau) : ${erreurs.slice(0, 3).join(" | ")}`);
      await ctx.close();
    }

    // 1 bis) suivi quotidien : période, jour touché, an dernier, top 10, pays (chiffres recalculés dans le test depuis les fichiers du dépôt)
    await verifierSuivi(browser, base, E);

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
  console.log(`SMOKE_OK · bloc « Données à jour » jusqu'au ${dmax} avec son suivi quotidien (période, jour touché avec choix même date / même jour de la semaine, même période l'an dernier, top 10 produits avec variation et écart en €, part du CA par pays, 4 langues, mobile avec onglets) et sa pastille de fraîcheur, sous-informations absentes, vues conservées (produits, % par pays, vs 2025), chiffres = ${fmtNum(E.cumul)} € HT / ${fmtNum(E.qte)} unités / ${E.pct} % de l'objectif / ${E.yoy} % vs 2025, filtres marketplace, 7 onglets, mobile (tableaux défilables) : aucune erreur JavaScript`);
  return 0;
}

main().then((c) => process.exit(c), (e) => { console.error(e); process.exit(2); });
