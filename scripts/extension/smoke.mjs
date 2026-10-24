#!/usr/bin/env node
/**
 * Test d'affichage du tableau de bord construit sur les ventes Shopify, sur le build de production (dossier dist/).
 *
 *   npx vite build && node scripts/extension/smoke.mjs [--shots dossier] [--racine dossier]
 *
 * Lance un petit serveur statique, ouvre l'application dans Chromium (Playwright) et vérifie :
 *   - le bloc « Données Shopify à jour » (titre, date de dernière donnée, pastille de fraîcheur, graphique du CA par jour ouvert par
 *     défaut et repliable) en français, anglais, espagnol et chinois, sans variable de modèle restante, et sans les phrases
 *     explicatives retirées le 17 octobre 2026 ;
 *   - le suivi quotidien du bloc : puces de période, histogramme du CA par jour avec la courbe « mêmes jours l'an dernier », jour touché,
 *     commandes et panier moyen, top 10 produits (variation en % et écart en € par produit, écart en € en tête) et part du CA par pays, filtre marketplace, 4 langues,
 *     jour touché avec choix « même date | même jour de la semaine », top 10 des marketplaces (classement, parts, unités, variation et écart en € par canal
 *     comparable ; absent avec un filtre marketplace), mobile (390 et 360 px : onglets « Produits | Marketplaces | % par pays », un seul volet à la fois),
 *     bureau (trois volets côte à côte dès 1280 px) ;
 *     les chiffres attendus sont recalculés
 *     dans le test, directement depuis les fichiers du dépôt, indépendamment du code de l'application ;
 *   - le plan 2026 du suivi quotidien : objectif du jour = plan de la semaine Excel ÷ 7 × poids habituel du jour de la semaine (profil des jours recalculé dans le test, repli sur
 *     l'ensemble des canaux quand une marketplace a moins de 8 semaines entières, rien sans objectif fiable), total de chaque semaine entière inchangé, ligne « Objectif · % du plan · écart »
 *     (période ou jour touché), couleurs, bulle du graphique, légende et libellés dans les 4 langues ; courbe d'objectif mensuel de la tendance (tracée en dernier, points pleins,
 *     bulle au-dessus de juillet et de novembre, libellés traduits, absente sans objectif fiable) ;
 *   - les trois vues conservées à la demande de l'utilisateur : liste des produits classés par CA, % de l'objectif par pays,
 *     comparaison « vs 2025 » (courbes et pastilles) ;
 *   - les chiffres affichés = ceux que calcule socle.js sur les vrais fichiers du dépôt (CA cumulé, unités, % de l'objectif,
 *     comparaison avec 2025, filtres Site Web et Leroy Merlin) ;
 *   - la pastille « non actualisé » quand l'extraction a plus de 2 jours ;
 *   - l'écran « Données Shopify indisponibles » quand l'extraction est illisible (le build est altéré à la volée) ;
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
const PLACEHOLDERS = /\{(odp|du|au|date|n|dmax|mp|site|an|plage)\}/;
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
  const n1 = D.total_yoy_comparable[2025];
  return {
    rap, ext,
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

async function ouvrirDashboard(page, base, { lang = "fr", tab = "apercu", marketplace } = {}) {
  const q = new URLSearchParams({ lang, tab });
  if (marketplace) q.set("marketplace", marketplace);
  await page.goto(`${base}?${q}`, { waitUntil: "load" });
  await page.waitForFunction(() => document.body && document.body.innerText.length > 400, null, { timeout: 30000 });
  await page.waitForTimeout(1600); // animations d'entrée (le compteur du CA monte jusqu'à sa valeur finale)
  // machine chargée (tests lancés en parallèle) : le compteur peut finir en retard ; on attend deux relevés identiques du texte de la page, à 400 ms d'écart
  await page.waitForFunction(() => { const t = document.body.innerText, avant = window.__homyTexte; window.__homyTexte = t; return avant === t; }, null, { polling: 400, timeout: 10000 }).catch(() => { /* texte gardé tel quel */ });
}

// Texte du bloc « Données Shopify à jour » : repéré par son attribut data-bandeau (le titre dépend de la langue)
const texteBandeau = (page) => page.evaluate(() => { const el = document.querySelector("[data-bandeau]"); return el ? el.innerText : ""; }).then(norm);
// Sous-informations retirées du tableau de bord : elles ne doivent pas réapparaître (interrupteur SOUS_INFOS de App.jsx)
const RETIRE = ["Actualisé chaque matin", "Tous les chiffres du tableau de bord", "Source unique : Shopify", "Bricoman ne se distingue", "Ne viennent pas de Shopify", "Panier moyen et meilleure vente ne suivent pas",
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

// Shopify seul (schéma 2) : l'an dernier est lu dans le même historique. Mode « total » quand le site web existait déjà dans Shopify à ces
// dates, « mp » (marketplaces seules) sinon, « aucun » quand l'historique ne remonte pas assez loin.
function suiviAttendu(E, n, jourSel, mpF, semaine = false) {
  const ext = E.ext, dmax = E.rap.dmax;
  const au = jourSel || dmax, du = jourSel || addJ(dmax, 1 - n);
  const iSite = ext.mp.indexOf("Site Web");
  let jourMin = null, siteDepuis = null;
  for (const l of ext.lignes) { if (jourMin === null || l[0] < jourMin) jourMin = l[0]; if (l[1] === iSite && (siteDepuis === null || l[0] < siteDepuis)) siteDepuis = l[0]; }
  const garde = (mp) => !mpF || mp === mpF;
  const a = semaine ? addJ(du, -364) : jourAn(du), b = semaine ? addJ(au, -364) : jourAn(au); // semaine : même jour de la semaine l'an dernier
  const r = { mp: 0, site: 0, prod: {}, prodMp: {}, prodN1: {}, prodN1Mp: {}, canal: {}, canalQte: {}, canalN1: {}, pays: {}, n1: { mp: 0, site: 0, all: null }, avecMp: mpF !== "Site Web", avecSite: !mpF || mpF === "Site Web", nbJours: jourSel ? 1 : n };
  const cumul = (o, nom, c) => { o[nom] = (o[nom] || 0) + c; };
  for (const [d, im, ip, q, c] of ext.lignes) {
    const mp = ext.mp[im]; if (!garde(mp)) continue;
    const site = mp === "Site Web", nom = ext.produits[ip][0];
    if (d >= du && d <= au) { if (site) r.site += c; else { r.mp += c; cumul(r.prodMp, nom, c); } cumul(r.prod, nom, c); cumul(r.canal, mp, c); cumul(r.canalQte, mp, q); }
    if (d >= a && d <= b) { if (site) r.n1.site += c; else { r.n1.mp += c; cumul(r.prodN1Mp, nom, c); } cumul(r.prodN1, nom, c); cumul(r.canalN1, mp, c); }
  }
  for (const [d, ipa, im, c] of ext.pays_jour || []) if (d >= du && d <= au && garde(ext.mp[im])) { const pa = ext.pays[ipa] ?? null; r.pays[pa] = (r.pays[pa] || 0) + c; }
  const debutN1 = /^\d{4}-\d{2}-\d{2}$/.test(ext.du || "") ? ext.du : jourMin;
  const mpOk = r.avecMp && debutN1 !== null && a >= debutN1, siteOk = r.avecSite && siteDepuis !== null && a >= siteDepuis;
  r.mode = (!r.avecMp || mpOk) && (!r.avecSite || siteOk) ? "total" : mpOk ? "mp" : "aucun";
  if (r.mode === "total") r.n1.all = (r.avecMp ? r.n1.mp : 0) + (r.avecSite ? r.n1.site : 0);
  if (!mpOk) r.n1.mp = 0;
  if (!siteOk) r.n1.site = 0;
  r.total = r.mp + r.site;
  // canal comparable avec l'an dernier : le site web depuis sa première vente Shopify, une marketplace depuis le début de l'historique
  r.comparable = (nom) => r.mode !== "aucun" && (nom === "Site Web" ? siteOk : mpOk);
  r.cmd = 0; r.cmdN1 = 0; // commandes (CA > 0) du périmètre affiché, sur la fenêtre et sur les mêmes dates l'an dernier
  for (const [d, im, n] of ext.commandes || []) { if (!garde(ext.mp[im])) continue; if (d >= du && d <= au) r.cmd += n; if (d >= a && d <= b) r.cmdN1 += n; }
  return r;
}


const lireSuivi = (page) => page.evaluate(() => {
  const q = (s) => document.querySelector(s), txt = (el) => (el ? el.innerText : "");
  return {
    bloc: txt(q('[data-suivi="bloc"]')), total: txt(q('[data-suivi="total"]')), valeur: Number((q('[data-suivi="total"]') || { dataset: {} }).dataset.valeur),
    legende: txt(q('[data-suivi="legende"]')), kpi: txt(q('[data-suivi="kpi"]')),
    puces: [...document.querySelectorAll('[data-suivi="puces"] button')].map((b) => ({ n: Number(b.dataset.n), actif: b.getAttribute("aria-pressed") === "true" })),
    canaux: [...document.querySelectorAll('[data-suivi-ligne="mp"]')].map((r) => ({ nom: r.dataset.nom, ca: Number(r.dataset.ca), texte: r.innerText })),
    produits: [...document.querySelectorAll('[data-suivi-ligne="produit"]')].map((r) => ({ nom: r.dataset.nom, ca: Number(r.dataset.ca), texte: r.innerText })),
    pays: [...document.querySelectorAll('[data-suivi-ligne="pays"]')].map((r) => ({ nom: r.dataset.nom, part: Number(r.dataset.part), ca: Number(r.dataset.ca) })),
    reset: Boolean(q('[data-suivi="reset"]')), vs: Boolean(q('[data-suivi="vs"]')), deltaMp: Boolean(q('[data-suivi="delta-mp"]')), ecart: Boolean(q('[data-suivi="ecart"]')), vsTexte: txt(q('[data-suivi="vs"]')),
    commandes: q('[data-suivi="commandes"]') ? { valeur: Number(q('[data-suivi="commandes"]').dataset.valeur), texte: txt(q('[data-suivi="commandes"]')) } : null,
    panier: q('[data-suivi="panier"]') ? { valeur: Number(q('[data-suivi="panier"]').dataset.valeur), texte: txt(q('[data-suivi="panier"]')) } : null,
    ligneN1: document.querySelectorAll('[data-suivi="graphique"] .recharts-line-curve[stroke="#EDE7DB"]').length,
    barres: document.querySelectorAll('[data-suivi="graphique"] .recharts-bar-rectangle').length,
  };
});
// clic au milieu de la i-ème colonne de l'histogramme (l'abscisse suffit : le graphique retrouve le jour le plus proche)
// i : rang du jour dans la fenêtre ; n : nombre de jours de la fenêtre. Avec n, on clique au centre de la bande du jour : un jour sans vente n'a pas de barre dans le DOM,
// le rang des barres ne coïncide alors plus avec celui des jours (le graphique réagit au clic n'importe où dans la bande : surGraphique, activeLabel).
async function cliquerJour(page, i, n = null) {
  const pos = await page.evaluate(([k, nb]) => {
    const r = document.querySelectorAll('[data-suivi="graphique"] .recharts-bar-rectangle')[k];
    const grille = document.querySelector('[data-suivi="graphique"] .recharts-cartesian-grid');
    if (!grille || (!r && !nb)) return null;
    const g = grille.getBoundingClientRect();
    const x = nb ? g.left + ((k + 0.5) * g.width) / nb : (() => { const a = r.getBoundingClientRect(); return a.left + a.width / 2; })();
    return { x, y: g.top + g.height / 2 };
  }, [i, n]);
  if (!pos) return false;
  await page.mouse.click(pos.x, pos.y); await page.waitForTimeout(500);
  return true;
}
// volets visibles (onglets mobile, top 10, pays, note « Δ marketplaces ») et onglet actif
const voletsVisibles = (page) => page.evaluate(() => {
  const vis = (e) => { if (!e) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const actif = document.querySelector('[data-suivi="onglets"] [aria-selected="true"]');
  return {
    onglets: vis(document.querySelector('[data-suivi="onglets"]')), top: vis(document.querySelector('[data-suivi="top10"]')), mp: vis(document.querySelector('[data-suivi="mp"]')), pays: vis(document.querySelector('[data-suivi="pays"]')),
    deltaMp: [...document.querySelectorAll('[data-suivi="delta-mp"]')].some(vis), actif: actif ? actif.dataset.onglet : null,
  };
});
const decrireVolets = (e) => `onglets ${e.onglets ? "visibles" : "masqués"}, top 10 ${e.top ? "visible" : "masqué"}, marketplaces ${e.mp ? "visibles" : "masquées"}, pays ${e.pays ? "visibles" : "masqués"}, note Δ marketplaces ${e.deltaMp ? "visible" : "masquée"}, onglet actif « ${e.actif} »`;
// top 10 des marketplaces (site web compris), sans filtre marketplace : mêmes canaux dans le même ordre, mêmes montants, part du CA affiché, unités ;
// variation en % et écart en € seulement pour un canal comparable (jamais sur une base incomplète) ; avec un filtre marketplace, le volet n'existe pas
function comparerCanaux(s, A, etiquette) {
  const ok = (c, m) => verifier(c, `${etiquette} : ${m}`);
  if (!(A.avecMp && A.avecSite)) { ok(s.canaux.length === 0, `top 10 marketplaces affiché (${s.canaux.length} ligne(s)) alors qu'une marketplace est filtrée`); return; }
  const canaux = trier(A.canal).slice(0, 10), libelle = { "Site Web": "Site web", "Autre": "Autres" };
  ok(s.canaux.length === canaux.length, `top 10 marketplaces : ${s.canaux.length} ligne(s), ${canaux.length} attendue(s)`);
  canaux.forEach(([nom, ca], i) => {
    const l = s.canaux[i];
    ok(l && l.nom === nom && proche(l.ca, ca, 1.5), `top 10 marketplaces, rang ${i + 1} : « ${l && l.nom} » ${l && l.ca} € ≠ « ${nom} » ${Math.round(ca)} €`);
    if (!l) return;
    const txt = norm(l.texte), cur = ca, ref = A.canalN1[nom] || 0;
    ok(contient(txt, libelle[nom] || nom), `top 10 marketplaces, « ${nom} » : libellé absent (${txt})`);
    ok(contient(txt, `${fmtNum(ca)} €`), `top 10 marketplaces, « ${nom} » : montant ${fmtNum(ca)} € absent (${txt})`);
    ok(contient(txt, `${((ca / A.total) * 100).toFixed(1)} %`), `top 10 marketplaces, « ${nom} » : part ${((ca / A.total) * 100).toFixed(1)} % absente (${txt})`);
    ok(contient(txt, `${fmtNum(A.canalQte[nom] || 0)} u.`), `top 10 marketplaces, « ${nom} » : ${fmtNum(A.canalQte[nom] || 0)} u. absentes (${txt})`);
    if (!A.comparable(nom) || (cur === 0 && ref === 0)) { ok(!/[▲▼▬]|nouveau|[+-]\d[\d.]*k?€/i.test(txt), `top 10 marketplaces, « ${nom} » : variation affichée alors que ce canal n'est pas comparable (${txt})`); return; }
    ok(contient(txt, ecartApp(cur - ref)), `top 10 marketplaces, « ${nom} » : écart ${ecartApp(cur - ref)} absent (${txt})`);
    if (ref > 0) ok(contient(txt, varApp((cur / ref - 1) * 100)), `top 10 marketplaces, « ${nom} » : variation ${varApp((cur / ref - 1) * 100)} absente (${txt})`);
    else ok(contient(txt, "nouveau"), `top 10 marketplaces, « ${nom} » : pastille « nouveau » absente (${txt})`);
  });
  ok(s.canaux.every((c, i) => i === 0 || c.ca <= s.canaux[i - 1].ca + 1.5), "top 10 marketplaces : les lignes ne sont pas classées par CA décroissant");
}
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
  // commandes et panier moyen (version Shopify seul) ; en production le fichier n'a pas de commandes par jour : rien ne doit s'afficher
  if (A.cmd === undefined) ok(s.commandes === null && s.panier === null, "commandes / panier moyen affichés alors qu'il n'y a pas de commandes par jour");
  else if (A.cmd <= 0) ok(s.commandes === null && s.panier === null, "commandes / panier moyen affichés sans aucune commande");
  else {
    const aov = A.total / A.cmd, comparable = A.mode === "total" && A.cmdN1 > 0 && A.n1.all > 0, aov1 = comparable ? A.n1.all / A.cmdN1 : null;
    ok(s.commandes !== null && s.commandes.valeur === A.cmd && contient(s.commandes.texte, fmtNum(A.cmd)), `commandes : ${s.commandes && s.commandes.valeur} (« ${s.commandes && norm(s.commandes.texte)} ») ≠ ${A.cmd} attendues`);
    ok(s.panier !== null && proche(s.panier.valeur, aov, 1.5) && contient(s.panier.texte, `${fmtNum(aov)} €`), `panier moyen : ${s.panier && s.panier.valeur} (« ${s.panier && norm(s.panier.texte)} ») ≠ ${fmtNum(aov)} € attendus (CA ${fmtNum(A.total)} ÷ ${A.cmd} commandes)`);
    if (s.commandes && s.panier) {
      if (comparable) {
        ok(contient(s.commandes.texte, varApp((A.cmd / A.cmdN1 - 1) * 100)), `commandes : variation ${varApp((A.cmd / A.cmdN1 - 1) * 100)} absente (${norm(s.commandes.texte)})`);
        ok(contient(s.panier.texte, varApp((aov / aov1 - 1) * 100)), `panier moyen : variation ${varApp((aov / aov1 - 1) * 100)} absente (${norm(s.panier.texte)})`);
      } else ok(!/[▲▼▬]/.test(s.commandes.texte + s.panier.texte), `commandes / panier moyen : variation affichée sans base comparable (mode ${A.mode})`);
    }
  }
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
  comparerCanaux(s, A, etiquette);
  // pays : la part de chaque pays = son CA ÷ le CA de la fenêtre (6 pays puis « Autres »)
  const ts = trier(A.pays), sommePays = ts.reduce((a, [, v]) => a + v, 0);
  ok(s.pays.length === Math.min(ts.length, 7), `pays : ${s.pays.length} ligne(s), ${Math.min(ts.length, 7)} attendue(s)`);
  ts.slice(0, 6).forEach(([nom, ca], i) => {
    const l = s.pays[i];
    ok(l && l.nom === nom && proche(l.part, (ca / sommePays) * 100, 0.02), `pays, rang ${i + 1} : « ${l && l.nom} » ${l && l.part} % ≠ « ${nom} » ${((ca / sommePays) * 100).toFixed(2)} %`);
  });
  ok(proche(s.pays.reduce((a, l) => a + l.part, 0), 100, 0.15), `pays : les parts font ${s.pays.reduce((a, l) => a + l.part, 0).toFixed(2)} % (100 attendus)`);
}

// ---- Plan 2026 (mise à jour du 21 octobre 2026) : objectif du jour = plan de la semaine ÷ 7 × poids habituel du jour de la semaine (la semaine garde le total du plan),
// « % du plan » à côté du CA en tête, courbe d'objectif de l'histogramme, courbe d'objectif mensuel de la tendance. Les chiffres attendus sont recalculés ICI,
// directement depuis les fichiers du dépôt, sans passer par le code de l'application. ----
const dow = (iso) => new Date(iso + "T00:00:00Z").getUTCDay(); // 0 = dimanche … 6 = samedi
// semaine Excel (WEEKNUM : dimanche→samedi, la semaine 1 contient le 1er janvier) = semaines écoulées depuis le dimanche qui ouvre la semaine 1, plus 1
const semaineExcel = (iso) => { const y = iso.slice(0, 4), dim1 = addJ(`${y}-01-01`, -dow(`${y}-01-01`)); return Math.floor((Date.parse(iso + "T00:00:00Z") - Date.parse(dim1 + "T00:00:00Z")) / (7 * 864e5)) + 1; };
const PROFIL_SEMAINES_MIN = 8; // un profil des jours demande au moins 8 semaines entières, chacune avec 7 jours de vente
// CA par jour (Map jour → CA) : lignes dont la marketplace est en colonne 1 et le CA en colonne « colCa » ; garde(nomMp) choisit les canaux, « apres » écarte les jours antérieurs
const serieJours = (lignes, noms, garde, apres = "", colCa = 5) => { const m = new Map(); for (const l of lignes) { if (l[0] <= apres || !garde(noms[l[1]])) continue; m.set(l[0], (m.get(l[0]) || 0) + l[colCa]); } return m; };
// version Shopify seul : tout l'historique vient de shopify_extension.json (schéma 2 : [jour, iMp, iProduit, qte, caHT]), site web compris
function tranchesAttendues(E, mpF) {
  const jours = E.ext.lignes.map((l) => l[0]).sort();
  return [{ du: jours[0], au: jours[jours.length - 1], ca: serieJours(E.ext.lignes, E.ext.mp, (m) => !mpF || m === mpF, "", 4) }];
}
// profil des jours : pour chaque semaine entière (dimanche→samedi, 7 jours de vente), part de chaque jour dans la moyenne de sa semaine ; moyenne de ces parts sur toutes les semaines
function profilJours(tranches) {
  const somme = Array(7).fill(0); let nb = 0;
  for (const { du, au, ca } of tranches) {
    const sem = new Map(); // dimanche d'ouverture → { nombre de jours vus, CA des 7 jours }
    for (let d = du; d <= au; d = addJ(d, 1)) {
      const k = addJ(d, -dow(d));
      if (!sem.has(k)) sem.set(k, { n: 0, v: Array(7).fill(0) });
      const s = sem.get(k); s.n++; s.v[dow(d)] = ca.get(d) || 0;
    }
    for (const { n, v } of sem.values()) {
      if (n < 7 || v.some((x) => !(x > 0))) continue; // semaine incomplète ou avec un jour sans vente : ignorée
      const moy = v.reduce((a, b) => a + b, 0) / 7;
      v.forEach((x, k) => { somme[k] += x / moy; }); nb++;
    }
  }
  return { nb, poids: nb >= PROFIL_SEMAINES_MIN ? somme.map((x) => x / nb) : null };
}
// plan attendu d'un périmètre (mpF : nom de marketplace ou « Site Web » ; null = tous les canaux) ; null quand la marketplace n'a pas d'objectif fiable
// le plan 2026 (objectif annuel, mensuel et hebdomadaire) est une constante de App.jsx ; on la relit dans le fichier testé
const objectif2026 = () => {
  const m = /^const OBJECTIF_2026 = (.*);[ \t]*$/m.exec(fs.readFileSync(path.join(RACINE, "App.jsx"), "utf8"));
  if (!m) throw new Error("App.jsx : constante OBJECTIF_2026 introuvable");
  return JSON.parse(m[1]);
};
function planAttendu(E, mpF) {
  const D = E.rap.C.DATA, OBJ = objectif2026();
  const entree = mpF ? D.mp_vs_objectif.find((m) => m.marketplace === mpF) : null;
  const part = !mpF ? 1 : entree && entree.objectif_fiable && entree.objectif ? entree.objectif / D.kpi.objectif_annuel_total : null;
  if (part === null) return null;
  const propre = profilJours(tranchesAttendues(E, mpF));
  const poids = propre.poids || (mpF ? profilJours(tranchesAttendues(E, null)).poids : null); // repli : profil de l'ensemble des canaux
  const semaine = (iso) => (iso.slice(0, 4) === "2026" ? OBJ.hebdo.find((x) => x[0] === semaineExcel(iso)) : undefined); // le plan hebdomadaire ne concerne que 2026
  return {
    part, poids, propre: Boolean(propre.poids), semaines: propre.nb,
    jour: (iso) => { const h = semaine(iso); return h ? Math.round((h[1] / 7) * (poids ? poids[dow(iso)] : 1) * part) : null; },
    hebdo: (iso) => { const h = semaine(iso); return h ? h[1] * part : null; },
    mois: (i) => Math.round(((mpF ? entree.objectif : D.kpi.objectif_annuel_total) * OBJ.mensuel[i]) / OBJ.annuel), // courbe mensuelle de la tendance
  };
}
const TR_PLAN = {
  fr: { leg: "Objectif (plan 2026)", per: "Objectif", jour: "Objectif du jour", nom: "Objectif 2026", mensuel: "Objectif 2026 (plan mensuel)" },
  en: { leg: "Target (2026 plan)", per: "Target", jour: "Daily target", nom: "2026 target", mensuel: "2026 target (monthly plan)" },
  es: { leg: "Objetivo (plan 2026)", per: "Objetivo", jour: "Objetivo del día", nom: "Objetivo 2026", mensuel: "Objetivo 2026 (plan mensual)" },
  zh: { leg: "目标（2026 年计划）", per: "目标", jour: "当日目标", nom: "2026 年目标", mensuel: "2026 年目标（月度计划）" },
};
const ROUGE = "rgb(248, 113, 113)", VERT = "rgb(52, 211, 153)", GRIS = "rgb(148, 140, 126)"; // RED, GREEN et MUTED de l'application, tels que les rend le navigateur
// tracé en escalier : que des segments horizontaux ou verticaux (une courbe lissée aurait des segments obliques ou des arcs)
const escalier = (d) => { const p = String(d).split(/[ML]/).filter(Boolean).map((s) => s.split(",").map(Number)); return p.length > 2 && !/[CQSTAHVZ]/i.test(String(d).replace(/[ML]/g, "")) && p.every((q, i) => i === 0 || Math.abs(q[0] - p[i - 1][0]) < 0.01 || Math.abs(q[1] - p[i - 1][1]) < 0.01); };
const fenetre = (E, n) => Array.from({ length: n }, (_, i) => addJ(E.rap.dmax, i + 1 - n)); // les n derniers jours du suivi
let COUVERTURE_PLAN = "";

const lirePlan = (page) => page.evaluate(() => {
  const q = (s) => document.querySelector(s), plan = q('[data-suivi="plan"]'), leg = q('[data-suivi="objectif"]'), fils = plan ? [...plan.children] : [];
  const courbe = q('[data-suivi="graphique"] .recharts-line-curve[stroke="#34D399"]'), txt = (e) => (e ? e.innerText : null);
  return {
    plan: txt(plan), objectif: plan ? Number(plan.dataset.objectif) : null, pct: plan ? Number(plan.dataset.pct) : null,
    etiquette: txt(fils[0]), montant: txt(fils[1]), pctTexte: txt(fils[3]), ecartTexte: txt(fils[4]),
    couleurs: [fils[3], fils[4]].map((e) => (e ? getComputedStyle(e).color : null)),
    legende: txt(leg),
    jours: [...document.querySelectorAll('[data-suivi="objectif-jour"]')].map((c) => ({ d: c.dataset.d, obj: Number(c.dataset.obj) })),
    courbe: courbe ? courbe.getAttribute("d") : null,
  };
});
// compare ce que l'application affiche (ligne du plan, légende, points et tracé de la courbe d'objectif) au plan recalculé ; jours = les jours du graphique
function comparerPlan(o, A, P, etiquette, { jours, jourSel = null, lang = "fr" }) {
  const ok = (c, m) => verifier(c, `${etiquette} : ${m}`);
  const avec = P !== null && jours.every((d) => P.jour(d) !== null);
  if (!avec) { // pas d'objectif fiable (ou fenêtre hors du plan 2026) : ni ligne du plan, ni légende, ni courbe
    ok(o.plan === null && o.legende === null && o.jours.length === 0 && o.courbe === null, `plan affiché (ligne « ${o.plan} », légende « ${o.legende} », ${o.jours.length} point(s), courbe ${o.courbe ? "tracée" : "absente"}) alors qu'il n'y a pas d'objectif fiable sur cette fenêtre`);
    return;
  }
  const attendu = jours.map((d) => [d, P.jour(d)]), tr = TR_PLAN[lang];
  ok(o.jours.length === attendu.length, `${o.jours.length} point(s) sur la courbe d'objectif, ${attendu.length} attendu(s)`);
  attendu.forEach(([d, v], i) => { const l = o.jours[i]; ok(l && l.d === d && proche(l.obj, v, 1), `objectif du ${d} : ${l && l.obj} € affiché, ${v} € attendu (${P.poids ? `profil des jours ${P.propre ? "propre" : "de repli"}` : "poids égaux"}, part ${(P.part * 100).toFixed(2)} %)`); });
  // chaque semaine entière affichée garde le total du plan (7 arrondis : 4 € au plus d'écart)
  for (const dim of jours.filter((d) => dow(d) === 0 && addJ(d, 6) <= jours[jours.length - 1])) {
    const somme = [0, 1, 2, 3, 4, 5, 6].reduce((a, k) => a + ((o.jours.find((l) => l.d === addJ(dim, k)) || {}).obj || 0), 0);
    ok(proche(somme, P.hebdo(dim), 4), `semaine du ${dim} : ${somme} € d'objectifs journaliers pour ${Math.round(P.hebdo(dim))} € au plan de la semaine entière`);
  }
  ok(o.legende !== null && contient(o.legende, tr.leg), `légende de la courbe d'objectif « ${o.legende} » (« ${tr.leg} » attendu en ${lang})`);
  ok(o.courbe !== null && escalier(o.courbe), "la courbe d'objectif n'est pas un escalier (segments horizontaux et verticaux)");
  const objAtt = jourSel ? P.jour(jourSel) : attendu.reduce((a, [, v]) => a + v, 0);
  ok(o.plan !== null && proche(o.objectif, objAtt, jourSel ? 1 : attendu.length), `objectif ${jourSel ? `du ${jourSel}` : "de la période"} : ${o.objectif} € affiché, ${objAtt} € attendu`);
  if (o.plan === null) return;
  const pct = (A.total / objAtt) * 100, ec = A.total - o.objectif;
  ok(proche(o.pct, pct, 0.2), `% du plan ${o.pct} affiché, ${pct.toFixed(1)} attendu (CA ${fmtNum(A.total)} € pour ${fmtNum(objAtt)} € d'objectif)`);
  const libelle = tr[jourSel ? "jour" : "per"];
  ok(o.etiquette === libelle, `libellé « ${o.etiquette} » (« ${libelle} » attendu en ${lang}${jourSel ? ", jour touché" : ""})`);
  const montant = jourSel ? `${fmtNum(o.objectif)} €` : kApp(o.objectif);
  ok(norm(o.montant) === montant, `montant de l'objectif « ${norm(o.montant)} » ≠ attendu « ${montant} »`);
  const pctTexte = `${Math.abs(pct - 100) < 0.5 ? pct.toFixed(1) : Math.round(pct)} %`;
  ok(norm(o.pctTexte) === pctTexte, `part du plan « ${norm(o.pctTexte)} » ≠ attendue « ${pctTexte} »`);
  ok(norm(o.ecartTexte) === ecartApp(ec), `écart au plan « ${norm(o.ecartTexte)} » ≠ attendu « ${ecartApp(ec)} »`);
  const couleur = Math.round(Math.abs(ec)) === 0 ? GRIS : ec > 0 ? VERT : ROUGE;
  ok(o.couleurs.every((c) => c === couleur), `couleur du % et de l'écart ${o.couleurs.join(" / ")} (${couleur} attendu : ${ec > 0 ? "au-dessus" : "en dessous"} du plan)`);
}
// bulle du graphique du suivi : on place la souris sur la i-ème barre sans cliquer
async function survolerJour(page, i, n = null) { // n : nombre de jours de la fenêtre (voir cliquerJour) ; sans lui, rang de la barre
  const pos = await page.evaluate(([k, nb]) => {
    const r = document.querySelectorAll('[data-suivi="graphique"] .recharts-bar-rectangle')[k], g = document.querySelector('[data-suivi="graphique"] .recharts-cartesian-grid');
    if (!g || (!r && !nb)) return null;
    const b = g.getBoundingClientRect();
    const x = nb ? b.left + ((k + 0.5) * b.width) / nb : (() => { const a = r.getBoundingClientRect(); return a.left + a.width / 2; })();
    return { x, y: b.top + b.height / 2 };
  }, [i, n]);
  if (!pos) return null;
  await page.mouse.move(pos.x, pos.y); await page.waitForTimeout(450);
  const texte = await page.evaluate(() => { const el = document.querySelector('[data-suivi="graphique"] .recharts-tooltip-wrapper'); return el ? el.innerText : ""; });
  await page.mouse.move(2, 2); await page.waitForTimeout(150);
  return norm(texte);
}
// la bulle du i-ème jour de la fenêtre : libellé traduit de l'objectif du jour, montant, écart du CA du jour à cet objectif (les montants de la bulle sont arrondis jour par jour)
async function comparerBulle(page, E, n, i, mpF, P, etiquette, lang = "fr") {
  const d = fenetre(E, n)[i], tr = TR_PLAN[lang], ok = (c, m) => verifier(c, `${etiquette} : ${m}`);
  const tip = await survolerJour(page, i, n);
  if (!ok(tip !== null, "barre introuvable pour la bulle")) return;
  const pt = (await lirePlan(page)).jours.find((l) => l.d === d);
  if (!P || P.jour(d) === null) { ok(!contient(tip, tr.jour), `bulle du ${d} : « ${tr.jour} » affiché alors qu'il n'y a pas d'objectif (${tip})`); return; }
  const A = suiviAttendu(E, n, d, mpF), tot = Math.round(A.mp) + Math.round(A.site);
  ok(contient(tip, tr.jour), `bulle du ${d} : libellé « ${tr.jour} » absent (${tip})`);
  ok(pt && contient(tip, `${fmtNum(pt.obj)} €`), `bulle du ${d} : objectif ${pt && fmtNum(pt.obj)} € absent (${tip})`);
  ok(pt && contient(tip, varApp((tot / pt.obj - 1) * 100)), `bulle du ${d} : écart du CA à l'objectif ${pt && varApp((tot / pt.obj - 1) * 100)} absent (${tip})`);
}

async function verifierPlan(browser, base, E) {
  // garde-fou du test lui-même : semaines Excel connues du plan 2026 (semaine 1 = 28 déc. 2025 → 3 janv. 2026, semaine 41 = 4 → 10 oct.)
  verifier(semaineExcel("2026-01-01") === 1 && semaineExcel("2026-01-03") === 1 && semaineExcel("2026-01-04") === 2 && semaineExcel("2026-10-04") === 41 && semaineExcel("2026-10-10") === 41 && semaineExcel("2026-10-11") === 42, "plan : la semaine Excel recalculée par le test est inexacte");
  const P0 = planAttendu(E, null);
  if (verifier(P0 && P0.poids, `plan : profil des jours attendu introuvable sans filtre (${P0 ? P0.semaines : 0} semaine(s) entière(s), 8 nécessaires)`)) {
    verifier(proche(P0.poids.reduce((a, b) => a + b, 0), 7, 1e-9) && Math.max(...P0.poids) - Math.min(...P0.poids) > 0.05, `plan : poids des jours (${P0.poids.map((x) => x.toFixed(2)).join(" ")}) : moyenne de 1 sur la semaine et jours différents attendus`);
  }
  // a) bureau, français, sans filtre : période par défaut, bulle, période la plus longue (semaines entières), jour touché
  {
    const { ctx, page, erreurs } = await ouvrir(browser);
    await ouvrirDashboard(page, base);
    const s0 = await lireSuivi(page), n = (s0.puces.find((p) => p.actif) || { n: 7 }).n;
    comparerPlan(await lirePlan(page), suiviAttendu(E, n), P0, `plan ${n} j`, { jours: fenetre(E, n) });
    await comparerBulle(page, E, n, Math.min(3, n - 1), null, P0, `plan ${n} j`);
    await comparerBulle(page, E, n, n - 1, null, P0, `plan ${n} j`);
    const plus = s0.puces.reduce((m, p) => (p.n > m ? p.n : m), 0);
    if (plus !== n) {
      await page.locator(`[data-suivi="puces"] button[data-n="${plus}"]`).click(); await page.waitForTimeout(500);
      comparerPlan(await lirePlan(page), suiviAttendu(E, plus), P0, `plan ${plus} j`, { jours: fenetre(E, plus) });
      await page.locator(`[data-suivi="puces"] button[data-n="${n}"]`).click(); await page.waitForTimeout(400);
    }
    const jt = fenetre(E, n)[Math.min(3, n - 1)];
    if (verifier(await cliquerJour(page, Math.min(3, n - 1), n), "plan : barre introuvable")) {
      comparerPlan(await lirePlan(page), suiviAttendu(E, n, jt), P0, `plan jour ${jt}`, { jours: fenetre(E, n), jourSel: jt });
      await page.locator('[data-suivi="reset"]').click(); await page.waitForTimeout(400);
      comparerPlan(await lirePlan(page), suiviAttendu(E, n), P0, `plan ${n} j (après retour)`, { jours: fenetre(E, n) });
    }
    verifier(erreurs.length === 0, `erreurs JavaScript (plan) : ${erreurs.slice(0, 3).join(" | ")}`);
    await ctx.close();
  }
  // b) filtre marketplace : part de l'objectif annuel de la marketplace ; profil propre quand elle a assez de semaines, sinon profil de l'ensemble ; rien sans objectif fiable
  const propres = [], replis = [], sans = [];
  for (const mp of ["Leroy Merlin", "Bricomarché", "Boulanger", "Site Web", "Autre"]) {
    const { ctx, page, erreurs } = await ouvrir(browser);
    await ouvrirDashboard(page, base, { marketplace: mp });
    const s = await lireSuivi(page), n = (s.puces.find((p) => p.actif) || { n: 7 }).n, P = planAttendu(E, mp);
    (P ? (P.propre ? propres : replis) : sans).push(mp);
    comparerPlan(await lirePlan(page), suiviAttendu(E, n, null, mp), P, `plan filtre ${mp}`, { jours: fenetre(E, n) });
    if (P) await comparerBulle(page, E, n, Math.min(3, n - 1), mp, P, `plan filtre ${mp}`);
    const jt = fenetre(E, n)[Math.min(3, n - 1)];
    if (P && (await cliquerJour(page, Math.min(3, n - 1), n))) comparerPlan(await lirePlan(page), suiviAttendu(E, n, jt, mp), P, `plan filtre ${mp}, jour ${jt}`, { jours: fenetre(E, n), jourSel: jt });
    verifier(erreurs.length === 0, `erreurs JavaScript (plan, filtre ${mp}) : ${erreurs.slice(0, 3).join(" | ")}`);
    await ctx.close();
  }
  COUVERTURE_PLAN = `profil propre : ${propres.join(", ") || "aucun"} ; repli sur l'ensemble des canaux : ${replis.join(", ") || "aucun"} ; sans objectif : ${sans.join(", ") || "aucun"}`;
  // c) autres langues : libellés de la ligne du plan, de la légende et de la bulle, aussi sur un jour touché
  for (const lang of ["en", "es", "zh"]) {
    const { ctx, page, erreurs } = await ouvrir(browser);
    await ouvrirDashboard(page, base, { lang });
    const s = await lireSuivi(page), n = (s.puces.find((p) => p.actif) || { n: 7 }).n, jt = fenetre(E, n)[Math.min(3, n - 1)];
    comparerPlan(await lirePlan(page), suiviAttendu(E, n), P0, `plan ${lang.toUpperCase()}`, { jours: fenetre(E, n), lang });
    await comparerBulle(page, E, n, Math.min(3, n - 1), null, P0, `plan ${lang.toUpperCase()}`, lang);
    if (await cliquerJour(page, Math.min(3, n - 1), n)) comparerPlan(await lirePlan(page), suiviAttendu(E, n, jt), P0, `plan ${lang.toUpperCase()}, jour ${jt}`, { jours: fenetre(E, n), jourSel: jt, lang });
    verifier(erreurs.length === 0, `erreurs JavaScript (plan ${lang}) : ${erreurs.slice(0, 3).join(" | ")}`);
    await ctx.close();
  }
}

// ---- Courbe de tendance : objectif mensuel du plan 2026, tracé en dernier (sinon le masque opaque de la fourchette anticipée le cache), points pleins, libellés traduits ----
const TENDANCE = '.recharts-wrapper:has(.recharts-area-curve[stroke-dasharray="4 3"])'; // le seul graphique en aires qui porte la fourchette anticipée
const lireTendance = (page) => page.evaluate((sel) => {
  const w = document.querySelector(sel);
  if (!w) return null;
  const aires = [...w.querySelectorAll(".recharts-area")], trait = (a) => (a.querySelector(".recharts-area-curve") || a).getAttribute("stroke");
  const vertes = aires.filter((a) => trait(a) === "#34D399"), pts = vertes.length ? [...vertes[0].querySelectorAll(".recharts-area-dots circle")] : [];
  return {
    nbAires: aires.length, vertes: vertes.length, rang: vertes.length ? aires.indexOf(vertes[0]) : -1, tirets: vertes.length ? vertes[0].querySelector(".recharts-area-curve").getAttribute("stroke-dasharray") : null,
    points: pts.map((c) => ({ fill: c.getAttribute("fill"), opacite: c.getAttribute("fill-opacity") })),
    texte: document.body.innerText,
  };
}, TENDANCE);
// bulle de la tendance au-dessus du mois i (0 = janvier) : la souris se place sur l'abscisse de l'initiale du mois
async function survolerMois(page, i) {
  await page.evaluate((sel) => { const w = document.querySelector(sel); if (w) w.scrollIntoView({ block: "center" }); }, TENDANCE);
  await page.waitForTimeout(500);
  const pos = await page.evaluate(([sel, k]) => {
    const w = document.querySelector(sel), t = w && [...w.querySelectorAll(".recharts-xAxis .recharts-cartesian-axis-tick")][k];
    if (!t) return null;
    const a = t.getBoundingClientRect(), b = w.getBoundingClientRect();
    return { x: a.left + a.width / 2, y: b.top + b.height * 0.4 };
  }, [TENDANCE, i]);
  if (!pos) return null;
  await page.mouse.move(pos.x, pos.y); await page.waitForTimeout(600);
  const texte = await page.evaluate((sel) => { const el = document.querySelector(sel + " .recharts-tooltip-wrapper"); return el ? el.innerText : ""; }, TENDANCE);
  await page.mouse.move(2, 2); await page.waitForTimeout(150);
  return norm(texte);
}
async function verifierTendance(browser, base, E) {
  const cas = [["fr", null], ["en", null], ["es", null], ["zh", null], ["fr", "Leroy Merlin"], ["fr", "Site Web"], ["fr", "Autre"]];
  for (const [lang, mp] of cas) {
    const { ctx, page, erreurs } = await ouvrir(browser);
    await ouvrirDashboard(page, base, { lang, marketplace: mp || undefined });
    const P = planAttendu(E, mp), tr = TR_PLAN[lang], et = `tendance ${lang.toUpperCase()}${mp ? `, filtre ${mp}` : ""}`, ok = (c, m) => verifier(c, `${et} : ${m}`);
    await page.evaluate((sel) => { const w = document.querySelector(sel); if (w) w.scrollIntoView({ block: "center" }); }, TENDANCE);
    let T = null;
    for (let k = 0; k < 40; k++) { // les aires s'animent à l'affichage : les points n'existent qu'une fois l'animation finie
      T = await lireTendance(page);
      if (T && (P ? T.points.length === 12 : T.nbAires >= 5)) break;
      await page.waitForTimeout(250);
    }
    if (!ok(T !== null, "graphique de tendance introuvable")) { await ctx.close(); continue; }
    if (!P) { // pas d'objectif fiable : ni courbe verte ni légende
      ok(T.vertes === 0 && !contient(T.texte, tr.mensuel), `courbe d'objectif mensuel (${T.vertes} tracé(s)) ou légende affichée sans objectif fiable`);
    } else {
      ok(T.vertes === 1, `${T.vertes} courbe(s) d'objectif mensuel, 1 attendue`);
      ok(contient(T.texte, tr.mensuel), `légende « ${tr.mensuel} » absente (traduction)`);
      ok(T.rang === T.nbAires - 1, `la courbe d'objectif est la ${T.rang + 1}e aire sur ${T.nbAires} : elle doit être tracée en dernier, après le masque de la fourchette anticipée`);
      ok(T.tirets === "6 4", `courbe d'objectif en pointillés « 6 4 » attendue (${T.tirets})`);
      ok(T.points.length === 12 && T.points.every((p) => p.fill === "#34D399" && p.opacite === "1"), `points de la courbe d'objectif : ${T.points.length} point(s), pleins attendus (${JSON.stringify(T.points.slice(0, 2))})`);
      for (const i of [6, 10]) { // juillet (réel) et novembre (sous le masque de la fourchette anticipée)
        const tip = await survolerMois(page, i);
        ok(tip !== null && contient(tip, `${tr.nom} : ${fmtNum(P.mois(i))} €`), `bulle du mois ${i + 1} : « ${tr.nom} : ${fmtNum(P.mois(i))} € » attendu (${tip})`);
      }
    }
    verifier(erreurs.length === 0, `erreurs JavaScript (${et}) : ${erreurs.slice(0, 3).join(" | ")}`);
    await ctx.close();
  }
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
    for (const m of ["Top 10 produits", "Top 10 marketplaces", "Part du CA par pays", "Touchez un jour"]) verifier(contient(s.bloc, m), `suivi : « ${m} » absent`);
    verifier(!/\{(n|an|plage|date)\}/.test(s.bloc), "suivi : variable de modèle non remplacée");
    comparerSuivi(s, suiviAttendu(E, n), `suivi ${n} j`);
    {
      const A0 = suiviAttendu(E, n), v0 = await voletsVisibles(page);
      verifier(!v0.onglets && v0.top && v0.mp && v0.pays, `suivi bureau : onglets masqués et trois volets visibles attendus (${decrireVolets(v0)})`);
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
    const vf = await voletsVisibles(page);
    verifier(!vf.mp && vf.top && vf.pays, `suivi, filtre ${mp} : pas de top 10 marketplaces attendu avec un filtre (${decrireVolets(vf)})`);
    verifier(erreurs.length === 0, `erreurs JavaScript (suivi, filtre ${mp}) : ${erreurs.slice(0, 3).join(" | ")}`);
    await ctx.close();
  }
  // c) autres langues : titres traduits, aucune variable de modèle
  for (const [lang, titres] of [["en", ["Top 10 products", "Top 10 marketplaces", "Revenue share by country"]], ["es", ["Top 10 productos", "Top 10 marketplaces", "Cuota de ventas por país"]], ["zh", ["产品前 10 名", "平台前 10 名", "各国销售占比"]]]) {
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
  // noms de marketplaces rognés par la mise en page (points de suspension) : il ne doit y en avoir aucun
  const nomsTronques = (page) => page.evaluate(() => [...document.querySelectorAll('[data-suivi-ligne=\"mp\"] .truncate')].filter((el) => el.scrollWidth > el.clientWidth + 1).map((el) => el.innerText));
  for (const largeur of [390, 360]) {
    const { ctx, page, erreurs } = await ouvrir(browser, { largeur, hauteur: 844 });
    await ouvrirDashboard(page, base);
    const s0 = await lireSuivi(page);
    const n = (s0.puces.find((p) => p.actif) || { n: 7 }).n, A = suiviAttendu(E, n), et = `suivi mobile ${largeur}px`;
    let e = await voletsVisibles(page);
    verifier(e.onglets && e.top && !e.mp && !e.pays && e.actif === "top", `${et} : au départ, onglets visibles et top 10 seul attendus (${decrireVolets(e)})`);
    const cles = await page.evaluate(() => [...document.querySelectorAll('[data-suivi="onglets"] [role="tab"]')].map((b) => b.dataset.onglet));
    verifier(cles.join() === "top,mp,pays", `${et} : onglets « ${cles.join()} » (top,mp,pays attendus)`);
    verifier(e.deltaMp === (A.mode === "mp" && A.nbJours >= 7), `${et} : note « Δ marketplaces » ${e.deltaMp ? "affichée" : "absente"} en mode ${A.mode}`);
    verifier(s0.produits.length === Math.min(10, Object.keys(A.prod).length), `${et} : ${s0.produits.length} ligne(s) de top 10 (10 attendues, les 10 produits restent tous affichés)`);
    let trop = await depassements(page);
    verifier(trop.length === 0, `${et}, top 10 : contenu qui dépasse (${trop.join(" ; ")})`);
    if (verifier(await cliquerJour(page, 3), `${et} : barre introuvable`)) { // jour touché : le choix « même date / même jour de la semaine » ne doit rien faire dépasser
      trop = await depassements(page);
      verifier(trop.length === 0, `${et}, jour touché : contenu qui dépasse (${trop.join(" ; ")})`);
      await page.locator('[data-suivi="reset"]').click(); await page.waitForTimeout(300);
    }
    await page.locator('[data-suivi="onglets"] [data-onglet="mp"]').click(); await page.waitForTimeout(400);
    e = await voletsVisibles(page);
    verifier(e.onglets && !e.top && e.mp && !e.pays && e.actif === "mp" && !e.deltaMp, `${et} : après « Marketplaces », les marketplaces seules sont attendues (${decrireVolets(e)})`);
    comparerCanaux(await lireSuivi(page), A, `${et}, marketplaces`);
    trop = await depassements(page);
    verifier(trop.length === 0, `${et}, marketplaces : contenu qui dépasse (${trop.join(" ; ")})`);
    verifier((await nomsTronques(page)).length === 0, `${et}, marketplaces : noms rognés (${(await nomsTronques(page)).join(" ; ")})`);
    if (await cliquerJour(page, 3)) { // jour touché : les marketplaces du jour (variation et écart compris) sans rien qui dépasse
      const jt = addJ(E.rap.dmax, 1 - n + Math.min(3, n - 1));
      comparerCanaux(await lireSuivi(page), suiviAttendu(E, n, jt), `${et}, marketplaces du ${jt}`);
      trop = await depassements(page);
      verifier(trop.length === 0, `${et}, marketplaces, jour touché : contenu qui dépasse (${trop.join(" ; ")})`);
      await page.locator('[data-suivi="reset"]').click(); await page.waitForTimeout(300);
    }
    await ouvrirDashboard(page, base); // le volet choisi est mémorisé dans le navigateur
    e = await voletsVisibles(page);
    verifier(e.actif === "mp" && !e.top && e.mp && !e.pays, `${et} : le volet « marketplaces » n'est pas retrouvé après rechargement (${decrireVolets(e)})`);
    await page.locator('[data-suivi="onglets"] [data-onglet="pays"]').click(); await page.waitForTimeout(400);
    e = await voletsVisibles(page);
    verifier(e.onglets && !e.top && !e.mp && e.pays && e.actif === "pays" && !e.deltaMp, `${et} : après « % par pays », les pays seuls sont attendus (${decrireVolets(e)})`);
    const sp = await lireSuivi(page), ts = trier(A.pays), somme = ts.reduce((a, [, v]) => a + v, 0);
    verifier(sp.pays.length === Math.min(ts.length, 7) && ts.slice(0, 6).every(([nom, ca], k) => sp.pays[k] && sp.pays[k].nom === nom && proche(sp.pays[k].part, (ca / somme) * 100, 0.02)), `${et} : parts de pays affichées ≠ calcul indépendant`);
    trop = await depassements(page);
    verifier(trop.length === 0, `${et}, pays : contenu qui dépasse (${trop.join(" ; ")})`);
    await ouvrirDashboard(page, base); // le volet choisi est mémorisé dans le navigateur
    e = await voletsVisibles(page);
    verifier(e.actif === "pays" && !e.top && e.pays, `${et} : le volet « pays » n'est pas retrouvé après rechargement (${decrireVolets(e)})`);
    await page.locator('[data-suivi="onglets"] [data-onglet="top"]').click(); await page.waitForTimeout(400);
    e = await voletsVisibles(page);
    verifier(e.actif === "top" && e.top && !e.mp && !e.pays, `${et} : retour sur « Produits » (${decrireVolets(e)})`);
    verifier(erreurs.length === 0, `erreurs JavaScript (suivi mobile ${largeur}) : ${erreurs.slice(0, 3).join(" | ")}`);
    await ctx.close();
  }
  // d bis) bureau : trois volets côte à côte dès 1280 px (produits | marketplaces | pays) ; en dessous, produits à gauche et marketplaces au-dessus des pays ; rien ne dépasse ni n'est rogné
  for (const largeur of [1280, 1100]) {
    const { ctx, page, erreurs } = await ouvrir(browser, { largeur, hauteur: 900 });
    await ouvrirDashboard(page, base);
    const pos = await page.evaluate(() => {
      const r = (sel) => { const el = document.querySelector(sel); if (!el) return null; const b = el.getBoundingClientRect(); return b.width > 0 ? { x: b.left, y: b.top, w: b.width, h: b.height } : null; };
      return { top: r('[data-suivi="top10"]'), mp: r('[data-suivi="mp"]'), pays: r('[data-suivi="pays"]') };
    });
    const et = `suivi bureau ${largeur}px`;
    if (verifier(pos.top && pos.mp && pos.pays, `${et} : volets absents (${JSON.stringify(pos)})`)) {
      if (largeur >= 1280) verifier(pos.top.x < pos.mp.x && pos.mp.x < pos.pays.x && Math.abs(pos.top.y - pos.mp.y) < 3 && Math.abs(pos.mp.y - pos.pays.y) < 3, `${et} : trois volets côte à côte attendus (${JSON.stringify(pos)})`);
      else verifier(pos.top.x < pos.mp.x && Math.abs(pos.mp.x - pos.pays.x) < 3 && pos.pays.y > pos.mp.y + pos.mp.h - 3, `${et} : produits à gauche, marketplaces au-dessus des pays attendus (${JSON.stringify(pos)})`);
      verifier(pos.mp.w >= 240, `${et} : volet marketplaces trop étroit (${Math.round(pos.mp.w)}px)`);
    }
    const trop = await depassements(page);
    verifier(trop.length === 0, `${et} : contenu qui dépasse (${trop.join(" ; ")})`);
    verifier((await nomsTronques(page)).length === 0, `${et} : noms de marketplaces rognés (${(await nomsTronques(page)).join(" ; ")})`);
    if (await cliquerJour(page, 3)) { // jour touché : variations et écarts par marketplace sans rien qui dépasse
      const t2 = await depassements(page);
      verifier(t2.length === 0, `${et}, jour touché : contenu qui dépasse (${t2.join(" ; ")})`);
    }
    verifier(erreurs.length === 0, `erreurs JavaScript (suivi bureau ${largeur}) : ${erreurs.slice(0, 3).join(" | ")}`);
    await ctx.close();
  }
  // d ter) mobile avec un filtre marketplace : pas d'onglet « Marketplaces » (une seule ligne à classer) ; un volet « marketplaces » mémorisé retombe sur « Produits »
  {
    const { ctx, page, erreurs } = await ouvrir(browser, { largeur: 390, hauteur: 844 });
    await page.addInitScript(() => { try { localStorage.setItem("homy_suivi_onglet", "mp"); } catch { /* ignoré */ } });
    await ouvrirDashboard(page, base, { marketplace: "Leroy Merlin" });
    const cles = await page.evaluate(() => [...document.querySelectorAll('[data-suivi="onglets"] [role="tab"]')].map((b) => b.dataset.onglet));
    const e = await voletsVisibles(page);
    verifier(cles.join() === "top,pays", `suivi mobile, filtre Leroy Merlin : onglets « ${cles.join()} » (top,pays attendus)`);
    verifier(e.onglets && e.top && !e.mp && !e.pays && e.actif === "top", `suivi mobile, filtre Leroy Merlin : un volet « marketplaces » mémorisé doit retomber sur « Produits » (${decrireVolets(e)})`);
    verifier(erreurs.length === 0, `erreurs JavaScript (suivi mobile filtré) : ${erreurs.slice(0, 3).join(" | ")}`);
    await ctx.close();
  }
  // libellés des onglets dans les autres langues, sans débordement sur le plus petit écran
  for (const [lang, onglets] of [["en", ["Products", "Marketplaces", "% by country"]], ["es", ["Productos", "Marketplaces", "% por país"]], ["zh", ["产品", "平台", "国家占比"]]]) {
    const { ctx, page, erreurs } = await ouvrir(browser, { largeur: 360, hauteur: 844 });
    await ouvrirDashboard(page, base, { lang });
    const txt = await page.evaluate(() => { const el = document.querySelector('[data-suivi="onglets"]'); return el ? el.innerText : ""; });
    for (const m of onglets) verifier(contient(txt, m), `suivi mobile ${lang.toUpperCase()} : onglet « ${m} » absent (${norm(txt)})`);
    const sl = await lireSuivi(page), siteLigne = sl.canaux.find((c) => c.nom === "Site Web"), libSite = { en: "Website", es: "Sitio web", zh: "官网" }[lang];
    if (siteLigne) verifier(contient(siteLigne.texte, libSite), `suivi mobile ${lang.toUpperCase()} : le site web devrait s'appeler « ${libSite} » (${norm(siteLigne.texte)})`);
    verifier(sl.canaux.length > 0 && !/\{|undefined/.test(sl.canaux.map((c) => c.texte).join(" ")), `suivi mobile ${lang.toUpperCase()} : top 10 marketplaces vide ou avec une variable de modèle`);
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
  if (!E.rap.appliquee) { console.log(`ÉCHEC · le tableau de bord ne se construit pas avec les données du dépôt : ${(E.rap.erreurs || []).join(" ; ")}`); return 2; }
  const pw = chargerPlaywright();
  if (!pw) { console.log("TEST IMPOSSIBLE · Playwright introuvable"); return 77; }
  let browser;
  try { browser = await pw.chromium.launch(); } catch (e) { console.log(`TEST IMPOSSIBLE · Chromium indisponible (${String(e.message).split("\n")[0]})`); return 77; }
  const srv = await serveur();
  const base = `http://127.0.0.1:${srv.address().port}/`;
  const dmax = E.rap.dmax;
  try {
    if (process.argv.includes("--plan")) { // mise au point : seuls le plan 2026 du suivi quotidien et la courbe d'objectif de la tendance
      await verifierPlan(browser, base, E);
      await verifierTendance(browser, base, E);
      if (echecs.length) { for (const e of echecs) console.log(`ÉCHEC · ${e}`); return 2; }
      console.log("SMOKE_PLAN_OK"); return 0;
    }
    // 1) français, bureau : bandeau en une ligne, KPI, sous-informations absentes
    {
      const { ctx, page, erreurs } = await ouvrir(browser);
      await ouvrirDashboard(page, base);
      const b = await texteBandeau(page);
      verifier(b.length > 15, "bandeau « Données Shopify à jour » introuvable");
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
      verifier(!/ODP|Excel/i.test(b), "FR · bandeau : mention d'un fichier ODP / Excel");
      if (shotsDir) { fs.mkdirSync(shotsDir, { recursive: true }); await page.screenshot({ path: path.join(shotsDir, "bureau-fr.png") }); }
      const t = norm(await page.evaluate(() => document.body.innerText));
      verifier(t.includes(`${fmtNum(E.cumul)} € HT`), `FR · CA cumulé « ${fmtNum(E.cumul)} € HT » absent`);
      verifier(t.includes(`${fmtNum(E.qte)} unités vendues`), `FR · « ${fmtNum(E.qte)} unités vendues » absent`);
      verifier(t.includes(`${E.pct}%`), `FR · ${E.pct}% de l'objectif absent`);
      if (E.yoy !== null) verifier(t.includes(fmtPct(E.yoy)) && t.includes(`${fmtNum(E.n1)} €`), `FR · comparaison 2025 (${fmtPct(E.yoy)}, ${fmtNum(E.n1)} €) absente`);
      if (E.yoy !== null) verifier(t.includes("sur la même période 2025"), "FR · base de comparaison « vs … sur la même période 2025 » absente");
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
    await verifierPlan(browser, base, E);
    await verifierTendance(browser, base, E);

    // 2) trois autres langues
    for (const lang of ["en", "es", "zh"]) {
      const { ctx, page, erreurs } = await ouvrir(browser);
      await ouvrirDashboard(page, base, { lang });
      const b = await texteBandeau(page);
      verifier(b.length > 15, `${lang.toUpperCase()} · bandeau introuvable`);
      verifier(contient(b, TITRES[lang]) && contient(b, jour(dmax, lang)), `${lang.toUpperCase()} · titre ou date du bandeau absents (${b.slice(0, 120)})`);
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
      const ouvrirOnglet = async (params) => {
        await page.goto(`${base}?${new URLSearchParams({ lang: "fr", ...params })}`, { waitUntil: "load" });
        await page.waitForFunction(() => document.body && document.body.innerText.length > 400, null, { timeout: 30000 });
        await page.waitForTimeout(1200);
        return norm(await page.evaluate(() => document.body.innerText));
      };
      let t = await ouvrirOnglet({ tab: "marques", sousTab: "produits" });
      verifier(t.includes("Tous les produits"), "produits : liste « Tous les produits » absente");
      const lignes = await page.locator('div[style*="max-height: 520px"] > div').count();
      verifier(lignes >= 10, `produits : ${lignes} ligne(s) dans la liste classée (au moins 10 attendues)`);
      for (const x of RETIRE) verifier(!contient(t, x), `produits : sous-information retirée réapparue : « ${x} »`);
      t = await ouvrirOnglet({ tab: "marketplaces" });
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
  console.log(`SMOKE_OK · bloc « Données Shopify à jour » jusqu'au ${dmax} avec son suivi quotidien (période, jour touché avec choix même date / même jour de la semaine, même période l'an dernier, commandes et panier moyen, top 10 produits avec variation et écart en €, top 10 marketplaces, part du CA par pays, 4 langues, mobile avec onglets, trois volets sur ordinateur) et sa pastille de fraîcheur, sous-informations absentes, vues conservées (produits, % par pays, vs 2025), plan 2026 (objectif du jour pondéré par le profil des jours de la semaine, % du plan, courbe d'objectif du suivi et courbe mensuelle de la tendance, 4 langues ; ${COUVERTURE_PLAN}), chiffres = ${fmtNum(E.cumul)} € HT / ${fmtNum(E.qte)} unités / ${E.pct} % de l'objectif${E.yoy !== null ? ` / ${E.yoy.toFixed(1)} % vs 2025` : ""}, filtres marketplace, 7 onglets, mobile, écran d'erreur`);
  return 0;
}

main().then((c) => process.exit(c), (e) => { console.error(e); process.exit(2); });
