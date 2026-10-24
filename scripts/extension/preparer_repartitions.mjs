#!/usr/bin/env node
/**
 * Prépare les deux données que l'onglet « Répartitions » (Marques) ajoute aux constantes de App.jsx :
 *
 *   1. SKU_MARQUE : la marque de chaque produit (tableau parallèle à SKU_PRODUIT, d'après data/produits_meta.json) ;
 *   2. PAYS_MONTHLY : la quantité vendue ajoutée en 6e élément des lignes 2026 — [pays, marketplace, année, mois, CA HT, quantité] —
 *      recalculée depuis l'export « LIGNES ODP 2026 » (le détail par pays du socle ne portait que le CA).
 *
 * Utilisation (à relancer seulement si le socle ODP est remplacé par un nouvel export) :
 *   node scripts/extension/preparer_repartitions.mjs fichier_LIGNES_ODP_2026.csv [--ecrire]
 *
 * Sans --ecrire, le script vérifie et affiche le résultat sans toucher à App.jsx. Il refuse d'écrire si le CA par (pays, marketplace, mois)
 * recalculé depuis le CSV diffère de PAYS_MONTHLY de plus d'un centime : c'est la preuve que le CSV est bien celui du socle.
 * Les lignes 2025 n'ont pas de quantité (le fichier source ne détaille pas les pays en 2025) : elles restent à 5 éléments.
 */
import fs from "node:fs";
import path from "node:path";
import { lireCsv } from "./build_n1.mjs";
import { lireApp, lireJson, RACINE } from "./lib_app.mjs";

const cle = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
const MP_ALIAS = {
  amazon: "Amazon FR", amazonfr: "Amazon FR", autre: "Autre", bol: "Bol.com", bolcom: "Bol.com", boulanger: "Boulanger",
  bricobravo: "Brico Bravo", bricomarche: "Bricomarché", bricoman: "Bricoman", but: "But", castorama: "Castorama",
  cdiscount: "Cdiscount", darty: "Darty", leroymerlin: "Leroy Merlin", manomano: "ManoMano", maxeda: "Maxeda",
  siteweb: "Site Web", worten: "Worten",
};
const PAYS_ALIAS = { UK: "Royaume-Uni" };
const num = (s) => { const v = parseFloat(String(s).replace(",", ".")); return Number.isFinite(v) ? v : 0; };
const anMois = (s) => {
  const t = String(s).trim();
  let m = t.match(/^(\d{2})\/(\d{2})\/(\d{4})/); if (m) return [Number(m[3]), Number(m[2])];
  m = t.match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? [Number(m[1]), Number(m[2])] : null;
};

export function quantitesParPays(csv) {
  const { idx, rows } = lireCsv(csv);
  const col = (nom) => { const i = idx[nom]; if (i === undefined) throw new Error(`colonne « ${nom} » introuvable dans le CSV`); return i; };
  const iQ = col("Qté"), iD = col("Date"), iCA = col("CA HT"), iMp = col("Market place"), iP = col("PAYS");
  const agg = new Map();
  for (const r of rows) {
    const am = anMois(r[iD]);
    if (!am) throw new Error(`date illisible : ${r[iD]}`);
    const mp = MP_ALIAS[cle(r[iMp])];
    if (!mp) throw new Error(`marketplace inconnue : ${r[iMp]}`);
    const pays = PAYS_ALIAS[r[iP]] || r[iP];
    const k = `${pays}|${mp}|${am[0]}|${am[1]}`;
    const a = agg.get(k) || { ca: 0, qte: 0 };
    a.ca += num(r[iCA]); a.qte += num(r[iQ]);
    agg.set(k, a);
  }
  return agg;
}

function main() {
  const args = process.argv.slice(2);
  const fichier = args.find((a) => !a.startsWith("--"));
  const ecrire = args.includes("--ecrire");
  if (!fichier) { console.error("Usage : node scripts/extension/preparer_repartitions.mjs fichier_LIGNES_ODP_2026.csv [--ecrire]"); process.exit(2); }
  const app = lireApp();
  const C = app.constantes(["SKU_PRODUIT", "PAYS_MONTHLY"]);
  const meta = lireJson("data/produits_meta.json");

  // 1. marque de chaque produit
  const marques = C.SKU_PRODUIT.map((n) => (meta.produits[n] || [null])[0]);
  const sans = C.SKU_PRODUIT.filter((n, i) => !marques[i]);
  if (sans.length) { console.error(`Produits sans marque dans data/produits_meta.json : ${sans.join(", ")}`); process.exit(1); }

  // 2. quantités par pays (2026)
  const agg = quantitesParPays(fs.readFileSync(fichier, "utf8"));
  let cellules = 0, ecarts = 0;
  const lignes = C.PAYS_MONTHLY.map((r) => {
    const [pays, mp, an, mois, ca] = r;
    if (an !== 2026) return r.slice(0, 5);
    const a = agg.get(`${pays}|${mp}|${an}|${mois}`);
    cellules++;
    if (!a) { ecarts++; console.error(`absent du CSV : ${pays} · ${mp} · ${an}-${mois}`); return r.slice(0, 5); }
    if (Math.abs(a.ca - ca) > 0.011) { ecarts++; console.error(`écart de CA ${pays} · ${mp} · ${mois} : ${ca} (App.jsx) ≠ ${a.ca.toFixed(2)} (CSV)`); }
    agg.delete(`${pays}|${mp}|${an}|${mois}`);
    return [pays, mp, an, mois, ca, a.qte];
  });
  const enPlus = [...agg.keys()];
  if (enPlus.length) { ecarts += enPlus.length; console.error(`dans le CSV mais pas dans PAYS_MONTHLY : ${enPlus.slice(0, 5).join(" ; ")}`); }
  const qte = lignes.reduce((s, r) => s + (r[5] || 0), 0);
  console.log(`SKU_MARQUE : ${marques.length} produits · ${[...new Set(marques)].join(", ")}`);
  console.log(`PAYS_MONTHLY : ${cellules} lignes 2026 rapprochées du CSV, ${ecarts} écart(s) · ${qte} unités`);
  if (ecarts) { console.error("Écarts : App.jsx non modifié."); process.exit(1); }
  if (!ecrire) { console.log("(simulation — relancer avec --ecrire pour modifier App.jsx)"); return; }

  let src = app.src;
  const ligneMarque = `const SKU_MARQUE = ${JSON.stringify(marques)};`;
  if (/^const SKU_MARQUE = .*;[ \t]*$/m.test(src)) src = src.replace(/^const SKU_MARQUE = .*;[ \t]*$/m, () => ligneMarque);
  else {
    const re = /^(const SKU_SOUS_SOUS_FAMILLE = .*;[ \t]*)$/m;
    if (!re.test(src)) throw new Error("ancre SKU_SOUS_SOUS_FAMILLE introuvable dans App.jsx");
    src = src.replace(re, (m) => `${m}\n\n// SKU_MARQUE : marque de chaque produit (tableau parallèle à SKU_PRODUIT, d'après data/produits_meta.json) — onglet Répartitions.\n${ligneMarque}`);
  }
  const lignePays = `const PAYS_MONTHLY = ${JSON.stringify(lignes)};`;
  if (!/^const PAYS_MONTHLY = .*;[ \t]*$/m.test(src)) throw new Error("ligne PAYS_MONTHLY introuvable dans App.jsx");
  src = src.replace(/^const PAYS_MONTHLY = .*;[ \t]*$/m, () => lignePays);
  // le commentaire de PAYS_MONTHLY décrit désormais 6 éléments pour 2026
  src = src.replace("[pays, marketplace, année, mois, ca]. PAYS_OBJECTIF :", "[pays, marketplace, année, mois, ca, quantité] (quantité : 2026 seulement, absente en 2025). PAYS_OBJECTIF :");
  fs.writeFileSync(path.join(RACINE, "App.jsx"), src);
  console.log("App.jsx mis à jour (SKU_MARQUE + quantités par pays 2026).");
}

if (process.argv[1] && process.argv[1].endsWith("preparer_repartitions.mjs")) main();
