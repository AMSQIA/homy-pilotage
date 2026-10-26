/**
 * extension.js — prolongement du tableau de bord au-delà de la dernière ligne du fichier ODP.
 *
 * Le fichier ODP (constantes de App.jsx : DATA, SKU_MONTHLY, PAYS_MONTHLY, WEEKLY_*, SKU_CUT_N1…) s'arrête à
 * DMAX_ODP. Les ventes suivantes viennent des deux boutiques Shopify (marketplaces + site web), extraites chaque
 * matin dans shopify_extension.json. Ce module ajoute ces ventes, ligne par ligne, à TOUS les tableaux de
 * l'application et recalcule ce qui en dérive (KPI, courbes mensuelles, marketplaces, marques, produits, pays,
 * catégories, plan, comparaisons N-1 à date identique), pour que chaque chiffre du tableau de bord soit cohérent
 * avec les autres et arrêté à la même date.
 *
 * Principes
 *  - Module pur, sans dépendance, exécutable dans le navigateur comme sous Node (tests).
 *  - Les constantes de App.jsx restent le socle ODP : le prolongement est ajouté AU CHARGEMENT, jamais écrit dans
 *    App.jsx. Une nouvelle extraction ODP (DMAX_ODP avancé) écarte donc d'elle-même les jours qu'elle couvre.
 *  - Atomique : tout est calculé sur une copie ; les constantes ne sont modifiées qu'une fois le calcul terminé.
 *    En cas de problème, l'application garde le socle ODP tel quel (et DMAX = DMAX_ODP).
 *  - Les valeurs du socle ne sont jamais « redérivées » quand elles sont connues au centime : on leur ADDITIONNE
 *    les ventes Shopify. Seuls les classements (meilleurs produits…) sont recalculés, depuis SKU_MONTHLY.
 *  - N-1 : « même période 2025 » = mois entiers de 2025 avant le mois en cours + coupe du 1er au jour de DMAX
 *    du mois en cours, relue dans les lignes 2025 de l'ODP (fichier data/n1_2025.json).
 *
 * Formats (voir scripts/extension/README.md)
 *  extension  { schema, extrait_a, du, au, boutiques:{…:{au,…}}, mp:[…], pays:[…], produits:[[nom, marque, norme, attrs?]…],
 *               lignes:[[jour, iMp, iProduit, iPays, qte, caHT, nbLignes]…] }   (nbLignes : lignes Shopify = commande × référence)
 *  n1         { schema, du, au, mp:[…], produits:[…], marques:[…], lignes:[[jour, iMp, iProduit, iMarque, qte, caHT]…] }
 */

export const SCHEMA = 1;
const AN = 2026;
const SEUIL_LIGNE_PAR_UNITE = 0.99; // lignes ODP ÷ unités à partir de laquelle une marketplace compte une ligne par unité

const r0 = Math.round;
const r1 = (x) => Math.round(x * 10) / 10;
const r2 = (x) => Math.round(x * 100) / 100;
const somme = (a) => { let s = 0; for (const v of a || []) s += v || 0; return s; };
const avant = (a, n) => { let s = 0; for (let i = 0; i < n; i++) s += (a && a[i]) || 0; return s; };
const zeros = () => Array(12).fill(0);
const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Numéro de semaine Excel (WEEKNUM, dimanche → samedi, semaine 1 = celle du 1er janvier) d'une date AAAA-MM-JJ. */
export function excelWeekOf(iso) {
  const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number);
  const jan1 = Date.UTC(y, 0, 1), dt = Date.UTC(y, m - 1, d);
  return Math.floor((Math.round((dt - jan1) / 86400000) + new Date(jan1).getUTCDay()) / 7) + 1;
}

/** Dernier jour couvert par les DEUX boutiques : le plus ancien de leurs « au » (et du champ « au » de l'extraction). */
export function auExtension(ext) {
  if (!ext || typeof ext !== "object") return null;
  const dates = [ext.au, ...Object.values(ext.boutiques || {}).map((b) => b && b.au)].filter((x) => typeof x === "string" && ISO.test(x));
  return dates.length ? dates.reduce((a, b) => (a < b ? a : b)) : null;
}

/** Dernier jour de données de l'application : le plus récent entre la fin de l'ODP et la couverture des boutiques. */
export function dmaxEffectif(dmaxOdp, ext) {
  const au = auExtension(ext);
  return au && au > dmaxOdp ? au : dmaxOdp;
}

/** Contrôle de structure de l'extraction. Une extraction invalide est ignorée (l'application reste sur l'ODP). */
export function validerExtension(ext, dmaxOdp) {
  const e = [];
  if (!ext || typeof ext !== "object") return { ok: false, erreurs: ["extension absente"] };
  if (ext.schema !== SCHEMA) e.push(`schema ${ext.schema} inconnu (attendu ${SCHEMA})`);
  for (const k of ["mp", "pays", "produits", "lignes"]) if (!Array.isArray(ext[k])) e.push(`champ « ${k} » absent`);
  if (e.length) return { ok: false, erreurs: e };
  const au = auExtension(ext);
  if (!au) e.push("dernier jour couvert (au) absent ou illisible");
  if (au && au.slice(0, 4) !== String(AN)) e.push(`couverture hors ${AN} (${au})`);
  const n = { mp: ext.mp.length, pays: ext.pays.length, produits: ext.produits.length };
  for (const [i, l] of ext.lignes.entries()) {
    if (!Array.isArray(l) || l.length < 7) { e.push(`ligne ${i} : 7 champs attendus`); break; }
    const [d, im, ip, ic, q, ca, nl] = l;
    if (typeof d !== "string" || !ISO.test(d)) { e.push(`ligne ${i} : jour illisible`); break; }
    if (!(im >= 0 && im < n.mp && ip >= 0 && ip < n.produits && ic >= 0 && ic < n.pays)) { e.push(`ligne ${i} : index hors dictionnaire`); break; }
    if (![q, ca, nl].every((x) => typeof x === "number" && Number.isFinite(x))) { e.push(`ligne ${i} : valeur non numérique`); break; }
  }
  return { ok: e.length === 0, erreurs: e };
}

/** Lignes décodées de l'extraction (dictionnaires → valeurs). */
export function lignesExtension(ext) {
  return ext.lignes.map(([d, im, ip, ic, qte, ca, nl]) => {
    const p = ext.produits[ip];
    return { d, mp: ext.mp[im], produit: p[0], marque: p[1], norme: p[2], pays: ext.pays[ic], qte, ca, nl };
  });
}

/**
 * Coupe N-1 : ventes 2025 du 1er du mois de dmax (année précédente) jusqu'au même jour, par marketplace, par marque
 * et par (produit, marketplace). `couverte` = false si le fichier N-1 ne couvre pas toute la fenêtre.
 */
export function coupeN1(n1, dmax) {
  const y = Number(dmax.slice(0, 4)) - 1, mo = dmax.slice(5, 7), j = dmax.slice(8, 10);
  const du = `${y}-${mo}-01`, au = `${y}-${mo}-${j}`;
  const c = { du, au, couverte: !!(n1 && n1.du <= du && n1.au >= au), total: 0, mp: {}, marque: {}, pm: new Map() };
  if (!n1 || !Array.isArray(n1.lignes)) return c;
  for (const [d, im, ip, ik, qte, ca] of n1.lignes) {
    if (d < du || d > au) continue;
    const mp = n1.mp[im], prod = n1.produits[ip], marque = n1.marques[ik];
    c.total += ca;
    c.mp[mp] = (c.mp[mp] || 0) + ca;
    c.marque[marque] = (c.marque[marque] || 0) + ca;
    const k = `${prod}\u0000${mp}`;
    const a = c.pm.get(k) || { produit: prod, mp, ca: 0, qte: 0 };
    a.ca += ca; a.qte += qte;
    c.pm.set(k, a);
  }
  return c;
}

/* ------------------------------------------------------------------------------------------------ outils */
const CONSTANTES = [
  "DATA", "SKU_PRODUIT", "SKU_MONTHLY", "SKU_DESTOCKAGE", "SKU_FAMILLE", "SKU_WIFI", "SKU_PLINTHE", "SKU_VERTICAL",
  "SKU_SOUS_FAMILLE", "SKU_SOUS_SOUS_FAMILLE", "SKU_MARQUE", "PRODUCT_TO_CATEGORY", "PAYS_MONTHLY", "SKU_CUT_N1",
  "WEEKLY_TOTALS", "WEEKLY_BY_MP", "WEEKLY_BY_PROD",
];
const copie = (x) => JSON.parse(JSON.stringify(x));

function remplacer(cible, source) {
  if (Array.isArray(cible)) {
    cible.length = 0;
    for (let i = 0; i < source.length; i++) cible.push(source[i]);
  } else {
    for (const k of Object.keys(cible)) delete cible[k];
    Object.assign(cible, source);
  }
}

const getOrSet = (map, k, f) => { let v = map.get(k); if (v === undefined) { v = f(); map.set(k, v); } return v; };

/* ------------------------------------------------------------------------------------------------ ajout des ventes */
// Ajoute les lignes Shopify aux tableaux additifs et renvoie les cumuls utiles au recalcul.
function ajouter(W, lignes, rap) {
  const { DATA } = W;
  const pIdx = new Map(W.SKU_PRODUIT.map((n, i) => [n, i]));
  const mIdx = new Map(W.SKU_MPS.map((n, i) => [n, i]));
  const sku = new Map(), pays = new Map(), wTot = new Map(), wMp = new Map(), wProd = new Map();
  for (const r of W.SKU_MONTHLY) if (r[2] === AN) sku.set(`${r[0]}|${r[1]}|${r[3]}`, r);
  for (const r of W.PAYS_MONTHLY) if (r[2] === AN) pays.set(`${r[0]}|${r[1]}|${r[3]}`, r);
  for (const r of W.WEEKLY_TOTALS) wTot.set(r[0], r);
  for (const r of W.WEEKLY_BY_MP) wMp.set(`${r[0]}|${r[1]}`, r);
  for (const r of W.WEEKLY_BY_PROD) wProd.set(`${r[0]}|${r[1]}`, r);

  const A = {
    ca: 0, qte: 0, nl: 0, marque: {}, mp: {}, mpQte: {}, mpNl: {},
    cat: new Map(), sous: new Map(), mapped: new Map(), total: new Map(), // clés : « Toutes » et chaque marketplace
    touche: new Set(), // (produit, marketplace) dont price_tracking est à rafraîchir
    mois: new Set(), jours: new Set(),
  };
  const inconnus = new Map();
  const ajoutProduit = (nom, marque, attrs) => {
    const i = W.SKU_PRODUIT.length;
    W.SKU_PRODUIT.push(nom);
    const a = attrs || {};
    W.SKU_DESTOCKAGE.push(!!a.destockage); W.SKU_FAMILLE.push(a.famille ?? null); W.SKU_WIFI.push(!!a.wifi);
    W.SKU_PLINTHE.push(!!a.plinthe); W.SKU_VERTICAL.push(!!a.vertical);
    W.SKU_SOUS_FAMILLE.push(a.sous_famille ?? null); W.SKU_SOUS_SOUS_FAMILLE.push(a.sous_sous_famille ?? null);
    W.SKU_MARQUE.push(marque);
    if (a.categorie) W.PRODUCT_TO_CATEGORY[nom] = a.categorie;
    pIdx.set(nom, i);
    inconnus.set(nom, { nom, marque, ca: 0, qte: 0 });
    return i;
  };

  const caseCat = (cle, cat, ca) => { const m = getOrSet(A.cat, cle, () => new Map()); m.set(cat, (m.get(cat) || 0) + ca); };
  const caseSous = (cle, lab, ca) => { const m = getOrSet(A.sous, cle, () => new Map()); m.set(lab, (m.get(lab) || 0) + ca); };

  for (const x of lignes) {
    if (!mIdx.has(x.mp)) throw new Error(`marketplace inconnue : ${x.mp}`);
    const m = mIdx.get(x.mp);
    let p = pIdx.get(x.produit);
    if (p === undefined) p = ajoutProduit(x.produit, x.marque, x.attrs);
    if (inconnus.has(x.produit)) { const u = inconnus.get(x.produit); u.ca += x.ca; u.qte += x.qte; }
    const mo = Number(x.d.slice(5, 7)), wk = excelWeekOf(x.d);
    A.ca += x.ca; A.qte += x.qte; A.nl += x.nl; A.mois.add(mo); A.jours.add(x.d);
    A.mp[x.mp] = (A.mp[x.mp] || 0) + x.ca; A.mpQte[x.mp] = (A.mpQte[x.mp] || 0) + x.qte; A.mpNl[x.mp] = (A.mpNl[x.mp] || 0) + x.nl;
    A.marque[x.marque] = (A.marque[x.marque] || 0) + x.ca;

    // SKU_MONTHLY : [produit, marketplace, année, mois, CA HT, quantité]
    const ks = `${p}|${m}|${mo}`;
    let rs = sku.get(ks);
    if (!rs) { rs = [p, m, AN, mo, 0, 0]; W.SKU_MONTHLY.push(rs); sku.set(ks, rs); }
    rs[4] += x.ca; rs[5] += x.qte;
    A.touche.add(`${p}|${m}`);
    // PAYS_MONTHLY : [pays, marketplace, année, mois, CA HT, quantité] — la quantité n'est ajoutée qu'aux lignes qui en portent une
    // (un socle sans quantité par pays reste « inconnu » : jamais de quantité partielle)
    const kp = `${x.pays}|${x.mp}|${mo}`;
    let rp = pays.get(kp);
    if (!rp) { rp = [x.pays, x.mp, AN, mo, 0, 0]; W.PAYS_MONTHLY.push(rp); pays.set(kp, rp); }
    rp[4] += x.ca;
    if (rp.length >= 6) rp[5] += x.qte;
    // semaines : [semaine, CA HT, quantité] · [semaine, marketplace, CA HT, quantité] · [semaine, produit, CA HT, quantité]
    let t = wTot.get(wk); if (!t) { t = [wk, 0, 0]; W.WEEKLY_TOTALS.push(t); wTot.set(wk, t); } t[1] += x.ca; t[2] += x.qte;
    const kw = `${wk}|${x.mp}`;
    let wm = wMp.get(kw); if (!wm) { wm = [wk, x.mp, 0, 0]; W.WEEKLY_BY_MP.push(wm); wMp.set(kw, wm); } wm[2] += x.ca; wm[3] += x.qte;
    const kq = `${wk}|${x.produit}`;
    let wq = wProd.get(kq); if (!wq) { wq = [wk, x.produit, 0, 0]; W.WEEKLY_BY_PROD.push(wq); wProd.set(kq, wq); } wq[2] += x.ca; wq[3] += x.qte;

    // courbes mensuelles
    const i = mo - 1;
    DATA.monthly_total[AN][i] += x.ca;
    const mb = (DATA.monthly_by_brand[x.marque] ||= { [AN]: zeros() });
    (mb[AN] ||= zeros())[i] += x.ca;
    const gm = (DATA.gf.monthly_total_by_mp[x.mp] ||= { [AN - 1]: zeros(), [AN]: zeros() });
    (gm[AN] ||= zeros())[i] += x.ca;
    const gb = ((DATA.gf.brand_by_mp_month[x.mp] ||= {})[x.marque] ||= zeros());
    gb[i] += x.ca;
    if (x.norme === "NF" || x.norme === "CE") {
      const nm = (DATA.normes_month[x.norme] ||= {});
      (nm[AN] ||= zeros())[i] += x.ca;
    }
    // catégories (ajout aux listes du socle : voir majCategories)
    const cat = W.PRODUCT_TO_CATEGORY[x.produit];
    const sous = x.produit === "Livraison" ? null : W.SKU_SOUS_SOUS_FAMILLE[p];
    for (const cle of ["Toutes", x.mp]) {
      A.total.set(cle, (A.total.get(cle) || 0) + x.ca);
      if (cat) { caseCat(cle, cat, x.ca); A.mapped.set(cle, (A.mapped.get(cle) || 0) + x.ca); }
      if (sous) caseSous(cle, sous, x.ca);
    }
  }
  rap.nouveauxProduits = [...inconnus.values()];

  // arrondis au centime des cellules touchées (comme le socle)
  for (const r of sku.values()) { r[4] = r2(r[4]); }
  for (const r of pays.values()) { r[4] = r2(r[4]); }
  for (const r of wTot.values()) { r[1] = r2(r[1]); }
  for (const r of wMp.values()) { r[2] = r2(r[2]); }
  for (const r of wProd.values()) { r[2] = r2(r[2]); }
  const arr2 = (a) => { for (let i = 0; i < a.length; i++) a[i] = r2(a[i]); };
  arr2(DATA.monthly_total[AN]);
  for (const b of Object.values(DATA.monthly_by_brand)) if (b[AN]) arr2(b[AN]);
  for (const g of Object.values(DATA.gf.monthly_total_by_mp)) if (g[AN]) arr2(g[AN]);
  for (const g of Object.values(DATA.gf.brand_by_mp_month)) for (const a of Object.values(g)) arr2(a);
  for (const n of Object.values(DATA.normes_month)) if (n[AN]) arr2(n[AN]);
  return A;
}

/* ------------------------------------------------------------------------------------------------ recalcul */
// Catégories : on ajoute les ventes aux listes du socle (ca entier, part en %), sans toucher à la règle de
// rattachement du socle. total = chiffre d'affaires 2026 du périmètre APRÈS ajout.
function majListe(liste, ajouts, total) {
  const m = new Map((liste || []).map((x) => [x.nom, x.ca]));
  if (ajouts) for (const [nom, ca] of ajouts) m.set(nom, (m.get(nom) || 0) + ca);
  return [...m].sort((a, b) => b[1] - a[1]).map(([nom, ca]) => ({ nom, ca: r0(ca), pct: total > 0 ? r1((ca / total) * 100) : 0 }));
}

function majCategories(W, A, totalPar) {
  const C = W.DATA.category_by_mp;
  if (!C) return;
  const cles = new Set(["Toutes", ...W.SKU_MPS, ...Object.keys(C.categories || {})]);
  for (const cle of cles) {
    const apres = totalPar[cle];
    if (!(apres > 0)) continue;
    const ajoutTotal = A.total.get(cle) || 0;
    const ajoutMap = A.mapped.get(cle) || 0;
    const avantTotal = apres - ajoutTotal;
    if (C.categories) C.categories[cle] = majListe(C.categories[cle], A.cat.get(cle), apres);
    if (C.souscategories) C.souscategories[cle] = majListe(C.souscategories[cle], A.sous.get(cle), apres);
    if (C.coverage && typeof C.coverage[cle] === "number" && ajoutTotal > 0) {
      const mapAvant = (C.coverage[cle] / 100) * avantTotal;
      C.coverage[cle] = Math.min(100, r1(((mapAvant + ajoutMap) / apres) * 100));
    }
  }
}

// Recalcule tout ce qui dérive des tableaux additifs. `coupe` = résultat de coupeN1 (ou null : coupe du socle conservée).
function recalculer(W, A, ctx) {
  const { DATA } = W;
  const cur = ctx.cur; // mois en cours (1-12)
  const coupe = ctx.coupe;
  const mps = W.SKU_MPS;
  const pIdx = new Map(W.SKU_PRODUIT.map((n, i) => [n, i]));
  const mIdx = new Map(mps.map((n, i) => [n, i]));

  /* ---- N-1 à date identique : coupe du mois en cours (socle conservé si le fichier N-1 ne couvre pas la fenêtre) */
  if (coupe && coupe.couverte) {
    DATA.cut_n1.total = { [AN - 1]: r2(coupe.total) };
    const cm = {}; for (const mp of Object.keys(DATA.cut_n1.mp)) cm[mp] = { [AN - 1]: r2(coupe.mp[mp] || 0) };
    for (const mp of Object.keys(coupe.mp)) if (!cm[mp]) cm[mp] = { [AN - 1]: r2(coupe.mp[mp]) };
    DATA.cut_n1.mp = cm;
    const cb = {}; for (const b of Object.keys(DATA.cut_n1.brand)) cb[b] = { [AN - 1]: r2(coupe.marque[b] || 0) };
    for (const b of Object.keys(coupe.marque)) if (!cb[b]) cb[b] = { [AN - 1]: r2(coupe.marque[b]) };
    DATA.cut_n1.brand = cb;
    DATA.cut_n1.jusqu_au = ctx.dmax.slice(5);
    // SKU_CUT_N1 : [produit, marketplace, CA HT, quantité]
    const cut = [];
    for (const a of coupe.pm.values()) {
      const p = pIdx.get(a.produit), m = mIdx.get(a.mp);
      if (p === undefined || m === undefined) { ctx.avert.push(`coupe N-1 : ${a.produit} / ${a.mp} absent de l'application`); continue; }
      cut.push([p, m, r2(a.ca), a.qte]);
    }
    // ordre du socle : nom de produit (ordre alphabétique) puis marketplace
    const nomP = (i) => W.SKU_PRODUIT[i];
    cut.sort((a, b) => (nomP(a[0]) < nomP(b[0]) ? -1 : nomP(a[0]) > nomP(b[0]) ? 1 : a[1] - b[1]));
    remplacer(W.SKU_CUT_N1, cut);
  } else if (coupe) {
    ctx.avert.push(`fichier N-1 insuffisant pour la fenêtre ${coupe.du} → ${coupe.au} : coupe N-1 du socle conservée`);
  }
  const cutTotal = DATA.cut_n1.total[AN - 1] || 0;

  /* ---- price_tracking : [produit, mp, prix 2025[12], prix 2026[12], qté 2025[12], qté 2026[12], coupe 2025 [CA, qté] | null] */
  const pt = new Map(DATA.price_tracking.map((r) => [`${r[0]}\u0000${r[1]}`, r]));
  const cellule = new Map(); // (p, m, mois) -> ligne SKU_MONTHLY 2026
  for (const r of W.SKU_MONTHLY) if (r[2] === AN) cellule.set(`${r[0]}|${r[1]}|${r[3]}`, r);
  for (const k of A.touche) {
    const [p, m] = k.split("|").map(Number);
    const nom = W.SKU_PRODUIT[p], mp = mps[m];
    let r = pt.get(`${nom}\u0000${mp}`);
    if (!r) { r = [nom, mp, Array(12).fill(null), Array(12).fill(null), zeros(), zeros(), null]; DATA.price_tracking.push(r); pt.set(`${nom}\u0000${mp}`, r); }
    for (let mo = 1; mo <= 12; mo++) {
      const c = cellule.get(`${p}|${m}|${mo}`);
      if (!c) continue;
      r[3][mo - 1] = c[5] > 0 ? r2(c[4] / c[5]) : null;
      r[5][mo - 1] = c[5];
    }
  }
  if (coupe && coupe.couverte) {
    const cuts = new Map(W.SKU_CUT_N1.map((r) => [`${W.SKU_PRODUIT[r[0]]}\u0000${mps[r[1]]}`, r]));
    for (const r of DATA.price_tracking) { const c = cuts.get(`${r[0]}\u0000${r[1]}`); r[6] = c ? [c[2], c[3]] : null; }
    for (const [k, c] of cuts) if (!pt.has(k)) { // produit × marketplace vendu seulement en N-1 sur la fenêtre
      const nom = W.SKU_PRODUIT[c[0]], mp = mps[c[1]];
      DATA.price_tracking.push([nom, mp, Array(12).fill(null), Array(12).fill(null), zeros(), zeros(), [c[2], c[3]]]);
    }
  }

  /* ---- agrégats 2025 / 2026 depuis SKU_MONTHLY */
  const p26 = new Map(), pm26 = new Map(), mp26q = new Map(), p25 = new Map(), p25full = new Map(), pMois = new Map();
  for (const [p, m, y, mo, ca, q] of W.SKU_MONTHLY) {
    if (y === AN) {
      const a = getOrSet(p26, p, () => ({ ca: 0, qte: 0 })); a.ca += ca; a.qte += q || 0;
      const b = getOrSet(pm26, m, () => new Map()); const c = getOrSet(b, p, () => ({ ca: 0, qte: 0 })); c.ca += ca; c.qte += q || 0;
      mp26q.set(m, (mp26q.get(m) || 0) + (q || 0));
      getOrSet(pMois, p, zeros)[mo - 1] += ca;
    } else if (y === AN - 1) {
      p25full.set(p, (p25full.get(p) || 0) + ca);
      if (mo < cur) p25.set(p, (p25.get(p) || 0) + ca);
    }
  }
  const cut25 = new Map();
  for (const r of W.SKU_CUT_N1) cut25.set(r[0], (cut25.get(r[0]) || 0) + r[2]);
  const memePeriode25 = (p) => (p25.get(p) || 0) + (cut25.get(p) || 0);

  /* ---- KPI (CA, quantités et nombre de lignes ont déjà reçu les ventes Shopify : voir etendre) */
  const k = DATA.kpi;
  k.pct_objectif_atteint = r2((k.ca_total_2026 / k.objectif_annuel_total) * 100);
  if (k.nb_lignes_2026 > 0) k.panier_moyen_2026 = r2(k.ca_total_2026 / k.nb_lignes_2026);

  /* ---- total et comparaison N-1 */
  const tyc = DATA.total_yoy_comparable;
  tyc[AN] = k.ca_total_2026;
  tyc[AN - 1] = r2(avant(DATA.monthly_total[AN - 1], cur - 1) + cutTotal);
  delete tyc[AN - 2];
  if (DATA.cut_n1.total) delete DATA.cut_n1.total[AN - 2];
  for (const b of Object.values(DATA.cut_n1.brand || {})) delete b[AN - 2];

  /* ---- marques */
  for (const [b, y] of Object.entries(DATA.brand_yoy)) {
    y[AN] = r2(y[AN] + (A.marque[b] || 0));
    y[AN - 1] = r2(avant(DATA.monthly_by_brand[b]?.[AN - 1], cur - 1) + (DATA.cut_n1.brand[b]?.[AN - 1] || 0));
  }

  /* ---- marketplaces vs objectifs */
  const totalPar = { Toutes: k.ca_total_2026 };
  for (const m of DATA.mp_vs_objectif) {
    m.ca = r2(m.ca + (A.mp[m.marketplace] || 0));
    m.ca_2025 = r2(avant(DATA.gf.monthly_total_by_mp[m.marketplace]?.[AN - 1], cur - 1) + (DATA.cut_n1.mp[m.marketplace]?.[AN - 1] || 0));
    m.yoy_pct = m.ca_2025 > 0 ? r1((m.ca / m.ca_2025 - 1) * 100) : null;
    m.pct_objectif = m.objectif ? r1((m.ca / m.objectif) * 100) : 0;
    totalPar[m.marketplace] = m.ca;
  }
  // classement par CA décroissant, Technomat (objectif non fiable) restant en dernier comme dans le socle
  const dernier = DATA.mp_vs_objectif.filter((m) => m.marketplace === "Technomat");
  const reste = DATA.mp_vs_objectif.filter((m) => m.marketplace !== "Technomat").sort((a, b) => b.ca - a.ca);
  DATA.mp_vs_objectif = [...reste, ...dernier];

  /* ---- paniers et quantités par marketplace */
  const gf = DATA.gf;
  for (const [i, mp] of mps.entries()) {
    if (gf.qte_by_mp[mp] !== undefined || mp26q.has(i)) gf.qte_by_mp[mp] = mp26q.get(i) || 0;
    const nl = gf.nb_lignes_mp?.[mp];
    const ca = somme(gf.monthly_total_by_mp[mp]?.[AN]);
    if (nl > 0) gf.panier_moyen_mp[mp] = r2(ca / nl);
  }

  /* ---- classements produits */
  const classe = [...p26].sort((a, b) => b[1].ca - a[1].ca);
  if (classe.length) {
    DATA.best_seller_2026 = { produit: W.SKU_PRODUIT[classe[0][0]], ca: r1(classe[0][1].ca) };
    DATA.products_top15 = classe.slice(0, 15).map(([p, a]) => {
      const c25 = memePeriode25(p);
      return { produit: W.SKU_PRODUIT[p], ca: r0(a.ca), qte: a.qte, ca_2025: r0(c25), yoy_pct: c25 > 0 ? r1((a.ca / c25 - 1) * 100) : null };
    });
    DATA.products_monthly_top6 = Object.fromEntries(classe.slice(0, 6).map(([p]) => [W.SKU_PRODUIT[p], { ca: pMois.get(p).map(r0) }]));
  }
  const bs = DATA.best_seller_2025;
  if (bs && pIdx.has(bs.produit)) bs.ca = r1(memePeriode25(pIdx.get(bs.produit)));
  for (const [mi, mp] of mps.entries()) {
    const l = pm26.get(mi);
    if (!l) continue;
    const t = [...l].sort((a, b) => b[1].ca - a[1].ca);
    gf.best_by_mp[mp] = { produit: W.SKU_PRODUIT[t[0][0]], ca: r0(t[0][1].ca) };
    gf.top_products_by_mp[mp] = t.slice(0, 8).map(([p, a]) => ({ produit: W.SKU_PRODUIT[p], ca: r0(a.ca) }));
  }

  /* ---- catégories */
  for (const mp of mps) totalPar[mp] ??= somme(gf.monthly_total_by_mp[mp]?.[AN]);
  majCategories(W, A, totalPar);
}

/* ------------------------------------------------------------------------------------------------ point d'entrée */
/**
 * Prolonge les constantes de l'application avec les ventes Shopify.
 *  C    : { DATA, SKU_PRODUIT, SKU_MPS, SKU_MONTHLY, …} — les constantes de App.jsx (modifiées en place)
 *  ext  : contenu de shopify_extension.json     n1 : contenu de data/n1_2025.json
 *  opts : { dmaxOdp } dernier jour du fichier ODP
 * Renvoie un rapport { appliquee, dmax, dmaxOdp, du, au, jours, lignes, ca, qte, nouveauxProduits, avertissements, erreurs }.
 */
export function etendre(C, ext, n1, opts = {}) {
  const dmaxOdp = opts.dmaxOdp;
  const rap = { appliquee: false, dmax: dmaxOdp, dmaxOdp, avertissements: [] };
  const v = validerExtension(ext, dmaxOdp);
  if (!v.ok) { rap.erreurs = v.erreurs; return rap; }
  const au = dmaxEffectif(dmaxOdp, ext);
  if (au <= dmaxOdp) return rap;
  try {
    const W = {};
    for (const n of CONSTANTES) W[n] = copie(C[n]);
    W.SKU_MPS = C.SKU_MPS;
    const lignes = lignesExtension(ext).filter((x) => x.d > dmaxOdp && x.d <= au && x.d.slice(0, 4) === String(AN));
    const attrs = new Map(ext.produits.filter((p) => p[3]).map((p) => [p[0], p[3]]));
    for (const x of lignes) { const a = attrs.get(x.produit); if (a) x.attrs = a; }
    const A = ajouter(W, lignes, rap);
    // Lignes de commande (base du panier moyen) : dans l'ODP, la plupart des marketplaces ont UNE LIGNE PAR UNITÉ vendue
    // (lignes ÷ unités ≥ 0,99 sur le socle : Amazon, Cdiscount, site web…), alors que Leroy Merlin, ManoMano et « Autre »
    // gardent une ligne par commande et référence. Shopify groupe par commande et référence : pour les premières, on compte
    // donc les unités, pour les autres les lignes Shopify, afin que le panier moyen reste sur la base du fichier ODP.
    const gfBase = W.DATA.gf;
    for (const mp of Object.keys(A.mpNl)) {
      const l = gfBase.nb_lignes_mp?.[mp], q = gfBase.qte_by_mp?.[mp];
      if (l > 0 && q > 0 && l / q >= SEUIL_LIGNE_PAR_UNITE) A.mpNl[mp] = A.mpQte[mp];
    }
    A.nl = somme(Object.values(A.mpNl));
    const k = W.DATA.kpi;
    k.nb_lignes_2026 = (k.nb_lignes_2026 ?? r0(k.ca_total_2026 / k.panier_moyen_2026)) + A.nl;
    k.ca_total_2026 = r2(k.ca_total_2026 + A.ca);
    k.qte_total_2026 += A.qte;
    if (!W.DATA.gf.nb_lignes_mp) W.DATA.gf.nb_lignes_mp = {};
    for (const [mp, n] of Object.entries(A.mpNl)) {
      const avantNl = W.DATA.gf.nb_lignes_mp[mp] ?? (W.DATA.gf.panier_moyen_mp[mp] > 0 ? r0((somme(W.DATA.gf.monthly_total_by_mp[mp]?.[AN]) - (A.mp[mp] || 0)) / W.DATA.gf.panier_moyen_mp[mp]) : 0);
      W.DATA.gf.nb_lignes_mp[mp] = avantNl + n;
    }
    const ctx = { cur: Number(au.slice(5, 7)), dmax: au, coupe: coupeN1(n1, au), avert: rap.avertissements };
    recalculer(W, A, ctx);
    for (const n of CONSTANTES) remplacer(C[n], W[n]);
    Object.assign(rap, {
      appliquee: true, dmax: au, du: [...A.jours].sort()[0] ?? null, au, jours: A.jours.size, lignes: lignes.length,
      ca: r2(A.ca), qte: A.qte,
    });
  } catch (e) {
    rap.erreurs = [String((e && e.message) || e)];
  }
  return rap;
}

// Cumuls vides (recalcul du socle sans nouvelle vente : test d'idempotence)
function cumulsVides() {
  return {
    ca: 0, qte: 0, nl: 0, marque: {}, mp: {}, mpQte: {}, mpNl: {}, cat: new Map(), sous: new Map(), mapped: new Map(),
    total: new Map(), touche: new Set(), mois: new Set(), jours: new Set(),
  };
}

// Pour les tests : étapes internes
export const _interne = { ajouter, recalculer, majListe, copie, CONSTANTES, remplacer, cumulsVides };
