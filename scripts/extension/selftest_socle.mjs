/**
 * Contrôles du moteur de calcul (socle.js) sur un jeu de ventes SYNTHÉTIQUE dont les résultats sont connus d'avance : chaque
 * chiffre du tableau de bord (KPI, courbes mensuelles, marques, marketplaces, N-1 à date identique, semaines, élasticité, ABC,
 * saisonnalité, paires…) est comparé à un calcul indépendant fait ici, directement sur les lignes de vente. Aucune donnée réelle.
 * Appelé par selftest.mjs.
 */
import { SCHEMA, REGLAGES, MOIS_LABELS, construire, squelette, validerExtension, excelWeekOf } from "../../socle.js";
import { addDays } from "./transformer.mjs";

const r2 = (x) => Math.round(x * 100) / 100;
const r1 = (x) => Math.round(x * 10) / 10;
const S = (a) => a.reduce((s, v) => s + v, 0);
const proche = (a, b, tol = 0.011) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tol;
const memes = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const copie = (x) => JSON.parse(JSON.stringify(x));

const P1 = "ARIA 1000W", P2 = "HANAE 500W", P3 = "Produit orphelin";
const REF = {
  objectif_annuel: 1000000,
  objectifs_mp: { "Amazon FR": { objectif: 500000, fiable: true }, "Leroy Merlin": { objectif: 300000, fiable: false }, "Site Web": { objectif: null, fiable: false }, "Bol.com": { objectif: 45000, fiable: true } },
  produits: {
    [P1]: { marque: "Bestherm", norme: "CE", famille: "Fixe heater", sous_famille: "Céramique", sous_sous_famille: "1er prix Céramique", categorie: "Radiateur électrique fixe", wifi: false, plinthe: false, vertical: false, destockage: false, code: "HT10-24JE" },
    [P2]: { marque: "Thomson", norme: "NF", famille: "Sèche-serviettes", sous_famille: "Soufflant", sous_sous_famille: "Mural", categorie: "Sèche-serviettes", wifi: true, plinthe: false, vertical: true, destockage: true, code: "HJ5EDB" },
  },
};
const VENDEUR = { [P1]: "Bestherm", [P2]: "Thomson", [P3]: "Thomson" };

// Ventes : [jour, marketplace, produit, quantité, CA HT]
function lignesTest() {
  const L = [];
  for (let m = 1; m <= 12; m++) {
    const mm = String(m).padStart(2, "0");
    L.push([`2024-${mm}-15`, "Amazon FR", P1, m, 100 * m]);
    L.push([`2025-${mm}-10`, "Amazon FR", P1, m, 200 * m]);
    L.push([`2025-${mm}-20`, "Leroy Merlin", P2, 1, 50]);
  }
  L.push(["2023-12-31", "Amazon FR", P1, 1, 10]); // avant la première année conservée : ignorée
  // semaines Excel 2 à 11 (dimanche → samedi) : prix de 50 à 95 €, quantités ≈ 2 000 000 / prix² (élasticité −2)
  for (let w = 2; w <= 11; w++) { const p = 50 + 5 * (w - 2), q = Math.round(2e6 / (p * p)); L.push([addDays("2026-01-04", 7 * (w - 2)), "Amazon FR", P1, q, p * q]); }
  L.push(["2026-01-02", "Amazon FR", P1, 2, 400]); // semaine 1, partielle : exclue de l'élasticité
  L.push(["2026-01-25", "Leroy Merlin", P2, 10, 500], ["2026-02-01", "Leroy Merlin", P2, 10, 520], ["2026-02-08", "Leroy Merlin", P2, 10, 540]); // 3 semaines : trop peu pour une élasticité
  for (let w = 2; w <= 7; w++) L.push([addDays("2026-01-04", 7 * (w - 2)), "Leroy Merlin", P1, 5, 250]); // prix constant : aucune élasticité mesurable
  L.push(["2026-03-02", "Site Web", P2, 3, 150], ["2026-03-13", "Site Web", P3, 1, 30]);
  L.push(["2026-03-15", "Amazon FR", P1, 1, 100]); // après la dernière donnée couverte : ignorée
  return L;
}

function fabriquer(lignes, { commandes = [], pays = [], paires = [], au = "2026-03-14", vendeurs = VENDEUR } = {}) {
  const mp = [...new Set([...lignes.map((l) => l[1]), ...commandes.map((c) => c[1]), ...pays.map((p) => p[2])])].sort();
  const noms = [...new Set([...lignes.map((l) => l[2]), ...paires.flatMap((p) => [p[1], p[2]])])].sort();
  const pa = [...new Set(pays.map((p) => p[1]))].sort();
  const im = new Map(mp.map((x, i) => [x, i])), ip = new Map(noms.map((x, i) => [x, i])), ic = new Map(pa.map((x, i) => [x, i]));
  return {
    schema: SCHEMA, du: lignes.map((l) => l[0]).sort()[0], au, boutiques: { marketplaces: { au }, site: { au } },
    mp, pays: pa, produits: noms.map((n) => [n, vendeurs[n] ?? null]),
    lignes: lignes.map(([d, m, p, q, ca]) => [d, im.get(m), ip.get(p), q, ca]),
    pays_jour: pays.map(([d, p, m, ca, q]) => (q === undefined ? [d, ic.get(p), im.get(m), ca] : [d, ic.get(p), im.get(m), ca, q])), // quantité facultative
    commandes: commandes.map(([d, m, n]) => [d, im.get(m), n]),
    paires: paires.map(([d, a, b, n]) => [d, ip.get(a), ip.get(b), n, 0]),
  };
}

export function testerSocle(ok) {
  const L = lignesTest();
  const commandes = [["2026-02-10", "Amazon FR", 5], ["2026-03-02", "Site Web", 2], ["2026-03-14", "Site Web", 1], ["2026-03-14", "Amazon FR", 3], ["2025-03-05", "Amazon FR", 7], ["2026-03-16", "Amazon FR", 99]];
  const pays = [["2026-03-02", "France", "Site Web", 150], ["2026-03-13", "France", "Site Web", 30], ["2026-02-10", "Belgique", "Amazon FR", 1000], ["2025-03-02", "France", "Amazon FR", 200], ["2024-05-01", "France", "Amazon FR", 999], ["2026-03-15", "France", "Amazon FR", 5]];
  const paires = [["2026-02-10", P1, P2, 4], ["2026-02-11", P2, P1, 2], ["2026-02-12", P1, P3, 5], ["2025-12-01", P1, P2, 100], ["2026-03-15", P1, P2, 9]];
  const ext = fabriquer(L, { commandes, pays, paires });
  const extAvant = copie(ext), refAvant = copie(REF);
  ok(validerExtension(ext).ok, "socle : extension de test valide");
  const R = construire(ext, REF, { horsShopify: { ads: [{ a: 1 }], country_ads: [{ b: 2 }] } });
  ok(R.appliquee && R.an === 2026 && R.dmax === "2026-03-14" && R.du === "2023-12-31", `socle : construction (dmax ${R.dmax}, du ${R.du}) ${(R.erreurs ?? []).join(" ; ")}`);
  if (!R.appliquee) return;
  const { C } = R, D = C.DATA, K = D.kpi;
  ok(memes(ext, extAvant) && memes(REF, refAvant), "socle : l'extraction et la table de référence ne sont pas modifiées");
  ok(memes(construire(copie(ext), copie(REF), { horsShopify: { ads: [{ a: 1 }], country_ads: [{ b: 2 }] } }).C, C), "socle : calcul déterministe");

  /* ---- oracle : calcul direct sur les lignes retenues */
  const dmax = R.dmax;
  const annee = (y) => L.filter((l) => +l[0].slice(0, 4) === y && l[0] <= dmax);
  const mois = (lignes, f = () => true) => { const a = Array(12).fill(0); for (const l of lignes) if (f(l)) a[+l[0].slice(5, 7) - 1] += l[4]; return a.map(r2); };
  const marque = (nom) => VENDEUR[nom] || REF.produits[nom]?.marque || "Bestherm";
  const an = annee(2026), n1 = annee(2025), n2 = annee(2024);
  const caAn = r2(S(an.map((l) => l[4]))), qAn = S(an.map((l) => l[3]));
  ok(R.ca === caAn && K.ca_total_2026 === caAn && K.qte_total_2026 === qAn && R.qte === qAn, `socle : CA ${K.ca_total_2026} / quantité ${K.qte_total_2026} de l'année en cours (attendu ${caAn} / ${qAn})`);
  ok(caAn === 291265 && qAn === 4379, "socle : valeurs de référence du jeu de test (291 265 € ; 4 379 unités)");
  ok(K.nb_commandes_2026 === 11 && K.panier_moyen_2026 === r2(caAn / 11) && R.commandes === 11, "socle : commandes de l'année (jusqu'à la dernière donnée), panier moyen = CA ÷ commandes");
  ok(K.objectif_annuel_total === 1000000 && K.pct_objectif_atteint === r2((caAn / 1000000) * 100), "socle : objectif annuel et % atteint");
  ok(memes(D.monthly_total[2024], Array.from({ length: 12 }, (_, i) => 100 * (i + 1))) && memes(D.monthly_total[2025], Array.from({ length: 12 }, (_, i) => 200 * (i + 1) + 50)), "socle : courbes mensuelles des années précédentes (2023 ignorée)");
  ok(memes(D.monthly_total[2026], mois(an)) && S(D.monthly_total[2026]) === caAn && D.monthly_total[2026].slice(3).every((x) => x === 0), "socle : courbe mensuelle de l'année en cours, rien après le mois courant (la ligne du 15 mars est ignorée)");
  ok(memes(D.mois_labels, MOIS_LABELS), "socle : libellés des mois");

  // marques : celle du fournisseur Shopify (sinon celle de la table)
  const marques = ["Bestherm", "Thomson"];
  ok(memes(Object.keys(D.monthly_by_brand), marques), `socle : marques ${Object.keys(D.monthly_by_brand)}`);
  for (const b of marques) for (const y of [2024, 2025, 2026]) {
    const att = mois(annee(y), (l) => marque(l[2]) === b);
    if (y === 2024 && S(att) === 0) ok(D.monthly_by_brand[b][2024] === undefined, `socle : ${b} sans vente en 2024 : pas de courbe 2024`);
    else ok(memes(D.monthly_by_brand[b][y], att), `socle : courbe mensuelle ${b} ${y}`);
  }
  ok(D.brand_coverage_pct[2025] === 100 && D.brand_coverage_pct[2026] === r1((1 - 30 / caAn) * 100), "socle : part du CA dont le produit figure dans la table");
  const sansVendeur = construire(fabriquer(L, { vendeurs: {} }), REF, {});
  ok(sansVendeur.appliquee && sansVendeur.C.DATA.monthly_by_brand.Thomson && memes(sansVendeur.C.DATA.monthly_by_brand.Thomson[2025], mois(n1, (l) => l[2] === P2)) && sansVendeur.C.DATA.monthly_by_brand.Bestherm && memes(sansVendeur.C.SKU_MARQUE, ["Bestherm", "Thomson", "Bestherm"]), "socle : sans fournisseur Shopify, marque de la table de référence (ou Bestherm si absent)");
  ok(memes(C.SKU_MARQUE, ["Bestherm", "Thomson", "Thomson"]) && C.SKU_MARQUE.length === C.SKU_PRODUIT.length, "socle : marque de chaque produit (celle du fournisseur Shopify), parallèle à SKU_PRODUIT");

  // marketplaces
  const mps = ["Amazon FR", "Leroy Merlin", "Site Web"];
  for (const m of mps) for (const y of [2025, 2026]) ok(memes(D.gf.monthly_total_by_mp[m][y], mois(annee(y), (l) => l[1] === m)), `socle : courbe mensuelle ${m} ${y}`);
  const qteMp = (m) => S(an.filter((l) => l[1] === m).map((l) => l[3])), caMp = (m) => r2(S(an.filter((l) => l[1] === m).map((l) => l[4])));
  ok(mps.every((m) => D.gf.qte_by_mp[m] === qteMp(m)) && D.gf.nb_commandes_mp["Amazon FR"] === 8 && D.gf.nb_commandes_mp["Site Web"] === 3 && D.gf.nb_commandes_mp["Leroy Merlin"] === undefined, "socle : quantités et commandes par marketplace");
  ok(D.gf.panier_moyen_mp["Amazon FR"] === r2(caMp("Amazon FR") / 8) && D.gf.panier_moyen_mp["Site Web"] === 60, "socle : panier moyen par marketplace");
  ok(D.gf.best_by_mp["Site Web"].produit === P2 && D.gf.top_products_by_mp["Amazon FR"][0].produit === P1 && D.gf.top_products_by_mp["Site Web"].length === 2, "socle : meilleur produit par marketplace");
  ok(D.gf.brand_by_mp_month["Site Web"].Thomson[2] === 180, "socle : marque × marketplace × mois");

  // N-1 à date identique : janvier-février 2025 entiers + 1er → 14 mars 2025
  ok(R.coupe.du === "2025-03-01" && R.coupe.au === "2025-03-14" && D.cut_n1.jusqu_au === "03-14", "socle : coupe de comparaison N-1 (1er → 14 mars 2025)");
  ok(D.cut_n1.total[2025] === 600 && D.cut_n1.mp["Amazon FR"][2025] === 600 && D.cut_n1.mp["Leroy Merlin"][2025] === 0 && D.cut_n1.brand.Bestherm[2025] === 600, "socle : coupe N-1 (ventes du 10 mars 2025 seulement ; celles du 20 sont hors coupe)");
  ok(D.total_yoy_comparable[2025] === 1300 && D.total_yoy_comparable[2026] === caAn && D.total_yoy_comparable[2024] === undefined, "socle : total N-1 comparable = 2 mois entiers (700) + coupe (600)");
  const parMp = Object.fromEntries(D.mp_vs_objectif.map((m) => [m.marketplace, m]));
  ok(parMp["Amazon FR"].ca_2025 === 1200 && parMp["Leroy Merlin"].ca_2025 === 100 && parMp["Amazon FR"].ca === caMp("Amazon FR") && parMp["Amazon FR"].yoy_pct === r1((caMp("Amazon FR") / 1200 - 1) * 100), "socle : marketplaces, CA et CA N-1 comparable");
  ok(parMp["Amazon FR"].objectif === 500000 && parMp["Amazon FR"].objectif_fiable === true && parMp["Leroy Merlin"].objectif_fiable === false && parMp["Site Web"].objectif === null && parMp["Site Web"].pct_objectif === 0, "socle : objectifs du plan par marketplace");
  ok(parMp["Bol.com"] && parMp["Bol.com"].ca === 0 && D.mp_vs_objectif.every((m, i, a) => i === 0 || a[i - 1].ca >= m.ca), "socle : marketplace sans vente mais avec objectif conservée ; classement par CA décroissant");
  ok(D.brand_yoy.Bestherm[2025] === 1200 && D.brand_yoy.Thomson[2025] === 100 && D.brand_yoy.Bestherm["2025_annee"] === 15600 && D.brand_yoy.Thomson[2026] === r2(S(an.filter((l) => marque(l[2]) === "Thomson").map((l) => l[4]))), "socle : marques, N-1 comparable et année entière");

  // produits
  const caP = (p) => S(an.filter((l) => l[2] === p).map((l) => l[4]));
  ok(D.best_seller_2026.produit === P1 && D.best_seller_2025.produit === P1 && D.best_seller_2025.annee === 15600 && D.best_seller_2025.ca === 1200, "socle : meilleurs produits");
  ok(D.products_top15.length === 3 && D.products_top15[0].produit === P1 && D.products_top15[0].ca === Math.round(caP(P1)) && D.products_top15[0].ca_2025 === 1200 && D.products_top15[1].produit === P2 && D.products_top15[1].ca_2025 === 100 && D.products_top15[2].yoy_pct === null, "socle : classement des produits, CA N-1 comparable");
  ok(memes(C.SKU_PRODUIT, [P1, P2, P3]) && C.SKU_MPS.includes("Bol.com") && memes(C.SKU_FAMILLE, ["Fixe heater", "Sèche-serviettes", null]) && memes(C.SKU_WIFI, [false, true, false]) && memes(C.SKU_DESTOCKAGE, [false, true, false]) && memes(C.SKU_VERTICAL, [false, true, false]), "socle : attributs des produits (table de référence ; produit inconnu sans famille)");
  ok(memes(R.produitsInconnus, [P3]) && R.avertissements.some((a) => /absent\(s\) de la table de référence/.test(a) && a.includes(P3)) && R.avertissements.some((a) => /hors de la période/.test(a)), "socle : produit inconnu et lignes hors période signalés");
  ok(D.products_monthly_top6[P1].ca.length === 12 && memes(Object.keys(D.products_monthly_top6), [P1, P2, P3]), "socle : courbes mensuelles des meilleurs produits");
  const sm = C.SKU_MONTHLY, im = (nom) => C.SKU_PRODUIT.indexOf(nom), imp = (nom) => C.SKU_MPS.indexOf(nom);
  const ligneSm = (p, m, y, mo) => sm.find((r) => r[0] === im(p) && r[1] === imp(m) && r[2] === y && r[3] === mo);
  ok(sm.every((r) => r[2] >= 2025) && ligneSm(P1, "Amazon FR", 2025, 3).slice(4).join() === "600,3" && ligneSm(P2, "Site Web", 2026, 3).slice(4).join() === "150,3" && S(sm.filter((r) => r[2] === 2026).map((r) => r[4])) === caAn, "socle : ventes mensuelles par produit × marketplace (année précédente et en cours)");
  ok(memes(C.SKU_CUT_N1.map((r) => [C.SKU_PRODUIT[r[0]], C.SKU_MPS[r[1]], r[2], r[3]]), [[P1, "Amazon FR", 600, 3]]), "socle : coupe N-1 par produit × marketplace");
  const pt = D.price_tracking.find((r) => r[0] === P1 && r[1] === "Amazon FR");
  const janAmazon = an.filter((l) => l[1] === "Amazon FR" && l[2] === P1 && l[0] < "2026-02-01");
  ok(pt && pt[2][2] === 200 && pt[2][0] === 200 && pt[4][2] === 3 && pt[3][0] === r2(S(janAmazon.map((l) => l[4])) / S(janAmazon.map((l) => l[3]))) && pt[3][5] === null && pt[6][0] === 600 && pt[6][1] === 3, "socle : suivi des prix (prix moyen = CA ÷ quantité, par mois, vide sans vente ; coupe N-1)");
  ok(D.price_tracking.length === 5 && D.price_tracking.every((r) => r.length === 7 && [2, 3, 4, 5].every((i) => r[i].length === 12)) && D.price_tracking[0][0] === P1, "socle : suivi des prix : une ligne par produit × marketplace vendus, 12 mois chacune");

  // normes, catégories
  ok(memes(D.normes_month.CE[2025], mois(n1, (l) => l[2] === P1)) && memes(D.normes_month.NF[2026], mois(an, (l) => l[2] === P2)) && D.normes_month.CE[2024].length === 12, "socle : CA par norme NF / CE");
  const cat = D.category_by_mp.categories.Toutes;
  ok(cat[0].nom === "Radiateur électrique fixe" && cat[0].ca === Math.round(caP(P1)) && cat[1].nom === "Sèche-serviettes" && cat[0].pct === r1((caP(P1) / caAn) * 100) && D.category_by_mp.coverage.Toutes === r1(Math.min(100, ((caP(P1) + caP(P2)) / caAn) * 100)), "socle : catégories (part du CA) et couverture");
  ok(D.category_by_mp.categories["Site Web"].length === 1 && D.category_by_mp.souscategories.Toutes.some((c) => c.nom === "Mural"), "socle : catégories par marketplace et sous-catégories");

  // pays, semaines
  ok(memes(C.PAYS_MONTHLY, [["Belgique", "Amazon FR", 2026, 2, 1000], ["France", "Amazon FR", 2025, 3, 200], ["France", "Site Web", 2026, 3, 180]]), "socle : ventes par pays (2024 et après la dernière donnée ignorées)");
  // quantités par pays (6e élément) : sommées par mois comme le CA ; une année ne les porte que si TOUTES ses lignes en ont une (jamais de quantité partielle)
  {
    const paysQ = [["2026-03-02", "France", "Site Web", 150, 3], ["2026-03-13", "France", "Site Web", 30, 1], ["2026-02-10", "Belgique", "Amazon FR", 1000, 10], ["2025-03-02", "France", "Amazon FR", 200, 2], ["2024-05-01", "France", "Amazon FR", 999, 9], ["2026-03-15", "France", "Amazon FR", 5, 5]];
    const rq = (p) => construire(fabriquer(L, { commandes, pays: p, paires }), REF, {});
    const pm = (p) => { const x = rq(p); return x.appliquee ? x.C.PAYS_MONTHLY : x.erreurs; };
    ok(memes(pm(paysQ), [["Belgique", "Amazon FR", 2026, 2, 1000, 10], ["France", "Amazon FR", 2025, 3, 200, 2], ["France", "Site Web", 2026, 3, 180, 4]]), "socle : quantités par pays sommées par mois (2024 et lignes après la dernière donnée ignorées)");
    ok(memes(pm(paysQ.map((p) => (p[0].startsWith("2025") ? p.slice(0, 4) : p))), [["Belgique", "Amazon FR", 2026, 2, 1000, 10], ["France", "Amazon FR", 2025, 3, 200], ["France", "Site Web", 2026, 3, 180, 4]]), "socle : une année dont toutes les lignes portent une quantité la garde, l'autre reste sans quantité");
    ok(memes(pm(paysQ.map((p, i) => (i === 1 ? p.slice(0, 4) : p))), [["Belgique", "Amazon FR", 2026, 2, 1000], ["France", "Amazon FR", 2025, 3, 200, 2], ["France", "Site Web", 2026, 3, 180]]), "socle : une seule ligne sans quantité retire les quantités de toute son année");
    ok(memes(pm(paysQ.map((p, i) => (i === 4 || i === 5 ? p.slice(0, 4) : p))), pm(paysQ)), "socle : une ligne sans quantité hors période (2024, après la dernière donnée) ne retire rien");
    ok(memes(pm(paysQ.map((p) => p.slice(0, 4))), [["Belgique", "Amazon FR", 2026, 2, 1000], ["France", "Amazon FR", 2025, 3, 200], ["France", "Site Web", 2026, 3, 180]]), "socle : extraction sans aucune quantité par pays (ancien format) : CA seul, rien d'inventé");
    ok(rq(paysQ.map((p, i) => (i === 3 ? [...p.slice(0, 4), null] : p))).appliquee && !rq(paysQ.map((p, i) => (i === 3 ? [...p.slice(0, 4), "2"] : p))).appliquee, "socle : quantité par pays absente (null) tolérée, non numérique refusée");
    ok(rq(paysQ.map((p, i) => (i === 2 ? [...p.slice(0, 4), -4] : p))).C?.PAYS_MONTHLY[0][5] === -4, "socle : une quantité négative (remboursement) est conservée telle quelle");
  }
  const sem = new Map(); for (const l of an) sem.set(excelWeekOf(l[0]), (sem.get(excelWeekOf(l[0])) ?? 0) + l[4]);
  ok(memes(C.WEEKLY_TOTALS.map((r) => [r[0], r[1]]), [...sem].sort((a, b) => a[0] - b[0]).map(([w, ca]) => [w, r2(ca)])) && R.semaineMaxComplete === 11 && excelWeekOf("2026-03-14") === 11, "socle : ventes par semaine Excel (dimanche → samedi), dernière semaine complète = 11");
  ok(S(C.WEEKLY_BY_MP.map((r) => r[2])) === caAn && S(C.WEEKLY_BY_PROD.map((r) => r[2])) === caAn && S(C.WEEKLY_BY_MP.map((r) => r[3])) === qAn, "socle : semaines par marketplace et par produit = total");

  // élasticité : seule la série de 10 semaines complètes de prix variable est retenue
  const E = C.ELASTICITE_DATA;
  const pts = []; for (let w = 2; w <= 11; w++) { const p = 50 + 5 * (w - 2), q = Math.round(2e6 / (p * p)); pts.push([Math.log(p), Math.log(q)]); }
  const mx = S(pts.map((x) => x[0])) / 10, my = S(pts.map((x) => x[1])) / 10;
  const pente = S(pts.map(([x, y]) => (x - mx) * (y - my))) / S(pts.map(([x]) => (x - mx) ** 2));
  ok(E.length === 1 && E[0][0] === P1 && E[0][1] === "Amazon FR" && proche(E[0][2], pente) && proche(E[0][2], -2, 0.02) && E[0][3] > 0.99 && E[0][4] === 10 && E[0][7] === true, `socle : élasticité (pente ${E[0]?.[2]} ≈ −2, 10 semaines complètes, fiable ; semaine partielle, 3 semaines et prix constant exclus)`);
  ok(E[0][9] === 50 && E[0][10] === 95 && E[0][6] === 72.5, "socle : prix mini, maxi et moyen de la série d'élasticité");
  ok(C.SIMULATION_PRIX.risques.length === 1 && C.SIMULATION_PRIX.opportunites.length === 0 && C.SIMULATION_PRIX.risques[0][4] === r1(E[0][2] * REGLAGES.simulationPct), "socle : simulation de prix (élasticité < −1 et fiable = risque)");

  // paires, classes ABC, saisonnalité
  ok(memes(C.BASKET_PAIRS, [[P1, P2, 6], [P1, P3, 5]]), "socle : paires de produits achetés ensemble (année en cours, dans l'ordre alphabétique, plus fréquentes d'abord)");
  ok(memes(C.ABC_BY_SKU.map((r) => [r[1], r[4]]), [[P1, "A"], [P2, "D"], [P3, "D"]]) && C.ABC_BY_SKU[0][0] === "HT10-24JE" && C.ABC_BY_SKU[2][0] === P3 && r2(S(C.ABC_BY_SKU.map((r) => r[2]))) === caAn, "socle : classes ABC par CA cumulé (code de la table, sinon le nom)");
  const mens = Array.from({ length: 12 }, (_, i) => 300 * (i + 1) + 50), moy = S(mens) / 12;
  ok(memes(C.SEASONALITY_INDEX, mens.map((x) => r2(x / moy))) && moy === 2000 && C.SEASONALITY_INDEX[0] === 0.18, "socle : indice de saisonnalité (poids de chaque mois sur les deux années complètes précédentes)");
  ok(memes(D.ads, [{ a: 1 }]) && memes(D.country_ads, [{ b: 2 }]) && construire(ext, REF, {}).C.DATA.ads.length === 0, "socle : publicité = chiffres hors Shopify conservés tels quels");

  /* ---- couverture : l'écran s'arrête au dernier jour couvert par les deux boutiques */
  const decale = copie(ext); decale.boutiques.site.au = "2026-03-08"; decale.au = "2026-03-14";
  const R2 = construire(decale, REF, {});
  ok(R2.appliquee && R2.dmax === "2026-03-08" && R2.coupe.au === "2025-03-08" && R2.semaineMaxComplete === 10 && R2.ca === r2(S(an.filter((l) => l[0] <= "2026-03-08").map((l) => l[4]))), "socle : couverture = plus ancien des « au » des boutiques (coupe N-1 et semaine complète suivent)");
  const futur = fabriquer([...L, ["2027-01-05", "Amazon FR", P1, 1, 77]], { au: "2027-01-10" });
  const R3 = construire(futur, REF, {});
  ok(R3.appliquee && R3.dmax === "2026-12-31" && R3.ca === caAn + 100 && R3.avertissements.some((a) => /hors de la période/.test(a)), "socle : au changement d'année, les ventes de l'année suivante sont ignorées (signalées)");
  const R4 = construire(futur, REF, { an: 2027 });
  ok(!R4.appliquee || R4.an === 2027, "socle : l'année en cours est un paramètre");

  /* ---- refus : atomique, jamais d'écran à moitié construit */
  const refuse = (e, r = REF, o = {}) => { const x = construire(e, r, o); return !x.appliquee && Array.isArray(x.erreurs) && x.erreurs.length > 0 && x.C === undefined; };
  ok(refuse(null) && refuse({ ...ext, schema: 999 }) && refuse({ ...ext, lignes: undefined }) && refuse({ ...ext, produits: "x" }), "socle : extraction absente, schéma inconnu ou champ manquant refusés");
  ok(refuse({ ...ext, lignes: [...ext.lignes, ["2026-03-01", 99, 0, 1, 1]] }) && refuse({ ...ext, lignes: [...ext.lignes, ["2026-03-01", 0, 99, 1, 1]] }) && refuse({ ...ext, lignes: [...ext.lignes, ["2026-03-01", 0, 0, "1", 1]] }) && refuse({ ...ext, lignes: [...ext.lignes, ["hier", 0, 0, 1, 1]] }), "socle : index hors dictionnaire, valeur non numérique, jour illisible refusés");
  ok(refuse({ ...ext, pays_jour: [["2026-03-01", 9, 0, 1]] }) && refuse({ ...ext, commandes: [["2026-03-01", 9, 1]] }) && refuse({ ...ext, paires: [["2026-03-01", 0, 9, 1, 0]] }), "socle : index hors dictionnaire dans les pays, commandes et paires refusés");
  ok(refuse({ ...ext, boutiques: {}, au: undefined }) && refuse(ext, null) && refuse({ ...ext, lignes: ext.lignes.filter((l) => l[0] < "2026-01-01") }), "socle : couverture illisible, table de référence absente, aucune vente de l'année refusées");
  ok(refuse({ ...ext, au: "2025-12-31", boutiques: { a: { au: "2025-12-31" } }, lignes: ext.lignes.filter((l) => l[0] < "2026-01-01") }), "socle : couverture antérieure à l'année en cours refusée");

  /* ---- squelette : mêmes clés que le tableau de bord complet, pour que l'application affiche son écran d'erreur sans planter */
  const sq = squelette();
  const cles = (o, p = "") => (o && typeof o === "object" && !Array.isArray(o) ? Object.entries(o).flatMap(([k, v]) => (k.match(/^\d{4}$/) ? [] : [p + k, ...cles(v, p + k + ".")])) : []);
  const cC = Object.keys(C), cS = Object.keys(sq.C);
  ok(memes(cC, cS) && memes(Object.keys(D), Object.keys(sq.C.DATA)) && memes(Object.keys(D.gf), Object.keys(sq.C.DATA.gf)) && memes(Object.keys(D.kpi).sort(), Object.keys(sq.C.DATA.kpi).sort()) && sq.dmax === "2026-01-01", "socle : le squelette a les mêmes constantes que le tableau de bord construit");
  ok(Array.isArray(sq.C.SKU_PRODUIT) && sq.C.DATA.monthly_total[2026].length === 12 && cles(D.kpi).length === cles(sq.C.DATA.kpi).length, "socle : le squelette est complet et vide");
}
