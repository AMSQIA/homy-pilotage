/**
 * Calculs de l'onglet « Répartitions » (page Marques) — aucun accès à l'interface : tout est pur et testable
 * (scripts/extension/selftest.mjs vérifie que chaque total retombe sur le CA et les unités de l'application).
 *
 * Quatre dimensions, chacune croisée avec la marketplace (le site web en fait partie) et le mois, en CA HT et en quantités :
 *   - pays      : PAYS_MONTHLY [pays, marketplace, année, mois, CA, quantité] (quantité : 2026 seulement)
 *   - marque    : SKU_MONTHLY × SKU_MARQUE (Bestherm, Thomson, HOM'Y)
 *   - categorie : SKU_MONTHLY × PRODUCT_TO_CATEGORY (les 5 catégories du catalogue ; le reste = « Autres produits »)
 *   - sous      : SKU_MONTHLY × SKU_SOUS_SOUS_FAMILLE (« sous-catégories » du catalogue, comme l'onglet Normes / Catégories)
 *
 * Les tableaux d'entrée sont ceux de App.jsx APRÈS le prolongement Shopify (extension.js) : les ventes Shopify y sont déjà ajoutées,
 * aux mêmes lignes que le fichier ODP. Le cube est donc toujours aligné sur les KPI du tableau de bord.
 *
 * Couleurs : palette de 8 teintes, validée avec le script validate_palette.js de la compétence « dataviz » (mode sombre, fonds #0A0908 puis
 * #161514 = fond d'une carte) : clarté OKLCH dans la bande 0,48–0,67, chroma ≥ 0,1, contraste ≥ 3:1, écart daltonien ≥ 14,5 et écart en
 * vision normale ≥ 21,5 entre teintes voisines (empilements et barres). L'ordre d'empilement est FIXE (il suit la palette, jamais le rang) :
 * une couleur suit l'entité, pas sa position. La légende, le classement et l'infobulle portent toujours le nom : la couleur n'est jamais
 * seule à identifier une entité. « Autres » est un gris neutre, hors palette.
 */

export const AUTRES_PRODUITS = "Autres produits"; // clé interne : produits sans catégorie (pièces, accessoires, livraison)
export const DIMS = ["pays", "marque", "categorie", "sous"];
export const NB_SERIES = 6; // entités tracées une à une dans les graphiques ; le reste est regroupé en « Autres »

/* ------------------------------------------------------------------------------------------------ couleurs */
export const PALETTE = ["#F75212", "#3F93F4", "#0DAC79", "#987CE9", "#E66162", "#00A4BA", "#C28408", "#DD5DA2"]; // orange, bleu, vert, violet, rouge, cyan, ambre, rose
export const GRIS = "#7C756A"; // « Autres » : neutre, jamais une teinte de la palette
export const COULEURS_FIXES = {
  // les huit premiers pays par CA 2026 : une couleur par pays, quelle que soit la marketplace ou l'année affichée
  pays: { France: PALETTE[0], Belgique: PALETTE[1], Espagne: PALETTE[2], "Royaume-Uni": PALETTE[3], Italie: PALETTE[4], Portugal: PALETTE[5], "Pays-Bas": PALETTE[6], Allemagne: PALETTE[7] },
  // marques : orange Bestherm (clarté recalée dans la bande), rouge Thomson et violet HOM'Y de la charte ; l'orange et le rouge, trop proches
  // (écart 12,5 en vision normale), ne se touchent jamais : ordre d'empilement Bestherm · HOM'Y · Thomson (écarts 31 et 30)
  marque: { Bestherm: "#F75212", "HOM'Y": "#8B5CF6", Thomson: "#D50032" },
  categorie: {
    "Radiateur électrique fixe": PALETTE[0], "Sèche-serviettes électrique": PALETTE[1], "Ventilateur de plafond": PALETTE[2],
    "Déshumidificateur": PALETTE[3], "Radiateur électrique mobile": PALETTE[4], [AUTRES_PRODUITS]: GRIS,
  },
  // les huit premières sous-catégories par CA 2026 ; une sous-catégorie nouvelle prend la première teinte laissée libre
  sous: {
    "1er prix Céramique": PALETTE[0], "Céramique + wifi": PALETTE[1], "1er prix vertical": PALETTE[2], "Sèche-seviette + soufflerie": PALETTE[3],
    "1er prix format plinthe": PALETTE[4], "Céramique + film + p&p": PALETTE[5], "Ventil. De plafond + 3 pales bois FSC": PALETTE[6],
    "Sèche-seviette + wifi + Soufflerie": PALETTE[7], [AUTRES_PRODUITS]: GRIS,
  },
};
export const ORDRE_PILE = { marque: ["Bestherm", "HOM'Y", "Thomson"] };

/**
 * Couleur et ordre d'empilement (du bas vers le haut) des entités tracées une à une.
 *  noms : entités affichées, par rang décroissant.
 * Les couleurs fixes d'abord (la couleur suit l'entité) ; une entité inconnue prend la première teinte de la palette laissée libre.
 */
export function attribuerCouleurs(dim, noms) {
  const fixes = COULEURS_FIXES[dim] || {};
  const couleur = new Map(), pris = new Set();
  for (const n of noms) { const c = fixes[n]; if (c) { couleur.set(n, c); pris.add(c); } }
  const libres = PALETTE.filter((c) => !pris.has(c));
  for (const n of noms) if (!couleur.has(n)) couleur.set(n, libres.shift() || GRIS);
  const ordre = ORDRE_PILE[dim];
  const rang = (n) => {
    const i = ordre ? ordre.indexOf(n) : -1;
    if (i >= 0) return i;
    const c = couleur.get(n);
    return c === GRIS ? 1000 : 100 + Math.max(0, PALETTE.indexOf(c));
  };
  const pile = [...noms].sort((a, b) => rang(a) - rang(b) || noms.indexOf(a) - noms.indexOf(b));
  return { couleur, pile };
}

/* ------------------------------------------------------------------------------------------------ cube */
const zeros = (n) => new Float64Array(n);
const exclusion = (exclure) => (exclure && exclure.length ? new Set(exclure) : null); // entités écartées du calcul (ex. ["France"])

export function construireRepartitions(W) {
  const mps = [...W.SKU_MPS];
  for (const r of W.PAYS_MONTHLY) if (!mps.includes(r[1])) mps.push(r[1]);
  const nMp = mps.length;
  const mpIdx = new Map(mps.map((m, i) => [m, i]));
  const anSet = new Set();
  for (const r of W.SKU_MONTHLY) anSet.add(r[2]);
  for (const r of W.PAYS_MONTHLY) anSet.add(r[2]);
  const annees = [...anSet].sort((a, b) => a - b);
  const anIdx = new Map(annees.map((a, i) => [a, i]));
  const nAn = annees.length;
  const derniere = annees[nAn - 1];

  // entité de chaque produit pour les trois dimensions « catalogue »
  const nomP = W.SKU_PRODUIT;
  const entiteProduit = {
    marque: nomP.map((n, i) => (W.SKU_MARQUE && W.SKU_MARQUE[i]) || AUTRES_PRODUITS),
    categorie: nomP.map((n) => W.PRODUCT_TO_CATEGORY[n] || AUTRES_PRODUITS),
    sous: nomP.map((n, i) => (W.PRODUCT_TO_CATEGORY[n] && W.SKU_SOUS_SOUS_FAMILLE[i]) || AUTRES_PRODUITS),
  };

  // lignes de faits normalisées : [indexEntité, indexMarketplace, indexAnnée, mois0, CA, quantité|null]
  const dims = {};
  const construire = (id, noms, lignes, qteFiable) => {
    // classement des entités : CA de la dernière année, puis de l'année d'avant, puis ordre alphabétique (déterministe)
    const tot = new Map(noms.map((n) => [n, [0, 0]]));
    for (const [e, , a, , ca] of lignes) {
      const t = tot.get(noms[e]);
      if (anIdx.get(derniere) === a) t[0] += ca; else if (a === nAn - 2) t[1] += ca;
    }
    const ents = [...noms].sort((x, y) => tot.get(y)[0] - tot.get(x)[0] || tot.get(y)[1] - tot.get(x)[1] || (x < y ? -1 : 1));
    const pos = new Map(ents.map((n, i) => [n, i]));
    const taille = ents.length * nMp * 12;
    const ca = annees.map(() => zeros(taille)), qte = annees.map(() => zeros(taille));
    for (const [e, m, a, mo, c, q] of lignes) {
      const k = (pos.get(noms[e]) * nMp + m) * 12 + mo;
      ca[a][k] += c;
      if (q !== null) qte[a][k] += q;
    }
    const qteOk = {};
    annees.forEach((an, a) => { qteOk[an] = qteFiable[a]; });
    dims[id] = { id, ents, ca, qte, qteOk };
  };

  // dimensions « catalogue » : une ligne de SKU_MONTHLY = un produit × marketplace × mois
  const fait = { marque: [], categorie: [], sous: [] };
  const nomsTab = { marque: [], categorie: [], sous: [] };
  const idxNom = { marque: new Map(), categorie: new Map(), sous: new Map() };
  const entIdx = (d, n) => { let i = idxNom[d].get(n); if (i === undefined) { i = nomsTab[d].length; nomsTab[d].push(n); idxNom[d].set(n, i); } return i; };
  const qteProduits = annees.map(() => false);
  for (const [p, m, an, mo, ca, q] of W.SKU_MONTHLY) {
    const a = anIdx.get(an);
    qteProduits[a] = true;
    for (const d of ["marque", "categorie", "sous"]) fait[d].push([entIdx(d, entiteProduit[d][p]), m, a, mo - 1, ca, q || 0]);
  }
  for (const d of ["marque", "categorie", "sous"]) construire(d, nomsTab[d], fait[d], qteProduits);

  // dimension pays : une quantité n'est fiable pour une année que si TOUTES ses lignes en portent une
  const paysNoms = [], paysIdx = new Map(), faitPays = [];
  const lignesAn = annees.map(() => 0), lignesAvecQte = annees.map(() => 0);
  for (const r of W.PAYS_MONTHLY) {
    const [pays, mp, an, mo, ca] = r;
    let e = paysIdx.get(pays);
    if (e === undefined) { e = paysNoms.length; paysNoms.push(pays); paysIdx.set(pays, e); }
    const a = anIdx.get(an);
    const q = typeof r[5] === "number" && Number.isFinite(r[5]) ? r[5] : null;
    lignesAn[a]++; if (q !== null) lignesAvecQte[a]++;
    faitPays.push([e, mpIdx.get(mp), a, mo - 1, ca, q]);
  }
  construire("pays", paysNoms, faitPays, annees.map((an, a) => lignesAn[a] > 0 && lignesAvecQte[a] === lignesAn[a]));

  return { mps, mpIdx, nMp, annees, anIdx, dims };
}

export const dispoQte = (rep, dim, an) => !!(rep.dims[dim] && rep.dims[dim].qteOk[an]);
const source = (rep, dim, an, mesure) => {
  const d = rep.dims[dim], a = rep.anIdx.get(an);
  if (!d || a === undefined) return null;
  if (mesure === "qte") return d.qteOk[an] ? d.qte[a] : null;
  return d.ca[a];
};

/**
 * Évolution mensuelle par entité (graphique, tableau, classement).
 *  mp : null = toutes les marketplaces (site web compris), sinon le nom d'une marketplace.
 *  exclure : noms d'entités écartées (leurs ventes ne comptent ni dans les entités ni dans les totaux).
 * Renvoie { dispo, ents: [{ nom, mois[12], total }] triées par total décroissant (les entités sans vente sont écartées), totalMois[12], total }.
 */
export function vue(rep, { dim, an, mesure, mp = null, exclure = null }) {
  const d = rep.dims[dim], src = source(rep, dim, an, mesure), ex = exclusion(exclure);
  const totalMois = zeros(12);
  if (!d || !src) return { dispo: false, ents: [], totalMois, total: 0 };
  const m0 = mp === null ? 0 : rep.mpIdx.get(mp), m1 = mp === null ? rep.nMp : m0 + 1;
  if (m0 === undefined) return { dispo: true, ents: [], totalMois, total: 0 };
  const ents = [];
  d.ents.forEach((nom, e) => {
    if (ex && ex.has(nom)) return;
    const mois = zeros(12);
    let total = 0;
    for (let m = m0; m < m1; m++) {
      const b = (e * rep.nMp + m) * 12;
      for (let mo = 0; mo < 12; mo++) { const v = src[b + mo]; mois[mo] += v; total += v; totalMois[mo] += v; }
    }
    if (total !== 0) ents.push({ nom, mois, total });
  });
  ents.sort((x, y) => y.total - x.total);
  let total = 0; for (const v of totalMois) total += v;
  return { dispo: true, ents, totalMois, total };
}

/**
 * Détail marketplace × mois pour une entité (ent = null : toutes les entités confondues).
 * Chaque ligne porte aussi la base « toutes entités » (baseMois, baseTotal) pour calculer la part de l'entité dans la case.
 * Lignes triées par base décroissante (l'ordre ne bouge donc pas quand on change d'entité) ; les marketplaces sans vente sont écartées.
 */
export function matrice(rep, { dim, an, mesure, ent = null, exclure = null }) {
  const d = rep.dims[dim], src = source(rep, dim, an, mesure), ex = exclusion(exclure);
  const nul = () => ({ mois: zeros(12), total: 0, baseMois: zeros(12), baseTotal: 0 });
  const total = nul();
  if (!d || !src) return { dispo: false, lignes: [], total };
  const e0 = ent === null ? -1 : d.ents.indexOf(ent);
  const lignes = [];
  for (let m = 0; m < rep.nMp; m++) {
    const l = { mp: rep.mps[m], ...nul() };
    d.ents.forEach((nom, e) => {
      if (ex && ex.has(nom)) return;
      const b = (e * rep.nMp + m) * 12;
      for (let mo = 0; mo < 12; mo++) {
        const v = src[b + mo];
        l.baseMois[mo] += v;
        if (ent === null || e === e0) l.mois[mo] += v;
      }
    });
    for (let mo = 0; mo < 12; mo++) { l.total += l.mois[mo]; l.baseTotal += l.baseMois[mo]; }
    if (l.baseTotal === 0) continue;
    for (let mo = 0; mo < 12; mo++) { total.mois[mo] += l.mois[mo]; total.baseMois[mo] += l.baseMois[mo]; }
    total.total += l.total; total.baseTotal += l.baseTotal;
    lignes.push(l);
  }
  lignes.sort((x, y) => y.baseTotal - x.baseTotal);
  return { dispo: true, lignes, total };
}

/**
 * Répartition de chaque marketplace entre les entités sur l'année (barres de mix) :
 * { ents: [noms par total décroissant], lignes: [{ mp, total, v[ents] }] } — marketplaces triées par total décroissant.
 */
export function partsParMarketplace(rep, { dim, an, mesure, exclure = null }) {
  const d = rep.dims[dim], src = source(rep, dim, an, mesure), ex = exclusion(exclure);
  if (!d || !src) return { ents: [], lignes: [] };
  const tot = d.ents.map((n, e) => { let s = 0; for (let m = 0; m < rep.nMp; m++) { const b = (e * rep.nMp + m) * 12; for (let mo = 0; mo < 12; mo++) s += src[b + mo]; } return s; });
  const ordre = d.ents.map((n, e) => e).filter((e) => tot[e] !== 0 && !(ex && ex.has(d.ents[e]))).sort((x, y) => tot[y] - tot[x]);
  const lignes = [];
  for (let m = 0; m < rep.nMp; m++) {
    const v = ordre.map((e) => { const b = (e * rep.nMp + m) * 12; let s = 0; for (let mo = 0; mo < 12; mo++) s += src[b + mo]; return s; });
    const total = v.reduce((s, x) => s + x, 0);
    if (total !== 0) lignes.push({ mp: rep.mps[m], total, v });
  }
  lignes.sort((x, y) => y.total - x.total);
  return { ents: ordre.map((e) => d.ents[e]), lignes };
}

/** Regroupe les entités au-delà de `n` : { visibles (rang décroissant), autres (reste, mois[12] et total sommés) | null }. */
export function replier(ents, n = NB_SERIES) {
  const visibles = ents.slice(0, n), reste = ents.slice(n);
  if (!reste.length) return { visibles, autres: null };
  const mois = zeros(12); let total = 0;
  for (const x of reste) { for (let i = 0; i < 12; i++) mois[i] += x.mois[i]; total += x.total; }
  return { visibles, autres: { nom: null, mois, total, nb: reste.length } };
}

/** Mois en cours d'après le dernier jour de données : { an, mois (1-12), jour, joursDuMois, partiel }. */
export function infoMois(dmax) {
  const [a, m, j] = dmax.split("-").map(Number);
  const joursDuMois = new Date(Date.UTC(a, m, 0)).getUTCDate();
  return { an: a, mois: m, jour: j, joursDuMois, partiel: j < joursDuMois };
}
