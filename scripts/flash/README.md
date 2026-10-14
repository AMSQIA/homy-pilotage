# Flash Shopify : actualisation quotidienne

Le bloc « Flash Shopify » (haut de l'onglet « Vue d'ensemble », avec « Toutes marketplaces ») montre les ventes de la
boutique Shopify **BESTHERM** (marketplaces) **postérieures à la dernière date du fichier ODP** (`DMAX` dans `App.jsx`),
jusqu'à **hier** (heure de Paris). Les données sont dans `shopify_flash.json`, importé par `App.jsx`.

**Le script ne modifie que `shopify_flash.json`.** `App.jsx` n'est jamais touché : pas de conflit avec les envois manuels
sur GitHub, et un commit quotidien de quelques ko seulement.

## Ce que le bloc contient

| Élément | Règle |
|---|---|
| CA HT | **(ventes nettes + taxes) ÷ 1,2**, comme le CA HT de l'ODP (TTC ÷ 1,2). Les ventes nettes seules surestiment d'environ 2 % : les commandes sans taxe enregistrée y restent en TTC |
| Jours | Jours de Paris, jours complets seulement (jusqu'à hier), commandes annulées exclues |
| N-1 | Mêmes dates calendaires de 2025 (29 février → 28 février), mesurées dans Shopify, donc avec la même convention |
| Pays | Noms Shopify (anglais) traduits vers les noms de l'application |
| Produits | Référence Shopify → nom produit de l'application via la table `ABC_BY_SKU` de `App.jsx` (suffixes `_never_used` et `-FLM` retirés, `/` remplacé par `-`). Surcharges dans `SURCHARGES_SKU` du script. Référence inconnue : affichée sous son code |
| Contrôle | Deux dernières semaines complètes couvertes par l'ODP (dimanche → samedi) : Shopify HT comparable contre l'ODP hors site web (`WEEKLY_BY_MP`). Écart > 8 % : le script refuse d'écrire (convention de TVA ou extraction à revoir) |
| Cumul estimé | Calculé dans l'application : `kpi.ca_total_2026` (ODP) + flash. Le site web n'est pas inclus depuis `DMAX` |

Ce que le bloc **ne fait pas** : les KPI, courbes, plan, estimations et autres onglets restent calculés sur le fichier
ODP (site web compris). La boutique Shopify du site web n'est pas lisible en même temps que BESTHERM (le connecteur ne
sert qu'une boutique à la fois ; `switch-shop` révoque l'autre : ne jamais l'appeler).

## Garde-fous

- Boutique vérifiée à chaque extraction (`shopDomain` = `46a3f9-2.myshopify.com`), sinon aucune écriture.
- Couverture : pays et références doivent couvrir le total des jours (jour manquant ou liste tronquée détecté).
- Pas de régression : le bloc ne peut pas reculer (`au` plus ancien) et les jours communs avec le bloc précédent ne
  peuvent pas varier de plus de 15 % au total (`--force` pour passer outre, en connaissance de cause).
- Application : les jours déjà couverts par l'ODP (jour ≤ `DMAX`) sont ignorés à l'affichage. Une mise à jour de l'ODP
  entre deux actualisations ne crée donc pas de doublon (listes et contrôle masqués jusqu'à la prochaine actualisation).
- Application : pastille « Non actualisé depuis N j » à partir de 2 jours sans actualisation.

## Procédure (tâche planifiée du matin ou lancement manuel)

Toutes les commandes se lancent depuis la racine du dépôt. S'arrêter au premier échec : ne rien pousser.

1. **Boutique** : outil Shopify `get-shop-info` → nom `BESTHERM`. Sinon, arrêt (ne jamais appeler `switch-shop`).
2. **Dépôt** : `add_repo` (AMSQIA / homy-pilotage, accès push), puis
   `git clone --depth 1 https://github.com/AMSQIA/homy-pilotage /home/claude/homy-pilotage`, puis `register_repo_root`.
3. **Contrôles** :
   ```bash
   TODAY=$(TZ=Europe/Paris date +%F)          # à calculer UNE fois et à réutiliser partout
   node scripts/flash/selftest.mjs             # SELFTEST_OK
   node scripts/flash/refresh_flash.mjs check --today $TODAY
   ```
4. **Plan** : `node scripts/flash/refresh_flash.mjs plan --today $TODAY` affiche les requêtes ShopifyQL (5 en général).
   `"vide": true` signifie que l'ODP couvre déjà jusqu'à hier : passer à l'étape 6 (le bloc sera vidé).
5. **Extraction** : lancer **chaque** requête avec `run-analytics-query`, **texte exact**, toutes dans le même message.
   Ne rien recopier à la main : le script relit les résultats dans la transcription de la session
   (`~/.claude/projects/**.jsonl`), et ne retient que les résultats dont le texte de requête correspond au plan.
6. **Application** : `node scripts/flash/refresh_flash.mjs apply --today $TODAY` → `OK · shopify_flash.json mis à jour`.
   Les lignes `AVERTISSEMENT` ne bloquent pas (références non rattachées, pays sans traduction, écart de contrôle
   entre 3 % et 8 %) : à reprendre dans le compte rendu.
   Pour un essai sans écriture : `--dry-run`.
7. **Vérifications** :
   ```bash
   git status --short                          # seul shopify_flash.json doit apparaître (hors package-lock.json, dist, node_modules)
   npm install --no-audit --no-fund && npx vite build
   node scripts/flash/smoke.mjs                # SMOKE_OK ; code 77 = navigateur indisponible (continuer et le signaler)
   ```
8. **Publication** : `git add shopify_flash.json` (rien d'autre), commit
   (`Flash Shopify : ventes du <du> au <au>`), `git fetch origin`, `git rebase origin/main` si besoin,
   `GIT_TERMINAL_PROMPT=0 git push origin main`. Vercel redéploie tout seul.
9. **Contrôle en ligne** (jusqu'à 6 minutes) : `https://homy-pilotage.vercel.app/` référence un fichier
   `assets/index-*.js` ; ce fichier doit contenir la valeur de `extrait_a` de `shopify_flash.json`.

## Après une mise à jour du fichier ODP

Après toute mise à jour de `App.jsx` à partir d'un nouvel export ODP (`DMAX` avance) : relancer les étapes 3 à 8 le jour
même. Sinon l'application masque seule les jours déjà couverts, mais les listes pays et produits restent absentes
jusqu'à la prochaine actualisation du matin.

## Codes de sortie de `refresh_flash.mjs`

| Code | Sens |
|---|---|
| 0 | Réussi |
| 1 | Erreur d'utilisation ou de structure (`App.jsx` n'importe plus `shopify_flash.json`, constantes illisibles) |
| 2 | Contrôle de cohérence échoué : rien n'est écrit (boutique inattendue, couverture, régression, écart de contrôle) |
| 3 | Résultats ShopifyQL manquants : relancer exactement les requêtes du plan, avec le même `--today` |

## Fichiers

- `refresh_flash.mjs` : plan des requêtes, lecture des résultats, calculs, contrôles, écriture.
- `selftest.mjs` : auto-test sur données synthétiques (à relancer après toute modification du script).
- `smoke.mjs` : test d'affichage sur le build (`dist/`), 4 langues, fraîcheur, mobile.
