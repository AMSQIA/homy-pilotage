// api/mcp-site.mjs — connecteur MCP « boutique du site » : un second connecteur Shopify, en LECTURE SEULE.
//
// Pourquoi ce fichier : le connecteur Shopify de Claude ne sert qu'UNE boutique à la fois (en changer coupe
// la première). Ce relais est un connecteur à part, qui ne lit que la boutique du site web ; la connexion à la
// boutique BESTHERM (connecteur Shopify de Claude) n'est pas touchée.
//
// Comment : Claude (connecteur personnalisé) envoie des requêtes MCP (JSON-RPC sur HTTP) à
//   https://<votre-app>.vercel.app/api/mcp-site?key=<MCP_SITE_KEY>
// Le relais interroge l'API d'administration Shopify avec une application en lecture seule (droit read_reports),
// uniquement via ShopifyQL : des agrégats (ventes, quantités, pays, références). Aucune écriture, aucune donnée
// de client (adresses e-mail, téléphones, noms, adresses : les requêtes qui les visent sont refusées).
//
// Variables d'environnement Vercel (jamais dans le code, ni dans GitHub, ni dans une conversation) :
//   MCP_SITE_KEY                clé secrète longue (24 caractères minimum, lettres et chiffres), placée dans l'adresse du connecteur
//   SHOPIFY_SITE_SHOP           boutique du site : « xxxx » ou « xxxx.myshopify.com »
//   SHOPIFY_SITE_CLIENT_ID      identifiant de l'application (Dev Dashboard de Shopify)
//   SHOPIFY_SITE_CLIENT_SECRET  secret de l'application
//   (variante : SHOPIFY_SITE_TOKEN = jeton d'administration fixe, à la place du couple identifiant / secret)
//   SHOPIFY_SITE_API_VERSION    facultatif (défaut 2026-04)
//
// Seconde boutique (marketplaces, « BESTHERM »), lue par le même relais avec l'argument « boutique: "marketplaces" » :
//   SHOPIFY_MP_SHOP             boutique des marketplaces : « xxxx » ou « xxxx.myshopify.com » (46a3f9-2)
//   SHOPIFY_MP_CLIENT_ID        identifiant de l'application installée sur CETTE boutique ; facultatif : sans lui (ni secret, ni
//   SHOPIFY_MP_CLIENT_SECRET    jeton), on reprend ceux de la boutique du site (une même application installée sur les deux
//                               boutiques d'une même organisation Shopify)
//   SHOPIFY_MP_TOKEN            variante : jeton d'administration fixe de cette boutique
//
// Vérification après déploiement : ouvrir /api/mcp-site?key=<MCP_SITE_KEY> dans le navigateur →
// {"ok":true,"configured":true,…}. Sans la clé, la page ne révèle rien. Si "configured" vaut false, la liste
// "manque" donne les variables à saisir et "identiques" celles qui portent la même valeur (erreur de collage ; puis
// redéployer : Vercel n'applique pas une variable à un déploiement déjà en ligne). "formes_plausibles" indique, sans
// révéler les valeurs, si l'ID client et le secret ont la forme habituelle et si le secret commence par « shpss_ »
// (true / false, null = variable absente).
//
// Changer la clé : modifier MCP_SITE_KEY dans Vercel, redéployer, puis corriger l'adresse du connecteur dans Claude.

import crypto from "crypto";

const VERSIONS_MCP = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const SERVEUR = { name: "homy-shopify-site", title: "HOM'Y - boutiques Shopify (lecture seule)", version: "1.1.0" };
const INSTRUCTIONS =
  "Boutiques Shopify de HOM'Y, en lecture seule : le site web (boutique par défaut) et les marketplaces (boutique BESTHERM, " +
  "argument boutique = \"marketplaces\"). Outils : get-shop-info (identité de la boutique) et " +
  "run-analytics-query (requête ShopifyQL sur les jeux sales, sessions, products ou payments ; agrégats uniquement, aucune " +
  "donnée de client). Les jours sont ceux du fuseau horaire de la boutique. Ce connecteur est distinct du " +
  "connecteur Shopify de Claude : ne jamais appeler switch-shop sur celui-ci pour lire une autre boutique.";

// Boutiques lisibles : chacune a son préfixe de variables Vercel. Aucune autre boutique ne peut être demandée par un appel.
const PROFILS = {
  site: { prefixe: "SHOPIFY_SITE", libelle: "du site" },
  marketplaces: { prefixe: "SHOPIFY_MP", libelle: "des marketplaces (BESTHERM)" },
};
const BOUTIQUES = Object.keys(PROFILS);

const LONGUEUR_CLE_MIN = 24;
const CLE_SURE_POUR_UNE_ADRESSE = /^[A-Za-z0-9._~-]+$/; // la clé est placée dans une adresse web : lettres, chiffres, . _ ~ - seulement
// Formes habituelles des identifiants d'une application Dev Dashboard : simples indices de diagnostic, jamais bloquants.
// ID client = 32 caractères hexadécimaux ; secret = « shpss_ » + 32 caractères hexadécimaux (anciens secrets : les 32 seuls).
const FORME_ID_CLIENT = /^[0-9a-f]{32}$/i;
const FORME_SECRET = /^(?:shpss_)?[0-9a-f]{32}$/i;
const PREFIXE_SECRET = /^shpss_/i;
const MAX_REQUETE = 1500;
// « payments » : transactions des commandes (passerelle de paiement), sans donnée de client ; elle sert à rattacher chaque
// commande des marketplaces à sa marketplace (la passerelle porte le nom de la marketplace).
const JEUX_AUTORISES = new Set(["sales", "sessions", "products", "payments"]);
// Défense en profondeur : même sans le droit sur les clients, on refuse toute requête qui vise des données personnelles
// (identifiants repérés comme mots entiers, « _ » étant un séparateur : customer_email, shipping_postal_code…).
// Les pays et régions restent permis ; les textes entre apostrophes ne sont pas examinés (WHERE product_title = 'phone case').
const DONNEES_PERSONNELLES =
  /(?<![a-z0-9])(?:customers?|e?mail|phone|first_name|last_name|full_name|(?:billing|shipping)_(?:name|address\w*|city|zip\w*|postal\w*|phone|street\w*)|address[12]?|street|postal_code|zip(?:_code)?|city)(?![a-z0-9])/i;

const LIMITE_ECHECS = 20; // mauvaises clés par IP et par fenêtre
const FENETRE_MS = 5 * 60 * 1000;
const echecs = new Map();
const jetons = new Map(); // "domaine|clientId" -> { valeur, expire }

class ErreurOutil extends Error {}

const PARAM_BOUTIQUE = {
  type: "string",
  enum: BOUTIQUES,
  description: "Boutique à lire : « site » (par défaut, bestherm.fr) ou « marketplaces » (boutique BESTHERM).",
};

const OUTILS = [
  {
    name: "get-shop-info",
    title: "Identité de la boutique",
    description:
      "Renvoie le nom, le domaine myshopify, le domaine principal, la devise, le fuseau horaire et les droits accordés à " +
      "l'application de lecture. À appeler en premier pour vérifier qu'on lit la bonne boutique (site par défaut, " +
      "ou boutique = \"marketplaces\" pour BESTHERM).",
    inputSchema: { type: "object", properties: { boutique: PARAM_BOUTIQUE }, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  {
    name: "run-analytics-query",
    title: "Requête ShopifyQL (lecture seule)",
    description:
      "Exécute une requête ShopifyQL sur la boutique demandée (le site par défaut) et renvoie {query, columns, rows, shopDomain}, " +
      "avec les valeurs en texte, au même format que l'outil du même nom du connecteur Shopify. Jeux autorisés : sales, " +
      "sessions, products, payments. Exemple : FROM sales SHOW orders, quantity_ordered, net_sales, taxes TIMESERIES day " +
      "SINCE 2026-10-01 UNTIL 2026-10-14. Agrégats uniquement : les requêtes sur des données personnelles de clients sont refusées.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Requête ShopifyQL, commençant par FROM sales, FROM sessions, FROM products ou FROM payments." },
        boutique: PARAM_BOUTIQUE,
      },
      required: ["query"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
];

// ---------------------------------------------------------------------------------------------- configuration
function versionApi() {
  const v = String(process.env.SHOPIFY_SITE_API_VERSION || "").trim();
  return /^\d{4}-\d{2}$/.test(v) ? v : "2026-04";
}

function domaineDe(valeur) {
  const brut = String(valeur || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/[/?#].*$/, "");
  const complet = brut ? (brut.endsWith(".myshopify.com") ? brut : `${brut}.myshopify.com`) : "";
  return /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(complet) ? complet : "";
}

// Configuration d'une boutique (« site » ou « marketplaces ») d'après les variables Vercel de son préfixe.
function lireConfig(boutique = "site") {
  const p = PROFILS[boutique];
  const pre = p.prefixe;
  const lire = (nom) => String(process.env[nom] || "").trim();
  const domaine = domaineDe(process.env[`${pre}_SHOP`]);
  let clientId = lire(`${pre}_CLIENT_ID`), clientSecret = lire(`${pre}_CLIENT_SECRET`);
  const jeton = lire(`${pre}_TOKEN`);
  // Boutique des marketplaces sans identifiants propres : on reprend ceux de l'application de la boutique du site (la même
  // application peut être installée sur les deux boutiques d'une même organisation Shopify). Jamais de jeton hérité.
  const herite = boutique !== "site" && !clientId && !clientSecret && !jeton;
  if (herite) { clientId = lire("SHOPIFY_SITE_CLIENT_ID"); clientSecret = lire("SHOPIFY_SITE_CLIENT_SECRET"); }
  const cfg = { boutique, libelle: p.libelle, prefixe: pre, cle: lire("MCP_SITE_KEY"), domaine, clientId, clientSecret, jeton, herite };
  const manque = [];
  if (!domaine) manque.push(`${pre}_SHOP`);
  if (!cfg.jeton) {
    if (!cfg.clientId) manque.push(`${pre}_CLIENT_ID`);
    if (!cfg.clientSecret) manque.push(`${pre}_CLIENT_SECRET`);
  }
  cfg.manque = manque;
  cfg.pret = manque.length === 0;
  // Erreur de collage classique : la même valeur saisie dans deux variables (la clé du connecteur collée dans le nom de la
  // boutique, par exemple). Seuls les NOMS des variables concernées sont renvoyés, jamais leurs valeurs.
  const comparables = [
    [`${pre}_SHOP`, domaine.replace(/\.myshopify\.com$/, "")], ["MCP_SITE_KEY", cfg.cle],
    [`${pre}_CLIENT_ID`, herite ? "" : cfg.clientId], [`${pre}_CLIENT_SECRET`, herite ? "" : cfg.clientSecret], [`${pre}_TOKEN`, cfg.jeton],
  ].map(([nom, valeur]) => [nom, valeur.toLowerCase()]);
  cfg.identiques = [];
  for (let i = 0; i < comparables.length; i++) {
    for (let j = i + 1; j < comparables.length; j++) {
      if (comparables[i][1] && comparables[i][1] === comparables[j][1]) cfg.identiques.push(`${comparables[i][0]} = ${comparables[j][0]}`);
    }
  }
  // Les deux boutiques ne peuvent pas être la même : c'est la faute de collage la plus probable pour la seconde.
  if (boutique !== "site" && domaine && domaine === domaineDe(process.env.SHOPIFY_SITE_SHOP)) cfg.identiques.push(`${pre}_SHOP = SHOPIFY_SITE_SHOP`);
  // null = variable absente ; sinon : la valeur a-t-elle la forme habituelle ? (indice seulement)
  cfg.formes = {
    id_client: cfg.clientId ? FORME_ID_CLIENT.test(cfg.clientId) : null,
    secret: cfg.clientSecret ? FORME_SECRET.test(cfg.clientSecret) : null,
    // le secret d'une application récente commence par « shpss_ » ; 32 caractères sans préfixe : ancien secret, ou ID client collé ici par erreur
    secret_prefixe_shpss: cfg.clientSecret ? PREFIXE_SECRET.test(cfg.clientSecret) : null,
  };
  return cfg;
}

// ---------------------------------------------------------------------------------------------- sécurité d'accès
const empreinte = (s) => crypto.createHash("sha256").update(String(s)).digest();
const cleCorrecte = (fournie, attendue) => Boolean(fournie) && Boolean(attendue) && crypto.timingSafeEqual(empreinte(fournie), empreinte(attendue));

// La clé peut venir de l'adresse (?key=…) ou d'un en-tête « Authorization: Bearer … » : on accepte l'une ou l'autre,
// pour qu'un en-tête parasite ajouté par un client n'invalide pas une adresse correcte.
function clesFournies(req) {
  const liste = [];
  const auth = String(req.headers?.authorization || "");
  if (/^bearer\s+/i.test(auth)) liste.push(auth.replace(/^bearer\s+/i, "").trim());
  const q = req.query?.key;
  if (typeof q === "string" && q) liste.push(q);
  else if (Array.isArray(q) && typeof q[0] === "string" && q[0]) liste.push(q[0]);
  else {
    try { const u = new URL(req.url || "/", "http://x").searchParams.get("key"); if (u) liste.push(u); } catch { /* adresse illisible : ignorée */ }
  }
  return liste;
}
const cleAcceptee = (req, attendue) => Boolean(attendue) && clesFournies(req).some((c) => cleCorrecte(c, attendue));

function adresseIp(req) {
  return String(req.headers?.["x-forwarded-for"] || req.socket?.remoteAddress || "?").split(",")[0].trim();
}

function tropDEchecs(ip) {
  const e = echecs.get(ip);
  if (!e) return false;
  if (Date.now() - e.debut > FENETRE_MS) { echecs.delete(ip); return false; }
  return e.n >= LIMITE_ECHECS;
}
function noterEchec(ip) {
  const e = echecs.get(ip);
  if (!e || Date.now() - e.debut > FENETRE_MS) echecs.set(ip, { n: 1, debut: Date.now() });
  else e.n++;
  if (echecs.size > 500) for (const [k, v] of echecs) if (Date.now() - v.debut > FENETRE_MS) echecs.delete(k);
}

// ---------------------------------------------------------------------------------------------- accès à Shopify
const pause = (essai) => new Promise((ok) => setTimeout(ok, (Number(process.env.MCP_SITE_RETRY_MS) || 1000) * (essai + 1)));

// Chaque appel à Shopify est borné par ce qui reste du temps imparti à l'outil (la fonction Vercel s'arrête à 30 s) :
// mieux vaut un message clair qu'une coupure de la plate-forme.
const budgetMs = () => Number(process.env.MCP_SITE_BUDGET_MS) || 26_000;
function delai(echeance, max) {
  const reste = echeance - Date.now();
  if (reste < 1000) throw new ErreurOutil("Shopify met trop de temps à répondre.");
  return Math.min(max, reste);
}

// Que vérifier quand Shopify refuse la demande de jeton ? (aucune valeur secrète dans ces messages : seulement des noms)
function conseilJeton(statut, code, cfg) {
  const pre = cfg.prefixe;
  const formes = [];
  if (cfg.formes?.id_client === false) formes.push(`${pre}_CLIENT_ID ne ressemble pas à un ID client (32 caractères : chiffres et lettres a à f)`);
  if (cfg.formes?.secret === false) formes.push(`${pre}_CLIENT_SECRET ne ressemble pas à un secret (« shpss_ » suivi de 32 caractères)`);
  else if (cfg.formes?.secret_prefixe_shpss === false) formes.push(`${pre}_CLIENT_SECRET ne commence pas par « shpss_ » (le secret d'une application récente commence ainsi : est-ce l'ID client qui a été collé ici ?)`);
  const indices = formes.length ? ` Indice : ${formes.join(" ; ")}.` : "";
  // Boutique des marketplaces qui réutilise l'application du site : le plus probable est qu'elle n'y soit pas encore installée
  const heritee = cfg.herite ? " L'application de la boutique du site est réutilisée ici : elle doit aussi être installée sur cette boutique, de la même organisation Shopify." : "";
  if (statut === 404) return `Boutique introuvable : ${cfg.domaine} n'existe pas. Vérifier ${pre}_SHOP (le nom qui précède .myshopify.com).${indices}`;
  if (code === "application_cannot_be_found") {
    return `Shopify ne trouve pas l'application pour la boutique ${cfg.domaine}. Trois causes possibles : ID client faux (${pre}_CLIENT_ID), ` +
      "application non installée sur cette boutique (Dev Dashboard > application > Accueil > Installer l'application), ou application et boutique " +
      `dans deux organisations différentes.${heritee}${indices}`;
  }
  if (code === "shop_not_permitted") {
    return "L'application et la boutique ne sont pas dans la même organisation Shopify : créer l'application depuis l'administration de la boutique " +
      `${cfg.libelle} (Paramètres > Applications > Développer des applications), puis renseigner ses identifiants dans ${pre}_CLIENT_ID et ${pre}_CLIENT_SECRET.${indices}`;
  }
  return `À vérifier : application installée sur la boutique ${cfg.libelle}, même organisation que la boutique, identifiant et secret recopiés sans espace.${heritee}${indices}`;
}

async function recupererJeton(cfg, renouveler, echeance) {
  if (cfg.jeton) return cfg.jeton;
  const k = `${cfg.domaine}|${cfg.clientId}`;
  const c = jetons.get(k);
  if (!renouveler && c && Date.now() < c.expire - 60_000) return c.valeur;
  const limite = delai(echeance, 10_000);
  let r, j = null;
  try {
    r = await fetch(`https://${cfg.domaine}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams({ grant_type: "client_credentials", client_id: cfg.clientId, client_secret: cfg.clientSecret }).toString(),
      signal: AbortSignal.timeout(limite),
    });
    try { j = await r.json(); } catch { /* corps non JSON */ }
  } catch (e) {
    throw new ErreurOutil("Shopify injoignable pendant l'obtention du jeton : " + String(e?.message || e).slice(0, 100));
  }
  if (!r.ok || !j?.access_token) {
    const detail = [j?.error, j?.error_description].filter((x) => typeof x === "string").join(" - ").slice(0, 160);
    throw new ErreurOutil(`Shopify refuse les identifiants de l'application (code ${r.status}${detail ? " : " + detail : ""}). ${conseilJeton(r.status, j?.error, cfg)}`);
  }
  jetons.set(k, { valeur: j.access_token, expire: Date.now() + (Number(j.expires_in) || 3600) * 1000 });
  return j.access_token;
}

async function graphql(cfg, requete, variables) {
  const echeance = Date.now() + budgetMs();
  let renouveler = false;
  for (let essai = 0; essai < 3; essai++) {
    const jeton = await recupererJeton(cfg, renouveler, echeance);
    renouveler = false;
    const limite = delai(echeance, 20_000);
    let r;
    try {
      r = await fetch(`https://${cfg.domaine}/admin/api/${versionApi()}/graphql.json`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json", "x-shopify-access-token": jeton },
        body: JSON.stringify({ query: requete, variables }),
        signal: AbortSignal.timeout(limite),
      });
    } catch (e) {
      if (essai < 2) { await pause(essai); continue; }
      throw new ErreurOutil("Shopify injoignable : " + String(e?.message || e).slice(0, 100));
    }
    if (r.status === 401) {
      if (!cfg.jeton && essai < 2) { renouveler = true; continue; } // jeton expiré ou révoqué : on en redemande un
      throw new ErreurOutil("Shopify refuse le jeton d'accès (401).");
    }
    if (r.status === 403) throw new ErreurOutil("Shopify refuse l'accès (403) : le droit read_reports est-il accordé à l'application, la nouvelle version publiée (Release), puis l'application réinstallée sur la boutique ?");
    if ((r.status === 429 || r.status >= 500) && essai < 2) { await pause(essai); continue; }
    if (!r.ok) throw new ErreurOutil(`Shopify a répondu ${r.status}.`);
    let j;
    try { j = await r.json(); } catch { throw new ErreurOutil("Réponse de Shopify illisible."); }
    if (Array.isArray(j.errors) && j.errors.length) {
      if (j.errors.some((e) => e?.extensions?.code === "THROTTLED") && essai < 2) { await pause(essai); continue; }
      throw new ErreurOutil("Erreur Shopify : " + j.errors.map((e) => e?.message).filter(Boolean).join(" ; ").slice(0, 300));
    }
    return j.data;
  }
  throw new ErreurOutil("Shopify n'a pas répondu après plusieurs essais.");
}

// ---------------------------------------------------------------------------------------------- outils
const texte = (v) => (v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v));
const sortieJson = (o) => ({ content: [{ type: "text", text: JSON.stringify(o) }] });

function lignesEnTexte(colonnes, rows) {
  let r = rows;
  if (typeof r === "string") { try { r = JSON.parse(r); } catch { r = []; } }
  if (!Array.isArray(r)) return [];
  const noms = colonnes.map((c) => c.name);
  return r.map((l) => (Array.isArray(l) ? l.map(texte) : noms.map((n) => texte(l?.[n]))));
}

function verifierRequete(q) {
  if (typeof q !== "string" || !q.trim()) throw new ErreurOutil("Paramètre « query » manquant.");
  if (q.length > MAX_REQUETE) throw new ErreurOutil(`Requête trop longue (${MAX_REQUETE} caractères au maximum).`);
  if (!/^\s*FROM\s+[a-z_]+/i.test(q)) throw new ErreurOutil("Requête ShopifyQL attendue, de la forme « FROM sales SHOW … ».");
  // Seuls les textes entre apostrophes sont écartés de l'examen. Pas de gestion de « \' » : en cas de doute sur la syntaxe,
  // on examine plus de texte, jamais moins.
  const sansTextes = q.replace(/'[^']*'/g, "''");
  // Chaque « FROM <jeu> » de la requête doit viser un jeu autorisé (pas seulement le premier).
  for (const [, jeu] of sansTextes.matchAll(/(?<![a-z0-9_])FROM\s+([a-z_]+)/gi)) {
    if (!JEUX_AUTORISES.has(jeu.toLowerCase())) throw new ErreurOutil(`Jeu de données « ${jeu} » non autorisé (autorisés : ${[...JEUX_AUTORISES].join(", ")}).`);
  }
  if (DONNEES_PERSONNELLES.test(sansTextes)) throw new ErreurOutil("Requête refusée : elle vise des données personnelles de clients (e-mail, téléphone, nom, adresse). Seuls des agrégats sont autorisés.");
}

const GQL_INFO = `{ shop { name myshopifyDomain primaryDomain { host } currencyCode ianaTimezone } currentAppInstallation { accessScopes { handle } } }`;
const GQL_QL = `query ShopifyQLSite($q: String!) { shop { myshopifyDomain } shopifyqlQuery(query: $q) { tableData { columns { name dataType displayName } rows } parseErrors } }`;

// Boutique demandée par l'appel : « site » par défaut ; toute autre valeur est refusée (aucune boutique arbitraire).
function boutiqueDemandee(args) {
  const b = args?.boutique ?? "site";
  if (typeof b !== "string" || !BOUTIQUES.includes(b)) {
    throw new ErreurOutil(`Paramètre « boutique » invalide (valeurs permises : ${BOUTIQUES.join(", ")}).`);
  }
  return b;
}

// cfgs : { site, marketplaces } (voir lireConfig)
async function appelerOutil(nom, args, cfgs) {
  if (nom !== "get-shop-info" && nom !== "run-analytics-query") return null; // outil inconnu : erreur de protocole
  const boutique = boutiqueDemandee(args);
  const cfg = cfgs[boutique];
  if (!cfg.pret) throw new ErreurOutil(`Boutique ${cfg.libelle} non configurée : variables manquantes côté Vercel (${cfg.manque.join(", ")}). Les saisir, puis redéployer.`);
  if (cfg.identiques.length) throw new ErreurOutil(`Variables Vercel mal remplies : la même valeur a été saisie deux fois (${cfg.identiques.join(" ; ")}). Corriger la variable concernée, puis redéployer.`);
  if (nom === "get-shop-info") {
    const d = await graphql(cfg, GQL_INFO, {});
    const s = d?.shop;
    if (!s) throw new ErreurOutil("Shopify n'a pas renvoyé les informations de la boutique.");
    return sortieJson({
      shopDomain: s.myshopifyDomain,
      name: s.name,
      primaryDomain: s.primaryDomain?.host ?? null,
      currencyCode: s.currencyCode,
      ianaTimezone: s.ianaTimezone,
      accessScopes: (d.currentAppInstallation?.accessScopes || []).map((x) => x.handle),
      apiVersion: versionApi(),
      readOnly: true,
      boutique,
      connector: SERVEUR.name,
    });
  }
  if (nom === "run-analytics-query") {
    const q = args?.query;
    verifierRequete(q);
    const d = await graphql(cfg, GQL_QL, { q });
    const t = d?.shopifyqlQuery;
    const erreurs = (t?.parseErrors || []).map((e) => (typeof e === "string" ? e : e?.message ?? JSON.stringify(e)));
    if (erreurs.length) throw new ErreurOutil("Requête ShopifyQL invalide : " + erreurs.join(" ; ").slice(0, 400));
    if (!t?.tableData || !Array.isArray(t.tableData.columns)) throw new ErreurOutil("Shopify n'a renvoyé aucun tableau (requête vide, ou droit read_reports manquant).");
    const colonnes = t.tableData.columns.map((c) => ({ name: c.name, dataType: c.dataType }));
    return sortieJson({ query: q, columns: colonnes, rows: lignesEnTexte(colonnes, t.tableData.rows), shopDomain: d.shop?.myshopifyDomain || cfg.domaine });
  }
  return null; // outil inconnu : erreur de protocole
}

// ---------------------------------------------------------------------------------------------- protocole MCP
const ok = (id, result) => ({ jsonrpc: "2.0", id, result });
const ko = (id, code, message) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

function versionNegociee(demandee) {
  return VERSIONS_MCP.includes(demandee) ? demandee : "2025-06-18";
}

async function traiter(msg, cfgs) {
  if (!msg || typeof msg !== "object" || Array.isArray(msg)) return ko(null, -32600, "Requête JSON-RPC invalide");
  const { id, method, params } = msg;
  const notification = id === undefined || id === null;
  if (typeof method !== "string") return notification ? null : ko(id, -32600, "Requête JSON-RPC invalide");
  const debut = Date.now();
  const journal = (extra = {}) => console.log(JSON.stringify({ evt: "mcp-site", methode: method, ms: Date.now() - debut, ...extra }));
  switch (method) {
    case "initialize":
      journal({ client: String(params?.clientInfo?.name || "").slice(0, 40), protocole: String(params?.protocolVersion || "").slice(0, 12) });
      return ok(id, {
        protocolVersion: versionNegociee(params?.protocolVersion),
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVEUR,
        instructions: INSTRUCTIONS,
      });
    case "ping": return ok(id, {});
    case "tools/list": return ok(id, { tools: OUTILS });
    case "resources/list": return ok(id, { resources: [] });
    case "prompts/list": return ok(id, { prompts: [] });
    case "tools/call": {
      const nom = params?.name;
      const b = params?.arguments?.boutique;
      const boutique = typeof b === "string" && BOUTIQUES.includes(b) ? b : b === undefined ? "site" : "?";
      try {
        const sortie = await appelerOutil(nom, params?.arguments || {}, cfgs);
        if (sortie === null) return ko(id, -32602, `Outil inconnu : ${String(nom).slice(0, 60)}`);
        journal({ outil: nom, boutique, ok: true, requete: nom === "run-analytics-query" ? String(params?.arguments?.query || "").slice(0, 120) : undefined });
        return ok(id, sortie);
      } catch (e) {
        const message = e instanceof ErreurOutil ? e.message : "Erreur interne du connecteur.";
        journal({ outil: nom, boutique, ok: false, erreur: message.slice(0, 200), requete: nom === "run-analytics-query" ? String(params?.arguments?.query || "").slice(0, 120) : undefined });
        return ok(id, { content: [{ type: "text", text: message }], isError: true });
      }
    }
    default:
      if (notification) return null; // notifications/initialized, notifications/cancelled, etc.
      return ko(id, -32601, `Méthode inconnue : ${method.slice(0, 60)}`);
  }
}

// ---------------------------------------------------------------------------------------------- corps de requête
function lireCorps(req) {
  return new Promise((resolve, reject) => {
    if (req.body !== undefined && req.body !== null && typeof req.body === "object" && !Buffer.isBuffer(req.body)) return resolve(req.body);
    const brut = typeof req.body === "string" ? req.body : Buffer.isBuffer(req.body) ? req.body.toString("utf8") : null;
    if (brut !== null) { try { return resolve(JSON.parse(brut)); } catch { return reject(new Error("json")); } }
    let acc = "";
    req.on("data", (c) => { acc += c; if (acc.length > 200_000) { reject(new Error("trop_gros")); req.destroy?.(); } });
    req.on("end", () => { try { resolve(JSON.parse(acc)); } catch { reject(new Error("json")); } });
    req.on("error", () => reject(new Error("lecture")));
  });
}

// ---------------------------------------------------------------------------------------------- point d'entrée
// Durée maximale d'une exécution sur Vercel : un jeton + une requête ShopifyQL avec reprises tiennent largement dans 30 s.
export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const cfgs = Object.fromEntries(BOUTIQUES.map((b) => [b, lireConfig(b)]));
  const cfg = cfgs.site; // la clé du relais est la même pour les deux boutiques
  const ip = adresseIp(req);

  if (req.method === "GET") {
    // Un client MCP qui demande un flux (SSE) reçoit 405 : ce serveur ne pousse rien de lui-même.
    if (/text\/event-stream/i.test(String(req.headers?.accept || ""))) {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ error: "methode_non_autorisee" });
    }
    // Sonde de configuration pour le navigateur : rien n'est révélé sans la clé.
    const cleLongue = cfg.cle.length >= LONGUEUR_CLE_MIN;
    const cleSure = CLE_SURE_POUR_UNE_ADRESSE.test(cfg.cle);
    if (cleAcceptee(req, cfg.cle)) {
      const mp = cfgs.marketplaces;
      return res.status(200).json({
        ok: true, service: "mcp-site", configured: cfg.pret && cleLongue && cleSure && cfg.identiques.length === 0, boutique: cfg.domaine || null,
        manque: cfg.manque, identiques: cfg.identiques, formes_plausibles: cfg.formes, cle_assez_longue: cleLongue, cle_url_sure: cleSure,
        version_api: versionApi(), lecture_seule: true,
        // seconde boutique (marketplaces) : mêmes indications, sans valeur secrète
        marketplaces: {
          configured: mp.pret && cleLongue && cleSure && mp.identiques.length === 0, boutique: mp.domaine || null,
          manque: mp.manque, identiques: mp.identiques, application_du_site_reutilisee: mp.herite, formes_plausibles: mp.formes,
        },
      });
    }
    // Sans la clé : seulement de quoi diagnostiquer une clé mal choisie (jamais sa valeur).
    return res.status(200).json({ ok: true, service: "mcp-site", cle_definie: Boolean(cfg.cle), cle_valide: cleLongue && cleSure });
  }
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "methode_non_autorisee" });
  }

  if (cfg.cle.length < LONGUEUR_CLE_MIN) return res.status(503).json({ error: "non_configure", detail: `MCP_SITE_KEY absente ou trop courte (${LONGUEUR_CLE_MIN} caractères minimum)` });
  if (tropDEchecs(ip)) return res.status(429).json({ error: "trop_de_requetes" });
  if (!cleAcceptee(req, cfg.cle)) { noterEchec(ip); return res.status(401).json({ error: "cle_invalide" }); }

  let corps;
  try { corps = await lireCorps(req); } catch { return res.status(400).json(ko(null, -32700, "JSON invalide")); }
  const messages = Array.isArray(corps) ? corps : [corps];
  if (!messages.length || messages.length > 20) return res.status(400).json(ko(null, -32600, "Lot de requêtes invalide"));

  const reponses = [];
  for (const m of messages) {
    const r = await traiter(m, cfgs);
    if (r) reponses.push(r);
  }
  if (!reponses.length) return res.status(202).end(); // uniquement des notifications
  return res.status(200).json(Array.isArray(corps) ? reponses : reponses[0]);
}
