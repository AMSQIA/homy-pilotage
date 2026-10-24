/**
 * socle.js — construit TOUTES les données du tableau de bord à partir des ventes Shopify.
 *
 * Source unique : shopify_extension.json (ventes des deux boutiques Shopify, jour par jour : marketplaces BESTHERM +
 * site bestherm.fr) et la table de référence data/referentiel.json (nom, marque, norme et famille de chaque produit,
 * objectifs du plan). Plus aucune constante issue d'un fichier Excel : KPI, courbes mensuelles et hebdomadaires,
 * marketplaces, marques, produits, pays, catégories, prix, élasticités, paniers, comparaisons N-1… sont recalculés ici
 * à chaque chargement, à partir des mêmes lignes de vente, donc cohérents entre eux et arrêtés au même jour (DMAX).
 *
 * Principes
 *  - Module pur, sans dépendance, exécutable dans le navigateur comme sous Node (tests, scripts).
 *  - Atomique : si l'extraction est invalide, rien n'est construit (rapport.erreurs) et l'application l'affiche.
 *  - Années : AN (2026) = année en cours ; AN-1 sert aux comparaisons « même période » ; AN-2 n'alimente que les
 *    courbes mensuelles (total, marques, normes, marketplaces) comme le détail produit/pays n'existe que pour AN-1 et AN.
 *  - Comparaison N-1 à date identique : mois entiers de AN-1 avant le mois en cours + coupe du 1er du mois en cours
 *    jusqu'au même jour (les ventes de AN-1 sont lues dans les mêmes lignes quotidiennes).
 *  - Semaines : convention Excel (dimanche → samedi, semaine 1 = celle du 1er janvier), comme le plan hebdomadaire.
 *
 * Formats (voir scripts/extension/README.md)
 *  ext = { schema: 2, du, au, boutiques: { id: { au, … } },
 *          mp: [nom…], pays: [nom…], produits: [[nom, marqueVendeur, …]…],
 *          lignes:    [[jour, iMp, iProduit, quantité, caHT]…]        ventes par jour × marketplace × produit
 *          pays_jour: [[jour, iPays, iMp, caHT, quantité?]…]           ventes par jour × pays × marketplace (quantité facultative : voir PAYS_MONTHLY)
 *          commandes: [[jour, iMp, nbCommandes]…]                      commandes (CA > 0) par jour × marketplace
 *          paires:    [[jour, iProduitA, iProduitB, nbCommandes, boutique]…]  commandes contenant les deux produits (AN seulement) }
 *  ref = { objectif_annuel, objectifs_mp: { mp: { objectif, fiable } },
 *          produits: { nom: { marque, norme, famille, sous_famille, sous_sous_famille, categorie, wifi, plinthe,
 *                             vertical, destockage, code } } }
 *  La marque d'un produit est celle du fournisseur (vendor) Shopify, ext.produits[i][1] ; la marque de la table n'est
 *  qu'une marque de secours (fournisseur absent ou inconnu). Famille, norme NF/CE et indicateurs viennent de la table.
 *  opts = { an, horsShopify: { ads, country_ads } }
 */

export const SCHEMA = 2;
export const AN_DEFAUT = 2026;

const r0 = Math.round;
const r1 = (x) => Math.round(x * 10) / 10;
const r2 = (x) => Math.round(x * 100) / 100;
const zeros = () => Array(12).fill(0);
const somme = (a) => { let s = 0; for (const v of a || []) s += v || 0; return s; };
const avant = (a, n) => { let s = 0; for (let i = 0; i < n; i++) s += (a && a[i]) || 0; return s; };
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const getOrSet = (map, k, f) => { let v = map.get(k); if (v === undefined) { v = f(); map.set(k, v); } return v; };

export const MOIS_LABELS = ["Jan", "Fév", "Mar", "Avr", "Mai", "Juin", "Juil", "Août", "Sep", "Oct", "Nov", "Déc"];

// Réglages des analyses statistiques (élasticité-prix, classes ABC, paires de produits)
export const REGLAGES = {
  elasticite: { semainesMin: 4, ecartPrixMin: 0.02, fiableSemainesMin: 8, fiableR2Min: 0.25, fiableEcartPrixMin: 0.05 },
  simulationPct: 5, simulationLignes: 20,
  abc: { A: 0.5, B: 0.8, C: 0.98 }, // part cumulée du CA : A jusqu'à 50 %, B jusqu'à 80 %, C jusqu'à 98 %, D le reste
  topPaires: 60, topProduits: 15, topProduitsParMp: 8,
};

/** Numéro de semaine Excel (WEEKNUM, dimanche → samedi, semaine 1 = celle du 1er janvier) d'une date AAAA-MM-JJ. */
export function excelWeekOf(iso) {
  const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number);
  const jan1 = Date.UTC(y, 0, 1), dt = Date.UTC(y, m - 1, d);
  return Math.floor((Math.round((dt - jan1) / 86400000) + new Date(jan1).getUTCDay()) / 7) + 1;
}

const jourSuivant = (iso, n) => new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10) + n)).toISOString().slice(0, 10);

/** Dernier jour couvert par TOUTES les boutiques : le plus ancien de leurs « au » (et du champ « au » de l'extraction). */
export function auExtension(ext) {
  if (!ext || typeof ext !== "object") return null;
  const dates = [ext.au, ...Object.values(ext.boutiques || {}).map((b) => b && b.au)].filter((x) => typeof x === "string" && ISO.test(x));
  return dates.length ? dates.reduce((a, b) => (a < b ? a : b)) : null;
}

/** Contrôle de structure de l'extraction. Une extraction invalide n'est pas utilisée. */
export function validerExtension(ext) {
  const e = [];
  if (!ext || typeof ext !== "object") return { ok: false, erreurs: ["extraction absente"] };
  if (ext.schema !== SCHEMA) e.push(`schema ${ext.schema} inconnu (attendu ${SCHEMA})`);
  for (const k of ["mp", "pays", "produits", "lignes", "pays_jour", "commandes", "paires"]) if (!Array.isArray(ext[k])) e.push(`champ « ${k} » absent`);
  if (e.length) return { ok: false, erreurs: e };
  if (!auExtension(ext)) e.push("dernier jour couvert (au) absent ou illisible");
  const n = { mp: ext.mp.length, pays: ext.pays.length, produits: ext.produits.length };
  const controle = (nom, lignes, taille, f) => {
    for (const [i, l] of lignes.entries()) {
      if (!Array.isArray(l) || l.length < taille) { e.push(`${nom}, ligne ${i} : ${taille} champs attendus`); return; }
      if (typeof l[0] !== "string" || !ISO.test(l[0])) { e.push(`${nom}, ligne ${i} : jour illisible`); return; }
      const msg = f(l); if (msg) { e.push(`${nom}, ligne ${i} : ${msg}`); return; }
    }
  };
  const idx = (x, max) => Number.isInteger(x) && x >= 0 && x < max;
  const num = (...v) => v.every((x) => typeof x === "number" && Number.isFinite(x));
  controle("lignes", ext.lignes, 5, ([, im, ip, q, ca]) => (!idx(im, n.mp) || !idx(ip, n.produits) ? "index hors dictionnaire" : !num(q, ca) ? "valeur non numérique" : null));
  controle("pays_jour", ext.pays_jour, 4, ([, ic, im, ca, q]) => (!idx(ic, n.pays) || !idx(im, n.mp) ? "index hors dictionnaire" : !num(ca) || (q !== undefined && q !== null && !num(q)) ? "valeur non numérique" : null));
  controle("commandes", ext.commandes, 3, ([, im, nb]) => (!idx(im, n.mp) ? "index hors dictionnaire" : !num(nb) ? "valeur non numérique" : null));
  controle("paires", ext.paires, 4, ([, ia, ib, nb]) => (!idx(ia, n.produits) || !idx(ib, n.produits) ? "index hors dictionnaire" : !num(nb) ? "valeur non numérique" : null));
  return { ok: e.length === 0, erreurs: e };
}

/* ------------------------------------------------------------------------------------------------ statistiques */
// Régression ln(quantité) ~ ln(prix) : renvoie { pente, r2 } ou null (aucune variation de prix mesurable)
function regressionLog(points) {
  const n = points.length;
  let sx = 0, sy = 0;
  const xs = points.map((p) => Math.log(p.prix)), ys = points.map((p) => Math.log(p.q));
  for (let i = 0; i < n; i++) { sx += xs[i]; sy += ys[i]; }
  const mx = sx / n, my = sy / n;
  let sxx = 0, sxy = 0, syy = 0;
  for (let i = 0; i < n; i++) { const dx = xs[i] - mx, dy = ys[i] - my; sxx += dx * dx; sxy += dx * dy; syy += dy * dy; }
  if (!(sxx > 1e-12)) return null;
  const pente = sxy / sxx;
  return { pente, r2: syy > 1e-12 ? (sxy * sxy) / (sxx * syy) : 0 };
}

/* ------------------------------------------------------------------------------------------------ construction */
/**
 * Construit les constantes de l'application. Renvoie { appliquee, dmax, du, C, … } ; C contient DATA, SKU_*, WEEKLY_*,
 * PAYS_MONTHLY, SKU_CUT_N1, ELASTICITE_DATA, SIMULATION_PRIX, BASKET_PAIRS, ABC_BY_SKU, SEASONALITY_INDEX.
 */
export function construire(ext, ref, opts = {}) {
  const AN = opts.an ?? AN_DEFAUT;
  const rap = { appliquee: false, an: AN, avertissements: [] };
  const v = validerExtension(ext);
  if (!v.ok) { rap.erreurs = v.erreurs; return rap; }
  if (!ref || typeof ref !== "object" || typeof ref.produits !== "object") { rap.erreurs = ["table de référence absente"]; return rap; }
  try {
    return construireInterne(ext, ref, opts, AN, rap);
  } catch (e) {
    rap.erreurs = [String((e && e.message) || e)];
    return rap;
  }
}

/**
 * Constantes vides mais complètes (toutes les clés, aux bonnes formes). Elles permettent à l'application de se charger quand
 * l'extraction est illisible : elle affiche alors un écran d'erreur à la place du tableau de bord, au lieu d'un écran blanc.
 * Construites par construire() lui-même pour ne jamais s'écarter de ses formes.
 */
export function squelette(an = AN_DEFAUT) {
  const jour = `${an}-01-01`;
  const ext = { schema: SCHEMA, du: jour, au: jour, boutiques: {}, mp: ["Site Web"], pays: ["France"], produits: [["—", null]], lignes: [[jour, 0, 0, 0, 0]], pays_jour: [], commandes: [], paires: [] };
  const r = construire(ext, { objectif_annuel: 0, objectifs_mp: {}, produits: {} }, { an });
  if (!r.appliquee) throw new Error(`squelette impossible : ${(r.erreurs ?? []).join(" ; ")}`);
  return { dmax: jour, C: r.C };
}

function construireInterne(ext, ref, opts, AN, rap) {
  const au = auExtension(ext);
  const dmax = au > `${AN}-12-31` ? `${AN}-12-31` : au;
  if (dmax < `${AN}-01-01`) { rap.erreurs = [`aucune vente en ${AN} (couverture jusqu'au ${au})`]; return rap; }
  const cur = Number(dmax.slice(5, 7)); // mois en cours (1-12)
  const Y1 = AN - 1, Y2 = AN - 2;
  const joursDuMois = new Date(Date.UTC(Y1, cur, 0)).getUTCDate();
  const jourCoupe = Math.min(Number(dmax.slice(8, 10)), joursDuMois);
  const mm = String(cur).padStart(2, "0");
  const coupe = { du: `${Y1}-${mm}-01`, au: `${Y1}-${mm}-${String(jourCoupe).padStart(2, "0")}` };
  const dernierJourSemaineComplete = (() => { // dernier jour (inclus) d'une semaine entièrement écoulée
    const dow = new Date(Date.UTC(+dmax.slice(0, 4), +dmax.slice(5, 7) - 1, +dmax.slice(8, 10))).getUTCDay(); // 0 = dimanche
    return dow === 6 ? dmax : jourSuivant(dmax, -(dow + 1));
  })();
  const semaineMaxComplete = excelWeekOf(dernierJourSemaineComplete);
  const premiereSemaineComplete = new Date(Date.UTC(AN, 0, 1)).getUTCDay() === 0 ? 1 : 2;

  /* ---- lignes retenues */
  const P = ext.produits, M = ext.mp, PA = ext.pays;
  const L = [];
  let hors = 0;
  for (const [d, im, ip, q, ca] of ext.lignes) {
    const y = +d.slice(0, 4);
    if (d > dmax || y < Y2 || y > AN) { hors++; continue; }
    L.push({ d, y, mo: +d.slice(5, 7) - 1, mp: M[im], produit: P[ip][0], q, ca });
  }
  if (hors) rap.avertissements.push(`${hors} ligne(s) hors de la période ${Y2}-01-01 → ${dmax} ignorée(s)`);
  if (!L.some((x) => x.y === AN)) { rap.erreurs = [`aucune ligne de vente en ${AN}`]; return rap; }

  /* ---- produits : nom → attributs (table de référence, sinon marque du vendeur Shopify) */
  const vendeur = new Map(P.map((p) => [p[0], p[1]]));
  const meta = new Map();
  const metaDe = (nom) => {
    let m = meta.get(nom);
    if (!m) {
      const r = ref.produits[nom];
      m = r
        ? { connu: true, marque: vendeur.get(nom) || r.marque || "Bestherm", norme: r.norme ?? null, famille: r.famille ?? null, sous: r.sous_famille ?? null, sousSous: r.sous_sous_famille ?? null, cat: r.categorie ?? null, wifi: !!r.wifi, plinthe: !!r.plinthe, vertical: !!r.vertical, destockage: !!r.destockage, code: r.code ?? null }
        : { connu: false, marque: vendeur.get(nom) || "Bestherm", norme: null, famille: null, sous: null, sousSous: null, cat: null, wifi: false, plinthe: false, vertical: false, destockage: false, code: null };
      meta.set(nom, m);
    }
    return m;
  };
  const nomsDetail = [...new Set(L.filter((x) => x.y >= Y1).map((x) => x.produit))].sort(cmp);
  const SKU_PRODUIT = nomsDetail;
  const pIdx = new Map(SKU_PRODUIT.map((n, i) => [n, i]));
  const inconnus = SKU_PRODUIT.filter((n) => !metaDe(n).connu);
  if (inconnus.length) rap.avertissements.push(`${inconnus.length} produit(s) absent(s) de la table de référence (marque du vendeur, aucune famille) : ${inconnus.slice(0, 8).join(", ")}${inconnus.length > 8 ? "…" : ""}`);
  const mpNoms = [...new Set([...L.map((x) => x.mp), ...Object.keys(ref.objectifs_mp || {})])].sort(cmp);
  const SKU_MPS = mpNoms;
  const mIdx = new Map(SKU_MPS.map((n, i) => [n, i]));

  /* ---- cumuls */
  const monthlyTotal = { [Y2]: zeros(), [Y1]: zeros(), [AN]: zeros() };
  const parMarque = new Map(); // marque → { année → [12] }
  const parMp = new Map(); // mp → { année → [12] }
  const marqueMpMois = new Map(); // mp → { marque → [12] } (AN)
  const normes = { NF: {}, CE: {} };
  const sku = new Map(); // `${p}|${m}|${y}|${mo}` → [p, m, y, mo, ca, q]
  const mpAn = new Map(); // mp → { ca, q } (AN)
  const marqueAn = new Map(), marqueY1Complet = new Map(), marqueSansRef = { [Y2]: 0, [Y1]: 0, [AN]: 0 };
  const totalAn = { ca: 0, q: 0 };
  const parAnCa = { [Y2]: 0, [Y1]: 0, [AN]: 0 };
  const cutP = new Map(), cutM = new Map(), cutMarque = new Map(); let cutTotal = 0;
  const cutPm = new Map(); // `${produit}\0${mp}` → { produit, mp, ca, q }
  const hebTot = new Map(), hebMp = new Map(), hebProd = new Map(), hebPm = new Map(); // semaines de AN
  const cat = new Map(), sousCat = new Map(), catTotal = new Map(), catMap = new Map(); // clés : « Toutes » et chaque marketplace
  const pAn = new Map(); // p → { ca, q } (AN)
  const pmAn = new Map(); // m → Map(p → { ca, q }) (AN)
  const pMois = new Map(); // p → [12] (AN)
  const p1Mois = new Map(), p1Complet = new Map(); // AN-1 : p → ca (mois avant le mois en cours) / p → ca (année)
  const ajoutCat = (cle, c, ca) => { const m = getOrSet(cat, cle, () => new Map()); m.set(c, (m.get(c) || 0) + ca); };
  const ajoutSous = (cle, s, ca) => { const m = getOrSet(sousCat, cle, () => new Map()); m.set(s, (m.get(s) || 0) + ca); };

  for (const x of L) {
    const { y, mo, mp, produit, q, ca } = x;
    const m = metaDe(produit);
    monthlyTotal[y][mo] += ca; parAnCa[y] += ca;
    const bm = getOrSet(parMarque, m.marque, () => ({})); (bm[y] ||= zeros())[mo] += ca;
    const gm = getOrSet(parMp, mp, () => ({})); (gm[y] ||= zeros())[mo] += ca;
    if (m.norme === "NF" || m.norme === "CE") (normes[m.norme][y] ||= zeros())[mo] += ca;
    if (!m.connu) marqueSansRef[y] += ca;
    if (y === Y1) {
      marqueY1Complet.set(m.marque, (marqueY1Complet.get(m.marque) || 0) + ca);
      if (x.d >= coupe.du && x.d <= coupe.au) {
        cutTotal += ca; cutM.set(mp, (cutM.get(mp) || 0) + ca); cutMarque.set(m.marque, (cutMarque.get(m.marque) || 0) + ca);
        const k = `${produit}\u0000${mp}`; const c = getOrSet(cutPm, k, () => ({ produit, mp, ca: 0, q: 0 })); c.ca += ca; c.q += q;
        cutP.set(produit, (cutP.get(produit) || 0) + ca);
      }
    }
    if (y >= Y1) {
      const p = pIdx.get(produit), mi = mIdx.get(mp);
      const k = `${p}|${mi}|${y}|${mo + 1}`;
      let r = sku.get(k); if (!r) { r = [p, mi, y, mo + 1, 0, 0]; sku.set(k, r); }
      r[4] += ca; r[5] += q;
      if (y === Y1) {
        p1Complet.set(produit, (p1Complet.get(produit) || 0) + ca);
        if (mo + 1 < cur) p1Mois.set(produit, (p1Mois.get(produit) || 0) + ca);
      }
    }
    if (y === AN) {
      const bmm = getOrSet(marqueMpMois, mp, () => ({})); (bmm[m.marque] ||= zeros())[mo] += ca;
      const a = getOrSet(mpAn, mp, () => ({ ca: 0, q: 0 })); a.ca += ca; a.q += q;
      marqueAn.set(m.marque, (marqueAn.get(m.marque) || 0) + ca);
      totalAn.ca += ca; totalAn.q += q;
      const wk = excelWeekOf(x.d);
      const t = getOrSet(hebTot, wk, () => [wk, 0, 0]); t[1] += ca; t[2] += q;
      const wm = getOrSet(hebMp, `${wk}|${mp}`, () => [wk, mp, 0, 0]); wm[2] += ca; wm[3] += q;
      const wp = getOrSet(hebProd, `${wk}|${produit}`, () => [wk, produit, 0, 0]); wp[2] += ca; wp[3] += q;
      const wpm = getOrSet(hebPm, `${produit}\u0000${mp}`, () => new Map()); const wc = getOrSet(wpm, wk, () => ({ ca: 0, q: 0 })); wc.ca += ca; wc.q += q;
      const pa = getOrSet(pAn, produit, () => ({ ca: 0, q: 0 })); pa.ca += ca; pa.q += q;
      const pm = getOrSet(pmAn, mp, () => new Map()); const pc = getOrSet(pm, produit, () => ({ ca: 0, q: 0 })); pc.ca += ca; pc.q += q;
      getOrSet(pMois, produit, zeros)[mo] += ca;
      const categorie = m.cat, sous = produit === "Livraison" ? null : m.sousSous;
      for (const cle of ["Toutes", mp]) {
        catTotal.set(cle, (catTotal.get(cle) || 0) + ca);
        if (categorie) { ajoutCat(cle, categorie, ca); catMap.set(cle, (catMap.get(cle) || 0) + ca); }
        if (sous) ajoutSous(cle, sous, ca);
      }
    }
  }

  /* ---- commandes (panier moyen) */
  let cmdAn = 0; const cmdMp = new Map();
  for (const [d, im, n] of ext.commandes) {
    if (d.slice(0, 4) !== String(AN) || d > dmax) continue;
    cmdAn += n; cmdMp.set(M[im], (cmdMp.get(M[im]) || 0) + n);
  }

  /* ---- PAYS_MONTHLY : [pays, marketplace, année, mois, CA HT, quantité] (AN-1 et AN). La quantité (6e élément) n'est donnée pour une année que si
   *      TOUTES ses lignes de l'extraction en portent une : jamais de quantité partielle (l'onglet Répartitions affiche alors le CA et le signale). */
  const paysMap = new Map(), anSansQte = new Set();
  for (const [d, ic, im, ca, q] of ext.pays_jour) {
    const y = +d.slice(0, 4);
    if (d > dmax || y < Y1 || y > AN) continue;
    const sansQte = typeof q !== "number" || !Number.isFinite(q);
    if (sansQte) anSansQte.add(y);
    const k = `${PA[ic]}|${M[im]}|${y}|${+d.slice(5, 7)}`;
    let r = paysMap.get(k); if (!r) { r = [PA[ic], M[im], y, +d.slice(5, 7), 0, 0]; paysMap.set(k, r); }
    r[4] += ca; if (!sansQte) r[5] += q;
  }
  const PAYS_MONTHLY = [...paysMap.values()]
    .map((r) => (anSansQte.has(r[2]) ? [r[0], r[1], r[2], r[3], r2(r[4])] : [r[0], r[1], r[2], r[3], r2(r[4]), r[5]]))
    .sort((a, b) => cmp(a[0], b[0]) || cmp(a[1], b[1]) || a[2] - b[2] || a[3] - b[3]);

  /* ---- tableaux parallèles aux produits */
  const SKU_DESTOCKAGE = SKU_PRODUIT.map((n) => metaDe(n).destockage);
  const SKU_FAMILLE = SKU_PRODUIT.map((n) => metaDe(n).famille);
  const SKU_WIFI = SKU_PRODUIT.map((n) => metaDe(n).wifi);
  const SKU_PLINTHE = SKU_PRODUIT.map((n) => metaDe(n).plinthe);
  const SKU_VERTICAL = SKU_PRODUIT.map((n) => metaDe(n).vertical);
  const SKU_SOUS_FAMILLE = SKU_PRODUIT.map((n) => metaDe(n).sous);
  const SKU_SOUS_SOUS_FAMILLE = SKU_PRODUIT.map((n) => metaDe(n).sousSous);
  const SKU_MARQUE = SKU_PRODUIT.map((n) => metaDe(n).marque); // marque du vendeur Shopify (sinon de la table de référence) : onglet Répartitions
  const PRODUCT_TO_CATEGORY = {};
  for (const n of SKU_PRODUIT) if (metaDe(n).cat) PRODUCT_TO_CATEGORY[n] = metaDe(n).cat;

  const SKU_MONTHLY = [...sku.values()].map((r) => [r[0], r[1], r[2], r[3], r2(r[4]), r[5]]).sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2] || a[3] - b[3]);
  const SKU_CUT_N1 = [...cutPm.values()].map((c) => [pIdx.get(c.produit), mIdx.get(c.mp), r2(c.ca), c.q])
    .sort((a, b) => cmp(SKU_PRODUIT[a[0]], SKU_PRODUIT[b[0]]) || a[1] - b[1]);

  /* ---- semaines (AN) */
  const WEEKLY_TOTALS = [...hebTot.values()].map((r) => [r[0], r2(r[1]), r[2]]).sort((a, b) => a[0] - b[0]);
  const WEEKLY_BY_MP = [...hebMp.values()].map((r) => [r[0], r[1], r2(r[2]), r[3]]).sort((a, b) => a[0] - b[0] || cmp(a[1], b[1]));
  const WEEKLY_BY_PROD = [...hebProd.values()].map((r) => [r[0], r[1], r2(r[2]), r[3]]).sort((a, b) => a[0] - b[0] || cmp(a[1], b[1]));

  /* ---- courbes mensuelles */
  const arr2 = (a) => a.map(r2);
  const DATA = {};
  const kpi = {
    [`ca_total_${AN}`]: r2(totalAn.ca), [`qte_total_${AN}`]: totalAn.q,
    [`panier_moyen_${AN}`]: cmdAn > 0 ? r2(totalAn.ca / cmdAn) : 0, [`nb_commandes_${AN}`]: cmdAn,
    objectif_annuel_total: ref.objectif_annuel ?? 15000000,
  };
  kpi.pct_objectif_atteint = kpi.objectif_annuel_total > 0 ? r2((totalAn.ca / kpi.objectif_annuel_total) * 100) : 0;
  DATA.kpi = kpi;
  DATA.monthly_total = { [Y2]: arr2(monthlyTotal[Y2]), [Y1]: arr2(monthlyTotal[Y1]), [AN]: arr2(monthlyTotal[AN]) };
  const marquesOrdre = [...parMarque.keys()].sort((a, b) => ({ Bestherm: 0, Thomson: 1, "HOM'Y": 2 }[a] ?? 9) - ({ Bestherm: 0, Thomson: 1, "HOM'Y": 2 }[b] ?? 9) || cmp(a, b));
  DATA.monthly_by_brand = {};
  for (const b of marquesOrdre) {
    const o = {};
    for (const y of [Y2, Y1, AN]) if (parMarque.get(b)[y] && (y !== Y2 || somme(parMarque.get(b)[y]) !== 0)) o[y] = arr2(parMarque.get(b)[y]);
    for (const y of [Y1, AN]) o[y] ||= zeros();
    DATA.monthly_by_brand[b] = Object.fromEntries(Object.entries(o).sort((a, b2) => a[0] - b2[0]));
  }
  DATA.brand_coverage_pct = {};
  for (const y of [Y2, Y1, AN]) DATA.brand_coverage_pct[y] = parAnCa[y] > 0 ? r1(Math.max(0, (1 - marqueSansRef[y] / parAnCa[y]) * 100)) : 100;
  DATA.mois_labels = MOIS_LABELS.slice();

  /* ---- N-1 à date identique */
  const total1 = r2(avant(DATA.monthly_total[Y1], cur - 1) + cutTotal);
  DATA.total_yoy_comparable = { [Y1]: total1, [AN]: kpi[`ca_total_${AN}`] };
  DATA.cut_n1 = {
    total: { [Y1]: r2(cutTotal) },
    mp: Object.fromEntries([...new Set([...SKU_MPS, ...cutM.keys()])].sort(cmp).map((mp) => [mp, { [Y1]: r2(cutM.get(mp) || 0) }])),
    brand: Object.fromEntries(marquesOrdre.map((b) => [b, { [Y1]: r2(cutMarque.get(b) || 0) }])),
    jusqu_au: dmax.slice(5),
  };
  DATA.brand_yoy = {};
  for (const b of marquesOrdre) {
    DATA.brand_yoy[b] = {
      [Y1]: r2(avant(parMarque.get(b)[Y1], cur - 1) + (cutMarque.get(b) || 0)),
      [AN]: r2(marqueAn.get(b) || 0),
      [`${Y1}_annee`]: r2(marqueY1Complet.get(b) || 0),
    };
  }

  /* ---- marketplaces */
  const gf = { monthly_total_by_mp: {}, brand_by_mp_month: {}, best_by_mp: {}, top_products_by_mp: {}, qte_by_mp: {}, nb_commandes_mp: {}, panier_moyen_mp: {} };
  for (const mp of [...parMp.keys()].sort(cmp)) {
    const o = {};
    for (const y of [Y2, Y1, AN]) if (parMp.get(mp)[y] && (y >= Y1 || somme(parMp.get(mp)[y]) !== 0)) o[y] = arr2(parMp.get(mp)[y]);
    for (const y of [Y1, AN]) o[y] ||= zeros();
    gf.monthly_total_by_mp[mp] = Object.fromEntries(Object.entries(o).sort((a, b) => a[0] - b[0]));
  }
  for (const [mp, bm] of [...marqueMpMois].sort((a, b) => cmp(a[0], b[0]))) {
    gf.brand_by_mp_month[mp] = Object.fromEntries(Object.entries(bm).sort((a, b) => cmp(a[0], b[0])).map(([b, arr]) => [b, arr2(arr)]));
  }
  for (const mp of SKU_MPS) {
    const a = mpAn.get(mp);
    if (a) gf.qte_by_mp[mp] = a.q;
    const nb = cmdMp.get(mp);
    if (nb > 0) { gf.nb_commandes_mp[mp] = nb; gf.panier_moyen_mp[mp] = r2((a?.ca || 0) / nb); }
    const l = pmAn.get(mp);
    if (l) {
      const t = [...l].sort((x, y) => y[1].ca - x[1].ca || cmp(x[0], y[0]));
      gf.best_by_mp[mp] = { produit: t[0][0], ca: r0(t[0][1].ca) };
      gf.top_products_by_mp[mp] = t.slice(0, REGLAGES.topProduitsParMp).map(([p, c]) => ({ produit: p, ca: r0(c.ca) }));
    }
  }
  DATA.gf = gf;
  DATA.mp_vs_objectif = SKU_MPS.map((mp) => {
    const ca = r2(mpAn.get(mp)?.ca || 0);
    const ca1 = r2(avant(gf.monthly_total_by_mp[mp]?.[Y1], cur - 1) + (cutM.get(mp) || 0));
    const o = ref.objectifs_mp?.[mp] || {};
    const objectif = o.objectif ?? null;
    return { marketplace: mp, ca, ca_2025: ca1, yoy_pct: ca1 > 0 ? r1((ca / ca1 - 1) * 100) : null, objectif, pct_objectif: objectif ? r1((ca / objectif) * 100) : 0, objectif_fiable: !!o.fiable && objectif != null };
  }).filter((m) => m.ca !== 0 || m.ca_2025 !== 0 || m.objectif != null).sort((a, b) => b.ca - a.ca || cmp(a.marketplace, b.marketplace));

  /* ---- produits */
  const classe = [...pAn].sort((a, b) => b[1].ca - a[1].ca || cmp(a[0], b[0]));
  const memePeriode1 = (nom) => (p1Mois.get(nom) || 0) + (cutP.get(nom) || 0);
  if (classe.length) {
    DATA.best_seller_2026 = { produit: classe[0][0], ca: r1(classe[0][1].ca) };
    DATA.products_top15 = classe.slice(0, REGLAGES.topProduits).map(([nom, a]) => {
      const c1 = memePeriode1(nom);
      return { produit: nom, ca: r0(a.ca), qte: a.q, ca_2025: r0(c1), yoy_pct: c1 > 0 ? r1((a.ca / c1 - 1) * 100) : null };
    });
    DATA.products_monthly_top6 = Object.fromEntries(classe.slice(0, 6).map(([nom]) => [nom, { ca: pMois.get(nom).map(r0) }]));
  } else { DATA.best_seller_2026 = { produit: "N/A", ca: 0 }; DATA.products_top15 = []; DATA.products_monthly_top6 = {}; }
  const meilleur1 = [...p1Complet].sort((a, b) => b[1] - a[1] || cmp(a[0], b[0]))[0];
  DATA.best_seller_2025 = meilleur1 ? { produit: meilleur1[0], ca: r1(memePeriode1(meilleur1[0])), annee: r0(meilleur1[1]) } : { produit: "N/A", ca: 0, annee: 0 };

  /* ---- suivi des prix : [produit, marketplace, prix AN-1[12], prix AN[12], quantités AN-1[12], quantités AN[12], coupe AN-1 [CA, qté] | null] */
  const pt = new Map();
  const ligne = (nom, mp) => getOrSet(pt, `${nom}\u0000${mp}`, () => ({ nom, mp, ca: [zeros(), zeros()], q: [zeros(), zeros()], cut: null }));
  for (const r of SKU_MONTHLY) {
    const l = ligne(SKU_PRODUIT[r[0]], SKU_MPS[r[1]]), a = r[2] === AN ? 1 : 0;
    l.ca[a][r[3] - 1] += r[4]; l.q[a][r[3] - 1] += r[5];
  }
  for (const c of cutPm.values()) ligne(c.produit, c.mp).cut = [r2(c.ca), c.q];
  DATA.price_tracking = [...pt.values()].map((l) => ({
    l, tri: somme(l.ca[0]) + somme(l.ca[1]),
  })).sort((a, b) => b.tri - a.tri || cmp(a.l.nom, b.l.nom) || cmp(a.l.mp, b.l.mp)).map(({ l }) => [
    l.nom, l.mp,
    l.ca[0].map((c, i) => (l.q[0][i] > 0 ? r2(c / l.q[0][i]) : null)),
    l.ca[1].map((c, i) => (l.q[1][i] > 0 ? r2(c / l.q[1][i]) : null)),
    l.q[0], l.q[1], l.cut,
  ]);

  /* ---- normes NF / CE */
  DATA.normes_month = {};
  for (const n of ["NF", "CE"]) {
    DATA.normes_month[n] = {};
    for (const y of [Y2, Y1, AN]) DATA.normes_month[n][y] = arr2(normes[n][y] || zeros());
  }

  /* ---- catégories et sous-catégories (AN) : liste triée { nom, ca, pct } ; pct = part du CA du périmètre */
  const liste = (m, total) => [...(m || [])].sort((a, b) => b[1] - a[1] || cmp(a[0], b[0])).map(([nom, ca]) => ({ nom, ca: r0(ca), pct: total > 0 ? r1((ca / total) * 100) : 0 }));
  const cbm = { categories: {}, souscategories: {}, coverage: {} };
  for (const cle of ["Toutes", ...SKU_MPS]) {
    const total = catTotal.get(cle) || 0;
    if (!(total > 0)) continue;
    cbm.categories[cle] = liste(cat.get(cle), total);
    cbm.souscategories[cle] = liste(sousCat.get(cle), total);
    cbm.coverage[cle] = Math.min(100, r1(((catMap.get(cle) || 0) / total) * 100));
  }
  DATA.category_by_mp = cbm;

  /* ---- publicité : hors Shopify (conservée telle quelle, voir opts.horsShopify) */
  DATA.ads = opts.horsShopify?.ads ?? [];
  DATA.country_ads = opts.horsShopify?.country_ads ?? [];

  /* ---- élasticité-prix : régression log-log hebdomadaire par produit × marketplace (semaines complètes de AN) */
  const E = REGLAGES.elasticite;
  const semaineOk = (w) => w >= premiereSemaineComplete && w <= semaineMaxComplete;
  const elast = [];
  for (const [k, sem] of hebPm) {
    const [nom, mp] = k.split("\u0000");
    const pts = [];
    for (const [w, c] of sem) if (semaineOk(w) && c.q > 0 && c.ca > 0) pts.push({ w, q: c.q, prix: c.ca / c.q });
    if (pts.length < E.semainesMin) continue;
    const prix = pts.map((p) => p.prix), moy = somme(prix) / prix.length, pmin = Math.min(...prix), pmax = Math.max(...prix);
    const ecart = (pmax - pmin) / moy;
    if (!(ecart >= E.ecartPrixMin)) continue;
    const reg = regressionLog(pts);
    if (!reg) continue;
    const qMoy = somme(pts.map((p) => p.q)) / pts.length;
    const fiable = pts.length >= E.fiableSemainesMin && reg.r2 >= E.fiableR2Min && ecart >= E.fiableEcartPrixMin;
    const caReel = pmAn.get(mp)?.get(nom)?.ca || 0;
    elast.push({ row: [nom, mp, r2(reg.pente), r2(reg.r2), pts.length, r1(qMoy), r2(moy), fiable, r1(qMoy), r2(pmin), r2(pmax)], caReel, pente: reg.pente });
  }
  elast.sort((a, b) => b.caReel - a.caReel || cmp(a.row[0], b.row[0]) || cmp(a.row[1], b.row[1]));
  const ELASTICITE_DATA = elast.map((e) => e.row);
  const sim = (e) => {
    const dv = r1(e.row[2] * REGLAGES.simulationPct);
    const dca = r1(((1 + REGLAGES.simulationPct / 100) * (1 + dv / 100) - 1) * 100);
    return [e.row[0], e.row[1], e.row[2], e.row[3], dv, dca, r0(e.caReel), e.row[7]];
  };
  const SIMULATION_PRIX = {
    opportunites: elast.filter((e) => e.row[2] > -1 && e.row[2] < 0).slice(0, REGLAGES.simulationLignes).map(sim),
    risques: elast.filter((e) => e.row[2] <= -1 && e.row[7]).slice(0, REGLAGES.simulationLignes).map(sim),
  };

  /* ---- paires de produits achetés ensemble (AN) */
  const pr = new Map();
  for (const [d, ia, ib, n] of ext.paires) {
    if (d.slice(0, 4) !== String(AN) || d > dmax) continue;
    const a = P[ia][0], b = P[ib][0];
    const [x, y] = a < b ? [a, b] : [b, a];
    const k = `${x}\u0000${y}`; pr.set(k, (pr.get(k) || 0) + n);
  }
  const BASKET_PAIRS = [...pr].map(([k, n]) => { const [a, b] = k.split("\u0000"); return [a, b, n]; })
    .sort((p, q) => q[2] - p[2] || cmp(p[0], q[0]) || cmp(p[1], q[1])).slice(0, REGLAGES.topPaires);

  /* ---- classes ABC (CA AN) : A jusqu'à 50 % du CA cumulé, B 80 %, C 98 %, D le reste (NC : aucune vente) */
  const ABC_BY_SKU = [];
  {
    let cum = 0; const tot = totalAn.ca || 1;
    for (const [nom, a] of classe) {
      const avantCum = cum / tot; cum += a.ca;
      const c = avantCum < REGLAGES.abc.A ? "A" : avantCum < REGLAGES.abc.B ? "B" : avantCum < REGLAGES.abc.C ? "C" : "D";
      ABC_BY_SKU.push([metaDe(nom).code || nom, nom, r2(a.ca), a.q, c]);
    }
    for (const nom of SKU_PRODUIT) if (!pAn.has(nom)) ABC_BY_SKU.push([metaDe(nom).code || nom, nom, 0, 0, "NC"]);
  }

  /* ---- saisonnalité : poids de chaque mois dans le CA des deux années complètes précédentes */
  const mensuel = zeros();
  for (const y of [Y2, Y1]) DATA.monthly_total[y].forEach((x, i) => { mensuel[i] += x; });
  const moyen = somme(mensuel) / 12;
  const SEASONALITY_INDEX = moyen > 0 ? mensuel.map((x) => r2(x / moyen)) : Array(12).fill(1);

  const C = {
    DATA, SKU_PRODUIT, SKU_MPS, SKU_MONTHLY, SKU_DESTOCKAGE, SKU_FAMILLE, SKU_WIFI, SKU_PLINTHE, SKU_VERTICAL,
    SKU_SOUS_FAMILLE, SKU_SOUS_SOUS_FAMILLE, SKU_MARQUE, PRODUCT_TO_CATEGORY, PAYS_MONTHLY, SKU_CUT_N1,
    WEEKLY_TOTALS, WEEKLY_BY_MP, WEEKLY_BY_PROD, ELASTICITE_DATA, SIMULATION_PRIX, BASKET_PAIRS, ABC_BY_SKU, SEASONALITY_INDEX,
  };
  const jours = new Set(L.filter((x) => x.y === AN).map((x) => x.d));
  Object.assign(rap, {
    appliquee: true, dmax, du: ext.du ?? null, coupe, jours: jours.size, lignes: L.length,
    ca: kpi[`ca_total_${AN}`], qte: totalAn.q, commandes: cmdAn,
    semaineMaxComplete, produitsInconnus: inconnus,
  });
  return { ...rap, C };
}
