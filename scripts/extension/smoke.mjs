#!/usr/bin/env node
/**
 * Test d'affichage du tableau de bord construit sur les ventes Shopify, sur le build de production (dossier dist/).
 *
 *   npx vite build && node scripts/extension/smoke.mjs [--shots dossier] [--racine dossier] [--plan | --repartitions | --navigation]
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
 *   - l'onglet Marques › Répartitions (24 octobre 2026) : CA et quantités par pays, par marque (Bestherm · HOM'Y · Thomson) et par type de produit (catégorie ou sous-catégorie), par mois et par
 *     marketplace (site web compris), « Hors France », entité choisie, marketplace choisie, vue tableau, parts, 4 langues, mobile (390 et 360 px) ; chaque case du détail est recalculée dans le test
 *     depuis les constantes du tableau de bord (sans repartitions.js) ; les quantités par pays n'existent, pour une année, que si toutes ses lignes d'extraction en portent une (sinon : CA seul,
 *     bouton « Quantités » désactivé, jamais d'estimation) ; option --repartitions pour ne lancer que cet écran ;
 *   - la navigation mobile (24 octobre 2026) : sur téléphone (390 et 360 px), barre du haut (logo, période, marketplace — une seule ligne de 53 px) et barre du bas
 *     (7 onglets, nom court de l'onglet actif) réellement collées à l'écran avant et après un long défilement ; un appui change d'onglet et remonte en haut de page,
 *     un appui sur l'onglet actif aussi ; filtres de période et de marketplace (croix de remise à zéro, dates personnalisées, champs en 16 px contre le zoom d'iOS) ;
 *     sous-onglets de Marques et de Concurrence sur une seule ligne qui défile et se fige sous la barre du haut ; aucun champ n'a le focus à l'ouverture de Suivi Prix ;
 *     barre du bas retirée pendant la saisie ; bannière « mode démo » dans le bloc figé ; 4 langues ; dès 768 px, disposition d'origine conservée ;
 *     option --navigation pour ne lancer que cet écran ;
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

async function ouvrir(browser, { largeur = 1280, hauteur = 900, avance = 0, langue = "fr-FR", tactile = false } = {}) {
  // tactile : émulation d'un téléphone (écran tactile, rendu mobile) — nécessaire aux appuis (tap) de la navigation mobile
  const ctx = await browser.newContext({ locale: langue, viewport: { width: largeur, height: hauteur }, ...(tactile ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) });
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

// ---- Onglet Marques › Répartitions : chiffres attendus recalculés ICI depuis les constantes du tableau de bord construit par socle.js (sans repartitions.js) ----
const REP_AUTRES = "Autres produits"; // entité des produits sans catégorie / sans marque (voir repartitions.js)
function repAttendu(E) {
  const C = E.rap.C;
  const R = {};
  const cellule = (o, nom, mp, mois, ca, q) => {
    const e = o[nom] || (o[nom] = { ca: 0, qte: 0, mp: {} });
    const m = e.mp[mp] || (e.mp[mp] = { ca: new Array(12).fill(0), qte: new Array(12).fill(0) });
    e.ca += ca; e.qte += q; m.ca[mois - 1] += ca; m.qte[mois - 1] += q;
  };
  for (const an of [2025, 2026]) {
    R[an] = { pays: {}, marque: {}, categorie: {}, sous: {} };
    for (const r of C.PAYS_MONTHLY) if (r[2] === an) cellule(R[an].pays, r[0], r[1], r[3], r[4], r[5] || 0);
    for (const r of C.SKU_MONTHLY) if (r[2] === an) {
      const nom = C.SKU_PRODUIT[r[0]], mp = C.SKU_MPS[r[1]], cat = C.PRODUCT_TO_CATEGORY[nom];
      cellule(R[an].marque, C.SKU_MARQUE[r[0]] || REP_AUTRES, mp, r[3], r[4], r[5]);
      cellule(R[an].categorie, cat || REP_AUTRES, mp, r[3], r[4], r[5]);
      cellule(R[an].sous, (cat && C.SKU_SOUS_SOUS_FAMILLE[r[0]]) || REP_AUTRES, mp, r[3], r[4], r[5]);
    }
  }
  return { C, R };
}
// agrégats d'un découpage : entités classées, total, détail marketplace × mois (ent : une seule entité ; exclure : entités écartées)
function repAgg(X, an, dim, mesure, { ent = null, exclure = [] } = {}) {
  const ents = Object.entries(X.R[an][dim]).filter(([n]) => !exclure.includes(n));
  const mp = {}, totalMois = new Array(12).fill(0);
  for (const [nom, e] of ents) for (const [m, v] of Object.entries(e.mp)) {
    const o = mp[m] || (mp[m] = { base: new Array(12).fill(0), ent: new Array(12).fill(0) });
    for (let i = 0; i < 12; i++) { o.base[i] += v[mesure][i]; if (ent === null || nom === ent) o.ent[i] += v[mesure][i]; }
  }
  const classees = ents.map(([n, e]) => [n, e[mesure]]).filter(([, v]) => Math.abs(v) > 1e-9).sort((a, b) => b[1] - a[1]);
  const total = classees.reduce((s, [, v]) => s + v, 0);
  return { ents: classees, total, mp, nbMp: Object.keys(mp).filter((m) => mp[m].base.some((x) => x !== 0)).length };
}
const lireRep = (page) => page.evaluate(() => {
  const q = (s) => document.querySelector(s), all = (s) => [...document.querySelectorAll(s)], txt = (el) => (el ? el.innerText : "");
  const bloc = q('[data-rep="bloc"]');
  const ligne = (tr) => ({ cle: tr.dataset.repLigne, kind: tr.dataset.kind, total: Number(tr.querySelector("td[data-total]").dataset.v), totalTexte: tr.querySelector("td[data-total]").innerText, mois: [...tr.querySelectorAll("td[data-mois]")].map((td) => Number(td.dataset.v)), moisTexte: [...tr.querySelectorAll("td[data-mois]")].map((td) => td.innerText), ordre: [...tr.children].map((c) => (c.tagName === "TH" ? "nom" : c.dataset.total ? "total" : c.dataset.mois ? "mois" : "mix")), mix: (tr.querySelector('[role="img"]') || { getAttribute: () => "" }).getAttribute("aria-label") });
  return {
    present: Boolean(bloc), lentille: bloc && bloc.dataset.lentille, mesure: bloc && bloc.dataset.mesure, an: bloc && Number(bloc.dataset.an),
    total: txt(q('[data-rep="total"]')), valeur: Number((q('[data-rep="total"]') || { dataset: {} }).dataset.valeur),
    classement: all('[data-rep="classement"] [data-rep-ligne]').map((r) => ({ nom: r.dataset.repLigne, v: Number(r.dataset.valeur), actif: r.getAttribute("aria-pressed") === "true", texte: r.innerText })),
    classementTotal: txt(q('[data-rep="classement-total"]')),
    grille: all('[data-rep="grille-mp"] tr[data-rep-ligne]').map(ligne), grilleEntites: all('[data-rep="grille-entites"] tr[data-rep-ligne]').map(ligne),
    entetes: all('[data-rep="grille-mp"] thead th').map((th) => th.innerText),
    notes: { qte: Boolean(q('[data-rep="note-qte"]')), site: Boolean(q('[data-rep="note-site"]')), enCours: Boolean(q('[data-rep="note-en-cours"]')) },
    filtreMp: txt(q('[data-rep="filtre-mp"]')), filtreMpBouton: Boolean(q('button[data-rep="filtre-mp"]')), filtreEntite: txt(q('[data-rep="filtre-entite"]')),
    legende: txt(q('[data-rep="legende"]')), barres: all('[data-rep="graphique"] .recharts-bar-rectangle').length,
    couleursGraphique: [...new Set(all('[data-rep="graphique"] .recharts-bar-rectangle path, [data-rep="graphique"] .recharts-bar-rectangle rect').map((p) => (p.getAttribute("fill") || "").toUpperCase()))],
    qteDesactive: Boolean(q('[data-rep="mesure"] button[data-k="qte"][disabled]')), horsFrance: Boolean(q('[data-rep="hors-france"]')), horsFranceActif: (q('[data-rep="hors-france"]') || { getAttribute: () => null }).getAttribute("aria-pressed") === "true",
    texte: document.body.innerText,
    defilement: (() => { const el = q('[data-rep="grille-mp"]'); return el ? { sw: el.scrollWidth, cw: el.clientWidth, ox: getComputedStyle(el).overflowX } : null; })(),
    debordement: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  };
});
const repCliquer = async (page, sel) => { await page.locator(sel).first().click(); await page.waitForTimeout(380); };
const repPctApp = (x) => (x > 0 && x < 0.005 ? "< 1 %" : `${Math.round(x * 100)} %`);
const repCelluleApp = (v, qte) => { // cellule du tableau : « 1,23 M », « 123 k », « 4,5 k », entier en quantités, « — » sans vente
  if (!(Math.abs(v) >= 0.5)) return "—";
  if (qte) return fmtNum(v);
  const a = Math.abs(v);
  return a >= 1e6 ? `${(v / 1e6).toFixed(2).replace(".", ",")} M` : a >= 1e4 ? `${Math.round(v / 1e3)} k` : a >= 1e3 ? `${(v / 1e3).toFixed(1).replace(".", ",")} k` : String(Math.round(v));
};
const repClassementOk = (classement, ents, tol = 0.02) => classement.length === ents.length && classement.every((c, i) => proche(c.v, ents[i][1], tol) && ents.some(([n, v]) => n === c.nom && proche(c.v, v, tol)));
const repMpLib = (mp) => (mp === "Site Web" ? "Site web" : mp === "Autre" ? "Autres" : mp);
async function ouvrirRep(page, base, { lang = "fr", marketplace, tab = "marques", sousTab = "repartitions" } = {}) {
  const q = new URLSearchParams({ lang, tab, sousTab });
  if (marketplace) q.set("marketplace", marketplace);
  await page.goto(`${base}?${q}`, { waitUntil: "load" });
  if (sousTab === "repartitions") await page.waitForSelector('[data-rep="bloc"]', { timeout: 30000 });
  else await page.waitForFunction(() => document.body && document.body.innerText.length > 400, null, { timeout: 30000 });
  await page.waitForTimeout(1500);
}
// le détail par marketplace retombe, case par case, sur les chiffres attendus
function repVerifierGrille(etiquette, S, X, an, dim, mesure, opts = {}) {
  const A = repAgg(X, an, dim, mesure, opts), qte = mesure === "qte", part = Boolean(opts.part);
  const lignes = S.grille.filter((l) => l.kind === "ligne"), sous = S.grille.find((l) => l.cle === "__sous"), total = S.grille.find((l) => l.cle === "__total");
  const attendues = Object.keys(A.mp).filter((m) => A.mp[m].base.some((x) => x !== 0));
  verifier(lignes.length === attendues.length && attendues.every((m) => lignes.some((l) => l.cle === m)), `${etiquette} : lignes de marketplaces ${lignes.map((l) => l.cle).join(",")} ≠ ${attendues.join(",")}`);
  const verifLigne = (l, ent, base, nom) => {
    const t = ent.reduce((s, x) => s + x, 0), b = base.reduce((s, x) => s + x, 0);
    verifier(proche(l.total, t, 0.02), `${etiquette} : ${nom} total ${l.total} ≠ ${t.toFixed(2)}`);
    verifier(l.mois.length === 12 && l.mois.every((v, i) => proche(v, ent[i], 0.02)), `${etiquette} : ${nom} mois ≠ attendus`);
    const fmt = (v, bs) => (part ? (bs > 0 && v > 0 ? repPctApp(v / bs) : "—") : repCelluleApp(v, qte));
    verifier(norm(l.totalTexte) === norm(fmt(t, b)), `${etiquette} : ${nom} total affiché « ${norm(l.totalTexte)} » ≠ « ${fmt(t, b)} »`);
    verifier(l.moisTexte.every((x, i) => norm(x) === norm(fmt(ent[i], base[i]))), `${etiquette} : ${nom} cases affichées ≠ attendues (${l.moisTexte.map(norm).slice(0, 4).join("|")} vs ${[0, 1, 2, 3].map((i) => fmt(ent[i], base[i])).join("|")})`);
  };
  for (const l of lignes) verifLigne(l, A.mp[l.cle].ent, A.mp[l.cle].base, l.cle);
  const hors = attendues.filter((m) => m !== "Site Web"), somme = (ms, k) => Array.from({ length: 12 }, (_, i) => ms.reduce((s, m) => s + A.mp[m][k][i], 0));
  if (attendues.includes("Site Web") && hors.length) {
    verifier(Boolean(sous), `${etiquette} : sous-total marketplaces absent`);
    if (sous) verifLigne(sous, somme(hors, "ent"), somme(hors, "base"), "sous-total marketplaces");
  } else verifier(!sous, `${etiquette} : sous-total affiché sans site web`);
  verifier(Boolean(total), `${etiquette} : ligne Total absente`);
  if (total) verifLigne(total, somme(attendues, "ent"), somme(attendues, "base"), "total");
  // le site web est isolé sous le sous-total ; l'ordre des marketplaces suit leur total décroissant
  verifier(lignes.every((l, i, a) => i === 0 || a[i - 1].cle === "Site Web" || l.cle === "Site Web" || A.mp[a[i - 1].cle].base.reduce((s, x) => s + x, 0) >= A.mp[l.cle].base.reduce((s, x) => s + x, 0) - 1e-6), `${etiquette} : marketplaces non classées par total décroissant`);
  return A;
}
async function verifierRepartitions(browser, base, E) {
  const X = repAttendu(E);
  const dmax = E.rap.dmax, AN = Number(dmax.slice(0, 4));
  // quantités par pays : disponibles pour une année seulement si TOUTES les lignes « pays » de l'extraction en portent une (jamais estimées)
  const qtePays = (y) => { const l = E.ext.pays_jour.filter((r) => +r[0].slice(0, 4) === y && r[0] <= dmax); return l.length > 0 && l.every((r) => typeof r[4] === "number" && Number.isFinite(r[4])); };
  const QP = qtePays(AN), Q25 = qtePays(AN - 1);
  // pays : arrondis indépendants de ceux des produits (même tolérance que selftest.mjs)
  const tolPays = (y) => 0.02 * Math.sqrt(E.ext.lignes.filter((l) => +l[0].slice(0, 4) === y && l[0] <= dmax).length) + 1;
  const partiel = Number(dmax.slice(8)) < new Date(Date.UTC(AN, Number(dmax.slice(5, 7)), 0)).getUTCDate(); // le mois du dernier jour de données est incomplet
  const MOIS_FR = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
  const enteteMoisEnCours = new RegExp(`${MOIS_FR[Number(dmax.slice(5, 7)) - 1].replace(".", "\\.")}\\s*•`);
  const marquesFixes = { Bestherm: "#F75212", "HOM'Y": "#8B5CF6", Thomson: "#D50032" }; // couleurs fixes des marques (ordre d'empilement : Bestherm · HOM'Y · Thomson)
  const marquesAn = repAgg(X, AN, "marque", "ca").ents;
  const MS = marquesAn.some(([n]) => n === "Thomson") ? "Thomson" : marquesAn[marquesAn.length - 1][0]; // marque retenue dans le classement
  const nbPays = repAgg(X, AN, "pays", "ca").ents.length;
  // ===== bureau, français =====
  {
    const { ctx, page, erreurs } = await ouvrir(browser, { largeur: 1280, hauteur: 1000 });
    await ouvrirRep(page, base);
    let S = await lireRep(page);
    verifier(S.present && S.lentille === "pays" && S.mesure === "ca" && S.an === AN, `Répartitions : état initial ${S.lentille}/${S.mesure}/${S.an} au lieu de pays/ca/${AN}`);
    verifier(contient(S.texte, "Répartitions") && /Pays/.test(S.texte), "Répartitions : onglet ou découpage « Pays » absent");
    // 1) pays, CA 2026 : total, classement, légende, détail par marketplace, notes
    let A = repAgg(X, AN, "pays", "ca");
    verifier(proche(S.valeur, A.total, 0.02) && norm(S.total) === `${fmtNum(A.total)} €`, `Répartitions pays : total « ${norm(S.total)} » ≠ « ${fmtNum(A.total)} € »`);
    verifier(proche(A.total, E.cumul, tolPays(AN)), `Répartitions pays : total ${A.total.toFixed(2)} ≠ KPI ${E.cumul}`);
    verifier(repClassementOk(S.classement, A.ents), `Répartitions pays : classement ${S.classement.slice(0, 3).map((c) => c.nom).join(",")}… ≠ attendu ${A.ents.slice(0, 3).map((c) => c[0]).join(",")}…`);
    verifier(S.classement[0].nom === "France" && S.classement.every((c, i, a) => i === 0 || a[i - 1].v >= c.v), "Répartitions pays : France doit être en tête, classement décroissant");
    verifier(contient(S.classementTotal, fmtNum(A.total)) && (!QP || contient(S.classementTotal, fmtNum(repAgg(X, AN, "pays", "qte").total))) && contient(S.classementTotal, "100 %"), `Répartitions pays : ligne Total du classement « ${norm(S.classementTotal)} »`);
    verifier(S.classement.slice(0, 3).every((c) => contient(c.texte, fmtNum(c.v)) && (!QP || contient(c.texte, fmtNum(X.R[AN].pays[c.nom].qte)))), "Répartitions pays : classement sans CA ou quantités par pays");
    verifier(contient(S.legende, "France") && contient(S.legende, "Belgique") && (A.ents.length <= 6 || contient(S.legende, `Autres (${A.ents.length - 6})`)), `Répartitions pays : légende « ${norm(S.legende)} »`);
    verifier(S.barres >= 12 && S.couleursGraphique.includes("#F75212"), `Répartitions pays : graphique vide (${S.barres} barres, couleurs ${S.couleursGraphique.join(",")})`);
    verifier(S.notes.enCours === partiel && !S.notes.qte && !S.notes.site, `Répartitions pays : notes ${JSON.stringify(S.notes)} (mois en cours ${partiel ? "oui" : "non"}, quantités non, site 2025 non)`);
    verifier(partiel ? S.entetes.some((h) => enteteMoisEnCours.test(h)) : !S.entetes.some((h) => /•/.test(h)), `Répartitions pays : mois en cours ${partiel ? "non marqué" : "marqué à tort"} (${S.entetes.join("|")})`);
    verifier(S.qteDesactive === !QP && S.horsFrance, `Répartitions pays : bouton « Quantités » ${S.qteDesactive ? "désactivé" : "actif"} (extraction avec quantités par pays en ${AN} : ${QP}) ou « Hors France » absent`);
    repVerifierGrille("Répartitions pays 2026 CA", S, X, AN, "pays", "ca");
    verifier(S.grille.every((l) => l.mix) && /France/.test(S.grille.find((l) => l.cle === "Leroy Merlin").mix) && /France/.test(S.grille.find((l) => l.cle === "__total").mix), `Répartitions pays : barre de répartition absente ou sans France (${S.grille.filter((l) => !l.mix).map((l) => l.cle).join(",")})`);
    if (shotsDir) { fs.mkdirSync(shotsDir, { recursive: true }); await page.locator('[data-rep="bloc"]').screenshot({ path: path.join(shotsDir, "repartitions-pays.png") }); }
    // 2) bulle du graphique : mois, total, part de chaque pays
    await page.locator('[data-rep="graphique"]').scrollIntoViewIfNeeded();
    const pos = await page.evaluate(() => { const t = [...document.querySelectorAll('[data-rep="graphique"] .recharts-xAxis .recharts-cartesian-axis-tick')][2], g = document.querySelector('[data-rep="graphique"]'); if (!t || !g) return null; const a = t.getBoundingClientRect(), b = g.getBoundingClientRect(); return { x: a.left + a.width / 2, y: b.top + b.height * 0.4 }; });
    if (verifier(Boolean(pos), "Répartitions pays : axe des mois introuvable")) {
      await page.mouse.move(pos.x, pos.y); await page.waitForTimeout(500);
      const bulle = norm(await page.evaluate(() => { const el = document.querySelector('[data-rep="graphique"] .recharts-tooltip-wrapper'); return el ? el.innerText : ""; }));
      const mars = Object.values(X.R[AN].pays).reduce((s, e) => s + Object.values(e.mp).reduce((t, m) => t + m.ca[2], 0), 0);
      verifier(contient(bulle, `mars ${AN}`) && contient(bulle, `${fmtNum(mars)} €`) && contient(bulle, "France") && /\d+ %/.test(bulle), `Répartitions pays : bulle de mars « ${bulle.slice(0, 160)} » (attendu ${fmtNum(mars)} €)`);
      await page.mouse.move(2, 2);
    }
    // 3) quantités par pays 2026 : seulement si l'extraction en porte pour toute l'année, sinon le bouton « Quantités » est désactivé
    if (QP) {
      await repCliquer(page, '[data-rep="mesure"] button[data-k="qte"]');
      S = await lireRep(page); A = repAgg(X, AN, "pays", "qte");
      verifier(S.mesure === "qte" && proche(S.valeur, A.total, 0.001) && norm(S.total) === `${fmtNum(A.total)} u.`, `Répartitions pays (quantités) : total « ${norm(S.total)} » ≠ « ${fmtNum(A.total)} u. »`);
      verifier(A.total === E.qte && repClassementOk(S.classement, A.ents, 0.001), `Répartitions pays (quantités) : classement ≠ attendu (total ${A.total} / KPI ${E.qte})`);
      repVerifierGrille("Répartitions pays 2026 quantités", S, X, AN, "pays", "qte");
    } else {
      verifier(S.qteDesactive && (await page.locator('[data-rep="mesure"] button[data-k="qte"]:not([disabled])').count()) === 0, "Répartitions pays : sans quantités par pays, le bouton « Quantités » devrait être désactivé");
    }
    // 4) hors France : le total, le classement, la légende et le détail retombent sur « tous pays − France »
    await repCliquer(page, '[data-rep="hors-france"]');
    S = await lireRep(page);
    if (QP) {
      const tousQ = repAgg(X, AN, "pays", "qte");
      A = repAgg(X, AN, "pays", "qte", { exclure: ["France"] });
      verifier(S.horsFranceActif && proche(A.total, tousQ.total - X.R[AN].pays.France.qte, 0.001) && proche(S.valeur, A.total, 0.001) && S.classement.every((c) => c.nom !== "France") && !contient(S.legende, "France"), `Répartitions hors France (quantités) : total ${S.valeur} ≠ ${A.total}`);
      repVerifierGrille("Répartitions hors France quantités", S, X, AN, "pays", "qte", { exclure: ["France"] });
      await repCliquer(page, '[data-rep="mesure"] button[data-k="ca"]');
      S = await lireRep(page);
    }
    A = repAgg(X, AN, "pays", "ca", { exclure: ["France"] });
    verifier(S.horsFranceActif && proche(S.valeur, A.total, 0.02) && S.classement.length === A.ents.length && contient(S.texte, "Hors France") && S.classement.every((c) => c.nom !== "France"), `Répartitions hors France (CA) : total ${S.valeur} ≠ ${A.total.toFixed(2)}`);
    repVerifierGrille("Répartitions hors France CA", S, X, AN, "pays", "ca", { exclure: ["France"] });
    await repCliquer(page, '[data-rep="hors-france"]');
    S = await lireRep(page);
    verifier(!S.horsFranceActif && S.classement[0].nom === "France", "Répartitions : « Hors France » ne se désactive pas");
    // 5) 2025 : quantités par pays seulement si l'extraction en porte pour toute l'année ; sinon repli sur le CA annoncé (jamais d'estimation) ; site web 2025 signalé partiel
    if (QP) await repCliquer(page, '[data-rep="mesure"] button[data-k="qte"]'); // « Quantités » choisies avant de changer d'année
    await repCliquer(page, '[data-rep="annee"] button[data-k="2025"]');
    S = await lireRep(page);
    if (Q25) {
      A = repAgg(X, 2025, "pays", "qte");
      if (S.mesure !== "qte") { await repCliquer(page, '[data-rep="mesure"] button[data-k="qte"]'); S = await lireRep(page); }
      verifier(S.an === 2025 && S.mesure === "qte" && !S.qteDesactive && !S.notes.qte && proche(S.valeur, A.total, 0.001) && repClassementOk(S.classement, A.ents, 0.001), `Répartitions pays 2025 (quantités) : ${S.mesure}, total ${S.valeur} ≠ ${A.total}, notes ${JSON.stringify(S.notes)}`);
      repVerifierGrille("Répartitions pays 2025 quantités", S, X, 2025, "pays", "qte");
      await repCliquer(page, '[data-rep="mesure"] button[data-k="ca"]');
      S = await lireRep(page);
    }
    A = repAgg(X, 2025, "pays", "ca");
    verifier(S.an === 2025 && S.mesure === "ca" && S.qteDesactive === !Q25 && S.notes.qte === (QP && !Q25) && S.notes.site && !S.notes.enCours, `Répartitions pays 2025 : ${S.mesure}, quantités désactivées ${S.qteDesactive} (attendu ${!Q25}), notes ${JSON.stringify(S.notes)}`);
    verifier(proche(S.valeur, A.total, 0.02) && S.classement.every((c) => proche(c.v, X.R[2025].pays[c.nom].ca, 0.02)) && (Q25 || S.classement.every((c) => /—/.test(c.texte))), "Répartitions pays 2025 : CA ou quantités « — » inattendus");
    verifier(contient(S.texte, "Site web 2025 : ses ventes ne commencent qu'en mai 2025") && (!(QP && !Q25) || contient(S.texte, "Quantités indisponibles")), "Répartitions pays 2025 : explications absentes");
    verifier(proche(A.total, X.C.DATA.monthly_total[2025].reduce((s, v) => s + v, 0), tolPays(2025)), `Répartitions pays 2025 : total ${A.total.toFixed(2)} ≠ courbe mensuelle 2025`);
    repVerifierGrille("Répartitions pays 2025 CA", S, X, 2025, "pays", "ca");
    // 6) marque : Bestherm · HOM'Y · Thomson, couleurs fixes, quantités 2025 présentes
    await repCliquer(page, '[data-rep="lentille"] button[data-k="marque"]');
    S = await lireRep(page); A = repAgg(X, 2025, "marque", "qte");
    verifier(S.lentille === "marque" && !S.qteDesactive, `Répartitions marque 2025 : découpage ${S.lentille}, quantités désactivées ${S.qteDesactive}`);
    if (QP && !Q25) verifier(S.mesure === "qte", `Répartitions marque 2025 : le choix « Quantités » n'est pas retrouvé (${S.mesure})`); // le choix est mémorisé quand le découpage précédent n'avait que le CA
    if (S.mesure !== "qte") { await repCliquer(page, '[data-rep="mesure"] button[data-k="qte"]'); S = await lireRep(page); }
    verifier(S.mesure === "qte" && !S.notes.qte && A.total === QTE_2025(X) && proche(S.valeur, A.total, 0.001), `Répartitions marque 2025 : quantités ${S.valeur} (attendu ${A.total})`);
    await repCliquer(page, '[data-rep="annee"] button[data-k="2026"]');
    await repCliquer(page, '[data-rep="mesure"] button[data-k="ca"]');
    S = await lireRep(page); A = repAgg(X, AN, "marque", "ca");
    const D = X.C.DATA, somme = (a) => a.reduce((s, v) => s + v, 0);
    verifier(S.classement.map((c) => c.nom).join("|") === A.ents.map(([n]) => n).join("|") && S.classement.every((c) => proche(c.v, somme(D.monthly_by_brand[c.nom][AN] || []), 0.5)), `Répartitions marque : classement ${S.classement.map((c) => `${c.nom} ${c.v}`).join(" ; ")} ≠ monthly_by_brand`);
    const presentes = ["Bestherm", "HOM'Y", "Thomson"].filter((n) => A.ents.some(([x]) => x === n)), posLegende = presentes.map((n) => S.legende.indexOf(n));
    verifier(presentes.includes("Bestherm") && presentes.includes("Thomson") && posLegende.every((p, i) => p >= 0 && (i === 0 || posLegende[i - 1] < p)), `Répartitions marque : ordre de la légende « ${norm(S.legende)} » (Bestherm, HOM'Y, Thomson attendus)`);
    verifier(presentes.every((n) => S.couleursGraphique.includes(marquesFixes[n])), `Répartitions marque : couleurs du graphique ${S.couleursGraphique.join(",")} (Bestherm #F75212, Thomson #D50032, HOM'Y #8B5CF6)`);
    verifier(!S.horsFrance, "Répartitions marque : « Hors France » ne concerne que le découpage par pays");
    repVerifierGrille("Répartitions marque 2026 CA", S, X, AN, "marque", "ca");
    // 7) entité choisie (Thomson) : détail par marketplace de la marque, puis sa part dans chaque case
    await repCliquer(page, `[data-rep="classement"] [data-rep-ligne="${MS}"]`);
    S = await lireRep(page);
    verifier(contient(S.filtreEntite, MS) && S.classement.find((c) => c.nom === MS).actif, `Répartitions marque : ${MS} non retenu`);
    repVerifierGrille(`Répartitions marque ${MS} (montant)`, S, X, AN, "marque", "ca", { ent: MS });
    await repCliquer(page, '[data-rep="mode"] button[data-k="part"]');
    S = await lireRep(page);
    repVerifierGrille(`Répartitions marque ${MS} (part)`, S, X, AN, "marque", "ca", { ent: MS, part: true });
    const th = repAgg(X, AN, "marque", "ca").ents.find(([n]) => n === MS)[1], tot = repAgg(X, AN, "marque", "ca").total;
    verifier(norm(S.grille.find((l) => l.cle === "__total").totalTexte) === repPctApp(th / tot), `Répartitions marque : part de ${MS} ${norm(S.grille.find((l) => l.cle === "__total").totalTexte)} ≠ ${repPctApp(th / tot)}`);
    await repCliquer(page, '[data-rep="filtre-entite"]');
    S = await lireRep(page);
    verifier(!S.filtreEntite && S.classement.every((c) => !c.actif), `Répartitions marque : le filtre « ${MS} » ne se retire pas`);
    // 8) type de produit : catégories (comme category_by_mp), puis sous-catégories
    await repCliquer(page, '[data-rep="lentille"] button[data-k="type"]');
    S = await lireRep(page); A = repAgg(X, AN, "categorie", "ca");
    verifier(S.lentille === "type" && repClassementOk(S.classement, A.ents), `Répartitions type de produit : ${S.classement.map((c) => c.nom).join(",")}`);
    verifier(D.category_by_mp.categories.Toutes.every((c) => proche((S.classement.find((x) => x.nom === c.nom) || { v: NaN }).v, c.ca, 0.5)), "Répartitions type de produit : catégories ≠ category_by_mp");
    repVerifierGrille("Répartitions catégorie 2026 CA", S, X, AN, "categorie", "ca");
    await repCliquer(page, '[data-rep="niveau"] button[data-k="sous"]');
    S = await lireRep(page); A = repAgg(X, AN, "sous", "ca");
    verifier(S.classement.length === A.ents.length && proche(S.valeur, A.total, 0.02) && (A.ents.length <= 6 || contient(S.legende, `Autres (${A.ents.length - 6})`)), `Répartitions sous-catégories : ${S.classement.length} lignes ≠ ${A.ents.length}`);
    repVerifierGrille("Répartitions sous-catégorie 2026 CA", S, X, AN, "sous", "ca");
    // 9) marketplace choisie dans le détail : le graphique et le classement suivent ; un second clic la retire
    const lm = "Leroy Merlin";
    await repCliquer(page, `[data-rep="grille-mp"] tr[data-rep-ligne="${lm}"] th button`);
    S = await lireRep(page);
    const mpA = (() => { const o = { total: 0, ents: [] }; for (const [n, e] of Object.entries(X.R[AN].sous)) { const v = e.mp[lm] ? e.mp[lm].ca.reduce((s, x) => s + x, 0) : 0; if (v) o.ents.push([n, v]); o.total += v; } o.ents.sort((a, b) => b[1] - a[1]); return o; })();
    verifier(contient(S.filtreMp, lm) && S.filtreMpBouton && proche(S.valeur, mpA.total, 0.02) && repClassementOk(S.classement, mpA.ents), `Répartitions : filtre ${lm} — total ${S.valeur} ≠ ${mpA.total.toFixed(2)}`);
    await repCliquer(page, 'button[data-rep="filtre-mp"]');
    S = await lireRep(page);
    verifier(!S.filtreMp && proche(S.valeur, A.total, 0.02), "Répartitions : le filtre marketplace ne se retire pas");
    // 10) vue tableau du graphique : toutes les entités × 12 mois + total
    await repCliquer(page, '[data-rep="affichage"] button[data-k="tableau"]');
    S = await lireRep(page);
    verifier(S.grilleEntites.length === A.ents.length + 1 && S.barres === 0, `Répartitions : vue tableau ${S.grilleEntites.length} lignes ≠ ${A.ents.length + 1}`);
    verifier(S.grilleEntites.filter((l) => l.kind === "ligne").every((l) => { const e = X.R[AN].sous[l.cle]; return e && proche(l.total, e.ca, 0.02) && l.mois.every((v, i) => proche(v, Object.values(e.mp).reduce((s, m) => s + m.ca[i], 0), 0.02)); }) && proche(S.grilleEntites[S.grilleEntites.length - 1].total, A.total, 0.02), "Répartitions : vue tableau ≠ chiffres attendus");
    await repCliquer(page, '[data-rep="affichage"] button[data-k="graphique"]');
    // 11) parts : le graphique passe en 100 % (axe en %)
    await repCliquer(page, '[data-rep="empile"] button[data-k="parts"]');
    const axe = norm(await page.evaluate(() => { const el = document.querySelector('[data-rep="graphique"] .recharts-yAxis'); return el ? el.textContent : ""; }));
    verifier(/100 %/.test(axe) && /0 %/.test(axe), `Répartitions : axe des parts « ${axe} »`);
    verifier(erreurs.length === 0, `erreurs JavaScript (Répartitions bureau) : ${erreurs.slice(0, 3).join(" | ")}`);
    await ctx.close();
  }
  // ===== lien depuis l'onglet « Marque », filtre marketplace global verrouillé, adresse directe =====
  {
    const { ctx, page, erreurs } = await ouvrir(browser, { largeur: 1280, hauteur: 1000 });
    await ouvrirRep(page, base, { sousTab: "marque" });
    verifier(!(await page.locator('[data-rep="bloc"]').count()) && (await page.locator('[data-rep="lien-marque"]').count()) === 1, "Marque : lien vers le détail absent (ou Répartitions affiché sans clic)");
    await repCliquer(page, '[data-rep="lien-marque"]');
    await page.waitForSelector('[data-rep="bloc"]', { timeout: 10000 });
    let S = await lireRep(page);
    verifier(S.lentille === "marque" && S.classement.length === marquesAn.length, `Marque → Répartitions : découpage ${S.lentille}, ${S.classement.length} lignes (${marquesAn.length} attendues)`);
    // filtre marketplace global (adresse directe) : verrouillé, sans bouton pour le retirer
    await ouvrirRep(page, base, { marketplace: "Amazon FR" });
    S = await lireRep(page);
    const A = repAgg(X, AN, "pays", "ca");
    const amazon = Object.values(X.R[AN].pays).reduce((s, e) => s + (e.mp["Amazon FR"] ? e.mp["Amazon FR"].ca.reduce((t, x) => t + x, 0) : 0), 0);
    verifier(contient(S.filtreMp, "Amazon FR") && !S.filtreMpBouton && proche(S.valeur, amazon, 0.02) && amazon < A.total, `Répartitions (filtre global Amazon FR) : total ${S.valeur} ≠ ${amazon.toFixed(2)}`);
    verifier(erreurs.length === 0, `erreurs JavaScript (Répartitions, lien et filtre global) : ${erreurs.slice(0, 3).join(" | ")}`);
    await ctx.close();
  }
  // ===== quatre langues : onglet, découpages, noms de pays traduits, date du mois en cours, aucune variable de modèle =====
  const L = { fr: { tab: "Répartitions", pays: "Belgique", u: "Quantités", ca: "CA HT", autres: "Autres (" }, en: { tab: "Breakdowns", pays: "Belgium", u: "Units", ca: "Revenue excl. VAT", autres: "Other (" }, es: { tab: "Desgloses", pays: "Bélgica", u: "Unidades", ca: "Ventas sin IVA", autres: "Otros (" }, zh: { tab: "分布", pays: "比利时", u: "销量", ca: "销售额（不含税）", autres: "其他（" } };
  for (const [lang, w] of Object.entries(L)) {
    const { ctx, page, erreurs } = await ouvrir(browser, { largeur: 1280, hauteur: 1000 });
    await ouvrirRep(page, base, { lang });
    let S = await lireRep(page);
    verifier(contient(S.texte, w.tab) && contient(S.texte, w.pays) && contient(S.texte, w.u) && contient(S.texte, w.ca) && (nbPays <= 6 || contient(S.legende, w.autres)), `${lang.toUpperCase()} · Répartitions : libellés attendus absents (${w.tab}, ${w.pays}, ${w.u}, ${w.ca}, ${w.autres})`);
    verifier(!/\{(x|d|n|an)\}|undefined|NaN/.test(S.texte), `${lang.toUpperCase()} · Répartitions : variable de modèle, undefined ou NaN affiché`);
    const note = await page.evaluate(() => { const el = document.querySelector('[data-rep="note-en-cours"]'); return el ? el.innerText : ""; });
    verifier(partiel ? contient(note, jour(dmax, lang)) && !/\{d\}/.test(note) : note === "", `${lang.toUpperCase()} · Répartitions : note du mois en cours « ${norm(note)} » sans « ${jour(dmax, lang)} »`);
    verifier(S.grille.length > 10 && S.entetes.length >= 14, `${lang.toUpperCase()} · Répartitions : détail par marketplace incomplet`);
    if (lang !== "fr") { // l'anglais, l'espagnol et le chinois traduisent aussi les catégories et le sous-total
      await repCliquer(page, '[data-rep="lentille"] button[data-k="type"]');
      S = await lireRep(page);
      verifier(!/Radiateur électrique fixe/.test(S.classement.map((c) => c.texte).join(" ")), `${lang.toUpperCase()} · Répartitions : catégories non traduites (${S.classement[0].texte})`);
    }
    verifier(erreurs.length === 0, `erreurs JavaScript (Répartitions ${lang}) : ${erreurs.slice(0, 3).join(" | ")}`);
    await ctx.close();
  }
  // ===== mobile : pas de débordement, détail défilable, total collé au nom =====
  for (const largeur of [390, 360]) {
    const { ctx, page, erreurs } = await ouvrir(browser, { largeur, hauteur: 844 });
    await ouvrirRep(page, base);
    let S = await lireRep(page);
    verifier(S.debordement <= 1, `mobile ${largeur} px · Répartitions : débordement horizontal de ${S.debordement}px`);
    verifier(S.defilement && S.defilement.ox === "auto" && S.defilement.sw > S.defilement.cw, `mobile ${largeur} px · Répartitions : détail par marketplace non défilable (${JSON.stringify(S.defilement)})`);
    verifier(S.grille.length > 10 && S.grille.every((l) => l.ordre[0] === "nom" && l.ordre[1] === "total" && l.ordre[2] === "mois"), `mobile ${largeur} px · Répartitions : le total n'est pas collé au nom (${S.grille[0] && S.grille[0].ordre.slice(0, 3)})`);
    verifier(contient(S.legende, "France") && S.classement.length === nbPays, `mobile ${largeur} px · Répartitions : légende ou classement absents (${S.classement.length} pays au lieu de ${nbPays})`);
    await repCliquer(page, '[data-rep="lentille"] button[data-k="marque"]');
    await repCliquer(page, `[data-rep="classement"] [data-rep-ligne="${MS}"]`);
    S = await lireRep(page);
    verifier(S.debordement <= 1 && contient(S.filtreEntite, MS), `mobile ${largeur} px · Répartitions (marque, ${MS}) : débordement ${S.debordement}px ou filtre absent`);
    if (shotsDir && largeur === 390) await page.locator('[data-rep="bloc"]').screenshot({ path: path.join(shotsDir, "repartitions-mobile.png") });
    verifier(erreurs.length === 0, `erreurs JavaScript (Répartitions mobile ${largeur}) : ${erreurs.slice(0, 3).join(" | ")}`);
    await ctx.close();
  }
}
// ---- Navigation mobile (24 octobre 2026) : barre du haut et barre du bas figées à l'écran, filtres compacts, sous-onglets sur une ligne ----
const ONGLETS = ["apercu", "marketplaces", "marques", "prix", "ads", "concurrence", "data"];
// libellé complet (aria-label, repris des textes de l'application) et libellé court affiché sur l'onglet actif de la barre du bas
const NAV_LIBELLES = {
  fr: { long: ["Vue d'ensemble", "Marketplaces", "Marques & Produits", "Suivi Prix", "Campagnes Ads", "Concurrence", "Data"], court: ["Aperçu", "Marketplaces", "Marques", "Prix", "Ads", "Concurrence", "Data"], toutes: "Toutes" },
  en: { long: ["Overview", "Marketplaces", "Brands & Products", "Price Tracking", "Ad Campaigns", "Competition", "Data"], court: ["Overview", "Marketplaces", "Brands", "Prices", "Ads", "Competition", "Data"], toutes: "All" },
  es: { long: ["Resumen", "Marketplaces", "Marcas y Productos", "Seguimiento de Precios", "Campañas Ads", "Competencia", "Datos"], court: ["Resumen", "Marketplaces", "Marcas", "Precios", "Ads", "Competencia", "Datos"], toutes: "Todas" },
  zh: { long: ["总览", "电商平台", "品牌与产品", "价格追踪", "广告活动", "竞争分析", "数据"], court: ["总览", "平台", "品牌", "价格", "广告", "竞争", "数据"], toutes: "全部" },
};
const SEL_HAUT = '[data-barre="haut"]', SEL_BAS = '[data-barre="bas"]', SEL_MOBILE = '[data-barre="mobile"]';
const rectDe = (page, sel) => page.evaluate((s) => {
  const e = document.querySelector(s);
  if (!e) return null;
  const r = e.getBoundingClientRect(), cs = getComputedStyle(e);
  return { top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height), position: cs.position, display: cs.display, transform: cs.transform };
}, sel);
const attendreCond = async (page, cond, arg, ms = 3500) => { for (let i = 0; i < ms / 100; i++) { if (await page.evaluate(cond, arg)) return true; await page.waitForTimeout(100); } return false; };
const etatBarreBas = (page) => page.evaluate((sel) => {
  const bs = [...document.querySelector(sel).querySelectorAll("button")], act = bs.filter((x) => x.getAttribute("aria-current") === "page");
  return { n: act.length, idx: bs.indexOf(act[0]), texte: act[0] ? act[0].innerText.trim() : "", labels: bs.map((x) => x.getAttribute("aria-label")), sy: window.scrollY, debord: document.documentElement.scrollWidth - document.documentElement.clientWidth };
}, SEL_BAS);

async function verifierNavigation(browser, base) {
  // ===== téléphone, 390 et 360 px : barres figées, onglets, filtres, sous-onglets, saisie, mode démo =====
  for (const [largeur, hauteur] of [[390, 844], [360, 740]]) {
    const E = `mobile ${largeur} px · navigation`;
    const { ctx, page, erreurs } = await ouvrir(browser, { largeur, hauteur, tactile: true });
    await ouvrirDashboard(page, base);
    // 1) les deux barres sont collées à l'écran, avant comme après un long défilement ; le contenu garde l'essentiel de la hauteur
    let h = await rectDe(page, SEL_HAUT), b = await rectDe(page, SEL_BAS);
    verifier(h && h.position === "sticky" && h.top === 0 && h.h >= 50 && h.h <= 56, `${E} : barre du haut absente, non collée ou de hauteur inattendue (${JSON.stringify(h)})`);
    verifier(b && b.position === "fixed" && b.bottom === hauteur && b.h >= 54 && b.h <= 60, `${E} : barre du bas non fixée en bas de l'écran (${JSON.stringify(b)})`);
    verifier(h && b && hauteur - h.h - b.h >= hauteur * 0.8, `${E} : les barres laissent moins de 80 % de l'écran au contenu (${h && b && hauteur - h.h - b.h}px sur ${hauteur})`);
    await page.evaluate(() => window.scrollTo(0, 1500)); await page.waitForTimeout(400);
    h = await rectDe(page, SEL_HAUT); b = await rectDe(page, SEL_BAS);
    verifier((await page.evaluate(() => window.scrollY)) > 1000, `${E} : la page n'a pas défilé`);
    verifier(h.top === 0 && b.bottom === hauteur, `${E} : après défilement de 1 500 px les barres ont bougé (haut ${h.top}, bas ${b.bottom} / ${hauteur})`);
    if (shotsDir && largeur === 390) await page.screenshot({ path: path.join(shotsDir, "navigation-mobile.png") });
    // 2) les sept onglets : onglet actif unique avec son nom court, page remontée en haut, pas de débordement
    for (let i = 0; i < ONGLETS.length; i++) {
      await page.evaluate(() => window.scrollTo(0, 900)); await page.waitForTimeout(150);
      await page.locator(`${SEL_BAS} button`).nth(i).tap(); await page.waitForTimeout(450);
      await attendreCond(page, () => window.scrollY <= 5); // l'onglet actif (i = 0 au premier tour) remonte en défilement lissé
      const e = await etatBarreBas(page);
      verifier(e.n === 1 && e.idx === i && e.texte === NAV_LIBELLES.fr.court[i], `${E} : onglet ${ONGLETS[i]} — actif « ${e.texte} » (attendu « ${NAV_LIBELLES.fr.court[i]} »), ${e.n} actif(s)`);
      verifier(e.sy <= 5, `${E} : onglet ${ONGLETS[i]} ouvert à ${e.sy}px du haut au lieu du haut de page`);
      verifier(e.debord <= 1, `${E} : onglet ${ONGLETS[i]} — débordement horizontal de ${e.debord}px`);
    }
    // 3) appui sur l'onglet déjà actif : retour en haut de page
    await page.evaluate(() => window.scrollTo(0, 800)); await page.waitForTimeout(200);
    await page.locator(`${SEL_BAS} [aria-current="page"]`).tap();
    verifier(await attendreCond(page, () => window.scrollY < 5), `${E} : un appui sur l'onglet actif ne remonte pas en haut de page`);
    await ctx.close();
  }
  // ===== filtres de la barre du haut (période, marketplace, croix, dates personnalisées) =====
  for (const [largeur, hauteur] of [[390, 844], [360, 740]]) {
    const E = `mobile ${largeur} px · filtres`;
    const { ctx, page, erreurs } = await ouvrir(browser, { largeur, hauteur, tactile: true });
    await ouvrirDashboard(page, base);
    const puces = () => page.evaluate((sel) => [...document.querySelectorAll(`${sel} select`)].map((s) => ({ v: s.value, texte: s.parentElement.innerText.replace(/\s+/g, " ").trim().split(" ").slice(0, 4).join(" "), taille: getComputedStyle(s).fontSize })), SEL_MOBILE);
    let p = await puces();
    verifier(p.length === 2 && p[0].v === "annee_courante" && p[0].texte.startsWith("Année en cours") && p[1].v === "Toutes" && p[1].texte.startsWith("Toutes"), `${E} : puces initiales inattendues (${JSON.stringify(p)})`);
    verifier(p.every((x) => x.taille === "16px"), `${E} : sélecteurs en ${p.map((x) => x.taille)} (16 px attendus : en dessous, iOS zoome la page)`);
    await page.locator('[data-barre="periode"]').selectOption("mois_courant"); await page.waitForTimeout(600);
    p = await puces();
    verifier(p[0].v === "mois_courant" && p[0].texte.startsWith("Mois en cours"), `${E} : période « mois en cours » non appliquée (${p[0].texte})`);
    verifier(contient(await page.evaluate(() => document.body.innerText), "mois en cours"), `${E} : le contenu ne suit pas la période choisie`);
    await page.locator('[data-barre="marketplace"]').selectOption("Leroy Merlin"); await page.waitForTimeout(600);
    p = await puces();
    verifier(p[1].v === "Leroy Merlin" && p[1].texte.startsWith("Leroy Merlin"), `${E} : marketplace Leroy Merlin non appliquée (${JSON.stringify(p[1])})`);
    verifier(contient(await page.evaluate(() => document.body.innerText), "Leroy Merlin"), `${E} : le contenu ne suit pas la marketplace choisie`);
    verifier((await page.locator('[data-barre="effacer"]').count()) === 1, `${E} : croix de remise à zéro absente avec une marketplace choisie`);
    verifier(await page.evaluate((sel) => { const r = document.querySelector(sel).getBoundingClientRect(); return r.right <= innerWidth + 0.5 && r.left >= -0.5; }, SEL_MOBILE), `${E} : la barre du haut déborde de l'écran avec une marketplace choisie`);
    const lib = await page.evaluate((sel) => { const s = document.querySelector(`${sel} [data-barre="periode"]`).parentElement.querySelector("span.truncate"); return { vu: s.scrollWidth <= s.clientWidth + 1, texte: s.innerText }; }, SEL_MOBILE);
    if (largeur >= 390) verifier(lib.vu, `${E} : libellé de période tronqué avec une marketplace choisie (« ${lib.texte} »)`);
    if (shotsDir && largeur === 360) await page.screenshot({ path: path.join(shotsDir, "navigation-filtre-360.png") });
    await page.locator('[data-barre="effacer"]').tap(); await page.waitForTimeout(500);
    p = await puces();
    verifier(p[1].v === "Toutes" && (await page.locator('[data-barre="effacer"]').count()) === 0, `${E} : la croix ne remet pas « Toutes » (${JSON.stringify(p[1])})`);
    const h0 = (await rectDe(page, SEL_HAUT)).h;
    await page.locator('[data-barre="periode"]').selectOption("personnalise"); await page.waitForTimeout(500);
    const h1 = (await rectDe(page, SEL_HAUT)).h;
    verifier(h1 > h0 + 30 && (await page.locator('[data-barre="date-du"]').count()) === 1 && (await page.locator('[data-barre="date-au"]').count()) === 1, `${E} : dates personnalisées — barre de ${h0} à ${h1}px, champs de date absents`);
    verifier(await page.evaluate(() => ["date-du", "date-au"].every((k) => getComputedStyle(document.querySelector(`[data-barre="${k}"]`)).fontSize === "16px")), `${E} : champs de date en dessous de 16 px (zoom iOS)`);
    verifier(await page.evaluate((v) => getComputedStyle(document.documentElement).getPropertyValue("--barre-haut").trim() === v, `${h1}px`), `${E} : la variable --barre-haut n'est pas à jour (${h1}px attendus)`);
    verifier(await page.evaluate((sel) => { const r = document.querySelector(sel).getBoundingClientRect(); return document.querySelector(`${sel} [data-barre="date-au"]`).getBoundingClientRect().right <= innerWidth + 0.5 && r.right <= innerWidth + 0.5; }, SEL_MOBILE), `${E} : les champs de date débordent de l'écran`);
    verifier(erreurs.length === 0, `erreurs JavaScript (${E}) : ${erreurs.slice(0, 3).join(" | ")}`);
    await ctx.close();
  }
  // ===== sous-onglets (Marques, Concurrence) : une ligne qui défile, figés sous la barre du haut ; saisie ; mode démo ; Suivi Prix =====
  {
    const E = "mobile 390 px · sous-onglets";
    const { ctx, page, erreurs } = await ouvrir(browser, { largeur: 390, hauteur: 844, tactile: true });
    await ouvrirDashboard(page, base, { tab: "marques" });
    const ligne = await page.evaluate(() => { const g = document.querySelector('[data-barre="sous-onglets-defil"]'), bs = [...g.querySelectorAll("button")]; return { n: bs.length, lignes: new Set(bs.map((x) => Math.round(x.getBoundingClientRect().top))).size, sw: g.scrollWidth, cw: g.clientWidth }; });
    verifier(ligne.n === 6 && ligne.lignes === 1 && ligne.sw > ligne.cw, `${E} Marques : ${ligne.n} pastilles sur ${ligne.lignes} ligne(s), défilement ${ligne.sw}/${ligne.cw}`);
    const colle0 = await page.evaluate(() => document.querySelector('[data-barre="sous-onglets"]').classList.contains("est-colle"));
    verifier(!colle0, `${E} Marques : bande « collée » (fond et filet) alors que la page est en haut`);
    await page.evaluate(() => window.scrollTo(0, 700)); await page.waitForTimeout(500);
    let sb = await page.evaluate(() => ({ top: Math.round(document.querySelector('[data-barre="sous-onglets"]').getBoundingClientRect().top), bar: Math.round(document.querySelector('[data-barre="haut"]').getBoundingClientRect().bottom), colle: document.querySelector('[data-barre="sous-onglets"]').classList.contains("est-colle") }));
    verifier(sb.top === sb.bar && sb.colle, `${E} Marques : bande non figée sous la barre du haut (haut ${sb.top} / bas de barre ${sb.bar}, fond ${sb.colle})`);
    await page.locator('[data-barre="sous-onglets-defil"] button', { hasText: "Puissances" }).tap(); await page.waitForTimeout(900);
    const act = await page.evaluate(() => { const g = document.querySelector('[data-barre="sous-onglets-defil"]'), a = g.querySelector('[aria-pressed="true"]'), r = a.getBoundingClientRect(), gr = g.getBoundingClientRect(); return { texte: a.innerText, visible: r.left >= gr.left - 1 && r.right <= gr.right + 1 }; });
    verifier(act.texte === "Puissances" && act.visible, `${E} Marques : pastille active « ${act.texte} » non entièrement visible dans la bande`);
    verifier(contient(await page.evaluate(() => document.body.innerText), "Puissances"), `${E} Marques : la sous-vue Puissances ne s'affiche pas`);
    // Concurrence : la bande est plus bas dans la page, elle se fige à son tour
    await ouvrirDashboard(page, base, { tab: "concurrence" });
    const yBande = await page.evaluate(() => document.querySelector('[data-barre="sous-onglets"]').getBoundingClientRect().top + window.scrollY);
    await page.evaluate((y) => window.scrollTo(0, y + 400), yBande); await page.waitForTimeout(500);
    sb = await page.evaluate(() => ({ top: Math.round(document.querySelector('[data-barre="sous-onglets"]').getBoundingClientRect().top), bar: Math.round(document.querySelector('[data-barre="haut"]').getBoundingClientRect().bottom), colle: document.querySelector('[data-barre="sous-onglets"]').classList.contains("est-colle") }));
    verifier(sb.top === sb.bar && sb.colle, `${E} Concurrence : bande non figée sous la barre du haut (haut ${sb.top} / bas de barre ${sb.bar}, fond ${sb.colle})`);
    // Suivi Prix : aucun champ ne prend le focus à l'ouverture (la page ne défile pas, le clavier ne s'ouvre pas)
    await ouvrirDashboard(page, base, { tab: "prix" });
    const prix = await page.evaluate(() => ({ actif: document.activeElement ? document.activeElement.tagName : "", sy: window.scrollY }));
    verifier(prix.actif !== "INPUT" && prix.sy <= 5, `${E} Suivi Prix : un champ prend le focus à l'ouverture (${prix.actif}, défilement ${prix.sy}px)`);
    // saisie : la barre du bas se retire pendant la saisie dans un champ de texte, revient ensuite
    await ouvrirDashboard(page, base, { tab: "data" });
    await page.locator("main input").first().focus(); await page.waitForTimeout(500);
    verifier((await rectDe(page, SEL_BAS)).transform !== "none", `${E} Data : la barre du bas reste affichée pendant la saisie`);
    await page.evaluate(() => document.activeElement.blur()); await page.waitForTimeout(500);
    verifier((await rectDe(page, SEL_BAS)).transform === "none", `${E} Data : la barre du bas ne revient pas après la saisie`);
    // mode démo : la bannière est dans le bloc figé, au-dessus de la barre ; les sous-onglets se calent sous l'ensemble
    await ouvrirDashboard(page, base, { tab: "marques" });
    await page.evaluate(() => window.scrollTo(0, 99999)); await page.waitForTimeout(300);
    await page.locator("footer button[aria-label]").first().click(); await page.waitForTimeout(500);
    const demo = await page.evaluate(() => { const w = document.querySelector('[data-barre="haut"]'), r = w.getBoundingClientRect(); return { top: Math.round(r.top), h: Math.round(r.height), banniere: /démo/i.test(w.innerText), v: getComputedStyle(document.documentElement).getPropertyValue("--barre-haut").trim() }; });
    verifier(demo.banniere && demo.top === 0 && demo.h > 70 && demo.v === `${demo.h}px`, `${E} : mode démo — bannière dans le bloc figé (${JSON.stringify(demo)})`);
    verifier(erreurs.length === 0, `erreurs JavaScript (${E}) : ${erreurs.slice(0, 3).join(" | ")}`);
    await ctx.close();
  }
  // ===== quatre langues : libellés complets (accessibilité), nom court de l'onglet actif, puce « Toutes » =====
  for (const lang of ["fr", "en", "es", "zh"]) {
    const E = `mobile 390 px · navigation ${lang.toUpperCase()}`;
    const { ctx, page, erreurs } = await ouvrir(browser, { largeur: 390, hauteur: 844, tactile: true });
    await ouvrirDashboard(page, base, { lang });
    let e = await etatBarreBas(page);
    verifier(JSON.stringify(e.labels) === JSON.stringify(NAV_LIBELLES[lang].long), `${E} : libellés des onglets ${JSON.stringify(e.labels)} ≠ ${JSON.stringify(NAV_LIBELLES[lang].long)}`);
    verifier(e.idx === 0 && e.texte === NAV_LIBELLES[lang].court[0], `${E} : onglet actif « ${e.texte} » (attendu « ${NAV_LIBELLES[lang].court[0]} »)`);
    for (const i of [1, 2, 5]) {
      await page.locator(`${SEL_BAS} button`).nth(i).tap(); await page.waitForTimeout(600);
      e = await etatBarreBas(page);
      verifier(e.idx === i && e.texte === NAV_LIBELLES[lang].court[i], `${E} : onglet ${ONGLETS[i]} — « ${e.texte} » (attendu « ${NAV_LIBELLES[lang].court[i]} »)`);
    }
    const toutes = await page.evaluate((sel) => document.querySelector(`${sel} [data-barre="marketplace"]`).parentElement.querySelector("span.truncate").innerText.trim(), SEL_MOBILE);
    verifier(toutes === NAV_LIBELLES[lang].toutes, `${E} : puce marketplace « ${toutes} » (attendu « ${NAV_LIBELLES[lang].toutes} »)`);
    const nav = norm(await page.evaluate((sel) => document.querySelector(sel).innerText, SEL_MOBILE));
    verifier(!PLACEHOLDERS.test(nav) && !/undefined|NaN/.test(nav), `${E} : variable de modèle ou « undefined » dans la barre (${nav})`);
    verifier(erreurs.length === 0, `erreurs JavaScript (${E}) : ${erreurs.slice(0, 3).join(" | ")}`);
    await ctx.close();
  }
  // ===== ordinateur et tablette (≥ 768 px) : disposition d'origine conservée, barres mobiles absentes =====
  for (const largeur of [1280, 820]) {
    const E = `ordinateur ${largeur} px · navigation`;
    const { ctx, page, erreurs } = await ouvrir(browser, { largeur, hauteur: 900 });
    await ouvrirDashboard(page, base, { tab: "marques" });
    const d = await page.evaluate(() => {
      const vu = (s) => { const el = document.querySelector(s); return !!el && getComputedStyle(el).display !== "none" && el.getBoundingClientRect().height > 0; };
      return {
        mobile: vu('[data-barre="mobile"]'), bas: vu('[data-barre="bas"]'), entete: vu("header"), boutons: document.querySelectorAll("header nav button").length,
        haut: getComputedStyle(document.querySelector('[data-barre="haut"]')).position, sous: getComputedStyle(document.querySelector('[data-barre="sous-onglets"]')).position,
        defil: getComputedStyle(document.querySelector('[data-barre="sous-onglets-defil"]')).flexWrap, debord: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        filtres: [...document.querySelectorAll("[data-barre='haut'] button")].filter((b) => b.offsetParent !== null && /Année en cours|Mois en cours/.test(b.innerText)).length,
      };
    });
    verifier(!d.mobile && !d.bas, `${E} : barre mobile (${d.mobile}) ou barre du bas (${d.bas}) affichée`);
    verifier(d.entete && d.boutons === 7 && d.filtres >= 2, `${E} : en-tête d'origine incomplet (${d.boutons} onglets, ${d.filtres} puces de période)`);
    verifier(d.haut === "static" && d.sous === "static" && d.defil === "wrap", `${E} : le bloc du haut ou les sous-onglets sont figés / non repliables (${d.haut}, ${d.sous}, ${d.defil}) — dès 768 px la disposition d'origine est conservée`);
    verifier(d.debord <= 1, `${E} : débordement horizontal de ${d.debord}px`);
    await ouvrirDashboard(page, base, { tab: "apercu" });
    await page.evaluate(() => window.scrollTo(0, 700)); await page.waitForTimeout(300);
    const sorti = await page.evaluate(() => ({ sy: window.scrollY, bas: document.querySelector("header").getBoundingClientRect().bottom }));
    verifier(sorti.sy < 200 || sorti.bas <= 0, `${E} : l'en-tête reste à l'écran après défilement (bas à ${sorti.bas}px) — il défilait avec la page jusqu'ici`);
    verifier(erreurs.length === 0, `erreurs JavaScript (${E}) : ${erreurs.slice(0, 3).join(" | ")}`);
    await ctx.close();
  }
}
const QTE_2025 = (X) => Object.values(X.R[2025].marque).reduce((s, e) => s + e.qte, 0);

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
    if (process.argv.includes("--repartitions")) { // mise au point : seul l'onglet Marques › Répartitions
      await verifierRepartitions(browser, base, E);
      if (echecs.length) { for (const e of echecs) console.log(`ÉCHEC · ${e}`); return 2; }
      console.log("SMOKE_REPARTITIONS_OK"); return 0;
    }
    if (process.argv.includes("--navigation")) { // mise au point : seule la navigation mobile (barres figées, filtres, sous-onglets)
      await verifierNavigation(browser, base);
      if (echecs.length) { for (const e of echecs) console.log(`ÉCHEC · ${e}`); return 2; }
      console.log("SMOKE_NAVIGATION_OK"); return 0;
    }
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
    await verifierRepartitions(browser, base, E);
    await verifierNavigation(browser, base);

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
  console.log(`SMOKE_OK · bloc « Données Shopify à jour » jusqu'au ${dmax} avec son suivi quotidien (période, jour touché avec choix même date / même jour de la semaine, même période l'an dernier, commandes et panier moyen, top 10 produits avec variation et écart en €, top 10 marketplaces, part du CA par pays, 4 langues, mobile avec onglets, trois volets sur ordinateur) et sa pastille de fraîcheur, sous-informations absentes, vues conservées (produits, % par pays, vs 2025), plan 2026 (objectif du jour pondéré par le profil des jours de la semaine, % du plan, courbe d'objectif du suivi et courbe mensuelle de la tendance, 4 langues ; ${COUVERTURE_PLAN}), chiffres = ${fmtNum(E.cumul)} € HT / ${fmtNum(E.qte)} unités / ${E.pct} % de l'objectif${E.yoy !== null ? ` / ${E.yoy.toFixed(1)} % vs 2025` : ""}, filtres marketplace, 7 onglets, navigation mobile (barres du haut et du bas figées, filtres compacts, sous-onglets sur une ligne, 4 langues, ordinateur inchangé), mobile, écran d'erreur`);
  return 0;
}

main().then((c) => process.exit(c), (e) => { console.error(e); process.exit(2); });
