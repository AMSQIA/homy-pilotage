#!/usr/bin/env node
/**
 * Actualisation de shopify_extension.json (racine du dépôt) : TOUTES les ventes du tableau de bord (2024 → hier) viennent
 * des deux boutiques Shopify. socle.js recalcule à partir de ce fichier chaque chiffre, courbe et tableau de l'application ;
 * aucun fichier Excel / ODP n'intervient.
 *
 * Deux boutiques, deux bases de calcul (détail dans scripts/extension/README.md) :
 *   marketplaces (BESTHERM, 46a3f9-2.myshopify.com) : CA HT = (ventes nettes + taxes) ÷ 1,2 ligne par ligne ;
 *       la marketplace de chaque commande est donnée par sa passerelle de paiement (jeu `payments`)
 *   site web (bestherm.fr, besthermshop.myshopify.com) : CA HT = ventes nettes (remises et retours déduits), marketplace « Site Web »
 *
 * Utilisation :
 *   node scripts/extension/refresh_extension.mjs check
 *   node scripts/extension/refresh_extension.mjs plan  [--today AAAA-MM-JJ] [--du AAAA-MM-JJ] [--reprendre N]
 *   node scripts/extension/refresh_extension.mjs apply [--today ..] [--du ..] [--au ..] [--reprendre N] [--boutique marketplaces|site]
 *                      [--transcript f.jsonl] [--results f.json] [--cache dossier] [--concurrence N] [--out fichier.json] [--dry-run] [--force]
 *   node scripts/extension/refresh_extension.mjs status
 *
 * Sources des résultats ShopifyQL (voir collecte.mjs) : le relais en lecture seule (api/mcp-site.mjs, variable MCP_SITE_KEY)
 * pour les deux boutiques ; à défaut de relais configuré pour BESTHERM, les résultats du connecteur Shopify de Claude, relus
 * tels quels dans la transcription de la session (lancer exactement les requêtes de « plan »).
 * Aucune donnée client : uniquement des agrégats (jour, commande, référence, pays, passerelle).
 *
 * Par défaut, la fenêtre va du dernier jour déjà extrait (repris, corrections tardives) à hier, heure de Paris ; sans fichier
 * valide, tout l'historique de chaque boutique est extrait (BESTHERM depuis 2024-01-01, site depuis 2025-05-01).
 *
 * Codes de sortie : 0 ok · 2 contrôle de cohérence échoué (rien n'est écrit) · 3 résultats manquants · 1 erreur d'utilisation.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SCHEMA, AN_DEFAUT, validerExtension, auExtension, construire } from "../../socle.js";
import { CFG, Echec, MP_SITE, addDays, r2, fenetres, requetesFenetre, controlerSortie, avertissementsDe, marqueDominante } from "./transformer.mjs";
import { BOUTIQUES, lireResultats, jeuxDepuisIndex, jeuxRelais, etatRelais, collecterBoutique } from "./collecte.mjs";

export { CFG, BOUTIQUES, Echec };
const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Racine du dépôt ; HOMY_RACINE désigne une copie (tests : jeu de données de développement, dossier temporaire)
export const RACINE = path.resolve(process.env.HOMY_RACINE || path.join(__dirname, "..", ".."));
const FICHIER = path.join(RACINE, "shopify_extension.json");
const REF = path.join(RACINE, "data", "referentiel.json");
const HORS = path.join(RACINE, "data", "hors_shopify.json");

/* ------------------------------------------------------------------ utilitaires */
const pct = (x) => (Math.abs(x) < 0.0005 ? "0.0 %" : `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)} %`);
const eur = (x) => new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(Math.round(x)) + " €";
const ISO = /^\d{4}-\d{2}-\d{2}$/;
export function parisToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const estSiteMp = (mp) => mp === MP_SITE;

function args(argv) {
  const o = { _: [], transcript: [], results: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--today") o.today = argv[++i];
    else if (a === "--du") o.du = argv[++i];
    else if (a === "--au") o.au = argv[++i];
    else if (a === "--reprendre") o.reprendre = Number(argv[++i]);
    else if (a === "--boutique") o.boutique = argv[++i];
    else if (a === "--transcript") o.transcript.push(argv[++i]);
    else if (a === "--results" || a === "--results-site") o.results.push(argv[++i]);
    else if (a === "--cache") o.cache = argv[++i];
    else if (a === "--concurrence") o.concurrence = Number(argv[++i]);
    else if (a === "--out") o.out = argv[++i];
    else if (a === "--dry-run") o.dry = true;
    else if (a === "--force") o.force = true;
    else if (a.startsWith("--")) throw new Echec(`Option inconnue : ${a}`, 1);
    else o._.push(a);
  }
  for (const k of ["today", "du", "au"]) if (o[k] && !ISO.test(o[k])) throw new Echec(`--${k} attend AAAA-MM-JJ`, 1);
  if (o.reprendre !== undefined && (!Number.isInteger(o.reprendre) || o.reprendre < 0 || o.reprendre > 31)) throw new Echec("--reprendre attend un entier entre 0 et 31", 1);
  if (o.concurrence !== undefined && (!Number.isInteger(o.concurrence) || o.concurrence < 1 || o.concurrence > 8)) throw new Echec("--concurrence attend un entier entre 1 et 8", 1);
  if (o.boutique !== undefined && !Object.hasOwn(BOUTIQUES, o.boutique)) throw new Echec(`--boutique attend ${Object.keys(BOUTIQUES).join(" ou ")}`, 1);
  return o;
}

/* ------------------------------------------------------------------ tables */
const lire = (f, nom) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { throw new Echec(`${nom} illisible ou absent (${path.relative(RACINE, f)})`, 1); } };

// Contrôle de structure de la table de référence : une table incohérente fausserait tout le tableau de bord
export function validerReferentiel(ref) {
  const e = [];
  if (!ref || typeof ref !== "object") return ["table de référence absente"];
  for (const k of ["skus", "produits", "passerelles", "objectifs_mp"]) if (!ref[k] || typeof ref[k] !== "object") e.push(`« ${k} » absent`);
  if (e.length) return e;
  if (!Number.isFinite(ref.objectif_annuel)) e.push("objectif_annuel absent");
  for (const [sku, nom] of Object.entries(ref.skus)) {
    if (sku !== sku.toUpperCase()) e.push(`SKU « ${sku} » : majuscules attendues`);
    if (!ref.produits[nom]) e.push(`SKU « ${sku} » : produit « ${nom} » absent de la table`);
  }
  for (const [t, nom] of Object.entries(ref.titres ?? {})) if (!ref.produits[nom]) e.push(`titre « ${t.slice(0, 40)} » : produit « ${nom} » absent de la table`);
  for (const [nom, p] of Object.entries(ref.produits)) {
    for (const k of ["marque", "famille", "sous_famille", "sous_sous_famille"]) if (typeof p[k] !== "string" && !(k !== "marque" && p[k] === null)) e.push(`produit « ${nom} » : « ${k} » illisible`);
    for (const k of ["wifi", "plinthe", "vertical", "destockage"]) if (typeof p[k] !== "boolean") e.push(`produit « ${nom} » : « ${k} » booléen attendu`);
  }
  return e.slice(0, 20);
}

export function lireTables() {
  const ref = lire(REF, "table de référence");
  const hors = lire(HORS, "chiffres hors Shopify");
  const e = validerReferentiel(ref);
  if (e.length) throw new Echec(`data/referentiel.json invalide : ${e.join(" ; ")}`, 1);
  let precedent = null;
  if (fs.existsSync(FICHIER)) precedent = lire(FICHIER, "shopify_extension.json");
  return { ref, hors, precedent };
}

/* ------------------------------------------------------------------ plan des requêtes */
// Fenêtre à extraire : du dernier jour déjà extrait (repris) jusqu'à hier. Sans extraction valide : tout l'historique.
export function fenetre(precedent, today, o = {}, boutique) {
  const au = o.au ?? addDays(today, -1);
  let du;
  if (o.du) du = o.du;
  else {
    const valide = precedent && validerExtension(precedent).ok;
    const prec = valide ? precedent.boutiques?.[boutique]?.au : null;
    du = prec ? addDays(prec, 1 - (o.reprendre ?? 1)) : BOUTIQUES[boutique].debut;
    if (du < BOUTIQUES[boutique].debut) du = BOUTIQUES[boutique].debut;
  }
  return { du, au, vide: du > au };
}

export function planifier(precedent, today, o = {}, boutique = "marketplaces") {
  const f = fenetre(precedent, today, o, boutique);
  const p = { boutique, today, ...f, queries: [] };
  if (p.vide) return p;
  for (const w of fenetres(f.du, f.au)) p.queries.push(...requetesFenetre(boutique, w, today));
  return p;
}

/* ------------------------------------------------------------------ fusion et écriture */
const ouvrir = () => ({ lignes: [], pays: [], commandes: [], paires: [], marques: new Map() });

export function decoder(ext) {
  const o = ouvrir();
  const nom = (i) => ext.produits[i][0];
  for (const [d, im, ip, qte, ca] of ext.lignes) o.lignes.push({ d, mp: ext.mp[im], produit: nom(ip), qte, ca });
  for (const [d, ic, im, ca, qte] of ext.pays_jour) o.pays.push({ d, pays: ext.pays[ic], mp: ext.mp[im], ca, qte: typeof qte === "number" ? qte : null }); // qte : absente des extractions antérieures
  for (const [d, im, n] of ext.commandes) o.commandes.push({ d, mp: ext.mp[im], n });
  for (const [d, ia, ib, n, s] of ext.paires) o.paires.push({ d, a: nom(ia), b: nom(ib), n, s: s ? 1 : 0 });
  for (const [n, m] of ext.produits) o.marques.set(n, m ?? null);
  return o;
}

// Fusionne les boutiques traitées avec le contenu précédent : pour chaque boutique, ses jours (re)extraits sont remplacés.
// `blocs` = { id: sortie agrégée de collecterBoutique }.
export function fusionner(precedent, blocs, today, an = AN_DEFAUT) {
  const ancien = precedent && validerExtension(precedent).ok ? decoder(precedent) : ouvrir();
  const boutiques = precedent && validerExtension(precedent).ok ? { ...(precedent.boutiques ?? {}) } : {};
  const dansFenetre = (d, b) => blocs[b] && d >= blocs[b].du && d <= blocs[b].au;
  const lignes = ancien.lignes.filter((l) => !dansFenetre(l.d, estSiteMp(l.mp) ? "site" : "marketplaces"));
  const pays = ancien.pays.filter((l) => !dansFenetre(l.d, estSiteMp(l.mp) ? "site" : "marketplaces"));
  const commandes = ancien.commandes.filter((l) => !dansFenetre(l.d, estSiteMp(l.mp) ? "site" : "marketplaces"));
  const paires = ancien.paires.filter((l) => !dansFenetre(l.d, l.s ? "site" : "marketplaces"));
  const marques = new Map(ancien.marques);
  for (const [id, s] of Object.entries(blocs)) {
    boutiques[id] = { au: s.au, nom: BOUTIQUES[id].nom, domaine: BOUTIQUES[id].domaine, extrait_a: new Date().toISOString() };
    lignes.push(...s.lignes); pays.push(...s.pays); commandes.push(...s.commandes);
    for (const x of s.paires) paires.push({ ...x, s: id === "site" ? 1 : 0 });
    for (const [n, m] of s.vendeurs) { const b = marqueDominante(m); if (b) marques.set(n, b); }
  }
  // conservation : détail pays et commandes depuis l'année précédente, paires de produits pour l'année en cours seulement
  const depuisN1 = `${an - 1}-01-01`, depuisAn = `${an}-01-01`;
  const paysK = pays.filter((x) => x.d >= depuisN1), cmdK = commandes.filter((x) => x.d >= depuisN1), pairesK = paires.filter((x) => x.d >= depuisAn);
  // dictionnaires
  const noms = [...new Set([...lignes.map((l) => l.produit), ...pairesK.flatMap((x) => [x.a, x.b])])].sort();
  const mp = [...new Set([...lignes.map((l) => l.mp), ...paysK.map((l) => l.mp), ...cmdK.map((l) => l.mp)])].sort();
  const paysNoms = [...new Set(paysK.map((l) => l.pays))].sort();
  const iMp = new Map(mp.map((x, i) => [x, i])), iPays = new Map(paysNoms.map((x, i) => [x, i])), iProd = new Map(noms.map((x, i) => [x, i]));
  const tri = (a, b) => cmp(a.d, b.d);
  lignes.sort((a, b) => tri(a, b) || cmp(a.mp, b.mp) || cmp(a.produit, b.produit));
  paysK.sort((a, b) => tri(a, b) || cmp(a.pays, b.pays) || cmp(a.mp, b.mp));
  cmdK.sort((a, b) => tri(a, b) || cmp(a.mp, b.mp));
  pairesK.sort((a, b) => tri(a, b) || cmp(a.a, b.a) || cmp(a.b, b.b) || a.s - b.s);
  const auDates = Object.values(boutiques).map((b) => b.au);
  return {
    schema: SCHEMA,
    extrait_le: today,
    extrait_a: new Date().toISOString(),
    du: lignes.length ? lignes[0].d : today,
    au: auDates.reduce((a, b) => (a < b ? a : b)),
    base: { marketplaces: "ca_ht = (ventes nettes + taxes) / 1,2", site: "ca_ht = ventes nettes (hors taxes, remises et retours déduits)" },
    boutiques,
    mp, pays: paysNoms,
    produits: noms.map((n) => [n, marques.get(n) ?? null]),
    lignes: lignes.map((l) => [l.d, iMp.get(l.mp), iProd.get(l.produit), l.qte, r2(l.ca)]),
    pays_jour: paysK.map((l) => (typeof l.qte === "number" ? [l.d, iPays.get(l.pays), iMp.get(l.mp), r2(l.ca), l.qte] : [l.d, iPays.get(l.pays), iMp.get(l.mp), r2(l.ca)])),
    commandes: cmdK.map((l) => [l.d, iMp.get(l.mp), l.n]),
    paires: pairesK.map((l) => [l.d, iProd.get(l.a), iProd.get(l.b), l.n, l.s]),
  };
}

const TABLEAUX = ["lignes", "produits", "pays_jour", "commandes", "paires"];
// Une ligne par enregistrement : diffs Git lisibles
export function serialiser(e) {
  const l = ["{"];
  const cles = Object.keys(e);
  cles.forEach((k, i) => {
    const v = e[k];
    const vg = i < cles.length - 1 ? "," : "";
    if (TABLEAUX.includes(k)) {
      l.push(`  ${JSON.stringify(k)}: [`);
      v.forEach((x, j) => l.push(`    ${JSON.stringify(x)}${j < v.length - 1 ? "," : ""}`));
      l.push(`  ]${vg}`);
    } else l.push(`  ${JSON.stringify(k)}: ${JSON.stringify(v)}${vg}`);
  });
  l.push("}");
  return l.join("\n") + "\n";
}

function ecrire(ext, fichier, dry) {
  const texte = serialiser(ext);
  if (JSON.stringify(JSON.parse(texte)) !== JSON.stringify(ext)) throw new Echec("Contrôle d'intégrité : le JSON écrit ne se relit pas à l'identique", 1);
  const avant = fs.existsSync(fichier) ? fs.readFileSync(fichier, "utf8") : "";
  if (!dry) { const tmp = fichier + ".tmp"; fs.writeFileSync(tmp, texte); fs.renameSync(tmp, fichier); }
  return avant === texte ? 0 : 1;
}

// Contrôle avec l'extraction précédente : les jours communs ne doivent pas varier de plus de 15 % au total
export function comparerAuPrecedent(neuf, prec, force, avert) {
  if (!prec || !Array.isArray(prec.lignes) || prec.schema !== SCHEMA) return;
  const somme = (e) => { const m = new Map(); for (const [d, , , , ca] of e.lignes) m.set(d, (m.get(d) ?? 0) + ca); return m; };
  const a = somme(prec), b = somme(neuf);
  let sa = 0, sb = 0;
  for (const [d, v] of a) if (b.has(d)) { sa += v; sb += b.get(d); const e = b.get(d) / v - 1; if (Math.abs(e) > 0.25 && Math.abs(v) > 500) avert.push(`Jour ${d} : ${pct(e)} par rapport à l'extraction précédente (${eur(v)} → ${eur(b.get(d))})`); }
  if (sa > 0 && Math.abs(sb / sa - 1) > CFG.ecartTotalEchec && !force) {
    throw new Echec(`Les jours communs avec l'extraction précédente ont varié de ${pct(sb / sa - 1)} (${eur(sa)} → ${eur(sb)}) : vérifier l'extraction (--force pour passer outre)`);
  }
  const auPrec = auExtension(prec), auNeuf = auExtension(neuf);
  if (auPrec && auNeuf && auPrec > auNeuf && !force) throw new Echec(`Régression : l'extraction actuelle va jusqu'au ${auPrec}, la nouvelle seulement jusqu'au ${auNeuf} (--force pour passer outre)`);
}

/* ------------------------------------------------------------------ compte rendu */
export function resume(ext) {
  const t = ext.lignes.reduce((a, [, , , q, ca]) => ({ ca: a.ca + ca, q: a.q + q }), { ca: 0, q: 0 });
  const parMp = new Map();
  for (const [, im, , , ca] of ext.lignes) parMp.set(ext.mp[im], (parMp.get(ext.mp[im]) ?? 0) + ca);
  const parAn = new Map();
  for (const [d, , , , ca] of ext.lignes) parAn.set(d.slice(0, 4), (parAn.get(d.slice(0, 4)) ?? 0) + ca);
  return [
    `Période        : ${ext.du} → ${ext.au}`,
    `CA HT          : ${eur(t.ca)} · ${t.q} unités · ${ext.lignes.length} enregistrements (jour × marketplace × produit)`,
    `Par année      : ${[...parAn].sort().map(([y, v]) => `${y} ${eur(v)}`).join(" · ")}`,
    `Par marketplace: ${[...parMp].sort((a, b) => b[1] - a[1]).map(([m, v]) => `${m} ${eur(v)}`).join(" · ")}`,
    `Boutiques      : ${Object.entries(ext.boutiques).map(([k, b]) => `${k} jusqu'au ${b.au}`).join(" · ")}`,
  ].join("\n");
}

// Le tableau de bord est reconstruit exactement comme l'application le fera : un échec ici interdit l'écriture
function verifierConstruction(ext, tables) {
  const r = construire(ext, tables.ref, { horsShopify: tables.hors });
  if (!r.appliquee) throw new Echec(`Le tableau de bord ne peut pas être construit avec cette extraction : ${(r.erreurs ?? []).join(" ; ")}`, 2);
  return r;
}

/* ------------------------------------------------------------------ collecte d'une boutique */
async function collecter(id, plan, o, tables, log) {
  const ctx = { ref: tables.ref, aujourdhui: plan.today, concurrence: o.concurrence ?? 3, depuisPaires: `${AN_DEFAUT}-01-01`, log };
  const eff = { du: plan.du, au: plan.au };
  const surIndex = (index) => { ctx.jeux = async (w) => jeuxDepuisIndex(index, id, w, plan.today); ctx.decoupable = false; ctx.concurrence = 1; };
  const requetes = () => plan.queries.map((q) => q.query);
  if (o.results.length) {
    surIndex(lireResultats({ fichiers: o.results }, id, requetes()));
    return { source: "fichiers", sortie: await collecterBoutique(id, eff, ctx) };
  }
  const etat = await etatRelais(id);
  if (etat.ok) {
    ctx.jeux = (w) => jeuxRelais(id, w, plan.today, { cache: o.cache, concurrence: 1 });
    ctx.decoupable = true;
    return { source: "relais", sortie: await collecterBoutique(id, eff, ctx) };
  }
  if (id === "marketplaces" && etat.absent) {
    // relais non configuré pour BESTHERM : résultats du connecteur Shopify de Claude relus dans la transcription
    surIndex(lireResultats({ transcripts: o.transcript }, id, requetes()));
    return { source: "transcription", sortie: await collecterBoutique(id, eff, ctx) };
  }
  throw new Echec(`${id} (relais) : ${etat.raison}`, 2);
}

/* ------------------------------------------------------------------ commandes */
async function main() {
  const o = args(process.argv.slice(2));
  const cmd = o._[0];
  const today = o.today ?? parisToday();
  const tables = lireTables();
  const { precedent } = tables;
  if (cmd === "check") {
    for (const id of Object.keys(BOUTIQUES)) {
      const p = planifier(precedent, today, o, id);
      const prec = precedent && validerExtension(precedent).ok ? precedent.boutiques?.[id]?.au : null;
      console.log(`OK · ${id} · extraction actuelle : ${prec ? `jusqu'au ${prec}` : "vide ou ancien format (historique complet à extraire)"} · fenêtre du jour : ${p.vide ? "vide" : `${p.du} → ${p.au} (${p.queries.length} requêtes)`}`);
    }
    for (const id of Object.keys(BOUTIQUES)) {
      const e = await etatRelais(id).catch((x) => ({ ok: false, raison: x.message }));
      if (e.ok) console.log(`OK · relais ${id} : joignable`);
      else if (id === "marketplaces") console.log(`INFO · relais ${id} indisponible (${e.raison}) : repli sur les résultats du connecteur Shopify (README, étape 3)`);
      else console.log(`AVERTISSEMENT · relais ${id} indisponible (${e.raison}) : l'actualisation de cette boutique échouera`);
    }
    if (precedent) {
      const v = validerExtension(precedent);
      if (!v.ok) console.log(`AVERTISSEMENT · shopify_extension.json inutilisable en l'état : ${v.erreurs.join(" ; ")}`);
      else { const r = verifierConstruction(precedent, tables); console.log(`OK · le tableau de bord se construit : ${r.jours} jours en ${r.an}, CA HT ${eur(r.ca)}, jusqu'au ${r.dmax}`); for (const a of r.avertissements) console.log(`AVERTISSEMENT · ${a}`); }
    }
    console.log(`OK · table de référence : ${Object.keys(tables.ref.produits).length} produits, ${Object.keys(tables.ref.skus).length} références`);
    return 0;
  }
  if (cmd === "status") {
    if (!precedent || !validerExtension(precedent).ok) { console.log("Extraction vide ou ancien format."); return 0; }
    console.log(resume(precedent) + `\nExtrait le ${precedent.extrait_a}`);
    return 0;
  }
  if (cmd === "plan") {
    const ids = o.boutique ? [o.boutique] : Object.keys(BOUTIQUES);
    console.log(JSON.stringify(ids.map((id) => planifier(precedent, today, o, id)), null, 2));
    return 0;
  }
  if (cmd === "apply") {
    const ids = o.boutique ? [o.boutique] : Object.keys(BOUTIQUES);
    const blocs = {}, avert = [], erreurs = [], echecs = [];
    const log = (m) => console.log(m);
    for (const id of ids) {
      const plan = planifier(precedent, today, o, id);
      if (plan.vide) { console.log(`Boutique ${id} : déjà à jour (fenêtre vide : ${plan.du} → ${plan.au}).`); continue; }
      try {
        const { source, sortie } = await collecter(id, plan, o, tables, log);
        controlerSortie(sortie);
        blocs[id] = sortie;
        for (const x of avertissementsDe(sortie)) avert.push(`[${id}] ${x}`);
        console.log(`Boutique ${id} (${source}) : ${plan.du} → ${plan.au} · ${sortie.lignes.length} enregistrements · ${eur(sortie.stats.ca)} · ${sortie.stats.qte} unités · ${sortie.stats.commandes} commandes`);
      } catch (e) {
        if (!(e instanceof Echec)) throw e;
        erreurs.push(`[${id}] ${e.message}`);
        echecs.push(id);
        console.error(`ÉCHEC · ${id} : ${e.message}`);
        if (e.code === 1) throw e;
      }
    }
    // Une boutique en échec n'est tolérée que si l'extraction précédente couvre déjà ses ventes (chiffres de la veille conservés) :
    // sinon le tableau de bord serait publié sans elle.
    const precedentValide = precedent && validerExtension(precedent).ok;
    const sansCouverture = echecs.filter((id) => !precedentValide || !precedent.boutiques?.[id]);
    if (sansCouverture.length) throw new Echec(`Boutique(s) en échec sans extraction antérieure (${sansCouverture.join(", ")}) : rien n'est écrit, un tableau de bord sans elle serait faux. ${erreurs.join(" | ")}`, 3);
    if (!Object.keys(blocs).length) {
      for (const a of avert) console.log(`AVERTISSEMENT · ${a}`);
      if (erreurs.length) throw new Echec(`Aucune boutique mise à jour (${erreurs.length} échec(s)).`, 3);
      console.log("Rien à écrire : tout est déjà à jour.");
      return 0;
    }
    const neuf = fusionner(precedent, blocs, today);
    const v = validerExtension(neuf);
    if (!v.ok) throw new Echec(`Extraction produite invalide : ${v.erreurs.join(" ; ")}`, 1);
    comparerAuPrecedent(neuf, precedent, o.force, avert);
    const r = verifierConstruction(neuf, tables);
    for (const a of r.avertissements) avert.push(a);
    console.log(resume(neuf));
    console.log(`Tableau de bord : jusqu'au ${r.dmax}, CA HT ${eur(r.ca)} sur ${r.jours} jours, ${r.commandes} commandes.`);
    const n = ecrire(neuf, o.out ?? FICHIER, o.dry);
    for (const a of avert) console.log(`AVERTISSEMENT · ${a}`);
    console.log(o.dry ? `Essai à blanc : ${n ? "le fichier changerait" : "aucun changement"}, rien n'est écrit.` : `OK · ${path.relative(RACINE, o.out ?? FICHIER)} ${n ? "mis à jour" : "inchangé"}.`);
    if (erreurs.length) { console.error(`Boutique(s) en échec, chiffres de la veille conservés : ${erreurs.join(" | ")}`); return 0; }
    return 0;
  }
  console.error("Commandes : check | plan | apply | status   (voir scripts/extension/README.md)");
  return 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((c) => process.exit(c), (e) => {
    if (e instanceof Echec) { console.error(`ÉCHEC · ${e.message}`); process.exit(e.code); }
    console.error(e);
    process.exit(1);
  });
}
