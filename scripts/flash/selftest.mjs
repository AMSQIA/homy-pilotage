#!/usr/bin/env node
/**
 * Auto-test du script de mise à jour du Flash Shopify, sur des données synthétiques dont les
 * résultats attendus sont calculés à la main. À lancer après toute modification du script :
 *   node scripts/flash/selftest.mjs        → « SELFTEST_OK » attendu
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { planifier, construire, collecter, comparerAuPrecedent, normaliserSku, lastYear, weekExcel, addDays, serialiser, Echec, CFG, PROFILS } from "./refresh_flash.mjs";

let n = 0;
const test = (nom, f) => { f(); n++; };
const echec = (f, motif) => assert.throws(f, (e) => e instanceof Echec && (!motif || motif.test(e.message)), `Échec attendu : ${motif}`);

/* --- dates ------------------------------------------------------------------------------ */
test("dates", () => {
  assert.equal(addDays("2026-10-31", 1), "2026-11-01");
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
  assert.equal(lastYear("2026-10-04"), "2025-10-04");
  assert.equal(lastYear("2028-02-29"), "2027-02-28");
  // Semaines Excel (dimanche → samedi, semaine 1 = 1er janvier jusqu'au premier samedi)
  assert.equal(weekExcel("2026-01-01"), 1);
  assert.equal(weekExcel("2026-01-03"), 1);
  assert.equal(weekExcel("2026-01-04"), 2);
  assert.equal(weekExcel("2026-09-20"), 39);
  assert.equal(weekExcel("2026-10-03"), 40);
});

test("références Shopify", () => {
  assert.equal(normaliserSku("HT20PDC_never_used"), "HT20PDC");
  assert.equal(normaliserSku("HT5PDC-B-FLM"), "HT5PDC-B");
  assert.equal(normaliserSku("HC-01230-WH/WOL-WOOD-52"), "HC-01230-WH-WOL-WOOD-52");
  assert.equal(normaliserSku(" HT10PDC "), "HT10PDC");
});

/* --- jeu de données synthétique --------------------------------------------------------- */
const src = `const DMIN = "2024-01-01", DMAX = "2026-10-03";
const ABC_BY_SKU = [["AAA1","PRODUIT A",0,0,"A"],["BBB2","PRODUIT B",0,0,"B"],["HR15-TV12","ARIA VERTICAL 1500W",0,0,"B"]];
const WEEKLY_BY_MP = [[39,"Amazon FR",100,1],[39,"Site Web",50,1],[40,"Amazon FR",200,2],[40,"Site Web",20,1],[38,"Amazon FR",999,9]];
const PAYS_I18N = {"Belgique":{"en":"Belgium"},"Pays-Bas":{"en":"Netherlands"}};
`;
const app = { src, dmax: "2026-10-03", precedent: null };
const plan = planifier(app, "2026-10-06"); // fenêtre 04 → 05 octobre
const DOM = "46a3f9-2.myshopify.com";
const res = (query, columns, rows, shopDomain = DOM) => ({ query, columns: columns.map((name) => ({ name })), rows, shopDomain });
const M = ["orders", "quantity_ordered", "net_sales", "taxes"];
function jeu(modif = (x) => x) {
  const q = Object.fromEntries(plan.queries.map((x) => [x.id, x.query]));
  const m = new Map();
  m.set(q.jours, res(q.jours, ["day", ...M], [["2026-10-04", "10", "12", "1000", "200"], ["2026-10-05", "20", "25", "2400", "480"]]));
  m.set(q.jours_n1, res(q.jours_n1, ["day", ...M], [["2025-10-04", "8", "9", "800", "160"], ["2025-10-05", "15", "18", "1200", "0"]]));
  m.set(q.pays, res(q.pays, ["shipping_country", ...M], [["France", "25", "30", "3000", "600"], ["Belgium", "5", "7", "400", "80"]]));
  m.set(q.produits, res(q.produits, ["product_variant_sku", "quantity_ordered", "net_sales", "taxes"],
    [["AAA1-FLM", "20", "2000", "400"], ["BBB2_never_used", "15", "1400", "280"], ["", "0", "0", "0"]]));
  m.set(q.recoup, res(q.recoup, M, [["30", "40", "300", "60"]]));
  return modif(m) ?? m;
}

test("plan", () => {
  assert.equal(plan.du, "2026-10-04");
  assert.equal(plan.au, "2026-10-05");
  assert.deepEqual(plan.recoup, { du: "2026-09-20", au: "2026-10-03", semaines: [39, 40] });
  assert.equal(plan.queries.length, 5);
  assert.ok(plan.queries.every((x) => x.query.startsWith("FROM sales SHOW ")));
  assert.equal(planifier(app, "2026-10-04").vide, true); // l'ODP couvre déjà jusqu'à hier
  assert.equal(planifier(app, "2026-10-05").vide, false); // hier = DMAX + 1
  // DMAX un mercredi : le contrôle porte sur les deux dernières semaines COMPLÈTES
  const p2 = planifier({ ...app, dmax: "2026-10-07" }, "2026-10-12");
  assert.equal(p2.recoup.au, "2026-10-03");
});

test("construction du bloc", () => {
  const avert = [];
  const b = construire(app, plan, jeu(), avert);
  assert.deepEqual(b.jours, [
    { d: "2026-10-04", ca: 1000, cmd: 10, qte: 12, n1: 800 },
    { d: "2026-10-05", ca: 2400, cmd: 20, qte: 25, n1: 1000 },
  ]);
  assert.deepEqual(b.n1, { ca: 1800, qte: 27, cmd: 23 });
  assert.deepEqual(b.pays, [{ nom: "France", ca: 3000, qte: 30 }, { nom: "Belgique", ca: 400, qte: 7 }]);
  assert.deepEqual(b.produits, [{ nom: "PRODUIT A", ca: 2000, qte: 20 }, { nom: "PRODUIT B", ca: 1400, qte: 15 }]);
  assert.deepEqual(b.recoupement, { du: "2026-09-20", au: "2026-10-03", shopify: 300, excel: 300 });
  assert.equal(b.du, "2026-10-04"); assert.equal(b.au, "2026-10-05"); assert.equal(b.annee, 2026);
  assert.equal(avert.length, 0);
  // Le JSON écrit se relit à l'identique
  assert.deepEqual(JSON.parse(serialiser(b)), b);
  assert.equal(serialiser(null), "null\n");
});

test("jour manquant dans la série : détecté par les contrôles de couverture (pays, références)", () => {
  echec(() => construire(app, plan, jeu((m) => {
    const q = plan.queries[0].query; const r = m.get(q); r.rows = [r.rows[0]]; // le 05/10 disparaît
  }), []), /couverture incohérente|total des références/);
});

test("mauvaise boutique", () => {
  echec(() => construire(app, plan, jeu((m) => { for (const r of m.values()) r.shopDomain = "autre.myshopify.com"; }), []), /Boutique inattendue/);
});

test("TVA non enregistrée : le contrôle ODP bloque", () => {
  // Si les taxes disparaissaient, (ventes nettes) ÷ 1,2 sous-estimerait fortement le CA
  echec(() => construire(app, plan, jeu((m) => {
    for (const [id, cols] of [["jours", 4], ["jours_n1", 4]]) for (const r of m.get(plan.queries.find((x) => x.id === id).query).rows) r[cols] = "0";
    for (const r of m.get(plan.queries.find((x) => x.id === "pays").query).rows) r[4] = "0";
    for (const r of m.get(plan.queries.find((x) => x.id === "produits").query).rows) r[3] = "0";
    m.get(plan.queries.find((x) => x.id === "recoup").query).rows[0][3] = "0";
  }), []), /Contrôle ODP/);
});

test("références non rattachées, pays inconnu, pack", () => {
  const avert = [];
  const b = construire(app, plan, jeu((m) => {
    const rq = m.get(plan.queries.find((x) => x.id === "produits").query);
    rq.rows = [["AAA1", "20", "2000", "400"], ["HR10-CV05W", "10", "700", "140"], ["NOUVEAU-1", "5", "700", "140"], ["", "0", "0", "0"]];
    const rp = m.get(plan.queries.find((x) => x.id === "pays").query);
    rp.rows = [["France", "25", "30", "3000", "600"], ["Freedonia", "5", "7", "400", "80"]];
  }), avert);
  assert.deepEqual(b.produits.map((p) => p.nom), ["PRODUIT A", "ARIA VERTICAL 1500W", "NOUVEAU-1"]);
  assert.ok(avert.some((a) => /NOUVEAU-1/.test(a)));
  assert.ok(avert.some((a) => /Freedonia/.test(a)));
  assert.deepEqual(b.pays[1], { nom: "Freedonia", ca: 400, qte: 7 });
});

test("limite de lignes atteinte", () => {
  echec(() => construire(app, plan, jeu((m) => {
    const rq = m.get(plan.queries.find((x) => x.id === "produits").query);
    rq.rows = Array.from({ length: CFG.limiteSku }, (_, i) => [`X${i}`, "0", "0", "0"]);
  }), []), /limite/);
});

test("comparaison avec le bloc précédent", () => {
  const b = construire(app, plan, jeu(), []);
  const avert = [];
  comparerAuPrecedent(b, null, false, avert); // pas de bloc précédent : rien à comparer
  comparerAuPrecedent(b, { du: b.du, au: b.au, jours: b.jours }, false, avert); // identique
  assert.equal(avert.length, 0);
  // régression : le bloc actuel va plus loin que le nouveau pour la même période
  echec(() => comparerAuPrecedent(b, { du: b.du, au: "2026-10-09", jours: b.jours }, false, []), /Régression/);
  // variation anormale des jours communs
  echec(() => comparerAuPrecedent(b, { du: b.du, au: b.au, jours: b.jours.map((j) => ({ ...j, ca: j.ca * 2 })) }, false, []), /ont varié/);
  // --force autorise les deux
  comparerAuPrecedent(b, { du: b.du, au: b.au, jours: b.jours.map((j) => ({ ...j, ca: j.ca * 2 })) }, true, []);
});


/* --- boutique du site : base brute HT, contrôle ODP « Site Web », résultats isolés par boutique -------- */
const SITE = PROFILS.site, MKT = PROFILS.marketplaces;
const planSite = planifier(app, "2026-10-06", SITE); // même fenêtre : 04 → 05 octobre
const DOM_SITE = "besthermshop.myshopify.com";
const MS = ["orders", "quantity_ordered", "gross_sales"];
function jeuSite(modif = (x) => x) {
  const q = Object.fromEntries(planSite.queries.map((x) => [x.id, x.query]));
  const m = new Map();
  m.set(q.jours, res(q.jours, ["day", ...MS], [["2026-10-04", "10", "12", "1000"], ["2026-10-05", "20", "25", "2400"]], DOM_SITE));
  m.set(q.jours_n1, res(q.jours_n1, ["day", ...MS], [["2025-10-04", "8", "9", "800"], ["2025-10-05", "15", "18", "1200"]], DOM_SITE));
  m.set(q.pays, res(q.pays, ["shipping_country", ...MS], [["France", "25", "30", "3000"], ["Belgium", "5", "7", "400"]], DOM_SITE));
  m.set(q.produits, res(q.produits, ["product_variant_sku", "quantity_ordered", "gross_sales"],
    [["AAA1", "20", "2000"], ["BBB2_never_used", "15", "1400"], ["", "0", "0"]], DOM_SITE));
  m.set(q.recoup, res(q.recoup, MS, [["30", "40", "70"]], DOM_SITE));
  return modif(m) ?? m;
}
const reqSite = (id) => planSite.queries.find((x) => x.id === id).query;

test("site : plan sur les ventes brutes, profils distincts", () => {
  assert.equal(planSite.boutique, "site");
  assert.equal(plan.boutique, "marketplaces");
  assert.equal(planSite.queries.length, 5);
  assert.equal(reqSite("jours"), "FROM sales SHOW orders, quantity_ordered, gross_sales TIMESERIES day SINCE 2026-10-04 UNTIL 2026-10-05");
  assert.equal(reqSite("jours_n1"), "FROM sales SHOW orders, quantity_ordered, gross_sales TIMESERIES day SINCE 2025-10-04 UNTIL 2025-10-05");
  assert.equal(reqSite("pays"), `FROM sales SHOW orders, quantity_ordered, gross_sales GROUP BY shipping_country SINCE 2026-10-04 UNTIL 2026-10-05 ORDER BY gross_sales DESC LIMIT ${CFG.limitePays}`);
  assert.equal(reqSite("produits"), `FROM sales SHOW quantity_ordered, gross_sales GROUP BY product_variant_sku SINCE 2026-10-04 UNTIL 2026-10-05 ORDER BY gross_sales DESC LIMIT ${CFG.limiteSku}`);
  assert.equal(reqSite("recoup"), "FROM sales SHOW orders, quantity_ordered, gross_sales SINCE 2026-09-20 UNTIL 2026-10-03");
  // Les requêtes des marketplaces n'ont pas bougé (leurs résultats sont relus par texte de requête)
  assert.equal(plan.queries[0].query, "FROM sales SHOW orders, quantity_ordered, net_sales, taxes TIMESERIES day SINCE 2026-10-04 UNTIL 2026-10-05");
  assert.equal(plan.queries[3].query, `FROM sales SHOW quantity_ordered, net_sales, taxes GROUP BY product_variant_sku SINCE 2026-10-04 UNTIL 2026-10-05 ORDER BY net_sales DESC LIMIT ${CFG.limiteSku}`);
  assert.notEqual(MKT.domaine, SITE.domaine);
  assert.notEqual(MKT.fichier, SITE.fichier);
  assert.equal(planifier(app, "2026-10-04", SITE).vide, true);
});

test("site : bloc construit sans division par la TVA", () => {
  const avert = [];
  const b = construire(app, planSite, jeuSite(), avert, SITE);
  assert.deepEqual(b.jours, [
    { d: "2026-10-04", ca: 1000, cmd: 10, qte: 12, n1: 800 },
    { d: "2026-10-05", ca: 2400, cmd: 20, qte: 25, n1: 1200 },
  ]);
  assert.deepEqual(b.n1, { ca: 2000, qte: 27, cmd: 23 });
  assert.deepEqual(b.pays, [{ nom: "France", ca: 3000, qte: 30 }, { nom: "Belgique", ca: 400, qte: 7 }]);
  assert.deepEqual(b.produits, [{ nom: "PRODUIT A", ca: 2000, qte: 20 }, { nom: "PRODUIT B", ca: 1400, qte: 15 }]);
  // Contrôle ODP : uniquement les lignes « Site Web » (50 + 20), pas Amazon FR
  assert.deepEqual(b.recoupement, { du: "2026-09-20", au: "2026-10-03", shopify: 70, excel: 70 });
  assert.equal(b.boutique, "bestherm.fr");
  assert.equal(b.base, "ventes_brutes_ht");
  assert.equal(avert.length, 0);
  assert.deepEqual(JSON.parse(serialiser(b)), b);
});

test("site : seuils du contrôle ODP (avertissement à 5 %, échec à 12 %)", () => {
  const ecartDe = (brut) => (m) => { m.get(reqSite("recoup")).rows[0][2] = String(brut); };
  const avertPour = (brut) => { const a = []; construire(app, planSite, jeuSite(ecartDe(brut)), a, SITE); return a.filter((x) => /Contrôle ODP/.test(x)); };
  assert.equal(avertPour(72.8).length, 0); // +4 % : rien à signaler (les marketplaces avertiraient dès 3 %)
  assert.equal(avertPour(74.2).length, 1); // +6 % : avertissement, pas d'échec
  assert.equal(avertPour(77).length, 1); // +10 % : avertissement seulement (les marketplaces échoueraient dès 8 %)
  assert.equal(avertPour(63).length, 1); // −10 %
  echec(() => construire(app, planSite, jeuSite(ecartDe(80)), [], SITE), /Contrôle ODP.*site web.*\+14\.3 %/); // +14,3 %
  echec(() => construire(app, planSite, jeuSite(ecartDe(60)), [], SITE), /Contrôle ODP/); // −14,3 %
  // Marketplaces : avertissement dès 3 %, échec au-delà de 8 %
  const recoupM = (v) => (m) => { m.get(plan.queries.find((x) => x.id === "recoup").query).rows[0][2] = String(v); };
  const avertM = [];
  construire(app, plan, jeu(recoupM(321)), avertM); // 321 / 300 : +7 %
  assert.ok(avertM.some((a) => /Contrôle ODP/.test(a)));
  echec(() => construire(app, plan, jeu(recoupM(330)), []), /Contrôle ODP/); // +10 %
});

test("site : aucune vente ODP « Site Web » sur la période de contrôle", () => {
  const appSansSite = { ...app, src: app.src.replace(/\[39,"Site Web",50,1\],/, "").replace(/\[40,"Site Web",20,1\],/, "") };
  const avert = [];
  const b = construire(appSansSite, planSite, jeuSite(), avert, SITE);
  assert.equal(b.recoupement, undefined);
  assert.ok(avert.some((a) => /Contrôle ODP impossible/.test(a)));
});

test("site : la boutique est obligatoire et vérifiée", () => {
  echec(() => construire(app, planSite, jeuSite((m) => { for (const r of m.values()) delete r.shopDomain; }), [], SITE), /Boutique inattendue \(non indiquée\)/);
  echec(() => construire(app, planSite, jeuSite((m) => { for (const r of m.values()) r.shopDomain = MKT.domaine; }), [], SITE), /Boutique inattendue/);
  // Un seul résultat d'une autre boutique suffit à tout refuser
  echec(() => construire(app, planSite, jeuSite((m) => { m.get(reqSite("pays")).shopDomain = MKT.domaine; }), [], SITE), /Boutique inattendue/);
  // Marketplaces : shopDomain absent toléré (historique), autre boutique refusée
  construire(app, plan, jeu((m) => { for (const r of m.values()) delete r.shopDomain; }), []);
  // Un résultat étranger, hors plan, ne bloque pas la construction
  construire(app, planSite, jeuSite((m) => { m.set("FROM sales SHOW autre", res("FROM sales SHOW autre", ["x"], [["1"]], "autre.myshopify.com")); }), [], SITE);
  // Résultat du plan absent : échec net (code 3), pas une erreur technique
  assert.throws(() => construire(app, planSite, jeuSite((m) => { m.delete(reqSite("pays")); }), [], SITE), (e) => e instanceof Echec && e.code === 3);
});

test("site : colonne de valeur manquante ou non numérique", () => {
  echec(() => construire(app, planSite, jeuSite((m) => { m.get(reqSite("jours")).columns = [{ name: "day" }, { name: "orders" }, { name: "quantity_ordered" }, { name: "net_sales" }]; }), [], SITE), /Colonne « gross_sales » absente/);
  echec(() => construire(app, planSite, jeuSite((m) => { m.get(reqSite("jours")).rows[0][3] = "n/a"; }), [], SITE), /non numérique/);
});

test("résultats lus par boutique : même requête, deux boutiques, jamais mélangées", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "flash-selftest-"));
  try {
    const q = (id) => plan.queries.find((x) => x.id === id).query; // même texte pour les deux profils : les requêtes « marketplaces »
    const planDeux = { ...plan, queries: plan.queries.filter((x) => x.id === "jours") };
    const mk = res(q("jours"), ["day", ...M], [["2026-10-04", "1", "1", "100", "20"]], MKT.domaine);
    const st = res(q("jours"), ["day", ...M], [["2026-10-04", "9", "9", "900", "180"]], SITE.domaine);
    const sans = { query: q("jours"), columns: M.map((name) => ({ name })), rows: [["2026-10-04", "5", "5", "500", "100"]] }; // sans shopDomain
    const ecrit = (nom, x) => { const f = path.join(dir, nom); fs.writeFileSync(f, JSON.stringify(x)); return f; };
    const fMk = ecrit("mk.json", [mk]), fSt = ecrit("st.json", [st]), fSans = ecrit("sans.json", [sans]);
    const lire = (fichiers, profil) => collecter(planDeux, { results: fichiers, transcript: [] }, profil).get(q("jours"));
    // Les deux résultats dans le même fichier de résultats, dans les deux ordres
    assert.equal(lire([fMk, fSt], MKT).rows[0][1], "1");
    assert.equal(lire([fSt, fMk], MKT).rows[0][1], "1");
    assert.equal(lire([fMk, fSt], { ...SITE, colonnes: SITE.colonnes }).rows[0][1], "9");
    // Un résultat de l'autre boutique seulement : manquant (code 3), jamais substitué
    assert.throws(() => lire([fSt], MKT), (e) => e instanceof Echec && e.code === 3 && /marketplaces/.test(e.message));
    assert.throws(() => lire([fMk], SITE), (e) => e instanceof Echec && e.code === 3 && /site/.test(e.message));
    // Sans shopDomain : toléré pour les marketplaces, refusé pour le site
    assert.equal(lire([fSans], MKT).rows[0][1], "5");
    assert.throws(() => lire([fSans], SITE), (e) => e instanceof Echec && e.code === 3);
    // Le résultat de la bonne boutique prime sur celui qui n'indique pas la boutique
    assert.equal(lire([fSans, fMk], MKT).rows[0][1], "1");
    // Fichier illisible : échec d'utilisation net
    const fMauvais = path.join(dir, "mauvais.json"); fs.writeFileSync(fMauvais, "{pas du json");
    assert.throws(() => lire([fMauvais], SITE), (e) => e instanceof Echec && e.code === 1 && /illisible/.test(e.message));
    // Résultats rangés dans une transcription de session (format .jsonl)
    const ligne = (r) => JSON.stringify({ message: { content: [{ type: "tool_result", content: [{ type: "text", text: JSON.stringify(r) }] }] } });
    const tr = path.join(dir, "session.jsonl"); fs.writeFileSync(tr, [ligne(st), ligne(mk)].join("\n") + "\n");
    assert.equal(collecter(planDeux, { results: [], transcript: [tr] }, MKT).get(q("jours")).rows[0][1], "1");
    assert.equal(collecter(planDeux, { results: [], transcript: [tr] }, SITE).get(q("jours")).rows[0][1], "9");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

console.log(`SELFTEST_OK · ${n} groupes de contrôles`);
