/**
 * Collecte des résultats ShopifyQL des deux boutiques.
 *
 * Trois sources, toutes en lecture seule et sans donnée client :
 *   - le relais (api/mcp-site.mjs, variable MCP_SITE_KEY) : les requêtes partent d'un script, les résultats arrivent dans un
 *     fichier, sans transiter par la conversation. Sert les deux boutiques (« boutique » = site | marketplaces) ;
 *   - la transcription de la session de Claude : résultats du connecteur Shopify (une boutique à la fois), relus tels quels,
 *     utilisés pour BESTHERM quand le relais n'est pas (encore) configuré pour cette boutique ;
 *   - des fichiers de résultats (--results-site), pour les tests et les reprises.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { CFG, Echec, LimiteAtteinte, addDays, fenetres, requetesFenetre, traiterBoutique, agreger } from "./transformer.mjs";
import { infoBoutique, lancerRequetes, ErreurRelais, DOMAINES } from "./site_query.mjs";

export const BOUTIQUES = {
  marketplaces: { id: "marketplaces", nom: "BESTHERM", domaine: DOMAINES.marketplaces, domaineObligatoire: false, debut: "2024-01-01" },
  site: { id: "site", nom: "bestherm.fr", domaine: DOMAINES.site, domaineObligatoire: true, debut: "2025-05-01" },
};

/* ------------------------------------------------------------------ résultats ShopifyQL déjà produits (transcription, fichiers) */
function* fichiersTranscription(explicites) {
  if (explicites.length) { yield* explicites; return; }
  const racines = [...new Set([
    process.env.CLAUDE_CONFIG_DIR, path.join(os.homedir(), ".claude"), "/root/.claude", "/home/claude/.claude",
  ].filter(Boolean).map((d) => path.join(d, "projects")))];
  const trouves = [];
  const parcourir = (d, prof = 0) => {
    let ents = [];
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const p = path.join(d, e.name);
      if (e.isDirectory() && prof < 3) parcourir(p, prof + 1);
      else if (e.isFile() && e.name.endsWith(".jsonl")) trouves.push([p, fs.statSync(p).mtimeMs]);
    }
  };
  for (const r of racines) parcourir(r);
  trouves.sort((a, b) => b[1] - a[1]);
  for (const [p] of trouves) yield p;
}

// Résultats rangés par boutique ET texte de requête : deux boutiques ne s'écrasent jamais
const cle = (domaine, query) => `${domaine ?? ""}\u0000${query}`;
const ranger = (res, r) => res.set(cle(r.shopDomain, r.query), r);

function lireJsonl(fichier, res) {
  let lignes;
  try { lignes = fs.readFileSync(fichier, "utf8").split("\n"); } catch { return; }
  for (const l of lignes) {
    if (!l.includes('"tool_result"') || !l.includes("rows")) continue;
    let o; try { o = JSON.parse(l); } catch { continue; }
    const c = o?.message?.content;
    if (!Array.isArray(c)) continue;
    for (const b of c) {
      if (b?.type !== "tool_result") continue;
      const texte = typeof b.content === "string" ? b.content : Array.isArray(b.content) ? b.content.map((x) => x?.text ?? "").join("") : "";
      if (!texte.startsWith('{"query"')) continue;
      let j; try { j = JSON.parse(texte); } catch { continue; }
      if (typeof j.query === "string" && Array.isArray(j.rows) && Array.isArray(j.columns)) ranger(res, j);
    }
  }
}

function lireJson(fichier, res) {
  let j;
  try { j = JSON.parse(fs.readFileSync(fichier, "utf8")); } catch { throw new Echec(`Fichier de résultats illisible : ${fichier}`, 1); }
  for (const r of Array.isArray(j) ? j : [j]) if (typeof r?.query === "string" && Array.isArray(r.rows)) ranger(res, r);
}

/**
 * Index des résultats disponibles pour les requêtes demandées. `requetes` = textes de requêtes dont on a besoin :
 * la lecture des transcriptions s'arrête dès qu'elles sont toutes trouvées (le fichier le plus récent prime).
 */
export function lireResultats({ fichiers = [], transcripts = [] }, boutique, requetes) {
  const b = BOUTIQUES[boutique];
  const trouver = (res, q) => res.get(cle(b.domaine, q)) ?? (b.domaineObligatoire ? undefined : res.get(cle(undefined, q)));
  const brut = new Map();
  for (const f of fichiers) lireJson(f, brut);
  if (!fichiers.length) {
    for (const f of fichiersTranscription(transcripts)) {
      const r = new Map();
      lireJsonl(f, r);
      for (const [k, v] of r) if (!brut.has(k)) brut.set(k, v);
      if (requetes.every((q) => trouver(brut, q))) break;
    }
  }
  return { trouver: (q) => trouver(brut, q), b };
}

// Résultats d'une fenêtre depuis un index (transcription ou fichiers) ; Echec(3) avec la liste des requêtes manquantes
export function jeuxDepuisIndex(index, boutique, w, aujourdhui) {
  const qs = requetesFenetre(boutique, w, aujourdhui);
  const absents = qs.filter((q) => !index.trouver(q.query));
  if (absents.length) {
    throw new Echec(
      `Résultats ShopifyQL manquants (boutique ${boutique}, ${index.b.domaine}) pour : ${absents.map((q) => q.id).join(", ")}. ` +
      "Lancer exactement les requêtes affichées par la commande « plan » (même --today, mêmes options).", 3);
  }
  const jeux = { ventes: [], paiements: [], controle: [] };
  for (const q of qs) {
    const r = index.trouver(q.query);
    const ok = index.b.domaineObligatoire ? r.shopDomain === index.b.domaine : !r.shopDomain || r.shopDomain === index.b.domaine;
    if (!ok) throw new Echec(`Boutique inattendue (${r.shopDomain ?? "non indiquée"}) : ${index.b.domaine} attendu. Aucune écriture.`);
    jeux[q.id.startsWith("ventes") ? "ventes" : q.id.startsWith("paiements") ? "paiements" : "controle"].push(r);
  }
  return jeux;
}

/* ------------------------------------------------------------------ relais */
// { ok: true } ou { ok: false, raison, absent } ; absent = relais non configuré pour cette boutique (repli possible)
export async function etatRelais(boutique) {
  if (!process.env.MCP_SITE_KEY) return { ok: false, absent: true, raison: "variable MCP_SITE_KEY absente" };
  try { await infoBoutique({ boutique }); return { ok: true }; }
  catch (e) {
    if (!(e instanceof ErreurRelais)) throw e;
    return { ok: false, absent: /non configur/i.test(e.message), raison: e.message, code: e.code };
  }
}

const clefCache = (domaine, q) => crypto.createHash("sha1").update(`${domaine}\u0000${q}`).digest("hex");

// Lance les requêtes (celles déjà en cache sont relues) ; renvoie les résultats dans l'ordre
export async function lancerAvecCache(boutique, requetes, { cache, concurrence = 1 } = {}) {
  const domaine = BOUTIQUES[boutique].domaine;
  const res = new Array(requetes.length);
  const aFaire = [];
  requetes.forEach((q, i) => {
    if (cache) {
      const f = path.join(cache, `${clefCache(domaine, q)}.json`);
      if (fs.existsSync(f)) { try { res[i] = JSON.parse(fs.readFileSync(f, "utf8")); return; } catch { /* cache illisible : on refait */ } }
    }
    aFaire.push(i);
  });
  if (aFaire.length) {
    await lancerRequetes(aFaire.map((i) => requetes[i]), {
      boutique, concurrence,
      surResultat: (k, r) => {
        res[aFaire[k]] = r;
        if (cache) { fs.mkdirSync(cache, { recursive: true }); const f = path.join(cache, `${clefCache(domaine, requetes[aFaire[k]])}.json`); fs.writeFileSync(f + ".tmp", JSON.stringify(r)); fs.renameSync(f + ".tmp", f); }
      },
    });
  }
  return res;
}

export async function jeuxRelais(boutique, w, aujourdhui, opts) {
  const qs = requetesFenetre(boutique, w, aujourdhui);
  const res = await lancerAvecCache(boutique, qs.map((q) => q.query), opts);
  const jeux = { ventes: [], paiements: [], controle: [] };
  qs.forEach((q, i) => jeux[q.id.startsWith("ventes") ? "ventes" : q.id.startsWith("paiements") ? "paiements" : "controle"].push(res[i]));
  return jeux;
}

/* ------------------------------------------------------------------ boucle sur les fenêtres */
async function pool(taches, n, f) {
  const out = new Array(taches.length);
  let suivant = 0, echec = null;
  const ouvrier = async () => {
    while (!echec) {
      const i = suivant++;
      if (i >= taches.length) return;
      try { out[i] = await f(taches[i], i); } catch (e) { echec = echec || e; }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, n) }, ouvrier));
  if (echec) throw echec;
  return out;
}

// Une fenêtre est « trop lourde » quand la liste est tronquée par la limite de lignes, ou quand le relais signale un délai dépassé
// ou une réponse trop volumineuse (Shopify trop lent, plate-forme Vercel) : la couper en deux la rend plus légère. Les autres
// erreurs (clé refusée, boutique inattendue, réseau coupé…) ne dépendent pas de la taille et remontent telles quelles.
const TROP_LOURD = /trop de temps|Shopify injoignable|n'a pas répondu|TIMEOUT|timeout|PAYLOAD|too large|trop volumineu/i;
export const fenetreTropLourde = (e) => e instanceof LimiteAtteinte || (e instanceof ErreurRelais && TROP_LOURD.test(e.message));

/**
 * Collecte et transforme toute la période d'une boutique.
 * ctx = { ref, aujourdhui, jeux(w) → {ventes, paiements, controle}, decoupable, concurrence, depuisPaires, log }
 * Une fenêtre trop lourde (liste tronquée, délai dépassé) est coupée en deux quand `decoupable` (relais) ; sinon l'échec remonte.
 */
export async function collecterBoutique(id, { du, au }, ctx) {
  const traiterFenetre = async (w) => {
    try {
      const jeux = await ctx.jeux(w);
      return [traiterBoutique(id, jeux, ctx.ref, { du: w.du, au: w.au, depuisPaires: ctx.depuisPaires })];
    } catch (e) {
      if (!fenetreTropLourde(e) || !ctx.decoupable) throw e;
      if (w.du === w.au) throw new Echec(`${id} ${w.du} : une seule journée est trop lourde (${e.message}).`);
      const n = Math.round((new Date(w.au) - new Date(w.du)) / 864e5) + 1, moitie = Math.floor(n / 2);
      const milieu = addDays(w.du, moitie - 1);
      if (ctx.log) ctx.log(`${id} ${w.du} → ${w.au} : fenêtre trop lourde, coupée en deux`);
      return [...await traiterFenetre({ du: w.du, au: milieu }), ...await traiterFenetre({ du: addDays(milieu, 1), au: w.au })];
    }
  };
  const fens = fenetres(du, au);
  let faites = 0;
  const sorties = await pool(fens, ctx.concurrence ?? 1, async (w) => {
    const s = await traiterFenetre(w);
    faites++;
    if (ctx.log) ctx.log(`${id} ${w.du} → ${w.au} : ${s.reduce((t, x) => t + x.lignes.length, 0)} enregistrements (${faites}/${fens.length})`);
    return s;
  });
  return agreger(sorties.flat());
}
