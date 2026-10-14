#!/usr/bin/env node
/**
 * Auto-test du script de mise à jour du Flash Shopify, sur des données synthétiques dont les
 * résultats attendus sont calculés à la main. À lancer après toute modification du script :
 *   node scripts/flash/selftest.mjs        → « SELFTEST_OK » attendu
 */
import assert from "node:assert/strict";
import { planifier, construire, comparerAuPrecedent, normaliserSku, lastYear, weekExcel, addDays, serialiser, Echec, CFG } from "./refresh_flash.mjs";

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

console.log(`SELFTEST_OK · ${n} groupes de contrôles`);
