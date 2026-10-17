#!/usr/bin/env node
/**
 * Lance des requêtes ShopifyQL sur une des deux boutiques (le SITE WEB par défaut, ou les MARKETPLACES = BESTHERM),
 * via le relais en lecture seule (api/mcp-site.mjs déployé sur Vercel). Bibliothèque de refresh_extension.mjs et des
 * scripts d'extraction, et petit outil de diagnostic en ligne de commande ; les résultats s'écrivent au format lu par
 * refresh_extension.mjs (--results-site).
 *
 * Pourquoi un script et pas le connecteur Shopify de Claude : ce connecteur ne sert qu'UNE boutique à la fois ;
 * changer de boutique révoque l'autre, et chaque résultat passerait par la conversation. Le relais est une porte à
 * part, uniquement en lecture : les résultats arrivent dans un fichier, sans transiter par la conversation.
 *
 * Utilisation :
 *   export MCP_SITE_KEY=...                       clé du relais (jamais écrite dans le dépôt)
 *   node scripts/extension/site_query.mjs --info [--boutique site|marketplaces]       identité de la boutique
 *   node scripts/extension/site_query.mjs --query "FROM sales SHOW net_sales SINCE 2026-10-04 UNTIL 2026-10-14"
 *                          [--query ...] [--boutique site|marketplaces] [--concurrence N] [--out resultats.json]
 *
 * Variables : MCP_SITE_KEY (obligatoire) · MCP_SITE_URL (facultatif, défaut : l'adresse de production).
 * La clé voyage dans un en-tête Authorization lu depuis un fichier temporaire (mode 600) : elle n'apparaît ni dans
 * la liste des processus ni dans les messages d'erreur.
 *
 * Codes de sortie : 0 ok · 1 erreur d'utilisation · 2 refus ou erreur du relais / de Shopify (rien d'écrit).
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const execFileP = promisify(execFile);

export const URL_RELAIS = "https://homy-pilotage.vercel.app/api/mcp-site";
// Domaines attendus : protègent contre une lecture de la mauvaise boutique (le relais renvoie le domaine lu).
export const DOMAINES = { site: "besthermshop.myshopify.com", marketplaces: "46a3f9-2.myshopify.com" };
export const DOMAINE_SITE = DOMAINES.site;

export class ErreurRelais extends Error {
  constructor(msg, code = 2) { super(msg); this.code = code; }
}

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

// Une requête HTTP POST vers le relais, avec curl (le proxy de l'environnement est pris en compte par curl).
// Reprises : coupures réseau et erreurs 5xx ; jamais sur un refus (401, 429, 400).
export async function appelerRelais(corps, { url = process.env.MCP_SITE_URL || URL_RELAIS, cle = process.env.MCP_SITE_KEY, essais = 3, delai = 4000 } = {}) {
  if (!cle) throw new ErreurRelais("Variable MCP_SITE_KEY absente : la clé du relais est nécessaire.", 1);
  if (!/^https:\/\/[^/]+\/api\/mcp-site$/.test(url)) throw new ErreurRelais("MCP_SITE_URL doit être de la forme https://<hôte>/api/mcp-site.", 1);
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), "site-query-"));
  let dernier = "";
  try {
    const fEntetes = path.join(dossier, "entetes.txt");
    const fCorps = path.join(dossier, "corps.json");
    fs.writeFileSync(fEntetes, `Authorization: Bearer ${cle}\nContent-Type: application/json\nAccept: application/json, text/event-stream\n`, { mode: 0o600 });
    fs.writeFileSync(fCorps, JSON.stringify(corps), { mode: 0o600 });
    for (let i = 1; i <= essais; i++) {
      try {
        const { stdout: sortie } = await execFileP("curl", ["-sS", "-m", "75", "--fail-with-body", "-H", `@${fEntetes}`, "--data-binary", `@${fCorps}`, url], {
          encoding: "utf8", maxBuffer: 50e6,
        });
        let j;
        try { j = JSON.parse(sortie); } catch { throw new ErreurRelais("Réponse du relais illisible."); }
        return j;
      } catch (e) {
        if (e instanceof ErreurRelais) throw e;
        const corpsErreur = String(e.stdout || "").slice(0, 200);
        const statut = typeof e.code === "number" ? e.code : null; // code de sortie de curl : 22 = HTTP ≥ 400
        dernier = statut === 22 ? `HTTP en erreur : ${corpsErreur}` : `curl code ${statut} : ${String(e.stderr || "").trim().slice(0, 160)}`;
        const http = /"error":"(cle_invalide|trop_de_requetes|non_configure)"/.exec(corpsErreur);
        if (statut === 22 && (http || !/\b5\d\d\b/.test(corpsErreur))) {
          if (http?.[1] === "cle_invalide") throw new ErreurRelais("Le relais refuse la clé (cle_invalide) : vérifier MCP_SITE_KEY.");
          if (http?.[1] === "trop_de_requetes") throw new ErreurRelais("Le relais a bloqué l'adresse après trop de mauvaises clés (trop_de_requetes) : réessayer dans 5 minutes.");
          if (http?.[1] === "non_configure") throw new ErreurRelais("Le relais n'est pas configuré côté Vercel (non_configure).");
          throw new ErreurRelais(dernier);
        }
        if (i < essais) await pause(delai * i);
      }
    }
    throw new ErreurRelais(`Relais injoignable après ${essais} essais (${dernier}).`);
  } finally {
    fs.rmSync(dossier, { recursive: true, force: true });
  }
}

let idRpc = 0;
async function outil(nom, args, opts) {
  const r = await appelerRelais({ jsonrpc: "2.0", id: ++idRpc, method: "tools/call", params: { name: nom, arguments: args } }, opts);
  if (r.error) throw new ErreurRelais(`Erreur du relais : ${r.error.message}`);
  const texte = r.result?.content?.[0]?.text ?? "";
  if (r.result?.isError) throw new ErreurRelais(`Le relais signale : ${texte}`);
  let j;
  try { j = JSON.parse(texte); } catch { throw new ErreurRelais("Réponse d'outil illisible."); }
  return j;
}

const boutiqueDe = (opts) => {
  const b = (opts && opts.boutique) || "site";
  if (!DOMAINES[b]) throw new ErreurRelais(`Boutique inconnue : ${b} (site ou marketplaces).`, 1);
  return b;
};
// Pour la boutique du site, l'argument « boutique » n'est pas envoyé : le relais d'avant la seconde boutique reste compatible.
const argsBoutique = (b) => (b === "site" ? {} : { boutique: b });

export async function infoBoutique(opts) {
  const b = boutiqueDe(opts);
  const i = await outil("get-shop-info", argsBoutique(b), opts);
  if (i.shopDomain !== DOMAINES[b]) throw new ErreurRelais(`Boutique inattendue (${i.shopDomain}) : ${DOMAINES[b]} attendu. Rien n'est lu.`);
  return i;
}

// Exécute les requêtes (opts.concurrence au plus en même temps, 1 par défaut) ; renvoie les résultats {query, columns, rows,
// shopDomain} dans l'ordre des requêtes. opts.surResultat(i, résultat) est appelé à chaque résultat (suivi, sauvegarde).
export async function lancerRequetes(requetes, opts = {}) {
  const b = boutiqueDe(opts);
  const conc = Math.max(1, Math.min(8, Number(opts.concurrence) || 1));
  const resultats = new Array(requetes.length);
  let suivant = 0, echec = null;
  const ouvrier = async () => {
    while (!echec) {
      const i = suivant++;
      if (i >= requetes.length) return;
      try {
        const q = requetes[i];
        const r = await outil("run-analytics-query", { query: q, ...argsBoutique(b) }, opts);
        if (r.shopDomain !== DOMAINES[b]) throw new ErreurRelais(`Boutique inattendue (${r.shopDomain}) : ${DOMAINES[b]} attendu. Résultat écarté.`);
        if (r.query !== q) throw new ErreurRelais("Le relais a renvoyé une autre requête que celle demandée.");
        if (!Array.isArray(r.columns) || !Array.isArray(r.rows)) throw new ErreurRelais("Résultat sans colonnes ni lignes.");
        resultats[i] = r;
        if (opts.surResultat) opts.surResultat(i, r);
      } catch (e) { echec = echec || e; }
    }
  };
  await Promise.all(Array.from({ length: conc }, ouvrier));
  if (echec) throw echec;
  return resultats;
}

function args(argv) {
  const o = { queries: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--query") o.queries.push(argv[++i]);
    else if (a === "--out") o.out = argv[++i];
    else if (a === "--info") o.info = true;
    else if (a === "--boutique") o.boutique = argv[++i];
    else if (a === "--concurrence") o.concurrence = Number(argv[++i]);
    else throw new ErreurRelais(`Option inconnue : ${a}`, 1);
  }
  return o;
}

async function main() {
  const o = args(process.argv.slice(2));
  const opts = { boutique: o.boutique || "site", concurrence: o.concurrence };
  if (o.info) {
    const i = await infoBoutique(opts);
    console.log(JSON.stringify(i, null, 2));
    return 0;
  }
  const requetes = o.queries;
  if (!requetes.length) throw new ErreurRelais("Rien à faire : --info ou --query attendu.", 1);
  await infoBoutique(opts); // vérifie la boutique avant toute lecture
  const resultats = await lancerRequetes(requetes, opts);
  const texte = JSON.stringify(resultats);
  if (o.out) { fs.writeFileSync(o.out, texte + "\n", { mode: 0o600 }); console.log(`OK · ${resultats.length} résultat(s) écrit(s) dans ${o.out}`); }
  else console.log(JSON.stringify(resultats, null, 2));
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((c) => process.exit(c), (e) => {
    if (e instanceof ErreurRelais) { console.error(`ÉCHEC · ${e.message}`); process.exit(e.code); }
    console.error(e); process.exit(1);
  });
}
