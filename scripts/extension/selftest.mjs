#!/usr/bin/env node
/**
 * Contrôle de cohérence de tout le tableau de bord sur les VRAIES données du dépôt (toutes issues de Shopify).
 *
 *   node scripts/extension/selftest.mjs
 *
 * Charge shopify_extension.json, data/referentiel.json et data/hors_shopify.json, construit le tableau de bord exactement
 * comme l'application au chargement (socle.js), puis vérifie :
 *   1. la structure : extraction valide, couverture des deux boutiques, table de référence cohérente, produits et marketplaces
 *      connus (part du CA hors table de référence) ;
 *   2. chaque onglet recalculé indépendamment à partir des lignes brutes : les courbes mensuelles, marques, marketplaces,
 *      produits, pays, semaines, comparaisons N-1 à date identique, panier, objectifs, classes ABC, élasticités, saisonnalité
 *      donnent le même total que le KPI (au centime) ;
 *   2 bis. les répartitions de l'onglet Marques › Répartitions (repartitions.js) : pays, marque, catégorie et sous-catégorie × marketplace × mois
 *      retombent sur les totaux du tableau de bord (CA et quantités), les marques sur monthly_by_brand, les catégories sur category_by_mp,
 *      le détail par pays sur le détail par produit, couleurs stables par entité, « hors France », quantités par pays jamais estimées ;
 *   3. la robustesse : extraction invalide ou tronquée (échec atomique, rien n'est modifié), boutique en retard (l'écran
 *      s'arrête au dernier jour couvert par les deux), calcul déterministe, constantes de secours complètes ;
 *   4. le moteur sur un jeu fictif aux résultats connus d'avance (selftest_socle.mjs) et la chaîne d'extraction sur des
 *      résultats ShopifyQL synthétiques (selftest_pipeline.mjs).
 *
 * À lancer avant et après chaque `refresh_extension.mjs apply`, et avant de publier. Code de sortie 0 = tout est cohérent.
 * Le dossier lu est la racine du dépôt, ou celui de la variable HOMY_RACINE (copie de test).
 */
import { construire, squelette, validerExtension, auExtension, excelWeekOf, REGLAGES } from "../../socle.js";
import { lireDonnees, copie, RACINE } from "./lib_app.mjs";
import { validerReferentiel } from "./refresh_extension.mjs";
import { testerPipeline } from "./selftest_pipeline.mjs";
import { testerSocle } from "./selftest_socle.mjs";
import { construireRepartitions, vue as repVue, matrice as repMatrice, partsParMarketplace, dispoQte, replier, attribuerCouleurs, infoMois, PALETTE, GRIS, COULEURS_FIXES, NB_SERIES } from "../../repartitions.js";

const echecs = [], infos = [];
let controles = 0;
const ok = (cond, msg) => { controles++; if (!cond) echecs.push(msg); };
const proche = (a, b, tol = 0.05) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tol;
const r1 = (x) => Math.round(x * 10) / 10;
const r2 = (x) => Math.round(x * 100) / 100;
const S = (a) => (a || []).reduce((s, v) => s + (v || 0), 0);
const cents = (a) => a.reduce((s, v) => s + Math.round(v * 100), 0) / 100; // somme exacte de montants au centime
const eur = (x) => new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(Math.round(x)) + " €";
const memes = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const bilan = (rap) => {
  for (const i of infos) console.log(`INFO · ${i}`);
  if (echecs.length) {
    for (const e of echecs) console.log(`ÉCHEC · ${e}`);
    console.log(`SELFTEST ÉCHEC · ${echecs.length} contrôle(s) en échec sur ${controles}`);
    process.exit(1);
  }
  console.log(`SELFTEST_OK · ${controles} contrôles · ${rap.du} → ${rap.dmax} (${rap.jours} jours en ${rap.an}, ${rap.lignes} enregistrements) : CA HT ${eur(rap.ca)}, ${rap.qte} unités, ${rap.commandes} commandes`);
  process.exit(0);
};

/* ---------------------------------------------------------------------------------------------- 1. moteur et chaîne d'extraction (synthétiques) */
ok(excelWeekOf("2026-01-01") === 1 && excelWeekOf("2026-01-03") === 1 && excelWeekOf("2026-01-04") === 2, "semaine 1 = 1er → 3 janvier 2026, semaine 2 commence le dimanche 4 janvier");
ok(excelWeekOf("2026-10-03") === 40 && excelWeekOf("2026-10-04") === 41 && excelWeekOf("2026-10-10") === 41 && excelWeekOf("2026-10-11") === 42, "semaine 40 se termine le samedi 3 octobre ; semaine 41 = 4 → 10 octobre");
testerSocle(ok);
await testerPipeline(ok);

/* ---------------------------------------------------------------------------------------------- 2. données du dépôt */
const { ext, ref, hors } = lireDonnees();
const v = validerExtension(ext);
ok(v.ok, `shopify_extension.json invalide : ${v.erreurs.join(" ; ")}`);
const e = validerReferentiel(ref);
ok(e.length === 0, `data/referentiel.json invalide : ${e.join(" ; ")}`);
ok(Array.isArray(hors.ads) && Array.isArray(hors.country_ads), "data/hors_shopify.json : ads et country_ads attendus");
if (!v.ok || e.length) bilan({ du: "?", dmax: "?", jours: 0, an: "?", lignes: 0, ca: 0, qte: 0, commandes: 0 });

const avantJson = JSON.stringify(ext);
const t0 = performance.now();
const rap = construire(ext, ref, { horsShopify: hors });
const ms = Math.round(performance.now() - t0);
ok(rap.appliquee === true, `le tableau de bord ne se construit pas : ${(rap.erreurs || []).join(" ; ")}`);
if (!rap.appliquee) bilan({ du: ext.du, dmax: "?", jours: 0, an: rap.an, lignes: 0, ca: 0, qte: 0, commandes: 0 });
ok(ms < 8000, `construction trop lente (${ms} ms)`);
infos.push(`${RACINE === process.env.HOMY_RACINE ? "dossier de test " : ""}extraction du ${ext.extrait_a ?? "?"} · construction du tableau de bord en ${ms} ms`);

const { C } = rap, D = C.DATA, K = D.kpi, AN = rap.an, dmax = rap.dmax, Y1 = AN - 1, Y2 = AN - 2;
const cur = Number(dmax.slice(5, 7));
const KA = (nom) => K[`${nom}_${AN}`]; // les KPI portent l'année dans leur nom (ca_total_2026…)

/* ---- couverture et structure */
ok(JSON.stringify(ext) === avantJson, "la construction a modifié l'extraction");
ok(dmax === (auExtension(ext) > `${AN}-12-31` ? `${AN}-12-31` : auExtension(ext)), `dernier jour affiché ${dmax} ≠ couverture de l'extraction ${auExtension(ext)}`);
const bout = ext.boutiques || {};
ok(bout.marketplaces?.au && bout.site?.au, "les deux boutiques (marketplaces, site) doivent figurer dans l'extraction avec leur dernier jour couvert");
for (const [id, b] of Object.entries(bout)) ok(/^\d{4}-\d{2}-\d{2}T/.test(b.extrait_a ?? "") && b.domaine && b.nom, `boutique ${id} : nom, domaine ou date d'extraction manquant`);
ok(/^\d{4}-\d{2}-\d{2}T/.test(ext.extrait_a ?? "") && ext.extrait_le, "date d'extraction absente");
const jourMin = ext.lignes.reduce((m, l) => (l[0] < m ? l[0] : m), "9999-12-31");
ok(ext.du === jourMin, `« du » (${ext.du}) ≠ premier jour des lignes (${jourMin})`);
if (jourMin > `${Y2}-01-31`) infos.push(`l'historique commence le ${jourMin} (et non début ${Y2}) : la saisonnalité et les courbes de ${Y2} sont incomplètes`);
ok(ext.mp.length === new Set(ext.mp).size && ext.produits.length === new Set(ext.produits.map((p) => p[0])).size && ext.pays.length === new Set(ext.pays).size, "doublons dans les dictionnaires de l'extraction");
const nomsMp = Object.keys(ref.objectifs_mp || {});
const mpNouvelles = ext.mp.filter((m) => !nomsMp.includes(m));
if (mpNouvelles.length) infos.push(`marketplaces absentes des objectifs du plan : ${mpNouvelles.join(", ")}`);
ok(!ext.lignes.some((l) => ext.mp[l[1]] === "Site Web" && l[0] < "2025-05-01"), "ventes « Site Web » avant le début de la boutique du site (2025-05-01)");

// jours sans aucune vente entre le premier jour et le dernier : information (un trou long est le signe d'une extraction à reprendre)
{
  const vus = new Set(ext.lignes.filter((l) => l[0] <= dmax).map((l) => l[0]));
  const trous = []; let d = jourMin, serie = 0, maxSerie = 0, debutSerie = "";
  while (d <= dmax) {
    if (!vus.has(d)) { trous.push(d); if (!serie) debutSerie = d; serie++; if (serie > maxSerie) maxSerie = serie; } else serie = 0;
    d = new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10) + 1)).toISOString().slice(0, 10);
  }
  if (trous.length) infos.push(`${trous.length} jour(s) sans aucune vente : ${trous.slice(0, 8).join(", ")}${trous.length > 8 ? "…" : ""}`);
  ok(maxSerie < 7, `${maxSerie} jours de suite sans aucune vente entre ${jourMin} et ${dmax} (à partir du ${debutSerie}) : extraction incomplète ?`);
}
// produits absents de la table de référence : part du CA
{
  const inconnus = new Set(rap.produitsInconnus);
  const ca = S(ext.lignes.filter((l) => l[0].startsWith(String(AN)) && l[0] <= dmax && inconnus.has(ext.produits[l[2]][0])).map((l) => l[4]));
  const part = ca / (KA('ca_total') || 1);
  if (inconnus.size) infos.push(`${inconnus.size} produit(s) absent(s) de la table de référence (${eur(ca)}, ${(part * 100).toFixed(2)} % du CA ${AN}) : ${[...inconnus].slice(0, 6).join(", ")}${inconnus.size > 6 ? "…" : ""}`);
  ok(part < 0.03, `${(part * 100).toFixed(1)} % du CA ${AN} sur des produits absents de la table de référence (à ajouter à data/referentiel.json)`);
}
const autre = S(ext.lignes.filter((l) => l[0].startsWith(String(AN)) && l[0] <= dmax && ext.mp[l[1]] === "Autre").map((l) => l[4]));
ok(autre / (KA('ca_total') || 1) < 0.1, `« Autre » pèse ${((autre / KA('ca_total')) * 100).toFixed(1)} % du CA ${AN} : passerelles de paiement à ajouter à data/referentiel.json ?`);

/* ---------------------------------------------------------------------------------------------- 3. chaque onglet, recalculé à partir des lignes brutes */
const lignes = ext.lignes.filter((l) => l[0] <= dmax);
const an = (y) => lignes.filter((l) => +l[0].slice(0, 4) === y);
const cAn = cents(an(AN).map((l) => l[4])), qAn = S(an(AN).map((l) => l[3]));
ok(rap.ca === KA('ca_total') && proche(KA('ca_total'), cAn, 0.011) && KA('qte_total') === qAn && rap.qte === qAn, `KPI : CA ${KA('ca_total')} / ${KA('qte_total')} u. ≠ lignes de l'extraction (${cAn} / ${qAn})`);
ok(cAn > 0 && qAn > 0, "aucune vente sur l'année en cours");

// années : même total partout (courbes mensuelles, marques, marketplaces, produits × marketplaces)
for (const y of [Y2, Y1, AN]) {
  const att = cents(an(y).map((l) => l[4]));
  ok(proche(S(D.monthly_total[y]), att), `courbe mensuelle ${y} : ${r2(S(D.monthly_total[y]))} ≠ lignes ${att}`);
  ok(proche(S(Object.values(D.monthly_by_brand).map((b) => S(b[y]))), att, 0.1), `courbes par marque ${y} ≠ total`);
  ok(proche(S(Object.values(D.gf.monthly_total_by_mp).map((m) => S(m[y]))), att, 0.1), `courbes par marketplace ${y} ≠ total`);
  ok(S(D.normes_month.NF[y]) >= 0 && S(D.normes_month.CE[y]) >= 0 && S(D.normes_month.NF[y]) + S(D.normes_month.CE[y]) <= att + 0.1, `normes NF + CE ${y} : plus que le total`);
  if (y >= Y1) {
    ok(proche(S(C.SKU_MONTHLY.filter((r) => r[2] === y).map((r) => r[4])), att, 0.1), `ventes par produit × marketplace ${y} ≠ total`);
    ok(C.SKU_MONTHLY.filter((r) => r[2] === y).reduce((s, r) => s + r[5], 0) === S(an(y).map((l) => l[3])), `quantités par produit × marketplace ${y} ≠ total`);
    // pays : arrondis indépendants, écart toléré proportionnel à la racine du nombre d'enregistrements
    const np = C.PAYS_MONTHLY.filter((r) => r[2] === y);
    ok(np.length > 0 && proche(S(np.map((r) => r[4])), att, 0.02 * Math.sqrt(an(y).length) + 1), `ventes par pays ${y} : ${r2(S(np.map((r) => r[4])))} ≠ lignes ${att}`);
  }
}
ok(proche(S(D.monthly_total[AN].slice(cur)), 0, 0) && D.monthly_total[AN][cur - 1] > 0, "aucune vente dans le mois en cours, ou vente dans un mois futur");
for (let m = 0; m < 12; m++) ok(proche(D.monthly_total[AN][m], cents(an(AN).filter((l) => +l[0].slice(5, 7) === m + 1).map((l) => l[4])), 0.011), `mois ${m + 1} de ${AN} ≠ lignes`);

// KPI
ok(proche(KA('panier_moyen'), KA('nb_commandes') > 0 ? KA('ca_total') / KA('nb_commandes') : 0, 0.006), "panier moyen ≠ CA ÷ commandes");
ok(K.pct_objectif_atteint === r2((KA('ca_total') / K.objectif_annuel_total) * 100) && K.objectif_annuel_total === ref.objectif_annuel, "% de l'objectif ≠ CA ÷ objectif");
const nCmd = S(ext.commandes.filter((c) => c[0].startsWith(String(AN)) && c[0] <= dmax).map((c) => c[2]));
ok(KA('nb_commandes') === nCmd && rap.commandes === nCmd && nCmd > 0, `commandes ${KA('nb_commandes')} ≠ extraction ${nCmd}`);
ok(KA('panier_moyen') > 10 && KA('panier_moyen') < 5000, `panier moyen invraisemblable : ${KA('panier_moyen')} €`);
ok(S(Object.values(D.gf.nb_commandes_mp)) === nCmd, "commandes par marketplace ≠ total");
ok(S(Object.values(D.gf.qte_by_mp)) === qAn, "quantités par marketplace ≠ total");
for (const [mp, pm] of Object.entries(D.gf.panier_moyen_mp)) ok(proche(pm, (S(D.gf.monthly_total_by_mp[mp][AN]) / D.gf.nb_commandes_mp[mp]), 0.011), `panier moyen ${mp} ≠ CA ÷ commandes`);

// marketplaces et objectifs
const parMp = new Map(); for (const l of an(AN)) parMp.set(ext.mp[l[1]], (parMp.get(ext.mp[l[1]]) || 0) + Math.round(l[4] * 100));
for (const m of D.mp_vs_objectif) {
  ok(proche(m.ca, (parMp.get(m.marketplace) || 0) / 100, 0.011) && proche(m.ca, S(D.gf.monthly_total_by_mp[m.marketplace]?.[AN]), 0.1), `${m.marketplace} : CA ${m.ca} ≠ lignes`);
  const o = ref.objectifs_mp?.[m.marketplace]?.objectif ?? null;
  ok(m.objectif === o && (o ? m.pct_objectif === r1((m.ca / o) * 100) : m.pct_objectif === 0), `${m.marketplace} : objectif ou % de l'objectif`);
}
ok(proche(S(D.mp_vs_objectif.map((m) => m.ca)), cAn, 0.1) && D.mp_vs_objectif.every((m, i, a) => i === 0 || a[i - 1].ca >= m.ca), "marketplaces : total ≠ KPI ou classement non décroissant");

// comparaison N-1 à date identique (recalculée sur les lignes)
{
  const coupe = rap.coupe, parts = an(Y1);
  const dansCoupe = parts.filter((l) => l[0] >= coupe.du && l[0] <= coupe.au);
  const cut = cents(dansCoupe.map((l) => l[4]));
  const avantMois = cents(parts.filter((l) => +l[0].slice(5, 7) < cur).map((l) => l[4]));
  ok(coupe.du === `${Y1}-${String(cur).padStart(2, "0")}-01` && coupe.au.slice(0, 7) === coupe.du.slice(0, 7) && coupe.au.slice(8) === (Math.min(+dmax.slice(8), new Date(Date.UTC(Y1, cur, 0)).getUTCDate()) + "").padStart(2, "0"), `coupe N-1 ${coupe.du} → ${coupe.au} pour une dernière donnée au ${dmax}`);
  ok(proche(D.cut_n1.total[Y1], cut, 0.011) && D.cut_n1.jusqu_au === dmax.slice(5), "coupe N-1 : total ≠ lignes");
  ok(proche(D.total_yoy_comparable[Y1], avantMois + cut, 0.011) && D.total_yoy_comparable[AN] === KA('ca_total') && D.total_yoy_comparable[Y2] === undefined, `total N-1 comparable ${D.total_yoy_comparable[Y1]} ≠ mois entiers + coupe (${r2(avantMois + cut)})`);
  ok(proche(S(Object.values(D.cut_n1.mp).map((x) => x[Y1])), cut, 0.1) && proche(S(C.SKU_CUT_N1.map((r) => r[2])), cut, 0.1) && proche(S(Object.values(D.cut_n1.brand).map((x) => x[Y1])), cut, 0.1), "coupe N-1 : somme par marketplace, produit ou marque ≠ total");
  ok(proche(S(D.mp_vs_objectif.map((m) => m.ca_2025)), D.total_yoy_comparable[Y1], 0.1), "marketplaces : CA N-1 comparable ≠ total N-1");
  ok(proche(S(Object.values(D.brand_yoy).map((b) => b[Y1])), D.total_yoy_comparable[Y1], 0.1) && proche(S(Object.values(D.brand_yoy).map((b) => b[AN])), cAn, 0.1) && proche(S(Object.values(D.brand_yoy).map((b) => b[`${Y1}_annee`])), cents(parts.map((l) => l[4])), 0.1), "marques : CA et CA N-1 comparable ≠ totaux");
  ok(D.mp_vs_objectif.every((m) => (m.ca_2025 > 0 ? m.yoy_pct === r1((m.ca / m.ca_2025 - 1) * 100) : m.yoy_pct === null)), "évolutions N-1 des marketplaces mal calculées");
}

// produits
{
  const nomsP = ext.produits.map((p) => p[0]), parP = new Map();
  for (const l of an(AN)) parP.set(nomsP[l[2]], (parP.get(nomsP[l[2]]) || 0) + Math.round(l[4] * 100));
  const classe = [...parP].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  ok(D.best_seller_2026.produit === classe[0][0] && D.products_top15[0].produit === classe[0][0], `meilleur produit : ${D.best_seller_2026.produit} ≠ ${classe[0][0]}`);
  ok(D.products_top15.length === Math.min(REGLAGES.topProduits, classe.length) && D.products_top15.every((p, i) => p.ca === Math.round(classe[i][1] / 100) && (i === 0 || D.products_top15[i - 1].ca >= p.ca)), "classement des produits ≠ lignes");
  // CA N-1 comparable de chaque produit : mois entiers avant le mois en cours + coupe, recalculés sur les lignes
  const parP1 = new Map();
  for (const l of an(Y1)) if (+l[0].slice(5, 7) < cur || (l[0] >= rap.coupe.du && l[0] <= rap.coupe.au)) parP1.set(nomsP[l[2]], (parP1.get(nomsP[l[2]]) || 0) + Math.round(l[4] * 100));
  ok(D.products_top15.every((p) => { const c1 = (parP1.get(p.produit) || 0) / 100, c = (parP.get(p.produit) || 0) / 100; return p.ca_2025 === Math.round(c1) && (c1 > 0 ? p.yoy_pct === r1((c / c1 - 1) * 100) : p.yoy_pct === null); }), "CA et évolution N-1 des produits ≠ lignes");
  ok(D.best_seller_2025.annee > 0 && D.best_seller_2025.ca >= 0, "meilleur produit de l'année précédente");
  for (const [mp, t] of Object.entries(D.gf.top_products_by_mp)) ok(t.every((p, i, a) => i === 0 || a[i - 1].ca >= p.ca) && t.length <= REGLAGES.topProduitsParMp && D.gf.best_by_mp[mp].produit === t[0].produit, `top produits ${mp} mal classé`);
  ok(Object.values(D.products_monthly_top6).every((p) => p.ca.length === 12), "courbes mensuelles des meilleurs produits");
}

// semaines Excel
{
  const W = C.WEEKLY_TOTALS, derniere = excelWeekOf(dmax);
  ok(proche(S(W.map((r) => r[1])), cAn, 0.1) && S(W.map((r) => r[2])) === qAn && proche(S(C.WEEKLY_BY_MP.map((r) => r[2])), cAn, 0.1) && proche(S(C.WEEKLY_BY_PROD.map((r) => r[2])), cAn, 0.1) && S(C.WEEKLY_BY_MP.map((r) => r[3])) === qAn, "semaines : totaux ≠ KPI");
  ok(W.length > 0 && W[0][0] === 1 && W[W.length - 1][0] === derniere && W.every((r, i) => r[0] === i + 1), `semaines : suite 1 → ${derniere} sans trou attendue (${W.length} semaines)`);
  const dow = new Date(Date.UTC(+dmax.slice(0, 4), +dmax.slice(5, 7) - 1, +dmax.slice(8, 10))).getUTCDay();
  ok(rap.semaineMaxComplete === (dow === 6 ? derniere : derniere - 1), `dernière semaine complète ${rap.semaineMaxComplete} pour un dernier jour au ${dmax}`);
}

// dictionnaires alignés
{
  const nP = C.SKU_PRODUIT.length;
  ok(new Set(C.SKU_PRODUIT).size === nP && memeOrdre(C.SKU_PRODUIT), "produits en double ou non triés dans SKU_PRODUIT");
  for (const nom of ["SKU_DESTOCKAGE", "SKU_FAMILLE", "SKU_WIFI", "SKU_PLINTHE", "SKU_VERTICAL", "SKU_SOUS_FAMILLE", "SKU_SOUS_SOUS_FAMILLE", "SKU_MARQUE"]) ok(C[nom].length === nP, `${nom} (${C[nom].length}) désaligné de SKU_PRODUIT (${nP})`);
  ok(C.SKU_MONTHLY.every((r) => r[0] >= 0 && r[0] < nP && r[1] >= 0 && r[1] < C.SKU_MPS.length && r[2] >= Y1 && r[3] >= 1 && r[3] <= 12), "SKU_MONTHLY : index hors dictionnaire");
  ok(C.SKU_CUT_N1.every((r) => r[0] >= 0 && r[0] < nP && r[1] >= 0 && r[1] < C.SKU_MPS.length), "SKU_CUT_N1 : index hors dictionnaire");
  ok(D.price_tracking.every((r) => C.SKU_PRODUIT.includes(r[0]) && C.SKU_MPS.includes(r[1]) && r.length === 7 && [2, 3, 4, 5].every((i) => r[i].length === 12)), "suivi des prix : produit, marketplace ou forme inconnus");
  ok(C.SKU_MARQUE.every((m) => typeof m === "string" && m.length > 0), "SKU_MARQUE : produit sans marque");
  ok(C.PAYS_MONTHLY.every((r) => (r.length === 5 || (r.length === 6 && Number.isInteger(r[5]))) && r[2] >= Y1 && r[3] >= 1 && r[3] <= 12 && ext.pays.includes(r[0])) && [Y1, AN].every((y) => new Set(C.PAYS_MONTHLY.filter((r) => r[2] === y).map((r) => r.length)).size <= 1), "PAYS_MONTHLY : [pays, marketplace, année, mois, CA] avec la quantité en 6e élément pour toutes les lignes d'une année ou aucune");
  const nomsExt = new Set(ext.produits.map((p) => p[0]));
  ok(C.SKU_PRODUIT.every((n) => nomsExt.has(n)), "SKU_PRODUIT contient un produit absent de l'extraction");
  ok(Object.entries(C.PRODUCT_TO_CATEGORY).every(([n, c]) => C.SKU_PRODUIT.includes(n) && typeof c === "string"), "PRODUCT_TO_CATEGORY incohérent");
}
function memeOrdre(l) { return l.every((x, i) => i === 0 || l[i - 1] < x); }

// catégories
{
  const cats = D.category_by_mp.categories, tout = cats.Toutes || [];
  ok(tout.length > 0 && tout.every((c) => c.ca >= 0 && c.pct >= 0 && c.pct <= 100) && tout.every((c, i) => i === 0 || tout[i - 1].ca >= c.ca), "catégories : part hors 0-100 % ou classement non décroissant");
  ok(Object.values(D.category_by_mp.coverage).every((x) => x >= 0 && x <= 100) && D.category_by_mp.coverage.Toutes >= 90, `couverture des catégories : ${D.category_by_mp.coverage.Toutes} % du CA`);
  ok(S(tout.map((c) => c.pct)) <= 100.5 && S(tout.map((c) => c.ca)) <= cAn + tout.length, "catégories : somme supérieure au CA");
}

// classes ABC, élasticités, saisonnalité, paires, publicité
{
  const abc = C.ABC_BY_SKU, ordre = { A: 0, B: 1, C: 2, D: 3, NC: 4 };
  ok(abc.every((r, i) => i === 0 || ordre[abc[i - 1][4]] <= ordre[r[4]]) && abc[0][4] === "A" && proche(S(abc.map((r) => r[2])), cAn, 0.1) && abc.every((r) => r[4] in ordre), "classes ABC : ordre, total ou classes invalides");
  ok(abc.filter((r) => r[4] === "NC").every((r) => r[2] === 0 && r[3] === 0) && abc.filter((r) => r[4] !== "NC").every((r) => r[2] !== 0 || r[3] !== 0), "classes ABC : « NC » réservé aux produits sans vente de l'année");
  const cumA = S(abc.filter((r) => r[4] === "A").map((r) => r[2])) / cAn;
  ok(cumA >= REGLAGES.abc.A - 1e-9 || abc.filter((r) => r[4] === "A").length === 1, `classe A : ${(cumA * 100).toFixed(1)} % du CA (au moins 50 % attendus)`);
  const E = REGLAGES.elasticite;
  ok(C.ELASTICITE_DATA.every((r) => r.length === 11 && Number.isFinite(r[2]) && r[3] >= 0 && r[3] <= 1 && r[4] >= E.semainesMin && r[9] <= r[10] && r[9] > 0 && C.SKU_PRODUIT.includes(r[0]) && C.SKU_MPS.includes(r[1])), "élasticités : forme, R², semaines ou prix invalides");
  // indicateur « fiable » : seuils sur le nombre de semaines, le R² et l'écart de prix (valeurs affichées arrondies : marge de 0,005)
  const ecartPrix = (r) => (r[10] - r[9]) / r[6];
  ok(C.ELASTICITE_DATA.every((r) => (r[7] ? r[4] >= E.fiableSemainesMin && r[3] >= E.fiableR2Min - 0.005 && ecartPrix(r) >= E.fiableEcartPrixMin - 0.002
    : r[4] < E.fiableSemainesMin || r[3] < E.fiableR2Min + 0.005 || ecartPrix(r) < E.fiableEcartPrixMin + 0.002)), "élasticités : indicateur « fiable » incohérent avec les seuils");
  ok(C.SIMULATION_PRIX.opportunites.every((r) => r[2] > -1 && r[2] < 0) && C.SIMULATION_PRIX.risques.every((r) => r[2] <= -1 && r[7] === true), "simulation de prix : classement opportunités / risques");
  const idx = C.SEASONALITY_INDEX;
  ok(idx.length === 12 && proche(S(idx) / 12, 1, 0.02) && idx.every((x) => x > 0), `saisonnalité : indice moyen ${r2(S(idx) / 12)} (1 attendu), mois sans vente ${idx.findIndex((x) => x <= 0) + 1 || "aucun"}`);
  ok(C.BASKET_PAIRS.every((p, i, a) => p[0] < p[1] && p[2] > 0 && (i === 0 || a[i - 1][2] >= p[2]) && C.SKU_PRODUIT.concat(ext.produits.map((q) => q[0])).includes(p[0])), "paires de produits : forme ou classement invalides");
  ok(memes(D.ads, hors.ads) && memes(D.country_ads, hors.country_ads), "publicité : chiffres hors Shopify modifiés en route");
}

/* ---------------------------------------------------------------------------------------------- 3 bis. répartitions (onglet Marques › Répartitions) */
{
  const R = construireRepartitions(C);
  const parAn = (y, i) => S(C.SKU_MONTHLY.filter((r) => r[2] === y).map((r) => r[i]));
  const CA = { [AN]: KA("ca_total"), [Y1]: parAn(Y1, 4) }, QTE = { [AN]: KA("qte_total"), [Y1]: parAn(Y1, 5) };
  // quantités par pays : disponibles pour une année seulement si TOUTES ses lignes de l'extraction en portent une (jamais estimées)
  const paysQte = (y) => { const l = ext.pays_jour.filter((r) => +r[0].slice(0, 4) === y && r[0] <= dmax); return l.length > 0 && l.every((r) => typeof r[4] === "number" && Number.isFinite(r[4])); };
  ok(R.annees.includes(Y1) && R.annees.includes(AN), `répartitions : années ${R.annees.join(", ")}`);
  for (const y of [Y1, AN]) if (!paysQte(y)) infos.push(`quantités par pays absentes en ${y} (extraction antérieure à leur ajout) : l'écran Répartitions affiche le CA seul pour les pays ; une reconstruction de l'historique les ajoute`);
  for (const dim of ["pays", "marque", "categorie", "sous"]) for (const y of [Y1, AN]) {
    const nom = `${dim} ${y}`, tol = dim === "pays" ? 0.02 * Math.sqrt(an(y).length) + 1 : 0.5; // pays : arrondis indépendants (comme le contrôle des ventes par pays)
    const v = repVue(R, { dim, an: y, mesure: "ca" }), m = repMatrice(R, { dim, an: y, mesure: "ca" }), p = partsParMarketplace(R, { dim, an: y, mesure: "ca" });
    ok(v.dispo && proche(v.total, CA[y], tol), `répartition ${nom} : CA ${r2(v.total)} ≠ total du tableau de bord ${r2(CA[y])}`);
    ok(proche(S(v.ents.map((e) => e.total)), v.total, 0.01) && v.totalMois.every((x, i) => proche(x, S(v.ents.map((e) => e.mois[i])), 0.01)), `répartition ${nom} : entités ≠ total (année ou mois)`);
    ok(v.ents.every((e, i, a) => i === 0 || a[i - 1].total >= e.total) && v.ents.every((e) => e.total !== 0), `répartition ${nom} : entités non triées ou sans vente`);
    ok(proche(m.total.baseTotal, v.total, 0.01) && proche(S(m.lignes.map((l) => l.baseTotal)), v.total, 0.01) && m.lignes.every((l) => proche(S(l.mois), l.total, 0.01) && l.baseTotal !== 0), `répartition ${nom} : détail par marketplace ≠ total`);
    ok(proche(S(p.lignes.map((l) => l.total)), v.total, 0.01) && p.lignes.every((l) => proche(S(l.v), l.total, 0.01) && l.v.length === p.ents.length), `répartition ${nom} : mix par marketplace ≠ total`);
    // quantités : toujours disponibles par produit, marque et catégorie ; par pays selon l'extraction — jamais estimées
    const dispo = dispoQte(R, dim, y), attendu = dim === "pays" ? paysQte(y) : true;
    ok(dispo === attendu, `répartition ${nom} : disponibilité des quantités ${dispo}, attendue ${attendu}`);
    const q = repVue(R, { dim, an: y, mesure: "qte" });
    if (dispo) {
      ok(q.dispo && q.total === QTE[y] && q.ents.every((e) => Number.isInteger(e.total) && e.total !== 0), `répartition ${nom} : quantités ${q.total} ≠ ${QTE[y]}`);
      ok(repMatrice(R, { dim, an: y, mesure: "qte" }).total.baseTotal === q.total, `répartition ${nom} : détail des quantités ≠ total`);
    } else ok(!q.dispo && q.total === 0 && q.ents.length === 0, `répartition ${nom} : quantités inventées`);
    // entité choisie : son détail par marketplace retombe sur son total
    const e0 = v.ents[0], me = repMatrice(R, { dim, an: y, mesure: "ca", ent: e0.nom });
    ok(proche(me.total.total, e0.total, 0.01) && proche(me.total.baseTotal, v.total, 0.01), `répartition ${nom} : détail de « ${e0.nom} » ≠ son total`);
  }
  // les marques et les catégories retombent sur les agrégats déjà affichés ailleurs
  for (const y of [Y1, AN]) {
    const ents = repVue(R, { dim: "marque", an: y, mesure: "ca" }).ents;
    for (const [b, mois] of Object.entries(D.monthly_by_brand)) {
      const e = ents.find((x) => x.nom === b);
      ok(proche(e ? e.total : 0, S(mois[y]), 0.5), `marque ${b} ${y} : ${r2(e ? e.total : 0)} ≠ monthly_by_brand ${r2(S(mois[y]))}`);
    }
    ok(ents.every((e) => D.monthly_by_brand[e.nom]), `marques ${y} : une marque absente de monthly_by_brand`);
  }
  for (const c of D.category_by_mp.categories.Toutes) {
    const e = repVue(R, { dim: "categorie", an: AN, mesure: "ca" }).ents.find((x) => x.nom === c.nom);
    ok(e && proche(e.total, c.ca, 0.5001), `catégorie ${c.nom} : ${r2(e ? e.total : 0)} ≠ category_by_mp ${c.ca}`);
  }
  { const noms = repVue(R, { dim: "marque", an: AN, mesure: "ca" }).ents.map((e) => e.nom);
    ok(["Bestherm", "Thomson"].every((n) => noms.includes(n)) && !noms.includes("Autres produits"), `marques ${AN} : Bestherm et Thomson attendues, sans « Autres produits » (${noms.join(", ")})`); }
  // le détail par pays et le détail par produit décrivent les mêmes ventes : mêmes CA (à l'arrondi près) et mêmes quantités par marketplace et par mois
  for (const y of [Y1, AN]) {
    const sku = new Map(), pays = new Map();
    for (const r of C.SKU_MONTHLY) if (r[2] === y) { const c = `${C.SKU_MPS[r[1]]}|${r[3]}`, o = sku.get(c) || [0, 0, 0]; o[0] += r[4]; o[1] += r[5]; o[2]++; sku.set(c, o); }
    for (const r of C.PAYS_MONTHLY) if (r[2] === y) { const c = `${r[1]}|${r[3]}`, o = pays.get(c) || [0, 0]; o[0] += r[4]; o[1] += r[5] || 0; pays.set(c, o); }
    const ecarts = [...new Set([...sku.keys(), ...pays.keys()])].filter((c) => { const a = sku.get(c) || [0, 0, 1], b = pays.get(c) || [0, 0]; return !proche(a[0], b[0], 1 + 0.02 * Math.sqrt(a[2])) || (paysQte(y) && a[1] !== b[1]); });
    ok(ecarts.length === 0, `${y} : détail par pays ≠ détail par produit pour ${ecarts.slice(0, 3).join(" ; ")}`);
  }
  // « hors France » : la France est retirée des entités, du détail et du mix — le reste ne bouge pas
  for (const mesure of ["ca", "qte"]) {
    const tout = repVue(R, { dim: "pays", an: AN, mesure }), hors2 = repVue(R, { dim: "pays", an: AN, mesure, exclure: ["France"] });
    if (mesure === "qte" && !paysQte(AN)) { ok(!tout.dispo && !hors2.dispo, "hors France (quantités) : extraction sans quantité par pays, rien ne devait être affiché"); continue; }
    const fr = tout.ents.find((e) => e.nom === "France");
    ok(fr && !hors2.ents.some((e) => e.nom === "France") && proche(hors2.total, tout.total - fr.total, 0.01), `hors France (${mesure}) : total ${r2(hors2.total)} ≠ ${r2(tout.total - fr.total)}`);
    ok(hors2.ents.every((e) => proche(e.total, tout.ents.find((x) => x.nom === e.nom).total, 0.001)), `hors France (${mesure}) : un autre pays a changé`);
    ok(proche(repMatrice(R, { dim: "pays", an: AN, mesure, exclure: ["France"] }).total.baseTotal, hors2.total, 0.01) && proche(S(partsParMarketplace(R, { dim: "pays", an: AN, mesure, exclure: ["France"] }).lignes.map((l) => l.total)), hors2.total, 0.01), `hors France (${mesure}) : détail ou mix ≠ total`);
  }
  // regroupement « Autres » : rien ne se perd
  { const v = repVue(R, { dim: "pays", an: AN, mesure: "ca" }), r = replier(v.ents);
    if (v.ents.length > NB_SERIES) {
      ok(r.visibles.length === NB_SERIES && r.autres && r.autres.nb === v.ents.length - NB_SERIES && proche(S(r.visibles.map((e) => e.total)) + r.autres.total, v.total, 0.01) && r.autres.mois.every((x, i) => proche(x, S(v.ents.slice(NB_SERIES).map((e) => e.mois[i])), 0.01)), "regroupement « Autres » : total ou mois perdus");
    } else infos.push(`pays ${AN} : ${v.ents.length} pays seulement (le regroupement « Autres » n'est pas exercé)`);
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
    const v2 = repVue(construireRepartitions(C2), { dim: "marque", an: AN, mesure: "ca" });
    ok(v2.ents.length === 1 && v2.ents[0].nom === "Autres produits" && proche(v2.total, CA[AN], 0.5), "sans SKU_MARQUE : tout devait tomber dans « Autres produits » sans erreur");
    const C3 = copie(C), i = C3.PAYS_MONTHLY.findIndex((r) => r[2] === AN && r.length === 6);
    if (i >= 0) { C3.PAYS_MONTHLY[i] = C3.PAYS_MONTHLY[i].slice(0, 5);
      ok(dispoQte(construireRepartitions(C3), "pays", AN) === false, "une ligne pays sans quantité : l'année ne doit plus afficher de quantités"); }
    // une valeur négative (remboursement d'un mois antérieur) : somme exacte, classement et totaux restent cohérents
    const C4 = copie(C), j = C4.PAYS_MONTHLY.findIndex((r) => r[2] === AN && r[0] === "France"), neg = 123.45;
    C4.PAYS_MONTHLY.push(["Pays-test", C4.PAYS_MONTHLY[j][1], AN, 1, -neg, ...(C4.PAYS_MONTHLY[j].length === 6 ? [-2] : [])]);
    const R4 = construireRepartitions(C4), v4 = repVue(R4, { dim: "pays", an: AN, mesure: "ca" }), e4 = v4.ents.find((e) => e.nom === "Pays-test");
    ok(e4 && proche(e4.total, -neg, 0.001) && proche(v4.total, repVue(R, { dim: "pays", an: AN, mesure: "ca" }).total - neg, 0.001) && v4.ents.every((e, k, a) => k === 0 || a[k - 1].total >= e.total) && e4 === v4.ents[v4.ents.length - 1], "valeur négative : entité, total et classement incohérents"); }
}

/* ---------------------------------------------------------------------------------------------- 4. robustesse sur les vraies données */
{
  const refuse = (e2, r = ref) => { const x = construire(e2, r, { horsShopify: hors }); return !x.appliquee && Array.isArray(x.erreurs) && x.erreurs.length > 0 && x.C === undefined; };
  ok(refuse(null) && refuse({ ...ext, schema: 1 }) && refuse({ ...ext, lignes: undefined }) && refuse(ext, null), "extraction absente, ancien schéma, champ manquant ou table de référence absente refusés");
  ok(refuse({ ...ext, lignes: [...ext.lignes, [dmax, ext.mp.length, 0, 1, 1]] }) && refuse({ ...ext, lignes: [...ext.lignes, [dmax, 0, ext.produits.length, 1, 1]] }) && refuse({ ...ext, lignes: [...ext.lignes, [dmax, 0, 0, 1, "1"]] }), "index hors dictionnaire ou valeur non numérique refusés");
  ok(refuse({ ...ext, lignes: ext.lignes.filter((l) => l[0] < `${AN}-01-01`) }), `extraction sans aucune vente de l'année ${AN} refusée`);
  // boutique en retard : l'écran s'arrête au dernier jour couvert par les deux
  const retard = copie({ ...ext, lignes: [] }); retard.lignes = ext.lignes; // copie superficielle des lignes (lecture seule)
  const jourRetard = new Date(Date.UTC(+dmax.slice(0, 4), +dmax.slice(5, 7) - 1, +dmax.slice(8, 10) - 9)).toISOString().slice(0, 10);
  retard.boutiques = { ...ext.boutiques, site: { ...ext.boutiques.site, au: jourRetard } };
  const rr = construire(retard, ref, { horsShopify: hors });
  ok(rr.appliquee && rr.dmax === jourRetard && proche(rr.ca, cents(ext.lignes.filter((l) => l[0] >= `${AN}-01-01` && l[0] <= jourRetard).map((l) => l[4])), 0.011) && rr.ca < rap.ca, `boutique en retard : tableau de bord arrêté au ${jourRetard} (${rr.dmax})`);
  // déterminisme
  ok(memes(construire(ext, ref, { horsShopify: hors }).C, C), "calcul non déterministe");
  // extraction d'un ancien format (sans quantité par pays) : le tableau de bord se construit, le CA par pays est inchangé, aucune quantité par pays n'est inventée
  {
    const ancien = { ...ext, pays_jour: ext.pays_jour.map((r) => r.slice(0, 4)) }, ra = construire(ancien, ref, { horsShopify: hors });
    ok(ra.appliquee && ra.C.PAYS_MONTHLY.length === C.PAYS_MONTHLY.length && ra.C.PAYS_MONTHLY.every((r, i) => r.length === 5 && r.join("|") === C.PAYS_MONTHLY[i].slice(0, 5).join("|")), "extraction sans quantité par pays : même CA par pays, aucune quantité");
    const Ra = construireRepartitions(ra.C);
    ok([Y1, AN].every((y) => !dispoQte(Ra, "pays", y) && dispoQte(Ra, "marque", y) && dispoQte(Ra, "categorie", y) && dispoQte(Ra, "sous", y)), "extraction sans quantité par pays : quantités désactivées pour les pays seulement");
  }
  // squelette : mêmes constantes que le tableau de bord (écran d'erreur sans plantage)
  const sq = squelette(AN);
  ok(memes(Object.keys(C), Object.keys(sq.C)) && memes(Object.keys(D), Object.keys(sq.C.DATA)) && memes(Object.keys(D.gf), Object.keys(sq.C.DATA.gf)) && memes(Object.keys(K).sort(), Object.keys(sq.C.DATA.kpi).sort()), "constantes de secours : clés différentes du tableau de bord complet");
}

bilan(rap);
