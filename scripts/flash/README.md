# Flash Shopify : actualisation quotidienne

La carte « Flash Shopify » (haut de l'onglet « Vue d'ensemble », avec « Toutes marketplaces » ou avec le filtre « Site Web »)
montre les ventes des **deux boutiques Shopify** **postérieures à la dernière date du fichier ODP** (`DMAX` dans `App.jsx`),
jusqu'à **hier** (heure de Paris). Trois onglets : **Total** (somme exacte des deux boutiques), **Marketplaces** et **Site web**.

| Boutique | Option `--boutique` | Fichier écrit | Comment elle est lue |
|---|---|---|---|
| Marketplaces : BESTHERM, `46a3f9-2.myshopify.com` | `marketplaces` (par défaut) | `shopify_flash.json` | connecteur Shopify de Claude (`run-analytics-query`) ; résultats relus dans la transcription de la session |
| Site web : bestherm.fr, `besthermshop.myshopify.com` | `site` | `shopify_flash_site.json` | relais en lecture seule `api/mcp-site.mjs` (Vercel), appelé par `site_query.mjs` ; résultats dans un fichier `--results` |

**Le script ne modifie que ces deux fichiers JSON.** `App.jsx` n'est jamais touché : pas de conflit avec les envois manuels
sur GitHub, et un commit quotidien de quelques ko seulement.

## Ce que chaque bloc contient

| Élément | Règle |
|---|---|
| CA HT, marketplaces | **(ventes nettes + taxes) ÷ 1,2**, comme le CA HT de l'ODP (TTC ÷ 1,2). Les ventes nettes seules surestiment d'environ 2 % : les commandes sans taxe enregistrée y restent en TTC |
| CA HT, site web | **Ventes brutes hors taxes** (`gross_sales`, avant remises et retours). C'est la base du canal « Site Web » de l'ODP (valeur marchande TTC ÷ 1,2) : mesuré sur 10 semaines (26/07 → 03/10/2026), l'ODP vaut 1,000 × les ventes brutes du site, par semaine entre 0,89 et 1,05. Les ventes nettes sont 8,6 % plus basses (remises, retours) et ne s'additionneraient pas à l'ODP |
| Jours | Jours de Paris, jours complets seulement (jusqu'à hier) |
| N-1 | Mêmes dates calendaires de 2025 (29 février → 28 février), mesurées dans la même boutique Shopify, donc avec la même base |
| Pays | Noms Shopify (anglais) traduits vers les noms de l'application ; pas de pays à 0 € |
| Produits | Référence Shopify → nom produit de l'application via la table `ABC_BY_SKU` de `App.jsx` (suffixes `_never_used` et `-FLM` retirés, `/` remplacé par `-`). Surcharges dans `SURCHARGES_SKU` du script. Référence inconnue : affichée sous son code |
| Contrôle ODP, marketplaces | Deux dernières semaines complètes couvertes par l'ODP (dimanche → samedi) : Shopify contre l'ODP **hors site web** (`WEEKLY_BY_MP`). Avertissement au-delà de 3 %, refus d'écrire au-delà de 8 % |
| Contrôle ODP, site web | Même fenêtre, contre les lignes **« Site Web »** de l'ODP. Seuils plus larges (avertissement 5 %, refus 12 %) : à la semaine, les dates de commande et les remises créent un écart naturel de ±5 % |
| Cumul estimé | Calculé dans l'application. Total : `kpi.ca_total_2026` (ODP) + flash marketplaces + flash site. Site seul : ventes « Site Web » de l'ODP + flash du site, comparées à l'objectif du site |

Ce que la carte **ne fait pas** : les KPI, courbes, plan, estimations et autres onglets restent calculés sur le fichier ODP
(site web compris, jusqu'à `DMAX`). Le connecteur Shopify de Claude ne sert qu'une boutique à la fois (`switch-shop` révoque
l'autre : ne jamais l'appeler) ; c'est pourquoi le site passe par son propre relais en lecture seule.

## Garde-fous

- Boutique vérifiée à chaque extraction (`shopDomain`), sinon aucune écriture. Les résultats sont rangés **par boutique** :
  un résultat de l'autre boutique n'est jamais utilisé, même pour une requête de même texte. Pour le site, un résultat qui
  n'indique pas sa boutique est refusé.
- Couverture : pays et références doivent couvrir le total des jours (jour manquant ou liste tronquée détecté).
- Pas de régression : un bloc ne peut pas reculer (`au` plus ancien) et les jours communs avec le bloc précédent ne
  peuvent pas varier de plus de 15 % au total (`--force` pour passer outre, en connaissance de cause).
- Application : les jours déjà couverts par l'ODP (jour ≤ `DMAX`) sont ignorés à l'affichage. Une mise à jour de l'ODP
  entre deux actualisations ne crée donc pas de doublon (listes et contrôle masqués jusqu'à la prochaine actualisation).
- Application : pastille « Non actualisé depuis N j » à partir de 2 jours sans actualisation (avec le nom de la boutique la
  plus ancienne) ; si les deux boutiques ne couvrent pas la même période, le total le dit et n'affiche plus d'écart N-1.
- Les deux boutiques sont **indépendantes** : si l'une échoue, l'autre est quand même mise à jour et poussée ; l'application
  garde les chiffres de la veille pour la boutique en échec.

## Procédure (tâche planifiée du matin ou lancement manuel)

Toutes les commandes se lancent depuis la racine du dépôt. Pour les marketplaces, s'arrêter au premier échec : ne rien pousser
de ce bloc. Le site est traité à part (étape 5) : son échec n'empêche pas les marketplaces.

1. **Boutique des marketplaces** : outil Shopify `get-shop-info` → nom `BESTHERM`. Sinon, arrêt de ce bloc (ne jamais appeler
   `switch-shop`).
2. **Dépôt** : `add_repo` (AMSQIA / homy-pilotage, accès push), puis
   `git clone --depth 1 https://github.com/AMSQIA/homy-pilotage /home/claude/homy-pilotage`, puis `register_repo_root`.
3. **Contrôles** :
   ```bash
   TODAY=$(TZ=Europe/Paris date +%F)          # à calculer UNE fois et à réutiliser partout
   node scripts/flash/selftest.mjs             # SELFTEST_OK
   node scripts/flash/refresh_flash.mjs check --today $TODAY    # vérifie les deux boutiques
   ```
   Pour garder les deux blocs indépendants, la tâche planifiée lance plutôt `check --boutique marketplaces` au début de
   l'étape 4 et `check --boutique site` au début de l'étape 5 : un défaut qui ne touche qu'une boutique ne bloque pas l'autre.
4. **Marketplaces** :
   - `node scripts/flash/refresh_flash.mjs plan --today $TODAY` affiche les requêtes ShopifyQL (5 en général).
     `"vide": true` signifie que l'ODP couvre déjà jusqu'à hier : sauter l'extraction (le bloc sera vidé à l'application).
   - Lancer **chaque** requête avec `run-analytics-query` (connecteur Shopify), **texte exact**, toutes dans le même message.
     Ne rien recopier à la main : le script relit les résultats dans la transcription de la session
     (`~/.claude/projects/**.jsonl`), et ne retient que les résultats de la bonne boutique dont le texte correspond au plan.
   - `node scripts/flash/refresh_flash.mjs apply --today $TODAY` → `OK · shopify_flash.json mis à jour`.
5. **Site web** (relais en lecture seule ; la clé du relais est la variable Vercel `MCP_SITE_KEY`, fournie par l'environnement,
   **jamais écrite dans le dépôt**) :
   ```bash
   export MCP_SITE_KEY=...                                                       # clé du relais
   node scripts/flash/site_query.mjs --plan --today $TODAY --out /tmp/site_flash.json
   node scripts/flash/refresh_flash.mjs apply --boutique site --today $TODAY --results /tmp/site_flash.json
   ```
   `site_query.mjs` vérifie la boutique (`besthermshop.myshopify.com`), exécute les requêtes du plan et écrit les résultats ;
   il reprend seul après une coupure réseau. Plan vide : `[]` est écrit et `apply` vide le bloc. En cas d'échec (relais
   injoignable, clé refusée, contrôle ODP hors seuil) : ne rien écrire pour le site, continuer, le signaler dans le compte rendu.
   Les lignes `AVERTISSEMENT` ne bloquent jamais (références non rattachées, pays sans traduction, écart de contrôle entre
   les seuils d'avertissement et d'échec) : à reprendre dans le compte rendu. Pour un essai sans écriture : `--dry-run`.
6. **Vérifications** :
   ```bash
   git status --short                          # seuls shopify_flash.json et shopify_flash_site.json peuvent apparaître (hors package-lock.json, dist, node_modules)
   npm install --no-audit --no-fund && npx vite build
   node scripts/flash/smoke.mjs                # SMOKE_OK ; code 77 = navigateur indisponible (continuer et le signaler)
   ```
7. **Publication** : `git add` des seuls fichiers JSON modifiés, commit
   (`Flash Shopify : ventes du <du> au <au>`), `git fetch origin`, `git rebase origin/main` si besoin,
   `GIT_TERMINAL_PROMPT=0 git push origin main`. Vercel redéploie tout seul.
8. **Contrôle en ligne** (jusqu'à 6 minutes) : `https://homy-pilotage.vercel.app/` référence un fichier
   `assets/index-*.js` ; ce fichier doit contenir la valeur de `extrait_a` de chaque fichier JSON poussé.

## Après une mise à jour du fichier ODP

Après toute mise à jour de `App.jsx` à partir d'un nouvel export ODP (`DMAX` avance) : relancer les étapes 3 à 7 le jour
même. Sinon l'application masque seule les jours déjà couverts, mais les listes pays et produits restent absentes
jusqu'à la prochaine actualisation du matin.

## Codes de sortie

`refresh_flash.mjs` :

| Code | Sens |
|---|---|
| 0 | Réussi |
| 1 | Erreur d'utilisation ou de structure (`App.jsx` n'importe plus le fichier JSON, constantes illisibles, fichier de résultats illisible) |
| 2 | Contrôle de cohérence échoué : rien n'est écrit (boutique inattendue, couverture, régression, écart de contrôle) |
| 3 | Résultats ShopifyQL manquants pour cette boutique : relancer exactement les requêtes du plan, avec le même `--boutique` et le même `--today` |

`site_query.mjs` : 0 réussi · 1 erreur d'utilisation (clé absente, option inconnue) · 2 refus ou erreur du relais ou de Shopify
(clé refusée, relais non configuré, boutique inattendue, injoignable après trois essais) : rien n'est écrit.

## Fichiers

- `refresh_flash.mjs` : plan des requêtes, lecture des résultats, calculs, contrôles, écriture (une entrée par boutique dans `PROFILS`).
- `site_query.mjs` : requêtes ShopifyQL de la boutique du site par le relais en lecture seule (`--info`, `--query`, `--plan`).
- `selftest.mjs` : auto-test sur données synthétiques, les deux boutiques (à relancer après toute modification du script).
- `smoke.mjs` : test d'affichage sur le build (`dist/`) : trois onglets, filtre « Site Web », 4 langues, fraîcheur, mobile.
- `test_mcp_site.mjs` : test du relais `api/mcp-site.mjs` (Shopify simulé, sans réseau) ; ne fait pas partie de l'actualisation du matin.
