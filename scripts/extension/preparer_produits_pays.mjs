#!/usr/bin/env node
/**
 * Prépare data/produits_pays.json : les ventes du fichier ODP par PRODUIT × PAYS × marketplace × mois (CA HT et quantités).
 * L'onglet « Répartitions › Pays » en tire la liste des produits vendus (noms et quantités) dans chaque pays.
 *
 * Pourquoi un fichier à part : les constantes de App.jsx ne croisent jamais le produit et le pays (SKU_MONTHLY : produit × marketplace ×
 * mois ; PAYS_MONTHLY : pays × marketplace × mois). Seules les lignes de commandes de l'ODP portent les deux.
 *
 * Utilisation (à relancer quand le socle ODP de App.jsx est remplacé par un nouvel export) :
 *   node scripts/extension/preparer_produits_pays.mjs fichier_LIGNES_ODP_2026.csv [--ecrire] [--out data/produits_pays.json]
 *
 * Le CSV est l'export de l'onglet « Lignes ODP » (séparateur « ; », colonnes SKU · Dés. marchand · Qté · Date · CA HT · Market place · PAYS).
 * Rattachement des produits : comme dans l'application (SKU de ABC_BY_SKU / data/produits_meta.json, sinon « Dés. marchand »).
 *
 * Sans --ecrire, le script vérifie et affiche. Il REFUSE d'écrire tant que les cumuls ne retombent pas, au centime et à l'unité, sur
 *   - SKU_MONTHLY de l'année (produit × marketplace × mois) : CA et quantités ;
 *   - PAYS_MONTHLY de l'année (pays × marketplace × mois) : CA et quantités ;
 * c'est la preuve que le CSV est bien celui du socle de App.jsx. Les ventes Shopify qui prolongent l'ODP (extension.js) s'ajoutent ensuite
 * à ces lignes au chargement de l'application, comme pour tous les autres tableaux : ce fichier ne contient que l'ODP.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { lireCsv, cle, MP_ALIAS, isoDate, num } from "./build_n1.mjs";
import { lireApp, lireJson, RACINE } from "./lib_app.mjs";

const PAYS_ALIAS = { UK: "Royaume-Uni" };
const r2 = (x) => Math.round(x * 100) / 100;
const r4 = (x) => Math.round(x * 10000) / 10000; // le CA de chaque cellule est gardé au 1/10 000 € : la somme de ~6 000 cellules arrondies au centime dériverait de plusieurs dizaines de centimes
export const SORTIE = path.join("data", "produits_pays.json");

/** Cumule le CSV par produit × pays × marketplace × mois. app = { abc, produits }, meta = contenu de data/produits_meta.json. */
export function agreger(csv, { app, meta }) {
  const L = lireCsv(csv), i = L.idx;
  for (const c of ["SKU", "Dés. marchand", "Qté", "Date", "CA HT", "Market place", "PAYS"]) if (i[c] === undefined) throw new Error(`colonne « ${c} » introuvable dans le CSV`);
  const codes = new Map();
  for (const [code, nom] of app.abc) codes.set(String(code).trim().toUpperCase(), nom);
  for (const [code, nom] of Object.entries(meta.skus || {})) codes.set(code.toUpperCase(), nom);
  const connus = new Set(app.produits);
  const cellules = new Map(), inconnus = new Map();
  let lues = 0, du = null, au = null;
  const annees = new Set();
  for (const r of L.rows) {
    const d = isoDate(r[i["Date"]]);
    if (!d) throw new Error(`date illisible : ${r[i["Date"]]}`);
    const mp = MP_ALIAS[cle(r[i["Market place"]])];
    if (!mp) throw new Error(`marketplace inconnue : ${r[i["Market place"]]}`);
    const sku = String(r[i["SKU"]]).trim(), dm = String(r[i["Dés. marchand"]]).trim();
    let nom = codes.get(sku.toUpperCase());
    if (!nom) nom = connus.has(dm) ? dm : dm || sku;
    if (!connus.has(nom)) inconnus.set(nom, (inconnus.get(nom) || 0) + num(r[i["CA HT"]]));
    const brut = String(r[i["PAYS"]]).trim();
    const pays = PAYS_ALIAS[brut] || brut;
    if (!pays) throw new Error(`pays vide (ligne du ${d}, ${nom})`);
    annees.add(d.slice(0, 4));
    if (!du || d < du) du = d;
    if (!au || d > au) au = d;
    const mois = Number(d.slice(5, 7));
    const k = [nom, pays, mp, mois].join("\u0000");
    const a = cellules.get(k) || { nom, pays, mp, mois, ca: 0, qte: 0 };
    a.ca += num(r[i["CA HT"]]); a.qte += num(r[i["Qté"]]);
    cellules.set(k, a);
    lues++;
  }
  if (annees.size !== 1) throw new Error(`le CSV doit couvrir une seule année (trouvé : ${[...annees].sort().join(", ") || "aucune"})`);
  return { cellules, lues, du, au, an: Number([...annees][0]), inconnus: [...inconnus] };
}

/** Rapproche les cumuls des constantes de App.jsx. Renvoie la liste des écarts (vide = le CSV est bien celui du socle). */
export function verifier({ cellules, an }, C) {
  const ecarts = [];
  const note = (m) => { if (ecarts.length < 25) ecarts.push(m); else if (ecarts.length === 25) ecarts.push("…"); };
  // 1. pays × marketplace × mois
  const parPays = new Map();
  for (const c of cellules.values()) {
    const k = `${c.pays}|${c.mp}|${c.mois}`;
    const a = parPays.get(k) || { ca: 0, qte: 0 };
    a.ca += c.ca; a.qte += c.qte; parPays.set(k, a);
  }
  const vuP = new Set();
  for (const r of C.PAYS_MONTHLY) {
    if (r[2] !== an) continue;
    const k = `${r[0]}|${r[1]}|${r[3]}`; vuP.add(k);
    const a = parPays.get(k);
    if (!a) { note(`PAYS_MONTHLY : ${r[0]} · ${r[1]} · mois ${r[3]} absent du CSV`); continue; }
    if (Math.abs(a.ca - r[4]) > 0.011) note(`PAYS_MONTHLY : ${r[0]} · ${r[1]} · mois ${r[3]} : CA ${r[4]} (App.jsx) ≠ ${a.ca.toFixed(2)} (CSV)`);
    if (typeof r[5] === "number" && a.qte !== r[5]) note(`PAYS_MONTHLY : ${r[0]} · ${r[1]} · mois ${r[3]} : quantité ${r[5]} (App.jsx) ≠ ${a.qte} (CSV)`);
  }
  for (const k of parPays.keys()) if (!vuP.has(k)) note(`PAYS_MONTHLY : ${k} présent dans le CSV mais pas dans App.jsx`);
  // 2. produit × marketplace × mois
  const parSku = new Map();
  for (const c of cellules.values()) {
    const k = `${c.nom}|${c.mp}|${c.mois}`;
    const a = parSku.get(k) || { ca: 0, qte: 0 };
    a.ca += c.ca; a.qte += c.qte; parSku.set(k, a);
  }
  const vuS = new Set();
  for (const r of C.SKU_MONTHLY) {
    if (r[2] !== an) continue;
    const k = `${C.SKU_PRODUIT[r[0]]}|${C.SKU_MPS[r[1]]}|${r[3]}`; vuS.add(k);
    const a = parSku.get(k);
    if (!a) { note(`SKU_MONTHLY : ${k} absent du CSV`); continue; }
    if (Math.abs(a.ca - r[4]) > 0.011) note(`SKU_MONTHLY : ${k} : CA ${r[4]} (App.jsx) ≠ ${a.ca.toFixed(2)} (CSV)`);
    if (a.qte !== r[5]) note(`SKU_MONTHLY : ${k} : quantité ${r[5]} (App.jsx) ≠ ${a.qte} (CSV)`);
  }
  for (const k of parSku.keys()) if (!vuS.has(k)) note(`SKU_MONTHLY : ${k} présent dans le CSV mais pas dans App.jsx`);
  return ecarts;
}

/** Fichier JSON (schéma 1) : dictionnaires de noms + une ligne [produit, pays, marketplace, mois, CA HT (au 1/10 000 €), quantité] par cellule. */
export function versJson({ cellules, an, du, au }) {
  const cs = [...cellules.values()];
  const trie = (a) => [...new Set(a)].sort();
  const produits = trie(cs.map((c) => c.nom)), pays = trie(cs.map((c) => c.pays)), mp = trie(cs.map((c) => c.mp));
  const iP = new Map(produits.map((x, j) => [x, j])), iC = new Map(pays.map((x, j) => [x, j])), iM = new Map(mp.map((x, j) => [x, j]));
  const lignes = cs
    .map((c) => [iP.get(c.nom), iC.get(c.pays), iM.get(c.mp), c.mois, r4(c.ca), c.qte])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2] || a[3] - b[3]);
  return { schema: 1, an, du, au, produits, pays, mp, lignes };
}

// Une ligne par enregistrement : diffs Git lisibles
export function serialiser(j) {
  const l = ["{"];
  const cles = Object.keys(j);
  cles.forEach((k, n) => {
    const v = j[k], vg = n < cles.length - 1 ? "," : "";
    if (k === "lignes") {
      l.push(`  "lignes": [`);
      v.forEach((x, m) => l.push(`    ${JSON.stringify(x)}${m < v.length - 1 ? "," : ""}`));
      l.push(`  ]${vg}`);
    } else l.push(`  ${JSON.stringify(k)}: ${JSON.stringify(v)}${vg}`);
  });
  l.push("}");
  return l.join("\n") + "\n";
}

function main(argv) {
  const o = { _: [] };
  for (let j = 0; j < argv.length; j++) {
    const a = argv[j];
    if (a === "--ecrire") o.ecrire = true; else if (a === "--out") o.out = argv[++j];
    else if (a.startsWith("--")) throw new Error(`option inconnue : ${a}`); else o._.push(a);
  }
  if (!o._[0]) { console.error("Usage : node scripts/extension/preparer_produits_pays.mjs fichier_LIGNES_ODP_2026.csv [--ecrire] [--out fichier.json]"); return 2; }
  const app = lireApp();
  const C = app.constantes(["SKU_PRODUIT", "SKU_MPS", "SKU_MONTHLY", "PAYS_MONTHLY"]);
  const abc = app.constante("ABC_BY_SKU");
  const meta = lireJson("data/produits_meta.json");
  const R = agreger(fs.readFileSync(o._[0], "utf8"), { app: { abc, produits: C.SKU_PRODUIT }, meta });
  console.log(`${R.lues} lignes ODP ${R.du} → ${R.au} · ${R.cellules.size} cellules produit × pays × marketplace × mois`);
  if (R.inconnus.length) { console.error(`Produits hors application : ${R.inconnus.map(([n, v]) => `${n} (${Math.round(v)} €)`).join(", ")}`); return 1; }
  if (R.au !== app.dmaxOdp) console.error(`AVERTISSEMENT · le CSV s'arrête au ${R.au}, l'ODP de App.jsx au ${app.dmaxOdp}`);
  const ecarts = verifier(R, C);
  const tot = [...R.cellules.values()].reduce((s, c) => ({ ca: s.ca + c.ca, qte: s.qte + c.qte }), { ca: 0, qte: 0 });
  console.log(`CA HT ${r2(tot.ca)} € · ${tot.qte} unités · rapprochement SKU_MONTHLY et PAYS_MONTHLY : ${ecarts.length} écart(s)`);
  if (ecarts.length) { console.error(ecarts.join("\n")); console.error("Écarts : fichier non écrit (ce CSV n'est pas celui du socle de App.jsx)."); return 1; }
  if (R.au !== app.dmaxOdp) { console.error("Dernier jour du CSV ≠ DMAX_ODP : fichier non écrit."); return 1; }
  const j = versJson(R);
  const texte = serialiser(j);
  if (JSON.stringify(JSON.parse(texte)) !== JSON.stringify(j)) throw new Error("contrôle d'intégrité : le JSON écrit ne se relit pas à l'identique");
  console.log(`${j.produits.length} produits · ${j.pays.length} pays · ${j.mp.length} marketplaces · ${j.lignes.length} lignes · ${(texte.length / 1024).toFixed(0)} Ko`);
  if (!o.ecrire) { console.log("(simulation — relancer avec --ecrire pour écrire le fichier)"); return 0; }
  const sortie = path.resolve(RACINE, o.out ?? SORTIE);
  fs.writeFileSync(sortie, texte);
  console.log(`OK · ${path.relative(RACINE, sortie)} écrit.`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exit(main(process.argv.slice(2))); } catch (e) { console.error(`ÉCHEC · ${e.message}`); process.exit(1); }
}
