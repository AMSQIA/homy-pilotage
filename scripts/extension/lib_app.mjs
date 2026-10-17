/**
 * Outils communs aux tests (selftest.mjs, selftest_pipeline.mjs, smoke.mjs) : racine du dépôt, lecture des fichiers de données
 * et construction du tableau de bord exactement comme l'application le fait au chargement (socle.js).
 *
 * La racine est celle du dépôt ; elle peut être remplacée (variable HOMY_RACINE ou option --racine des tests) pour tester
 * une copie du dépôt, par exemple avec un jeu de données de développement.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { construire } from "../../socle.js";

export const RACINE = path.resolve(process.env.HOMY_RACINE || path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".."));

export const lireJson = (relatif, racine = RACINE) => JSON.parse(fs.readFileSync(path.join(racine, relatif), "utf8"));
export const copie = (x) => JSON.parse(JSON.stringify(x));

/** Les trois fichiers de données du tableau de bord (copies fraîches). */
export function lireDonnees(racine = RACINE) {
  return {
    ext: lireJson("shopify_extension.json", racine),
    ref: lireJson("data/referentiel.json", racine),
    hors: lireJson("data/hors_shopify.json", racine),
  };
}

/** Tableau de bord tel que l'application le construit au chargement (rapport + constantes C). */
export function construireDepuisDepot(racine = RACINE) {
  const { ext, ref, hors } = lireDonnees(racine);
  return { ext, ref, hors, rap: construire(ext, ref, { horsShopify: hors }) };
}
