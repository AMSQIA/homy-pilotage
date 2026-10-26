#!/usr/bin/env node
/**
 * Construit data/n1_2025.json : les ventes 2025 (octobre → décembre) par jour, marketplace et produit, tirées du fichier
 * « LIGNE ODP 2025 ». Elles servent aux comparaisons « même période l'an dernier » (du 1er du mois en cours au jour de
 * la dernière donnée) quand le tableau de bord est prolongé au-delà du fichier ODP 2026 (voir extension.js).
 *
 * Utilisation (une seule fois par an, ou si le fichier ODP 2025 est corrigé) :
 *   node scripts/extension/build_n1.mjs fichier_LIGNE_ODP_2025.csv [--du 2025-10-01] [--au 2025-12-31] [--out data/n1_2025.json]
 *
 * Le CSV est celui de l'export de l'onglet « LIGNE ODP 2025 » (séparateur « ; », dates JJ/MM/AAAA, colonnes
 * SKU · Dés. marchand · Qté · Date · CA HT · Market place). Rattachement des produits : comme dans l'application
 * (SKU de ABC_BY_SKU, sinon « Dés. marchand » s'il s'agit d'un produit connu). Marque : data/produits_meta.json.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RACINE = path.resolve(__dirname, "..", "..");

export function lireCsv(texte) {
  const lignes = []; let i = 0, champ = "", ligne = [], q = false;
  const n = texte.length;
  while (i < n) {
    const c = texte[i];
    if (q) { if (c === '"') { if (texte[i + 1] === '"') { champ += '"'; i++; } else q = false; } else champ += c; }
    else if (c === '"') q = true;
    else if (c === ";") { ligne.push(champ); champ = ""; }
    else if (c === "\n") { ligne.push(champ); champ = ""; lignes.push(ligne); ligne = []; }
    else if (c !== "\r") champ += c;
    i++;
  }
  if (champ !== "" || ligne.length) { ligne.push(champ); lignes.push(ligne); }
  const h = lignes[0].map((x) => x.trim());
  const idx = {}; h.forEach((k, j) => { if (k && idx[k] === undefined) idx[k] = j; });
  return { idx, rows: lignes.slice(1).filter((r) => r.length > 3) };
}

const cle = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
const MP_ALIAS = {
  amazon: "Amazon FR", amazonfr: "Amazon FR", autre: "Autre", bol: "Bol.com", bolcom: "Bol.com", boulanger: "Boulanger",
  bricobravo: "Brico Bravo", bricomarche: "Bricomarché", bricoman: "Technomat", but: "But", castorama: "Castorama",
  cdiscount: "Cdiscount", darty: "Darty", leroymerlin: "Leroy Merlin", manomano: "ManoMano", maxeda: "Maxeda",
  siteweb: "Site Web", worten: "Worten",
};
const isoDate = (s) => {
  const t = String(s).trim();
  let m = t.match(/^(\d{2})\/(\d{2})\/(\d{4})/); if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  m = t.match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
};
const num = (s) => { const v = parseFloat(String(s).replace(",", ".")); return Number.isFinite(v) ? v : 0; };
const r2 = (x) => Math.round(x * 100) / 100;

function constante(src, nom) {
  const m = new RegExp("^const " + nom + " = (.*);[ \\t]*$", "m").exec(src);
  if (!m) throw new Error(`Constante ${nom} introuvable dans App.jsx`);
  return JSON.parse(m[1]);
}

export function construire(csv, { du = "2025-10-01", au = "2025-12-31", app, meta }) {
  const L = lireCsv(csv), i = L.idx;
  for (const c of ["SKU", "Dés. marchand", "Qté", "Date", "CA HT", "Market place"]) if (i[c] === undefined) throw new Error(`Colonne « ${c} » absente du fichier`);
  const codes = new Map(); for (const [code, nom] of app.abc) codes.set(String(code).trim().toUpperCase(), nom);
  for (const [code, nom] of Object.entries(meta.skus || {})) codes.set(code.toUpperCase(), nom);
  const connus = new Set(app.produits);
  const mpOk = new Set(app.mps);
  const acc = new Map(), inconnus = new Map(), mpInconnues = new Map();
  let lues = 0;
  for (const r of L.rows) {
    const d = isoDate(r[i["Date"]]);
    if (!d || d < du || d > au) continue;
    lues++;
    const mp = MP_ALIAS[cle(r[i["Market place"]])];
    if (!mp || !mpOk.has(mp)) { mpInconnues.set(r[i["Market place"]], (mpInconnues.get(r[i["Market place"]]) || 0) + num(r[i["CA HT"]])); continue; }
    const sku = String(r[i["SKU"]]).trim(), dm = String(r[i["Dés. marchand"]]).trim();
    let nom = codes.get(sku.toUpperCase());
    if (!nom) nom = connus.has(dm) ? dm : dm || sku;
    if (!connus.has(nom)) inconnus.set(nom, (inconnus.get(nom) || 0) + num(r[i["CA HT"]]));
    const k = `${d}\u0000${mp}\u0000${nom}`;
    const a = acc.get(k) || { d, mp, nom, qte: 0, ca: 0 };
    a.qte += num(r[i["Qté"]]); a.ca += num(r[i["CA HT"]]);
    acc.set(k, a);
  }
  const cells = [...acc.values()].sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : a.mp < b.mp ? -1 : a.mp > b.mp ? 1 : a.nom < b.nom ? -1 : a.nom > b.nom ? 1 : 0));
  const mp = [...new Set(cells.map((c) => c.mp))].sort();
  const produits = [...new Set(cells.map((c) => c.nom))].sort();
  const marqueDe = (nom) => meta.produits?.[nom]?.[0] ?? "Bestherm";
  const marques = [...new Set(produits.map(marqueDe))].sort();
  const iM = new Map(mp.map((x, j) => [x, j])), iP = new Map(produits.map((x, j) => [x, j])), iK = new Map(marques.map((x, j) => [x, j]));
  return {
    n1: {
      schema: 1, du, au, mp, produits, marques,
      lignes: cells.map((c) => [c.d, iM.get(c.mp), iP.get(c.nom), iK.get(marqueDe(c.nom)), c.qte, r2(c.ca)]),
    },
    stats: { lues, cellules: cells.length, ca: r2(cells.reduce((s, c) => s + c.ca, 0)), inconnus: [...inconnus], mpInconnues: [...mpInconnues] },
  };
}

// Une ligne par enregistrement : diffs Git lisibles
export function serialiser(n1) {
  const l = ["{"];
  const cles = Object.keys(n1);
  cles.forEach((k, j) => {
    const v = n1[k], vg = j < cles.length - 1 ? "," : "";
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
    if (a === "--du") o.du = argv[++j]; else if (a === "--au") o.au = argv[++j]; else if (a === "--out") o.out = argv[++j];
    else if (a.startsWith("--")) throw new Error(`Option inconnue : ${a}`); else o._.push(a);
  }
  if (!o._[0]) { console.error("Usage : node scripts/extension/build_n1.mjs fichier_LIGNE_ODP_2025.csv [--du AAAA-MM-JJ] [--au AAAA-MM-JJ] [--out fichier.json]"); return 1; }
  const src = fs.readFileSync(path.join(RACINE, "App.jsx"), "utf8");
  const app = { abc: constante(src, "ABC_BY_SKU"), produits: constante(src, "SKU_PRODUIT"), mps: constante(src, "SKU_MPS") };
  const meta = JSON.parse(fs.readFileSync(path.join(RACINE, "data", "produits_meta.json"), "utf8"));
  const { n1, stats } = construire(fs.readFileSync(o._[0], "utf8"), { du: o.du, au: o.au, app, meta });
  if (!stats.cellules) throw new Error("Aucune ligne dans la fenêtre demandée : fichier ou dates inattendus");
  const out = o.out ?? path.join(RACINE, "data", "n1_2025.json");
  const texte = serialiser(n1);
  if (JSON.stringify(JSON.parse(texte)) !== JSON.stringify(n1)) throw new Error("Contrôle d'intégrité : le JSON écrit ne se relit pas à l'identique");
  fs.writeFileSync(out, texte);
  console.log(`OK · ${path.relative(RACINE, out)} : ${n1.du} → ${n1.au} · ${stats.lues} lignes ODP → ${stats.cellules} enregistrements · CA HT ${stats.ca} € · ${(texte.length / 1024).toFixed(0)} Ko`);
  if (stats.inconnus.length) console.log(`AVERTISSEMENT · produits hors application : ${stats.inconnus.map(([n, v]) => `${n} (${Math.round(v)} €)`).join(", ")}`);
  if (stats.mpInconnues.length) console.log(`AVERTISSEMENT · marketplaces ignorées : ${stats.mpInconnues.map(([n, v]) => `${n} (${Math.round(v)} €)`).join(", ")}`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exit(main(process.argv.slice(2))); } catch (e) { console.error(`ÉCHEC · ${e.message}`); process.exit(1); }
}
