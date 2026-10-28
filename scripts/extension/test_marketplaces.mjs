#!/usr/bin/env node
/**
 * Test du relais « marketplaces » (api/marketplaces.mjs), sans réseau : Octopia (Cdiscount) et ManoMano sont simulés.
 *
 *   node scripts/extension/test_marketplaces.mjs [--verbose]
 *
 * Vérifie : accès (clé, limite d'essais, sonde de configuration sans valeur), diagnostics de configuration (variables
 * manquantes, valeurs identiques, guillemets de collage), authentification Octopia (jeton, cache, renouvellement),
 * clé ManoMano, routes de consultation seulement, adresses de destination figées chez les marketplaces, expurgation de
 * toute donnée de client, commandes Octopia (jours de Paris, lignes, taxes, commissions, pagination avec ou sans en-tête
 * Link), reprises (429, 5xx), réponses trop grosses, et absence de fuite de clé dans les réponses et dans le journal.
 *
 * Séparé de selftest.mjs : un défaut ici ne doit jamais bloquer l'actualisation quotidienne.
 * Codes de sortie : 0 ok · 2 échec.
 */
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { default: handler } = await import(pathToFileURL(path.join(__dirname, "..", "..", "api", "marketplaces.mjs")).href);

/* ------------------------------------------------------------------ outillage */
const bilan = [];
const check = (nom, cond, detail = "") => { bilan.push({ nom, ok: Boolean(cond), detail: cond ? "" : String(detail).slice(0, 500) }); };
const egal = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Le relais journalise en JSON (console.log) : on capte ces lignes pour vérifier qu'elles ne contiennent aucune clé.
const logReel = console.log.bind(console);
const lignesJournal = [];
console.log = (...a) => { lignesJournal.push(a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ")); };

const CLES_ENV = ["MCP_SITE_KEY", "OCTOPIA_CLIENT_ID", "OCTOPIA_CLIENT_SECRET", "OCTOPIA_SELLER_ID", "OCTOPIA_AUTH_URL", "OCTOPIA_API_URL", "MANOMANO_API_KEY", "MANOMANO_CONTRACT_ID", "MANOMANO_API_URL", "MP_RETRY_MS", "MP_BUDGET_MS"];
const CLE = "cle-de-test-0123456789-abcdefghij-KLMNOP"; // 24 caractères au minimum
const OCT_ID = "client-id-test";
const OCT_SECRET = "octopia-secret-ZZ-4815162342";
const OCT_VENDEUR = "123456";
const MM_CLE = "manomano-cle-QQ-9988776655";
const MM_CONTRAT = "654321";
const JETON_1 = "jt-octopia-AAAA1111";
const JETON_2 = "jt-octopia-BBBB2222";
const SECRETS = [CLE, OCT_SECRET, MM_CLE, JETON_1, JETON_2];
let nApp = 0;
function env(extra = {}) {
  for (const k of CLES_ENV) delete process.env[k];
  // identifiant client différent à chaque scénario : le cache de jetons du relais ne passe pas d'un scénario à l'autre
  Object.assign(process.env, {
    MCP_SITE_KEY: CLE, OCTOPIA_CLIENT_ID: `${OCT_ID}-${++nApp}`, OCTOPIA_CLIENT_SECRET: OCT_SECRET, OCTOPIA_SELLER_ID: OCT_VENDEUR,
    MANOMANO_API_KEY: MM_CLE, MANOMANO_CONTRACT_ID: MM_CONTRAT, MP_RETRY_MS: "1",
  });
  for (const [k, v] of Object.entries(extra)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
}

/* ------------------------------------------------------------------ marketplaces simulées */
const vraiFetch = globalThis.fetch;
let appels = [];            // appels sortants vers Octopia et ManoMano
let file = [];              // réponses simulées, dans l'ordre ; chaque élément : Response, Error ou fonction (appel) => Response | Error
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  const appel = {
    url: u, methode: init.method || "GET", corps: String(init.body ?? ""), signal: init.signal,
    entetes: Object.fromEntries(Object.entries(init.headers || {}).map(([k, v]) => [k.toLowerCase(), v])),
  };
  appels.push(appel);
  if (!/^https:\/\/(auth\.octopia-io\.net|api\.octopia-io\.net|sandbox\.octopia-io\.net|partnersapi\.manomano\.com)\//.test(u)) throw new Error("destination inattendue : " + u);
  const etape = file.shift();
  if (etape === undefined) throw new Error("appel inattendu : " + u);
  const r = typeof etape === "function" ? etape(appel) : etape;
  if (r instanceof Error) throw r;
  return r;
};
const reset = () => { appels = []; file = []; };
const rep = (statut, corps, entetes = {}) => new Response(typeof corps === "string" ? corps : JSON.stringify(corps), { status: statut, headers: { "content-type": "application/json", ...entetes } });
const jeton = (v = JETON_1, exp = 7200) => () => rep(200, { access_token: v, token_type: "Bearer", expires_in: exp });
const consomme = (nom) => check(`${nom} · toutes les réponses simulées ont été utilisées`, file.length === 0, `restantes : ${file.length}`);
const urlDe = (a) => new URL(a.url);

/* ------------------------------------------------------------------ requêtes / réponses simulées */
let nIp = 0;
const nouvelleIp = () => `10.2.${Math.floor(++nIp / 250)}.${nIp % 250}`;
function requete({ methode = "POST", url = "/api/marketplaces", query, entetes = {}, corps, brut, ip, cle = CLE } = {}) {
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
const toutesLesReponses = []; // texte de chaque réponse, pour la recherche finale de fuites
async function appeler(req) { const res = reponseMock(); await handler(req, res); toutesLesReponses.push(JSON.stringify(res.corps ?? null)); return res; }
const demande = (corps, options) => appeler(requete({ corps, ...options }));
const octopia = (action, extra = {}) => demande({ source: "octopia", action, ...extra });
const manomano = (action, extra = {}) => demande({ source: "manomano", action, ...extra });
const texteReponse = (res) => JSON.stringify(res.corps ?? null);

async function scenario(nom, fn) {
  try { reset(); await fn(); } catch (e) { check(`${nom} · exécution du scénario`, false, String(e?.stack || e).split("\n").slice(0, 3).join(" / ")); }
}

/* ------------------------------------------------------------------ données de référence */
// Données de client fictives : aucune ne doit jamais sortir du relais.
const PII = {
  prenom: "Jeanne", nom: "Quidam-Zorglub", email: "jeanne.quidam@example.org", tel: "+33 6 12 34 56 78", tel2: "06 12 34 56 78",
  rue: "12 rue des Lilas-Imaginaires", ville: "Montpellier-Fictive", cp: "34999", digicode: "digicode 4321", societe: "Zorglub SARL",
};
const FRAGMENTS_PII = ["Jeanne", "Quidam", "Zorglub", "example.org", "12 34 56 78", "Lilas", "Montpellier", "34999", "4321"];
const sansPII = (texte) => FRAGMENTS_PII.every((f) => !texte.includes(f));
const fuites = (texte) => FRAGMENTS_PII.filter((f) => texte.includes(f)).join(",");

const ligne = (n, { sku = `SKU-${n}`, qte = 1, prix = 100, taxes = 16.67, com = 10 } = {}) => ({
  orderLineId: `L${n}`, status: "Shipped",
  offer: { sellerProductId: sku, productGtin: "3700000000012", productTitle: `Radiateur test ${n}` },
  quantity: qte,
  offerPrice: { unitSalesPrice: prix, shippingCost: 0, taxes: [{ amount: taxes }], commission: { amountWithVat: Math.round(com * 1.2 * 100) / 100, amountWithoutVat: com, rate: 10 } },
});
const commande = ({ id, achat, pays = "FR", lignes, frais = [{ amount: 1.5 }, { amount: 0.5 }], canal = { id: "CDISFR", name: "Cdiscount" } }) => ({
  orderId: id, reference: `CDS-${id}`, status: "Shipped", purchasedAt: achat, createdAt: achat,
  salesChannel: canal,
  customer: { firstName: PII.prenom, lastName: PII.nom, email: PII.email, phone: PII.tel, companyName: PII.societe },
  shippingAddress: { firstName: PII.prenom, lastName: PII.nom, street: PII.rue, city: PII.ville, zipCode: PII.cp, countryCode: pays, phone: PII.tel2, email: PII.email, comment: PII.digicode },
  billingAddress: { street: PII.rue, city: PII.ville, zipCode: PII.cp, countryCode: pays },
  comment: PII.digicode,
  serviceFees: frais,
  lines: lignes ?? [ligne(1)],
});
const lotDeCommandes = (n, prefixe, achat = "2026-10-27T10:00:00Z") => Array.from({ length: n }, (_, i) => commande({ id: `${prefixe}${i + 1}`, achat }));

/* ================================================================== A · sonde GET et configuration */
await scenario("A", async () => {
  env();
  let r = await appeler(requete({ methode: "GET", cle: "" }));
  check("A · GET sans clé : 200, aucune information sur la configuration", r.statusCode === 200 && r.corps.service === "marketplaces" && r.corps.cle_definie === true && r.corps.cle_valide === true && !("octopia" in r.corps) && !("manomano" in r.corps), texteReponse(r));
  check("A · GET sans clé : aucune valeur de clé en sortie", SECRETS.every((s) => !texteReponse(r).includes(s)));
  r = await appeler(requete({ methode: "GET", cle: "mauvaise-cle" }));
  check("A · GET avec une mauvaise clé : même réponse que sans clé", r.corps?.cle_definie === true && !("octopia" in r.corps), texteReponse(r));
  r = await appeler(requete({ methode: "GET" }));
  check("A · GET avec la bonne clé : les deux sources sont configurées, lecture seule", r.corps.octopia?.configure === true && r.corps.manomano?.configure === true && r.corps.lecture_seule === true && egal(r.corps.octopia.manque, []) && egal(r.corps.manomano.manque, []), texteReponse(r));
  check("A · la sonde ne renvoie aucune clé ni aucun secret", SECRETS.every((s) => !texteReponse(r).includes(s)) && !texteReponse(r).includes(OCT_VENDEUR) && !texteReponse(r).includes(MM_CONTRAT));
  check("A · en-tête Cache-Control: no-store", r.entetes["cache-control"] === "no-store");
  r = await appeler(requete({ methode: "GET", cle: "", entetes: { authorization: `Bearer ${CLE}` } }));
  check("A · clé fournie en Bearer : acceptée", r.corps?.octopia?.configure === true);
  r = await appeler(requete({ methode: "GET", cle: "", query: { key: [CLE, "autre"] } }));
  check("A · clé répétée dans l'adresse : première valeur retenue", r.corps?.octopia?.configure === true);
  r = await appeler(requete({ methode: "GET", cle: "", query: {}, url: `/api/marketplaces?key=${encodeURIComponent(CLE)}` }));
  check("A · clé lue directement dans l'adresse (sans req.query)", r.corps?.octopia?.configure === true);
  r = await appeler(requete({ methode: "PUT" }));
  check("A · méthode PUT : 405 et en-tête Allow", r.statusCode === 405 && r.entetes.allow === "GET, POST", `${r.statusCode} ${r.entetes.allow}`);

  // variables manquantes : seuls les NOMS sont indiqués
  env({ OCTOPIA_CLIENT_SECRET: undefined, MANOMANO_CONTRACT_ID: undefined });
  r = await appeler(requete({ methode: "GET" }));
  check("A · variables manquantes : noms indiqués, source non configurée", r.corps.octopia.configure === false && egal(r.corps.octopia.manque, ["OCTOPIA_CLIENT_SECRET"]) && r.corps.manomano.configure === false && egal(r.corps.manomano.manque, ["MANOMANO_CONTRACT_ID"]), texteReponse(r));
  // même valeur saisie deux fois : erreur de collage classique
  env({ OCTOPIA_CLIENT_SECRET: "valeur-copiee-deux-fois", OCTOPIA_CLIENT_ID: "valeur-copiee-deux-fois" });
  r = await appeler(requete({ methode: "GET" }));
  check("A · même valeur dans deux variables : signalée, source non configurée", r.corps.octopia.configure === false && r.corps.octopia.identiques.length === 1 && /OCTOPIA_CLIENT_ID/.test(r.corps.octopia.identiques[0]) && !texteReponse(r).includes("valeur-copiee-deux-fois"), texteReponse(r));
  // espaces et guillemets de collage
  env({ MANOMANO_API_KEY: `  "${MM_CLE}" ` });
  r = await appeler(requete({ methode: "GET" }));
  check("A · espaces ou guillemets autour d'une valeur : signalés, source tout de même configurée", r.corps.manomano.configure === true && egal(r.corps.manomano.espaces_ou_guillemets, ["MANOMANO_API_KEY"]), texteReponse(r));
  // clé du relais trop courte ou absente
  env({ MCP_SITE_KEY: "courte" });
  r = await appeler(requete({ methode: "GET", cle: "courte" }));
  check("A · clé trop courte : la sonde le dit sans la divulguer", r.corps.cle_definie === true && r.corps.cle_valide === false && !texteReponse(r).includes("courte\""), texteReponse(r));
});

/* ================================================================== B · accès POST */
await scenario("B", async () => {
  env();
  let r = await appeler(requete({ corps: { source: "octopia", action: "ping" }, cle: "" }));
  check("B · POST sans clé : 401 cle_invalide", r.statusCode === 401 && r.corps.error === "cle_invalide", texteReponse(r));
  r = await appeler(requete({ corps: { source: "octopia", action: "ping" }, cle: "mauvaise-cle" }));
  check("B · POST avec une mauvaise clé : 401", r.statusCode === 401);
  check("B · aucun appel sortant sans clé valide", appels.length === 0);

  const ipLimite = "10.9.9.9";
  for (let i = 0; i < 20; i++) await appeler(requete({ corps: { source: "octopia", action: "ping" }, cle: "mauvaise-cle", ip: ipLimite }));
  r = await appeler(requete({ corps: { source: "octopia", action: "ping" }, ip: ipLimite }));
  check("B · après 20 mauvaises clés depuis une adresse : 429, même avec la bonne clé", r.statusCode === 429 && r.corps.error === "trop_de_requetes", `${r.statusCode} ${texteReponse(r)}`);
  r = await appeler(requete({ corps: { source: "inconnue", action: "ping" } }));
  check("B · autre adresse : non bloquée (400 source inconnue)", r.statusCode === 400 && r.corps.error === "source_inconnue", texteReponse(r));

  env({ MCP_SITE_KEY: undefined });
  r = await appeler(requete({ corps: { source: "octopia", action: "ping" }, cle: "n-importe-quoi-de-suffisamment-long" }));
  check("B · clé du relais absente : 503 non_configure", r.statusCode === 503 && r.corps.error === "non_configure", texteReponse(r));
  env({ MCP_SITE_KEY: "trop-courte" });
  r = await appeler(requete({ corps: { source: "octopia", action: "ping" }, cle: "trop-courte" }));
  check("B · clé du relais trop courte : 503", r.statusCode === 503);

  env();
  r = await appeler(requete({ brut: "{pas du json" }));
  check("B · corps illisible : 400 json_invalide", r.statusCode === 400 && r.corps.error === "json_invalide", texteReponse(r));
  r = await appeler(requete({ brut: "[1,2]" }));
  check("B · corps en tableau : 400", r.statusCode === 400 && r.corps.error === "requete_invalide", texteReponse(r));
  r = await appeler(requete({ brut: JSON.stringify({ source: "octopia", action: "ping" }) }));
  check("B · corps reçu en texte JSON : lu (le relais répond sur la configuration ou l'amont, pas sur le format)", r.statusCode !== 400, `${r.statusCode} ${texteReponse(r)}`);
  reset();
  r = await demande({ source: "amazon", action: "ping" });
  check("B · source inconnue : 400", r.statusCode === 400 && r.corps.error === "source_inconnue");
  r = await octopia("supprimer");
  check("B · action inconnue : 400", r.statusCode === 400 && /Action inconnue/.test(r.corps.erreur), texteReponse(r));
  r = await manomano("orders", { du: "2026-10-01", au: "2026-10-02" });
  check("B · « orders » sur ManoMano : 400 avec la marche à suivre", r.statusCode === 400 && /get/.test(r.corps.erreur) && /ping/.test(r.corps.erreur), texteReponse(r));
  check("B · aucune de ces demandes n'a atteint une marketplace", appels.length === 0, `${appels.length} appel(s)`);
  check("B · en-tête Cache-Control: no-store sur les réponses POST", r.entetes["cache-control"] === "no-store");

  // variables manquantes à l'appel : 503 avec les NOMS
  env({ OCTOPIA_SELLER_ID: undefined });
  reset();
  r = await octopia("ping");
  check("B · Octopia sans OCTOPIA_SELLER_ID : 503 qui nomme la variable", r.statusCode === 503 && /OCTOPIA_SELLER_ID/.test(r.corps.erreur) && /redéployer/.test(r.corps.erreur), texteReponse(r));
  env({ MANOMANO_API_KEY: undefined, MANOMANO_CONTRACT_ID: undefined });
  r = await manomano("ping");
  check("B · ManoMano sans variables : 503 qui nomme les deux", r.statusCode === 503 && /MANOMANO_API_KEY/.test(r.corps.erreur) && /MANOMANO_CONTRACT_ID/.test(r.corps.erreur), texteReponse(r));
  env({ OCTOPIA_CLIENT_ID: "valeur-identique-xyz", OCTOPIA_CLIENT_SECRET: "valeur-identique-xyz" });
  r = await octopia("ping");
  check("B · même valeur dans deux variables : 503 qui explique l'erreur de collage", r.statusCode === 503 && /même valeur/.test(r.corps.erreur) && !texteReponse(r).includes("valeur-identique-xyz"), texteReponse(r));
  check("B · aucun appel sortant quand la configuration est incomplète", appels.length === 0);
});

/* ================================================================== C · Octopia : connexion */
await scenario("C", async () => {
  env();
  file = [jeton(), () => rep(200, { sellerId: OCT_VENDEUR, name: "BESTHERM", email: PII.email, address: { street: PII.rue, countryCode: "FR" }, status: "ACTIVE" })];
  let r = await octopia("ping");
  check("C · ping : 200, jeton obtenu, vendeur lu", r.statusCode === 200 && r.corps.ok === true && r.corps.jeton === "obtenu" && r.corps.statut_amont === 200, texteReponse(r));
  const a0 = appels[0], a1 = appels[1];
  const form = new URLSearchParams(a0?.corps);
  check("C · le jeton est demandé en POST sur l'adresse d'authentification d'Octopia, en formulaire", a0?.methode === "POST" && a0.url === "https://auth.octopia-io.net/auth/realms/maas/protocol/openid-connect/token" && /x-www-form-urlencoded/.test(a0.entetes["content-type"]), `${a0?.methode} ${a0?.url} ${a0?.entetes["content-type"]}`);
  check("C · le formulaire contient grant_type, client_id et client_secret", form.get("grant_type") === "client_credentials" && form.get("client_id") === process.env.OCTOPIA_CLIENT_ID && form.get("client_secret") === OCT_SECRET, a0?.corps?.replace(OCT_SECRET, "***"));
  check("C · l'API vendeur est appelée en GET avec le jeton et le numéro de vendeur", a1?.methode === "GET" && a1.url === "https://api.octopia-io.net/seller/v2/sellers" && a1.entetes.authorization === `Bearer ${JETON_1}` && a1.entetes.sellerid === OCT_VENDEUR, `${a1?.methode} ${a1?.url} ${JSON.stringify(a1?.entetes)}`);
  check("C · le vendeur est renvoyé sans e-mail ni adresse (pays seulement)", r.corps.vendeur?.sellerId === OCT_VENDEUR && r.corps.vendeur.email === "<masqué>" && egal(r.corps.vendeur.address, { pays: "FR" }) && sansPII(texteReponse(r)), texteReponse(r));
  check("C · le jeton n'est pas renvoyé", !texteReponse(r).includes(JETON_1));
  consomme("C");

  // le jeton est gardé en mémoire : une lecture suivante ne le redemande pas
  reset();
  file = [() => rep(200, { items: [] })];
  r = await octopia("get", { chemin: "/orders", params: { createdAtMin: "2026-10-27T00:00:00Z" } });
  check("C · jeton réutilisé : un seul appel, sans nouvelle authentification", r.statusCode === 200 && appels.length === 1 && appels[0].url.startsWith("https://api.octopia-io.net/seller/v2/orders?") && appels[0].entetes.authorization === `Bearer ${JETON_1}`, `${appels.length} appels ${appels[0]?.url}`);
  consomme("C");

  // jeton refusé par l'API (révoqué) : un nouveau jeton est demandé, puis la lecture est refaite
  reset();
  file = [() => rep(401, { message: "expired" }), jeton(JETON_2), () => rep(200, { items: [] })];
  r = await octopia("get", { chemin: "/orders" });
  check("C · jeton refusé (401) : renouvelé automatiquement, la lecture aboutit", r.statusCode === 200 && appels.length === 3 && appels[1].methode === "POST" && appels[2].entetes.authorization === `Bearer ${JETON_2}`, `${r.statusCode} ${appels.map((a) => a.methode + a.url.slice(-20)).join(" | ")}`);
  consomme("C");

  // identifiants refusés
  env();
  reset();
  file = [() => rep(401, { error: "invalid_client", error_description: "Invalid client or Invalid client credentials" })];
  r = await octopia("ping");
  check("C · identifiants refusés : 502 avec la marche à suivre, étape « jeton »", r.statusCode === 502 && r.corps.etape === "jeton" && /refuse les identifiants/.test(r.corps.erreur) && /OCTOPIA_CLIENT_SECRET/.test(r.corps.erreur) && /portail API/.test(r.corps.erreur), texteReponse(r));
  check("C · aucune clé dans le message d'erreur", SECRETS.every((s) => !texteReponse(r).includes(s)));
  // l'API d'authentification répète le secret dans son message : il est effacé
  env();
  reset();
  file = [() => rep(400, { error: "invalid_request", error_description: `bad secret ${OCT_SECRET} for client` })];
  r = await octopia("ping");
  check("C · secret répété par l'API d'authentification : effacé de la réponse", r.statusCode === 502 && !texteReponse(r).includes(OCT_SECRET) && texteReponse(r).includes("<secret>"), texteReponse(r));
  // authentification inaccessible
  env();
  reset();
  file = [new Error("connect ECONNREFUSED"), new Error("connect ECONNREFUSED")];
  r = await octopia("ping");
  check("C · authentification inaccessible : 502 « injoignable »", r.statusCode === 502 && /injoignable/.test(r.corps.erreur), texteReponse(r));

  // vendeur refusé
  env();
  reset();
  file = [jeton(), () => rep(403, { message: "forbidden" })];
  r = await octopia("ping");
  check("C · vendeur refusé (403) : 502, étape « vendeur », conseil sur le numéro de vendeur", r.statusCode === 502 && r.corps.etape === "vendeur" && /droit/.test(r.corps.erreur) && /OCTOPIA_SELLER_ID/.test(r.corps.erreur), texteReponse(r));

  // guillemets de collage autour du secret : retirés à l'usage
  env({ OCTOPIA_CLIENT_SECRET: `"${OCT_SECRET}"` });
  reset();
  file = [jeton(), () => rep(200, { sellerId: OCT_VENDEUR })];
  r = await octopia("ping");
  check("C · guillemets autour du secret : retirés dans la demande de jeton", r.statusCode === 200 && new URLSearchParams(appels[0]?.corps).get("client_secret") === OCT_SECRET, appels[0]?.corps?.replace(OCT_SECRET, "***"));
});

/* ================================================================== D · Octopia : lecture de routes */
await scenario("D", async () => {
  env();
  const brutClient = {
    id: "X1", reference: "CDS-X1",
    customer: { firstName: PII.prenom, email: PII.email, shippingAddress: { countryCode: "FR", street: PII.rue } },
    billingAddress: { city: PII.ville, countryCode: "BE" },
    comment: PII.digicode, carrier: { name: "Colissimo" },
    note_libre: `Contact ${PII.email} ou ${PII.tel2} merci`,
    productTitle: "Radiateur 1500W", ean: "3700000000012", floorPrice: 12.5,
    lines: [{ recipientName: PII.prenom, sku: "SKU-1", quantity: 2 }],
  };
  file = [jeton(), () => rep(200, brutClient)];
  let r = await octopia("get", { chemin: "/orders/X1" });
  const d = r.corps.donnees ?? {};
  check("D · lecture d'une commande : 200", r.statusCode === 200 && r.corps.ok === true, texteReponse(r));
  check("D · un bloc client ne garde que le pays de livraison", egal(d.customer, { pays: "FR" }), JSON.stringify(d.customer));
  check("D · une adresse de facturation ne garde que le pays", egal(d.billingAddress, { pays: "BE" }), JSON.stringify(d.billingAddress));
  check("D · commentaire et destinataire masqués", d.comment === "<masqué>" && d.lines?.[0]?.recipientName === "<masqué>", JSON.stringify(d));
  check("D · e-mails et téléphones dans un texte libre masqués", !/example\.org|12 34 56 78/.test(d.note_libre) && /Contact/.test(d.note_libre), d.note_libre);
  check("D · données commerciales conservées (transporteur, titre, EAN, prix plancher, SKU, quantité)", d.carrier?.name === "Colissimo" && d.productTitle === "Radiateur 1500W" && d.ean === "3700000000012" && d.floorPrice === 12.5 && d.lines?.[0]?.sku === "SKU-1" && d.lines[0].quantity === 2, JSON.stringify(d));
  check("D · aucune donnée de client dans toute la réponse", sansPII(texteReponse(r)), fuites(texteReponse(r)));

  // routes de consultation seulement
  for (const chemin of ["/foo", "/orders/1/documents", "/orders/1/document", "/orders/1/shipments", "/orders/1/refunds", "/orders/1/accept", "/orders/1/labels", "/../etc/passwd", "//orders", "orders", "/orders/ça", "/orders/%2e%2e/x", `/orders/${"a".repeat(130)}`, 42, null]) {
    reset(); file = [jeton()];
    r = await octopia("get", { chemin });
    check(`D · chemin refusé : ${String(chemin).slice(0, 30)}`, r.statusCode === 400 && appels.length === 0, `${r.statusCode} ${appels.length} appel(s) ${texteReponse(r).slice(0, 120)}`);
  }
  for (const chemin of ["/orders", "/orders/ABC-1", "/operations", "/payments", "/invoices/99/details", "/offers", "/sellers"]) {
    reset(); file = [() => rep(200, { items: [] })];
    r = await octopia("get", { chemin });
    check(`D · chemin de consultation accepté : ${chemin}`, r.statusCode === 200 && appels.at(-1)?.methode === "GET", `${r.statusCode} ${texteReponse(r).slice(0, 120)}`);
  }

  // paramètres
  reset(); file = [() => rep(200, { items: [] })];
  r = await octopia("get", { chemin: "/orders", params: { createdAtMin: "2026-10-27T00:00:00Z", status: ["Shipped", "Delivered"], pageSize: 50, vide: "" } });
  const u = appels.at(-1) ? urlDe(appels.at(-1)) : null;
  check("D · paramètres transmis (liste répétée, nombre, valeur vide ignorée)", r.statusCode === 200 && u?.searchParams.get("createdAtMin") === "2026-10-27T00:00:00Z" && egal(u.searchParams.getAll("status"), ["Shipped", "Delivered"]) && u.searchParams.get("pageSize") === "50" && !u.searchParams.has("vide"), u?.search);
  for (const [nom, params] of [["objet imbriqué", { a: { b: 1 } }], ["nom invalide", { "a b": "1" }], ["tableau", [1, 2]], ["trop nombreux", Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`p${i}`, "1"]))], ["valeur trop longue", { a: "x".repeat(201) }]]) {
    reset(); file = [jeton()];
    r = await octopia("get", { chemin: "/orders", params });
    check(`D · paramètres refusés : ${nom}`, r.statusCode === 400 && appels.length === 0, `${r.statusCode} ${texteReponse(r).slice(0, 100)}`);
  }

  // destinations figées chez la marketplace
  env({ OCTOPIA_API_URL: "https://pirate.example.com/seller/v2", OCTOPIA_AUTH_URL: "http://auth.octopia-io.net/token" });
  reset(); file = [jeton(), () => rep(200, { items: [] })];
  r = await octopia("get", { chemin: "/orders" });
  check("D · adresse d'API hors Octopia (ou non sécurisée) : ignorée, adresses de production utilisées", r.statusCode === 200 && appels[0]?.url === "https://auth.octopia-io.net/auth/realms/maas/protocol/openid-connect/token" && appels[1]?.url.startsWith("https://api.octopia-io.net/seller/v2/orders"), appels.map((a) => a.url).join(" | "));
  env({ OCTOPIA_API_URL: "https://sandbox.octopia-io.net/seller/v2/" });
  reset(); file = [jeton(), () => rep(200, { items: [] })];
  r = await octopia("get", { chemin: "/orders" });
  check("D · adresse d'API d'un sous-domaine d'Octopia (bac à sable) : acceptée", r.statusCode === 200 && appels[1]?.url.startsWith("https://sandbox.octopia-io.net/seller/v2/orders"), appels.map((a) => a.url).join(" | "));

  // erreurs et reprises
  env();
  reset(); file = [jeton(), () => rep(404, { message: "not found" })];
  r = await octopia("get", { chemin: "/orders/NOPE" });
  check("D · 404 : message clair, pas de reprise", r.statusCode === 400 && /introuvable/.test(r.corps.erreur) && r.corps.statut_amont === 404 && appels.length === 2, `${r.statusCode} ${texteReponse(r)}`);
  env();
  reset(); file = [jeton(), () => rep(500, "boom"), () => rep(500, "boom"), () => rep(500, "boom")];
  r = await octopia("get", { chemin: "/orders" });
  check("D · erreur 500 persistante : trois essais puis 502", r.statusCode === 502 && appels.length === 4 && /côté marketplace/.test(r.corps.erreur), `${r.statusCode} ${appels.length} ${texteReponse(r)}`);
  env();
  reset(); file = [jeton(), () => rep(429, { message: "slow down" }), () => rep(200, { items: [{ id: "OK" }] })];
  r = await octopia("get", { chemin: "/orders" });
  check("D · limitation de débit (429) : reprise puis succès", r.statusCode === 200 && appels.length === 3 && egal(r.corps.donnees, { items: [{ id: "OK" }] }), `${r.statusCode} ${appels.length}`);
  env();
  reset(); file = [jeton(), new Error("socket hang up"), new Error("socket hang up"), new Error("socket hang up")];
  r = await octopia("get", { chemin: "/orders" });
  check("D · réseau coupé : trois essais puis 502 « injoignable »", r.statusCode === 502 && /injoignable/.test(r.corps.erreur) && appels.length === 4, `${r.statusCode} ${appels.length} ${texteReponse(r)}`);
  env();
  reset(); file = [jeton(), () => new Response("x".repeat(3_600_000), { status: 200, headers: { "content-type": "application/json" } })];
  r = await octopia("get", { chemin: "/orders" });
  check("D · réponse trop volumineuse : 413 avec conseil", r.statusCode === 413 && /volumineuse/.test(r.corps.erreur), `${r.statusCode} ${texteReponse(r).slice(0, 120)}`);
  env();
  reset(); file = [jeton(), () => new Response("<html>maintenance</html>", { status: 200, headers: { "content-type": "text/html" } })];
  r = await octopia("get", { chemin: "/orders" });
  check("D · réponse non JSON : pas de plantage", r.statusCode === 200 && r.corps.donnees === null, `${r.statusCode} ${texteReponse(r).slice(0, 120)}`);
  env();
  reset(); file = [jeton(), () => rep(400, { message: `clé ${OCT_SECRET} invalide`, detail: PII.email })];
  r = await octopia("get", { chemin: "/orders" });
  check("D · message d'erreur de l'API : expurgé, sans clé ni donnée de client", r.statusCode === 400 && !texteReponse(r).includes(OCT_SECRET) && sansPII(texteReponse(r)), texteReponse(r));
});

/* ================================================================== E · Octopia : commandes d'une période */
await scenario("E", async () => {
  env();
  const A1 = commande({ id: "A1", achat: "2026-10-27T10:00:00Z", lignes: [ligne(1, { sku: "BH-100", qte: 2, prix: 119.9, taxes: 19.98, com: 12 }), ligne(2, { sku: "TH-200", qte: 1, prix: 49, taxes: 8.17, com: 5 })] });
  const A2 = commande({ id: "A2", achat: "2026-10-27T23:30:00Z", pays: "BE" });  // 00 h 30 le 28 à Paris (heure d'hiver, UTC+1)
  const A3 = commande({ id: "A3", achat: "2026-10-26T22:59:59Z" });                // 23 h 59 le 26 à Paris
  file = [jeton(), () => rep(200, { items: [A1, A2, A3] })];
  let r = await octopia("orders", { du: "2026-10-27", au: "2026-10-27" });
  const u = appels[1] ? urlDe(appels[1]) : null;
  check("E · commandes du 27/10 : 200, trois commandes lues, deux lignes retenues (jours de Paris)", r.statusCode === 200 && r.corps.commandes_lues === 3 && r.corps.nb_lignes === 2 && r.corps.lignes.every((l) => l.jour === "2026-10-27"), `${r.statusCode} ${r.corps?.commandes_lues} ${r.corps?.nb_lignes}`);
  check("E · fenêtre demandée élargie d'un jour de chaque côté, taille de page 100, pas d'index de page à la première", u?.searchParams.get("createdAtMin") === "2026-10-26T00:00:00Z" && u.searchParams.get("createdAtMax") === "2026-10-28T23:59:59Z" && u.searchParams.get("pageSize") === "100" && !u.searchParams.has("pageIndex"), u?.search);
  const l1 = r.corps.lignes?.[0], l2 = r.corps.lignes?.[1];
  check("E · ligne 1 : article, quantité, prix, taxes, commission, pays, canal", l1?.sku === "BH-100" && l1.qte === 2 && l1.offre_unitaire === 119.9 && l1.offre_taxes === 19.98 && l1.commission_ht === 12 && l1.commission_ttc === 14.4 && l1.taux_commission === 10 && l1.pays === "FR" && l1.canal === "CDISFR" && l1.canal_nom === "Cdiscount" && l1.commande === "CDS-A1" && l1.gtin === "3700000000012", JSON.stringify(l1));
  check("E · frais de service de la commande comptés une seule fois (première ligne)", l1?.frais_service_commande === 2 && l2?.frais_service_commande === null, `${l1?.frais_service_commande} ${l2?.frais_service_commande}`);
  check("E · aucune donnée de client dans les lignes", sansPII(texteReponse(r)), fuites(texteReponse(r)));
  check("E · pas d'échantillon ni de prix brut sans le demander", !("echantillon" in r.corps) && !("prix_brut" in (l1 ?? {})));
  consomme("E");

  // deux jours : la commande de 00 h 30 le 28 est retenue, avec son pays
  reset(); file = [() => rep(200, { items: [A1, A2, A3] })];
  r = await octopia("orders", { du: "2026-10-27", au: "2026-10-28" });
  check("E · 27 et 28/10 : la commande de 00 h 30 (Paris) est comptée le 28, pays BE", r.corps.nb_lignes === 3 && r.corps.lignes.some((l) => l.jour === "2026-10-28" && l.commande === "CDS-A2" && l.pays === "BE"), JSON.stringify(r.corps.lignes?.map((l) => [l.jour, l.commande, l.pays])));
  // heure d'été : UTC+2
  reset(); file = [() => rep(200, { items: [commande({ id: "E1", achat: "2026-07-14T22:30:00Z" }), commande({ id: "E2", achat: "2026-07-14T21:59:59Z" })] })];
  r = await octopia("orders", { du: "2026-07-14", au: "2026-07-15" });
  check("E · heure d'été (UTC+2) : 22 h 30 UTC = 00 h 30 le lendemain, 21 h 59 UTC = 23 h 59 la veille", egal(r.corps.lignes?.map((l) => [l.commande, l.jour]), [["CDS-E1", "2026-07-15"], ["CDS-E2", "2026-07-14"]]), JSON.stringify(r.corps.lignes?.map((l) => [l.commande, l.jour])));

  // pagination avec l'en-tête Link
  reset();
  const lien = `<https://api.octopia-io.net/seller/v2/orders?createdAtMin=2026-10-26T00%3A00%3A00Z&createdAtMax=2026-10-28T23%3A59%3A59Z&pageIndex=2&pageSize=100&secret=${"x".repeat(5)}>; rel="next", <https://api.octopia-io.net/seller/v2/orders?pageIndex=1>; rel="first"`;
  file = [() => rep(200, { items: lotDeCommandes(100, "P") }, { link: lien }), () => rep(200, { items: lotDeCommandes(30, "Q") })];
  r = await octopia("orders", { du: "2026-10-27", au: "2026-10-27" });
  const u2 = appels[1] ? urlDe(appels[1]) : null;
  check("E · pagination par en-tête Link : deux pages, 130 commandes, 130 lignes", r.corps.pages === 2 && r.corps.commandes_lues === 130 && r.corps.nb_lignes === 130 && r.corps.tronque === false, `${r.corps.pages} ${r.corps.commandes_lues} ${r.corps.nb_lignes}`);
  check("E · la page suivante reprend les paramètres du lien (index 2) sans quitter l'adresse d'Octopia", u2?.host === "api.octopia-io.net" && u2.pathname === "/seller/v2/orders" && u2.searchParams.get("pageIndex") === "2" && u2.searchParams.get("createdAtMin") === "2026-10-26T00:00:00Z", u2?.href);
  check("E · l'état de la pagination est renvoyé pour le diagnostic", r.corps.pagination?.lien_suivant === true, JSON.stringify(r.corps.pagination));
  consomme("E");

  // pagination sans en-tête Link, API dont l'index commence à 1 : la première page revient, elle n'est pas comptée deux fois
  reset();
  const page1 = lotDeCommandes(100, "R");
  file = [() => rep(200, { items: page1 }), () => rep(200, { items: page1 }), () => rep(200, { items: lotDeCommandes(20, "S") })];
  r = await octopia("orders", { du: "2026-10-27", au: "2026-10-27" });
  const indexDemandes = appels.map((a) => urlDe(a).searchParams.get("pageIndex"));
  check("E · pagination sans Link (index à base 1) : doublons ignorés, 120 commandes, 3 pages", r.corps.commandes_lues === 120 && r.corps.nb_lignes === 120 && r.corps.pages === 3, `${r.corps.commandes_lues} ${r.corps.nb_lignes} ${r.corps.pages}`);
  check("E · index demandés : aucun, puis 1, puis 2", egal(indexDemandes, [null, "1", "2"]), JSON.stringify(indexDemandes));
  consomme("E");
  // pagination sans Link, index à base 0 : la page 1 est la deuxième
  reset();
  file = [() => rep(200, { items: lotDeCommandes(100, "T") }), () => rep(200, { items: lotDeCommandes(40, "U") })];
  r = await octopia("orders", { du: "2026-10-27", au: "2026-10-27" });
  check("E · pagination sans Link (index à base 0) : 140 commandes en 2 pages", r.corps.commandes_lues === 140 && r.corps.pages === 2 && urlDe(appels[1]).searchParams.get("pageIndex") === "1", `${r.corps.commandes_lues} ${r.corps.pages}`);
  consomme("E");
  // un API qui répète toujours la même page ne fait pas boucler le relais
  reset();
  const fixe = lotDeCommandes(100, "V");
  file = [() => rep(200, { items: fixe }), () => rep(200, { items: fixe }), () => rep(200, { items: fixe })];
  r = await octopia("orders", { du: "2026-10-27", au: "2026-10-27" });
  check("E · page répétée à l'infini : arrêt après un essai de plus, aucun doublon", r.statusCode === 200 && r.corps.commandes_lues === 100 && r.corps.pages === 3 && appels.length === 3, `${r.corps.commandes_lues} ${r.corps.pages} ${appels.length}`);

  // échantillon
  reset(); file = [() => rep(200, { items: [A1, A2] })];
  r = await octopia("orders", { du: "2026-10-27", au: "2026-10-27", echantillon: true });
  check("E · échantillon : première commande expurgée (pays seulement) et blocs de prix bruts des premières lignes", r.corps.echantillon?.orderId === "A1" && egal(r.corps.echantillon.shippingAddress, { pays: "FR" }) && r.corps.echantillon.comment === "<masqué>" && r.corps.lignes?.[0]?.prix_brut?.offerPrice?.unitSalesPrice === 119.9, JSON.stringify(r.corps.echantillon).slice(0, 300));
  check("E · échantillon : aucune donnée de client", sansPII(texteReponse(r)), fuites(texteReponse(r)));
  reset(); file = [() => rep(400, { error: "bad_parameter", parameter: "createdAtMax" })];
  r = await octopia("orders", { du: "2026-10-27", au: "2026-10-27", echantillon: true });
  check("E · refus de l'API avec échantillon : le détail du refus est donné", r.statusCode === 400 && /Détail/.test(r.corps.erreur) && /createdAtMax/.test(r.corps.erreur), texteReponse(r));
  reset(); file = [() => rep(400, { error: "bad_parameter" })];
  r = await octopia("orders", { du: "2026-10-27", au: "2026-10-27" });
  check("E · refus de l'API sans échantillon : message court sans détail", r.statusCode === 400 && !/Détail/.test(r.corps.erreur), texteReponse(r));

  // canal de vente
  reset(); file = [() => rep(200, { items: [] })];
  await octopia("orders", { du: "2026-10-27", au: "2026-10-27", salesChannelId: "CDISFR" });
  check("E · canal de vente valide : transmis", urlDe(appels[0]).searchParams.get("salesChannelId") === "CDISFR");
  reset(); file = [() => rep(200, { items: [] })];
  await octopia("orders", { du: "2026-10-27", au: "2026-10-27", salesChannelId: "a b;c" });
  check("E · canal de vente invalide : ignoré", !urlDe(appels[0]).searchParams.has("salesChannelId"));

  // contrôles de période
  for (const [nom, corps] of [["fin avant début", { du: "2026-10-28", au: "2026-10-27" }], ["trop longue", { du: "2026-08-01", au: "2026-10-27" }], ["format", { du: "27/10/2026", au: "28/10/2026" }], ["date impossible", { du: "2026-13-45", au: "2026-13-46" }], ["absente", {}]]) {
    reset(); file = [jeton()];
    r = await octopia("orders", corps);
    check(`E · période refusée (${nom}) : 400 sans appel sortant`, r.statusCode === 400 && appels.length === 0, `${r.statusCode} ${appels.length} ${texteReponse(r).slice(0, 100)}`);
  }
  reset(); file = [() => rep(200, { items: [] })];
  r = await octopia("orders", { du: "2026-09-23", au: "2026-10-27" });
  check("E · 35 jours : accepté", r.statusCode === 200, `${r.statusCode} ${texteReponse(r).slice(0, 100)}`);

  // commandes sans lignes, réponse en tableau nu, dates absentes
  reset(); file = [() => rep(200, [{ orderId: "N1", purchasedAt: "2026-10-27T09:00:00Z" }, { orderId: "N2", lines: [ligne(1)] }])];
  r = await octopia("orders", { du: "2026-10-27", au: "2026-10-27" });
  check("E · réponse en tableau nu, commande sans ligne et commande sans date : lues sans plantage, aucune ligne retenue", r.statusCode === 200 && r.corps.commandes_lues === 2 && r.corps.nb_lignes === 0, `${r.statusCode} ${r.corps.commandes_lues} ${r.corps.nb_lignes}`);

  // budget de temps épuisé : résultat partiel signalé
  env({ MP_BUDGET_MS: "3500" });
  reset(); file = [jeton()];
  r = await octopia("orders", { du: "2026-10-27", au: "2026-10-27" });
  check("E · budget de temps trop court : résultat partiel signalé (tronque), aucune lecture", r.statusCode === 200 && r.corps.tronque === true && r.corps.pages === 0, `${r.statusCode} ${r.corps?.tronque} ${r.corps?.pages}`);
});

/* ================================================================== F · ManoMano */
await scenario("F", async () => {
  env();
  const bloc = { orders: [{ order_reference: "MM-1", status: "SHIPPED", customer: { firstname: PII.prenom, email: PII.email, shipping_address: { country: "FR", city: PII.ville, street: PII.rue, phone: PII.tel2 } }, shipping_country: "FR", comment: PII.digicode, products: [{ sku: "BH-100", quantity: 1, price: 99.9 }] }] };
  file = [() => rep(404, { message: "not found" }), () => rep(200, bloc, { "x-total-count": "1" })];
  let r = await manomano("ping");
  check("F · ping : le premier chemin répond 404, le second 200 → chemin retenu", r.statusCode === 200 && r.corps.chemin === "/orders/v2/orders" && r.corps.essais.length === 2 && r.corps.essais[0].statut === 404 && r.corps.essais[1].statut === 200, texteReponse(r).slice(0, 300));
  const a = appels[0];
  check("F · clé envoyée en en-tête x-api-key, numéro de contrat en paramètre, aucun en-tête Authorization", a?.entetes["x-api-key"] === MM_CLE && urlDe(a).searchParams.get("seller_contract_id") === MM_CONTRAT && !("authorization" in a.entetes), JSON.stringify({ ...a?.entetes, "x-api-key": "***" }) + " " + a?.url);
  check("F · adresse : partnersapi.manomano.com, méthode GET", urlDe(a).origin === "https://partnersapi.manomano.com" && a.methode === "GET", a?.url);
  check("F · ping : la forme de la réponse est donnée, sans donnée de client ni clé", r.corps.forme?.orders?.[0] !== undefined && sansPII(texteReponse(r)) && SECRETS.every((s) => !texteReponse(r).includes(s)), texteReponse(r).slice(0, 400));
  consomme("F");

  reset(); file = [() => rep(404, "nf"), () => rep(404, "nf"), () => rep(400, { message: "unknown parameter" })];
  r = await manomano("ping");
  check("F · aucun chemin ne répond 200 : 502 qui liste les essais", r.statusCode === 502 && r.corps.essais?.length === 3 && /aucune route/.test(r.corps.erreur) && /→ 400/.test(r.corps.erreur), texteReponse(r).slice(0, 300));
  check("F · le détail du refus de l'API est conservé pour le diagnostic", r.corps.essais?.[2]?.detail?.includes("unknown parameter"), texteReponse(r).slice(0, 300));

  reset(); file = [() => rep(401, { message: `Invalid api key ${MM_CLE}` })];
  r = await manomano("ping");
  check("F · clé refusée (401) : arrêt immédiat avec conseil, la clé répétée par l'API est effacée", r.statusCode === 502 && appels.length === 1 && /clé refusée/.test(r.corps.erreur) && !texteReponse(r).includes(MM_CLE) && texteReponse(r).includes("<secret>"), texteReponse(r).slice(0, 300));
  reset(); file = [() => rep(403, { message: "contract mismatch" })];
  r = await manomano("ping");
  check("F · contrat refusé (403) : conseil sur le numéro de contrat", r.statusCode === 502 && /contrat/.test(r.corps.erreur), texteReponse(r).slice(0, 300));

  // lecture d'une route
  reset(); file = [() => rep(200, bloc)];
  r = await manomano("get", { chemin: "/orders/v1/orders", params: { status_updated_at_start: "2026-10-27T00:00:00Z", status_updated_at_end: "2026-10-28T00:00:00Z", page: 1, limit: 50 } });
  const u = appels[0] ? urlDe(appels[0]) : null;
  const o = r.corps.donnees?.orders?.[0] ?? {};
  check("F · lecture des commandes : paramètres transmis, contrat ajouté", r.statusCode === 200 && u.pathname === "/orders/v1/orders" && u.searchParams.get("status_updated_at_start") === "2026-10-27T00:00:00Z" && u.searchParams.get("seller_contract_id") === MM_CONTRAT && u.searchParams.get("limit") === "50", u?.href);
  check("F · bloc client : pays de livraison seulement ; pays de livraison de la commande conservé", egal(o.customer, { pays: "FR" }) && o.shipping_country === "FR", JSON.stringify(o));
  check("F · commentaire masqué, produits conservés (SKU, quantité, prix)", o.comment === "<masqué>" && o.products?.[0]?.sku === "BH-100" && o.products[0].price === 99.9, JSON.stringify(o));
  check("F · aucune donnée de client dans toute la réponse", sansPII(texteReponse(r)), fuites(texteReponse(r)));
  consomme("F");

  reset(); file = [() => rep(200, { orders: [] })];
  r = await manomano("get", { chemin: "/orders/v1/orders", params: { seller_contract_id: "111111" } });
  check("F · numéro de contrat donné explicitement : respecté, jamais écrasé", urlDe(appels[0]).searchParams.get("seller_contract_id") === "111111", appels[0]?.url);

  for (const chemin of ["/catalog/v1/x", "/orders/v1/orders/1/documents", "/orders/v1/orders/1/shipments", "/orders/1/refund", "/v1/orders"]) {
    reset(); file = [];
    r = await manomano("get", { chemin });
    check(`F · chemin refusé : ${chemin}`, r.statusCode === 400 && appels.length === 0, `${r.statusCode} ${appels.length}`);
  }

  env({ MANOMANO_API_URL: "https://pirate.example.com" });
  reset(); file = [() => rep(200, { orders: [] })];
  r = await manomano("get", { chemin: "/orders/v1/orders" });
  check("F · adresse d'API hors ManoMano : ignorée, l'adresse de production est utilisée", r.statusCode === 200 && urlDe(appels[0]).origin === "https://partnersapi.manomano.com", appels[0]?.url);

  env();
  reset(); file = [() => rep(500, "boom"), () => rep(500, "boom"), () => rep(500, "boom")];
  r = await manomano("get", { chemin: "/orders/v1/orders" });
  check("F · erreur 500 persistante : trois essais puis 502", r.statusCode === 502 && appels.length === 3, `${r.statusCode} ${appels.length}`);
});

/* ================================================================== G · aucune fuite de clé */
await scenario("G", async () => {
  const tout = lignesJournal.join("\n");
  const toutesRep = toutesLesReponses.join("\n");
  check("G · le journal contient des lignes du relais, valides en JSON", lignesJournal.some((l) => l.includes('"evt":"marketplaces"')) && lignesJournal.every((l) => { try { JSON.parse(l); return true; } catch { return false; } }), `${lignesJournal.length} lignes`);
  check("G · le journal indique source, action et durée", lignesJournal.some((l) => l.includes('"source":"octopia"') && l.includes('"action":"orders"') && /"ms":\d+/.test(l)) && lignesJournal.some((l) => l.includes('"source":"manomano"')));
  check("G · aucune clé ni aucun secret dans le journal", SECRETS.every((s) => !tout.includes(s)), SECRETS.filter((s) => tout.includes(s)).map((s) => s.slice(0, 8)).join(","));
  check("G · aucune clé ni aucun jeton dans l'ensemble des réponses du test", SECRETS.every((s) => !toutesRep.includes(s)), SECRETS.filter((s) => toutesRep.includes(s)).map((s) => s.slice(0, 8)).join(","));
  check("G · aucune donnée de client dans l'ensemble des réponses du test", sansPII(toutesRep), fuites(toutesRep));
  check("G · les erreurs sont journalisées sans corps de réponse brut", lignesJournal.some((l) => l.includes('"ok":false')) && lignesJournal.every((l) => l.length < 600), `${Math.max(...lignesJournal.map((l) => l.length))}`);
});

/* ------------------------------------------------------------------ bilan */
globalThis.fetch = vraiFetch;
console.log = logReel;
let ko = 0;
for (const b of bilan) {
  if (!b.ok) ko++;
  if (!b.ok || process.argv.includes("--verbose")) logReel(`${b.ok ? "OK    " : "ÉCHEC "} ${b.nom}${b.detail ? "  [" + b.detail + "]" : ""}`);
}
logReel(ko ? `\n${ko} contrôle(s) en échec sur ${bilan.length}` : `TEST_MARKETPLACES_OK · ${bilan.length} contrôles`);
process.exit(ko ? 2 : 0);
