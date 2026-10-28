// api/marketplaces.mjs — relais en LECTURE SEULE vers les API vendeur d'Octopia (Cdiscount) et de ManoMano.
//
// Pourquoi ce fichier : l'environnement qui actualise l'application chaque matin ne peut joindre qu'un petit nombre de
// sites ; ce relais, hébergé avec l'application, interroge pour lui les API de ces deux marketplaces. Même principe que
// api/mcp-site.mjs (boutique du site) : les clés restent dans les variables d'environnement Vercel, jamais dans le code,
// ni dans GitHub, ni dans une conversation.
//
// Lecture seule : seules des requêtes GET vers une liste de routes de consultation sont possibles (commandes, offres,
// finances…). Rien ne permet d'accepter, d'expédier, de rembourser ni de modifier une commande ou une offre.
// Aucune donnée de client : adresses, noms, e-mails, téléphones et commentaires sont retirés de TOUTE réponse avant
// qu'elle ne quitte le relais (seul le pays de livraison est conservé). Les clés ne sortent jamais non plus : toute
// réponse est nettoyée de leur valeur, même si une API les répète dans un message d'erreur.
//
// Appel : POST https://<votre-app>.vercel.app/api/marketplaces?key=<MCP_SITE_KEY>   (ou en-tête « Authorization: Bearer … »)
//   { "source": "octopia" | "manomano", "action": "ping" | "get" | "orders", … }
//   ping    : vérifie la connexion (jeton, identifiants, vendeur) et renvoie la forme de la réponse, sans donnée sensible
//   get     : lecture d'une route de consultation de l'API { chemin: "/orders", params: { … } } → réponse expurgée
//   orders  : (Octopia) commandes d'une période { du, au } AAAA-MM-JJ (jours de Paris, 35 jours au maximum), parcourues
//             page par page et ramenées à une ligne par article avec prix, taxes et commissions ;
//             { echantillon: true } ajoute une commande expurgée pour contrôler la forme réelle des données
// Sonde de configuration : GET /api/marketplaces?key=<MCP_SITE_KEY> → noms des variables manquantes (jamais les valeurs).
//
// Variables d'environnement Vercel :
//   MCP_SITE_KEY            la même clé que le relais du site (24 caractères minimum, lettres et chiffres)
//   OCTOPIA_CLIENT_ID       identifiant (clientId) créé sur le portail API d'Octopia
//   OCTOPIA_CLIENT_SECRET   secret (clientSecret) correspondant
//   OCTOPIA_SELLER_ID       numéro de vendeur (sellerId) Octopia
//   MANOMANO_API_KEY        clé d'API créée dans la Toolbox de ManoMano (Settings › API key)
//   MANOMANO_CONTRACT_ID    numéro de contrat vendeur, affiché sur la page d'accueil de la Toolbox
//   Facultatives (valeurs de production par défaut) : OCTOPIA_AUTH_URL, OCTOPIA_API_URL, MANOMANO_API_URL
//
// Changer une clé : modifier la variable dans Vercel, puis redéployer (Vercel n'applique pas une variable à un déploiement déjà en ligne).

import crypto from "crypto";

const LONGUEUR_CLE_MIN = 24;
const CLE_SURE_POUR_UNE_ADRESSE = /^[A-Za-z0-9._~-]+$/;
const LIMITE_ECHECS = 20; // mauvaises clés par IP et par fenêtre
const FENETRE_MS = 5 * 60 * 1000;
const echecs = new Map();
const jetons = new Map(); // "clientId" -> { valeur, expire }

class ErreurRelais extends Error {
  constructor(message, statut = 502, extra = {}) { super(message); this.statut = statut; this.extra = extra; }
}

/* ---------------------------------------------------------------------------------------------- sources */
// Adresses de production. Une adresse modifiée par variable doit rester chez la marketplace (aucune autre destination possible).
const DEFAUTS = {
  octopia: { auth: "https://auth.octopia-io.net/auth/realms/maas/protocol/openid-connect/token", api: "https://api.octopia-io.net/seller/v2", domaines: ["octopia-io.net"] },
  manomano: { api: "https://partnersapi.manomano.com", domaines: ["manomano.com"] },
};

const SOURCES = {
  octopia: {
    libelle: "Octopia (Cdiscount)",
    variables: ["OCTOPIA_CLIENT_ID", "OCTOPIA_CLIENT_SECRET", "OCTOPIA_SELLER_ID"],
    // routes de consultation autorisées (GET) ; tout le reste est refusé
    routes: ["/sellers", "/orders", "/operations", "/payments", "/invoices", "/offers", "/products", "/carriers"],
  },
  manomano: {
    libelle: "ManoMano",
    variables: ["MANOMANO_API_KEY", "MANOMANO_CONTRACT_ID"],
    routes: ["/orders", "/offers", "/stocks", "/stock", "/fulfillment", "/products", "/brands", "/categories", "/invoices", "/competitiveness"],
  },
};
const NOMS_SOURCES = Object.keys(SOURCES);

// Valeur d'une variable : sans espaces ni guillemets de collage (sauf pour la clé d'accès, lue comme dans api/mcp-site.mjs)
const brut = (nom) => String(process.env[nom] ?? "");
function lire(nom) {
  let v = brut(nom).trim();
  if (nom !== "MCP_SITE_KEY" && v.length >= 2 && /^(["']).*\1$/.test(v)) v = v.slice(1, -1).trim();
  return v;
}

function adresseSure(source, valeur, defaut) {
  const v = String(valeur || "").trim().replace(/\/+$/, "");
  if (!v) return defaut;
  let u; try { u = new URL(v); } catch { return defaut; }
  const ok = u.protocol === "https:" && DEFAUTS[source].domaines.some((d) => u.hostname === d || u.hostname.endsWith("." + d));
  return ok ? v : defaut;
}

// Configuration d'une source d'après les variables Vercel. Jamais de valeur dans ce qui est renvoyé : seulement des noms.
function lireConfig(source) {
  const s = SOURCES[source];
  const valeurs = Object.fromEntries(s.variables.map((n) => [n, lire(n)]));
  const manque = s.variables.filter((n) => !valeurs[n]);
  // erreurs de collage classiques : la même valeur dans deux variables, espaces ou guillemets autour de la valeur
  const identiques = [];
  for (let i = 0; i < s.variables.length; i++) for (let j = i + 1; j < s.variables.length; j++) {
    const a = valeurs[s.variables[i]].toLowerCase(), b = valeurs[s.variables[j]].toLowerCase();
    if (a && a === b) identiques.push(`${s.variables[i]} = ${s.variables[j]}`);
  }
  const aSurveiller = s.variables.filter((n) => { const v = brut(n); return v && (v !== v.trim() || /^\s*(["']).*\1\s*$/.test(v)); });
  const cfg = { source, libelle: s.libelle, valeurs, manque, identiques, aSurveiller, pret: manque.length === 0 && identiques.length === 0 };
  if (source === "octopia") {
    cfg.urlAuth = adresseSure("octopia", process.env.OCTOPIA_AUTH_URL, DEFAUTS.octopia.auth);
    cfg.urlApi = adresseSure("octopia", process.env.OCTOPIA_API_URL, DEFAUTS.octopia.api);
  } else {
    cfg.urlApi = adresseSure("manomano", process.env.MANOMANO_API_URL, DEFAUTS.manomano.api);
  }
  return cfg;
}

/* ---------------------------------------------------------------------------------------------- sécurité d'accès */
const empreinte = (s) => crypto.createHash("sha256").update(String(s)).digest();
const cleCorrecte = (fournie, attendue) => Boolean(fournie) && Boolean(attendue) && crypto.timingSafeEqual(empreinte(fournie), empreinte(attendue));

function clesFournies(req) {
  const liste = [];
  const auth = String(req.headers?.authorization || "");
  if (/^bearer\s+/i.test(auth)) liste.push(auth.replace(/^bearer\s+/i, "").trim());
  const q = req.query?.key;
  if (typeof q === "string" && q) liste.push(q);
  else if (Array.isArray(q) && typeof q[0] === "string" && q[0]) liste.push(q[0]);
  else { try { const u = new URL(req.url || "/", "http://x").searchParams.get("key"); if (u) liste.push(u); } catch { /* adresse illisible : ignorée */ } }
  return liste;
}
// une clé trop courte n'ouvre rien, pas même la sonde de configuration
const cleAcceptee = (req, attendue) => String(attendue || "").length >= LONGUEUR_CLE_MIN && clesFournies(req).some((c) => cleCorrecte(c, attendue));
const adresseIp = (req) => String(req.headers?.["x-forwarded-for"] || req.socket?.remoteAddress || "?").split(",")[0].trim();

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

/* ---------------------------------------------------------------------------------------------- secrets : jamais en sortie */
// Valeurs qui ne doivent apparaître dans aucune réponse ni aucun journal : clé d'accès, secret Octopia, clé ManoMano et
// jetons en cours. (L'identifiant client Octopia n'en fait pas partie : un identifiant court risquerait d'altérer des données.)
function secretsActifs() {
  const liste = [lire("MCP_SITE_KEY"), lire("OCTOPIA_CLIENT_SECRET"), lire("MANOMANO_API_KEY")];
  for (const j of jetons.values()) liste.push(j.valeur);
  return [...new Set(liste.filter((s) => typeof s === "string" && s.length >= 8))];
}
function purgerTexte(t) {
  let sortie = String(t);
  for (const s of secretsActifs()) {
    for (const f of new Set([s, encodeURIComponent(s), JSON.stringify(s).slice(1, -1)])) if (f) sortie = sortie.split(f).join("<secret>");
  }
  return sortie;
}
function purger(valeur) {
  if (!secretsActifs().length) return valeur;
  return JSON.parse(purgerTexte(JSON.stringify(valeur)));
}

/* ---------------------------------------------------------------------------------------------- expurgation des données de client */
// Toute réponse d'une marketplace passe par expurger() avant de sortir du relais : les clés qui désignent une personne, une
// adresse ou un secret sont retirées, les valeurs qui ressemblent à un e-mail ou à un téléphone sont masquées. Seul le pays
// de livraison reste, et uniquement sous la forme { pays: "FR" }.
const CLE_PERSONNELLE = /(e?mail|phone|mobile|telephone|^tel$|^gsm$|^fax$|firstname|lastname|fullname|surname|givenname|familyname|customer|buyer|client|recipient|consignee|receiver|sender|addressee|payer|holder|person|contact|companyname|vatnumber|vatid|siret|siren|iban|bic$|birth|address|adresse|street|^city$|^town$|zip|postal|postcode|locality|^building|^floor$|digicode|comment|^notes?$|instruction|relay|pickup|^message|password|secret|token|apikey|login|username)/;
const CLE_PAYS = /^(?:countrycode|country|countryiso|countryalpha2|isocode|iso2|alpha2)$/;
const normaliserCle = (k) => String(k).toLowerCase().replace(/[^a-z0-9]/g, "");
const TEXTE_EMAIL = /[^\s@"']{1,64}@[^\s@"']{1,255}\.[a-z]{2,}/gi;
const TEXTE_TELEPHONE = /(?:\+|\b00)\d{1,3}[\s.-]?\d(?:[\s.-]?\d){7,12}\b|\b0\d(?:[\s.-]\d{2}){4}\b/g;
const MASQUE = "<masqué>";

/** Pays trouvé (code ou nom, rien d'autre) dans un bloc d'adresse ou de client ; livraison avant facturation. */
function paysDe(x, profondeur = 0) {
  if (!x || typeof x !== "object" || profondeur > 5) return null;
  if (Array.isArray(x)) { for (const e of x) { const p = paysDe(e, profondeur + 1); if (p) return p; } return null; }
  for (const [k, v] of Object.entries(x)) {
    if (CLE_PAYS.test(normaliserCle(k)) && typeof v === "string" && /^[A-Za-zÀ-ÿ' -]{2,40}$/.test(v.trim())) { const p = v.trim(); return p.length <= 3 ? p.toUpperCase() : p; }
  }
  const cles = Object.keys(x).sort((a, b) => Number(/ship|deliver|livr/i.test(b)) - Number(/ship|deliver|livr/i.test(a)));
  for (const k of cles) { const p = paysDe(x[k], profondeur + 1); if (p) return p; }
  return null;
}

// Dans une réponse d'ERREUR de l'API, « message », « detail »… décrivent l'erreur (nom d'un paramètre refusé) et non un message
// de client : ils sont conservés, mais leur texte reste débarrassé des e-mails, téléphones et clés.
const CLE_D_ERREUR = /^(?:message|messages|error|errors|detail|details|title|description|errordescription)$/;

function expurger(v, cle = "", profondeur = 0, erreur = false) {
  if (profondeur > 14) return null;
  if (Array.isArray(v)) return v.map((x) => expurger(x, cle, profondeur + 1, erreur));
  if (v && typeof v === "object") {
    const sortie = {};
    for (const [k, x] of Object.entries(v)) {
      const nk = normaliserCle(k);
      if (CLE_PERSONNELLE.test(nk) && !(erreur && CLE_D_ERREUR.test(nk))) {
        const p = x && typeof x === "object" ? paysDe(x) : null; // un bloc d'adresse ou de client : on ne garde que le pays
        sortie[k] = p ? { pays: p } : MASQUE;
        continue;
      }
      sortie[k] = expurger(x, k, profondeur + 1, erreur);
    }
    return sortie;
  }
  if (typeof v === "string") {
    // références produit : jamais examinées (un EAN de 13 chiffres ne doit pas passer pour un numéro de téléphone)
    if (/(sku|ean|gtin|reference|sellerproductid|productid|id$)/.test(normaliserCle(cle))) return v.slice(0, 200);
    return v.replace(TEXTE_EMAIL, "<e-mail masqué>").replace(TEXTE_TELEPHONE, "<téléphone masqué>").slice(0, 600);
  }
  return v;
}

/** Forme d'une réponse pour le diagnostic : clés et types, valeurs seulement pour les nombres, dates, codes courts en majuscules. */
function forme(v, profondeur = 0) {
  if (profondeur > 8) return "…";
  if (Array.isArray(v)) return v.length ? [`${v.length} élément(s)`, forme(v[0], profondeur + 1)] : [];
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).slice(0, 60).map(([k, x]) => [k, forme(x, profondeur + 1)]));
  if (typeof v === "string") return /^[A-Z][A-Z0-9_]{1,24}$/.test(v) || /^\d{4}-\d{2}-\d{2}(T[\d:.+Z-]+)?$/.test(v) ? v : `texte(${v.length})`;
  return v;
}

/* ---------------------------------------------------------------------------------------------- appels sortants */
const pause = (essai) => new Promise((ok) => setTimeout(ok, (Number(process.env.MP_RETRY_MS) || 800) * (essai + 1)));
const budgetMs = () => Number(process.env.MP_BUDGET_MS) || 26_000;
function delai(echeance, max) {
  const reste = echeance - Date.now();
  if (reste < 1000) throw new ErreurRelais("La marketplace met trop de temps à répondre.", 504);
  return Math.min(max, reste);
}
const OCTETS_MAX = 3_500_000;

async function lireReponse(r) {
  if (Number(r.headers?.get?.("content-length")) > OCTETS_MAX) throw new ErreurRelais("Réponse trop volumineuse : réduire la période ou la taille de page.", 413);
  const type = String(r.headers?.get?.("content-type") || "");
  const texte = await r.text();
  if (texte.length > OCTETS_MAX) throw new ErreurRelais("Réponse trop volumineuse : réduire la période ou la taille de page.", 413);
  if (!texte) return { json: null, texte: "" };
  if (!/json/i.test(type) && !/^\s*[{[]/.test(texte)) return { json: null, texte: texte.slice(0, 200) };
  try { return { json: JSON.parse(texte), texte: "" }; } catch { return { json: null, texte: texte.slice(0, 200) }; }
}

const ENTETES_UTILES = ["link", "x-total-count", "x-total", "x-page-count", "retry-after"];
const entetesUtiles = (r) => Object.fromEntries(ENTETES_UTILES.map((h) => [h, r.headers?.get?.(h)]).filter(([, v]) => v));

/* ---- Octopia : jeton OAuth2 (client_credentials) puis API vendeur */
async function jetonOctopia(cfg, renouveler, echeance) {
  const id = cfg.valeurs.OCTOPIA_CLIENT_ID;
  const c = jetons.get(id);
  if (!renouveler && c && Date.now() < c.expire - 60_000) return c.valeur;
  let r, j = null;
  try {
    r = await fetch(cfg.urlAuth, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams({ grant_type: "client_credentials", client_id: id, client_secret: cfg.valeurs.OCTOPIA_CLIENT_SECRET }).toString(),
      signal: AbortSignal.timeout(delai(echeance, 10_000)),
    });
    try { j = await r.json(); } catch { /* corps non JSON */ }
  } catch (e) {
    if (e instanceof ErreurRelais) throw e;
    throw new ErreurRelais("Octopia injoignable pendant l'obtention du jeton : " + String(e?.message || e).slice(0, 100));
  }
  if (!r.ok || !j?.access_token) {
    const detail = [j?.error, j?.error_description].filter((x) => typeof x === "string").join(" - ").slice(0, 160);
    const conseil = r.status === 401 || j?.error === "invalid_client"
      ? " Vérifier OCTOPIA_CLIENT_ID et OCTOPIA_CLIENT_SECRET (recopiés sans espace ; le secret n'est pas le sellerId) et que la création des identifiants a bien été terminée sur le portail API d'Octopia (connexion avec le compte vendeur)."
      : j?.error === "unsupported_grant_type" ? " Octopia refuse ce type d'authentification : l'adresse du jeton (OCTOPIA_AUTH_URL) est à revoir." : "";
    throw new ErreurRelais(`Octopia refuse les identifiants (code ${r.status}${detail ? " : " + detail : ""}).${conseil}`, 502, { etape: "jeton" });
  }
  jetons.set(id, { valeur: j.access_token, expire: Date.now() + (Number(j.expires_in) || 300) * 1000 });
  return j.access_token;
}

/* ---- appel GET commun aux deux sources ; renvoie { statut, json, texte, entetes } */
async function appelerAmont(cfg, chemin, params, echeance) {
  const url = new URL(cfg.urlApi + chemin);
  for (const [k, v] of Object.entries(params || {})) {
    if (Array.isArray(v)) for (const x of v) url.searchParams.append(k, String(x));
    else if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  }
  if (cfg.source === "manomano" && !url.searchParams.has("seller_contract_id")) url.searchParams.set("seller_contract_id", cfg.valeurs.MANOMANO_CONTRACT_ID);
  let renouveler = false;
  for (let essai = 0; essai < 3; essai++) {
    const entetes = { accept: "application/json" };
    if (cfg.source === "octopia") {
      entetes.authorization = `Bearer ${await jetonOctopia(cfg, renouveler, echeance)}`;
      entetes.sellerid = cfg.valeurs.OCTOPIA_SELLER_ID;
    } else {
      entetes["x-api-key"] = cfg.valeurs.MANOMANO_API_KEY;
    }
    renouveler = false;
    let r;
    try {
      r = await fetch(url.toString(), { method: "GET", headers: entetes, signal: AbortSignal.timeout(delai(echeance, 15_000)) });
    } catch (e) {
      if (e instanceof ErreurRelais) throw e;
      if (essai < 2) { await pause(essai); continue; }
      throw new ErreurRelais(`${cfg.libelle} injoignable : ` + String(e?.message || e).slice(0, 100));
    }
    if (r.status === 401 && cfg.source === "octopia" && essai < 2) { renouveler = true; continue; } // jeton expiré ou révoqué
    if ((r.status === 429 || r.status >= 500) && essai < 2) { await pause(essai); continue; }
    const corps = await lireReponse(r);
    return { statut: r.status, ...corps, entetes: entetesUtiles(r) };
  }
  throw new ErreurRelais(`${cfg.libelle} n'a pas répondu après plusieurs essais.`, 504);
}

// Message clair pour un statut d'erreur de l'API (jamais le corps brut : il pourrait contenir des données de client)
function erreurAmont(cfg, a, chemin) {
  const s = a.statut;
  const base = `${cfg.libelle} a répondu ${s} pour ${chemin}`;
  const octopia = cfg.source === "octopia";
  const conseils = {
    400: ` : paramètre refusé (vérifier les noms de paramètres et les dates, ainsi que ${octopia ? "OCTOPIA_SELLER_ID" : "MANOMANO_CONTRACT_ID"}).`,
    401: octopia
      ? " : jeton refusé (vérifier OCTOPIA_CLIENT_ID et OCTOPIA_CLIENT_SECRET dans Vercel, puis redéployer)."
      : " : clé refusée (vérifier MANOMANO_API_KEY dans Vercel, puis redéployer ; la clé n'est affichée qu'une fois à sa création dans la Toolbox).",
    403: octopia
      ? " : ces identifiants n'ont pas le droit de lire cette route pour ce vendeur (vérifier OCTOPIA_SELLER_ID et que les identifiants ont été créés avec le compte vendeur)."
      : " : cette clé n'a pas le droit de lire cette route ou ce contrat (vérifier MANOMANO_CONTRACT_ID et que la clé a été créée avec un compte administrateur).",
    404: " : route ou ressource introuvable (le chemin est peut-être différent dans l'API).",
    429: " : trop de requêtes, réessayer plus tard.",
  };
  return base + (conseils[s] ?? (s >= 500 ? " : erreur côté marketplace, réessayer plus tard." : "."));
}
// Contenu d'une réponse d'erreur, expurgé et court : utile pour comprendre un refus de l'API (nom d'un paramètre, etc.)
const detailErreur = (a) => String(a.json !== null && a.json !== undefined ? JSON.stringify(expurger(a.json, "", 0, true)) : expurger(a.texte || "")).slice(0, 300);

/* ---------------------------------------------------------------------------------------------- validation des demandes */
const DATE = /^\d{4}-\d{2}-\d{2}$/;
function verifierChemin(source, chemin) {
  if (typeof chemin !== "string" || chemin.length > 120 || !/^\/[A-Za-z0-9/_.{}-]*$/.test(chemin) || chemin.includes("..") || chemin.includes("//")) {
    throw new ErreurRelais("Paramètre « chemin » invalide.", 400);
  }
  // le premier segment du chemin doit être une route de consultation (« /orders/v1/orders » de ManoMano en fait partie)
  const routes = SOURCES[source].routes;
  const ok = routes.some((r) => chemin === r || chemin.startsWith(r + "/"));
  if (!ok) throw new ErreurRelais(`Route non autorisée pour ${SOURCES[source].libelle} (consultation seulement : ${routes.join(", ")}).`, 400);
  if (/\/documents?(\/|$)|\/(approval-status|shipments|cancellations?|refunds?|accept|refuse|labels?)(\/|$)/i.test(chemin)) throw new ErreurRelais("Route non autorisée (documents et actions sur les commandes exclus).", 400);
}
function verifierParams(params) {
  if (params === undefined) return {};
  if (!params || typeof params !== "object" || Array.isArray(params) || Object.keys(params).length > 20) throw new ErreurRelais("Paramètre « params » invalide.", 400);
  const sortie = {};
  for (const [k, v] of Object.entries(params)) {
    if (!/^[A-Za-z0-9_.[\]-]{1,50}$/.test(k)) throw new ErreurRelais(`Nom de paramètre invalide : ${k.slice(0, 30)}`, 400);
    const valeurs = Array.isArray(v) ? v : [v];
    if (valeurs.length > 20 || valeurs.some((x) => !["string", "number", "boolean"].includes(typeof x) || String(x).length > 200)) throw new ErreurRelais(`Valeur de paramètre invalide : ${k}`, 400);
    sortie[k] = v;
  }
  return sortie;
}
function verifierPeriode(du, au, maxJours = 35) {
  if (!DATE.test(String(du)) || !DATE.test(String(au)) || Number.isNaN(Date.parse(du)) || Number.isNaN(Date.parse(au))) throw new ErreurRelais("Période invalide : « du » et « au » au format AAAA-MM-JJ.", 400);
  const jours = (Date.parse(au) - Date.parse(du)) / 864e5 + 1;
  if (jours < 1) throw new ErreurRelais("Période invalide : « au » précède « du ».", 400);
  if (jours > maxJours) throw new ErreurRelais(`Période trop longue (${maxJours} jours au maximum par appel).`, 400);
}
const ajouterJours = (d, n) => new Date(Date.parse(d + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);
const FORMAT_PARIS = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" });
function jourParis(iso) {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : FORMAT_PARIS.format(new Date(t));
}

/* ---------------------------------------------------------------------------------------------- Octopia : commandes */
const texte = (v) => (typeof v === "string" ? v.trim() || null : typeof v === "number" && Number.isFinite(v) ? String(v) : null);
function nombre(v) {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") { const n = Number(v.replace(",", ".")); return Number.isFinite(n) ? n : null; }
  if (typeof v === "object" && !Array.isArray(v)) for (const k of ["amount", "value", "amountWithVat", "total"]) if (k in v) return nombre(v[k]);
  return null;
}
const somme = (liste) => (Array.isArray(liste) ? Math.round(liste.reduce((s, x) => s + (nombre(x?.amount) ?? 0), 0) * 10000) / 10000 : null);
const objet = (o) => (o && typeof o === "object" && !Array.isArray(o) ? o : {});
const liste = (j) => {
  if (Array.isArray(j)) return j;
  if (j && typeof j === "object") for (const k of ["items", "orders", "data", "results", "content"]) if (Array.isArray(j[k])) return j[k];
  return [];
};

// Une ligne par article. L'adresse est lue ICI (pays seulement) avant toute expurgation ; aucune donnée de client n'en sort.
function lignesDeCommande(cmd, avecBrut = false) {
  const lignes = Array.isArray(cmd?.lines) ? cmd.lines : Array.isArray(cmd?.orderLines) ? cmd.orderLines : Array.isArray(cmd?.items) ? cmd.items : [];
  const paysCommande = paysDe(cmd?.shippingAddress);
  const frais = somme(cmd?.serviceFees);
  const canal = objet(cmd?.salesChannel);
  const achat = texte(cmd?.purchasedAt) ?? texte(cmd?.createdAt);
  return lignes.map((l, i) => {
    const offre = objet(l?.offerPrice), vente = objet(l?.sellingPrice), total = objet(l?.totalPrice), com = objet(offre.commission), of = objet(l?.offer);
    return {
      jour: achat ? jourParis(achat) : null,
      commande: texte(cmd?.reference) ?? texte(cmd?.orderId),
      commande_id: texte(cmd?.orderId),
      canal: texte(canal.id), canal_nom: texte(canal.name),
      statut: texte(cmd?.status), achete_le: texte(cmd?.purchasedAt), cree_le: texte(cmd?.createdAt),
      ligne: texte(l?.orderLineId) ?? String(i + 1), statut_ligne: texte(l?.status),
      sku: texte(of.sellerProductId), gtin: texte(of.productGtin), titre: (texte(of.productTitle) ?? "").slice(0, 120) || null,
      qte: nombre(l?.quantity),
      pays: paysDe(l?.shippingAddress) ?? paysCommande,
      offre_unitaire: nombre(offre.unitSalesPrice), offre_port: nombre(offre.shippingCost), offre_taxes: somme(offre.taxes),
      vente_unitaire: nombre(vente.unitSalesPrice), vente_port: nombre(vente.shippingCost), vente_taxes: somme(vente.taxes),
      commission_ht: nombre(com.amountWithoutVat), commission_ttc: nombre(com.amountWithVat), taux_commission: nombre(com.rate),
      total_offre: nombre(total.offerPrice), total_vente: nombre(total.sellingPrice),
      frais_service_commande: i === 0 ? frais : null, // une seule fois par commande
      // formes réelles des blocs de prix : seulement pour les premières lignes d'un échantillon, afin de lever tout doute sur HT / TTC
      ...(avecBrut ? { prix_brut: expurger({ offerPrice: offre, sellingPrice: vente, totalPrice: total }) } : {}),
    };
  });
}

// Page suivante annoncée par l'en-tête Link : seuls ses paramètres sont repris (jamais l'adresse elle-même)
function prochainLien(link) {
  if (!link) return null;
  for (const morceau of String(link).split(/,\s*(?=<)/)) {
    const m = morceau.match(/<([^>]+)>\s*;\s*rel="?next"?/i);
    if (!m) continue;
    try {
      const u = new URL(m[1], "https://x.invalid");
      const p = {};
      for (const [k, v] of u.searchParams) if (/^[A-Za-z0-9_.[\]-]{1,50}$/.test(k) && v.length <= 200) p[k] = v;
      return Object.keys(p).length ? p : null;
    } catch { return null; }
  }
  return null;
}

async function commandesOctopia(cfg, args, echeance) {
  verifierPeriode(args.du, args.au);
  const taille = 100;
  const base = {
    // fenêtre élargie d'un jour de chaque côté : les jours sont ceux de Paris, filtrés ensuite sur la date d'achat
    createdAtMin: `${ajouterJours(args.du, -1)}T00:00:00Z`, createdAtMax: `${ajouterJours(args.au, 1)}T23:59:59Z`,
    pageSize: taille,
    ...(typeof args.salesChannelId === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(args.salesChannelId) ? { salesChannelId: args.salesChannelId } : {}),
  };
  const lignes = [], vus = new Set();
  let params = { ...base }, indexSuivant = 1, relances = 0, commandes = 0, pages = 0, tronque = false, echantillon = null, pagination = null, brutRestant = args.echantillon ? 3 : 0;
  for (let page = 1; page <= 40; page++) {
    if (echeance - Date.now() < 4000) { tronque = true; break; }
    const a = await appelerAmont(cfg, "/orders", params, echeance);
    if (a.statut !== 200) throw new ErreurRelais(erreurAmont(cfg, a, "/orders") + (args.echantillon ? ` Détail : ${detailErreur(a)}` : ""), a.statut >= 500 ? 502 : a.statut === 401 || a.statut === 403 ? 502 : 400, { statut_amont: a.statut });
    pages++;
    const cmds = liste(a.json);
    if (page === 1) pagination = { lien_suivant: Boolean(prochainLien(a.entetes.link)), entetes: a.entetes };
    if (args.echantillon && !echantillon && cmds.length) echantillon = expurger(cmds[0]);
    let nouvelles = 0;
    for (const c of cmds) {
      const id = texte(c?.orderId) ?? texte(c?.reference);
      if (id && vus.has(id)) continue; // une page déjà lue (index de départ différent) ne compte pas deux fois
      if (id) vus.add(id);
      nouvelles++; commandes++;
      for (const l of lignesDeCommande(c, brutRestant > 0)) {
        if (brutRestant > 0) brutRestant--;
        if (l.jour && l.jour >= args.du && l.jour <= args.au) lignes.push(l);
      }
    }
    if (cmds.length < taille) break; // dernière page
    const lien = prochainLien(a.entetes.link);
    if (nouvelles === 0 && !lien) { // l'index de départ de l'API n'est pas celui supposé : un seul essai de plus
      if (relances++ >= 1) break;
    }
    params = lien ? { ...base, ...lien } : { ...base, pageIndex: indexSuivant++ };
    if (page === 40) tronque = true;
  }
  return { du: args.du, au: args.au, commandes_lues: commandes, pages, tronque, pagination, nb_lignes: lignes.length, lignes, ...(echantillon ? { echantillon } : {}) };
}

/* ---------------------------------------------------------------------------------------------- actions */
// Chemins essayés tour à tour pour « ping » ManoMano : la forme exacte de la route est vérifiée au premier contact.
const CHEMINS_MANOMANO = ["/orders/v1/orders", "/orders/v2/orders", "/orders"];

async function agir(source, action, args, cfg, echeance) {
  if (action === "ping") {
    if (source === "octopia") {
      await jetonOctopia(cfg, true, echeance);
      const a = await appelerAmont(cfg, "/sellers", {}, echeance);
      if (a.statut !== 200) throw new ErreurRelais(erreurAmont(cfg, a, "/sellers") + ` Détail : ${detailErreur(a)}`, 502, { statut_amont: a.statut, etape: "vendeur" });
      return { jeton: "obtenu", statut_amont: a.statut, forme: forme(expurger(a.json)), vendeur: expurger(a.json) };
    }
    const essais = [];
    for (const chemin of CHEMINS_MANOMANO) {
      const a = await appelerAmont(cfg, chemin, {}, echeance);
      essais.push({ chemin, statut: a.statut, ...(a.statut >= 300 ? { detail: detailErreur(a) } : {}) });
      if (a.statut === 200) return { chemin, statut_amont: 200, forme: forme(expurger(a.json)), entetes: a.entetes, essais };
      if (a.statut === 401 || a.statut === 403) throw new ErreurRelais(erreurAmont(cfg, a, chemin), 502, { statut_amont: a.statut, essais });
    }
    throw new ErreurRelais(`ManoMano : aucune route de commandes n'a répondu 200 (${essais.map((e) => `${e.chemin} → ${e.statut}`).join(" ; ")}).`, 502, { essais });
  }
  if (action === "get") {
    verifierChemin(source, args.chemin);
    const params = verifierParams(args.params);
    const a = await appelerAmont(cfg, args.chemin, params, echeance);
    if (a.statut < 200 || a.statut >= 300) throw new ErreurRelais(erreurAmont(cfg, a, args.chemin) + ` Détail : ${detailErreur(a)}`, a.statut >= 500 ? 502 : 400, { statut_amont: a.statut });
    return { statut_amont: a.statut, entetes: a.entetes, donnees: expurger(a.json) };
  }
  if (action === "orders") {
    if (source !== "octopia") throw new ErreurRelais("L'action « orders » n'existe que pour Octopia ; pour ManoMano, utiliser « get » avec le chemin de commandes indiqué par « ping ».", 400);
    return commandesOctopia(cfg, args, echeance);
  }
  throw new ErreurRelais("Action inconnue (ping, get, orders).", 400);
}

/* ---------------------------------------------------------------------------------------------- corps de requête */
function lireCorps(req) {
  return new Promise((resolve, reject) => {
    if (req.body !== undefined && req.body !== null && typeof req.body === "object" && !Buffer.isBuffer(req.body)) return resolve(req.body);
    const enTexte = typeof req.body === "string" ? req.body : Buffer.isBuffer(req.body) ? req.body.toString("utf8") : null;
    if (enTexte !== null) { try { return resolve(JSON.parse(enTexte)); } catch { return reject(new Error("json")); } }
    let acc = "";
    req.on("data", (c) => { acc += c; if (acc.length > 50_000) { reject(new Error("trop_gros")); req.destroy?.(); } });
    req.on("end", () => { try { resolve(JSON.parse(acc)); } catch { reject(new Error("json")); } });
    req.on("error", () => reject(new Error("lecture")));
  });
}

/* ---------------------------------------------------------------------------------------------- point d'entrée */
export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const cle = lire("MCP_SITE_KEY");
  const ip = adresseIp(req);

  if (req.method === "GET") {
    // Sonde de configuration pour le navigateur : rien n'est révélé sans la clé.
    if (cleAcceptee(req, cle)) {
      const etat = Object.fromEntries(NOMS_SOURCES.map((s) => {
        const c = lireConfig(s);
        return [s, { configure: c.pret, manque: c.manque, identiques: c.identiques, espaces_ou_guillemets: c.aSurveiller }];
      }));
      return res.status(200).json({ ok: true, service: "marketplaces", lecture_seule: true, ...etat });
    }
    return res.status(200).json({ ok: true, service: "marketplaces", cle_definie: Boolean(cle), cle_valide: cle.length >= LONGUEUR_CLE_MIN && CLE_SURE_POUR_UNE_ADRESSE.test(cle) });
  }
  if (req.method !== "POST") { res.setHeader("Allow", "GET, POST"); return res.status(405).json({ error: "methode_non_autorisee" }); }

  if (cle.length < LONGUEUR_CLE_MIN) return res.status(503).json({ ok: false, error: "non_configure", detail: `MCP_SITE_KEY absente ou trop courte (${LONGUEUR_CLE_MIN} caractères minimum)` });
  if (tropDEchecs(ip)) return res.status(429).json({ ok: false, error: "trop_de_requetes" });
  if (!cleAcceptee(req, cle)) { noterEchec(ip); return res.status(401).json({ ok: false, error: "cle_invalide" }); }

  let corps;
  try { corps = await lireCorps(req); } catch { return res.status(400).json({ ok: false, error: "json_invalide" }); }
  if (!corps || typeof corps !== "object" || Array.isArray(corps)) return res.status(400).json({ ok: false, error: "requete_invalide" });
  const { source, action } = corps;
  if (!NOMS_SOURCES.includes(source)) return res.status(400).json({ ok: false, error: "source_inconnue", detail: `source : ${NOMS_SOURCES.join(" ou ")}` });

  const debut = Date.now();
  const journal = (extra = {}) => console.log(purgerTexte(JSON.stringify({ evt: "marketplaces", source, action: String(action).slice(0, 12), ms: Date.now() - debut, ...extra })));
  try {
    const cfg = lireConfig(source);
    if (cfg.manque.length) throw new ErreurRelais(`${cfg.libelle} non configuré : variables manquantes côté Vercel (${cfg.manque.join(", ")}). Les saisir, puis redéployer.`, 503);
    if (cfg.identiques.length) throw new ErreurRelais(`Variables Vercel mal remplies : la même valeur a été saisie deux fois (${cfg.identiques.join(" ; ")}). Corriger la variable concernée, puis redéployer.`, 503);
    const donnees = await agir(source, action, corps, cfg, Date.now() + budgetMs());
    journal({ ok: true });
    return res.status(200).json(purger({ ok: true, source, action, ...donnees }));
  } catch (e) {
    if (e instanceof ErreurRelais) {
      journal({ ok: false, erreur: e.message.slice(0, 200) });
      return res.status(e.statut).json(purger({ ok: false, source, action, erreur: e.message, ...e.extra }));
    }
    journal({ ok: false, erreur: "interne" });
    return res.status(500).json({ ok: false, source, action, erreur: "Erreur interne du relais." });
  }
}
