/**
 * Transformation (pure, sans entrée-sortie) des résultats ShopifyQL en agrégats quotidiens.
 *
 * Entrée : pour une boutique, les résultats des requêtes « ventes » (une ligne par jour × commande × type de ligne ×
 * référence × pays), « paiements » (marketplaces) et « contrôle » (totaux par jour de Shopify).
 * Sortie : lignes (jour × marketplace × produit), pays (jour × pays × marketplace), commandes (jour × marketplace) et paires
 * de produits achetés ensemble — le format de shopify_extension.json, lu par socle.js.
 *
 * Bases de calcul du CA HT (voir README) :
 *   marketplaces (BESTHERM)  CA HT = (ventes nettes + taxes) ÷ 1,2, ligne par ligne ; marketplace = passerelle de paiement
 *   site web (bestherm.fr)   CA HT = ventes nettes (déjà hors taxes) ; marketplace « Site Web »
 * Les ventes nettes sont celles du tableau de bord Shopify : remises et retours déduits (à la date du retour). Les
 * « ajustements de vente » (lignes sans produit qui corrigent un remboursement) sont rattachés au produit remboursé de la
 * même commande, de sorte que les totaux de chaque jour égalent exactement ceux de Shopify.
 */

export class Echec extends Error {
  constructor(msg, code = 2) { super(msg); this.code = code; }
}
// Liste tronquée par la limite de lignes : le chargeur coupe la fenêtre en deux et recommence
export class LimiteAtteinte extends Echec {}

export const CFG = {
  tva: 1.2, // même convention que l'ODP historique : CA HT = TTC ÷ 1,2
  limiteLignes: 10000, // lignes par requête de ventes ou de paiements (au-delà : fenêtre trop dense, à couper)
  fenetreJours: 14, // jours extraits par requête
  margePaiements: 3, // les paiements sont lus jusqu'à N jours après la fin de la fenêtre (paiement tardif d'une commande)
  tolerance: 0.011, // écart toléré (€ ou unités) entre les lignes d'un jour et le total du jour de Shopify
  sansPaiementMax: 0.02, // part maximale des commandes (hors 0 €) sans passerelle de paiement
  inconnuAvert: 0.03, // part du CA (références ou passerelles inconnues) au-delà de laquelle on avertit
  ecartTotalEchec: 0.15, // jours repris : variation relative du total au-delà de laquelle on refuse
};

export const MP_SITE = "Site Web", MP_AUTRE = "Autre";
export const PRODUIT_LIVRAISON = "Livraison", PRODUIT_AJUSTEMENT = "Ajustements Shopify", PRODUIT_SANS_REF = "Sans référence";
const PAYS_INCONNU = "Non renseigné";
const MARQUES_VENDEUR = { bestherm: "Bestherm", thomson: "Thomson", "hom'y": "HOM'Y", homy: "HOM'Y" };

// Noms de pays Shopify (anglais) → noms de l'application (français)
export const PAYS_EN_FR = {
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
  "Mayotte": "Mayotte", "New Caledonia": "Nouvelle-Calédonie", "French Polynesia": "Polynésie française",
  "Jersey": "Jersey", "Guernsey": "Guernesey", "Iceland": "Islande", "Serbia": "Serbie", "Turkey": "Turquie",
};

/* ------------------------------------------------------------------ utilitaires */
export const r2 = (x) => Math.round(x * 100) / 100;
const eur = (x) => new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(Math.round(x)) + " €";
const D = (s) => { const [y, m, d] = s.split("-").map(Number); return Date.UTC(y, m - 1, d); };
export const addDays = (s, n) => new Date(D(s) + n * 864e5).toISOString().slice(0, 10);
export const jours = (du, au) => { const l = []; for (let d = du; d <= au; d = addDays(d, 1)) l.push(d); return l; };
const nombre = (v, ctx) => {
  const x = Number(v);
  if (!Number.isFinite(x)) throw new Echec(`Valeur non numérique (${ctx}) : ${JSON.stringify(v)}`);
  return x;
};
const colonne = (res, nom) => {
  const i = (res.columns || []).findIndex((c) => c.name === nom);
  if (i < 0) throw new Echec(`Colonne « ${nom} » absente d'un résultat : ${String(res.query ?? "").slice(0, 100)}`);
  return i;
};

/* ------------------------------------------------------------------ correspondances */
export function normaliserSku(s) {
  return String(s ?? "").trim().replace(/(_never_used| never used)+$/i, "").replace(/-FLM$/i, "").replace(/\//g, "-");
}

// « Leroy Merlin – Bricoman » (accents, ponctuation, casse) → clé de comparaison sans ambiguïté
export function normaliserTitre(s) {
  return String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9+]+/g, " ").trim();
}

// Passerelle de paiement Shopify (« xxx via Shopping Feed ») → marketplace ; null si inconnue
export function marketplaceDe(passerelle, passerelles) {
  if (!passerelle) return null;
  const k = String(passerelle).toLowerCase().replace(/\s+via\s+shopping\s+feed\s*$/i, "").trim();
  return passerelles[k] ?? null;
}

// Rattache une ligne Shopify à un produit : 1) référence (SKU) de la table, 2) titre de la table (lignes sans référence),
// 3) à défaut le titre Shopify lui-même (produit nouveau : à ajouter à la table), la référence ou « Sans référence ».
export function produitDe(sku, titre, ref) {
  const code = normaliserSku(sku);
  if (code) {
    const nom = ref.skus[code.toUpperCase()];
    if (nom) return { nom, connu: true, code };
  }
  const t = String(titre ?? "").trim();
  if (t) {
    const nom = ref.titres?.[normaliserTitre(t)];
    if (nom) return { nom, connu: true, code };
  }
  if (t) return { nom: t, connu: false, code };
  if (code) return { nom: code, connu: false, code };
  return { nom: PRODUIT_SANS_REF, connu: false, code: "" };
}

export const marqueDuVendeur = (v) => MARQUES_VENDEUR[String(v ?? "").trim().toLowerCase().replace(/[’‘`´]/g, "'")] ?? null;

/* ------------------------------------------------------------------ requêtes ShopifyQL */
const TYPES = "line_type IN ('product', 'sale_adjustment')";
export const REQ = {
  ventes: (du, au) => `FROM sales SHOW quantity_ordered, net_sales, taxes GROUP BY day, order_name, line_type, product_variant_sku, product_title, shipping_country, product_vendor WHERE ${TYPES} SINCE ${du} UNTIL ${au} ORDER BY day, order_name LIMIT ${CFG.limiteLignes}`,
  paiements: (du, au) => `FROM payments SHOW gross_payments GROUP BY order_name, payment_gateway SINCE ${du} UNTIL ${au} ORDER BY order_name LIMIT ${CFG.limiteLignes}`,
  controle: (du, au) => `FROM sales SHOW quantity_ordered, net_sales, taxes WHERE ${TYPES} TIMESERIES day SINCE ${du} UNTIL ${au}`,
};

// Fenêtres de CFG.fenetreJours jours (la dernière est plus courte)
export function fenetres(du, au, pas = CFG.fenetreJours) {
  const l = [];
  for (let d = du; d <= au; d = addDays(d, pas)) l.push({ du: d, au: addDays(d, pas - 1) < au ? addDays(d, pas - 1) : au });
  return l;
}

// Requêtes d'une fenêtre pour une boutique : { id, query }
export function requetesFenetre(boutique, w, aujourdhui) {
  const q = [{ id: `ventes ${w.du}→${w.au}`, query: REQ.ventes(w.du, w.au) }];
  if (boutique === "marketplaces") {
    let fin = addDays(w.au, CFG.margePaiements);
    if (aujourdhui && fin > aujourdhui) fin = aujourdhui;
    q.push({ id: `paiements ${w.du}→${fin}`, query: REQ.paiements(w.du, fin) });
  }
  q.push({ id: `controle ${w.du}→${w.au}`, query: REQ.controle(w.du, w.au) });
  return q;
}

/* ------------------------------------------------------------------ transformation d'une boutique */
class Accu {
  constructor() { this.m = new Map(); }
  ajouter(cle, qte, ca) { const a = this.m.get(cle) ?? { qte: 0, ca: 0 }; a.qte += qte; a.ca += ca; this.m.set(cle, a); }
}

/**
 * @param {"marketplaces"|"site"} id
 * @param {{ventes: object[], paiements?: object[], controle: object[]}} jeux résultats ShopifyQL {columns, rows}
 * @param {object} ref table de référence (data/referentiel.json)
 * @param {{du: string, au: string, depuisPaires?: string}} fen jours attendus (tous présents, même sans vente)
 */
export function traiterBoutique(id, jeux, ref, fen) {
  const estSite = id === "site";
  const { du, au } = fen;
  const depuisPaires = fen.depuisPaires ?? "9999-12-31";
  const st = {
    qte: 0, net: 0, taxes: 0, ca: 0, lignes: 0, commandes: 0, sansPaiement: 0, sansPaiementCa: 0, sansPaiementListe: [],
    multiPasserelle: [], passerellesInconnues: new Map(), produitsInconnus: new Map(), paysInconnus: new Set(),
    ajustementsOrphelins: 0,
  };

  /* passerelle de chaque commande : celle du plus gros paiement (marketplaces) */
  const passerelleDe = new Map();
  if (!estSite) {
    const parCommande = new Map(); // commande → Map(passerelle → montant) ; une même ligne lue dans deux fenêtres n'est comptée qu'une fois
    for (const res of jeux.paiements ?? []) {
      if (!res.rows.length) continue; // un résultat vide n'a pas de colonnes
      if (res.rows.length >= CFG.limiteLignes) throw new LimiteAtteinte(`Paiements : limite de ${CFG.limiteLignes} lignes atteinte (liste tronquée)`);
      const iO = colonne(res, "order_name"), iG = colonne(res, "payment_gateway"), iP = colonne(res, "gross_payments");
      for (const r of res.rows) {
        const o = String(r[iO]), g = String(r[iG] ?? ""), v = nombre(r[iP], "paiements");
        const m = parCommande.get(o) ?? new Map();
        m.set(g, Math.max(m.get(g) ?? -Infinity, v));
        parCommande.set(o, m);
      }
    }
    for (const [o, m] of parCommande) {
      const l = [...m].sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1));
      passerelleDe.set(o, l[0][0]);
      if (new Set(l.map(([g]) => marketplaceDe(g, ref.passerelles) ?? g)).size > 1) st.multiPasserelle.push(o);
    }
  }

  /* lignes de ventes regroupées par (jour, commande) */
  const groupes = new Map();
  const parJour = new Map(); // contrôle : totaux des lignes par jour
  for (const res of jeux.ventes) {
    if (!res.rows.length) continue; // un résultat vide n'a pas de colonnes
    if (res.rows.length >= CFG.limiteLignes) throw new LimiteAtteinte(`Ventes : limite de ${CFG.limiteLignes} lignes atteinte (liste tronquée)`);
    const iD = colonne(res, "day"), iO = colonne(res, "order_name"), iT = colonne(res, "line_type"), iS = colonne(res, "product_variant_sku");
    const iTi = colonne(res, "product_title"), iC = colonne(res, "shipping_country"), iV = colonne(res, "product_vendor");
    const iQ = colonne(res, "quantity_ordered"), iN = colonne(res, "net_sales"), iX = colonne(res, "taxes");
    for (const r of res.rows) {
      const d = String(r[iD]).slice(0, 10);
      if (d < du || d > au) throw new Echec(`Ligne du ${d} hors de la fenêtre demandée (${du} → ${au}).`);
      const qte = nombre(r[iQ], "quantité"), net = nombre(r[iN], "ventes nettes"), tax = nombre(r[iX], "taxes");
      const t = parJour.get(d) ?? { qte: 0, net: 0, taxes: 0 };
      t.qte += qte; t.net += net; t.taxes += tax; parJour.set(d, t);
      st.qte += qte; st.net += net; st.taxes += tax;
      if (qte === 0 && net === 0 && tax === 0) continue; // ligne vide
      const o = String(r[iO]);
      const k = `${d}\u0000${o}`;
      const g = groupes.get(k) ?? { d, o, lignes: [], ajust: 0, paysAj: "" };
      const ht = estSite ? net : (net + tax) / CFG.tva;
      const pays = String(r[iC] ?? "").trim();
      if (String(r[iT]) === "sale_adjustment") { g.ajust += ht; g.paysAj = g.paysAj || pays; }
      else g.lignes.push({ sku: String(r[iS] ?? "").trim(), titre: String(r[iTi] ?? "").trim(), pays, vendeur: String(r[iV] ?? "").trim(), qte, ht });
      groupes.set(k, g);
    }
  }

  /* contrôle : les lignes lues égalent, jour par jour, les totaux de Shopify */
  const attendu = new Map();
  for (const res of jeux.controle) {
    if (!res.rows.length) continue;
    const iD = colonne(res, "day"), iQ = colonne(res, "quantity_ordered"), iN = colonne(res, "net_sales"), iX = colonne(res, "taxes");
    for (const r of res.rows) attendu.set(String(r[iD]).slice(0, 10), { qte: nombre(r[iQ], "contrôle"), net: nombre(r[iN], "contrôle"), taxes: nombre(r[iX], "contrôle") });
  }
  for (const d of jours(du, au)) {
    const a = attendu.get(d) ?? { qte: 0, net: 0, taxes: 0 }, b = parJour.get(d) ?? { qte: 0, net: 0, taxes: 0 };
    const tol = (x) => Math.max(CFG.tolerance, 0.00001 * Math.abs(x));
    if (!attendu.has(d) && (jeux.controle.length === 0)) throw new Echec(`${id} : aucun total de contrôle fourni.`);
    if (Math.abs(b.qte - a.qte) > CFG.tolerance || Math.abs(b.net - a.net) > tol(a.net) || Math.abs(b.taxes - a.taxes) > tol(a.taxes)) {
      throw new Echec(`${id} ${d} : lignes (${b.qte} u., ${r2(b.net)} € net, ${r2(b.taxes)} € taxes) ≠ total du jour Shopify (${a.qte} u., ${r2(a.net)} € net, ${r2(a.taxes)} € taxes) : extraction incomplète ou filtre inattendu. Aucune écriture.`);
    }
  }

  /* agrégats */
  const lignes = new Accu(), pays = new Accu(), commandes = new Map(), paires = new Map();
  const vendeurs = new Map(); // produit → Map(marque du vendeur Shopify → nombre de lignes)
  for (const g of groupes.values()) {
    // ajustement de vente : rattaché aux lignes remboursées de la commande (sinon à toutes), à défaut ligne propre
    if (Math.abs(g.ajust) > 0.005) {
      if (!g.lignes.length) { g.lignes.push({ sku: "", titre: PRODUIT_AJUSTEMENT, pays: g.paysAj, vendeur: "", qte: 0, ht: g.ajust, ajustement: true }); st.ajustementsOrphelins += g.ajust; }
      else {
        const cibles = g.lignes.filter((l) => l.ht < -0.005);
        const c = cibles.length ? cibles : g.lignes;
        const poids = c.map((l) => Math.abs(l.ht)), somme = poids.reduce((a, b) => a + b, 0);
        c.forEach((l, i) => { l.ht += g.ajust * (somme > 0 ? poids[i] / somme : 1 / c.length); });
      }
    }
    const caCommande = g.lignes.reduce((s, l) => s + l.ht, 0);
    // marketplace de la commande
    let mp = MP_SITE;
    if (!estSite) {
      const pg = passerelleDe.get(g.o);
      mp = marketplaceDe(pg, ref.passerelles);
      if (pg === undefined) {
        st.sansPaiement++;
        if (Math.abs(caCommande) > 0.005) { st.sansPaiementCa += caCommande; st.sansPaiementListe.push(g.o); }
        mp = MP_AUTRE; // commandes à 0 € (envois de remplacement) : sans paiement, classées « Autre »
      } else if (!mp) {
        st.passerellesInconnues.set(pg, (st.passerellesInconnues.get(pg) ?? 0) + caCommande);
        mp = MP_AUTRE;
      }
    }
    if (caCommande > 0.005) { const k = `${g.d}\u0000${mp}`; commandes.set(k, (commandes.get(k) ?? 0) + 1); st.commandes++; }
    const produitsAchetes = new Set();
    for (const l of g.lignes) {
      const p = l.ajustement ? { nom: PRODUIT_AJUSTEMENT, connu: true, code: "" } : produitDe(l.sku, l.titre, ref);
      if (!p.connu) { const a = st.produitsInconnus.get(p.nom) ?? { ca: 0, qte: 0, code: p.code }; a.ca += l.ht; a.qte += l.qte; st.produitsInconnus.set(p.nom, a); }
      const marqueV = marqueDuVendeur(l.vendeur);
      if (marqueV) { const m = vendeurs.get(p.nom) ?? new Map(); m.set(marqueV, (m.get(marqueV) ?? 0) + 1); vendeurs.set(p.nom, m); }
      let pa = PAYS_EN_FR[l.pays];
      if (!pa) { pa = l.pays || PAYS_INCONNU; if (l.pays) st.paysInconnus.add(l.pays); }
      st.ca += l.ht; st.lignes++;
      lignes.ajouter(`${g.d}\u0000${mp}\u0000${p.nom}`, l.qte, l.ht);
      pays.ajouter(`${g.d}\u0000${pa}\u0000${mp}`, l.qte, l.ht); // quantité par pays : onglet Marques › Répartitions
      if (!l.ajustement && l.qte > 0 && l.ht > 0 && p.nom !== PRODUIT_LIVRAISON) produitsAchetes.add(p.nom);
    }
    if (g.d >= depuisPaires && caCommande > 0.005 && produitsAchetes.size > 1) {
      const ps = [...produitsAchetes].sort();
      for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) {
        const k = `${g.d}\u0000${ps[i]}\u0000${ps[j]}`; paires.set(k, (paires.get(k) ?? 0) + 1);
      }
    }
  }

  // une fenêtre dont la plupart des commandes n'ont pas de paiement : jeu « payments » tronqué ou en retard
  if (!estSite && st.commandes >= 30 && st.sansPaiementListe.length / st.commandes > 5 * CFG.sansPaiementMax) {
    throw new Echec(`${id} ${du} → ${au} : ${st.sansPaiementListe.length} commandes sur ${st.commandes} sans passerelle de paiement (${((st.sansPaiementListe.length / st.commandes) * 100).toFixed(1)} %) : jeu « payments » incomplet. Aucune écriture.`);
  }
  return {
    id, du, au,
    lignes: [...lignes.m].map(([k, v]) => { const [d, mp, produit] = k.split("\u0000"); return { d, mp, produit, qte: v.qte, ca: r2(v.ca) }; }),
    pays: [...pays.m].map(([k, v]) => { const [d, p, mp] = k.split("\u0000"); return { d, pays: p, mp, qte: v.qte, ca: r2(v.ca) }; }),
    commandes: [...commandes].map(([k, n]) => { const [d, mp] = k.split("\u0000"); return { d, mp, n }; }),
    paires: [...paires].map(([k, n]) => { const [d, a, b] = k.split("\u0000"); return { d, a, b, n }; }),
    vendeurs, stats: st,
  };
}

/* ------------------------------------------------------------------ plusieurs fenêtres → une seule sortie */
export function agreger(sorties) {
  if (!sorties.length) throw new Echec("Aucune fenêtre à agréger", 1);
  const st = {
    qte: 0, net: 0, taxes: 0, ca: 0, lignes: 0, commandes: 0, sansPaiement: 0, sansPaiementCa: 0, sansPaiementListe: [], multiPasserelle: [],
    passerellesInconnues: new Map(), produitsInconnus: new Map(), paysInconnus: new Set(), ajustementsOrphelins: 0,
  };
  const vendeurs = new Map();
  const out = { id: sorties[0].id, du: sorties[0].du, au: sorties[0].au, lignes: [], pays: [], commandes: [], paires: [], vendeurs, stats: st };
  for (const o of sorties) {
    if (o.du < out.du) out.du = o.du;
    if (o.au > out.au) out.au = o.au;
    for (const k of ["lignes", "pays", "commandes", "paires"]) for (const x of o[k]) out[k].push(x);
    for (const k of ["qte", "net", "taxes", "ca", "lignes", "commandes", "sansPaiement", "sansPaiementCa", "ajustementsOrphelins"]) st[k] += o.stats[k];
    st.sansPaiementListe.push(...o.stats.sansPaiementListe); st.multiPasserelle.push(...o.stats.multiPasserelle);
    for (const [g, v] of o.stats.passerellesInconnues) st.passerellesInconnues.set(g, (st.passerellesInconnues.get(g) ?? 0) + v);
    for (const [n, v] of o.stats.produitsInconnus) { const a = st.produitsInconnus.get(n) ?? { ca: 0, qte: 0, code: v.code }; a.ca += v.ca; a.qte += v.qte; st.produitsInconnus.set(n, a); }
    for (const p of o.stats.paysInconnus) st.paysInconnus.add(p);
    for (const [n, m] of o.vendeurs) { const a = vendeurs.get(n) ?? new Map(); for (const [b, c] of m) a.set(b, (a.get(b) ?? 0) + c); vendeurs.set(n, a); }
  }
  return out;
}

// Contrôles sur l'ensemble de l'extraction ; lève Echec si elle est suspecte
export function controlerSortie(o) {
  const { id, stats: st } = o;
  if (!o.lignes.some((l) => l.qte > 0)) throw new Echec(`${id} : aucune vente sur ${o.du} → ${o.au} : extraction suspecte. Aucune écriture.`);
  if (id !== "site" && st.commandes > 0 && st.sansPaiementListe.length / st.commandes > CFG.sansPaiementMax) {
    throw new Echec(`${id} : ${st.sansPaiementListe.length} commandes avec CA sans passerelle de paiement sur ${st.commandes} (${((st.sansPaiementListe.length / st.commandes) * 100).toFixed(1)} %) : jeu « payments » incomplet. Aucune écriture.`);
  }
}

// Informations pour le compte rendu (ne bloquent rien)
export function avertissementsDe(o) {
  const st = o.stats, av = [];
  if (st.passerellesInconnues.size) av.push(`Passerelles de paiement inconnues, classées « Autre » (${eur([...st.passerellesInconnues.values()].reduce((a, b) => a + b, 0))}) : ${[...st.passerellesInconnues].map(([g, v]) => `${g} ${eur(v)}`).join(", ")}`);
  if (st.sansPaiementListe.length) av.push(`${st.sansPaiementListe.length} commande(s) avec CA sans passerelle (classées « Autre », ${eur(st.sansPaiementCa)}) : ${st.sansPaiementListe.slice(0, 6).join(", ")}`);
  if (st.produitsInconnus.size) {
    const tot = [...st.produitsInconnus.values()].reduce((a, b) => a + b.ca, 0);
    av.push(`Produits absents de la table de référence (${eur(tot)}, ${((tot / (st.ca || 1)) * 100).toFixed(1)} % du CA) : ${[...st.produitsInconnus].sort((a, b) => b[1].ca - a[1].ca).slice(0, 8).map(([n, v]) => `${n.slice(0, 60)}${v.code ? ` [${v.code}]` : ""} ${eur(v.ca)}`).join(" ; ")}`);
  }
  if (st.paysInconnus.size) av.push(`Pays sans traduction (conservés tels quels) : ${[...st.paysInconnus].join(", ")}`);
  if (st.multiPasserelle.length) av.push(`${st.multiPasserelle.length} commande(s) payée(s) via plusieurs marketplaces (passerelle dominante retenue)`);
  if (Math.abs(st.ajustementsOrphelins) > 0.5) av.push(`Ajustements de vente sans produit dans la commande (${eur(st.ajustementsOrphelins)}) : comptés sur « ${PRODUIT_AJUSTEMENT} »`);
  return av;
}

// Marque du vendeur Shopify la plus fréquente d'un produit (null si aucune marque reconnue)
export function marqueDominante(m) {
  if (!m || !m.size) return null;
  return [...m].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0][0];
}
