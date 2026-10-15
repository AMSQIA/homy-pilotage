#!/usr/bin/env node
/**
 * Test du connecteur MCP « boutique du site » (api/mcp-site.mjs), sans réseau : Shopify est simulé.
 *
 *   node scripts/flash/test_mcp_site.mjs [--verbose]
 *
 * Vérifie : protocole MCP (initialize, tools/list, tools/call, lots, notifications), accès (clé, limite d'essais),
 * outils (get-shop-info, run-analytics-query), format de sortie lu par le script du Flash, refus de requêtes
 * (données personnelles, jeux non autorisés), reprises (jeton expiré, limitation de débit, erreurs 5xx) et absence
 * de fuite de secret dans les réponses et dans le journal.
 *
 * Séparé de selftest.mjs : un défaut ici ne doit jamais bloquer le rafraîchissement quotidien du Flash.
 * Codes de sortie : 0 ok · 2 échec.
 */
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Readable } from "node:stream";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { default: handler } = await import(pathToFileURL(path.join(__dirname, "..", "..", "api", "mcp-site.mjs")).href);

/* ------------------------------------------------------------------ outillage */
const bilan = [];
const check = (nom, cond, detail = "") => { bilan.push({ nom, ok: Boolean(cond), detail: cond ? "" : String(detail).slice(0, 400) }); };
const egal = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Le connecteur journalise en JSON (console.log) : on capte ces lignes pour vérifier qu'elles ne contiennent aucun secret.
const logReel = console.log.bind(console);
const lignesJournal = [];
console.log = (...a) => { lignesJournal.push(a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ")); };

const CLES_ENV = ["MCP_SITE_KEY", "SHOPIFY_SITE_SHOP", "SHOPIFY_SITE_CLIENT_ID", "SHOPIFY_SITE_CLIENT_SECRET", "SHOPIFY_SITE_TOKEN", "SHOPIFY_SITE_API_VERSION", "MCP_SITE_RETRY_MS", "MCP_SITE_BUDGET_MS"];
const CLE = "cle-de-test-0123456789-abcdefghij-KLMNOP"; // 24 caractères au minimum
const SECRET = "secret-appli-ZZ-4815162342";
let nApp = 0;
function env(extra = {}) {
  for (const k of CLES_ENV) delete process.env[k];
  // identifiant d'application différent à chaque scénario : le cache de jetons du connecteur ne passe pas d'un scénario à l'autre
  Object.assign(process.env, { MCP_SITE_KEY: CLE, SHOPIFY_SITE_SHOP: "site-test", SHOPIFY_SITE_CLIENT_ID: `app-test-${++nApp}`, SHOPIFY_SITE_CLIENT_SECRET: SECRET, MCP_SITE_RETRY_MS: "1" });
  for (const [k, v] of Object.entries(extra)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
}

/* ------------------------------------------------------------------ Shopify simulé */
const vraiFetch = globalThis.fetch;
let appels = [];            // appels sortants vers *.myshopify.com
let file = [];              // réponses simulées, dans l'ordre ; chaque élément : Response, Error ou fonction (appel) => Response | Error
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (!/^https:\/\/[^/]*\.myshopify\.com\//.test(u)) return vraiFetch(url, init); // le reste passe (test avec un vrai client MCP)
  const appel = {
    url: u, methode: init.method || "GET", corps: String(init.body ?? ""), signal: init.signal,
    entetes: Object.fromEntries(Object.entries(init.headers || {}).map(([k, v]) => [k.toLowerCase(), v])),
  };
  appels.push(appel);
  const etape = file.shift();
  if (etape === undefined) throw new Error("appel Shopify inattendu : " + u);
  const r = typeof etape === "function" ? etape(appel) : etape;
  if (r instanceof Error) throw r;
  return r;
};
const reset = () => { appels = []; file = []; };
const rep = (statut, corps) => new Response(typeof corps === "string" ? corps : JSON.stringify(corps), { status: statut, headers: { "content-type": "application/json" } });
const jeton = (v = "jt-1", exp = 86399) => () => rep(200, { access_token: v, scope: "read_reports", expires_in: exp });
const INFO = {
  shop: { name: "HOM'Y – site", myshopifyDomain: "site-test.myshopify.com", primaryDomain: { host: "www.hom-y.fr" }, currencyCode: "EUR", ianaTimezone: "Europe/Paris" },
  currentAppInstallation: { accessScopes: [{ handle: "read_reports" }] },
};
const repInfo = () => rep(200, { data: INFO });
const repTableau = (columns, rows, parseErrors = []) => () =>
  rep(200, { data: { shop: { myshopifyDomain: "site-test.myshopify.com" }, shopifyqlQuery: { tableData: { columns, rows }, parseErrors } } });
const consomme = (nom) => check(`${nom} · toutes les réponses Shopify simulées ont été utilisées`, file.length === 0, `restantes : ${file.length}`);

/* ------------------------------------------------------------------ requêtes / réponses simulées */
let nIp = 0;
const nouvelleIp = () => `10.1.${Math.floor(++nIp / 250)}.${nIp % 250}`;
function requete({ methode = "POST", url = "/api/mcp-site", query, entetes = {}, corps, brut, ip, cle = CLE } = {}) {
  const req = {
    method: methode, url,
    query: query ?? (cle ? { key: cle } : {}),
    headers: { "content-type": "application/json", "x-forwarded-for": ip ?? nouvelleIp(), ...entetes },
    socket: {},
  };
  if (brut !== undefined) req.body = brut; else if (corps !== undefined) req.body = corps;
  return req;
}
function reponseMock() {
  const r = {
    statusCode: 200, entetes: {}, corps: undefined,
    setHeader(k, v) { r.entetes[k.toLowerCase()] = v; },
    status(c) { r.statusCode = c; return r; },
    json(o) { r.corps = o; return r; },
    end(x) { if (x !== undefined) r.corps = x; return r; },
  };
  return r;
}
async function appeler(req) { const res = reponseMock(); await handler(req, res); return res; }

let idRpc = 0;
const rpc = (method, params) => ({ jsonrpc: "2.0", id: ++idRpc, method, ...(params !== undefined ? { params } : {}) });
const notif = (method) => ({ jsonrpc: "2.0", method });
const envoyer = (message, options = {}) => appeler(requete({ corps: message, ...options }));
const outil = (nom, args, options) => envoyer(rpc("tools/call", { name: nom, arguments: args }), options);
const texteOutil = (res) => res.corps?.result?.content?.[0]?.text;
const jsonOutil = (res) => { try { return JSON.parse(texteOutil(res)); } catch { return null; } };
const enErreur = (res) => res.statusCode === 200 && res.corps?.result?.isError === true;

async function scenario(nom, fn) {
  try { reset(); await fn(); } catch (e) { check(`${nom} · exécution du scénario`, false, String(e?.stack || e).split("\n").slice(0, 3).join(" / ")); }
}

/* ------------------------------------------------------------------ données de référence */
const Q_JOURS = "FROM sales SHOW orders, quantity_ordered, net_sales, taxes TIMESERIES day SINCE 2026-10-04 UNTIL 2026-10-13";
const COLS = [
  { name: "day", dataType: "DAY_TIMESTAMP", displayName: "Day" }, { name: "orders", dataType: "NUMBER", displayName: "Orders" },
  { name: "quantity_ordered", dataType: "NUMBER", displayName: "Quantity ordered" }, { name: "net_sales", dataType: "MONEY", displayName: "Net sales" },
  { name: "taxes", dataType: "MONEY", displayName: "Taxes" },
];
const LIGNES = [["2026-10-04", "225", "357", "35370.6", "6185.05"], ["2026-10-05", "240", "380", "36000", "6300"]];

/* ================================================================== A · sonde GET */
await scenario("A", async () => {
  env();
  let r = await appeler(requete({ methode: "GET", cle: "" }));
  check("A · GET sans clé : 200, aucune information sur la configuration", r.statusCode === 200 && r.corps.service === "mcp-site" && r.corps.cle_definie === true && r.corps.cle_valide === true && !("configured" in r.corps) && !("boutique" in r.corps), JSON.stringify(r.corps));
  check("A · GET sans clé : la valeur de la clé n'apparaît nulle part", !JSON.stringify(r.corps).includes(CLE));
  r = await appeler(requete({ methode: "GET", cle: "mauvaise-cle" }));
  check("A · GET avec une mauvaise clé : même réponse que sans clé", r.corps?.cle_definie === true && !("configured" in r.corps), JSON.stringify(r.corps));
  r = await appeler(requete({ methode: "GET" }));
  check("A · GET avec la bonne clé : configurée, boutique et lecture seule", r.corps.configured === true && r.corps.boutique === "site-test.myshopify.com" && egal(r.corps.manque, []) && r.corps.lecture_seule === true && r.corps.version_api === "2026-04" && r.corps.cle_assez_longue === true && r.corps.cle_url_sure === true, JSON.stringify(r.corps));
  check("A · la sonde ne renvoie ni la clé ni le secret", !JSON.stringify(r.corps).includes(CLE) && !JSON.stringify(r.corps).includes(SECRET));
  check("A · en-tête Cache-Control: no-store", r.entetes["cache-control"] === "no-store");
  r = await appeler(requete({ methode: "GET", cle: "", entetes: { authorization: `Bearer ${CLE}` } }));
  check("A · GET avec la clé en Bearer : acceptée", r.corps?.configured === true);
  r = await appeler(requete({ methode: "GET", cle: "", query: { key: [CLE, "autre"] } }));
  check("A · GET avec la clé répétée dans l'adresse : première valeur retenue", r.corps?.configured === true);
  r = await appeler(requete({ methode: "GET", cle: "", query: {}, url: `/api/mcp-site?key=${encodeURIComponent(CLE)}` }));
  check("A · GET avec la clé lue directement dans l'adresse (sans req.query)", r.corps?.configured === true);

  r = await appeler(requete({ methode: "GET", entetes: { accept: "text/event-stream" } }));
  check("A · GET demandant un flux (SSE) : 405 et en-tête Allow: POST", r.statusCode === 405 && r.entetes.allow === "POST", `${r.statusCode} ${r.entetes.allow}`);
  for (const m of ["PUT", "DELETE", "OPTIONS", "PATCH"]) {
    r = await appeler(requete({ methode: m }));
    check(`A · méthode ${m} : 405`, r.statusCode === 405, String(r.statusCode));
  }

  env({ SHOPIFY_SITE_SHOP: undefined, SHOPIFY_SITE_CLIENT_ID: undefined });
  r = await appeler(requete({ methode: "GET" }));
  check("A · variables Shopify absentes : configured=false et liste de ce qui manque", r.corps.configured === false && egal(r.corps.manque, ["SHOPIFY_SITE_SHOP", "SHOPIFY_SITE_CLIENT_ID"]) && r.corps.boutique === null, JSON.stringify(r.corps));

  env({ MCP_SITE_KEY: "trop-courte" });
  r = await appeler(requete({ methode: "GET", cle: "trop-courte" }));
  check("A · clé trop courte : configured=false et cle_assez_longue=false", r.corps.configured === false && r.corps.cle_assez_longue === false, JSON.stringify(r.corps));
  r = await appeler(requete({ methode: "GET", cle: "" }));
  check("A · clé trop courte : signalée sans la clé (cle_valide=false)", r.corps.cle_definie === true && r.corps.cle_valide === false, JSON.stringify(r.corps));

  const cleAvecDieseEtPlus = "abcdefghij0123456789#klmnopqrst+uv"; // ne survit pas à une adresse web saisie telle quelle
  env({ MCP_SITE_KEY: cleAvecDieseEtPlus });
  r = await appeler(requete({ methode: "GET", cle: "" }));
  check("A · clé avec des caractères spéciaux : signalée sans la clé (cle_valide=false)", r.corps.cle_valide === false, JSON.stringify(r.corps));
  r = await appeler(requete({ methode: "GET", cle: cleAvecDieseEtPlus }));
  check("A · clé avec des caractères spéciaux : configured=false et cle_url_sure=false", r.corps.configured === false && r.corps.cle_url_sure === false && r.corps.cle_assez_longue === true, JSON.stringify(r.corps));
  r = await envoyer(rpc("ping"), { cle: cleAvecDieseEtPlus });
  check("A · clé avec des caractères spéciaux : reste utilisable si l'adresse est correctement codée", r.statusCode === 200);

  env({ MCP_SITE_KEY: `${CLE}\n` });
  r = await appeler(requete({ methode: "GET" }));
  check("A · retour à la ligne collé après la clé dans Vercel : ignoré", r.corps.configured === true, JSON.stringify(r.corps));
  r = await envoyer(rpc("ping"));
  check("A · retour à la ligne collé après la clé dans Vercel : le connecteur répond", r.statusCode === 200);

  env({ MCP_SITE_KEY: undefined });
  r = await appeler(requete({ methode: "GET", cle: "n-importe-quoi" }));
  check("A · MCP_SITE_KEY absente : cle_definie=false, aucune clé ne passe", r.corps.cle_definie === false && r.corps.cle_valide === false && !("configured" in r.corps), JSON.stringify(r.corps));

  // saisie de la boutique : normalisation, et refus de tout ce qui n'est pas un domaine myshopify (les identifiants ne partent jamais ailleurs)
  const boutique = async (valeur) => { env({ SHOPIFY_SITE_SHOP: valeur }); return (await appeler(requete({ methode: "GET" }))).corps.boutique; };
  check("A · boutique saisie « Site-Test » → site-test.myshopify.com", (await boutique("Site-Test")) === "site-test.myshopify.com");
  check("A · boutique saisie avec l'adresse complète", (await boutique("https://Site-Test.myshopify.com/admin")) === "site-test.myshopify.com");
  check("A · boutique saisie avec .myshopify.com", (await boutique("site-test.myshopify.com")) === "site-test.myshopify.com");
  for (const mauvais of ["evil.example", "evil.example/x", "attaquant.com#.myshopify.com", "x.myshopify.com@evil.com", "a b", "-tiret", ""]) {
    check(`A · boutique « ${mauvais} » refusée (domaine hors myshopify.com)`, (await boutique(mauvais)) === null, String(await boutique(mauvais)));
  }
});

/* ================================================================== B · accès aux requêtes POST */
await scenario("B", async () => {
  env();
  let r = await envoyer(rpc("ping"), { cle: "" });
  check("B · POST sans clé : 401", r.statusCode === 401 && r.corps?.error === "cle_invalide", `${r.statusCode} ${JSON.stringify(r.corps)}`);
  r = await envoyer(rpc("ping"), { cle: `x${CLE}` });
  check("B · POST avec une mauvaise clé : 401", r.statusCode === 401);
  r = await envoyer(rpc("ping"), { cle: CLE.slice(0, -1) });
  check("B · clé tronquée d'un caractère : 401", r.statusCode === 401);
  r = await envoyer(rpc("ping"));
  check("B · POST avec la bonne clé : 200", r.statusCode === 200 && egal(r.corps.result, {}));
  r = await envoyer(rpc("ping"), { cle: "", entetes: { authorization: `Bearer ${CLE}` } });
  check("B · clé en en-tête Bearer : acceptée", r.statusCode === 200);
  r = await envoyer(rpc("ping"), { entetes: { authorization: "Bearer parasite" } });
  check("B · en-tête Bearer parasite avec la bonne adresse : acceptée", r.statusCode === 200);
  r = await envoyer(rpc("ping"), { cle: "", entetes: { authorization: "Bearer parasite" } });
  check("B · Bearer parasite sans clé dans l'adresse : 401", r.statusCode === 401);
  r = await envoyer(rpc("ping"), { cle: "", query: {}, url: `/api/mcp-site?key=${encodeURIComponent(CLE)}` });
  check("B · clé lue dans l'adresse brute : acceptée", r.statusCode === 200);

  // limite d'essais : 20 mauvaises clés par adresse et par fenêtre de 5 minutes
  const ipX = "203.0.113.77";
  for (let i = 0; i < 20; i++) await envoyer(rpc("ping"), { cle: `faux-${i}`, ip: ipX });
  r = await envoyer(rpc("ping"), { ip: ipX });
  check("B · après 20 mauvaises clés, la même adresse reçoit 429 (même avec la bonne clé)", r.statusCode === 429, String(r.statusCode));
  r = await envoyer(rpc("ping"), { ip: "203.0.113.78" });
  check("B · une autre adresse n'est pas bloquée", r.statusCode === 200);
  const reel = Date.now;
  Date.now = () => reel() + 6 * 60 * 1000;
  try { r = await envoyer(rpc("ping"), { ip: ipX }); } finally { Date.now = reel; }
  check("B · après 5 minutes, l'adresse est de nouveau acceptée", r.statusCode === 200, String(r.statusCode));
  const ipY = "198.51.100.9";
  for (let i = 0; i < 20; i++) await envoyer(rpc("ping"), { cle: `faux-${i}`, ip: `${ipY}, 10.0.0.${i}` });
  r = await envoyer(rpc("ping"), { ip: `${ipY}, 10.0.0.250` });
  check("B · x-forwarded-for avec plusieurs adresses : seule la première compte", r.statusCode === 429, String(r.statusCode));

  env({ MCP_SITE_KEY: undefined });
  r = await envoyer(rpc("ping"));
  check("B · MCP_SITE_KEY absente : 503 non_configure", r.statusCode === 503 && r.corps?.error === "non_configure", `${r.statusCode} ${JSON.stringify(r.corps)}`);
  env({ MCP_SITE_KEY: "trop-courte" });
  r = await envoyer(rpc("ping"), { cle: "trop-courte" });
  check("B · MCP_SITE_KEY trop courte : 503 (même avec cette clé)", r.statusCode === 503);
});

/* ================================================================== C · protocole MCP */
await scenario("C", async () => {
  env();
  for (const [demandee, attendue] of [["2025-11-25", "2025-11-25"], ["2025-06-18", "2025-06-18"], ["2025-03-26", "2025-03-26"], ["2024-11-05", "2024-11-05"], ["1999-01-01", "2025-06-18"], [undefined, "2025-06-18"]]) {
    const m = rpc("initialize", { protocolVersion: demandee, capabilities: {}, clientInfo: { name: "client-test", version: "1.0" } });
    const r = await envoyer(m);
    const res = r.corps?.result;
    check(`C · initialize (version demandée ${demandee}) → ${attendue}`, r.statusCode === 200 && res?.protocolVersion === attendue && r.corps.id === m.id && r.corps.jsonrpc === "2.0", JSON.stringify(r.corps).slice(0, 200));
  }
  const m = rpc("initialize", { protocolVersion: "2025-06-18" });
  const init = (await envoyer(m)).corps.result;
  check("C · initialize : outils annoncés, identité du serveur et consignes", init.capabilities?.tools && init.serverInfo?.name === "homy-shopify-site" && typeof init.instructions === "string" && /switch-shop/.test(init.instructions));
  const sansParams = await envoyer({ jsonrpc: "2.0", id: 4242, method: "initialize" });
  check("C · initialize sans paramètres : accepté", sansParams.corps?.result?.protocolVersion === "2025-06-18" && sansParams.corps.id === 4242);

  let r = await envoyer(notif("notifications/initialized"));
  check("C · notifications/initialized : 202 sans corps", r.statusCode === 202 && r.corps === undefined, `${r.statusCode} ${JSON.stringify(r.corps)}`);
  r = await envoyer(notif("notifications/cancelled"));
  check("C · autre notification : 202", r.statusCode === 202);
  r = await envoyer(notif("methode/inconnue"));
  check("C · notification inconnue : 202 (jamais d'erreur)", r.statusCode === 202);

  const lt = rpc("tools/list");
  r = await envoyer(lt);
  const outils = r.corps?.result?.tools || [];
  check("C · tools/list : get-shop-info et run-analytics-query, en lecture seule", egal(outils.map((t) => t.name).sort(), ["get-shop-info", "run-analytics-query"]) && outils.every((t) => t.annotations?.readOnlyHint === true && t.annotations?.destructiveHint === false && t.inputSchema?.type === "object" && typeof t.description === "string" && t.description.length > 20), JSON.stringify(outils).slice(0, 200));
  const rq = outils.find((t) => t.name === "run-analytics-query");
  check("C · run-analytics-query exige « query » (texte)", egal(rq?.inputSchema?.required, ["query"]) && rq.inputSchema.properties.query.type === "string");
  check("C · aucun outil d'écriture annoncé", !outils.some((t) => /create|update|delete|set|write|mutation|switch/i.test(t.name)));

  r = await envoyer(rpc("resources/list"));
  check("C · resources/list vide", egal(r.corps?.result, { resources: [] }));
  r = await envoyer(rpc("prompts/list"));
  check("C · prompts/list vide", egal(r.corps?.result, { prompts: [] }));

  const inconnue = rpc("methode/inconnue");
  r = await envoyer(inconnue);
  check("C · méthode inconnue avec identifiant : erreur -32601", r.statusCode === 200 && r.corps?.error?.code === -32601 && r.corps.id === inconnue.id, JSON.stringify(r.corps));
  r = await outil("outil-inexistant", {});
  check("C · outil inconnu : erreur de protocole -32602", r.corps?.error?.code === -32602, JSON.stringify(r.corps));
  for (const nomInterdit of ["switch-shop", "graphql_mutation", "update-product", "create-discount", "list-orders", "get-order"]) {
    r = await outil(nomInterdit, {});
    check(`C · outil « ${nomInterdit} » absent du connecteur`, r.corps?.error?.code === -32602);
  }

  r = await envoyer({ jsonrpc: "2.0", id: 0, method: "ping" });
  check("C · identifiant 0 : traité comme une requête (pas une notification)", r.statusCode === 200 && r.corps?.id === 0 && egal(r.corps.result, {}));
  r = await envoyer({ jsonrpc: "2.0", id: "abc-1", method: "ping" });
  check("C · identifiant texte renvoyé tel quel", r.corps?.id === "abc-1");

  // lots
  const lot = [rpc("initialize", { protocolVersion: "2025-06-18" }), notif("notifications/initialized"), rpc("tools/list")];
  r = await envoyer(lot);
  check("C · lot : deux réponses dans l'ordre (la notification n'en produit pas)", Array.isArray(r.corps) && r.corps.length === 2 && r.corps[0].id === lot[0].id && r.corps[1].id === lot[2].id, JSON.stringify(r.corps).slice(0, 200));
  r = await envoyer([notif("notifications/initialized"), notif("notifications/cancelled")]);
  check("C · lot de notifications seules : 202", r.statusCode === 202);
  r = await envoyer(Array.from({ length: 21 }, () => rpc("ping")));
  check("C · lot de 21 messages : 400", r.statusCode === 400);
  r = await envoyer(Array.from({ length: 20 }, () => rpc("ping")));
  check("C · lot de 20 messages : accepté", r.statusCode === 200 && r.corps.length === 20);
  r = await envoyer([]);
  check("C · lot vide : 400", r.statusCode === 400);

  // corps
  r = await appeler(requete({ brut: "{pas du json" }));
  check("C · corps non JSON : 400 et erreur -32700", r.statusCode === 400 && r.corps?.error?.code === -32700, `${r.statusCode} ${JSON.stringify(r.corps)}`);
  r = await appeler(requete({ brut: JSON.stringify(rpc("ping")) }));
  check("C · corps reçu en texte : lu", r.statusCode === 200 && egal(r.corps.result, {}));
  r = await appeler(requete({ brut: Buffer.from(JSON.stringify(rpc("ping")), "utf8") }));
  check("C · corps reçu en Buffer : lu", r.statusCode === 200 && egal(r.corps.result, {}));
  r = await appeler(requete({ brut: "5" }));
  check("C · corps JSON qui n'est pas une requête : erreur -32600", r.statusCode === 200 && r.corps?.error?.code === -32600, JSON.stringify(r.corps));
  r = await appeler(requete({ corps: { jsonrpc: "2.0", id: 9, method: 12 } }));
  check("C · méthode non textuelle : erreur -32600", r.corps?.error?.code === -32600 && r.corps.id === 9);

  // flux (corps non analysé par la plate-forme)
  const fluxReq = (contenu) => Object.assign(Readable.from([Buffer.from(contenu)]), { method: "POST", url: "/api/mcp-site", query: { key: CLE }, headers: { "content-type": "application/json", "x-forwarded-for": nouvelleIp() }, socket: {} });
  r = await appeler(fluxReq(JSON.stringify(rpc("ping"))));
  check("C · corps lu depuis le flux de la requête", r.statusCode === 200 && egal(r.corps.result, {}), `${r.statusCode} ${JSON.stringify(r.corps)}`);
  r = await appeler(fluxReq("x".repeat(250_000)));
  check("C · corps de 250 ko refusé (400)", r.statusCode === 400, String(r.statusCode));
});

/* ================================================================== D · get-shop-info */
await scenario("D", async () => {
  env();
  file = [jeton("jt-1"), repInfo];
  let r = await outil("get-shop-info", {});
  const info = jsonOutil(r);
  check("D · get-shop-info : identité de la boutique du site", r.statusCode === 200 && !r.corps.result.isError && info?.shopDomain === "site-test.myshopify.com" && info.name === "HOM'Y – site" && info.primaryDomain === "www.hom-y.fr" && info.currencyCode === "EUR" && info.ianaTimezone === "Europe/Paris", texteOutil(r));
  check("D · get-shop-info : droits, version d'API, lecture seule, nom du connecteur", egal(info.accessScopes, ["read_reports"]) && info.apiVersion === "2026-04" && info.readOnly === true && info.connector === "homy-shopify-site");
  const form = new URLSearchParams(appels[0]?.corps || "");
  check("D · jeton demandé en client_credentials, sur le domaine de la boutique du site", appels[0]?.url === "https://site-test.myshopify.com/admin/oauth/access_token" && appels[0].methode === "POST" && appels[0].entetes["content-type"] === "application/x-www-form-urlencoded" && form.get("grant_type") === "client_credentials" && form.get("client_id") === process.env.SHOPIFY_SITE_CLIENT_ID && form.get("client_secret") === SECRET, JSON.stringify(appels[0]));
  check("D · requête GraphQL : bonne adresse, version d'API et jeton", appels[1]?.url === "https://site-test.myshopify.com/admin/api/2026-04/graphql.json" && appels[1].entetes["x-shopify-access-token"] === "jt-1" && appels[1].methode === "POST", JSON.stringify(appels[1]));
  check("D · la requête n'est qu'une lecture (pas de mutation)", !/mutation/i.test(appels[1]?.corps || "") && /ianaTimezone/.test(appels[1].corps));
  check("D · le secret n'est jamais transmis à l'API GraphQL", !(appels[1]?.corps || "").includes(SECRET) && !JSON.stringify(appels[1]?.entetes).includes(SECRET));
  check("D · la réponse ne contient pas le secret ni le jeton", !JSON.stringify(r.corps).includes(SECRET) && !JSON.stringify(r.corps).includes("jt-1"));
  consomme("D");

  file = [repInfo];
  r = await outil("get-shop-info", {});
  check("D · jeton réutilisé : aucune nouvelle demande de jeton", appels.length === 3 && appels[2].url.endsWith("/graphql.json") && !enErreur(r), String(appels.length));
  consomme("D (2e appel)");

  // version d'API
  env({ SHOPIFY_SITE_API_VERSION: "2026-07" });
  file = [jeton(), repInfo];
  appels = [];
  r = await outil("get-shop-info", {});
  check("D · SHOPIFY_SITE_API_VERSION respectée", appels[1]?.url === "https://site-test.myshopify.com/admin/api/2026-07/graphql.json" && jsonOutil(r)?.apiVersion === "2026-07", appels[1]?.url);
  env({ SHOPIFY_SITE_API_VERSION: "latest" });
  file = [jeton(), repInfo];
  appels = [];
  await outil("get-shop-info", {});
  check("D · version d'API invalide : retour à 2026-04", appels[1]?.url.includes("/api/2026-04/"), appels[1]?.url);

  // boutique renvoyée vide
  env();
  reset();
  file = [jeton(), () => rep(200, { data: { shop: null } })];
  r = await outil("get-shop-info", {});
  check("D · informations de boutique absentes : erreur claire", enErreur(r) && /informations de la boutique/.test(texteOutil(r)), texteOutil(r));
});

/* ================================================================== E · run-analytics-query */
await scenario("E", async () => {
  env();
  file = [jeton("jt-2"), repTableau(COLS, LIGNES)];
  let r = await outil("run-analytics-query", { query: Q_JOURS });
  let s = jsonOutil(r);
  check("E · lignes en tableaux de textes : renvoyées telles quelles", r.statusCode === 200 && !r.corps.result.isError && egal(s?.rows, LIGNES), texteOutil(r)?.slice(0, 200));
  check("E · colonnes réduites à {name, dataType}", egal(s?.columns, COLS.map(({ name, dataType }) => ({ name, dataType }))));
  check("E · query renvoyée à l'identique, shopDomain de la boutique du site", s?.query === Q_JOURS && s.shopDomain === "site-test.myshopify.com");
  check("E · texte du résultat commençant par {\"query\" (condition de lecture du script du Flash)", texteOutil(r)?.startsWith('{"query"'));
  check("E · ordre des clés : query, columns, rows, shopDomain", egal(Object.keys(s), ["query", "columns", "rows", "shopDomain"]));
  // mêmes conditions que lireResultatsJsonl (scripts/flash/refresh_flash.mjs)
  check("E · format lisible par le script du Flash (query texte, columns et rows tableaux, cellules en texte)", typeof s.query === "string" && Array.isArray(s.columns) && Array.isArray(s.rows) && s.rows.every((l) => Array.isArray(l) && l.length === COLS.length && l.every((c) => typeof c === "string")));
  const corpsGql = JSON.parse(appels[1].corps);
  check("E · la requête ShopifyQL passe en variable GraphQL (jamais collée dans le texte GraphQL)", corpsGql.variables?.q === Q_JOURS && !corpsGql.query.includes("SINCE 2026") && /shopifyqlQuery\(query: \$q\)/.test(corpsGql.query), corpsGql.query);
  check("E · le texte GraphQL n'est pas une mutation", !/mutation/i.test(corpsGql.query));
  consomme("E");

  // lignes en objets, en nombres, avec une valeur nulle
  file = [repTableau(COLS, [{ day: "2026-10-04", orders: 225, quantity_ordered: 357, net_sales: 35370.6, taxes: null }, { day: "2026-10-05", orders: 0, quantity_ordered: 0, net_sales: 0 }])];
  r = await outil("run-analytics-query", { query: Q_JOURS });
  s = jsonOutil(r);
  check("E · lignes en objets : converties en tableaux de textes dans l'ordre des colonnes (nul → vide)", egal(s?.rows, [["2026-10-04", "225", "357", "35370.6", ""], ["2026-10-05", "0", "0", "0", ""]]), texteOutil(r)?.slice(0, 200));
  file = [repTableau(COLS, [["2026-10-04", 225, 357, 35370.6, 6185.05]])];
  r = await outil("run-analytics-query", { query: Q_JOURS });
  check("E · cellules numériques : converties en texte", egal(jsonOutil(r)?.rows, [["2026-10-04", "225", "357", "35370.6", "6185.05"]]));
  file = [repTableau(COLS, JSON.stringify(LIGNES))];
  r = await outil("run-analytics-query", { query: Q_JOURS });
  check("E · lignes fournies sous forme de texte JSON : décodées", egal(jsonOutil(r)?.rows, LIGNES));
  file = [repTableau(COLS, [])];
  r = await outil("run-analytics-query", { query: Q_JOURS });
  check("E · aucune ligne : résultat vide valide", egal(jsonOutil(r)?.rows, []) && !enErreur(r));
  file = [repTableau(COLS, null)];
  r = await outil("run-analytics-query", { query: Q_JOURS });
  check("E · lignes nulles : traitées comme vides", egal(jsonOutil(r)?.rows, []) && !enErreur(r));
  consomme("E (formats de lignes)");
  check("E · une seule demande de jeton pour toutes ces requêtes (cache)", appels.filter((a) => a.url.includes("/oauth/")).length === 1, String(appels.filter((a) => a.url.includes("/oauth/")).length));

  // requêtes valides diverses (pays et régions permis, jeux sessions et products, textes entre apostrophes non examinés)
  const valides = [
    "FROM sales SHOW net_sales GROUP BY billing_country SINCE -7d",
    "FROM sales SHOW net_sales GROUP BY shipping_country, shipping_region SINCE -7d",
    "FROM sales SHOW orders, net_sales GROUP BY billing_region",
    "FROM sales SHOW quantity_ordered, net_sales GROUP BY product_variant_sku, product_title SINCE -7d ORDER BY net_sales DESC LIMIT 20",
    "from sales show net_sales timeseries day since -7d",
    "FROM sessions SHOW sessions TIMESERIES day SINCE -7d",
    "FROM sessions SHOW sessions GROUP BY referrer_source",
    "FROM products SHOW net_items_sold GROUP BY product_title",
    "FROM sales SHOW net_sales WHERE product_title = 'phone case' SINCE -7d",
    "  \nFROM sales SHOW net_sales",
  ];
  appels = [];
  file = valides.map(() => repTableau([{ name: "net_sales", dataType: "MONEY" }], [["1"]]));
  for (const q of valides) {
    r = await outil("run-analytics-query", { query: q });
    check(`E · requête valide acceptée : ${q.trim().slice(0, 70)}`, !enErreur(r) && jsonOutil(r)?.query === q, texteOutil(r)?.slice(0, 160));
  }
  consomme("E (requêtes valides)");
});

/* ================================================================== F · requêtes refusées (aucun appel à Shopify) */
await scenario("F", async () => {
  env();
  const refus = [
    ["sans FROM", "SHOW orders SINCE -7d", /FROM/],
    ["jeu non autorisé : orders", "FROM orders SHOW count", /non autorisé/],
    ["jeu non autorisé : customers", "FROM customers SHOW count", /non autorisé|personnelles/],
    ["jeu non autorisé : inventory", "FROM inventory SHOW quantity", /non autorisé/],
    ["second FROM non autorisé", "FROM sales SHOW net_sales ; FROM orders SHOW orders", /non autorisé/],
    ["second FROM non autorisé (casse)", "FROM sales SHOW net_sales\nfrom Orders SHOW orders", /non autorisé/],
    ["adresse e-mail", "FROM sales SHOW net_sales GROUP BY customer_email", /personnelles/],
    ["mot e-mail", "FROM sales SHOW net_sales GROUP BY email", /personnelles/],
    ["téléphone", "FROM sales SHOW net_sales GROUP BY phone", /personnelles/],
    ["prénom", "FROM sales SHOW net_sales GROUP BY first_name", /personnelles/],
    ["nom de famille", "FROM sales SHOW net_sales GROUP BY last_name", /personnelles/],
    ["nom du client", "FROM sales SHOW net_sales GROUP BY customer_name", /personnelles/],
    ["identifiant client", "FROM sales SHOW net_sales GROUP BY customer_id", /personnelles/],
    ["adresse de livraison", "FROM sales SHOW net_sales GROUP BY shipping_address1", /personnelles/],
    ["adresse de facturation", "FROM sales SHOW net_sales GROUP BY billing_address2", /personnelles/],
    ["ville de facturation", "FROM sales SHOW net_sales GROUP BY billing_city", /personnelles/],
    ["ville de livraison", "FROM sales SHOW net_sales GROUP BY shipping_city", /personnelles/],
    ["code postal", "FROM sales SHOW net_sales GROUP BY shipping_postal_code", /personnelles/],
    ["code postal (zip)", "FROM sales SHOW net_sales GROUP BY billing_zip", /personnelles/],
    ["nom de facturation", "FROM sales SHOW net_sales GROUP BY billing_name", /personnelles/],
    ["ville seule", "FROM sales SHOW net_sales GROUP BY city", /personnelles/],
    ["rue", "FROM sales SHOW net_sales GROUP BY street", /personnelles/],
    ["adresse seule", "FROM sales SHOW net_sales GROUP BY address1", /personnelles/],
    ["code postal seul", "FROM sales SHOW net_sales GROUP BY postal_code", /personnelles/],
    ["zip_code seul", "FROM sales SHOW net_sales GROUP BY zip_code", /personnelles/],
    ["téléphone de livraison", "FROM sales SHOW net_sales GROUP BY shipping_phone", /personnelles/],
    ["données personnelles après un texte entre apostrophes", "FROM sales SHOW net_sales WHERE product_title = 'x' GROUP BY customer_email", /personnelles/],
    ["apostrophe non fermée (le reste est examiné)", "FROM sales SHOW net_sales WHERE product_title = 'x GROUP BY customer_email", /personnelles/],
    ["échappement d'apostrophe détourné", "FROM sales SHOW net_sales WHERE a = 'x\\' GROUP BY customer_email --'", /personnelles/],
    ["données personnelles en majuscules", "FROM sales SHOW net_sales GROUP BY CUSTOMER_EMAIL", /personnelles/],
    ["requête trop longue", "FROM sales SHOW net_sales WHERE product_title = '" + "a".repeat(1500) + "'", /trop longue/],
  ];
  for (const [nom, q, motif] of refus) {
    const avant = appels.length;
    const r = await outil("run-analytics-query", { query: q });
    check(`F · refus : ${nom}`, enErreur(r) && motif.test(texteOutil(r) || "") && appels.length === avant, `${texteOutil(r)?.slice(0, 120)} · appels ${appels.length - avant}`);
  }
  for (const [nom, args] of [["query absente", {}], ["query vide", { query: "  " }], ["query numérique", { query: 42 }], ["query objet", { query: { a: 1 } }], ["arguments absents", undefined], ["arguments textuels", "FROM sales SHOW net_sales"]]) {
    const avant = appels.length;
    const r = await envoyer(rpc("tools/call", { name: "run-analytics-query", arguments: args }));
    check(`F · paramètre invalide : ${nom}`, enErreur(r) && /query/.test(texteOutil(r) || "") && appels.length === avant, texteOutil(r)?.slice(0, 120));
  }
  check("F · aucun appel à Shopify pour toutes les requêtes refusées", appels.length === 0, String(appels.length));
});

/* ================================================================== G · erreurs et reprises côté Shopify */
await scenario("G", async () => {
  const Q = "FROM sales SHOW net_sales SINCE -7d";
  const bon = repTableau([{ name: "net_sales", dataType: "MONEY" }], [["12.5"]]);
  const msg = (r) => texteOutil(r) || "";

  // requête ShopifyQL invalide
  env();
  file = [jeton(), repTableau([], [], ["Unknown column 'foo'", "Syntax error near 'SHOW'"])];
  let r = await outil("run-analytics-query", { query: Q });
  check("G · erreurs d'analyse ShopifyQL : isError avec le détail", enErreur(r) && /invalide/.test(msg(r)) && /Unknown column 'foo'/.test(msg(r)) && /Syntax error/.test(msg(r)), msg(r));
  file = [() => rep(200, { data: { shop: { myshopifyDomain: "site-test.myshopify.com" }, shopifyqlQuery: { tableData: null, parseErrors: [] } } })];
  r = await outil("run-analytics-query", { query: Q });
  check("G · aucun tableau renvoyé : erreur explicite (droit read_reports ?)", enErreur(r) && /aucun tableau/.test(msg(r)) && /read_reports/.test(msg(r)), msg(r));
  file = [() => rep(200, { data: { shop: { myshopifyDomain: "site-test.myshopify.com" }, shopifyqlQuery: null } })];
  r = await outil("run-analytics-query", { query: Q });
  check("G · résultat ShopifyQL nul : erreur explicite", enErreur(r) && /aucun tableau/.test(msg(r)), msg(r));
  file = [() => rep(200, { errors: [{ message: "Access denied for shopifyqlQuery field. Required access: `read_reports` access scope." }] })];
  r = await outil("run-analytics-query", { query: Q });
  check("G · erreur GraphQL de Shopify : message relayé", enErreur(r) && /Erreur Shopify/.test(msg(r)) && /read_reports/.test(msg(r)), msg(r));
  consomme("G (erreurs d'analyse)");

  // limitation de débit : reprise
  reset();
  file = [() => rep(200, { errors: [{ message: "Throttled", extensions: { code: "THROTTLED" } }] }), bon];
  r = await outil("run-analytics-query", { query: Q });
  check("G · THROTTLED puis succès : reprise automatique", !enErreur(r) && jsonOutil(r)?.rows?.[0]?.[0] === "12.5" && appels.length === 2, `${appels.length} appels · ${msg(r).slice(0, 100)}`);
  consomme("G (THROTTLED)");
  reset();
  file = [() => rep(429, { errors: "Too many requests" }), bon];
  r = await outil("run-analytics-query", { query: Q });
  check("G · HTTP 429 puis succès : reprise automatique", !enErreur(r) && appels.length === 2, `${appels.length} appels`);
  reset();
  file = [() => rep(503, "indisponible"), () => rep(502, "passerelle"), bon];
  r = await outil("run-analytics-query", { query: Q });
  check("G · deux erreurs 5xx puis succès : reprise automatique", !enErreur(r) && appels.length === 3, `${appels.length} appels · ${msg(r).slice(0, 100)}`);
  reset();
  file = [() => rep(503, "indisponible"), () => rep(503, "indisponible"), () => rep(503, "indisponible")];
  r = await outil("run-analytics-query", { query: Q });
  check("G · trois erreurs 5xx : abandon avec un message clair (3 essais)", enErreur(r) && /503/.test(msg(r)) && appels.length === 3, `${appels.length} appels · ${msg(r)}`);
  reset();
  file = [() => rep(200, { errors: [{ message: "Throttled", extensions: { code: "THROTTLED" } }] }), () => rep(200, { errors: [{ message: "Throttled", extensions: { code: "THROTTLED" } }] }), () => rep(200, { errors: [{ message: "Throttled", extensions: { code: "THROTTLED" } }] })];
  r = await outil("run-analytics-query", { query: Q });
  check("G · THROTTLED persistant : abandon avec un message clair", enErreur(r) && /Throttled/.test(msg(r)) && appels.length === 3, `${appels.length} appels · ${msg(r)}`);
  reset();
  file = [new Error("fetch failed"), new Error("fetch failed"), bon];
  r = await outil("run-analytics-query", { query: Q });
  check("G · deux coupures réseau puis succès : reprise automatique", !enErreur(r) && appels.length === 3, `${appels.length} appels · ${msg(r)}`);
  reset();
  file = [new Error("ECONNRESET"), new Error("ECONNRESET"), new Error("ECONNRESET")];
  r = await outil("run-analytics-query", { query: Q });
  check("G · coupures réseau persistantes : message « injoignable »", enErreur(r) && /injoignable/.test(msg(r)) && appels.length === 3, `${appels.length} appels · ${msg(r)}`);

  // jeton expiré ou révoqué : on en redemande un
  env();
  reset();
  file = [jeton("jt-A"), () => rep(401, { errors: "Invalid API key or access token" }), jeton("jt-B"), bon];
  r = await outil("run-analytics-query", { query: Q });
  check("G · 401 : nouveau jeton demandé puis requête rejouée avec ce jeton", !enErreur(r) && appels.length === 4 && appels[3].entetes["x-shopify-access-token"] === "jt-B" && appels[1].entetes["x-shopify-access-token"] === "jt-A", `${appels.length} appels · ${msg(r)}`);
  consomme("G (jeton expiré)");
  file = [bon];
  appels = [];
  r = await outil("run-analytics-query", { query: Q });
  check("G · le nouveau jeton est mis en cache", !enErreur(r) && appels.length === 1 && appels[0].entetes["x-shopify-access-token"] === "jt-B", `${appels.length} appels`);
  env();
  reset();
  file = [jeton("jt-A"), () => rep(401, "x"), jeton("jt-B"), () => rep(401, "x"), jeton("jt-C"), () => rep(401, "x")];
  r = await outil("run-analytics-query", { query: Q });
  check("G · 401 persistant : abandon après trois essais, message clair", enErreur(r) && /401/.test(msg(r)) && appels.length === 6, `${appels.length} appels · ${msg(r)}`);
  consomme("G (401 persistant)");

  // jeton expirant bientôt : redemandé avant d'être utilisé
  env();
  reset();
  file = [jeton("jt-court", 30), bon, jeton("jt-neuf"), bon];
  await outil("run-analytics-query", { query: Q });
  await outil("run-analytics-query", { query: Q });
  check("G · jeton valable moins d'une minute : renouvelé avant la requête suivante", appels.length === 4 && appels[3].entetes["x-shopify-access-token"] === "jt-neuf", `${appels.length} appels`);

  // 403 : droit manquant
  env();
  reset();
  file = [jeton(), () => rep(403, { errors: "Forbidden" })];
  r = await outil("run-analytics-query", { query: Q });
  check("G · 403 : message sur le droit read_reports, sans nouvel essai", enErreur(r) && /read_reports/.test(msg(r)) && /403/.test(msg(r)) && appels.length === 2, `${appels.length} appels · ${msg(r)}`);
  env();
  reset();
  file = [jeton(), () => rep(404, "x")];
  r = await outil("run-analytics-query", { query: Q });
  check("G · autre erreur HTTP : relayée avec son code, sans nouvel essai", enErreur(r) && /404/.test(msg(r)) && appels.length === 2, `${appels.length} appels · ${msg(r)}`);
  env();
  reset();
  file = [jeton(), () => rep(200, "<html>pas du json</html>")];
  r = await outil("run-analytics-query", { query: Q });
  check("G · réponse illisible : message clair", enErreur(r) && /illisible/.test(msg(r)), msg(r));

  // identifiants refusés par Shopify
  env();
  reset();
  file = [() => rep(400, { error: "invalid_client", error_description: "Client authentication failed" })];
  r = await outil("get-shop-info", {});
  check("G · identifiants refusés : message guidé, sans le secret", enErreur(r) && /identifiants/.test(msg(r)) && /400/.test(msg(r)) && /invalid_client/.test(msg(r)) && !msg(r).includes(SECRET), msg(r));
  file = [jeton("jt-ok"), repInfo];
  r = await outil("get-shop-info", {});
  check("G · un refus n'est pas mis en cache : l'appel suivant redemande un jeton", !enErreur(r) && appels.length === 3, `${appels.length} appels`);
  reset();
  file = [new Error("getaddrinfo ENOTFOUND")];
  env();
  r = await outil("get-shop-info", {});
  check("G · Shopify injoignable pour le jeton : message clair", enErreur(r) && /injoignable pendant l'obtention du jeton/.test(msg(r)), msg(r));
  reset();
  file = [() => rep(200, "pas du json")];
  env();
  r = await outil("get-shop-info", {});
  check("G · réponse de jeton illisible : refus guidé", enErreur(r) && /identifiants/.test(msg(r)), msg(r));
  reset();
  file = [() => rep(200, { scope: "read_reports" })];
  env();
  r = await outil("get-shop-info", {});
  check("G · réponse de jeton sans access_token : refus guidé", enErreur(r) && /identifiants/.test(msg(r)), msg(r));

  // Shopify ne répond pas : l'outil s'arrête dans le budget de temps (réglé ici à 1,5 s) avec un message clair
  const silence = (a) => new Promise((_, rejeter) => {
    const veille = setInterval(() => {}, 50); // le minuteur d'AbortSignal.timeout ne retient pas la boucle d'événements : on la garde éveillée
    a.signal.addEventListener("abort", () => { clearInterval(veille); rejeter(a.signal.reason ?? new Error("abandon")); });
  });
  env({ MCP_SITE_BUDGET_MS: "1500" });
  reset();
  file = [jeton(), silence];
  let debut = Date.now();
  r = await outil("run-analytics-query", { query: Q });
  check("G · Shopify muet : abandon dans le budget de temps, message clair", enErreur(r) && /trop de temps/.test(msg(r)) && Date.now() - debut < 5000 && appels.length === 2, `${Date.now() - debut} ms · ${appels.length} appels · ${msg(r)}`);
  env({ MCP_SITE_BUDGET_MS: "1500" });
  reset();
  file = [silence];
  debut = Date.now();
  r = await outil("get-shop-info", {});
  check("G · Shopify muet pendant l'obtention du jeton : message clair, sans attendre 10 s", enErreur(r) && /injoignable/.test(msg(r)) && Date.now() - debut < 5000, `${Date.now() - debut} ms · ${msg(r)}`);

  // défaut interne : jamais de détail technique côté client
  env();
  reset();
  file = [jeton(), () => null];
  r = await outil("run-analytics-query", { query: Q });
  check("G · défaut interne imprévu : message générique, aucun détail technique", enErreur(r) && msg(r) === "Erreur interne du connecteur.", msg(r));
  reset();
  file = [jeton(), repTableau([{ name: "a", dataType: "X" }], [["1"]])];
  env();
  file = [jeton(), repTableau([{ name: "a", dataType: "X" }], [["1"]])];
  r = await outil("run-analytics-query", { query: Q });
  check("G · après un défaut interne, le connecteur répond de nouveau normalement", !enErreur(r));
});

/* ================================================================== H · jeton d'administration fixe */
await scenario("H", async () => {
  env({ SHOPIFY_SITE_TOKEN: "shpat_fixe_test", SHOPIFY_SITE_CLIENT_ID: undefined, SHOPIFY_SITE_CLIENT_SECRET: undefined });
  let g = (await appeler(requete({ methode: "GET" }))).corps;
  check("H · jeton fixe : la configuration est complète sans identifiant ni secret", g.configured === true && egal(g.manque, []), JSON.stringify(g));
  file = [repInfo];
  let r = await outil("get-shop-info", {});
  check("H · jeton fixe : aucune demande de jeton, en-tête d'accès correct", !enErreur(r) && appels.length === 1 && appels[0].entetes["x-shopify-access-token"] === "shpat_fixe_test" && appels[0].url.endsWith("/graphql.json"), JSON.stringify(appels.map((a) => a.url)));
  reset();
  file = [() => rep(401, "Invalid API key or access token")];
  r = await outil("get-shop-info", {});
  check("H · jeton fixe refusé (401) : message clair, sans nouvel essai", enErreur(r) && /401/.test(texteOutil(r)) && appels.length === 1, `${appels.length} appels · ${texteOutil(r)}`);
  check("H · le jeton fixe n'apparaît pas dans la réponse", !JSON.stringify(r.corps).includes("shpat_fixe_test"));
});

/* ================================================================== I · configuration Shopify absente */
await scenario("I", async () => {
  env({ SHOPIFY_SITE_SHOP: undefined, SHOPIFY_SITE_CLIENT_ID: undefined, SHOPIFY_SITE_CLIENT_SECRET: undefined });
  let r = await envoyer(rpc("initialize", { protocolVersion: "2025-06-18" }));
  check("I · initialize fonctionne même sans configuration Shopify", r.statusCode === 200 && r.corps.result?.serverInfo?.name === "homy-shopify-site");
  r = await envoyer(rpc("tools/list"));
  check("I · tools/list fonctionne sans configuration Shopify", r.corps?.result?.tools?.length === 2);
  r = await outil("get-shop-info", {});
  check("I · get-shop-info sans configuration : message listant les variables manquantes", enErreur(r) && /SHOPIFY_SITE_SHOP/.test(texteOutil(r)) && /SHOPIFY_SITE_CLIENT_ID/.test(texteOutil(r)) && /SHOPIFY_SITE_CLIENT_SECRET/.test(texteOutil(r)) && /redéployer/.test(texteOutil(r)), texteOutil(r));
  r = await outil("run-analytics-query", { query: "FROM sales SHOW net_sales" });
  check("I · run-analytics-query sans configuration : même message, aucun appel", enErreur(r) && /variables manquantes/.test(texteOutil(r)) && appels.length === 0);
  env({ SHOPIFY_SITE_CLIENT_SECRET: undefined });
  r = await outil("get-shop-info", {});
  check("I · secret seul manquant : désigné précisément", enErreur(r) && /SHOPIFY_SITE_CLIENT_SECRET/.test(texteOutil(r)) && !/SHOPIFY_SITE_CLIENT_ID/.test(texteOutil(r)) && !/SHOPIFY_SITE_SHOP/.test(texteOutil(r)), texteOutil(r));
});

/* ================================================================== K · valeurs collées au mauvais endroit, aides au diagnostic */
await scenario("K", async () => {
  const getAuth = async () => (await appeler(requete({ methode: "GET" }))).corps;
  const ID_HEX = "0123456789abcdef0123456789abcdef";
  const SECRET_SHPSS = ["shpss", "0123456789abcdef0123456789abcdef"].join("_"); // assemblé ici : un secret Shopify en clair, même factice, est refusé par l'analyse des secrets de GitHub

  // la clé du connecteur collée dans le nom de la boutique (erreur réellement rencontrée lors de la mise en service)
  env({ SHOPIFY_SITE_SHOP: CLE });
  let g = await getAuth();
  check("K · boutique = clé du connecteur : détectée, configuration non valide", g.configured === false && egal(g.identiques, ["SHOPIFY_SITE_SHOP = MCP_SITE_KEY"]), JSON.stringify(g));
  let r = await appeler(requete({ methode: "GET", cle: "" }));
  check("K · sans la clé, la sonde ne dit rien des doublons ni des formes", !("identiques" in r.corps) && !("formes_plausibles" in r.corps), JSON.stringify(r.corps));
  r = await outil("get-shop-info", {});
  check("K · get-shop-info : refus guidé, variables nommées, aucun appel à Shopify, aucune valeur", enErreur(r) && /mal remplies/.test(texteOutil(r)) && /SHOPIFY_SITE_SHOP = MCP_SITE_KEY/.test(texteOutil(r)) && /redéployer/.test(texteOutil(r)) && appels.length === 0 && !texteOutil(r).includes(CLE) && !texteOutil(r).includes(SECRET), texteOutil(r));
  r = await outil("run-analytics-query", { query: "FROM sales SHOW net_sales" });
  check("K · run-analytics-query : même refus, aucun appel", enErreur(r) && /mal remplies/.test(texteOutil(r)) && appels.length === 0, texteOutil(r));

  // autres collages malheureux
  env({ SHOPIFY_SITE_CLIENT_ID: CLE });
  g = await getAuth();
  check("K · ID client = clé du connecteur : détecté", g.configured === false && egal(g.identiques, ["MCP_SITE_KEY = SHOPIFY_SITE_CLIENT_ID"]), JSON.stringify(g.identiques));
  env({ SHOPIFY_SITE_CLIENT_ID: SECRET });
  g = await getAuth();
  check("K · ID client = secret : détecté", g.configured === false && egal(g.identiques, ["SHOPIFY_SITE_CLIENT_ID = SHOPIFY_SITE_CLIENT_SECRET"]), JSON.stringify(g.identiques));
  env({ SHOPIFY_SITE_CLIENT_ID: CLE.toLowerCase() });
  g = await getAuth();
  check("K · comparaison insensible à la casse", egal(g.identiques, ["MCP_SITE_KEY = SHOPIFY_SITE_CLIENT_ID"]), JSON.stringify(g.identiques));
  env({ SHOPIFY_SITE_SHOP: `${CLE}.myshopify.com` });
  g = await getAuth();
  check("K · boutique saisie sous la forme « xxxx.myshopify.com » : comparée sans le suffixe", egal(g.identiques, ["SHOPIFY_SITE_SHOP = MCP_SITE_KEY"]), JSON.stringify(g.identiques));
  env({ SHOPIFY_SITE_SHOP: CLE, SHOPIFY_SITE_CLIENT_ID: CLE, SHOPIFY_SITE_CLIENT_SECRET: CLE });
  g = await getAuth();
  check("K · même valeur dans quatre variables : les six paires sont signalées", g.identiques.length === 6, JSON.stringify(g.identiques));
  env({ SHOPIFY_SITE_TOKEN: CLE, SHOPIFY_SITE_CLIENT_ID: undefined, SHOPIFY_SITE_CLIENT_SECRET: undefined });
  g = await getAuth();
  check("K · jeton fixe = clé du connecteur : détecté", g.configured === false && egal(g.identiques, ["MCP_SITE_KEY = SHOPIFY_SITE_TOKEN"]), JSON.stringify(g.identiques));
  env({ SHOPIFY_SITE_SHOP: undefined, SHOPIFY_SITE_CLIENT_ID: undefined, SHOPIFY_SITE_CLIENT_SECRET: undefined });
  g = await getAuth();
  check("K · variables absentes : jamais prises pour des doublons", egal(g.identiques, []) && g.configured === false, JSON.stringify(g));
  env();
  g = await getAuth();
  check("K · configuration normale : aucun doublon", egal(g.identiques, []) && g.configured === true, JSON.stringify(g));

  // forme de l'ID client et du secret : simple indice, jamais bloquant, jamais de valeur
  env({ SHOPIFY_SITE_CLIENT_ID: ID_HEX, SHOPIFY_SITE_CLIENT_SECRET: SECRET_SHPSS });
  g = await getAuth();
  check("K · ID client et secret de forme habituelle : jugés plausibles, secret avec son préfixe", g.formes_plausibles.id_client === true && g.formes_plausibles.secret === true && g.formes_plausibles.secret_prefixe_shpss === true, JSON.stringify(g.formes_plausibles));
  check("K · la sonde ne révèle ni l'ID client ni le secret", !JSON.stringify(g).includes(ID_HEX) && !JSON.stringify(g).includes(SECRET_SHPSS));
  env({ SHOPIFY_SITE_CLIENT_ID: ID_HEX, SHOPIFY_SITE_CLIENT_SECRET: "fedcba9876543210fedcba9876543210" });
  g = await getAuth();
  check("K · ancien secret (32 caractères, sans préfixe) : plausible, mais préfixe absent signalé", g.formes_plausibles.secret === true && g.formes_plausibles.secret_prefixe_shpss === false, JSON.stringify(g.formes_plausibles));
  env({ SHOPIFY_SITE_CLIENT_ID: ID_HEX, SHOPIFY_SITE_CLIENT_SECRET: "x" + SECRET_SHPSS });
  g = await getAuth();
  check("K · texte devant « shpss_ » : ni forme plausible ni préfixe reconnu", g.formes_plausibles.secret === false && g.formes_plausibles.secret_prefixe_shpss === false, JSON.stringify(g.formes_plausibles));
  env({ SHOPIFY_SITE_CLIENT_ID: "0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c", SHOPIFY_SITE_CLIENT_SECRET: "abc" });
  g = await getAuth();
  check("K · ID client de 40 caractères et secret trop court : jugés non plausibles", g.formes_plausibles.id_client === false && g.formes_plausibles.secret === false, JSON.stringify(g.formes_plausibles));
  env({ SHOPIFY_SITE_CLIENT_ID: undefined, SHOPIFY_SITE_CLIENT_SECRET: undefined });
  g = await getAuth();
  check("K · variables absentes : forme « null »", g.formes_plausibles.id_client === null && g.formes_plausibles.secret === null && g.formes_plausibles.secret_prefixe_shpss === null, JSON.stringify(g.formes_plausibles));
  env();
  g = await getAuth();
  check("K · formes inhabituelles : simple indice, la configuration reste valide", g.configured === true && g.formes_plausibles.id_client === false && g.formes_plausibles.secret === false, JSON.stringify(g));
  reset();
  file = [jeton("jt-k"), repInfo];
  r = await outil("get-shop-info", {});
  check("K · formes inhabituelles : l'outil fonctionne quand même", !enErreur(r) && appels.length === 2, `${appels.length} appels · ${texteOutil(r)}`);

  // messages guidés quand Shopify refuse la demande de jeton
  env();
  reset();
  file = [() => rep(400, { error: "application_cannot_be_found", error_description: "Could not find Shopify API application with api_key [FILTERED]" })];
  r = await outil("get-shop-info", {});
  let t = texteOutil(r);
  check("K · application introuvable : les trois causes possibles et la boutique sont nommées", enErreur(r) && /400/.test(t) && /application_cannot_be_found/.test(t) && /site-test\.myshopify\.com/.test(t) && /ID client faux/.test(t) && /Installer l'application/.test(t) && /organisations différentes/.test(t), t);
  check("K · application introuvable : indice sur la forme de l'ID client et du secret, sans leurs valeurs", /SHOPIFY_SITE_CLIENT_ID ne ressemble pas/.test(t) && /SHOPIFY_SITE_CLIENT_SECRET ne ressemble pas/.test(t) && !t.includes(SECRET) && !t.includes(`app-test-${nApp}`), t);
  env({ SHOPIFY_SITE_CLIENT_ID: ID_HEX, SHOPIFY_SITE_CLIENT_SECRET: SECRET_SHPSS });
  reset();
  file = [() => rep(400, { error: "application_cannot_be_found", error_description: "x" })];
  r = await outil("get-shop-info", {});
  check("K · formes habituelles : aucun indice superflu", enErreur(r) && /Installer l'application/.test(texteOutil(r)) && !/Indice/.test(texteOutil(r)), texteOutil(r));
  env({ SHOPIFY_SITE_CLIENT_ID: ID_HEX, SHOPIFY_SITE_CLIENT_SECRET: "fedcba9876543210fedcba9876543210" });
  reset();
  file = [() => rep(400, { error: "invalid_client", error_description: "x" })];
  r = await outil("get-shop-info", {});
  t = texteOutil(r);
  check("K · secret de 32 caractères sans préfixe : indice « ne commence pas par shpss_ », pas d'autre reproche", enErreur(r) && /ne commence pas par « shpss_ »/.test(t) && /ID client qui a été collé/.test(t) && !/ne ressemble pas/.test(t) && !t.includes("fedcba9876543210"), t);
  env();
  reset();
  file = [() => rep(400, { error: "invalid_client", error_description: "x" })];
  r = await outil("get-shop-info", {});
  check("K · secret de forme inhabituelle : un seul indice (forme), pas celui du préfixe", enErreur(r) && /SHOPIFY_SITE_CLIENT_SECRET ne ressemble pas/.test(texteOutil(r)) && !/ne commence pas par/.test(texteOutil(r)), texteOutil(r));
  env();
  reset();
  file = [() => rep(404, "<html>Not Found</html>")];
  r = await outil("get-shop-info", {});
  t = texteOutil(r);
  check("K · boutique introuvable (404 à la demande de jeton) : message sur SHOPIFY_SITE_SHOP", enErreur(r) && /Boutique introuvable/.test(t) && /site-test\.myshopify\.com/.test(t) && /SHOPIFY_SITE_SHOP/.test(t) && appels.length === 1, t);
  env();
  reset();
  file = [() => rep(400, { error: "shop_not_permitted", error_description: "Client credentials cannot be performed on this shop." })];
  r = await outil("get-shop-info", {});
  check("K · autre organisation : message guidé", enErreur(r) && /même organisation/.test(texteOutil(r)) && /shop_not_permitted/.test(texteOutil(r)) && /Développer des applications/.test(texteOutil(r)), texteOutil(r));
});

/* ================================================================== J · aucune fuite dans le journal */
await scenario("J", async () => {
  const jetonsVus = ["jt-1", "jt-2", "jt-A", "jt-B", "jt-C", "jt-ok", "jt-k", "jt-court", "jt-neuf", "shpat_fixe_test"];
  const tout = lignesJournal.join("\n");
  check("J · le journal contient des lignes mcp-site (initialize, appels d'outils)", lignesJournal.some((l) => l.includes('"evt":"mcp-site"') && l.includes('"methode":"initialize"')) && lignesJournal.some((l) => l.includes('"outil":"run-analytics-query"') && l.includes('"ok":true')) && lignesJournal.some((l) => l.includes('"ok":false')), `${lignesJournal.length} lignes`);
  check("J · le journal est composé de lignes JSON valides", lignesJournal.every((l) => { try { JSON.parse(l); return true; } catch { return false; } }));
  check("J · aucun secret dans le journal (clé du connecteur, secret de l'application)", !tout.includes(CLE) && !tout.includes(SECRET));
  check("J · aucun jeton d'accès dans le journal", jetonsVus.every((t) => !tout.includes(t)), jetonsVus.filter((t) => tout.includes(t)).join(","));
  check("J · les requêtes journalisées sont tronquées à 120 caractères", lignesJournal.every((l) => { try { const o = JSON.parse(l); return !o.requete || o.requete.length <= 120; } catch { return false; } }));
  check("J · le nom du client MCP est journalisé (aide au diagnostic)", lignesJournal.some((l) => l.includes('"client":"client-test"')));
});

/* ------------------------------------------------------------------ bilan */
globalThis.fetch = vraiFetch;
console.log = logReel;
let ko = 0;
for (const b of bilan) {
  if (!b.ok) ko++;
  if (!b.ok || process.argv.includes("--verbose")) logReel(`${b.ok ? "OK    " : "ÉCHEC "} ${b.nom}${b.detail ? "  [" + b.detail + "]" : ""}`);
}
logReel(ko ? `\n${ko} contrôle(s) en échec sur ${bilan.length}` : `TEST_MCP_SITE_OK · ${bilan.length} contrôles`);
process.exit(ko ? 2 : 0);
