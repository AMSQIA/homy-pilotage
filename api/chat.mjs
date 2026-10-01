// api/chat.mjs — relais sécurisé entre l'app HOM'Y Pilotage et l'API Anthropic.
//
// La clé API reste ICI (variable d'environnement Vercel ANTHROPIC_API_KEY) et ne
// transite jamais par le navigateur. Le navigateur n'envoie que la conversation ;
// le modèle, le prompt système, les outils et la longueur maximale sont fixés côté
// serveur : ce relais n'est donc pas un accès libre à l'API.
//
// Vérification rapide après déploiement : ouvrir /api/chat dans le navigateur →
// {"ok":true,"configured":true}. Si "configured" vaut false, la variable
// ANTHROPIC_API_KEY n'est pas définie (ou le projet n'a pas été redéployé depuis).

const API_URL = process.env.ANTHROPIC_API_URL || "https://api.anthropic.com/v1/messages";
const MODELE = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";
const MAX_TOKENS = 900;
const MAX_MESSAGES = 30;
const MAX_CARACTERES_BLOC = 24000;
const MAX_CARACTERES_REFLEXION = 60000;
const LIMITE_REQUETES = 90; // par IP et par fenêtre (une question = 2 à 5 appels)
const FENETRE_MS = 5 * 60 * 1000;
const passages = new Map();

const outil = (name, description, properties = {}, required = []) => ({ name, description, input_schema: { type: "object", properties, required } });
const MP = "Nom de la marketplace, tolérant aux variantes : Amazon FR, Leroy Merlin, ManoMano, Cdiscount, Castorama, Site Web, Darty, Boulanger, Bricomarché, Bricoman, Maxeda, Bol.com, Brico Bravo, Worten, But, Autre.";
const PRODUIT = "Nom exact ou partiel du produit, ex. \"ARIA 1000W\", \"NOVA\", \"FREYA 1500W\" (en cas de doute, utilise d'abord search_products).";
const ANNEE = "Année : 2025 ou 2026 (défaut 2026). Le détail par produit × marketplace n'existe que pour 2025 et 2026.";
const MOIS_DE = { type: "integer", minimum: 1, maximum: 12, description: "Premier mois inclus (1 = janvier). Défaut 1." };
const MOIS_A = { type: "integer", minimum: 1, maximum: 12, description: "Dernier mois inclus (12 = décembre). Défaut 12." };

const OUTILS = [
  outil("query_sales", "Ventes (CA HT en € et quantités) agrégées depuis les commandes, filtrables par année, mois, marketplace, produit ou famille, avec regroupement optionnel. C'est l'outil principal pour les classements (top produits, top marketplaces), les tendances mensuelles et toute question du type « combien a-t-on vendu… ».", {
    year: { type: "integer", description: ANNEE },
    month_from: MOIS_DE, month_to: MOIS_A,
    marketplace: { type: "string", description: MP },
    product: { type: "string", description: PRODUIT },
    family: { type: "string", description: "Famille : Fixe heater (radiateurs fixes), Sèche-serviettes, Mobile, Ventil, Déshum (déshumidificateurs), Soufflant, Autre." },
    group_by: { type: "string", enum: ["none", "marketplace", "product", "month", "family"], description: "Regroupement des résultats (défaut none = un seul total)." },
    sort_by: { type: "string", enum: ["ca", "qte"], description: "Tri des groupes (défaut ca)." },
    top_n: { type: "integer", minimum: 1, maximum: 30, description: "Nombre de groupes retournés (défaut 10)." },
  }),
  outil("get_kpis", "Vue d'ensemble : CA 2026, quantités, panier moyen, objectif annuel et % atteint, classement des marketplaces avec évolution vs 2025 et objectifs, CA mensuel global par année, meilleurs produits."),
  outil("get_brands", "CA par marque (Bestherm, Thomson, HOM'Y) : 2025 vs 2026, évolution et CA mensuel ; optionnellement le CA mensuel 2026 d'une marque sur une marketplace.", {
    brand: { type: "string", description: "Bestherm, Thomson ou HOM'Y (vide = toutes les marques)." },
    marketplace: { type: "string", description: MP },
  }),
  outil("get_marketplace_profile", "Profil complet d'une marketplace : CA, évolution, objectif, quantités, panier moyen, meilleur produit, top produits, CA mensuel par année et répartition par marque.", {
    marketplace: { type: "string", description: MP },
  }, ["marketplace"]),
  outil("get_ads", "Publicité : dépenses, CA généré, ROAS, ACOS, budget annuel et % de budget consommé par marketplace. ATTENTION : uniquement des totaux annuels 2026, aucun détail mensuel.", {
    marketplace: { type: "string", description: "Marketplace ads (ex. Amazon, Leroy Merlin, Cdiscount) ; vide = toutes, avec le détail par pays." },
  }),
  outil("get_prices", "Prix HT constatés d'un produit par marketplace : dernier prix 2026, prix moyen pondéré 2026 et 2025, quantités, prix mois par mois 2026.", {
    product: { type: "string", description: PRODUIT }, marketplace: { type: "string", description: MP },
  }, ["product"]),
  outil("get_elasticity", "Élasticité-prix estimée (produit × marketplace) : sensibilité des volumes au prix, avec indicateur de fiabilité.", {
    product: { type: "string", description: PRODUIT }, marketplace: { type: "string", description: MP },
  }, ["product"]),
  outil("simulate_price", "Simule l'effet d'une variation de prix (ex. -10 % ou +5 %) sur les volumes et le CA d'un produit, à partir de son élasticité. Utile pour les prix promo.", {
    product: { type: "string", description: PRODUIT }, marketplace: { type: "string", description: MP + " Si omis, prend la marketplace la plus fiable pour ce produit." },
    price_change_pct: { type: "number", description: "Variation de prix en % : -10 pour une baisse de 10 %, 5 pour une hausse de 5 %." },
  }, ["product", "price_change_pct"]),
  outil("get_competition", "Concurrence : meilleures ventes publiques relevées sur les marketplaces par sous-catégorie (prix, remise, note, avis, vendeur, produits Bestherm).", {
    category: { type: "string", description: "Sous-catégorie ou segment : radiateur fixe, mobile, soufflant, sèche-serviette, Heater, Cooling…" },
    marketplace: { type: "string", description: "Marketplace du relevé (ex. Leroy Merlin, Amazon)." },
    top_n: { type: "integer", minimum: 1, maximum: 10, description: "Nombre de produits par relevé (défaut 5)." },
  }),
  outil("find_ruptures", "Liste les produits en rupture probable : ils vendaient et n'ont aucune vente sur le dernier mois complet, avec le nombre de mois consécutifs sans vente."),
  outil("get_forecast", "Prévision annuelle d'un produit en CA et en quantité (saisonnalité) avec détection des mois de rupture et fiabilité de l'estimation.", {
    product: { type: "string", description: PRODUIT },
  }, ["product"]),
  outil("get_product_info", "Fiche d'un produit : famille, classe ABC, CA 2025/2026, quantités, meilleures marketplaces, caractéristiques du catalogue (matière, garantie, dimensions…).", {
    product: { type: "string", description: PRODUIT },
  }, ["product"]),
  outil("get_countries", "CA HT par pays, avec part du total et objectif annuel par pays ; filtrable par année, mois, pays ou marketplace.", {
    year: { type: "integer", description: ANNEE }, month_from: MOIS_DE, month_to: MOIS_A,
    country: { type: "string", description: "Pays (France, Espagne, Belgique, Pays-Bas, Allemagne, Royaume-Uni, Portugal, Pologne…) ; vide = tous." },
    marketplace: { type: "string", description: MP },
  }),
  outil("get_categories", "Répartition du CA 2026 par catégorie et sous-catégorie de produit, globalement ou pour une marketplace.", {
    marketplace: { type: "string", description: MP + " Vide = toutes marketplaces." },
  }),
  outil("get_basket_pairs", "Produits achetés ensemble dans une même commande (2026) : paires les plus fréquentes, éventuellement autour d'un produit.", {
    product: { type: "string", description: PRODUIT },
  }),
  outil("get_unsold_products", "Produits du catalogue qui n'ont aucune vente enregistrée.", {
    brand: { type: "string", description: "Filtrer sur une marque (Bestherm, Thomson, HOM'Y)." },
  }),
  outil("get_weekly", "Ventes d'une semaine de 2026 : CA, quantités, prix moyen, répartition par marketplace, top produits et tendance sur 4 semaines.", {
    week: { type: "integer", description: "Numéro de semaine de 2026 (1 = première semaine). Défaut : dernière semaine disponible." },
    marketplace: { type: "string", description: MP },
  }),
  outil("search_products", "Retrouve les noms exacts de produits à partir d'un mot ou d'un nom approximatif (avec famille et CA 2026). À utiliser avant les autres outils dès qu'un nom de produit est incertain.", {
    query: { type: "string", description: "Mot(s) du nom du produit, ex. \"aria\", \"deshum\", \"1000W\"." },
  }, ["query"]),
  outil("get_seasonality", "Indice de saisonnalité mensuel (1 = mois moyen) : mois forts et faibles de l'activité."),
  outil("proposer_dashboard", "Propose à l'utilisateur d'ouvrir l'écran du dashboard le plus adapté à sa question (bouton « Voir le dashboard »). À appeler UNE seule fois, après avoir obtenu tes chiffres et avant ta réponse finale ; ne pas l'appeler pour une question hors périmètre.", {
    tab: { type: "string", enum: ["apercu", "marketplaces", "marques", "prix", "ads", "concurrence", "data"], description: "Onglet : apercu (vue d'ensemble, objectif), marketplaces, marques, prix, ads (publicité), concurrence, data (extraction Excel)." },
    sous_tab: { type: "string", enum: ["marque", "produits", "classification", "radar", "puissances", "synthese", "prix", "comparatif"], description: "Sous-onglet. Pour marques : marque, produits, classification, radar (produit idéal), puissances. Pour concurrence : synthese, produits, prix, comparatif." },
    marketplace: { type: "string", description: "Filtre marketplace à appliquer à l'écran, si la question porte sur un canal précis." },
    recherche: { type: "string", description: "Nom de produit à pré-remplir dans la recherche (onglet marques)." },
    periode: { type: "string", enum: ["mois_courant", "mois_precedent", "annee_courante", "annee_passee"], description: "Période à appliquer, si pertinent." },
  }, ["tab"]),
];
const NOMS_OUTILS = new Set(OUTILS.map((o) => o.name));

function promptSysteme(lang) {
  const langues = { fr: "français", en: "anglais", zh: "chinois", es: "espagnol" };
  const aujourdhui = new Date().toISOString().slice(0, 10);
  return [
    "Tu es l'assistant de pilotage HOM'Y. Tu réponds aux questions de l'équipe sur les ventes, les prix, la publicité, la concurrence et le catalogue des marques Bestherm, Thomson et HOM'Y (radiateurs, sèche-serviettes, déshumidificateurs, ventilateurs vendus sur des marketplaces).",
    "",
    "RÈGLES",
    "1. Tout chiffre vient d'un outil. Ne cite JAMAIS un chiffre de mémoire, n'en invente pas et n'en estime pas : appelle l'outil adapté (enchaîne-en plusieurs si besoin, en parallèle quand c'est possible). Si les outils ne permettent pas de répondre, dis-le franchement et propose l'alternative disponible la plus proche.",
    "2. Réponds dans la langue de la question (langue de l'interface par défaut : " + (langues[lang] || "français") + "). Texte brut uniquement : pas de markdown (pas de **, #, tableaux). Réponse courte et lisible sur mobile : 1 à 4 phrases, ou une courte liste de lignes commençant par « • » (6 lignes maximum). Commence par la réponse, puis un commentaire seulement s'il apporte quelque chose.",
    "3. Montants en euros HT, format français (1 234 567 €), arrondis à l'euro ; utilise k€ ou M€ quand c'est plus lisible. Pour un TTC, applique 20 % de TVA et précise-le.",
    "4. Une fois tes chiffres obtenus, appelle UNE fois proposer_dashboard avec l'écran le plus adapté à la question, puis rédige ta réponse finale. Ne le fais pas pour une question hors périmètre.",
    "5. Si la question n'a aucun rapport avec l'activité ou les données de l'entreprise (culture générale, blague, vie privée, politique, code, etc.), réponds uniquement « Oulah ! Question de fripon 🙈 » (traduit si la question n'est pas en français), sans appeler d'outil.",
    "",
    "CONTEXTE ET LIMITES DES DONNÉES",
    "- Aujourd'hui : " + aujourdhui + ". Dernière donnée de vente : 19 septembre 2026, donc septembre 2026 est partiel. Le détail par produit × marketplace × mois existe pour 2025 et 2026 ; les totaux mensuels globaux remontent à 2024.",
    "- CA = chiffre d'affaires HT. Prix = CA HT ÷ quantité.",
    "- Marketplaces : Amazon FR, Leroy Merlin, ManoMano, Cdiscount, Castorama, Site Web, Darty, Boulanger, Bricomarché, Bricoman, Maxeda, Bol.com, Brico Bravo, Worten, But, Autre.",
    "- Familles de produits : Fixe heater (radiateurs fixes), Sèche-serviettes, Mobile, Ventil, Déshum (déshumidificateurs), Soufflant, Autre.",
    "- Signale ces limites quand elles comptent pour la réponse : (a) publicité : seulement des totaux annuels par marketplace, pas de détail mensuel ; (b) évolutions vs 2025 : les données 2026 sont brutes (non dédupliquées) alors que la base 2025 est dédupliquée, les variations sont donc à prendre avec prudence ; (c) élasticités : estimées sur l'historique, fiable=false signifie estimation fragile ; (d) prévisions : basées sur la saisonnalité, fragiles avec moins de 3 mois de ventes réelles ; (e) concurrence : relevés manuels de meilleures ventes publiques, le rang n'est pas un CA.",
    "- Un produit dont le nom est incertain se retrouve avec search_products avant d'appeler les autres outils.",
  ].join("\n");
}

function origineAutorisee(req) {
  let origine = req.headers.origin;
  if (!origine && req.headers.referer) { try { origine = new URL(req.headers.referer).origin; } catch { origine = null; } }
  if (!origine) return false;
  let hote;
  try { hote = new URL(origine).host; } catch { return false; }
  const hoteServeur = req.headers["x-forwarded-host"] || req.headers.host;
  if (hote === hoteServeur) return true;
  return (process.env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean).includes(origine);
}

function tropDeRequetes(ip) {
  const maintenant = Date.now();
  const liste = (passages.get(ip) || []).filter((t) => maintenant - t < FENETRE_MS);
  liste.push(maintenant);
  passages.set(ip, liste);
  if (passages.size > 500) for (const [k, v] of passages) if (!v.some((t) => maintenant - t < FENETRE_MS)) passages.delete(k);
  return liste.length > LIMITE_REQUETES;
}

async function lireCorps(req) {
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) return req.body;
  let brut = typeof req.body === "string" ? req.body : Buffer.isBuffer(req.body) ? req.body.toString("utf8") : null;
  if (brut === null) {
    brut = await new Promise((resolve, reject) => {
      let acc = "";
      req.on("data", (c) => { acc += c; if (acc.length > 400000) { reject(new Error("trop_gros")); req.destroy(); } });
      req.on("end", () => resolve(acc));
      req.on("error", reject);
    });
  }
  return brut ? JSON.parse(brut) : {};
}

// reconstruit chaque bloc à partir de champs autorisés uniquement (rien d'autre
// ne part vers l'API) et refuse tout ce qui n'a pas la forme attendue
function nettoyerMessages(messages) {
  if (!Array.isArray(messages) || !messages.length || messages.length > MAX_MESSAGES) return null;
  const sortie = [];
  for (const m of messages) {
    if (!m || (m.role !== "user" && m.role !== "assistant")) return null;
    if (typeof m.content === "string") {
      if (!m.content.trim() || m.content.length > MAX_CARACTERES_BLOC) return null;
      sortie.push({ role: m.role, content: m.content });
      continue;
    }
    if (!Array.isArray(m.content) || !m.content.length) return null;
    const blocs = [];
    for (const b of m.content) {
      if (!b || typeof b !== "object") return null;
      if (b.type === "text") {
        if (typeof b.text !== "string" || b.text.length > MAX_CARACTERES_BLOC) return null;
        blocs.push({ type: "text", text: b.text });
      } else if (b.type === "tool_use") {
        if (m.role !== "assistant" || typeof b.id !== "string" || !NOMS_OUTILS.has(b.name) || !b.input || typeof b.input !== "object") return null;
        blocs.push({ type: "tool_use", id: b.id, name: b.name, input: b.input });
      } else if (b.type === "tool_result") {
        if (m.role !== "user" || typeof b.tool_use_id !== "string" || typeof b.content !== "string" || b.content.length > MAX_CARACTERES_BLOC) return null;
        blocs.push({ type: "tool_result", tool_use_id: b.tool_use_id, content: b.content, ...(b.is_error ? { is_error: true } : {}) });
      } else if (b.type === "thinking") {
        if (m.role !== "assistant" || typeof b.thinking !== "string" || typeof b.signature !== "string" || b.thinking.length > MAX_CARACTERES_REFLEXION) return null;
        blocs.push({ type: "thinking", thinking: b.thinking, signature: b.signature });
      } else if (b.type === "redacted_thinking") {
        if (m.role !== "assistant" || typeof b.data !== "string" || b.data.length > MAX_CARACTERES_REFLEXION) return null;
        blocs.push({ type: "redacted_thinking", data: b.data });
      } else return null;
    }
    sortie.push({ role: m.role, content: blocs });
  }
  return sortie;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "GET") return res.status(200).json({ ok: true, configured: Boolean(process.env.ANTHROPIC_API_KEY), model: MODELE });
  if (req.method !== "POST") return res.status(405).json({ error: "methode_non_autorisee" });
  if (!origineAutorisee(req)) return res.status(403).json({ error: "origine_refusee" });
  const cle = process.env.ANTHROPIC_API_KEY;
  if (!cle) return res.status(503).json({ error: "non_configure" });
  const ip = String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "inconnue").split(",")[0].trim();
  if (tropDeRequetes(ip)) return res.status(429).json({ error: "trop_de_requetes" });

  let corps;
  try { corps = await lireCorps(req); } catch { return res.status(400).json({ error: "corps_invalide" }); }
  const messages = nettoyerMessages(corps.messages);
  if (!messages || messages[0].role !== "user") return res.status(400).json({ error: "messages_invalides" });

  try {
    const reponse = await fetch(API_URL, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": cle, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: MODELE, max_tokens: MAX_TOKENS,
        system: [{ type: "text", text: promptSysteme(corps.lang), cache_control: { type: "ephemeral" } }],
        tools: OUTILS, messages,
      }),
      signal: AbortSignal.timeout(25000),
    });
    if (!reponse.ok) {
      let message = "";
      try { message = String((await reponse.json())?.error?.message || "").slice(0, 200); } catch { /* corps non JSON */ }
      return res.status(reponse.status === 429 ? 429 : 502).json({ error: "erreur_api", statut_api: reponse.status, message });
    }
    const data = await reponse.json();
    return res.status(200).json({ content: data.content, stop_reason: data.stop_reason });
  } catch (e) {
    return res.status(502).json({ error: "api_injoignable", message: String(e?.message || e).slice(0, 120) });
  }
}
