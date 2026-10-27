/**
 * Contrôles de la chaîne d'extraction (transformer.mjs, collecte.mjs, refresh_extension.mjs) sur des résultats ShopifyQL
 * SYNTHÉTIQUES, dont les valeurs attendues sont calculées à la main : fenêtres de dates, passerelles → marketplaces, CA HT,
 * remboursements et ajustements, pays, références, contrôles jour par jour, indépendance des deux boutiques, fusion avec
 * l'extraction précédente, conservation des historiques, et la ligne de commande de bout en bout (dossier temporaire).
 * Aucun réseau, aucune boutique. Appelé par selftest.mjs.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { SCHEMA, validerExtension, auExtension, construire } from "../../socle.js";
import {
  CFG, Echec, LimiteAtteinte, MP_SITE, MP_AUTRE, PRODUIT_AJUSTEMENT, PRODUIT_LIVRAISON, REQ, addDays, jours, fenetres, requetesFenetre,
  normaliserSku, normaliserTitre, marketplaceDe, produitDe, marqueDuVendeur, traiterBoutique, agreger, controlerSortie, avertissementsDe, marqueDominante,
  TECHNOMAT, GQL, estTechnomat, prefixeNumero, numeroOrigine, messageSansNumero, minuitParis, minuitParisUtc,
} from "./transformer.mjs";
import { BOUTIQUES, lireResultats, jeuxDepuisIndex, etatRelais, jeuxRelais, collecterBoutique, fenetreTropLourde, lireNumeros } from "./collecte.mjs";
import { ErreurRelais } from "./site_query.mjs";
import { planifier, fenetre, decoder, fusionner, serialiser, comparerAuPrecedent, validerReferentiel, resume } from "./refresh_extension.mjs";
import { lireJson } from "./lib_app.mjs";

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), "refresh_extension.mjs");
const r2 = (x) => Math.round(x * 100) / 100;
const col = (...noms) => noms.map((name) => ({ name }));
const lance = (fn) => { try { fn(); return null; } catch (e) { return e; } };
const lanceAsync = async (fn) => { try { await fn(); return null; } catch (e) { return e; } };
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const trier = (l) => [...l].sort((a, b) => cmp(JSON.stringify(a), JSON.stringify(b)));
const memes = (a, b) => JSON.stringify(trier(a)) === JSON.stringify(trier(b));
const DM = BOUTIQUES.marketplaces.domaine, DS = BOUTIQUES.site.domaine;

/* ---- fabrique de résultats ShopifyQL (mêmes colonnes que les requêtes de transformer.mjs) */
const COLONNES_VENTES = ["day", "order_name", "line_type", "product_variant_sku", "product_title", "shipping_country", "product_vendor", "quantity_ordered", "net_sales", "taxes"];
const rVentes = (query, rows, shopDomain) => ({ query, shopDomain, columns: rows.length ? col(...COLONNES_VENTES) : [], rows });
const rPaiements = (query, rows, shopDomain) => ({ query, shopDomain, columns: rows.length ? col("order_name", "payment_gateway", "gross_payments") : [], rows });
const rControle = (query, rows, shopDomain) => ({ query, shopDomain, columns: rows.length ? col("day", "quantity_ordered", "net_sales", "taxes") : [], rows });
// Totaux de chaque jour tels que Shopify les donnerait (TIMESERIES day)
function totauxJour(rows) {
  const m = new Map();
  for (const [d, , , , , , , q, n, t] of rows) { const a = m.get(d) ?? [d, 0, 0, 0]; a[1] += q; a[2] += n; a[3] += t; m.set(d, a); }
  return [...m.values()].sort((a, b) => cmp(a[0], b[0])).map(([d, q, n, t]) => [d, q, r2(n), r2(t)]);
}

// Les contrôles historiques ci-dessous ne portent pas sur la classification Technomat : toute commande Leroy Merlin y a un numéro
// d'origine 001 (France). Les contrôles Technomat, plus bas, fournissent leurs propres numéros.
const LM001 = { get: () => "001-26001L1-A" };
const traiter = (id, jeux, ref, fen) => traiterBoutique(id, jeux, ref, { numeros: LM001, ...fen });

export async function testerPipeline(ok) {
  const ref = lireJson("data/referentiel.json");
  const noms = new Map();
  for (const [code, nom] of Object.entries(ref.skus)) if (!noms.has(nom) && /^[A-Z0-9-]+$/.test(code) && nom !== PRODUIT_LIVRAISON) noms.set(nom, code);
  const [[nomA, skuA], [nomB, skuB]] = [...noms];
  const D1 = "2026-10-04", D2 = "2026-10-05", AUJ = "2026-10-06";

  /* ================================================================= correspondances */
  ok(normaliserSku("HT10-24JE_never_used") === "HT10-24JE" && normaliserSku("X1 never used") === "X1" && normaliserSku(" AB/CD-FLM ") === "AB-CD", "pipeline : normalisation des références");
  ok(normaliserTitre("Radiateur électrique – ARIA 1000W (blanc)") === "radiateur electrique aria 1000w blanc", "pipeline : normalisation des titres (accents, ponctuation, casse)");
  const P = ref.passerelles;
  ok(marketplaceDe("leroymerlin via Shopping Feed", P) === "Leroy Merlin" && marketplaceDe("Amazon FBA", P) === "Amazon FR" && marketplaceDe("epmm", P) === "ManoMano"
    && marketplaceDe("clogistique", P) === "Cdiscount" && marketplaceDe("carrefourx", P) === null && marketplaceDe(undefined, P) === null, "pipeline : passerelles → marketplaces");
  ok(produitDe(skuA, "n'importe quel titre", ref).nom === nomA && produitDe(skuA + "_never_used", "", ref).nom === nomA, "pipeline : référence connue → produit de la table");
  const titreConnu = Object.keys(ref.titres ?? {})[0];
  ok(!titreConnu || (produitDe("", titreConnu, ref).nom === ref.titres[titreConnu] && produitDe("SKU-INCONNU", titreConnu, ref).connu), "pipeline : ligne sans référence reconnue par son titre");
  const pInconnu = produitDe("ZZ-999", "Produit nouveau", ref), pCode = produitDe("ZZ-999", "", ref), pVide = produitDe("", "", ref);
  ok(!pInconnu.connu && pInconnu.nom === "Produit nouveau" && pCode.nom === "ZZ-999" && pVide.nom === "Sans référence", "pipeline : produit inconnu conservé sous son titre, sa référence ou « Sans référence »");
  ok(marqueDuVendeur("Thomson") === "Thomson" && marqueDuVendeur(" bestherm ") === "Bestherm" && marqueDuVendeur("HOM'Y") === "HOM'Y" && marqueDuVendeur("Hom’y") === "HOM'Y" && marqueDuVendeur("Autre fournisseur") === null && marqueDuVendeur("") === null, "pipeline : marque d'après le fournisseur Shopify");
  ok(marqueDominante(new Map([["Thomson", 3], ["Bestherm", 1]])) === "Thomson" && marqueDominante(new Map([["Thomson", 2], ["Bestherm", 2]])) === "Bestherm" && marqueDominante(new Map()) === null, "pipeline : marque dominante (égalité : ordre alphabétique)");
  ok(validerReferentiel(ref).length === 0, "pipeline : table de référence valide");
  const refCassee = JSON.parse(JSON.stringify(ref));
  refCassee.skus.minuscule = nomA; refCassee.skus["SKU-ORPHELIN"] = "Produit absent"; refCassee.produits[nomA].wifi = "oui";
  ok(validerReferentiel(refCassee).length >= 3 && validerReferentiel(null).length > 0, "pipeline : table de référence incohérente détectée");

  /* ================================================================= fenêtres et plan */
  const f = fenetres("2026-01-01", "2026-01-30");
  ok(f.length === 3 && f[0].au === "2026-01-14" && f[1].du === "2026-01-15" && f[2].du === "2026-01-29" && f[2].au === "2026-01-30", "pipeline : fenêtres de 14 jours (la dernière plus courte)");
  ok(fenetres("2026-10-04", "2026-10-04").length === 1 && jours("2026-02-27", "2026-03-02").length === 4, "pipeline : fenêtre d'un jour, jours consécutifs (fin de février)");
  const w = { du: "2026-10-01", au: "2026-10-14" };
  const qm = requetesFenetre("marketplaces", w, "2026-10-20"), qm2 = requetesFenetre("marketplaces", w, "2026-10-15"), qs = requetesFenetre("site", w, "2026-10-20");
  ok(qm.length === 3 && qs.length === 2 && qm[1].query.includes("UNTIL 2026-10-17") && qm2[1].query.includes("UNTIL 2026-10-15"), "pipeline : requêtes d'une fenêtre (paiements lus 3 jours plus loin, sans dépasser aujourd'hui)");
  ok(qm.every((q) => q.id && q.query.startsWith("FROM ")) && qs.every((q) => !/payments/.test(q.query)), "pipeline : le site ne lit pas les paiements");
  ok(!/\bshipping\b.*IN/.test(REQ.ventes("2026-10-01", "2026-10-02")) && /line_type IN \('product', 'sale_adjustment'\)/.test(REQ.ventes("2026-10-01", "2026-10-02")), "pipeline : requête de ventes sur les lignes produit et ajustement");

  const extV2 = (boutiques) => ({ schema: SCHEMA, du: "2026-10-01", au: "2026-10-01", boutiques, mp: ["Site Web"], pays: ["France"], produits: [["P", null]], lignes: [["2026-10-01", 0, 0, 1, 1]], pays_jour: [], commandes: [], paires: [] });
  const prec = extV2({ marketplaces: { au: "2026-10-08" }, site: { au: "2026-10-10" } });
  const p0 = planifier(null, "2026-10-12", {}, "marketplaces"), p0s = planifier(null, "2026-10-12", {}, "site");
  ok(p0.du === "2024-01-01" && p0.au === "2026-10-11" && p0s.du === "2025-05-01" && !p0.vide, "pipeline : sans extraction, tout l'historique de chaque boutique");
  ok(planifier({ schema: 1, lignes: [], boutiques: { site: { au: "2026-10-10" } } }, "2026-10-12", {}, "site").du === "2025-05-01", "pipeline : une extraction à l'ancien format est ignorée (historique complet)");
  ok(fenetre(prec, "2026-10-12", {}, "site").du === "2026-10-10" && fenetre(prec, "2026-10-12", {}, "marketplaces").du === "2026-10-08", "pipeline : chaque boutique reprend à son dernier jour extrait (correction tardive)");
  ok(fenetre(prec, "2026-10-12", { reprendre: 0 }, "site").du === "2026-10-11" && fenetre(prec, "2026-10-12", { reprendre: 3 }, "site").du === "2026-10-08", "pipeline : --reprendre ajuste le nombre de jours repris");
  ok(fenetre(prec, "2026-10-11", { reprendre: 0 }, "site").vide === true && fenetre(prec, "2026-10-11", {}, "site").vide === false, "pipeline : fenêtre vide seulement sans jour à reprendre");
  ok(fenetre(extV2({ site: { au: "2025-04-01" } }), "2026-10-12", {}, "site").du === "2025-05-01", "pipeline : jamais avant le début de la boutique");
  ok(fenetre(prec, "2026-10-12", { du: "2026-10-01", au: "2026-10-03" }, "site").du === "2026-10-01" && fenetre(prec, "2026-10-12", { du: "2026-10-01", au: "2026-10-03" }, "site").au === "2026-10-03", "pipeline : --du et --au forcent la fenêtre");
  const plan = planifier(null, AUJ, { du: D1, au: D2 }, "marketplaces");
  ok(plan.boutique === "marketplaces" && plan.today === AUJ && plan.queries.length === 3 && plan.queries.every((q) => typeof q.id === "string" && typeof q.query === "string"), "pipeline : forme du plan (boutique, today, du, au, vide, requêtes)");

  /* ================================================================= boutique des marketplaces */
  // Jour de référence, valeurs attendues calculées à la main (f = facteur de montant, off = numéro de la première commande)
  const jourM = (D, off, fac = 1) => {
    const o = (k) => `#${off + k}`;
    return {
      ventes: [
        [D, o(1), "product", skuA, "A", "France", "Bestherm", 2, 100 * fac, 20 * fac],
        [D, o(1), "product", skuB, "B", "France", "Bestherm", 1, 50 * fac, 10 * fac],
        [D, o(2), "product", skuB, "B", "Belgium", "Bestherm", 1, 50 * fac, 10 * fac],
        [D, o(3), "product", skuA, "A", "Spain", "Bestherm", 1, 60 * fac, 12 * fac],
        [D, o(4), "product", skuA, "A", "France", "Bestherm", 1, 0, 0],
        [D, o(5), "product", skuA, "A", "Italy", "Bestherm", -1, -60 * fac, -12 * fac],
        [D, o(5), "sale_adjustment", "", "", "Italy", "", 0, -6 * fac, -1.2 * fac],
      ],
      paiements: [[o(1), "leroymerlin via Shopping Feed", 180 * fac], [o(2), "amazon", 60 * fac], [o(3), "carrefourx", 72 * fac], [o(5), "amazon fba", -72 * fac]],
    };
  };
  const jeuxM = (D, off, fac = 1) => {
    const j = jourM(D, off, fac);
    const [qv, qp, qc] = requetesFenetre("marketplaces", { du: D, au: D }, AUJ);
    return { ventes: [rVentes(qv.query, j.ventes, DM)], paiements: [rPaiements(qp.query, j.paiements, DM)], controle: [rControle(qc.query, totauxJour(j.ventes), DM)] };
  };
  const fen1 = { du: D1, au: D1, depuisPaires: D1 };
  const sM = traiter("marketplaces", jeuxM(D1, 1000), ref, fen1);
  const attendu = [["Leroy Merlin", nomA, 2, 100], ["Leroy Merlin", nomB, 1, 50], ["Amazon FR", nomB, 1, 50], ["Amazon FR", nomA, -1, -66], [MP_AUTRE, nomA, 2, 60]];
  ok(memes(sM.lignes.map((l) => [l.mp, l.produit, l.qte, l.ca]), attendu) && sM.lignes.every((l) => l.d === D1), "pipeline : lignes jour × marketplace × produit (CA HT = (net + taxes) ÷ 1,2 ; remboursement et ajustement sur le produit remboursé)");
  ok(r2(sM.stats.ca) === 194 && sM.stats.qte === 5 && sM.stats.commandes === 3 && r2(sM.stats.net) === 194 && r2(sM.stats.taxes) === 38.8, "pipeline : totaux du jour = ventes nettes de Shopify (194 €), 5 unités, 3 commandes");
  ok(memes(sM.commandes.map((c) => [c.mp, c.n]), [["Leroy Merlin", 1], ["Amazon FR", 1], [MP_AUTRE, 1]]), "pipeline : commandes comptées si CA > 0 (ni le 0 € ni le remboursement)");
  ok(memes(sM.pays.map((p) => [p.pays, p.mp, p.ca]), [["France", "Leroy Merlin", 150], ["France", MP_AUTRE, 0], ["Belgique", "Amazon FR", 50], ["Espagne", MP_AUTRE, 60], ["Italie", "Amazon FR", -66]]), "pipeline : pays traduits (Belgium → Belgique…), CA par jour × pays × marketplace");
  ok(memes(sM.pays.map((p) => [p.pays, p.mp, p.qte]), [["France", "Leroy Merlin", 3], ["France", MP_AUTRE, 1], ["Belgique", "Amazon FR", 1], ["Espagne", MP_AUTRE, 1], ["Italie", "Amazon FR", -1]]) && sM.pays.reduce((t, p) => t + p.qte, 0) === sM.stats.qte, "pipeline : quantité par jour × pays × marketplace (retour en négatif, ajustement sans quantité), somme = unités du jour (onglet Répartitions)");
  const [pa, pb] = [nomA, nomB].sort();
  ok(sM.paires.length === 1 && sM.paires[0].a === pa && sM.paires[0].b === pb && sM.paires[0].n === 1, "pipeline : paires de produits d'une même commande (ordre alphabétique)");
  ok(sM.stats.passerellesInconnues.size === 1 && sM.stats.passerellesInconnues.has("carrefourx") && sM.stats.sansPaiement === 1 && sM.stats.sansPaiementListe.length === 0, "pipeline : passerelle inconnue → « Autre » ; commande à 0 € sans paiement tolérée");
  ok(sM.vendeurs.get(nomA)?.get("Bestherm") >= 1, "pipeline : marque du fournisseur retenue par produit");
  const av = avertissementsDe(sM);
  ok(av.some((a) => /Passerelles de paiement inconnues/.test(a) && /carrefourx/.test(a)) && !av.some((a) => /absents de la table/.test(a)), "pipeline : avertissement sur la passerelle inconnue seulement");
  const sSansPaires = traiter("marketplaces", jeuxM(D1, 1000), ref, { du: D1, au: D1, depuisPaires: D2 });
  ok(sSansPaires.paires.length === 0, "pipeline : paires conservées seulement depuis la date demandée");

  // Ajustement sans produit dans la commande ; commande payée par plusieurs marketplaces ; paiement lu dans deux fenêtres
  {
    const [qv, qp, qc] = requetesFenetre("marketplaces", { du: D1, au: D1 }, AUJ);
    const ventes = [
      [D1, "#A1", "sale_adjustment", "", "", "France", "", 0, -12, -2.4],
      [D1, "#A2", "product", skuA, "A", "France", "Bestherm", 1, 100, 20],
      [D1, "#A2", "product", skuB, "B", "France", "Bestherm", 1, 100, 20],
    ];
    const pai = [["#A1", "amazon", -14.4], ["#A2", "amazon", 200], ["#A2", "cdiscount", 40]];
    const jeux = { ventes: [rVentes(qv.query, ventes, DM)], paiements: [rPaiements(qp.query, pai, DM), rPaiements(qp.query, pai, DM)], controle: [rControle(qc.query, totauxJour(ventes), DM)] };
    const s = traiter("marketplaces", jeux, ref, fen1);
    const aj = s.lignes.find((l) => l.produit === PRODUIT_AJUSTEMENT);
    ok(aj && aj.qte === 0 && aj.ca === -12 && aj.mp === "Amazon FR", "pipeline : ajustement sans produit → ligne « Ajustements Shopify »");
    ok(s.stats.multiPasserelle.includes("#A2") && s.lignes.filter((l) => l.mp === "Amazon FR" && l.produit !== PRODUIT_AJUSTEMENT).length === 2, "pipeline : commande payée via deux passerelles → passerelle dominante (Amazon), signalée");
    const avA = avertissementsDe(s);
    ok(r2(s.lignes.reduce((t, l) => t + l.ca, 0)) === 188 && avA.some((x) => /Ajustements de vente sans produit/.test(x)) && avA.some((x) => /plusieurs marketplaces/.test(x)), "pipeline : le total reste exact (188 €), l'ajustement orphelin et la double passerelle sont signalés");
  }

  // Un ajustement se répartit sur les lignes remboursées de la même commande
  {
    const [qv, qp, qc] = requetesFenetre("marketplaces", { du: D1, au: D1 }, AUJ);
    const ventes = [
      [D1, "#R1", "product", skuA, "A", "France", "Bestherm", -1, -100, -20],
      [D1, "#R1", "product", skuB, "B", "France", "Bestherm", -1, -50, -10],
      [D1, "#R1", "product", skuB, "B2", "France", "Bestherm", 1, 30, 6],
      [D1, "#R1", "sale_adjustment", "", "", "France", "", 0, -15, -3],
    ];
    const jeux = { ventes: [rVentes(qv.query, ventes, DM)], paiements: [rPaiements(qp.query, [["#R1", "leroymerlin", -150]], DM)], controle: [rControle(qc.query, totauxJour(ventes), DM)] };
    const s = traiter("marketplaces", jeux, ref, fen1);
    const a = s.lignes.find((l) => l.produit === nomA), b = s.lignes.find((l) => l.produit === nomB);
    // ajustement −15 € HT réparti au prorata des lignes remboursées (−100 et −50) : −10 et −5
    ok(a && r2(a.ca) === -110 && b && r2(b.ca) === -50 + 30 - 5 && r2(s.stats.ca) === -135, "pipeline : ajustement réparti au prorata des lignes remboursées");
  }

  /* ---- refus : rien n'est écrit si les lignes lues ne retrouvent pas les totaux de Shopify */
  const echec = (fn) => { const e = lance(fn); return e instanceof Echec && !(e instanceof LimiteAtteinte) ? e : null; };
  const avecControle = (rows) => { const j = jeuxM(D1, 1000); j.controle = [rControle(j.controle[0].query, rows, DM)]; return j; };
  ok(echec(() => traiter("marketplaces", avecControle([[D1, 6, 194, 38.8]]), ref, fen1))?.code === 2, "pipeline : écart de quantité avec le total Shopify refusé (code 2)");
  ok(echec(() => traiter("marketplaces", avecControle([[D1, 5, 250, 38.8]]), ref, fen1)), "pipeline : écart de ventes nettes refusé");
  ok(echec(() => traiter("marketplaces", avecControle([[D1, 5, 194, 50]]), ref, fen1)), "pipeline : écart de taxes refusé");
  ok(echec(() => traiter("marketplaces", avecControle([]), ref, fen1)), "pipeline : total de contrôle absent refusé");
  ok(echec(() => traiter("marketplaces", avecControle([[D1, 5, 194, 38.8], ["2026-10-09", 3, 10, 2]]), ref, fen1)) === null, "pipeline : total d'un jour hors fenêtre ignoré");
  { // un jour de la fenêtre sans aucune ligne mais avec des ventes chez Shopify : refusé
    const j = jeuxM(D1, 1000);
    j.controle = [rControle(j.controle[0].query, [...totauxJour(jourM(D1, 1000).ventes), [D2, 1, 10, 2]], DM)];
    ok(echec(() => traiter("marketplaces", j, ref, { du: D1, au: D2 })), "pipeline : jour de la fenêtre absent des lignes mais présent chez Shopify refusé");
  }
  ok(lance(() => traiter("marketplaces", { ...jeuxM(D1, 1000), ventes: [rVentes("q", Array.from({ length: CFG.limiteLignes }, (_, i) => [D1, "#X" + i, "product", skuA, "A", "France", "Bestherm", 0, 0, 0]), DM)] }, ref, fen1)) instanceof LimiteAtteinte, "pipeline : liste de ventes tronquée (limite de lignes) → LimiteAtteinte");
  ok(lance(() => traiter("marketplaces", { ...jeuxM(D1, 1000), paiements: [rPaiements("q", Array.from({ length: CFG.limiteLignes }, (_, i) => ["#P" + i, "amazon", 1]), DM)] }, ref, fen1)) instanceof LimiteAtteinte, "pipeline : liste de paiements tronquée → LimiteAtteinte");
  { // plus de 10 % des commandes sans passerelle : jeu « payments » incomplet
    const [qv, , qc] = requetesFenetre("marketplaces", { du: D1, au: D1 }, AUJ);
    const ventes = Array.from({ length: 40 }, (_, i) => [D1, "#N" + i, "product", skuA, "A", "France", "Bestherm", 1, 10, 2]);
    const j = { ventes: [rVentes(qv.query, ventes, DM)], paiements: [rPaiements("q", [["#N0", "amazon", 12]], DM)], controle: [rControle(qc.query, totauxJour(ventes), DM)] };
    ok(echec(() => traiter("marketplaces", j, ref, fen1)), "pipeline : jeu « payments » presque vide (commandes sans passerelle) refusé");
  }
  ok(echec(() => traiter("marketplaces", { ...jeuxM(D1, 1000), ventes: [{ query: "q", shopDomain: DM, columns: col("day", "order_name"), rows: [[D1, "#1"]] }] }, ref, fen1)), "pipeline : colonne absente refusée");
  ok(echec(() => traiter("marketplaces", { ...jeuxM(D1, 1000), ventes: [rVentes("q", [[D1, "#1", "product", skuA, "A", "France", "Bestherm", "beaucoup", 1, 1]], DM)] }, ref, fen1)), "pipeline : valeur non numérique refusée");
  ok(echec(() => traiter("marketplaces", { ...jeuxM(D1, 1000), ventes: [rVentes("q", [["2026-09-30", "#1", "product", skuA, "A", "France", "Bestherm", 1, 1, 0.2]], DM)] }, ref, fen1)), "pipeline : ligne hors de la fenêtre demandée refusée");

  /* ---- Technomat : les commandes Leroy Merlin dont le numéro d'origine commence par 014 forment la marketplace Technomat */
  ok(estTechnomat("014-120208-A") && estTechnomat(" 014-1-A ") && estTechnomat("014") && !estTechnomat("001-26299L112-A") && !estTechnomat("0140-1")
    && !estTechnomat("1014-1") && !estTechnomat("") && !estTechnomat(undefined) && !estTechnomat(null) && !estTechnomat("TEST-6"), "Technomat : seuls les numéros d'origine commençant par 014 (pas 0140…)");
  ok(prefixeNumero("002-26299L1-A") === "002" && prefixeNumero("TEST-6") === null && prefixeNumero("0140-1") === null && prefixeNumero(undefined) === null, "Technomat : préfixe d'un numéro d'origine");
  ok(numeroOrigine([{ key: "Latest Ship Date", value: "x" }, { key: "leroymerlin Number", value: " 014-1-A " }]) === "014-1-A" && numeroOrigine([]) === "" && numeroOrigine(null) === "", "Technomat : numéro d'origine lu dans les attributs de commande");
  ok(minuitParis("2026-10-24") === "2026-10-24T00:00:00+02:00" && minuitParis("2026-10-25") === "2026-10-25T00:00:00+02:00" && minuitParis("2026-10-26") === "2026-10-26T00:00:00+01:00"
    && minuitParis("2026-03-29") === "2026-03-29T00:00:00+01:00" && minuitParis("2026-03-30") === "2026-03-30T00:00:00+02:00", "Technomat : minuit de Paris avec le bon décalage (changements d'heure du 29 mars et du 25 octobre)");
  ok(minuitParisUtc("2026-10-26") === "2026-10-25T23:00:00Z" && minuitParisUtc("2026-10-25") === "2026-10-24T22:00:00Z" && minuitParisUtc("2026-03-29") === "2026-03-28T23:00:00Z"
    && minuitParisUtc("2026-03-30") === "2026-03-29T22:00:00Z" && minuitParisUtc("2026-07-14") === "2026-07-13T22:00:00Z", "Technomat : minuit de Paris en UTC (changements d'heure du 29 mars et du 25 octobre)");
  const planC = planifier(null, "2026-10-27", { du: "2026-10-25", au: "2026-10-26" }, "marketplaces");
  ok(planC.classification?.graphql === GQL.commandesLm("2026-10-25", "2026-10-26") && planC.classification.first === 50 && planC.classification.outil === "graphql_query"
    && planC.classification.graphql.includes("gateway:'leroymerlin via Shopping Feed'") && planC.classification.graphql.includes("created_at:>='2026-10-24T22:00:00Z'")
    && planC.classification.graphql.includes("created_at:<'2026-10-26T23:00:00Z'") && planC.classification.graphql.includes("customAttributes{ key value }")
    && !/email|phone|address|customer/i.test(planC.classification.graphql) && planC.classification.volumineux === undefined,
  "Technomat : le plan contient la requête GraphQL de classification (fenêtre de minuit à minuit, bornes en UTC entre apostrophes, sans donnée client)");
  // Shopify interprète de travers les dates SANS apostrophes (« created_at:<…+01:00 » ignoré, « created_at:>=…Z » ramené au jour entier) :
  // chaque borne doit être une date-heure UTC exacte ENTRE APOSTROPHES, et il ne doit y en avoir que deux.
  const gq = planC.classification.graphql, sansBornes = gq.replace(/created_at:(?:>=|<)'\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ'/g, "");
  ok((gq.match(/created_at:/g) ?? []).length === 2 && !sansBornes.includes("created_at:"), "Technomat : les deux bornes de la requête sont en UTC (…Z) entre apostrophes (jamais sans apostrophes, ni avec un décalage « +01:00 », ni une date seule)");
  ok(planifier(null, "2026-10-27", { du: "2026-10-25", au: "2026-10-26" }, "site").classification === undefined && planifier(null, AUJ, {}, "marketplaces").classification?.volumineux?.includes("--ordres-lm"),
    "Technomat : pas de classification pour la boutique du site ; un historique entier renvoie vers un fichier --ordres-lm");

  // la commande #1001 (A × 2 et B × 1, 150 € HT) est celle de Leroy Merlin dans le jeu du jour
  const lignesDe = (s, mp) => s.lignes.filter((l) => l.mp === mp).map((l) => [l.produit, l.qte, l.ca]);
  const sT = traiterBoutique("marketplaces", jeuxM(D1, 1000), ref, { ...fen1, numeros: new Map([["#1001", "014-120208-A"]]) });
  ok(memes(sT.lignes.map((l) => [l.mp, l.produit, l.qte, l.ca]), [[TECHNOMAT.mp, nomA, 2, 100], [TECHNOMAT.mp, nomB, 1, 50], ["Amazon FR", nomB, 1, 50], ["Amazon FR", nomA, -1, -66], [MP_AUTRE, nomA, 2, 60]])
    && lignesDe(sT, "Leroy Merlin").length === 0, "Technomat : la commande 014 est classée Technomat et plus dans Leroy Merlin");
  ok(r2(sT.stats.ca) === 194 && sT.stats.qte === 5 && sT.stats.commandes === 3 && sT.stats.technomat.commandes === 1 && r2(sT.stats.technomat.ca) === 150, "Technomat : total du jour inchangé (194 €, 5 unités), compteur des commandes 014");
  ok(memes(sT.commandes.map((c) => [c.mp, c.n]), [[TECHNOMAT.mp, 1], ["Amazon FR", 1], [MP_AUTRE, 1]]) && memes(sT.pays.map((p) => [p.pays, p.mp, p.ca, p.qte]), [["France", TECHNOMAT.mp, 150, 3], ["France", MP_AUTRE, 0, 1], ["Belgique", "Amazon FR", 50, 1], ["Espagne", MP_AUTRE, 60, 1], ["Italie", "Amazon FR", -66, -1]]),
    "Technomat : commandes et pays suivent la marketplace Technomat (onglet Répartitions)");
  ok(!avertissementsDe(sT).some((a) => /préfixe connu/.test(a)) && lance(() => controlerSortie(agreger([sT]))) === null, "Technomat : pas d'avertissement pour un numéro 014, extraction acceptée");
  // numéro d'une autre origine (Espagne 002) : reste dans Leroy Merlin ; préfixe inconnu : reste dans Leroy Merlin + avertissement ; numéro vide : signalé
  const sEs = traiterBoutique("marketplaces", jeuxM(D1, 1000), ref, { ...fen1, numeros: new Map([["#1001", "002-26299L2-A"]]) });
  ok(lignesDe(sEs, "Leroy Merlin").length === 2 && lignesDe(sEs, TECHNOMAT.mp).length === 0 && sEs.stats.technomat.commandes === 0 && !avertissementsDe(sEs).some((a) => /préfixe connu/.test(a)), "Technomat : un numéro 002 reste dans Leroy Merlin");
  const sX = traiterBoutique("marketplaces", jeuxM(D1, 1000), ref, { ...fen1, numeros: new Map([["#1001", "099-1-A"]]) });
  ok(lignesDe(sX, "Leroy Merlin").length === 2 && avertissementsDe(sX).some((a) => /préfixe connu/.test(a) && /099-1-A/.test(a)), "Technomat : préfixe inconnu laissé dans Leroy Merlin avec avertissement");
  const sV = traiterBoutique("marketplaces", jeuxM(D1, 1000), ref, { ...fen1, numeros: new Map([["#1001", ""]]) });
  ok(lignesDe(sV, "Leroy Merlin").length === 2 && avertissementsDe(sV).some((a) => /préfixe connu/.test(a) && /\(vide\)/.test(a)), "Technomat : commande lue sans numéro d'origine signalée");
  // numéro non lu : on n'écrit rien (code 3), jamais de classement au hasard
  for (const [nom, arg] of [["absent", undefined], ["vide", new Map()], ["autre commande", new Map([["#9999", "014-1-A"]])]]) {
    const eN = lance(() => controlerSortie(agreger([traiterBoutique("marketplaces", jeuxM(D1, 1000), ref, { ...fen1, numeros: arg })])));
    ok(eN instanceof Echec && eN.code === 3 && /#1001/.test(eN.message) && /classification/.test(eN.message), `Technomat : classification ${nom} → refus (code 3) et commande citée`);
  }
  // le message d'échec porte, prêtes à lancer, les requêtes de lecture par nom (commande créée avant la fenêtre, puis modifiée ou remboursée)
  const mN = messageSansNumero(["SHOP100", "SHOP101", "bad name\"; drop"]);
  ok(mN.includes(GQL.commandesParNom(["SHOP100", "SHOP101"])) && !/drop/.test(mN.split("query = ")[1] ?? "") && mN.includes("3 commande(s)") && /Aucune écriture/.test(mN),
    "Technomat : le message d'échec contient la requête GraphQL par nom (noms sûrs seulement) et le nombre de commandes");
  ok(GQL.commandesParNom(["SHOP100", "SHOP101"]) === 'query{ orders(first:50, query:"name:SHOP100 OR name:SHOP101"){ edges{ node{ name customAttributes{ key value } } } } }'
    && !/email|phone|address|customer/i.test(GQL.commandesParNom(["SHOP100"])), "Technomat : requête par nom en lecture seule, sans donnée client");
  const nombreux = Array.from({ length: 120 }, (_, i) => "SHOP" + (200 + i));
  ok((messageSansNumero(nombreux).match(/query\{ orders\(first:50/g) || []).length === 3 && messageSansNumero(nombreux).includes("120 commande(s)"), "Technomat : au plus trois requêtes par nom dans le message, par lots de 50");
  // une journée sans commande Leroy Merlin n'exige aucune classification
  {
    const jSans = jeuxM(D1, 1000);
    jSans.paiements = [rPaiements(jSans.paiements[0].query, [["#1001", "amazon", 180], ["#1002", "amazon", 60], ["#1003", "carrefourx", 72], ["#1005", "amazon fba", -72]], DM)];
    ok(lance(() => controlerSortie(agreger([traiterBoutique("marketplaces", jSans, ref, { ...fen1, numeros: new Map() })]))) === null, "Technomat : sans commande Leroy Merlin, aucune classification n'est exigée");
  }

  /* ---- contrôles sur l'ensemble de l'extraction */
  ok(lance(() => controlerSortie(sM)) === null, "pipeline : extraction plausible acceptée");
  ok(lance(() => controlerSortie({ ...sM, lignes: [] })) instanceof Echec, "pipeline : extraction sans aucune vente refusée");
  ok(lance(() => controlerSortie({ ...sM, stats: { ...sM.stats, commandes: 100, sansPaiementListe: Array(5).fill("#x") } })) instanceof Echec, "pipeline : plus de 2 % des commandes sans passerelle refusé");
  ok(lance(() => agreger([])) instanceof Echec, "pipeline : agrégation sans fenêtre refusée");

  /* ================================================================= boutique du site */
  const jourS = (D, off, fac = 1) => [
    [D, `#S${off + 1}`, "product", skuB, "B", "France", "Bestherm", 1, 200 * fac, 40 * fac],
    [D, `#S${off + 2}`, "product", skuA, "A", "Germany", "Bestherm", 2, 300 * fac, 60 * fac],
    [D, `#S${off + 3}`, "product", skuA, "A", "France", "Bestherm", 0, 0, 0],
    [D, `#S${off + 4}`, "product", "", "Produit XYZ inconnu", "France", "Thomson", 1, 10 * fac, 2 * fac],
  ];
  const jeuxS = (D, off, fac = 1) => {
    const v = jourS(D, off, fac), [qv, qc] = requetesFenetre("site", { du: D, au: D }, AUJ);
    return { ventes: [rVentes(qv.query, v, DS)], controle: [rControle(qc.query, totauxJour(v), DS)] };
  };
  const sS = traiterBoutique("site", jeuxS(D1, 0), ref, fen1);
  ok(memes(sS.lignes.map((l) => [l.mp, l.produit, l.qte, l.ca]), [[MP_SITE, nomB, 1, 200], [MP_SITE, nomA, 2, 300], [MP_SITE, "Produit XYZ inconnu", 1, 10]]), "pipeline : site web = ventes nettes (CA HT = net), ligne vide écartée");
  ok(r2(sS.stats.ca) === 510 && sS.stats.commandes === 3 && memes(sS.pays.map((p) => [p.pays, p.ca]), [["France", 210], ["Allemagne", 300]]), "pipeline : site : 510 €, 3 commandes, pays traduits");
  ok(sS.pays.reduce((t, p) => t + p.qte, 0) === sS.lignes.reduce((t, l) => t + l.qte, 0) && sS.pays.every((p) => Number.isFinite(p.qte)), "pipeline : site : la somme des quantités par pays égale celle des lignes");
  ok(sS.vendeurs.get("Produit XYZ inconnu")?.get("Thomson") === 1 && avertissementsDe(sS).some((a) => /absents de la table/.test(a) && /Produit XYZ inconnu/.test(a)), "pipeline : produit inconnu signalé, marque du fournisseur conservée");
  ok(sS.stats.sansPaiement === 0 && sS.stats.passerellesInconnues.size === 0, "pipeline : le site n'a pas de passerelle de paiement à résoudre");

  /* ================================================================= collecte : découpage des fenêtres, résultats lus */
  {
    const jeuxJour = (D) => ({ ventes: jeuxM(D, D === D1 ? 1000 : 2000).ventes, paiements: jeuxM(D, D === D1 ? 1000 : 2000).paiements, controle: jeuxM(D, D === D1 ? 1000 : 2000).controle });
    const seul = async (D) => collecterBoutique("marketplaces", { du: D, au: D }, { ref, numeros: LM001, aujourdhui: AUJ, jeux: async () => jeuxJour(D), decoupable: false, depuisPaires: D1 });
    const a1 = await seul(D1), a2 = await seul(D2);
    // fenêtre de deux jours « trop dense » : le relais coupe en deux et retrouve les mêmes agrégats
    const journal = [];
    const coupe = await collecterBoutique("marketplaces", { du: D1, au: D2 }, {
      ref, numeros: LM001, aujourdhui: AUJ, depuisPaires: D1, decoupable: true, log: (m) => journal.push(m),
      jeux: async (win) => { if (win.du !== win.au) throw new LimiteAtteinte("trop dense"); return jeuxJour(win.du); },
    });
    ok(memes(coupe.lignes, [...a1.lignes, ...a2.lignes]) && coupe.du === D1 && coupe.au === D2 && journal.some((m) => /coupée en deux/.test(m)), "collecte : fenêtre trop dense coupée en deux, mêmes agrégats");
    ok(await lanceAsync(() => collecterBoutique("marketplaces", { du: D1, au: D2 }, { ref, numeros: LM001, aujourdhui: AUJ, depuisPaires: D1, decoupable: false, jeux: async () => { throw new LimiteAtteinte("trop dense"); } })) instanceof LimiteAtteinte, "collecte : sans découpage possible, la limite de lignes remonte");
    // délai dépassé ou réponse trop volumineuse côté relais : même découpage ; une erreur sans rapport avec la taille remonte telle quelle
    ok(["Le relais signale : Shopify met trop de temps à répondre.", "Le relais signale : Shopify injoignable : The operation was aborted due to timeout", "HTTP en erreur : FUNCTION_INVOCATION_TIMEOUT", "HTTP en erreur : FUNCTION_PAYLOAD_TOO_LARGE"].every((m) => fenetreTropLourde(new ErreurRelais(m)))
      && ["Le relais refuse la clé (cle_invalide) : vérifier MCP_SITE_KEY.", "Boutique inattendue (x.myshopify.com)", "Relais injoignable après 3 essais (curl code 6)"].every((m) => !fenetreTropLourde(new ErreurRelais(m))) && fenetreTropLourde(new LimiteAtteinte("x")) && !fenetreTropLourde(new Echec("x")), "collecte : erreurs du relais qui justifient de couper la fenêtre (délai, taille) distinguées des autres");
    {
      const lourd = async (win) => { if (win.du !== win.au) throw new ErreurRelais("Le relais signale : Shopify met trop de temps à répondre."); return jeuxJour(win.du); };
      const coupe2 = await collecterBoutique("marketplaces", { du: D1, au: D2 }, { ref, numeros: LM001, aujourdhui: AUJ, depuisPaires: D1, decoupable: true, jeux: lourd });
      ok(memes(coupe2.lignes, [...a1.lignes, ...a2.lignes]), "collecte : délai dépassé sur une fenêtre de deux jours → coupée en deux, mêmes agrégats");
      const refus = await lanceAsync(() => collecterBoutique("marketplaces", { du: D1, au: D2 }, { ref, numeros: LM001, aujourdhui: AUJ, depuisPaires: D1, decoupable: true, jeux: async () => { throw new ErreurRelais("Le relais refuse la clé (cle_invalide) : vérifier MCP_SITE_KEY."); } }));
      ok(refus instanceof ErreurRelais && /cle_invalide/.test(refus.message), "collecte : une clé refusée n'est pas confondue avec une fenêtre trop lourde");
    }
    const uneJournee = await lanceAsync(() => collecterBoutique("marketplaces", { du: D1, au: D1 }, { ref, numeros: LM001, aujourdhui: AUJ, depuisPaires: D1, decoupable: true, jeux: async () => { throw new LimiteAtteinte("trop dense"); } }));
    ok(uneJournee instanceof Echec && /une seule journée/.test(uneJournee.message), "collecte : une seule journée trop lourde → échec explicite");
  }

  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), "selftest-ext-"));
  try {
    const ecrire = (nom, data) => { const fic = path.join(dossier, nom); fs.writeFileSync(fic, JSON.stringify(data)); return fic; };
    const toutM = (D, off) => { const j = jeuxM(D, off); return [...j.ventes, ...j.paiements, ...j.controle]; };
    const toutS = (D, off) => { const j = jeuxS(D, off); return [...j.ventes, ...j.controle]; };
    const wd1 = { du: D1, au: D1 };
    const reqM = requetesFenetre("marketplaces", wd1, AUJ).map((q) => q.query), reqS = requetesFenetre("site", wd1, AUJ).map((q) => q.query);

    // résultats relus dans des fichiers
    const fM = ecrire("m.json", toutM(D1, 1000)), fS = ecrire("s.json", toutS(D1, 0));
    const iM = lireResultats({ fichiers: [fM, fS] }, "marketplaces", reqM), iS = lireResultats({ fichiers: [fM, fS] }, "site", reqS);
    ok(reqM.every((q) => iM.trouver(q)) && reqS.every((q) => iS.trouver(q)) && jeuxDepuisIndex(iM, "marketplaces", wd1, AUJ).ventes.length === 1, "collecte : résultats relus par boutique et par texte de requête");
    const manque = lance(() => jeuxDepuisIndex(lireResultats({ fichiers: [ecrire("m_incomplet.json", [toutM(D1, 1000)[0]])] }, "marketplaces", reqM), "marketplaces", wd1, AUJ));
    ok(manque instanceof Echec && manque.code === 3 && /paiements/.test(manque.message), "collecte : résultats manquants → code 3, requêtes manquantes nommées");
    ok(lance(() => jeuxDepuisIndex(lireResultats({ fichiers: [ecrire("s_autre.json", toutS(D1, 0).map((r) => ({ ...r, shopDomain: DM })))] }, "site", reqS), "site", wd1, AUJ)) instanceof Echec, "collecte : résultats de l'autre boutique refusés pour le site");
    ok(lance(() => jeuxDepuisIndex(lireResultats({ fichiers: [ecrire("s_sans.json", toutS(D1, 0).map((r) => ({ ...r, shopDomain: undefined })))] }, "site", reqS), "site", wd1, AUJ)) instanceof Echec, "collecte : résultat du site sans boutique indiquée refusé");
    ok(lance(() => jeuxDepuisIndex(lireResultats({ fichiers: [ecrire("m_sans.json", toutM(D1, 1000).map((r) => ({ ...r, shopDomain: undefined })))] }, "marketplaces", reqM), "marketplaces", wd1, AUJ)) === null, "collecte : résultat du connecteur sans domaine accepté pour BESTHERM");
    ok(lance(() => jeuxDepuisIndex(lireResultats({ fichiers: [ecrire("m_autre.json", toutM(D1, 1000).map((r) => ({ ...r, shopDomain: DS })))] }, "marketplaces", reqM), "marketplaces", wd1, AUJ)) instanceof Echec, "collecte : résultats du site refusés pour BESTHERM");

    // transcription de la session (connecteur Shopify) : résultats relus tels quels
    const jsonl = toutM(D1, 1000).map((r) => JSON.stringify({ message: { content: [{ type: "tool_result", content: [{ type: "text", text: JSON.stringify(r) }] }] } })).join("\n") + "\nligne illisible\n";
    const fT = path.join(dossier, "session.jsonl"); fs.writeFileSync(fT, jsonl);
    ok(reqM.every((q) => lireResultats({ transcripts: [fT] }, "marketplaces", reqM).trouver(q)), "collecte : résultats du connecteur relus dans la transcription de la session");

    // numéros d'origine (classification Technomat) : pages GraphQL relues dans la transcription, les résultats ShopifyQL du même fichier n'interfèrent pas
    {
      const page = (noms) => JSON.stringify({ data: { orders: { edges: noms.map(([n, v]) => ({ node: { name: n, customAttributes: [{ key: "Latest Ship Date", value: "2026-10-29" }, { key: "leroymerlin Number", value: v }] } })), pageInfo: { hasNextPage: false, endCursor: "x" } } } });
      const ligneJsonl = (texte) => JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t", content: [{ type: "text", text: texte }] }] } });
      const fTr = path.join(dossier, "session_ordres.jsonl");
      fs.writeFileSync(fTr, [
        JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id: "t", name: "graphql_query", input: { query: GQL.commandesLm("2026-10-26", "2026-10-26") } }] } }),
        ligneJsonl(page([["SHOP1", "001-26299L1-A"], ["SHOP2", "014-164922-A"]])),
        ligneJsonl(JSON.stringify({ query: REQ.controle("2026-10-26", "2026-10-26"), columns: [{ name: "day" }], rows: [["2026-10-26"]] })),
        ligneJsonl(page([["SHOP3", "002-26299L2-A"], ["SHOP4", ""]])),
        "ligne illisible customAttributes tool_result",
      ].join("\n"));
      const lus = lireNumeros({ transcripts: [fTr] });
      ok(lus.size === 4 && lus.get("SHOP1") === "001-26299L1-A" && lus.get("SHOP2") === "014-164922-A" && lus.get("SHOP3") === "002-26299L2-A" && lus.get("SHOP4") === "", "Technomat : numéros d'origine relus dans la transcription (pages 1 et 2, commande sans numéro = chaîne vide)");
      ok(lireNumeros({ transcripts: [path.join(dossier, "absent.jsonl")] }).size === 0, "Technomat : transcription absente → aucun numéro (la classification échouera ensuite)");
      const fObj = ecrire("ordres_obj.json", { SHOP9: " 014-5-A " }), fPages = ecrire("ordres_pages.json", [JSON.parse(page([["SHOP8", "001-1-A"]]))]);
      const viaFichiers = lireNumeros({ fichiers: [fObj, fPages], transcripts: [fTr] });
      ok(viaFichiers.size === 2 && viaFichiers.get("SHOP9") === "014-5-A" && viaFichiers.get("SHOP8") === "001-1-A", "Technomat : --ordres-lm (objet nom → numéro ou pages GraphQL) prime sur la transcription");
      ok(lance(() => lireNumeros({ fichiers: [path.join(dossier, "absent.json")] })) instanceof Echec, "Technomat : fichier --ordres-lm illisible → refus");
    }

    // relais : état sans clé, et résultats déjà en cache (aucun appel réseau)
    const cleEnv = process.env.MCP_SITE_KEY;
    delete process.env.MCP_SITE_KEY;
    try {
      const e = await etatRelais("marketplaces");
      ok(e.ok === false && e.absent === true && /MCP_SITE_KEY/.test(e.raison), "collecte : relais sans clé → indisponible, repli possible");
      const cache = path.join(dossier, "cache"); fs.mkdirSync(cache);
      for (const r of [...jeuxS(D1, 0).ventes, ...jeuxS(D1, 0).controle]) fs.writeFileSync(path.join(cache, `${crypto.createHash("sha1").update(`${DS}\u0000${r.query}`).digest("hex")}.json`), JSON.stringify(r));
      const jr = await jeuxRelais("site", wd1, AUJ, { cache });
      ok(jr.ventes.length === 1 && jr.controle.length === 1 && jr.paiements.length === 0 && jr.ventes[0].rows.length === 4, "collecte : résultats du relais relus dans le cache sans appel réseau");
    } finally { if (cleEnv !== undefined) process.env.MCP_SITE_KEY = cleEnv; }

    /* ================================================================= fusion avec l'extraction précédente */
    const bloc = (id, s, du = s.du, au = s.au) => ({ ...s, du, au });
    const aM1 = agreger([sM]), aS1 = agreger([sS]);
    const e0 = fusionner(null, { marketplaces: bloc("marketplaces", aM1) }, AUJ);
    ok(validerExtension(e0).ok && e0.schema === SCHEMA && e0.du === D1 && e0.au === D1 && e0.boutiques.marketplaces.au === D1 && !e0.boutiques.site, "fusion : première extraction (une boutique) valide");
    const e1 = fusionner(e0, { site: bloc("site", aS1) }, AUJ);
    ok(validerExtension(e1).ok && e1.lignes.length === aM1.lignes.length + aS1.lignes.length && e1.boutiques.site.au === D1 && e1.boutiques.marketplaces.au === D1, "fusion : le site s'ajoute sans toucher aux marketplaces");
    ok(JSON.stringify(e1.mp) === JSON.stringify([...e1.mp].sort()) && e1.mp.includes(MP_SITE) && e1.produits.some(([n, m]) => n === "Produit XYZ inconnu" && m === "Thomson") && e1.produits.some(([n, m]) => n === nomA && m === "Bestherm"), "fusion : dictionnaires triés, marque du fournisseur conservée par produit");
    ok(e1.base && e1.base.marketplaces && e1.base.site && e1.extrait_le === AUJ && /^\d{4}-\d{2}-\d{2}T/.test(e1.extrait_a) && /^\d{4}-\d{2}-\d{2}T/.test(e1.boutiques.site.extrait_a), "fusion : bases de calcul et dates d'extraction renseignées");
    // le lendemain, seules les marketplaces avancent : couverture = plus ancien des deux « au »
    const aM2 = agreger([traiter("marketplaces", jeuxM(D2, 2000), ref, { du: D2, au: D2, depuisPaires: D1 })]);
    const e2 = fusionner(e1, { marketplaces: bloc("marketplaces", aM2) }, AUJ);
    ok(e2.boutiques.marketplaces.au === D2 && e2.boutiques.site.au === D1 && e2.au === D1 && auExtension(e2) === D1 && validerExtension(e2).ok, "fusion : couverture = plus ancien des « au » quand une boutique n'avance pas");
    ok(e2.lignes.length === e1.lignes.length + aM2.lignes.length, "fusion : les jours déjà extraits sont conservés");
    // jour réextrait : remplacé, jamais doublé ; l'autre boutique n'est pas touchée
    const aM1bis = agreger([traiter("marketplaces", jeuxM(D1, 1000, 2), ref, fen1)]);
    const e3 = fusionner(e2, { marketplaces: bloc("marketplaces", aM1bis) }, AUJ);
    const caJour = (e, j, site) => r2(e.lignes.filter((l) => l[0] === j && (e.mp[l[1]] === MP_SITE) === site).reduce((t, l) => t + l[4], 0));
    ok(caJour(e3, D1, false) === 388 && caJour(e3, D2, false) === 194 && caJour(e3, D1, true) === 510 && e3.lignes.length === e2.lignes.length, "fusion : jour réextrait remplacé (pas de doublon), les autres jours et l'autre boutique inchangés");
    // décodage / réencodage identiques
    const dec = decoder(e3);
    ok(dec.lignes.length === e3.lignes.length && dec.commandes.length === e3.commandes.length && dec.pays.length === e3.pays_jour.length && dec.marques.get(nomA) === "Bestherm", "fusion : décodage de l'extraction (dictionnaires → valeurs)");
    ok(e3.pays_jour.length > 0 && e3.pays_jour.every((r) => r.length === 5 && Number.isFinite(r[4])) && dec.pays.every((p) => Number.isFinite(p.qte)) && JSON.stringify(fusionner(e3, {}, AUJ).pays_jour) === JSON.stringify(e3.pays_jour), "fusion : la quantité par pays (5e champ de pays_jour) traverse la fusion, le décodage et le réencodage à l'identique");
    ok(JSON.stringify(fusionner(e3, {}, AUJ).lignes) === JSON.stringify(e3.lignes) && JSON.stringify(fusionner(e3, {}, AUJ).produits) === JSON.stringify(e3.produits), "fusion : sans nouvelle boutique, les lignes sont reconduites à l'identique");
    // conservation : pays et commandes depuis AN-1, paires depuis AN ; lignes quotidiennes de toutes les années
    {
      const vieux = (id, d) => ({ id, du: d, au: d, lignes: [{ d, mp: MP_SITE, produit: nomA, qte: 1, ca: 10 }], pays: [{ d, pays: "France", mp: MP_SITE, ca: 10 }], commandes: [{ d, mp: MP_SITE, n: 1 }], paires: [{ d, a: nomA, b: nomB, n: 1 }], vendeurs: new Map(), stats: {} });
      const e = fusionner(null, { site: vieux("site", "2024-03-01") }, AUJ);
      ok(e.lignes.length === 1 && e.pays_jour.length === 0 && e.commandes.length === 0 && e.paires.length === 0, "fusion : détail pays, commandes et paires antérieurs à l'année précédente écartés, lignes quotidiennes conservées");
      const e25 = fusionner(null, { site: vieux("site", "2025-03-01") }, AUJ), e26 = fusionner(null, { site: vieux("site", "2026-03-01") }, AUJ);
      ok(e25.pays_jour.length === 1 && e25.commandes.length === 1 && e25.paires.length === 0 && e26.paires.length === 1, "fusion : pays et commandes gardés depuis l'année précédente, paires seulement pour l'année en cours");
      ok(e25.pays_jour[0].length === 4 && validerExtension(e25).ok && e25.pays_jour[0][3] === 10, "fusion : un jour de pays sans quantité (extraction antérieure) est reconduit tel quel à 4 champs, extraction toujours valide");
    }
    // sérialisation : relue à l'identique, une enregistrement par ligne
    const texte = serialiser(e3);
    ok(JSON.stringify(JSON.parse(texte)) === JSON.stringify(e3) && texte.split("\n").length > e3.lignes.length && texte.endsWith("}\n") && texte.indexOf('"schema"') < texte.indexOf('"lignes"'), "fusion : sérialisation (une ligne par enregistrement) relue à l'identique");
    ok(/Période/.test(resume(e3)) && /Par marketplace/.test(resume(e3)) && /Boutiques/.test(resume(e3)), "fusion : compte rendu de l'extraction");
    {
      // Technomat : la marketplace entre dans les dictionnaires de l'extraction, qui reste valide et construit le tableau de bord
      const bT = agreger([traiterBoutique("marketplaces", jeuxM(D1, 1000), ref, { ...fen1, numeros: new Map([["#1001", "014-120208-A"]]) })]);
      const eT = fusionner(fusionner(null, { marketplaces: bloc("marketplaces", bT) }, AUJ), { site: bloc("site", aS1) }, AUJ);
      ok(validerExtension(eT).ok && eT.mp.includes(TECHNOMAT.mp) && !eT.mp.includes("Leroy Merlin") && eT.lignes.length === aM1.lignes.length + aS1.lignes.length, "Technomat : l'extraction fusionnée contient la marketplace Technomat et reste valide");
      const rT = construire(eT, ref, {});
      ok(rT.appliquee && r2(rT.ca) === 194 + 510 && rT.dmax === D1, `Technomat : le tableau de bord se construit, CA total inchangé (${rT.ca} au lieu de ${194 + 510})`);
    }

    /* ---- contrôle avec l'extraction précédente */
    {
      const avert = [];
      ok(lance(() => comparerAuPrecedent(e3, e3, false, avert)) === null && avert.length === 0, "précédent : extraction identique acceptée");
      const gonfle = JSON.parse(JSON.stringify(e3)); gonfle.lignes = gonfle.lignes.map((l) => [l[0], l[1], l[2], l[3], l[4] * 1.4]);
      ok(lance(() => comparerAuPrecedent(gonfle, e3, false, [])) instanceof Echec, "précédent : jours communs variant de plus de 15 % refusés");
      const a2 = []; ok(lance(() => comparerAuPrecedent(gonfle, e3, true, a2)) === null && a2.length > 0, "précédent : --force passe outre, les jours en écart sont signalés");
      const recule = JSON.parse(JSON.stringify(e3)); recule.boutiques.marketplaces.au = "2026-10-01"; recule.boutiques.site.au = "2026-10-01"; recule.au = "2026-10-01";
      ok(lance(() => comparerAuPrecedent(recule, e3, false, [])) instanceof Echec && lance(() => comparerAuPrecedent(recule, e3, true, [])) === null, "précédent : régression de la couverture refusée (sauf --force)");
      ok(lance(() => comparerAuPrecedent(e3, { schema: 1, lignes: [] }, false, [])) === null && lance(() => comparerAuPrecedent(e3, null, false, [])) === null, "précédent : ancien format ou absence ignorés");
    }

    /* ---- l'extraction produite construit un tableau de bord cohérent */
    {
      // marketplaces jusqu'au D2, site jusqu'au D1 : le tableau de bord s'arrête au D1 et signale les lignes de D2 laissées de côté
      const r = construire(e3, ref, {});
      ok(r.appliquee && r.dmax === D1 && r2(r.ca) === 388 + 510 && r.avertissements.some((x) => /hors de la période/.test(x)), "tableau de bord : arrêté au dernier jour couvert par les deux boutiques");
    }

    /* ================================================================= ligne de commande de bout en bout (dossier temporaire) */
    const racine = path.join(dossier, "depot");
    fs.mkdirSync(path.join(racine, "data"), { recursive: true });
    for (const n of ["referentiel.json", "hors_shopify.json"]) fs.copyFileSync(path.join(path.dirname(SCRIPT), "..", "..", "data", n), path.join(racine, "data", n));
    const env = { ...process.env, HOMY_RACINE: racine, MCP_SITE_KEY: "", MCP_SITE_URL: "" };
    const cli = (...a) => { const r = spawnSync(process.execPath, [SCRIPT, ...a], { env, encoding: "utf8", timeout: 120000 }); return { code: r.status, out: r.stdout ?? "", err: r.stderr ?? "" }; };
    const fichierExt = path.join(racine, "shopify_extension.json");
    const fen = ["--today", AUJ, "--du", D1, "--au", D2];

    const c0 = cli("check", "--today", AUJ);
    ok(c0.code === 0 && /extraction actuelle : vide/.test(c0.out) && /relais marketplaces indisponible/.test(c0.out) && /relais site indisponible/.test(c0.out), `cli : check sans extraction ni clé de relais (code ${c0.code})`);
    const pl = cli("plan", ...fen);
    let plans = []; try { plans = JSON.parse(pl.out); } catch { /* vérifié plus bas */ }
    ok(pl.code === 0 && plans.length === 2 && plans[0].boutique === "marketplaces" && plans[0].queries.length === 3 && plans[1].boutique === "site" && plans[1].queries.length === 2
      && plans.every((p) => p.du === D1 && p.au === D2 && p.vide === false && p.today === AUJ), "cli : plan (JSON : une entrée par boutique, requêtes à lancer)");
    ok(cli("plan", ...fen, "--boutique", "site").out.includes('"boutique": "site"') && JSON.parse(cli("plan", ...fen, "--boutique", "site").out).length === 1, "cli : plan d'une seule boutique");

    // classification Technomat : le plan de BESTHERM porte la requête GraphQL des numéros d'origine, pas celui du site
    ok(plans[0].classification?.outil === "graphql_query" && plans[0].classification.graphql === GQL.commandesLm(D1, D2) && plans[1].classification === undefined, "cli : plan des marketplaces = requêtes ShopifyQL + requête GraphQL de classification Technomat");
    // numéros d'origine des commandes Leroy Merlin des jeux de test (#1001, #2001, #3001) : France (001) ; fichier lu par --ordres-lm
    const fNum = ecrire("ordres_lm.json", { "#1001": "001-26001L1-A", "#2001": "001-26001L2-A", "#3001": "001-26001L3-A" });
    const fVide = path.join(dossier, "transcription_vide.jsonl"); fs.writeFileSync(fVide, "");
    // résultats : ceux que le connecteur renverrait pour les requêtes du plan (2 jours dans une fenêtre)
    const ventesM = [...jourM(D1, 1000).ventes, ...jourM(D2, 2000).ventes], paiM = [...jourM(D1, 1000).paiements, ...jourM(D2, 2000).paiements];
    const ventesS = [...jourS(D1, 0), ...jourS(D2, 10)];
    const reponses = (ps, { sansSite = false } = {}) => ps.flatMap((p) => p.queries.map((q) => {
      const dom = p.boutique === "site" ? DS : DM;
      if (p.boutique === "site" && sansSite) return null;
      if (q.id.startsWith("ventes")) return rVentes(q.query, p.boutique === "site" ? ventesS : ventesM, dom);
      if (q.id.startsWith("paiements")) return rPaiements(q.query, paiM, dom);
      return rControle(q.query, totauxJour(p.boutique === "site" ? ventesS : ventesM), dom);
    })).filter(Boolean);
    const fRes = ecrire("resultats.json", reponses(plans));

    const essai = cli("apply", ...fen, "--results", fRes, "--ordres-lm", fNum, "--dry-run");
    ok(essai.code === 0 && /Essai à blanc/.test(essai.out) && !fs.existsSync(fichierExt), `cli : --dry-run n'écrit rien (code ${essai.code})`);
    const ap = cli("apply", ...fen, "--results", fRes, "--ordres-lm", fNum);
    ok(ap.code === 0 && fs.existsSync(fichierExt) && /mis à jour/.test(ap.out), `cli : apply écrit shopify_extension.json (code ${ap.code}) ${ap.err.slice(0, 200)}`);
    let ext1 = null; try { ext1 = JSON.parse(fs.readFileSync(fichierExt, "utf8")); } catch { /* vérifié plus bas */ }
    const rExt = ext1 && construire(ext1, ref, {});
    ok(ext1 && validerExtension(ext1).ok && ext1.au === D2 && ext1.boutiques.marketplaces.au === D2 && ext1.boutiques.site.au === D2, "cli : fichier produit valide, couvert jusqu'au dernier jour demandé par les deux boutiques");
    ok(rExt?.appliquee && r2(rExt.ca) === 2 * (194 + 510) && rExt.dmax === D2, `cli : le tableau de bord se construit sur ce fichier (CA ${rExt?.ca} au lieu de ${2 * (194 + 510)})`);
    const st = cli("status");
    ok(st.code === 0 && /Période\s+: 2026-10-04 → 2026-10-05/.test(st.out) && /Site Web/.test(st.out), "cli : status résume l'extraction");
    const c1 = cli("check", "--today", AUJ);
    ok(c1.code === 0 && /le tableau de bord se construit/.test(c1.out) && /extraction actuelle : jusqu'au 2026-10-05/.test(c1.out), "cli : check relit l'extraction et reconstruit le tableau de bord");

    // idempotence : le même jour réextrait redonne les mêmes données (seuls les horodatages changent)
    const sansHorodatage = (e) => JSON.stringify({ ...e, extrait_a: null, boutiques: Object.fromEntries(Object.entries(e.boutiques).map(([k, b]) => [k, { ...b, extrait_a: null }])) });
    const ap2 = cli("apply", ...fen, "--results", fRes, "--ordres-lm", fNum);
    ok(ap2.code === 0 && sansHorodatage(JSON.parse(fs.readFileSync(fichierExt, "utf8"))) === sansHorodatage(ext1), "cli : réextraction des mêmes jours = mêmes données (pas de doublon)");

    // chaque boutique est indépendante : sans résultats du site, les marketplaces avancent et le site garde ses chiffres de la veille
    const D3 = "2026-10-06", AUJ3 = "2026-10-07";
    const plans3 = JSON.parse(cli("plan", "--today", AUJ3, "--du", D3, "--au", D3).out);
    const ventesM3 = jourM(D3, 3000).ventes, paiM3 = jourM(D3, 3000).paiements;
    const rep3 = plans3.filter((p) => p.boutique === "marketplaces").flatMap((p) => p.queries.map((q) => (q.id.startsWith("ventes") ? rVentes(q.query, ventesM3, DM) : q.id.startsWith("paiements") ? rPaiements(q.query, paiM3, DM) : rControle(q.query, totauxJour(ventesM3), DM))));
    const ap3 = cli("apply", "--today", AUJ3, "--du", D3, "--au", D3, "--results", ecrire("resultats3.json", rep3), "--ordres-lm", fNum);
    const ext3 = JSON.parse(fs.readFileSync(fichierExt, "utf8"));
    ok(ap3.code === 0 && ext3.boutiques.marketplaces.au === D3 && ext3.boutiques.site.au === D2 && ext3.au === D2 && /Boutique\(s\) en échec/.test(ap3.err), `cli : une boutique en échec n'empêche pas l'autre ; chiffres de la veille conservés (code ${ap3.code})`);

    // refus : première extraction incomplète, résultats manquants, mauvaise boutique, option inconnue
    const racine2 = path.join(dossier, "depot2"); fs.cpSync(racine, racine2, { recursive: true }); fs.rmSync(path.join(racine2, "shopify_extension.json"));
    const cli2 = (...a) => { const r = spawnSync(process.execPath, [SCRIPT, ...a], { env: { ...env, HOMY_RACINE: racine2 }, encoding: "utf8", timeout: 120000 }); return { code: r.status, out: r.stdout ?? "", err: r.stderr ?? "" }; };
    const partiel = cli2("apply", ...fen, "--results", ecrire("resultats_partiels.json", reponses(plans, { sansSite: true })), "--ordres-lm", fNum);
    ok(partiel.code === 3 && !fs.existsSync(path.join(racine2, "shopify_extension.json")) && /sans extraction antérieure/.test(partiel.err), `cli : première extraction incomplète refusée, rien n'est écrit (code ${partiel.code})`);
    const faux = cli2("apply", ...fen, "--results", ecrire("resultats_faux.json", reponses(plans).map((r) => ({ ...r, rows: r.rows.map((row) => (row.length > 8 ? row.map((v, i) => (i === 8 ? v + 5 : v)) : row)) }))), "--ordres-lm", fNum);
    ok(faux.code === 3 && !fs.existsSync(path.join(racine2, "shopify_extension.json")) && /total du jour Shopify/.test(faux.err), `cli : lignes ≠ totaux du jour de Shopify → rien n'est écrit (code ${faux.code})`);
    const inconnue = cli2("apply", "--bidon");
    ok(inconnue.code === 1 && /Option inconnue/.test(inconnue.err), "cli : option inconnue → code 1");
    ok(cli2("apply", "--today", "demain").code === 1 && cli2("plan", "--reprendre", "99").code === 1 && cli2("plan", "--boutique", "autre").code === 1 && cli2("bidon").code === 1, "cli : arguments invalides → code 1");
    ok(cli2("status").code === 0 && /vide/.test(cli2("status").out), "cli : status sans extraction");
    const sansResultats = cli2("apply", ...fen, "--results", ecrire("vide.json", []), "--ordres-lm", fNum);
    ok(sansResultats.code === 3 && /manquants/.test(sansResultats.err), `cli : résultats absents → code 3 (code ${sansResultats.code})`);
    fs.writeFileSync(path.join(racine2, "shopify_extension.json"), JSON.stringify({ schema: 1, lignes: [] }));
    ok(/ancien format/.test(cli2("status").out) && /ancien format/.test(cli2("check", "--today", AUJ).out), "cli : extraction à l'ancien format signalée (historique complet à extraire)");

    // Technomat de bout en bout : sans numéros d'origine → refus (code 3, rien d'écrit) ; avec des numéros 014 → marketplace Technomat, CA total inchangé
    const racine3 = path.join(dossier, "depot3"); fs.cpSync(racine, racine3, { recursive: true }); fs.rmSync(path.join(racine3, "shopify_extension.json"));
    const cli3 = (...a) => { const r = spawnSync(process.execPath, [SCRIPT, ...a], { env: { ...env, HOMY_RACINE: racine3 }, encoding: "utf8", timeout: 120000 }); return { code: r.status, out: r.stdout ?? "", err: r.stderr ?? "" }; };
    const sansNum = cli3("apply", ...fen, "--results", fRes, "--transcript", fVide);
    ok(sansNum.code === 3 && !fs.existsSync(path.join(racine3, "shopify_extension.json")) && /classification Technomat incomplète/.test(sansNum.err) && /#1001/.test(sansNum.err) && /Aucune écriture/.test(sansNum.err),
      `cli : numéros d'origine non lus → refus (code ${sansNum.code}), commandes citées, rien n'est écrit`);
    const fNum014 = ecrire("ordres_lm_014.json", { "#1001": "014-120208-A", "#2001": "014-120209-A" });
    const avec014 = cli3("apply", ...fen, "--results", fRes, "--ordres-lm", fNum014);
    let ext014 = null; try { ext014 = JSON.parse(fs.readFileSync(path.join(racine3, "shopify_extension.json"), "utf8")); } catch { /* vérifié plus bas */ }
    ok(avec014.code === 0 && /dont Technomat/.test(avec014.out) && ext014 && validerExtension(ext014).ok && ext014.mp.includes(TECHNOMAT.mp) && !ext014.mp.includes("Leroy Merlin"),
      `cli : numéros 014 → marketplace Technomat dans le fichier produit (code ${avec014.code}) ${avec014.err.slice(0, 200)}`);
    const caMp = (e, nom) => r2(e.lignes.filter((l) => e.mp[l[1]] === nom).reduce((s, l) => s + l[4], 0));
    ok(ext014 && caMp(ext014, TECHNOMAT.mp) === 2 * 150 && r2(ext014.lignes.reduce((s, l) => s + l[4], 0)) === 2 * (194 + 510), "cli : Technomat = 2 commandes 014 (300 € HT), total (marketplaces + site) inchangé");
  } finally { fs.rmSync(dossier, { recursive: true, force: true }); }
}
