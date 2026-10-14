#!/usr/bin/env node
/**
 * Mise à jour du bloc « Flash Shopify » (boutique BESTHERM, marketplaces) : fichier
 * shopify_flash.json à la racine du dépôt, importé par App.jsx. Ce script n'écrit QUE ce
 * fichier : App.jsx n'est jamais modifié (pas de conflit avec les envois manuels sur GitHub).
 *
 * Le bloc couvre les ventes POSTÉRIEURES à la dernière ligne du fichier ODP (DMAX) jusqu'à
 * hier (heure de Paris). Il est volontairement séparé des KPI du tableau de bord, qui restent
 * calculés sur le fichier ODP (site web compris).
 *
 * Base de calcul : CA HT comparable = (ventes nettes + taxes) ÷ 1,2, comme le « CA HT » de
 * l'ODP (TTC ÷ 1,2). Les ventes nettes seules surestiment d'environ 2 % (commandes sans taxe
 * enregistrée, restées en TTC). N-1 : mêmes dates calendaires 2025, mesurées dans Shopify.
 *
 * Utilisation (voir README.md) :
 *   node scripts/flash/refresh_flash.mjs check                       structure de App.jsx et du fichier
 *   node scripts/flash/refresh_flash.mjs plan  [--today AAAA-MM-JJ]  requêtes ShopifyQL à lancer
 *   node scripts/flash/refresh_flash.mjs apply [--today AAAA-MM-JJ] [--transcript f.jsonl]
 *                                              [--results f.json] [--dry-run]
 *   node scripts/flash/refresh_flash.mjs status                      état du bloc actuel
 *
 * Les résultats des requêtes sont relus tels quels dans la transcription de la session
 * (~/.claude/projects/**.jsonl) : aucune recopie à la main des chiffres. Aucune donnée client
 * n'est utilisée, uniquement des agrégats (jour, pays, référence).
 *
 * Codes de sortie : 0 ok · 2 contrôle de cohérence échoué (rien n'est écrit) · 3 résultats
 * manquants · 1 erreur d'utilisation ou de structure.
 * Garde-fou côté application : les jours déjà couverts par l'ODP (jour ≤ DMAX) sont ignorés à
 * l'affichage, donc une mise à jour de l'ODP entre deux actualisations ne crée pas de doublon.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(__dirname, "..", "..", "App.jsx");
const DATA_FILE = path.resolve(__dirname, "..", "..", "shopify_flash.json");

/* ------------------------------------------------------------------ réglages */
const CFG = {
  boutique: "BESTHERM",
  domaine: "46a3f9-2.myshopify.com", // protège contre une connexion à la mauvaise boutique
  tva: 1.2, // même convention que l'ODP : CA HT = TTC ÷ 1,2
  limiteSku: 500,
  limitePays: 20,
  topPays: 10,
  topProduits: 10,
  couvertureMin: 0.97, // part minimale du total couverte par les listes (pays, produits)
  ecartJourAvert: 0.25, // écart relatif par jour avec le bloc précédent (avertissement)
  ecartTotalEchec: 0.15, // écart relatif du total sur les jours communs (échec)
  recoupAvert: 0.03, // écart Shopify / ODP sur les deux dernières semaines complètes
  recoupEchec: 0.08,
  nonRattachesAvert: 0.03,
};

// Références Shopify dont le code diffère de celui de l'ODP
const SURCHARGES_SKU = {
  "HR10-CV05W": "ARIA VERTICAL 1500W", // même produit que HR15-TV12
  "HR-T17W-PACK": "PACK MILLA (3 radiateurs)", // l'ODP l'éclate en 3 produits MILLA
};

// Noms de pays Shopify (anglais) → noms de l'application (français)
const PAYS_EN_FR = {
  "France": "France", "Belgium": "Belgique", "Spain": "Espagne", "Italy": "Italie",
  "Netherlands": "Pays-Bas", "Germany": "Allemagne", "Portugal": "Portugal",
  "Switzerland": "Suisse", "Austria": "Autriche", "Croatia": "Croatie",
  "Luxembourg": "Luxembourg", "United Kingdom": "Royaume-Uni", "Poland": "Pologne",
  "Ireland": "Irlande", "Greece": "Grèce", "Bulgaria": "Bulgarie", "Estonia": "Estonie",
  "Latvia": "Lettonie", "Lithuania": "Lituanie", "Monaco": "Monaco", "Denmark": "Danemark",
  "Sweden": "Suède", "Finland": "Finlande", "Norway": "Norvège", "Czechia": "Tchéquie",
  "Czech Republic": "Tchéquie", "Slovakia": "Slovaquie", "Slovenia": "Slovénie",
  "Hungary": "Hongrie", "Romania": "Roumanie", "Malta": "Malte", "Cyprus": "Chypre",
  "Andorra": "Andorre", "Canary Islands": "Canaries, îles", "United States": "États-Unis",
  "Canada": "Canada", "Morocco": "Maroc", "Tunisia": "Tunisie", "Algeria": "Algérie",
  "Réunion": "La Réunion", "Reunion": "La Réunion", "Martinique": "Martinique",
  "Guadeloupe": "Guadeloupe", "French Guiana": "Guyane", "Liechtenstein": "Liechtenstein",
};

/* ------------------------------------------------------------------ utilitaires */
const D = (s) => { const [y, m, d] = s.split("-").map(Number); return Date.UTC(y, m - 1, d); };
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
const addDays = (s, n) => iso(D(s) + n * 864e5);
const dayDiff = (a, b) => Math.round((D(b) - D(a)) / 864e5);
const r2 = (x) => Math.round(x * 100) / 100;
const pct = (x) => (Math.abs(x) < 0.0005 ? "0.0 %" : `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)} %`);
const eur = (x) => new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(Math.round(x)) + " €";

function lastYear(s) {
  const [y, m, d] = s.split("-").map(Number);
  const dd = m === 2 && d === 29 ? 28 : d;
  return `${y - 1}-${String(m).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
}

// Semaines de l'Excel : dimanche → samedi, semaine 1 = 1er janvier jusqu'au premier samedi
function weekExcel(s) {
  const y = s.slice(0, 4);
  const idx = dayDiff(`${y}-01-01`, s);
  const dow = new Date(D(`${y}-01-01`)).getUTCDay(); // 0 = dimanche
  return Math.floor((idx + dow) / 7) + 1;
}

function parisToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

class Echec extends Error {
  constructor(msg, code = 2) { super(msg); this.code = code; }
}

function args(argv) {
  const o = { _: [], transcript: [], results: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--today") o.today = argv[++i];
    else if (a === "--transcript") o.transcript.push(argv[++i]);
    else if (a === "--results") o.results.push(argv[++i]);
    else if (a === "--dry-run") o.dry = true;
    else if (a === "--force") o.force = true;
    else if (a.startsWith("--")) throw new Echec(`Option inconnue : ${a}`, 1);
    else o._.push(a);
  }
  if (o.today && !/^\d{4}-\d{2}-\d{2}$/.test(o.today)) throw new Echec("--today attend AAAA-MM-JJ", 1);
  return o;
}

/* ------------------------------------------------------------------ lecture de App.jsx */
function grabConst(src, name) {
  const m = new RegExp("^const " + name + " = (.*);[ \\t]*$", "m").exec(src);
  if (!m) throw new Echec(`Constante ${name} introuvable dans App.jsx`, 1);
  try { return JSON.parse(m[1]); } catch { throw new Echec(`Constante ${name} illisible (JSON attendu)`, 1); }
}

const IMPORT_FLASH = 'import SHOPIFY_FLASH from "./shopify_flash.json";';

function lireApp() {
  const src = fs.readFileSync(APP, "utf8");
  const dm = /const DMIN = "(\d{4}-\d{2}-\d{2})", DMAX = "(\d{4}-\d{2}-\d{2})";/.exec(src);
  if (!dm) throw new Echec("DMIN / DMAX introuvables dans App.jsx", 1);
  if (!src.includes(IMPORT_FLASH)) {
    throw new Echec(`App.jsx n'importe plus shopify_flash.json (ligne « ${IMPORT_FLASH} » absente) : le bloc Flash ne s'afficherait pas`, 1);
  }
  let precedent = null;
  if (fs.existsSync(DATA_FILE)) {
    try { precedent = JSON.parse(fs.readFileSync(DATA_FILE, "utf8")); } catch { throw new Echec("shopify_flash.json illisible", 1); }
  }
  return { src, dmax: dm[2], precedent };
}

/* ------------------------------------------------------------------ plan des requêtes */
function planifier(app, today) {
  const au = addDays(today, -1); // seuls les jours complets sont repris
  const du = addDays(app.dmax, 1);
  const p = { today, dmax: app.dmax, du, au, vide: du > au, queries: [] };
  if (p.vide) return p;
  const n1du = lastYear(du), n1au = lastYear(au);
  const q = (id, query) => p.queries.push({ id, query });
  const metr = "orders, quantity_ordered, net_sales, taxes";
  q("jours", `FROM sales SHOW ${metr} TIMESERIES day SINCE ${du} UNTIL ${au}`);
  q("jours_n1", `FROM sales SHOW ${metr} TIMESERIES day SINCE ${n1du} UNTIL ${n1au}`);
  q("pays", `FROM sales SHOW ${metr} GROUP BY shipping_country SINCE ${du} UNTIL ${au} ORDER BY net_sales DESC LIMIT ${CFG.limitePays}`);
  q("produits", `FROM sales SHOW quantity_ordered, net_sales, taxes GROUP BY product_variant_sku SINCE ${du} UNTIL ${au} ORDER BY net_sales DESC LIMIT ${CFG.limiteSku}`);
  // Contrôle : deux dernières semaines complètes (dimanche → samedi) couvertes par l'ODP
  const sam = addDays(app.dmax, -((new Date(D(app.dmax)).getUTCDay() + 1) % 7));
  const rdu = addDays(sam, -13);
  if (rdu.slice(0, 4) === sam.slice(0, 4)) {
    p.recoup = { du: rdu, au: sam, semaines: [weekExcel(rdu), weekExcel(sam)] };
    q("recoup", `FROM sales SHOW ${metr} SINCE ${rdu} UNTIL ${sam}`);
  }
  return p;
}

/* ------------------------------------------------------------------ résultats ShopifyQL */
function* fichiersTranscription(explicites) {
  if (explicites.length) { yield* explicites; return; }
  // Dossier de configuration de Claude : variable d'environnement, répertoire personnel, emplacements usuels
  const racines = [...new Set([
    process.env.CLAUDE_CONFIG_DIR, path.join(os.homedir(), ".claude"), "/root/.claude", "/home/claude/.claude",
  ].filter(Boolean).map((d) => path.join(d, "projects")))];
  const trouves = [];
  const parcourir = (d, prof = 0) => {
    let ents = [];
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const p = path.join(d, e.name);
      if (e.isDirectory() && prof < 3) parcourir(p, prof + 1);
      else if (e.isFile() && e.name.endsWith(".jsonl")) trouves.push([p, fs.statSync(p).mtimeMs]);
    }
  };
  for (const r of racines) parcourir(r);
  trouves.sort((a, b) => b[1] - a[1]);
  for (const [p] of trouves) yield p;
}

function lireResultatsJsonl(fichier, resultats) {
  let lignes;
  try { lignes = fs.readFileSync(fichier, "utf8").split("\n"); } catch { return; } // fichier absent ou illisible : ignoré
  for (const l of lignes) {
    if (!l.includes('"tool_result"') || !l.includes("rows")) continue;
    let o; try { o = JSON.parse(l); } catch { continue; }
    const c = o?.message?.content;
    if (!Array.isArray(c)) continue;
    for (const b of c) {
      if (b?.type !== "tool_result") continue;
      const texte = typeof b.content === "string" ? b.content
        : Array.isArray(b.content) ? b.content.map((x) => x?.text ?? "").join("") : "";
      if (!texte.startsWith('{"query"')) continue;
      let j; try { j = JSON.parse(texte); } catch { continue; }
      if (typeof j.query === "string" && Array.isArray(j.rows) && Array.isArray(j.columns)) resultats.set(j.query, j);
    }
  }
}

function lireResultatsJson(fichier, resultats) {
  const j = JSON.parse(fs.readFileSync(fichier, "utf8"));
  for (const r of Array.isArray(j) ? j : [j]) {
    if (typeof r?.query === "string" && Array.isArray(r.rows)) resultats.set(r.query, r);
  }
}

function collecter(plan, opts) {
  const manquants = (res) => plan.queries.filter((q) => !res.has(q.query));
  const resultats = new Map();
  for (const f of opts.results) lireResultatsJson(f, resultats);
  if (!opts.results.length) {
    // Session courante : on s'arrête au premier fichier qui contient toutes les requêtes
    for (const f of fichiersTranscription(opts.transcript)) {
      const r = new Map();
      lireResultatsJsonl(f, r);
      for (const [k, v] of r) if (!resultats.has(k)) resultats.set(k, v); // le fichier le plus récent prime
      if (manquants(resultats).length === 0) break;
    }
  }
  const absents = manquants(resultats);
  if (absents.length) {
    throw new Echec(
      "Résultats ShopifyQL manquants pour : " + absents.map((q) => q.id).join(", ") +
      ". Lancer exactement les requêtes affichées par la commande « plan » (même --today).", 3);
  }
  return resultats;
}

const col = (res, nom) => {
  const i = res.columns.findIndex((c) => c.name === nom);
  if (i < 0) throw new Echec(`Colonne « ${nom} » absente du résultat « ${res.query} »`);
  return i;
};
const nombre = (v, ctx) => {
  const x = Number(v);
  if (!Number.isFinite(x)) throw new Echec(`Valeur non numérique (${ctx}) : ${JSON.stringify(v)}`);
  return x;
};
const ht = (net, tax) => (net + tax) / CFG.tva;

/* ------------------------------------------------------------------ construction du bloc */
function normaliserSku(s) {
  return s.trim().replace(/(_never_used| never used)$/i, "").replace(/-FLM$/i, "").replace(/\//g, "-");
}

function serie(res, du, au, ctx) {
  // Une ligne par jour ; les jours sans vente (absents de l'extraction) valent 0
  const iDay = col(res, "day"), iO = col(res, "orders"), iQ = col(res, "quantity_ordered");
  const iN = col(res, "net_sales"), iT = col(res, "taxes");
  const jours = new Map();
  for (const r of res.rows) {
    const d = String(r[iDay]).slice(0, 10);
    if (d < du || d > au) throw new Echec(`${ctx} : jour hors fenêtre (${d}, attendu ${du} → ${au})`);
    if (jours.has(d)) throw new Echec(`${ctx} : jour en double (${d})`);
    jours.set(d, {
      cmd: nombre(r[iO], ctx), qte: nombre(r[iQ], ctx),
      net: nombre(r[iN], ctx), tax: nombre(r[iT], ctx),
    });
  }
  const out = [];
  for (let d = du; d <= au; d = addDays(d, 1)) {
    out.push({ d, ...(jours.get(d) ?? { cmd: 0, qte: 0, net: 0, tax: 0 }) });
  }
  return out;
}

function construire(app, plan, resultats, avert) {
  const rs = (id) => resultats.get(plan.queries.find((q) => q.id === id).query);
  const tous = [...resultats.values()];
  for (const r of tous) {
    if (r.shopDomain && r.shopDomain !== CFG.domaine) {
      throw new Echec(`Boutique inattendue (${r.shopDomain}) : ${CFG.domaine} attendu. Aucune écriture.`);
    }
  }
  const j26 = serie(rs("jours"), plan.du, plan.au, "jours 2026");
  const j25 = serie(rs("jours_n1"), lastYear(plan.du), lastYear(plan.au), "jours N-1");
  if (!j26.some((j) => j.cmd > 0)) throw new Echec("Aucune commande sur la période : extraction suspecte");
  const tot = (js) => js.reduce((a, j) => ({
    cmd: a.cmd + j.cmd, qte: a.qte + j.qte, net: a.net + j.net, tax: a.tax + j.tax,
  }), { cmd: 0, qte: 0, net: 0, tax: 0 });
  const t26 = tot(j26), t25 = tot(j25);

  // Jours : N-1 apparié à la même date calendaire (29 février → 28 février)
  const par25 = new Map(j25.map((j) => [j.d, j]));
  const jours = j26.map((j) => {
    const n = par25.get(lastYear(j.d));
    return {
      d: j.d, ca: r2(ht(j.net, j.tax)), cmd: j.cmd, qte: j.qte,
      n1: n ? r2(ht(n.net, n.tax)) : null,
    };
  });
  const t25app = tot(jours.map((j) => par25.get(lastYear(j.d))).filter(Boolean).filter((x, i, a) => a.indexOf(x) === i));

  // Pays
  const rp = rs("pays");
  const iC = col(rp, "shipping_country"), iPo = col(rp, "orders"), iPq = col(rp, "quantity_ordered");
  const iPn = col(rp, "net_sales"), iPt = col(rp, "taxes");
  const enFr = new Map(Object.entries(PAYS_EN_FR));
  const i18n = grabConst(app.src, "PAYS_I18N");
  for (const [fr, v] of Object.entries(i18n)) if (v?.en && !enFr.has(v.en)) enFr.set(v.en, fr);
  const paysAgg = new Map();
  let htPays = 0, inconnusPays = new Set();
  for (const r of rp.rows) {
    const brut = String(r[iC] ?? "").trim();
    const h = ht(nombre(r[iPn], "pays"), nombre(r[iPt], "pays"));
    htPays += h;
    if (!brut) continue;
    const nom = enFr.get(brut) ?? (inconnusPays.add(brut), brut);
    const a = paysAgg.get(nom) ?? { nom, ca: 0, qte: 0 };
    a.ca += h; a.qte += nombre(r[iPq], "pays");
    paysAgg.set(nom, a);
  }
  const htTotal = ht(t26.net, t26.tax);
  if (htPays / htTotal < CFG.couvertureMin || htPays / htTotal > 1.001) {
    throw new Echec(`Pays : couverture incohérente (${(htPays / htTotal * 100).toFixed(2)} % du total)`);
  }
  if (inconnusPays.size) avert.push(`Pays sans traduction (conservés en anglais) : ${[...inconnusPays].join(", ")}`);
  const pays = [...paysAgg.values()].sort((a, b) => b.ca - a.ca).slice(0, CFG.topPays)
    .map((p) => ({ nom: p.nom, ca: r2(p.ca), qte: p.qte }));

  // Produits (référence Shopify → nom produit de l'application via ABC_BY_SKU)
  const rq = rs("produits");
  if (rq.rows.length >= CFG.limiteSku) throw new Echec(`Produits : limite de ${CFG.limiteSku} lignes atteinte, augmenter limiteSku`);
  const iS = col(rq, "product_variant_sku"), iQq = col(rq, "quantity_ordered");
  const iQn = col(rq, "net_sales"), iQt = col(rq, "taxes");
  const codes = new Map();
  for (const [code, nom] of grabConst(app.src, "ABC_BY_SKU")) codes.set(String(code).toUpperCase(), nom);
  for (const [code, nom] of Object.entries(SURCHARGES_SKU)) codes.set(code.toUpperCase(), nom);
  const prodAgg = new Map();
  let htSku = 0, htNonRatt = 0, qteNonRatt = 0;
  const nonRatt = [];
  for (const r of rq.rows) {
    const net = nombre(r[iQn], "produits"), tax = nombre(r[iQt], "produits");
    const h = ht(net, tax);
    htSku += h;
    const brut = String(r[iS] ?? "").trim();
    if (!brut) continue; // ligne sans référence (taxes de port) : comptée dans le total seulement
    const code = normaliserSku(brut);
    let nom = codes.get(code.toUpperCase());
    if (!nom) {
      htNonRatt += h; qteNonRatt += nombre(r[iQq], "produits");
      nonRatt.push(`${brut} (${eur(h)})`);
      nom = /^\d{8,14}$/.test(code) ? "Références sans nom produit" : code;
    }
    const a = prodAgg.get(nom) ?? { nom, ca: 0, qte: 0 };
    a.ca += h; a.qte += nombre(r[iQq], "produits");
    prodAgg.set(nom, a);
  }
  if (Math.abs(htSku - htTotal) > Math.max(1, htTotal * 0.001)) {
    throw new Echec(`Produits : total des références (${eur(htSku)}) différent du total des jours (${eur(htTotal)})`);
  }
  if (htNonRatt / htTotal > CFG.nonRattachesAvert) {
    avert.push(`Références non rattachées : ${(htNonRatt / htTotal * 100).toFixed(1)} % du CA (${nonRatt.slice(0, 8).join(", ")})`);
  } else if (nonRatt.length) {
    avert.push(`Références non rattachées (${(htNonRatt / htTotal * 100).toFixed(2)} % du CA) : ${nonRatt.slice(0, 8).join(", ")}`);
  }
  const produits = [...prodAgg.values()].sort((a, b) => b.ca - a.ca).slice(0, CFG.topProduits)
    .map((p) => ({ nom: p.nom, ca: r2(p.ca), qte: p.qte }));

  // Contrôle : Shopify HT comparable vs ODP hors site web, deux dernières semaines complètes
  let recoupement = null;
  if (plan.recoup) {
    const rr = rs("recoup");
    if (rr.rows.length !== 1) throw new Echec("Contrôle : une seule ligne attendue");
    const shop = ht(nombre(rr.rows[0][col(rr, "net_sales")], "recoup"), nombre(rr.rows[0][col(rr, "taxes")], "recoup"));
    const sem = new Set(plan.recoup.semaines);
    const lignes = grabConst(app.src, "WEEKLY_BY_MP").filter((x) => sem.has(x[0]));
    if (lignes.length) {
      const excel = lignes.filter((x) => x[1] !== "Site Web").reduce((a, x) => a + x[2], 0);
      const ecart = shop / excel - 1;
      if (Math.abs(ecart) > CFG.recoupEchec) {
        throw new Echec(`Contrôle ODP : écart Shopify / ODP de ${pct(ecart)} sur ${plan.recoup.du} → ${plan.recoup.au} (seuil ${pct(CFG.recoupEchec)}) : convention de TVA ou extraction à vérifier`);
      }
      if (Math.abs(ecart) > CFG.recoupAvert) avert.push(`Contrôle ODP : écart ${pct(ecart)} sur ${plan.recoup.du} → ${plan.recoup.au}`);
      recoupement = { du: plan.recoup.du, au: plan.recoup.au, shopify: r2(shop), excel: r2(excel) };
    }
  }

  const bloc = {
    boutique: CFG.boutique,
    extrait_le: plan.today,
    extrait_a: new Date().toISOString(),
    annee: Number(plan.au.slice(0, 4)),
    du: plan.du,
    au: plan.au,
    base: "ht_comparable",
    jours,
    n1: { ca: r2(ht(t25app.net, t25app.tax)), qte: t25app.qte, cmd: t25app.cmd },
    pays,
    produits,
  };
  if (recoupement) bloc.recoupement = recoupement;
  return bloc;
}

/* ------------------------------------------------------------------ contrôles avec le bloc précédent */
function comparerAuPrecedent(neuf, prec, force, avert) {
  if (!prec || !Array.isArray(prec.jours)) return;
  if (prec.du === neuf.du && prec.au > neuf.au && !force) {
    throw new Echec(`Régression : le bloc actuel va jusqu'au ${prec.au}, le nouveau seulement jusqu'au ${neuf.au} (--force pour passer outre)`);
  }
  const anc = new Map(prec.jours.map((j) => [j.d, j]));
  let sa = 0, sn = 0;
  for (const j of neuf.jours) {
    const a = anc.get(j.d);
    if (!a || !(a.ca > 0)) continue;
    sa += a.ca; sn += j.ca;
    const e = j.ca / a.ca - 1;
    if (Math.abs(e) > CFG.ecartJourAvert) avert.push(`Jour ${j.d} : ${pct(e)} par rapport au bloc précédent (${eur(a.ca)} → ${eur(j.ca)})`);
  }
  if (sa > 0 && Math.abs(sn / sa - 1) > CFG.ecartTotalEchec && !force) {
    throw new Echec(`Les jours communs avec le bloc précédent ont varié de ${pct(sn / sa - 1)} (${eur(sa)} → ${eur(sn)}) : vérifier l'extraction (--force pour passer outre)`);
  }
}

/* ------------------------------------------------------------------ écriture */
// Une ligne par jour : diffs Git lisibles
function serialiser(b) {
  if (b === null) return "null\n";
  const e = Object.entries(b);
  const l = [];
  e.forEach(([k, v], i) => {
    const vg = i < e.length - 1 ? "," : "";
    if (Array.isArray(v)) {
      l.push(`  ${JSON.stringify(k)}: [`);
      v.forEach((x, j) => l.push(`    ${JSON.stringify(x)}${j < v.length - 1 ? "," : ""}`));
      l.push(`  ]${vg}`);
    } else l.push(`  ${JSON.stringify(k)}: ${JSON.stringify(v)}${vg}`);
  });
  return `{\n${l.join("\n")}\n}\n`;
}

function ecrire(bloc, dry) {
  const texte = serialiser(bloc);
  // Relecture : ce qui sera écrit doit se relire à l'identique
  if (JSON.stringify(JSON.parse(texte)) !== JSON.stringify(bloc)) throw new Echec("Contrôle d'intégrité : le JSON écrit ne se relit pas à l'identique", 1);
  const avant = fs.existsSync(DATA_FILE) ? fs.readFileSync(DATA_FILE, "utf8") : "";
  if (!dry) {
    const tmp = DATA_FILE + ".tmp";
    fs.writeFileSync(tmp, texte);
    fs.renameSync(tmp, DATA_FILE);
  }
  return avant === texte ? 0 : 1;
}

/* ------------------------------------------------------------------ commandes */
function resume(bloc) {
  const t = bloc.jours.reduce((a, j) => ({ ca: a.ca + j.ca, cmd: a.cmd + j.cmd, qte: a.qte + j.qte }), { ca: 0, cmd: 0, qte: 0 });
  const lignes = [
    `Fenêtre        : ${bloc.du} → ${bloc.au} (${bloc.jours.length} jours)`,
    `CA HT          : ${eur(t.ca)} · ${t.cmd} commandes · ${t.qte} unités · panier ${eur(t.ca / t.cmd)}`,
    `N-1 (Shopify)  : ${eur(bloc.n1.ca)} · ${bloc.n1.qte} unités` + (bloc.n1.ca > 0 ? ` · ${pct(t.ca / bloc.n1.ca - 1)}` : ""),
    `Top pays       : ${bloc.pays.slice(0, 5).map((p) => `${p.nom} ${eur(p.ca)}`).join(" · ")}`,
    `Top produits   : ${bloc.produits.slice(0, 5).map((p) => `${p.nom} ${eur(p.ca)}`).join(" · ")}`,
  ];
  if (bloc.recoupement) {
    const r = bloc.recoupement;
    lignes.push(`Contrôle ODP   : ${r.du} → ${r.au} · Shopify ${eur(r.shopify)} vs ODP hors site web ${eur(r.excel)} (${pct(r.shopify / r.excel - 1)})`);
  }
  return lignes.join("\n");
}

function main() {
  const o = args(process.argv.slice(2));
  const cmd = o._[0];
  const app = lireApp();
  const today = o.today ?? parisToday();

  if (cmd === "check") {
    grabConst(app.src, "ABC_BY_SKU"); grabConst(app.src, "WEEKLY_BY_MP"); grabConst(app.src, "PAYS_I18N");
    const p = planifier(app, today);
    console.log(`OK · DMAX ${app.dmax} · bloc actuel : ${app.precedent ? `${app.precedent.du} → ${app.precedent.au}` : "vide"} · fenêtre du jour : ${p.vide ? "vide" : `${p.du} → ${p.au}`}`);
    return 0;
  }
  if (cmd === "status") {
    const f = app.precedent;
    if (!f) { console.log(`Bloc vide (ODP jusqu'au ${app.dmax})`); return 0; }
    console.log(`ODP jusqu'au ${app.dmax}\n` + resume(f) + `\nExtrait le ${f.extrait_a ?? f.extrait_le}`);
    return 0;
  }
  if (cmd === "plan") {
    console.log(JSON.stringify(planifier(app, today), null, 2));
    return 0;
  }
  if (cmd === "apply") {
    const plan = planifier(app, today);
    const avert = [];
    let bloc = null;
    if (plan.vide) {
      console.log(`Le fichier ODP (jusqu'au ${plan.dmax}) couvre déjà jusqu'à hier (${plan.au}) : bloc Flash vidé.`);
    } else {
      const resultats = collecter(plan, o);
      bloc = construire(app, plan, resultats, avert);
      comparerAuPrecedent(bloc, app.precedent, o.force, avert);
      console.log(resume(bloc));
    }
    const n = ecrire(bloc, o.dry);
    for (const a of avert) console.log(`AVERTISSEMENT · ${a}`);
    console.log(o.dry ? `Essai à blanc : ${n ? "le fichier changerait" : "aucun changement"}, rien n'est écrit.` : `OK · shopify_flash.json ${n ? "mis à jour" : "inchangé"}.`);
    return 0;
  }
  console.error("Commandes : check | plan | apply | status   (voir scripts/flash/README.md)");
  return 1;
}

export { planifier, construire, comparerAuPrecedent, normaliserSku, lastYear, weekExcel, addDays, serialiser, Echec, CFG };

// Exécution directe uniquement (le fichier est aussi importé par selftest.mjs)
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exit(main());
  } catch (e) {
    if (e instanceof Echec) {
      console.error(`ÉCHEC · ${e.message}`);
      process.exit(e.code);
    }
    console.error(e);
    process.exit(1);
  }
}
