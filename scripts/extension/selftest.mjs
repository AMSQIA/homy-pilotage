#!/usr/bin/env node
/**
 * Contrôle de cohérence du prolongement Shopify (extension.js) sur les VRAIES données du dépôt.
 *
 *   node scripts/extension/selftest.mjs
 *
 * Charge les constantes de App.jsx (socle ODP), shopify_extension.json et data/n1_2025.json, applique le
 * prolongement exactement comme l'application au chargement, puis vérifie :
 *   1. chaque tableau qui porte un chiffre d'affaires (KPI, courbes mensuelles, marques, marketplaces, produits, pays,
 *      semaines…) augmente EXACTEMENT du CA de l'extraction — idem pour les quantités et les lignes ;
 *   2. la cohérence interne du résultat (totaux égaux entre onglets, dictionnaires alignés, classements triés,
 *      pas de vente dans un mois futur, dernière semaine = semaine de DMAX, N-1 à date identique) ;
 *   3. la robustesse : extraction invalide, marketplace inconnue (échec atomique : rien n'est modifié), extraction déjà
 *      couverte par un nouvel export ODP (rien à ajouter), chevauchement partiel (jours ODP écartés), déterminisme ;
 *   3 bis. les répartitions de l'onglet Marques › Répartitions (repartitions.js) : pays, marque, catégorie et sous-catégorie × marketplace × mois
 *      retombent sur les totaux du tableau de bord (CA et quantités), les marques sur monthly_by_brand, les catégories sur category_by_mp,
 *      le détail par pays sur le détail par produit, couleurs stables par entité, « hors France », quantités par pays absentes en 2025 ;
 *   4. la chaîne d'extraction (selftest_pipeline.mjs, résultats ShopifyQL synthétiques) : fenêtre de dates, passerelles →
 *      marketplaces, CA HT, contrôles de cohérence, indépendance des deux boutiques, fusion avec l'extraction précédente.
 *
 * À lancer après chaque `refresh_extension.mjs apply` et avant de publier. Code de sortie 0 = tout est cohérent.
 */
import { etendre, validerExtension, dmaxEffectif, excelWeekOf, lignesExtension } from "../../extension.js";
import { lireApp, lireJson, copie } from "./lib_app.mjs";
import { construireRepartitions, vue as repVue, matrice as repMatrice, partsParMarketplace, dispoQte, replier, attribuerCouleurs, infoMois, PALETTE, GRIS, COULEURS_FIXES, AUTRES_PRODUITS, NB_SERIES } from "../../repartitions.js";

const echecs = [];
let controles = 0;
const ok = (cond, msg) => { controles++; if (!cond) echecs.push(msg); };
const proche = (a, b, tol = 0.1) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tol;
const r2 = (x) => Math.round(x * 100) / 100;
const S = (a) => (a || []).reduce((s, v) => s + (v || 0), 0);

// Chaîne d'extraction (données synthétiques) : fenêtre, passerelles, contrôles, indépendance des boutiques, fusion
await (await import("./selftest_pipeline.mjs")).testerPipeline(ok);

const app = lireApp();
const ext = lireJson("shopify_extension.json");
const n1 = lireJson("data/n1_2025.json");
const DMAX_ODP = app.dmaxOdp;
const AN = 2026;

/* ---------------------------------------------------------------------------------------------- 1. semaines Excel */
ok(excelWeekOf("2026-01-01") === 1 && excelWeekOf("2026-01-03") === 1, "semaine 1 = 1er → 3 janvier 2026");
ok(excelWeekOf("2026-01-04") === 2, "semaine 2 commence le dimanche 4 janvier");
ok(excelWeekOf("2026-10-03") === 40 && excelWeekOf("2026-10-04") === 41, "semaine 40 se termine le samedi 3 octobre");
ok(excelWeekOf("2026-10-10") === 41 && excelWeekOf("2026-10-11") === 42, "semaine 41 = 4 → 10 octobre");

/* ---------------------------------------------------------------------------------------------- 2. extraction */
const v = validerExtension(ext, DMAX_ODP);
ok(v.ok, `extraction invalide : ${v.erreurs.join(" ; ")}`);
const dmax = dmaxEffectif(DMAX_ODP, ext);
if (!v.ok || dmax <= DMAX_ODP) {
  console.log(v.ok
    ? `SELFTEST · extraction couverte par l'ODP (ODP ${DMAX_ODP}, boutiques ${dmax}) : rien à prolonger, contrôles réels ignorés`
    : "SELFTEST · contrôles réels impossibles (extraction invalide)");
  for (const e of echecs) console.log(`ÉCHEC · ${e}`);
  process.exit(echecs.length ? 1 : 0);
}

const lignes = lignesExtension(ext).filter((x) => x.d > DMAX_ODP && x.d <= dmax);
const attendu = { ca: r2(S(lignes.map((x) => x.ca))), qte: S(lignes.map((x) => x.qte)), nl: 0 };
ok(lignes.length > 0 && attendu.ca > 0, "l'extraction ne contient aucune vente après l'ODP");
// Lignes de commande (base du panier moyen) : l'ODP compte UNE LIGNE PAR UNITÉ pour les marketplaces dont lignes ÷ unités ≥ 0,99
// sur le socle (Amazon, Cdiscount, site web…), une ligne par commande et référence pour les autres (Leroy Merlin, ManoMano, Autre).
const gfSocle = app.constante("DATA").gf;
const parMp = {};
for (const x of lignes) { const a = (parMp[x.mp] ||= { q: 0, nl: 0 }); a.q += x.qte; a.nl += x.nl; }
const lignesShopify = S(Object.values(parMp).map((a) => a.nl));
attendu.nl = S(Object.entries(parMp).map(([mp, a]) => { const l = gfSocle.nb_lignes_mp?.[mp], q = gfSocle.qte_by_mp?.[mp]; return l > 0 && q > 0 && l / q >= 0.99 ? a.q : a.nl; }));
ok(attendu.nl >= lignesShopify && attendu.nl <= attendu.qte, `lignes comptées (${attendu.nl}) hors de l'intervalle [lignes Shopify ${lignesShopify} ; unités ${attendu.qte}]`);

function totaux(C) {
  const D = C.DATA, an = (r) => r[2] === AN;
  return {
    ca: {
      kpi: D.kpi.ca_total_2026, sku_monthly: S(C.SKU_MONTHLY.filter(an).map((r) => r[4])), monthly_total: S(D.monthly_total[AN]),
      marques: S(Object.values(D.monthly_by_brand).map((b) => S(b[AN]))), marketplaces: S(Object.values(D.gf.monthly_total_by_mp).map((m) => S(m[AN]))),
      marques_par_mp: S(Object.values(D.gf.brand_by_mp_month).map((g) => S(Object.values(g).map((a) => S(a))))),
      pays: S(C.PAYS_MONTHLY.filter(an).map((r) => r[4])), semaines: S(C.WEEKLY_TOTALS.map((r) => r[1])),
      semaines_mp: S(C.WEEKLY_BY_MP.map((r) => r[2])), semaines_produit: S(C.WEEKLY_BY_PROD.map((r) => r[2])),
      mp_vs_objectif: S(D.mp_vs_objectif.map((m) => m.ca)), brand_yoy: S(Object.values(D.brand_yoy).map((y) => y[AN])),
      total_yoy: D.total_yoy_comparable[AN],
    },
    qte: { kpi: D.kpi.qte_total_2026, sku_monthly: S(C.SKU_MONTHLY.filter(an).map((r) => r[5])), pays: S(C.PAYS_MONTHLY.filter(an).map((r) => r[5] || 0)), par_mp: S(Object.values(D.gf.qte_by_mp)), semaines: S(C.WEEKLY_TOTALS.map((r) => r[2])), semaines_mp: S(C.WEEKLY_BY_MP.map((r) => r[3])) },
    nl: { kpi: D.kpi.nb_lignes_2026, par_mp: S(Object.values(D.gf.nb_lignes_mp || {})) },
  };
}

/* ---------------------------------------------------------------------------------------------- 3. application réelle */
const C = app.constantes();
const t0 = totaux(C);
const rap = etendre(C, ext, n1, { dmaxOdp: DMAX_ODP });
ok(rap.appliquee === true, `prolongement non appliqué : ${(rap.erreurs || []).join(" ; ")}`);
if (!rap.appliquee) { for (const e of echecs) console.log(`ÉCHEC · ${e}`); process.exit(1); }
ok(rap.dmax === dmax && rap.du === lignes.map((x) => x.d).sort()[0], `rapport : dmax ${rap.dmax} / du ${rap.du}`);
ok(proche(rap.ca, attendu.ca) && rap.qte === attendu.qte, "rapport : CA / quantités différents de l'extraction");
const t1 = totaux(C);

for (const [k, a] of Object.entries(t0.ca)) ok(proche(t1.ca[k] - a, attendu.ca), `CA « ${k} » : +${r2(t1.ca[k] - a)} au lieu de +${attendu.ca}`);
for (const [k, a] of Object.entries(t0.qte)) ok(t1.qte[k] - a === attendu.qte, `quantités « ${k} » : +${t1.qte[k] - a} au lieu de +${attendu.qte}`);
for (const [k, a] of Object.entries(t0.nl)) ok(t1.nl[k] - a === attendu.nl, `lignes « ${k} » : +${t1.nl[k] - a} au lieu de +${attendu.nl}`);

const D = C.DATA, k = D.kpi, cur = Number(dmax.slice(5, 7));
// cohérence interne : les onglets s'accordent sur le même total
for (const [nom, val] of Object.entries(t1.ca)) ok(proche(val, k.ca_total_2026, 0.5), `total « ${nom} » (${r2(val)}) ≠ KPI (${k.ca_total_2026})`);
for (const [nom, val] of Object.entries(t1.qte)) ok(val === k.qte_total_2026, `quantités « ${nom} » (${val}) ≠ KPI (${k.qte_total_2026})`);
ok(t1.nl.par_mp === k.nb_lignes_2026, `lignes par marketplace (${t1.nl.par_mp}) ≠ KPI (${k.nb_lignes_2026})`);
ok(k.pct_objectif_atteint === r2((k.ca_total_2026 / k.objectif_annuel_total) * 100), "% de l'objectif ≠ CA / objectif");
ok(k.panier_moyen_2026 === r2(k.ca_total_2026 / k.nb_lignes_2026), "panier moyen ≠ CA / nombre de lignes");
ok(D.monthly_total[AN].slice(cur).every((x) => x === 0), "vente dans un mois futur de la courbe 2026");
ok(D.monthly_total[AN][cur - 1] > 0, "aucune vente dans le mois en cours");
for (const m of D.mp_vs_objectif) ok(proche(m.ca, S(D.gf.monthly_total_by_mp[m.marketplace]?.[AN])), `${m.marketplace} : CA (${m.ca}) ≠ somme de sa courbe mensuelle`);
const classes = D.mp_vs_objectif.filter((m) => m.marketplace !== "Bricoman");
ok(classes.every((m, i) => i === 0 || classes[i - 1].ca >= m.ca), "marketplaces non triées par CA décroissant");
ok(D.mp_vs_objectif[D.mp_vs_objectif.length - 1].marketplace === "Bricoman", "Bricoman n'est plus en dernier");
ok(D.total_yoy_comparable[AN - 2] === undefined && D.total_yoy_comparable[AN - 1] > 0, "N-1 : total comparable absent ou N-2 resté");
ok(D.cut_n1.jusqu_au === dmax.slice(5), `coupe N-1 jusqu'au ${D.cut_n1.jusqu_au} au lieu de ${dmax.slice(5)}`);
ok(proche(D.cut_n1.total[AN - 1], S(Object.values(D.cut_n1.mp).map((x) => x[AN - 1])), 0.1), "coupe N-1 : total ≠ somme des marketplaces");
ok(proche(S(C.SKU_CUT_N1.map((r) => r[2])), D.cut_n1.total[AN - 1], 0.1), "SKU_CUT_N1 : somme ≠ total de la coupe N-1");
ok(C.WEEKLY_TOTALS.every((w) => w[0] <= excelWeekOf(dmax)) && C.WEEKLY_TOTALS.some((w) => w[0] === excelWeekOf(dmax)), "dernière semaine ≠ semaine de la dernière donnée");

// dictionnaires alignés
const nP = C.SKU_PRODUIT.length;
ok(new Set(C.SKU_PRODUIT).size === nP, "produits en double dans SKU_PRODUIT");
for (const nom of ["SKU_DESTOCKAGE", "SKU_FAMILLE", "SKU_WIFI", "SKU_PLINTHE", "SKU_VERTICAL", "SKU_SOUS_FAMILLE", "SKU_SOUS_SOUS_FAMILLE", "SKU_MARQUE"]) ok(C[nom].length === nP, `${nom} (${C[nom].length}) désaligné de SKU_PRODUIT (${nP})`);
ok(C.SKU_MONTHLY.every((r) => r[0] >= 0 && r[0] < nP && r[1] >= 0 && r[1] < C.SKU_MPS.length), "SKU_MONTHLY : index hors dictionnaire");
ok(C.SKU_MARQUE.every((m) => typeof m === "string" && m.length > 0), "SKU_MARQUE : produit sans marque");
ok(C.PAYS_MONTHLY.every((r) => r.length === (r[2] === AN ? 6 : 5) && Number.isInteger(r[3]) && r[3] >= 1 && r[3] <= 12 && (r.length < 6 || (Number.isInteger(r[5]) && r[5] >= 0))), "PAYS_MONTHLY : 2026 = [pays, marketplace, année, mois, CA, quantité], 2025 = sans quantité");
ok(C.SKU_CUT_N1.every((r) => r[0] >= 0 && r[0] < nP && r[1] >= 0 && r[1] < C.SKU_MPS.length), "SKU_CUT_N1 : index hors dictionnaire");
ok(D.price_tracking.every((r) => C.SKU_PRODUIT.includes(r[0]) && C.SKU_MPS.includes(r[1])), "price_tracking : produit ou marketplace inconnu");
ok(D.products_top15.every((p, i) => i === 0 || D.products_top15[i - 1].ca >= p.ca) && D.products_top15[0].produit === D.best_seller_2026.produit, "classement des produits incohérent");
for (const mp of Object.keys(D.gf.top_products_by_mp)) ok(D.gf.top_products_by_mp[mp].every((p, i, a) => i === 0 || a[i - 1].ca >= p.ca), `top produits ${mp} non trié`);
ok(Object.values(D.category_by_mp.categories.Toutes || []).every((c) => c.ca >= 0 && c.pct >= 0 && c.pct <= 100), "catégories : part hors 0-100 %");

/* ---------------------------------------------------------------------------------------------- 3 bis. répartitions (onglet Marques › Répartitions) */
{
  const R = construireRepartitions(C);
  const parAn = (an, i) => S(C.SKU_MONTHLY.filter((r) => r[2] === an).map((r) => r[i]));
  const CA = { [AN]: k.ca_total_2026, [AN - 1]: parAn(AN - 1, 4) }, QTE = { [AN]: k.qte_total_2026, [AN - 1]: parAn(AN - 1, 5) };
  ok(R.annees.includes(AN) && R.annees.includes(AN - 1), `répartitions : années ${R.annees.join(", ")}`);
  for (const dim of ["pays", "marque", "categorie", "sous"]) for (const an of [AN - 1, AN]) {
    const nom = `${dim} ${an}`;
    const v = repVue(R, { dim, an, mesure: "ca" }), m = repMatrice(R, { dim, an, mesure: "ca" }), p = partsParMarketplace(R, { dim, an, mesure: "ca" });
    ok(v.dispo && proche(v.total, CA[an], 0.5), `répartition ${nom} : CA ${r2(v.total)} ≠ total du tableau de bord ${r2(CA[an])}`);
    ok(proche(S(v.ents.map((e) => e.total)), v.total, 0.01) && v.totalMois.every((x, i) => proche(x, S(v.ents.map((e) => e.mois[i])), 0.01)), `répartition ${nom} : entités ≠ total (année ou mois)`);
    ok(v.ents.every((e, i, a) => i === 0 || a[i - 1].total >= e.total) && v.ents.every((e) => e.total !== 0), `répartition ${nom} : entités non triées ou sans vente`);
    ok(proche(m.total.baseTotal, v.total, 0.01) && proche(S(m.lignes.map((l) => l.baseTotal)), v.total, 0.01) && m.lignes.every((l) => proche(S(l.mois), l.total, 0.01) && l.baseTotal !== 0), `répartition ${nom} : détail par marketplace ≠ total`);
    ok(proche(S(p.lignes.map((l) => l.total)), v.total, 0.01) && p.lignes.every((l) => proche(S(l.v), l.total, 0.01) && l.v.length === p.ents.length), `répartition ${nom} : mix par marketplace ≠ total`);
    // quantités : toujours disponibles, sauf par pays en 2025 (le fichier source ne détaille que le CA) — jamais estimées
    const dispo = dispoQte(R, dim, an);
    ok(dispo === !(dim === "pays" && an === AN - 1), `répartition ${nom} : disponibilité des quantités inattendue (${dispo})`);
    const q = repVue(R, { dim, an, mesure: "qte" });
    if (dispo) {
      ok(q.dispo && q.total === QTE[an] && q.ents.every((e) => Number.isInteger(e.total) && e.total > 0), `répartition ${nom} : quantités ${q.total} ≠ ${QTE[an]}`);
      ok(repMatrice(R, { dim, an, mesure: "qte" }).total.baseTotal === q.total, `répartition ${nom} : détail des quantités ≠ total`);
    } else ok(!q.dispo && q.total === 0 && q.ents.length === 0, `répartition ${nom} : quantités inventées`);
    // entité choisie : son détail par marketplace retombe sur son total
    const e0 = v.ents[0], me = repMatrice(R, { dim, an, mesure: "ca", ent: e0.nom });
    ok(proche(me.total.total, e0.total, 0.01) && proche(me.total.baseTotal, v.total, 0.01), `répartition ${nom} : détail de « ${e0.nom} » ≠ son total`);
  }
  // les marques et les catégories retombent sur les agrégats déjà affichés ailleurs
  for (const an of [AN - 1, AN]) for (const [b, mois] of Object.entries(D.monthly_by_brand)) {
    const e = repVue(R, { dim: "marque", an, mesure: "ca" }).ents.find((x) => x.nom === b);
    ok(proche(e ? e.total : 0, S(mois[an]), 0.5), `marque ${b} ${an} : ${r2(e ? e.total : 0)} ≠ monthly_by_brand ${r2(S(mois[an]))}`);
  }
  for (const c of D.category_by_mp.categories.Toutes) {
    const e = repVue(R, { dim: "categorie", an: AN, mesure: "ca" }).ents.find((x) => x.nom === c.nom);
    ok(e && proche(e.total, c.ca, 0.5), `catégorie ${c.nom} : ${r2(e ? e.total : 0)} ≠ category_by_mp ${c.ca}`);
  }
  ok(repVue(R, { dim: "marque", an: AN, mesure: "ca" }).ents.map((e) => e.nom).sort().join("|") === ["Bestherm", "HOM'Y", "Thomson"].sort().join("|"), "marques 2026 : Bestherm, Thomson et HOM'Y attendues, sans « Autres produits »");
  // le détail par pays et le détail par produit décrivent les mêmes ventes : CA et quantités égaux par marketplace et par mois
  for (const an of [AN - 1, AN]) {
    const sku = new Map(), pays = new Map();
    for (const r of C.SKU_MONTHLY) if (r[2] === an) { const c = `${C.SKU_MPS[r[1]]}|${r[3]}`, o = sku.get(c) || [0, 0]; o[0] += r[4]; o[1] += r[5]; sku.set(c, o); }
    for (const r of C.PAYS_MONTHLY) if (r[2] === an) { const c = `${r[1]}|${r[3]}`, o = pays.get(c) || [0, 0]; o[0] += r[4]; o[1] += r[5] || 0; pays.set(c, o); }
    const ecarts = [...new Set([...sku.keys(), ...pays.keys()])].filter((c) => { const a = sku.get(c) || [0, 0], b = pays.get(c) || [0, 0]; return !proche(a[0], b[0], 0.1) || (an === AN && a[1] !== b[1]); });
    ok(ecarts.length === 0, `${an} : détail par pays ≠ détail par produit pour ${ecarts.slice(0, 3).join(" ; ")}`);
  }
  // « hors France » : la France est retirée des entités, du détail et du mix — le reste ne bouge pas
  for (const mesure of ["ca", "qte"]) {
    const tout = repVue(R, { dim: "pays", an: AN, mesure }), hors = repVue(R, { dim: "pays", an: AN, mesure, exclure: ["France"] });
    const fr = tout.ents.find((e) => e.nom === "France");
    ok(fr && !hors.ents.some((e) => e.nom === "France") && proche(hors.total, tout.total - fr.total, 0.01), `hors France (${mesure}) : total ${r2(hors.total)} ≠ ${r2(tout.total - fr.total)}`);
    ok(hors.ents.every((e) => proche(e.total, tout.ents.find((x) => x.nom === e.nom).total, 0.001)), `hors France (${mesure}) : un autre pays a changé`);
    ok(proche(repMatrice(R, { dim: "pays", an: AN, mesure, exclure: ["France"] }).total.baseTotal, hors.total, 0.01) && proche(S(partsParMarketplace(R, { dim: "pays", an: AN, mesure, exclure: ["France"] }).lignes.map((l) => l.total)), hors.total, 0.01), `hors France (${mesure}) : détail ou mix ≠ total`);
  }
  // regroupement « Autres » : rien ne se perd
  { const v = repVue(R, { dim: "pays", an: AN, mesure: "ca" }), r = replier(v.ents);
    ok(r.visibles.length === NB_SERIES && r.autres && r.autres.nb === v.ents.length - NB_SERIES && proche(S(r.visibles.map((e) => e.total)) + r.autres.total, v.total, 0.01) && r.autres.mois.every((x, i) => proche(x, S(v.ents.slice(NB_SERIES).map((e) => e.mois[i])), 0.01)), "regroupement « Autres » : total ou mois perdus");
    ok(replier(v.ents.slice(0, 3)).autres === null, "regroupement « Autres » : rien à regrouper sous 6 entités"); }
  // couleurs : la couleur suit l'entité (jamais son rang), « Autres » reste gris neutre, ordre d'empilement des marques fixe
  ok(PALETTE.length === 8 && new Set(PALETTE).size === 8 && !PALETTE.includes(GRIS), "palette : 8 teintes distinctes, gris neutre à part");
  for (const dim of ["pays", "categorie", "sous"]) {
    const cs = Object.entries(COULEURS_FIXES[dim]).filter(([, c]) => c !== GRIS).map(([, c]) => c);
    ok(cs.length === new Set(cs).size && cs.every((c) => PALETTE.includes(c)), `couleurs fixes ${dim} : doublon ou teinte hors palette`);
  }
  ok(JSON.stringify(COULEURS_FIXES.marque) === JSON.stringify({ Bestherm: "#F75212", "HOM'Y": "#8B5CF6", Thomson: "#D50032" }), "couleurs des marques : Bestherm #F75212, HOM'Y #8B5CF6, Thomson #D50032");
  const c1 = attribuerCouleurs("pays", ["France", "Belgique", "Espagne"]), c2 = attribuerCouleurs("pays", ["Belgique", "Espagne", "Italie"]);
  ok(["Belgique", "Espagne"].every((n) => c1.couleur.get(n) === c2.couleur.get(n)), "couleurs : un pays change de couleur selon les autres pays affichés");
  const c3 = attribuerCouleurs("pays", ["Pologne", "Suisse", "France"]);
  ok(new Set([...c3.couleur.values()]).size === 3 && c3.couleur.get("France") === c1.couleur.get("France") && [...c3.couleur.values()].every((c) => PALETTE.includes(c)), "couleurs : pays hors liste fixe sans teinte distincte");
  ok(attribuerCouleurs("marque", ["Thomson", "Bestherm", "HOM'Y"]).pile.join("|") === "Bestherm|HOM'Y|Thomson", "marques : ordre d'empilement Bestherm · HOM'Y · Thomson");
  ok(attribuerCouleurs("categorie", ["Autres produits"]).couleur.get("Autres produits") === GRIS, "catégorie « Autres produits » : gris neutre attendu");
  // mois en cours (dernier jour de données)
  ok(JSON.stringify(infoMois("2026-10-23")) === JSON.stringify({ an: 2026, mois: 10, jour: 23, joursDuMois: 31, partiel: true }) && infoMois("2026-10-31").partiel === false && infoMois("2026-02-28").joursDuMois === 28, "mois en cours : jours du mois ou drapeau « partiel » faux");
  // robustesse : marque absente → « Autres produits » ; une ligne pays sans quantité rend toute l'année « sans quantité »
  { const C2 = copie(C); delete C2.SKU_MARQUE;
    const R2 = construireRepartitions(C2), v2 = repVue(R2, { dim: "marque", an: AN, mesure: "ca" });
    ok(v2.ents.length === 1 && v2.ents[0].nom === AUTRES_PRODUITS && proche(v2.total, CA[AN], 0.5), "sans SKU_MARQUE : tout devait tomber dans « Autres produits » sans erreur");
    const C3 = copie(C), i = C3.PAYS_MONTHLY.findIndex((r) => r[2] === AN); C3.PAYS_MONTHLY[i] = C3.PAYS_MONTHLY[i].slice(0, 5);
    ok(dispoQte(construireRepartitions(C3), "pays", AN) === false, "une ligne pays sans quantité : l'année ne doit plus afficher de quantités"); }
}

/* ---------------------------------------------------------------------------------------------- 4. robustesse */
const identique = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const rien = (C2, base) => identique(C2, base);

{ // extraction invalide : ignorée, socle inchangé
  const C2 = app.constantes(), base = copie(C2);
  const r = etendre(C2, { ...ext, schema: 999 }, n1, { dmaxOdp: DMAX_ODP });
  ok(!r.appliquee && r.erreurs?.length && r.dmax === DMAX_ODP && rien(C2, base), "schéma inconnu : l'extraction aurait dû être ignorée sans rien modifier");
  const r2_ = etendre(C2, null, n1, { dmaxOdp: DMAX_ODP });
  ok(!r2_.appliquee && rien(C2, base), "extraction absente : le socle aurait dû rester intact");
  const mauvais = { ...ext, lignes: [...ext.lignes, ["2026-10-10", 99, 0, 0, 1, 1, 1]] };
  const r3 = etendre(C2, mauvais, n1, { dmaxOdp: DMAX_ODP });
  ok(!r3.appliquee && rien(C2, base), "index hors dictionnaire : l'extraction aurait dû être refusée");
}
{ // marketplace inconnue : échec atomique
  const C2 = app.constantes(), base = copie(C2);
  const r = etendre(C2, { ...ext, mp: ext.mp.map((m, i) => (i === 0 ? "Marketplace Inconnue" : m)) }, n1, { dmaxOdp: DMAX_ODP });
  ok(!r.appliquee && /inconnue/.test((r.erreurs || []).join(" ")) && rien(C2, base), "marketplace inconnue : l'échec aurait dû être atomique (aucune constante modifiée)");
}
{ // extraction déjà couverte par un export ODP plus récent
  const C2 = app.constantes(), base = copie(C2);
  const r = etendre(C2, ext, n1, { dmaxOdp: dmax });
  ok(!r.appliquee && !r.erreurs && r.dmax === dmax && rien(C2, base), "ODP plus récent que l'extraction : rien ne devait être ajouté");
}
{ // chevauchement partiel : les jours déjà dans l'ODP sont écartés
  const coupe = lignes.map((x) => x.d).sort()[Math.floor(lignes.length / 2)];
  const C2 = app.constantes();
  const r = etendre(C2, ext, n1, { dmaxOdp: coupe });
  const reste = lignesExtension(ext).filter((x) => x.d > coupe && x.d <= dmax);
  ok(r.appliquee && proche(r.ca, S(reste.map((x) => x.ca))) && r.du > coupe, `chevauchement : jours ≤ ${coupe} non écartés (CA ${r.ca})`);
}
{ // déterminisme : deux applications sur des copies fraîches donnent exactement le même résultat
  const C2 = app.constantes(), C3 = app.constantes();
  etendre(C2, copie(ext), n1, { dmaxOdp: DMAX_ODP }); etendre(C3, copie(ext), n1, { dmaxOdp: DMAX_ODP });
  ok(identique(C2, C3) && identique(C2, C), "résultat non déterministe");
}

/* ---------------------------------------------------------------------------------------------- bilan */
if (echecs.length) {
  for (const e of echecs) console.log(`ÉCHEC · ${e}`);
  console.log(`SELFTEST ÉCHEC · ${echecs.length} contrôle(s) en échec sur ${controles}`);
  process.exit(1);
}
console.log(`SELFTEST_OK · ${controles} contrôles · ODP → ${DMAX_ODP}, Shopify ${rap.du} → ${rap.dmax} (${rap.jours} jours, ${rap.lignes} enregistrements) : CA +${attendu.ca.toFixed(2)} € HT, ${attendu.qte} unités, ${attendu.nl} lignes · KPI ${k.ca_total_2026.toFixed(2)} € (${k.pct_objectif_atteint} % de l'objectif)`);
