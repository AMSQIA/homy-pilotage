/**
 * Lecture des constantes de App.jsx pour les tests (selftest.mjs, smoke.mjs) : chaque constante tient sur une ligne
 * « const NOM = …; », en JSON ou en littéral JavaScript simple. Chaque appel renvoie des copies fraîches.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export const CONSTANTES_EXTENSION = [
  "DATA", "SKU_PRODUIT", "SKU_MPS", "SKU_MONTHLY", "SKU_DESTOCKAGE", "SKU_FAMILLE", "SKU_WIFI", "SKU_PLINTHE", "SKU_VERTICAL",
  "SKU_SOUS_FAMILLE", "SKU_SOUS_SOUS_FAMILLE", "PRODUCT_TO_CATEGORY", "PAYS_MONTHLY", "SKU_CUT_N1",
  "WEEKLY_TOTALS", "WEEKLY_BY_MP", "WEEKLY_BY_PROD",
];

export function lireApp(chemin = path.join(RACINE, "App.jsx")) {
  const src = fs.readFileSync(chemin, "utf8");
  const dates = /const DMIN = "(\d{4}-\d{2}-\d{2})", DMAX_ODP = "(\d{4}-\d{2}-\d{2})";/.exec(src);
  if (!dates) throw new Error("App.jsx : déclaration « const DMIN = …, DMAX_ODP = …; » introuvable");
  const constante = (nom) => {
    const m = new RegExp(`^const ${nom} = (.*);[ \\t]*$`, "m").exec(src);
    if (!m) throw new Error(`App.jsx : constante ${nom} introuvable`);
    try { return JSON.parse(m[1]); } catch { return new Function(`return (${m[1]});`)(); }
  };
  return { src, dmin: dates[1], dmaxOdp: dates[2], constante, constantes: (noms = CONSTANTES_EXTENSION) => Object.fromEntries(noms.map((n) => [n, constante(n)])) };
}

export const lireJson = (relatif) => JSON.parse(fs.readFileSync(path.join(RACINE, relatif), "utf8"));
export const copie = (x) => JSON.parse(JSON.stringify(x));
