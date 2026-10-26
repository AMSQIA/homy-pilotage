#!/usr/bin/env node
/**
 * Actualisation quotidienne du prolongement Shopify : écrit shopify_extension.json (racine du dépôt), lu par
 * App.jsx / extension.js pour prolonger TOUT le tableau de bord (KPI, courbes, marketplaces, marques, produits,
 * pays, plan, N-1…) au-delà de la dernière ligne du fichier ODP (DMAX_ODP).
 *
 * Deux boutiques Shopify, deux bases de calcul, toutes deux alignées sur la colonne « CA HT » de l'ODP :
 *   marketplaces (BESTHERM, 46a3f9-2.myshopify.com) : CA HT = (ventes nettes + taxes) ÷ 1,2 ligne par ligne ;
 *       la marketplace de chaque commande est donnée par sa passerelle de paiement (jeu `payments`)
 *   site web (bestherm.fr, besthermshop.myshopify.com) : CA HT = ventes brutes hors taxes (avant remises et retours),
 *       marketplace « Site Web »
 *
 * Utilisation (voir scripts/extension/README.md) :
 *   node scripts/extension/refresh_extension.mjs check
 *   node scripts/extension/refresh_extension.mjs plan  [--today AAAA-MM-JJ] [--du AAAA-MM-JJ] [--reprendre N]
 *   node scripts/extension/refresh_extension.mjs apply [--today ..] [--du ..] [--reprendre N] [--boutique marketplaces|site]
 *                      [--transcript f.jsonl] [--results-site f.json] [--ordres-lm f.json] [--out fichier.json] [--dry-run] [--force]
 *   node scripts/extension/refresh_extension.mjs status
 *
 * Marketplaces : les requêtes du « plan » sont lancées avec le connecteur Shopify de Claude (outil run-analytics-query,
 * texte exact) ; apply relit les résultats tels quels dans la transcription de la session (aucune recopie à la main).
 * Technomat : ses commandes sont payées par la passerelle Leroy Merlin ; seul le numéro d'origine de la commande (attribut
 * « leroymerlin Number », préfixe 014) les distingue. Le plan contient donc aussi une requête GraphQL « classification »
 * (nom + numéro d'origine des commandes Leroy Merlin de la fenêtre, lecture seule) dont apply relit les pages dans la
 * transcription (ou --ordres-lm) : une commande Leroy Merlin dont le numéro n'a pas été lu fait échouer l'extraction.
 * Site web : apply interroge lui-même le relais en lecture seule (api/mcp-site.mjs, variable MCP_SITE_KEY), ou lit un
 * fichier --results-site écrit par scripts/extension/site_query.mjs.
 * Aucune donnée client : uniquement des agrégats (jour, commande, référence, pays, passerelle) et le numéro d'origine.
 *
 * Codes de sortie : 0 ok · 2 contrôle de cohérence échoué (rien n'est écrit) · 3 résultats manquants · 1 erreur d'utilisation.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SCHEMA, validerExtension } from "../../extension.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RACINE = path.resolve(__dirname, "..", "..");
const APP = path.join(RACINE, "App.jsx");
const FICHIER = path.join(RACINE, "shopify_extension.json");
const META = path.join(RACINE, "data", "produits_meta.json");
const N1 = path.join(RACINE, "data", "n1_2025.json");

/* ------------------------------------------------------------------ réglages */
export const CFG = {
  tva: 1.2, // même convention que l'ODP : CA HT = TTC ÷ 1,2
  limiteLignes: 3000, // lignes par requête et par jour (une journée en compte ~200)
  tolerance: 0.011, // écart toléré (€ ou unités) entre les lignes d'un jour et le total du jour
  sansPaiementMax: 0.02, // part maximale des commandes sans passerelle (hors commandes à 0 €)
  inconnuAvert: 0.03, // part du CA (références ou passerelles inconnues) au-delà de laquelle on avertit
  ecartTotalEchec: 0.15, // jours repris : variation relative du total au-delà de laquelle on refuse
};

export const BOUTIQUES = {
  marketplaces: { id: "marketplaces", nom: "BESTHERM", domaine: "46a3f9-2.myshopify.com", domaineObligatoire: false },
  site: { id: "site", nom: "bestherm.fr", domaine: "besthermshop.myshopify.com", domaineObligatoire: true },
};

// Passerelle de paiement Shopify (« xxx via Shopping Feed ») → marketplace de l'ODP. Clés en minuscules, sans le suffixe.
// « leroymerlin » couvre Leroy Merlin ET Technomat : Shopify ne les distingue que par le numéro d'origine de la commande
// (voir TECHNOMAT ci-dessous et le README).
export const PASSERELLES = {
  leroymerlin: "Leroy Merlin", amazon: "Amazon FR", "amazon fba": "Amazon FR",
  epmm: "ManoMano", monechelle: "ManoMano", manomano: "ManoMano", manomanopro: "ManoMano",
  cdiscount: "Cdiscount", clogistique: "Cdiscount", maxeda: "Maxeda", castoramafr: "Castorama",
  bricomarche: "Bricomarché", dartybomp: "Darty", darty: "Darty", boulanger: "Boulanger", bricobravo: "Brico Bravo",
  but: "But", worten: "Worten", bol: "Bol.com",
};
const MP_SITE = "Site Web", MP_AUTRE = "Autre";

// Technomat : commandes de la passerelle Leroy Merlin dont le numéro d'origine (attribut de commande « leroymerlin Number »,
// ex. « 014-120208-A ») commence par 014. C'est exactement la ligne « BRICOMAN » de l'ODP (janvier → 3 octobre 2026 : 961 lignes,
// 89,6 k€ HT des deux côtés), désormais nommée Technomat. Les autres préfixes (001 France, 002 Espagne, 003 Portugal, 005,
// 006) restent dans Leroy Merlin.
export const TECHNOMAT = { mp: "Technomat", depuis: "Leroy Merlin", prefixe: "014" };
export const PREFIXES_LM = new Set(["001", "002", "003", "005", "006", TECHNOMAT.prefixe]);
export function estTechnomat(numero) {
  if (typeof numero !== "string") return false;
  const n = numero.trim();
  return n.startsWith(TECHNOMAT.prefixe) && !/^\d/.test(n.slice(TECHNOMAT.prefixe.length));
}
/** Préfixe à trois chiffres d'un numéro d'origine (« 014-120208-A » → « 014 »), ou null si le format est inattendu. */
export const prefixeNumero = (numero) => (/^\s*(\d{3})(?!\d)/.exec(String(numero ?? "")) ?? [])[1] ?? null;

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
const PAYS_INCONNU = "Non renseigné";
const MARQUES_VENDEUR = { bestherm: "Bestherm", thomson: "Thomson", "hom'y": "HOM'Y", homy: "HOM'Y" };

/* ------------------------------------------------------------------ utilitaires */
const D = (s) => { const [y, m, d] = s.split("-").map(Number); return Date.UTC(y, m - 1, d); };
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
export const addDays = (s, n) => iso(D(s) + n * 864e5);
const r2 = (x) => Math.round(x * 100) / 100;
const pct = (x) => (Math.abs(x) < 0.0005 ? "0.0 %" : `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)} %`);
const eur = (x) => new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(Math.round(x)) + " €";
const jours = (du, au) => { const l = []; for (let d = du; d <= au; d = addDays(d, 1)) l.push(d); return l; };

export function parisToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export class Echec extends Error {
  constructor(msg, code = 2) { super(msg); this.code = code; }
}

function args(argv) {
  const o = { _: [], transcript: [], resultsSite: [], ordresLm: [], reprendre: 0 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--today") o.today = argv[++i];
    else if (a === "--du") o.du = argv[++i];
    else if (a === "--au") o.au = argv[++i];
    else if (a === "--reprendre") o.reprendre = Number(argv[++i]);
    else if (a === "--boutique") o.boutique = argv[++i];
    else if (a === "--transcript") o.transcript.push(argv[++i]);
    else if (a === "--results-site") o.resultsSite.push(argv[++i]);
    else if (a === "--ordres-lm") o.ordresLm.push(argv[++i]);
    else if (a === "--out") o.out = argv[++i];
    else if (a === "--dry-run") o.dry = true;
    else if (a === "--force") o.force = true;
    else if (a === "--garder-odp") o.garderOdp = true; // jours déjà couverts par l'ODP conservés (contrôle ODP / Shopify)
    else if (a.startsWith("--")) throw new Echec(`Option inconnue : ${a}`, 1);
    else o._.push(a);
  }
  for (const k of ["today", "du", "au"]) if (o[k] && !/^\d{4}-\d{2}-\d{2}$/.test(o[k])) throw new Echec(`--${k} attend AAAA-MM-JJ`, 1);
  if (!Number.isInteger(o.reprendre) || o.reprendre < 0 || o.reprendre > 14) throw new Echec("--reprendre attend un entier entre 0 et 14", 1);
  if (o.boutique !== undefined && !Object.hasOwn(BOUTIQUES, o.boutique)) throw new Echec(`--boutique attend ${Object.keys(BOUTIQUES).join(" ou ")}`, 1);
  return o;
}

/* ------------------------------------------------------------------ lecture de App.jsx et des tables */
function grabConst(src, name) {
  const m = new RegExp("^const " + name + " = (.*);[ \\t]*$", "m").exec(src);
  if (!m) throw new Echec(`Constante ${name} introuvable dans App.jsx`, 1);
  try { return JSON.parse(m[1]); } catch { throw new Echec(`Constante ${name} illisible (JSON attendu)`, 1); }
}

export function lireApp() {
  const src = fs.readFileSync(APP, "utf8");
  const dm = /const DMIN = "(\d{4}-\d{2}-\d{2})", DMAX_ODP = "(\d{4}-\d{2}-\d{2})";/.exec(src);
  if (!dm) throw new Echec("DMIN / DMAX_ODP introuvables dans App.jsx", 1);
  if (!src.includes('from "./shopify_extension.json"')) throw new Echec("App.jsx n'importe plus shopify_extension.json : le prolongement ne s'afficherait pas", 1);
  const lire = (f, nom) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { throw new Echec(`${nom} illisible ou absent (${path.relative(RACINE, f)})`, 1); } };
  const meta = lire(META, "table des produits");
  const abc = grabConst(src, "ABC_BY_SKU");
  const codes = new Map();
  for (const [code, nom] of abc) codes.set(String(code).toUpperCase(), nom);
  for (const [code, nom] of Object.entries(meta.skus || {})) codes.set(code.toUpperCase(), nom);
  const i18n = grabConst(src, "PAYS_I18N");
  const enFr = new Map(Object.entries(PAYS_EN_FR));
  for (const [fr, v] of Object.entries(i18n)) if (v?.en && !enFr.has(v.en)) enFr.set(v.en, fr);
  let precedent = null;
  if (fs.existsSync(FICHIER)) precedent = lire(FICHIER, "shopify_extension.json");
  return {
    src, dmaxOdp: dm[2], meta, codes, enFr, precedent,
    produits: new Set(grabConst(src, "SKU_PRODUIT")), mps: new Set(grabConst(src, "SKU_MPS")),
    n1: fs.existsSync(N1) ? JSON.parse(fs.readFileSync(N1, "utf8")) : null,
  };
}

/* ------------------------------------------------------------------ plan des requêtes */
export const REQ = {
  ventes: (d) => `FROM sales SHOW quantity_ordered, net_sales, taxes GROUP BY order_name, product_variant_sku, shipping_country, product_vendor WHERE line_type = 'product' SINCE ${d} UNTIL ${d} ORDER BY order_name LIMIT ${CFG.limiteLignes}`,
  paiements: (d) => `FROM payments SHOW gross_payments GROUP BY order_name, payment_gateway SINCE ${d} UNTIL ${d} ORDER BY order_name LIMIT ${CFG.limiteLignes}`,
  controle: (du, au) => `FROM sales SHOW orders, quantity_ordered, net_sales TIMESERIES day SINCE ${du} UNTIL ${au}`,
  ventesSite: (d) => `FROM sales SHOW quantity_ordered, gross_sales GROUP BY order_name, product_variant_sku, shipping_country, product_vendor WHERE line_type = 'product' SINCE ${d} UNTIL ${d} ORDER BY order_name LIMIT ${CFG.limiteLignes}`,
  controleSite: (du, au) => `FROM sales SHOW orders, quantity_ordered, gross_sales TIMESERIES day SINCE ${du} UNTIL ${au}`,
};

/** Minuit (heure de Paris) du jour AAAA-MM-JJ avec son décalage : « 2026-10-26T00:00:00+01:00 » (+02:00 en heure d'été). */
export function minuitParis(d) {
  const fmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  for (const off of ["+01:00", "+02:00"]) {
    const p = Object.fromEntries(fmt.formatToParts(new Date(`${d}T00:00:00${off}`)).map((x) => [x.type, x.value]));
    if (`${p.year}-${p.month}-${p.day}` === d && p.hour === "00" && p.minute === "00") return `${d}T00:00:00${off}`;
  }
  throw new Echec(`Date illisible pour le fuseau de Paris : ${d}`, 1);
}

// Requête GraphQL de classification (lecture seule, aucune donnée client) : nom et attributs de commande des commandes de la
// passerelle Leroy Merlin créées entre deux minuits (heure de Paris). Pages de PAGE_GQL commandes, à suivre avec `after`.
export const PAGE_GQL = 50;
export const GQL = {
  commandesLm: (du, au) => `query($first:Int,$after:String){ orders(first:$first, after:$after, sortKey:CREATED_AT, query:"gateway:'leroymerlin via Shopping Feed' created_at:>=${minuitParis(du)} created_at:<${minuitParis(addDays(au, 1))}"){ edges{ node{ name customAttributes{ key value } } } pageInfo{ hasNextPage endCursor } } }`,
};

// Fenêtre à extraire : du lendemain de la dernière donnée connue jusqu'à hier (heure de Paris).
// --du force le début ; --reprendre N reprend les N derniers jours déjà extraits (corrections tardives).
export function fenetre(app, today, o = {}, boutique) {
  const au = o.au ?? addDays(today, -1);
  let du;
  if (o.du) du = o.du;
  else {
    const prec = app.precedent?.boutiques?.[boutique]?.au;
    const dernier = prec && prec > app.dmaxOdp ? prec : app.dmaxOdp;
    du = addDays(dernier, 1 - (o.reprendre || 0));
    if (du <= app.dmaxOdp) du = addDays(app.dmaxOdp, 1);
  }
  return { du, au, vide: du > au };
}

export function planifier(app, today, o = {}, boutique = "marketplaces") {
  const f = fenetre(app, today, o, boutique);
  const p = { boutique, today, dmaxOdp: app.dmaxOdp, ...f, queries: [] };
  if (p.vide) return p;
  const q = (id, query) => p.queries.push({ id, query });
  if (boutique === "marketplaces") {
    for (const d of jours(f.du, f.au)) { q(`ventes ${d}`, REQ.ventes(d)); q(`paiements ${d}`, REQ.paiements(d)); }
    q("controle", REQ.controle(f.du, f.au));
    // classification Technomat : outil graphql_query (lecture seule), query = texte exact, first = 50, puis after = endCursor
    p.classification = {
      du: f.du, au: f.au, outil: "graphql_query", first: PAGE_GQL, graphql: GQL.commandesLm(f.du, f.au),
      pages: "Lancer la requête avec first = 50, puis de nouveau avec after = pageInfo.endCursor tant que pageInfo.hasNextPage vaut true (toutes les pages).",
    };
  } else {
    for (const d of jours(f.du, f.au)) q(`ventes ${d}`, REQ.ventesSite(d));
    q("controle", REQ.controleSite(f.du, f.au));
  }
  return p;
}

/* ------------------------------------------------------------------ résultats ShopifyQL */
function* fichiersTranscription(explicites) {
  if (explicites.length) { yield* explicites; return; }
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

// Résultats rangés par boutique ET texte de requête : deux boutiques ne s'écrasent jamais
const cle = (domaine, query) => `${domaine ?? ""}\u0000${query}`;
const ranger = (res, r) => res.set(cle(r.shopDomain, r.query), r);

function lireJsonl(fichier, res) {
  let lignes;
  try { lignes = fs.readFileSync(fichier, "utf8").split("\n"); } catch { return; }
  for (const l of lignes) {
    if (!l.includes('"tool_result"') || !l.includes("rows")) continue;
    let o; try { o = JSON.parse(l); } catch { continue; }
    const c = o?.message?.content;
    if (!Array.isArray(c)) continue;
    for (const b of c) {
      if (b?.type !== "tool_result") continue;
      const texte = typeof b.content === "string" ? b.content : Array.isArray(b.content) ? b.content.map((x) => x?.text ?? "").join("") : "";
      if (!texte.startsWith('{"query"')) continue;
      let j; try { j = JSON.parse(texte); } catch { continue; }
      if (typeof j.query === "string" && Array.isArray(j.rows) && Array.isArray(j.columns)) ranger(res, j);
    }
  }
}

function lireJson(fichier, res) {
  let j;
  try { j = JSON.parse(fs.readFileSync(fichier, "utf8")); } catch { throw new Echec(`Fichier de résultats illisible : ${fichier}`, 1); }
  for (const r of Array.isArray(j) ? j : [j]) if (typeof r?.query === "string" && Array.isArray(r.rows)) ranger(res, r);
}

/* ------------------------------------------------------------------ classification Technomat (GraphQL) */
// Numéro d'origine d'une commande marketplace : attribut dont la clé se termine par « Number » (« leroymerlin Number »).
// Chaîne vide = commande lue mais sans numéro.
export function numeroOrigine(attributs) {
  for (const a of Array.isArray(attributs) ? attributs : []) if (/number$/i.test(String(a?.key ?? "").trim())) return String(a?.value ?? "").trim();
  return "";
}

// Range les commandes d'une page de résultat GraphQL (data.orders.edges[].node ou data.orders.nodes[]) : nom → numéro d'origine
function rangerOrdres(res, j) {
  const o = j?.data?.orders;
  const noeuds = Array.isArray(o?.edges) ? o.edges.map((e) => e?.node) : Array.isArray(o?.nodes) ? o.nodes : [];
  for (const n of noeuds) if (typeof n?.name === "string" && Array.isArray(n.customAttributes)) res.set(n.name, numeroOrigine(n.customAttributes));
}

function lireJsonlOrdres(fichier, res) {
  let lignes;
  try { lignes = fs.readFileSync(fichier, "utf8").split("\n"); } catch { return; }
  for (const l of lignes) {
    if (!l.includes('"tool_result"') || !l.includes("customAttributes")) continue;
    let o; try { o = JSON.parse(l); } catch { continue; }
    const c = o?.message?.content;
    if (!Array.isArray(c)) continue;
    for (const b of c) {
      if (b?.type !== "tool_result") continue;
      const texte = typeof b.content === "string" ? b.content : Array.isArray(b.content) ? b.content.map((x) => x?.text ?? "").join("") : "";
      if (!texte.startsWith('{"data"')) continue;
      let j; try { j = JSON.parse(texte); } catch { continue; }
      rangerOrdres(res, j);
    }
  }
}

// --ordres-lm : fichier JSON { "SHOP1": "014-1-A", … } ou page(s) de résultat GraphQL
function lireOrdresJson(fichier, res) {
  let j;
  try { j = JSON.parse(fs.readFileSync(fichier, "utf8")); } catch { throw new Echec(`Fichier --ordres-lm illisible : ${fichier}`, 1); }
  if (j && typeof j === "object" && !Array.isArray(j) && !j.data) { for (const [nom, num] of Object.entries(j)) if (typeof num === "string") res.set(nom, num.trim()); return; }
  for (const p of Array.isArray(j) ? j : [j]) rangerOrdres(res, p);
}

/** Map nom de commande → numéro d'origine, relue dans les transcriptions (ou dans --ordres-lm). Peut être vide : c'est
 *  construireBoutique qui exige la couverture de toutes les commandes Leroy Merlin de chaque jour. */
export function collecterNumeros(o) {
  const res = new Map();
  if (o.ordresLm?.length) { for (const f of o.ordresLm) lireOrdresJson(f, res); return res; }
  for (const f of fichiersTranscription(o.transcript ?? [])) {
    const r = new Map();
    lireJsonlOrdres(f, r);
    for (const [k, v] of r) if (!res.has(k)) res.set(k, v); // le fichier le plus récent prime
  }
  return res;
}

// Renvoie Map(query → résultat) pour LA boutique, ou lève Echec(3) avec la liste des requêtes manquantes
export function collecter(plan, o, boutique, resultatsSite = []) {
  const b = BOUTIQUES[boutique];
  const trouver = (res, q) => res.get(cle(b.domaine, q.query)) ?? (b.domaineObligatoire ? undefined : res.get(cle(undefined, q.query)));
  const manquants = (res) => plan.queries.filter((q) => !trouver(res, q));
  const brut = new Map();
  for (const f of resultatsSite) lireJson(f, brut);
  if (!resultatsSite.length) {
    for (const f of fichiersTranscription(o.transcript)) {
      const r = new Map();
      lireJsonl(f, r);
      for (const [k, v] of r) if (!brut.has(k)) brut.set(k, v); // le fichier le plus récent prime
      if (manquants(brut).length === 0) break;
    }
  }
  const absents = manquants(brut);
  if (absents.length) {
    throw new Echec(
      `Résultats ShopifyQL manquants (boutique ${boutique}, ${b.domaine}) pour : ${absents.slice(0, 12).map((q) => q.id).join(", ")}${absents.length > 12 ? ` … (+${absents.length - 12})` : ""}. ` +
      "Lancer exactement les requêtes affichées par la commande « plan » (même --today, mêmes options).", 3);
  }
  const out = new Map();
  for (const q of plan.queries) {
    const r = trouver(brut, q);
    const ok = b.domaineObligatoire ? r.shopDomain === b.domaine : !r.shopDomain || r.shopDomain === b.domaine;
    if (!ok) throw new Echec(`Boutique inattendue (${r.shopDomain ?? "non indiquée"}) : ${b.domaine} attendu. Aucune écriture.`);
    out.set(q.query, r);
  }
  return out;
}

const colonne = (res, nom) => {
  const i = res.columns.findIndex((c) => c.name === nom);
  if (i < 0) throw new Echec(`Colonne « ${nom} » absente du résultat « ${res.query.slice(0, 80)} »`);
  return i;
};
const nombre = (v, ctx) => {
  const x = Number(v);
  if (!Number.isFinite(x)) throw new Echec(`Valeur non numérique (${ctx}) : ${JSON.stringify(v)}`);
  return x;
};

/* ------------------------------------------------------------------ correspondances */
export function normaliserSku(s) {
  return s.trim().replace(/(_never_used| never used)$/i, "").replace(/-FLM$/i, "").replace(/\//g, "-");
}

export function marketplaceDe(passerelle) {
  if (!passerelle) return null;
  const k = passerelle.toLowerCase().replace(/\s+via\s+shopping\s+feed\s*$/i, "").trim();
  return PASSERELLES[k] ?? null;
}

// Rattache une référence Shopify à un produit de l'application ; renvoie { nom, connu }
function produitDe(brut, app) {
  const code = normaliserSku(brut);
  const nom = app.codes.get(code.toUpperCase());
  if (nom) return { nom, connu: true, code };
  return { nom: code, connu: false, code };
}

// Marque et norme d'un produit : table de l'application, sinon marque du vendeur Shopify
function metaDe(nom, vendeur, app) {
  const m = app.meta.produits?.[nom];
  if (m) return { marque: m[0], norme: m[1] ?? null, connu: true };
  return { marque: MARQUES_VENDEUR[String(vendeur || "").toLowerCase()] ?? "Bestherm", norme: null, connu: false };
}

/* ------------------------------------------------------------------ construction des lignes d'un jour */
// Agrège (jour, marketplace, produit, pays) → { qte, ca, nl }. `stats` reçoit les contrôles du jour.
class Cumul {
  constructor() { this.m = new Map(); }
  ajouter(d, mp, produit, pays, qte, ca) {
    const k = `${d}\u0000${mp}\u0000${produit}\u0000${pays}`;
    const a = this.m.get(k) ?? { d, mp, produit, pays, qte: 0, ca: 0, nl: 0 };
    a.qte += qte; a.ca += ca; a.nl += 1;
    this.m.set(k, a);
  }
  lignes() { return [...this.m.values()]; }
}

function lignesMarketplaces(d, ventes, paiements, app, cum, st, numeros) {
  const iO = colonne(ventes, "order_name"), iS = colonne(ventes, "product_variant_sku"), iC = colonne(ventes, "shipping_country");
  const iV = colonne(ventes, "product_vendor"), iQ = colonne(ventes, "quantity_ordered"), iN = colonne(ventes, "net_sales"), iT = colonne(ventes, "taxes");
  if (ventes.rows.length >= CFG.limiteLignes) throw new Echec(`${d} : limite de ${CFG.limiteLignes} lignes atteinte (liste tronquée)`);
  if (paiements.rows.length >= CFG.limiteLignes) throw new Echec(`${d} : limite de ${CFG.limiteLignes} paiements atteinte (liste tronquée)`);
  // commande → passerelle dominante (plus gros montant payé)
  const jO = colonne(paiements, "order_name"), jG = colonne(paiements, "payment_gateway"), jP = colonne(paiements, "gross_payments");
  const pass = new Map();
  for (const r of paiements.rows) {
    const o = String(r[jO]), g = String(r[jG] ?? ""), v = nombre(r[jP], "paiements");
    const a = pass.get(o) ?? [];
    a.push({ g, v });
    pass.set(o, a);
  }
  const dominante = new Map();
  for (const [o, l] of pass) {
    l.sort((x, y) => y.v - x.v);
    dominante.set(o, l[0].g);
    if (new Set(l.map((x) => marketplaceDe(x.g) ?? x.g)).size > 1) st.multiPasserelle.push(o);
  }
  const commandes = new Map(); // commande → { ca, lignes: [...] }
  for (const r of ventes.rows) {
    const o = String(r[iO]);
    const qte = nombre(r[iQ], "quantité"), net = nombre(r[iN], "ventes nettes"), tax = nombre(r[iT], "taxes");
    st.qte += qte; st.net += net;
    if (qte === 0 && net === 0 && tax === 0) continue; // ligne vide
    const c = commandes.get(o) ?? { ca: 0, lignes: [] };
    const ht = (net + tax) / CFG.tva;
    c.ca += ht;
    c.lignes.push({ sku: String(r[iS] ?? "").trim(), pays: String(r[iC] ?? "").trim(), vendeur: String(r[iV] ?? ""), qte, ht });
    commandes.set(o, c);
  }
  st.commandes = commandes.size;
  for (const [o, c] of commandes) {
    const g = dominante.get(o);
    let mp = marketplaceDe(g);
    if (g === undefined) {
      st.sansPaiement++;
      if (Math.abs(c.ca) > 0.005) { st.sansPaiementCa += c.ca; st.sansPaiementListe.push(o); }
      mp = MP_AUTRE; // commandes à 0 € (envois de remplacement) : sans paiement, classées « Autre »
    } else if (!mp) {
      st.passerellesInconnues.set(g, (st.passerellesInconnues.get(g) ?? 0) + c.ca);
      mp = MP_AUTRE;
    } else if (mp === TECHNOMAT.depuis) {
      // Leroy Merlin ou Technomat : seul le numéro d'origine de la commande les distingue (préfixe 014 = Technomat)
      const num = numeros?.get(o);
      if (num === undefined) st.sansNumero.push(o); // numéro non lu : on n'écrit rien (voir ci-dessous)
      else {
        if (estTechnomat(num)) { mp = TECHNOMAT.mp; st.technomat.commandes++; st.technomat.ca += c.ca; }
        const pre = prefixeNumero(num);
        if (pre === null || !PREFIXES_LM.has(pre)) st.numerosInattendus.set(num || "(vide)", (st.numerosInattendus.get(num || "(vide)") ?? 0) + 1);
      }
    }
    for (const l of c.lignes) rattacher(d, mp, l, app, cum, st);
  }
  if (st.sansNumero.length) {
    throw new Echec(
      `${d} : ${st.sansNumero.length} commande(s) Leroy Merlin dont le numéro d'origine n'a pas été lu (${st.sansNumero.slice(0, 6).join(", ")}${st.sansNumero.length > 6 ? " …" : ""}) : ` +
      "classification Technomat incomplète. Lancer la requête GraphQL « classification » du plan (toutes les pages), puis relancer apply. Aucune écriture.", 3);
  }
}

function lignesSite(d, ventes, app, cum, st) {
  const iO = colonne(ventes, "order_name"), iS = colonne(ventes, "product_variant_sku"), iC = colonne(ventes, "shipping_country");
  const iV = colonne(ventes, "product_vendor"), iQ = colonne(ventes, "quantity_ordered"), iG = colonne(ventes, "gross_sales");
  if (ventes.rows.length >= CFG.limiteLignes) throw new Echec(`${d} : limite de ${CFG.limiteLignes} lignes atteinte (liste tronquée)`);
  const cmd = new Set();
  for (const r of ventes.rows) {
    const qte = nombre(r[iQ], "quantité"), brut = nombre(r[iG], "ventes brutes");
    st.qte += qte; st.net += brut;
    if (qte <= 0 && Math.abs(brut) < 0.005) { st.lignesVides++; continue; } // ligne retirée de la commande
    cmd.add(String(r[iO]));
    rattacher(d, MP_SITE, { sku: String(r[iS] ?? "").trim(), pays: String(r[iC] ?? "").trim(), vendeur: String(r[iV] ?? ""), qte, ht: brut }, app, cum, st);
  }
  st.commandes = cmd.size;
}

function rattacher(d, mp, l, app, cum, st) {
  if (!l.sku) { st.sansReference += l.ht; return; }
  const p = produitDe(l.sku, app);
  if (!p.connu) { const a = st.skuInconnus.get(p.code) ?? { ca: 0, qte: 0, vendeur: l.vendeur }; a.ca += l.ht; a.qte += l.qte; st.skuInconnus.set(p.code, a); }
  const m = metaDe(p.nom, l.vendeur, app);
  if (m.connu) { // contrôle de cohérence marque produit / vendeur Shopify (information)
    const mv = MARQUES_VENDEUR[String(l.vendeur || "").toLowerCase()];
    if (mv && mv !== m.marque) st.marqueDivergente.set(p.nom, `${m.marque} (table) ≠ ${mv} (Shopify)`);
  }
  if (!app.meta.produits?.[p.nom]) st.produitsNouveaux.set(p.nom, { marque: m.marque, norme: m.norme });
  let pays = app.enFr.get(l.pays);
  if (!pays) { pays = l.pays ? l.pays : PAYS_INCONNU; if (l.pays) st.paysInconnus.add(l.pays); }
  st.ca += l.ht;
  cum.ajouter(d, mp, p.nom, pays, l.qte, l.ht);
}

const statsVides = () => ({
  qte: 0, net: 0, ca: 0, commandes: 0, sansPaiement: 0, sansPaiementCa: 0, sansPaiementListe: [], multiPasserelle: [],
  passerellesInconnues: new Map(), skuInconnus: new Map(), marqueDivergente: new Map(), produitsNouveaux: new Map(),
  paysInconnus: new Set(), sansReference: 0, lignesVides: 0,
  sansNumero: [], technomat: { commandes: 0, ca: 0 }, numerosInattendus: new Map(),
});

/* ------------------------------------------------------------------ une boutique : fenêtre → lignes */
export function construireBoutique(app, plan, resultats, boutique, avert, numeros = null) {
  const rs = (q) => resultats.get(q);
  const cum = new Cumul();
  const ctrlQ = plan.queries.find((q) => q.id === "controle").query;
  const ctrl = rs(ctrlQ);
  const cd = colonne(ctrl, "day"), cq = colonne(ctrl, "quantity_ordered");
  const cn = colonne(ctrl, boutique === "site" ? "gross_sales" : "net_sales");
  const attendu = new Map(ctrl.rows.map((r) => [String(r[cd]).slice(0, 10), { qte: nombre(r[cq], "contrôle"), v: nombre(r[cn], "contrôle") }]));
  const parJour = [];
  const globaux = statsVides();
  for (const d of jours(plan.du, plan.au)) {
    const st = statsVides();
    if (boutique === "marketplaces") lignesMarketplaces(d, rs(REQ.ventes(d)), rs(REQ.paiements(d)), app, cum, st, numeros);
    else lignesSite(d, rs(REQ.ventesSite(d)), app, cum, st);
    const a = attendu.get(d) ?? { qte: 0, v: 0 };
    if (Math.abs(st.qte - a.qte) > CFG.tolerance || Math.abs(st.net - a.v) > Math.max(CFG.tolerance, 0.00001 * a.v)) {
      throw new Echec(`${boutique} ${d} : lignes (${st.qte} u., ${r2(st.net)} €) ≠ total du jour Shopify (${a.qte} u., ${r2(a.v)} €) : extraction incomplète ou filtre inattendu. Aucune écriture.`);
    }
    if (boutique === "marketplaces" && st.commandes > 0) {
      const part = (st.sansPaiement - st.sansPaiementListe.length) >= 0 ? st.sansPaiementListe.length / st.commandes : 0;
      if (part > CFG.sansPaiementMax) throw new Echec(`${d} : ${st.sansPaiementListe.length} commandes avec CA sans passerelle de paiement sur ${st.commandes} (${(part * 100).toFixed(1)} %) : jeu « payments » incomplet. Aucune écriture.`);
    }
    parJour.push({ d, ...st });
    for (const k of ["qte", "net", "ca", "commandes", "sansPaiement", "sansPaiementCa", "sansReference", "lignesVides"]) globaux[k] += st[k];
    globaux.sansPaiementListe.push(...st.sansPaiementListe); globaux.multiPasserelle.push(...st.multiPasserelle);
    for (const [k, v] of st.passerellesInconnues) globaux.passerellesInconnues.set(k, (globaux.passerellesInconnues.get(k) ?? 0) + v);
    for (const [k, v] of st.skuInconnus) { const a = globaux.skuInconnus.get(k) ?? { ca: 0, qte: 0, vendeur: v.vendeur }; a.ca += v.ca; a.qte += v.qte; globaux.skuInconnus.set(k, a); }
    globaux.technomat.commandes += st.technomat.commandes; globaux.technomat.ca += st.technomat.ca;
    for (const [k, v] of st.numerosInattendus) globaux.numerosInattendus.set(k, (globaux.numerosInattendus.get(k) ?? 0) + v);
    for (const [k, v] of st.marqueDivergente) globaux.marqueDivergente.set(k, v);
    for (const [k, v] of st.produitsNouveaux) globaux.produitsNouveaux.set(k, v);
    for (const p of st.paysInconnus) globaux.paysInconnus.add(p);
  }
  const lignes = cum.lignes();
  if (!lignes.some((l) => l.qte > 0)) throw new Echec(`${boutique} : aucune vente sur ${plan.du} → ${plan.au} : extraction suspecte. Aucune écriture.`);
  // avertissements
  if (globaux.passerellesInconnues.size) {
    const tot = [...globaux.passerellesInconnues.values()].reduce((a, b) => a + b, 0);
    avert.push(`Passerelles de paiement inconnues, classées « Autre » (${eur(tot)}) : ${[...globaux.passerellesInconnues].map(([g, v]) => `${g} ${eur(v)}`).join(", ")}`);
  }
  if (globaux.sansPaiementListe.length) avert.push(`${globaux.sansPaiementListe.length} commande(s) avec CA sans passerelle (classées « Autre », ${eur(globaux.sansPaiementCa)}) : ${globaux.sansPaiementListe.slice(0, 6).join(", ")}`);
  if (globaux.skuInconnus.size) {
    const tot = [...globaux.skuInconnus.values()].reduce((a, b) => a + b.ca, 0);
    avert.push(`Références non rattachées à un produit (${eur(tot)}, ${((tot / (globaux.ca || 1)) * 100).toFixed(1)} % du CA) : ${[...globaux.skuInconnus].slice(0, 8).map(([c, v]) => `${c} ${eur(v.ca)}`).join(", ")}`);
  }
  if (globaux.marqueDivergente.size) avert.push(`Marque de la table ≠ marque Shopify pour : ${[...globaux.marqueDivergente].slice(0, 6).map(([p, t]) => `${p} ${t}`).join(" ; ")}`);
  if (globaux.paysInconnus.size) avert.push(`Pays sans traduction (conservés tels quels) : ${[...globaux.paysInconnus].join(", ")}`);
  if (globaux.multiPasserelle.length) avert.push(`${globaux.multiPasserelle.length} commande(s) payée(s) via plusieurs marketplaces (passerelle dominante retenue)`);
  if (globaux.numerosInattendus.size) {
    const n = [...globaux.numerosInattendus.values()].reduce((a, b) => a + b, 0);
    avert.push(`${n} commande(s) Leroy Merlin dont le numéro d'origine n'a pas un préfixe connu (${[...PREFIXES_LM].sort().join(", ")}) : laissées dans Leroy Merlin · ${[...globaux.numerosInattendus].slice(0, 5).map(([x, c]) => `${x} ×${c}`).join(", ")}`);
  }
  if (globaux.sansReference > 0.5) avert.push(`Lignes sans référence (${eur(globaux.sansReference)}) ignorées`);
  return { lignes, parJour, globaux, produitsNouveaux: globaux.produitsNouveaux, technomat: globaux.technomat };
}

/* ------------------------------------------------------------------ fusion et écriture */
// Fusionne les lignes des boutiques traitées avec celles de l'extraction précédente (par marketplace : « Site Web »
// pour la boutique du site, toutes les autres pour la boutique des marketplaces) et reconstruit les dictionnaires.
export function fusionner(app, precedent, blocs, today, garderOdp = false) {
  const ancien = precedent && validerExtension(precedent, app.dmaxOdp).ok ? decoderAncien(precedent) : [];
  const boutiques = { ...(precedent?.boutiques ?? {}) };
  const nouvelles = [];
  const traitees = new Set();
  for (const [id, b] of Object.entries(blocs)) {
    traitees.add(id);
    boutiques[id] = { au: b.plan.au, nom: BOUTIQUES[id].nom, domaine: BOUTIQUES[id].domaine, extrait_a: new Date().toISOString() };
    for (const l of b.lignes) nouvelles.push(l);
  }
  const estSite = (mp) => mp === MP_SITE;
  const garde = [];
  for (const l of ancien) {
    const id = estSite(l.mp) ? "site" : "marketplaces";
    const b = blocs[id];
    if (b && l.d >= b.plan.du && l.d <= b.plan.au) continue; // jour (re)extrait : remplacé
    garde.push(l);
  }
  let toutes = [...garde, ...nouvelles];
  if (!garderOdp) toutes = toutes.filter((l) => l.d > app.dmaxOdp);
  toutes.sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : a.mp < b.mp ? -1 : a.mp > b.mp ? 1 : a.produit < b.produit ? -1 : a.produit > b.produit ? 1 : a.pays < b.pays ? -1 : a.pays > b.pays ? 1 : 0));
  // dictionnaires
  const mp = [...new Set(toutes.map((l) => l.mp))].sort();
  const pays = [...new Set(toutes.map((l) => l.pays))].sort();
  const noms = [...new Set(toutes.map((l) => l.produit))].sort();
  const produits = noms.map((nom) => {
    const m = app.meta.produits?.[nom];
    const nv = blocs && Object.values(blocs).map((b) => b.produitsNouveaux.get(nom)).find(Boolean);
    const avantDico = precedent?.produits?.find((p) => p[0] === nom);
    const marque = m ? m[0] : nv?.marque ?? avantDico?.[1] ?? "Bestherm";
    const norme = m ? m[1] ?? null : nv?.norme ?? avantDico?.[2] ?? null;
    const e = [nom, marque, norme];
    if (!app.produits.has(nom)) e.push(avantDico?.[3] ?? app.meta.attributs?.[nom] ?? {}); // produit inconnu de l'application
    return e;
  });
  const iMp = new Map(mp.map((x, i) => [x, i])), iPays = new Map(pays.map((x, i) => [x, i])), iProd = new Map(noms.map((x, i) => [x, i]));
  const auDates = Object.values(boutiques).map((b) => b.au);
  const au = auDates.reduce((a, b) => (a < b ? a : b));
  return {
    schema: SCHEMA,
    extrait_le: today,
    extrait_a: new Date().toISOString(),
    du: toutes.length ? toutes[0].d : addDays(app.dmaxOdp, 1),
    au,
    base: { marketplaces: "ca_ht = (ventes nettes + taxes) / 1,2", site: "ca_ht = ventes brutes hors taxes" },
    boutiques,
    mp, pays, produits,
    lignes: toutes.map((l) => [l.d, iMp.get(l.mp), iProd.get(l.produit), iPays.get(l.pays), l.qte, r2(l.ca), l.nl]),
  };
}

function decoderAncien(ext) {
  return ext.lignes.map(([d, im, ip, ic, qte, ca, nl]) => ({ d, mp: ext.mp[im], produit: ext.produits[ip][0], pays: ext.pays[ic], qte, ca, nl }));
}

// Une ligne par enregistrement : diffs Git lisibles
export function serialiser(e) {
  const l = ["{"];
  const cles = Object.keys(e);
  cles.forEach((k, i) => {
    const v = e[k];
    const vg = i < cles.length - 1 ? "," : "";
    if (k === "lignes" || k === "produits") {
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
function comparerAuPrecedent(neuf, prec, force, avert) {
  if (!prec || !Array.isArray(prec.lignes)) return;
  const somme = (e) => { const m = new Map(); for (const [d, , , , , ca] of e.lignes) m.set(d, (m.get(d) ?? 0) + ca); return m; };
  const a = somme(prec), b = somme(neuf);
  let sa = 0, sb = 0;
  for (const [d, v] of a) if (b.has(d)) { sa += v; sb += b.get(d); const e = b.get(d) / v - 1; if (Math.abs(e) > 0.25) avert.push(`Jour ${d} : ${pct(e)} par rapport à l'extraction précédente (${eur(v)} → ${eur(b.get(d))})`); }
  if (sa > 0 && Math.abs(sb / sa - 1) > CFG.ecartTotalEchec && !force) {
    throw new Echec(`Les jours communs avec l'extraction précédente ont varié de ${pct(sb / sa - 1)} (${eur(sa)} → ${eur(sb)}) : vérifier l'extraction (--force pour passer outre)`);
  }
  if (prec.au > neuf.au && !force) throw new Echec(`Régression : l'extraction actuelle va jusqu'au ${prec.au}, la nouvelle seulement jusqu'au ${neuf.au} (--force pour passer outre)`);
}

/* ------------------------------------------------------------------ commandes */
function resume(ext, app) {
  const t = ext.lignes.reduce((a, [, , , , q, ca, nl]) => ({ ca: a.ca + ca, q: a.q + q, nl: a.nl + nl }), { ca: 0, q: 0, nl: 0 });
  const parMp = new Map();
  for (const [, im, , , , ca] of ext.lignes) parMp.set(ext.mp[im], (parMp.get(ext.mp[im]) ?? 0) + ca);
  return [
    `Fenêtre        : ${ext.du} → ${ext.au} (ODP jusqu'au ${app.dmaxOdp})`,
    `CA HT          : ${eur(t.ca)} · ${t.q} unités · ${t.nl} lignes · ${ext.lignes.length} enregistrements`,
    `Par marketplace: ${[...parMp].sort((a, b) => b[1] - a[1]).map(([m, v]) => `${m} ${eur(v)}`).join(" · ")}`,
    `Boutiques      : ${Object.entries(ext.boutiques).map(([k, b]) => `${k} jusqu'au ${b.au}`).join(" · ")}`,
  ].join("\n");
}

// Lit la boutique du site par le relais. Toute erreur du relais (clé absente ou refusée, relais ou Shopify injoignable,
// boutique inattendue) devient un échec DE CETTE BOUTIQUE : les marketplaces sont quand même mises à jour.
async function relaisSite(plan, o) {
  const { infoBoutique, lancerRequetes, ErreurRelais } = await import("./site_query.mjs");
  try {
    await infoBoutique();
    const res = await lancerRequetes(plan.queries.map((q) => q.query));
    const f = path.join(os.tmpdir(), `extension_site_${process.pid}.json`);
    fs.writeFileSync(f, JSON.stringify(res), { mode: 0o600 });
    return f;
  } catch (e) {
    if (e instanceof ErreurRelais) throw new Echec(`Site web (relais) : ${e.message}`, 2);
    throw e;
  }
}

async function main() {
  const o = args(process.argv.slice(2));
  const cmd = o._[0];
  const today = o.today ?? parisToday();
  const app = lireApp();
  if (cmd === "check") {
    for (const id of Object.keys(BOUTIQUES)) {
      const p = planifier(app, today, o, id);
      console.log(`OK · ${id} · DMAX_ODP ${app.dmaxOdp} · extraction actuelle : ${app.precedent ? `${app.precedent.du} → ${app.precedent.au} (${id} jusqu'au ${app.precedent.boutiques?.[id]?.au ?? "—"})` : "vide"} · fenêtre du jour : ${p.vide ? "vide" : `${p.du} → ${p.au} (${p.queries.length} requêtes)`}`);
    }
    if (app.precedent) { const v = validerExtension(app.precedent, app.dmaxOdp); if (!v.ok) throw new Echec(`shopify_extension.json invalide : ${v.erreurs.join(" ; ")}`, 1); }
    console.log(`OK · table des produits : ${Object.keys(app.meta.produits).length} produits · N-1 : ${app.n1 ? `${app.n1.du} → ${app.n1.au}` : "absent"}`);
    return 0;
  }
  if (cmd === "status") {
    if (!app.precedent) { console.log(`Extraction vide (ODP jusqu'au ${app.dmaxOdp})`); return 0; }
    console.log(resume(app.precedent, app) + `\nExtrait le ${app.precedent.extrait_a}`);
    return 0;
  }
  if (cmd === "plan") {
    const ids = o.boutique ? [o.boutique] : Object.keys(BOUTIQUES);
    console.log(JSON.stringify(ids.map((id) => planifier(app, today, o, id)), null, 2));
    return 0;
  }
  if (cmd === "apply") {
    const ids = o.boutique ? [o.boutique] : Object.keys(BOUTIQUES);
    const blocs = {}, avert = [], erreurs = [];
    for (const id of ids) {
      const plan = planifier(app, today, o, id);
      if (plan.vide) { console.log(`Boutique ${id} : déjà à jour (fenêtre vide : ${plan.du} → ${plan.au}).`); continue; }
      try {
        const res = id === "site"
          ? collecter(plan, o, id, o.resultsSite.length ? o.resultsSite : [await relaisSite(plan, o)])
          : collecter(plan, o, id);
        const a = [];
        const numeros = id === "marketplaces" ? collecterNumeros(o) : null; // numéros d'origine des commandes Leroy Merlin
        const b = construireBoutique(app, plan, res, id, a, numeros);
        blocs[id] = { plan, ...b };
        for (const x of a) avert.push(`[${id}] ${x}`);
        const t = b.lignes.reduce((s, l) => ({ ca: s.ca + l.ca, q: s.q + l.qte }), { ca: 0, q: 0 });
        console.log(`Boutique ${id} : ${plan.du} → ${plan.au} · ${b.lignes.length} enregistrements · ${eur(t.ca)} · ${t.q} unités`
          + (id === "marketplaces" ? ` · dont ${TECHNOMAT.mp} ${eur(b.technomat.ca)} (${b.technomat.commandes} commande(s) ${TECHNOMAT.prefixe}…)` : ""));
      } catch (e) {
        if (!(e instanceof Echec)) throw e;
        erreurs.push(`[${id}] ${e.message}`);
        console.error(`ÉCHEC · ${id} : ${e.message}`);
        if (e.code === 1) throw e;
      }
    }
    if (!Object.keys(blocs).length) {
      for (const a of avert) console.log(`AVERTISSEMENT · ${a}`);
      if (erreurs.length) throw new Echec(`Aucune boutique mise à jour (${erreurs.length} échec(s)).`, 3);
      console.log("Rien à écrire : tout est déjà à jour.");
      return 0;
    }
    const neuf = fusionner(app, app.precedent, blocs, today, !!o.garderOdp);
    const v = validerExtension(neuf, app.dmaxOdp);
    if (!v.ok) throw new Echec(`Extraction produite invalide : ${v.erreurs.join(" ; ")}`, 1);
    comparerAuPrecedent(neuf, app.precedent, o.force, avert);
    console.log(resume(neuf, app));
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
