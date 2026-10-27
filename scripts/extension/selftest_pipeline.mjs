/**
 * Contrôles de la chaîne d'extraction (refresh_extension.mjs) sur des résultats ShopifyQL SYNTHÉTIQUES : fenêtre de dates,
 * passerelles → marketplaces, CA HT, pays, références, contrôles de cohérence, indépendance des deux boutiques, fusion
 * avec l'extraction précédente. Aucun réseau, aucune boutique. Appelé par selftest.mjs.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { validerExtension } from "../../extension.js";
import {
  BOUTIQUES, REQ, GQL, TECHNOMAT, Echec, lireApp, planifier, fenetre, collecter, construireBoutique, fusionner, serialiser, normaliserSku, marketplaceDe,
  minuitParis, minuitParisUtc, estTechnomat, prefixeNumero, numeroOrigine, collecterNumeros, messageSansNumero,
} from "./refresh_extension.mjs";

const r2 = (x) => Math.round(x * 100) / 100;
const col = (...noms) => noms.map((name) => ({ name }));

export async function testerPipeline(ok) {
  const reel = lireApp();
  const app = { ...reel, dmaxOdp: "2026-10-03", precedent: null };
  const DM = BOUTIQUES.marketplaces.domaine, DS = BOUTIQUES.site.domaine;

  /* ---- correspondances */
  ok(normaliserSku("HT10-24JE_never_used") === "HT10-24JE" && normaliserSku(" AB/CD-FLM ") === "AB-CD", "pipeline : normalisation des références");
  ok(marketplaceDe("leroymerlin via Shopping Feed") === "Leroy Merlin" && marketplaceDe("Amazon FBA") === "Amazon FR" && marketplaceDe("epmm") === "ManoMano"
    && marketplaceDe("clogistique") === "Cdiscount" && marketplaceDe("carrefourx") === null && marketplaceDe(undefined) === null, "pipeline : passerelles → marketplaces");

  /* ---- fenêtre de dates */
  const f0 = fenetre(app, "2026-10-06", {}, "site");
  ok(f0.du === "2026-10-04" && f0.au === "2026-10-05" && !f0.vide, `pipeline : fenêtre sans extraction (${f0.du} → ${f0.au})`);
  const prec = { boutiques: { site: { au: "2026-10-10" }, marketplaces: { au: "2026-10-08" } } };
  const appPrec = { ...app, precedent: prec };
  ok(fenetre(appPrec, "2026-10-12", {}, "site").du === "2026-10-11" && fenetre(appPrec, "2026-10-12", {}, "marketplaces").du === "2026-10-09", "pipeline : chaque boutique reprend au lendemain de sa propre couverture");
  ok(fenetre(appPrec, "2026-10-12", { reprendre: 1 }, "site").du === "2026-10-10", "pipeline : --reprendre 1 réextrait le dernier jour");
  ok(fenetre(appPrec, "2026-10-11", {}, "site").vide === true, "pipeline : fenêtre vide quand la boutique est à jour");
  ok(fenetre({ ...app, precedent: { boutiques: { site: { au: "2026-09-30" } } } }, "2026-10-06", {}, "site").du === "2026-10-04", "pipeline : une couverture antérieure à l'ODP est ignorée");
  const planM = planifier(app, "2026-10-05", {}, "marketplaces"), planS = planifier(app, "2026-10-05", {}, "site");
  ok(planM.queries.length === 3 && planS.queries.length === 2 && planM.queries[2].id === "controle", "pipeline : requêtes du plan (ventes + paiements + contrôle ; ventes + contrôle)");

  /* ---- jeux de données synthétiques */
  const noms = new Map();
  for (const [code, nom] of reel.codes) if (!noms.has(nom) && /^[A-Z0-9-]+$/.test(code)) noms.set(nom, code);
  const [[nomA, skuA], [nomB, skuB]] = [...noms];
  const D = "2026-10-04";
  const ventesM = { query: REQ.ventes(D), shopDomain: DM, columns: col("order_name", "product_variant_sku", "shipping_country", "product_vendor", "quantity_ordered", "net_sales", "taxes"), rows: [
    ["#1001", skuA, "France", "Bestherm", 2, 100, 20], ["#1002", skuB, "Belgium", "Bestherm", 1, 50, 10],
    ["#1003", skuA, "Spain", "Bestherm", 1, 60, 12], ["#1004", skuA, "France", "Bestherm", 1, 0, 0],
  ] };
  const paiementsM = { query: REQ.paiements(D), shopDomain: DM, columns: col("order_name", "payment_gateway", "gross_payments"), rows: [
    ["#1001", "leroymerlin via Shopping Feed", 120], ["#1002", "amazon", 60], ["#1003", "carrefourx", 72],
  ] };
  const ctrlM = { query: REQ.controle(D, D), shopDomain: DM, columns: col("day", "orders", "quantity_ordered", "net_sales"), rows: [[D, 4, 5, 210]] };
  const ventesS = { query: REQ.ventesSite(D), shopDomain: DS, columns: col("order_name", "product_variant_sku", "shipping_country", "product_vendor", "quantity_ordered", "gross_sales"), rows: [
    ["#S1", skuB, "France", "Bestherm", 1, 200], ["#S2", skuA, "Germany", "Bestherm", 2, 300], ["#S3", skuA, "France", "Bestherm", 0, 0],
  ] };
  const ctrlS = { query: REQ.controleSite(D, D), shopDomain: DS, columns: col("day", "orders", "quantity_ordered", "gross_sales"), rows: [[D, 2, 3, 500]] };
  const carte = (...rs) => new Map(rs.map((r) => [r.query, r]));
  const planM1 = planifier(app, "2026-10-05", { du: D }, "marketplaces"), planS1 = planifier(app, "2026-10-05", { du: D }, "site");

  // numéros d'origine des commandes Leroy Merlin (lus par la requête GraphQL « classification ») : #1001 = Leroy Merlin France
  const numeros = new Map([["#1001", "001-26299L112-A"]]);

  /* ---- Technomat : règle du numéro d'origine */
  ok(estTechnomat("014-120208-A") && estTechnomat(" 014-1-A ") && estTechnomat("014") && !estTechnomat("001-26299L112-A") && !estTechnomat("0140-1")
    && !estTechnomat("1014-1") && !estTechnomat("") && !estTechnomat(undefined) && !estTechnomat(null) && !estTechnomat("TEST-6"), "Technomat : seuls les numéros d'origine commençant par 014 (pas 0140…)");
  ok(prefixeNumero("002-26299L1-A") === "002" && prefixeNumero("TEST-6") === null && prefixeNumero("0140-1") === null && prefixeNumero(undefined) === null, "Technomat : préfixe d'un numéro d'origine");
  ok(numeroOrigine([{ key: "Latest Ship Date", value: "x" }, { key: "leroymerlin Number", value: " 014-1-A " }]) === "014-1-A" && numeroOrigine([]) === "" && numeroOrigine(null) === "", "Technomat : numéro d'origine lu dans les attributs de commande");
  ok(minuitParis("2026-10-24") === "2026-10-24T00:00:00+02:00" && minuitParis("2026-10-25") === "2026-10-25T00:00:00+02:00" && minuitParis("2026-10-26") === "2026-10-26T00:00:00+01:00"
    && minuitParis("2026-03-29") === "2026-03-29T00:00:00+01:00" && minuitParis("2026-03-30") === "2026-03-30T00:00:00+02:00", "Technomat : minuit de Paris avec le bon décalage (changements d'heure du 29 mars et du 25 octobre)");
  const planC = planifier(app, "2026-10-27", { du: "2026-10-25", au: "2026-10-26" }, "marketplaces");
  ok(planC.classification?.graphql === GQL.commandesLm("2026-10-25", "2026-10-26") && planC.classification.first === 50 && planC.classification.outil === "graphql_query"
    && planC.classification.graphql.includes("gateway:'leroymerlin via Shopping Feed'") && planC.classification.graphql.includes("created_at:>='2026-10-24T22:00:00Z'")
    && planC.classification.graphql.includes("created_at:<'2026-10-26T23:00:00Z'") && planC.classification.graphql.includes("customAttributes{ key value }")
    && !/email|phone|address|customer/i.test(planC.classification.graphql), "Technomat : le plan contient la requête GraphQL de classification (fenêtre de minuit à minuit, bornes en UTC entre apostrophes, sans donnée client)");
  ok(minuitParisUtc("2026-10-26") === "2026-10-25T23:00:00Z" && minuitParisUtc("2026-10-25") === "2026-10-24T22:00:00Z" && minuitParisUtc("2026-03-29") === "2026-03-28T23:00:00Z"
    && minuitParisUtc("2026-03-30") === "2026-03-29T22:00:00Z" && minuitParisUtc("2026-07-14") === "2026-07-13T22:00:00Z", "Technomat : minuit de Paris en UTC (changements d'heure du 29 mars et du 25 octobre)");
  // Shopify interprète de travers les dates SANS apostrophes (« created_at:<…+01:00 » ignoré, « created_at:>=…Z » ramené au jour entier) :
  // chaque borne doit être une date-heure UTC exacte ENTRE APOSTROPHES, et il ne doit y en avoir que deux.
  const gq = planC.classification.graphql;
  const sansBornes = gq.replace(/created_at:(?:>=|<)'\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ'/g, "");
  ok((gq.match(/created_at:/g) ?? []).length === 2 && !sansBornes.includes("created_at:"),
    "Technomat : les deux bornes de la requête sont en UTC (…Z) entre apostrophes (jamais sans apostrophes, ni avec un décalage « +01:00 », ni une date seule)");
  ok(planifier(app, "2026-10-05", {}, "site").classification === undefined, "Technomat : pas de classification pour la boutique du site");

  /* ---- boutique des marketplaces */
  const avM = [];
  const bM = construireBoutique(app, planM1, carte(ventesM, paiementsM, ctrlM), "marketplaces", avM, numeros);
  const trouve = (b, mp, pays) => b.lignes.find((l) => l.mp === mp && l.pays === pays);
  const lm = trouve(bM, "Leroy Merlin", "France"), az = trouve(bM, "Amazon FR", "Belgique"), au = trouve(bM, "Autre", "Espagne"), zero = trouve(bM, "Autre", "France");
  ok(lm && lm.qte === 2 && r2(lm.ca) === 100 && lm.produit === nomA && lm.nl === 1, "pipeline : commande Leroy Merlin (CA HT = (net + taxes) ÷ 1,2)");
  ok(az && az.qte === 1 && r2(az.ca) === 50 && az.produit === nomB, "pipeline : commande Amazon, pays traduit (Belgium → Belgique)");
  ok(au && r2(au.ca) === 60, "pipeline : passerelle inconnue classée « Autre »");
  ok(zero && zero.qte === 1 && zero.ca === 0, "pipeline : commande à 0 € sans paiement classée « Autre »");
  ok(r2(bM.lignes.reduce((s, l) => s + l.ca, 0)) === 210 && bM.lignes.reduce((s, l) => s + l.qte, 0) === 5, "pipeline : total des lignes = total du jour");
  ok(avM.some((a) => /Passerelles de paiement inconnues/.test(a) && /carrefourx/.test(a)), "pipeline : avertissement sur la passerelle inconnue");

  // contrôles qui refusent d'écrire
  const lance = (fn) => { try { fn(); return null; } catch (e) { return e; } };
  const e1 = lance(() => construireBoutique(app, planM1, carte(ventesM, paiementsM, { ...ctrlM, rows: [[D, 4, 6, 210]] }), "marketplaces", [], numeros));
  ok(e1 instanceof Echec && e1.code === 2, "pipeline : écart de quantité avec le total Shopify non refusé");
  const e2 = lance(() => construireBoutique(app, planM1, carte(ventesM, paiementsM, { ...ctrlM, rows: [[D, 4, 5, 250]] }), "marketplaces", [], numeros));
  ok(e2 instanceof Echec, "pipeline : écart de montant avec le total Shopify non refusé");
  const e3 = lance(() => construireBoutique(app, planM1, carte(ventesM, { ...paiementsM, rows: [] }, ctrlM), "marketplaces", [], numeros));
  ok(e3 instanceof Echec, "pipeline : jeu « payments » vide (commandes sans passerelle) non refusé");
  const e4 = lance(() => construireBoutique(app, planM1, carte({ ...ventesM, rows: Array.from({ length: 3000 }, (_, i) => ["#X" + i, skuA, "France", "Bestherm", 0, 0, 0]) }, paiementsM, ctrlM), "marketplaces", [], numeros));
  ok(e4 instanceof Echec, "pipeline : liste tronquée (limite de lignes) non refusée");

  /* ---- Technomat : une commande Leroy Merlin « 014… » passe de Leroy Merlin à Technomat, sans changer le total */
  const numerosT = new Map([["#1001", "014-120208-A"]]);
  const avT = [];
  const bT = construireBoutique(app, planM1, carte(ventesM, paiementsM, ctrlM), "marketplaces", avT, numerosT);
  const tm = trouve(bT, TECHNOMAT.mp, "France");
  ok(tm && tm.qte === 2 && r2(tm.ca) === 100 && tm.produit === nomA && tm.nl === 1 && !trouve(bT, "Leroy Merlin", "France"), "Technomat : la commande 014 est classée Technomat et plus dans Leroy Merlin");
  ok(r2(bT.lignes.reduce((s, l) => s + l.ca, 0)) === 210 && bT.lignes.reduce((s, l) => s + l.qte, 0) === 5 && bT.technomat.commandes === 1 && r2(bT.technomat.ca) === 100, "Technomat : total du jour inchangé, compteur de commandes 014");
  ok(!avT.some((a) => /préfixe connu/.test(a)), "Technomat : pas d'avertissement pour un numéro 014");
  // numéro d'une autre origine (Espagne 002) : reste dans Leroy Merlin ; préfixe inconnu : reste dans Leroy Merlin + avertissement
  const bEs = construireBoutique(app, planM1, carte(ventesM, paiementsM, ctrlM), "marketplaces", [], new Map([["#1001", "002-26299L2-A"]]));
  ok(trouve(bEs, "Leroy Merlin", "France") && !trouve(bEs, TECHNOMAT.mp, "France"), "Technomat : un numéro 002 reste dans Leroy Merlin");
  const avX = [];
  const bX = construireBoutique(app, planM1, carte(ventesM, paiementsM, ctrlM), "marketplaces", avX, new Map([["#1001", "099-1-A"]]));
  ok(trouve(bX, "Leroy Merlin", "France") && avX.some((a) => /préfixe connu/.test(a) && /099-1-A/.test(a)), "Technomat : préfixe inconnu laissé dans Leroy Merlin avec avertissement");
  const avV = [];
  construireBoutique(app, planM1, carte(ventesM, paiementsM, ctrlM), "marketplaces", avV, new Map([["#1001", ""]]));
  ok(avV.some((a) => /préfixe connu/.test(a) && /\(vide\)/.test(a)), "Technomat : commande lue sans numéro d'origine signalée");
  // numéro non lu : on n'écrit rien (code 3), jamais de classement au hasard
  for (const [nom, arg] of [["absent", undefined], ["vide", new Map()], ["autre commande", new Map([["#9999", "014-1-A"]])]]) {
    const eN = lance(() => construireBoutique(app, planM1, carte(ventesM, paiementsM, ctrlM), "marketplaces", [], arg));
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
  // les autres marketplaces n'ont pas besoin de numéro : une journée sans commande Leroy Merlin passe sans classification
  const paieSansLm = { ...paiementsM, rows: [["#1001", "amazon", 120], ["#1002", "amazon", 60], ["#1003", "carrefourx", 72]] };
  ok(construireBoutique(app, planM1, carte(ventesM, paieSansLm, ctrlM), "marketplaces", [], new Map()).lignes.length > 0, "Technomat : sans commande Leroy Merlin, aucune classification n'est exigée");

  /* ---- boutique du site */
  const bS = construireBoutique(app, planS1, carte(ventesS, ctrlS), "site", []);
  ok(bS.lignes.length === 2 && bS.lignes.every((l) => l.mp === "Site Web") && r2(bS.lignes.reduce((s, l) => s + l.ca, 0)) === 500, "pipeline : site web = ventes brutes, ligne retirée (quantité 0) écartée");
  ok(trouve(bS, "Site Web", "Allemagne")?.qte === 2, "pipeline : pays du site traduit (Germany → Allemagne)");

  /* ---- lecture des résultats : boutique obligatoire, résultats manquants */
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), "selftest-ext-"));
  try {
    const ecrire = (nom, data) => { const f = path.join(dossier, nom); fs.writeFileSync(f, JSON.stringify(data)); return f; };
    const fOk = ecrire("site_ok.json", [ventesS, ctrlS]);
    ok(collecter(planS1, { transcript: [] }, "site", [fOk]).size === 2, "pipeline : résultats du site relus");
    const manquants = lance(() => collecter(planS1, { transcript: [] }, "site", [ecrire("site_incomplet.json", [ventesS])]));
    ok(manquants instanceof Echec && manquants.code === 3, "pipeline : résultats manquants → code 3");
    const autreBoutique = lance(() => collecter(planS1, { transcript: [] }, "site", [ecrire("site_autre.json", [{ ...ventesS, shopDomain: DM }, { ...ctrlS, shopDomain: DM }])]));
    ok(autreBoutique instanceof Echec, "pipeline : résultats de l'autre boutique acceptés pour le site");
    const sansDomaine = lance(() => collecter(planS1, { transcript: [] }, "site", [ecrire("site_sans.json", [{ ...ventesS, shopDomain: undefined }, { ...ctrlS, shopDomain: undefined }])]));
    ok(sansDomaine instanceof Echec, "pipeline : résultat du site sans boutique indiquée accepté");
    // numéros d'origine : pages GraphQL relues dans la transcription (les résultats ShopifyQL du même fichier n'interfèrent pas)
    const page = (noms) => JSON.stringify({ data: { orders: { edges: noms.map(([n, v]) => ({ node: { name: n, customAttributes: [{ key: "Latest Ship Date", value: "2026-10-29" }, { key: "leroymerlin Number", value: v }] } })), pageInfo: { hasNextPage: false, endCursor: "x" } } } });
    const ligneJsonl = (texte) => JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t", content: [{ type: "text", text: texte }] }] } });
    const fTr = path.join(dossier, "session.jsonl");
    fs.writeFileSync(fTr, [
      JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id: "t", name: "graphql_query", input: { query: GQL.commandesLm("2026-10-26", "2026-10-26") + " customAttributes" } }] } }),
      ligneJsonl(page([["SHOP1", "001-26299L1-A"], ["SHOP2", "014-164922-A"]])),
      ligneJsonl(JSON.stringify({ query: REQ.controle("2026-10-26", "2026-10-26"), columns: [{ name: "day" }], rows: [["2026-10-26"]] })),
      ligneJsonl(page([["SHOP3", "002-26299L2-A"], ["SHOP4", ""]])),
      "ligne illisible customAttributes tool_result",
    ].join("\n"));
    const lus = collecterNumeros({ transcript: [fTr] });
    ok(lus.size === 4 && lus.get("SHOP1") === "001-26299L1-A" && lus.get("SHOP2") === "014-164922-A" && lus.get("SHOP3") === "002-26299L2-A" && lus.get("SHOP4") === "", "Technomat : numéros d'origine relus dans la transcription (pages 1 et 2, commande sans numéro = chaîne vide)");
    ok(collecterNumeros({ transcript: [path.join(dossier, "absent.jsonl")] }).size === 0, "Technomat : transcription absente → aucun numéro (la classification échouera ensuite)");
    const fObj = ecrire("ordres_obj.json", { SHOP9: " 014-5-A " }), fPages = ecrire("ordres_pages.json", [JSON.parse(page([["SHOP8", "001-1-A"]]))]);
    const viaFichiers = collecterNumeros({ ordresLm: [fObj, fPages], transcript: [fTr] });
    ok(viaFichiers.size === 2 && viaFichiers.get("SHOP9") === "014-5-A" && viaFichiers.get("SHOP8") === "001-1-A", "Technomat : --ordres-lm (objet nom → numéro ou pages GraphQL) prime sur la transcription");
  } finally { fs.rmSync(dossier, { recursive: true, force: true }); }

  /* ---- fusion avec l'extraction précédente */
  const blocM = { plan: planM1, ...bM }, blocS = { plan: planS1, ...bS };
  const e0 = fusionner(app, null, { marketplaces: blocM }, "2026-10-05");
  ok(validerExtension(e0, app.dmaxOdp).ok && e0.du === D && e0.au === D && e0.boutiques.marketplaces.au === D, "pipeline : première extraction valide");
  const e1f = fusionner(app, e0, { site: blocS }, "2026-10-05");
  ok(validerExtension(e1f, app.dmaxOdp).ok && e1f.lignes.length === bM.lignes.length + bS.lignes.length, "pipeline : la boutique du site s'ajoute sans toucher aux marketplaces");
  const eT = fusionner(app, null, { marketplaces: { plan: planM1, ...bT } }, "2026-10-05");
  ok(validerExtension(eT, app.dmaxOdp).ok && eT.mp.includes(TECHNOMAT.mp) && !eT.mp.includes("Leroy Merlin") && eT.lignes.length === bT.lignes.length, "Technomat : l'extraction fusionnée contient la marketplace Technomat et reste valide");
  // lendemain : seules les marketplaces avancent → l'écran s'arrête au dernier jour couvert par les deux
  const D2 = "2026-10-05";
  const ventes2 = { ...ventesM, query: REQ.ventes(D2) }, paie2 = { ...paiementsM, query: REQ.paiements(D2) }, ctrl2 = { ...ctrlM, query: REQ.controle(D2, D2), rows: [[D2, 4, 5, 210]] };
  const plan2 = planifier({ ...app, precedent: e1f }, "2026-10-06", {}, "marketplaces");
  ok(plan2.du === D2 && plan2.au === D2, `pipeline : le lendemain, fenêtre des marketplaces ${plan2.du} → ${plan2.au}`);
  const b2 = construireBoutique(app, plan2, carte(ventes2, paie2, ctrl2), "marketplaces", [], numeros);
  const e2f = fusionner(app, e1f, { marketplaces: { plan: plan2, ...b2 } }, "2026-10-06");
  ok(e2f.boutiques.marketplaces.au === D2 && e2f.boutiques.site.au === D && e2f.au === D, "pipeline : couverture = plus ancien des deux « au » quand une boutique n'avance pas");
  ok(e2f.lignes.length === e1f.lignes.length + b2.lignes.length && validerExtension(e2f, app.dmaxOdp).ok, "pipeline : les jours déjà extraits sont conservés");
  // réextraction d'un jour : remplacé, jamais doublé
  const ventesBis = { ...ventesM, rows: ventesM.rows.map((r, i) => (i === 0 ? ["#1001", skuA, "France", "Bestherm", 2, 200, 40] : r)) };
  const bBis = construireBoutique(app, planM1, carte(ventesBis, paiementsM, { ...ctrlM, rows: [[D, 4, 5, 310]] }), "marketplaces", [], numeros);
  const eBis = fusionner(app, e2f, { marketplaces: { plan: planM1, ...bBis } }, "2026-10-07");
  const caJour = (e, j) => r2(e.lignes.filter((l) => l[0] === j && e.mp[l[1]] !== "Site Web").reduce((s, l) => s + l[5], 0));
  ok(caJour(eBis, D) === 310 && caJour(eBis, D2) === 210 && eBis.lignes.length === e2f.lignes.length, "pipeline : jour réextrait remplacé (pas de doublon), autres jours inchangés");
  // nouvel export ODP qui couvre le premier jour : il est écarté
  const eOdp = fusionner({ ...app, dmaxOdp: D }, e2f, { marketplaces: { plan: plan2, ...b2 } }, "2026-10-06");
  ok(eOdp.lignes.every((l) => l[0] > D) && eOdp.du === D2, "pipeline : les jours couverts par un nouvel export ODP sont écartés");
  // sérialisation : relue à l'identique, une ligne par enregistrement
  const texte = serialiser(e2f);
  ok(JSON.stringify(JSON.parse(texte)) === JSON.stringify(e2f) && texte.split("\n").length > e2f.lignes.length, "pipeline : sérialisation (une ligne par enregistrement) relue à l'identique");
}
