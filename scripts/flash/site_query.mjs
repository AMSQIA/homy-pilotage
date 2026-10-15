#!/usr/bin/env node
/**
 * Lance des requêtes ShopifyQL sur la boutique du SITE WEB, via le relais en lecture seule (api/mcp-site.mjs
 * déployé sur Vercel), et écrit les résultats au format lu par refresh_flash.mjs (--results).
 *
 * Pourquoi un script et pas le connecteur Shopify de Claude : ce connecteur ne sert qu'UNE boutique à la fois
 * (BESTHERM, les marketplaces) ; changer de boutique révoque l'autre. Le relais est une porte à part, uniquement
 * en lecture, qui ne voit que la boutique du site.
 *
 * Utilisation :
 *   export MCP_SITE_KEY=...                       clé du relais (jamais écrite dans le dépôt)
 *   node scripts/flash/site_query.mjs --info                                   identité de la boutique
 *   node scripts/flash/site_query.mjs --query "FROM sales SHOW net_sales SINCE 2026-10-04 UNTIL 2026-10-14"
 *                                     [--query ...] [--out resultats.json]     requêtes libres
 *   node scripts/flash/site_query.mjs --plan --today AAAA-MM-JJ --out resultats.json
 *                                                    exécute le plan du Flash « site » (refresh_flash.mjs plan)
 *
 * Variables : MCP_SITE_KEY (obligatoire) · MCP_SITE_URL (facultatif, défaut : l'adresse de production).
 * La clé voyage dans un en-tête Authorization lu depuis un fichier temporaire (mode 600) : elle n'apparaît ni dans
 * la liste des processus ni dans les messages d'erreur.
 *
 * Codes de sortie : 0 ok · 1 erreur d'utilisation · 2 refus ou erreur du relais / de Shopify (rien d'écrit).
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const URL_RELAIS = "https://homy-pilotage.vercel.app/api/mcp-site";
export const DOMAINE_SITE = "besthermshop.myshopify.com"; // protège contre une lecture de la mauvaise boutique

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
        const sortie = execFileSync("curl", ["-sS", "-m", "75", "--fail-with-body", "-H", `@${fEntetes}`, "--data-binary", `@${fCorps}`, url], {
          encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 50e6,
        });
        let j;
        try { j = JSON.parse(sortie); } catch { throw new ErreurRelais("Réponse du relais illisible."); }
        return j;
      } catch (e) {
        if (e instanceof ErreurRelais) throw e;
        const corpsErreur = String(e.stdout || "").slice(0, 200);
        const statut = e.status; // code de sortie de curl : 22 = HTTP ≥ 400
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

export async function infoBoutique(opts) {
  const i = await outil("get-shop-info", {}, opts);
  if (i.shopDomain !== DOMAINE_SITE) throw new ErreurRelais(`Boutique inattendue (${i.shopDomain}) : ${DOMAINE_SITE} attendu. Rien n'est lu.`);
  return i;
}

// Exécute les requêtes dans l'ordre ; renvoie les résultats {query, columns, rows, shopDomain}
export async function lancerRequetes(requetes, opts) {
  const resultats = [];
  for (const q of requetes) {
    const r = await outil("run-analytics-query", { query: q }, opts);
    if (r.shopDomain !== DOMAINE_SITE) throw new ErreurRelais(`Boutique inattendue (${r.shopDomain}) : ${DOMAINE_SITE} attendu. Résultat écarté.`);
    if (r.query !== q) throw new ErreurRelais("Le relais a renvoyé une autre requête que celle demandée.");
    if (!Array.isArray(r.columns) || !Array.isArray(r.rows)) throw new ErreurRelais("Résultat sans colonnes ni lignes.");
    resultats.push(r);
  }
  return resultats;
}

function args(argv) {
  const o = { queries: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--query") o.queries.push(argv[++i]);
    else if (a === "--out") o.out = argv[++i];
    else if (a === "--today") o.today = argv[++i];
    else if (a === "--info") o.info = true;
    else if (a === "--plan") o.plan = true;
    else throw new ErreurRelais(`Option inconnue : ${a}`, 1);
  }
  return o;
}

async function main() {
  const o = args(process.argv.slice(2));
  if (o.info) {
    const i = await infoBoutique();
    console.log(JSON.stringify(i, null, 2));
    return 0;
  }
  let requetes = o.queries;
  if (o.plan) {
    // Le plan du Flash « site » vient de refresh_flash.mjs (même fenêtre de dates que la boutique des marketplaces)
    const { lirePlan, Echec } = await import("./refresh_flash.mjs");
    let plan;
    try { plan = lirePlan("site", o.today); } catch (e) { if (e instanceof Echec) throw new ErreurRelais(e.message, 1); throw e; }
    if (plan.vide) { console.log(`Plan vide : l'ODP couvre déjà jusqu'à hier (${plan.au}). Aucune requête.`); if (o.out) fs.writeFileSync(o.out, "[]\n"); return 0; }
    requetes = plan.queries.map((q) => q.query);
  }
  if (!requetes.length) throw new ErreurRelais("Rien à faire : --info, --query ou --plan attendu.", 1);
  await infoBoutique(); // vérifie la boutique avant toute lecture
  const resultats = await lancerRequetes(requetes);
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
