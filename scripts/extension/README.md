# Prolongement Shopify : toute l'application à jour jusqu'à hier

Le fichier ODP (constantes de `App.jsx`) s'arrête à `DMAX_ODP` (3 octobre 2026 au dernier import). Les ventes suivantes
viennent des **deux boutiques Shopify** et sont **ajoutées à tous les tableaux de l'application au chargement** : KPI, courbes
mensuelles et hebdomadaires, marketplaces, marques, produits, pays, catégories, normes, plan 2026, comparaisons avec 2025 à
date identique. Tous les chiffres s'arrêtent donc au même jour, `DMAX` (en général la veille), et s'accordent entre eux.

```
 Shopify BESTHERM (marketplaces) ─┐                         ┌──► KPI, courbes, marketplaces, marques,
 Shopify bestherm.fr (site web) ──┼─► refresh_extension.mjs ─► shopify_extension.json ─► extension.js ─┤    produits, pays, catégories, plan, N-1
 fichier ODP (constantes App.jsx) ┘   (chaque matin)         (lignes par jour)        (au chargement)  └──► bandeau « Données à jour »
```

| Fichier | Rôle |
|---|---|
| `shopify_extension.json` | Ventes Shopify après `DMAX_ODP`, une ligne par jour × marketplace × produit × pays. **Seul fichier écrit par l'actualisation quotidienne.** |
| `extension.js` | Module pur, utilisé par `App.jsx` au chargement : ajoute ces lignes aux constantes ODP et recalcule ce qui en dérive. Atomique : au moindre problème, l'application garde le socle ODP tel quel (`DMAX = DMAX_ODP`) et le bandeau le signale |
| `data/n1_2025.json` | Ventes 2025 d'octobre à décembre (tirées de l'ODP 2025) : « même période 2025 » du mois en cours (`build_n1.mjs`) |
| `data/produits_meta.json` | Marque et norme de chaque produit (comme l'ODP), correspondances de références (`skus`) et attributs des produits absents de l'application (`attributs`) |
| `scripts/extension/refresh_extension.mjs` | Plan des requêtes, lecture des résultats, calculs, contrôles, écriture |
| `scripts/extension/site_query.mjs` | Lecture de la boutique du site par le relais en lecture seule `api/mcp-site.mjs` |
| `repartitions.js` | Module pur de l'onglet Marques › Répartitions : pays, marque, catégorie, sous-catégorie × marketplace × mois, en CA HT et en quantités ; palette validée (voir plus bas) |
| `scripts/extension/preparer_repartitions.mjs` | Ajoute `SKU_MARQUE` et la quantité des lignes pays 2026 (`PAYS_MONTHLY`, 6e élément) aux constantes de `App.jsx` depuis l'export « LIGNES ODP 2026 » ; refuse d'écrire si le CA ne retombe pas |
| `scripts/extension/selftest.mjs` | Contrôle de cohérence sur les vraies données du dépôt (à lancer avant toute publication) |
| `scripts/extension/smoke.mjs` | Test d'affichage sur le build (`dist/`) dans Chromium ; `--repartitions` ne lance que l'onglet Répartitions ; `--navigation` ne lance que la navigation mobile (barres du haut et du bas figées, filtres, sous-onglets, saisie, 4 langues) |
| `scripts/extension/test_mcp_site.mjs` | Test du relais (Shopify simulé, sans réseau) ; ne fait pas partie de l'actualisation du matin |
| `api/marketplaces.mjs` | Relais en lecture seule des API vendeur d'Octopia (Cdiscount) et de ManoMano (mise en place : `INSTRUCTIONS_DEPLOIEMENT.md`, note du 28 octobre). Sert à rapprocher les ventes que Shopify attribue à ces deux marketplaces de leurs chiffres propres ; aucune donnée de client en sortie |
| `scripts/extension/test_marketplaces.mjs` | Test de ce relais (Octopia et ManoMano simulés, sans réseau) ; ne fait pas partie de l'actualisation du matin |
| `scripts/extension/build_n1.mjs` | Reconstruit `data/n1_2025.json` depuis l'export « LIGNE ODP 2025 » (rarement) |

`App.jsx` n'est jamais modifié par l'actualisation quotidienne : pas de conflit avec les envois manuels, un commit de
quelques ko par jour.

## Règles de calcul

| Élément | Règle |
|---|---|
| CA HT marketplaces | **(ventes nettes + taxes) ÷ 1,2** ligne par ligne, sur les lignes de type `product` seulement (les lignes de port n'ont que de la TVA : l'ODP n'en contient presque pas), comme le CA HT de l'ODP (TTC ÷ 1,2) |
| CA HT site web | **Ventes brutes hors taxes** (`gross_sales`, avant remises et retours) : base du canal « Site Web » de l'ODP (mesuré : l'ODP vaut 1,000 × les ventes brutes du site sur 10 semaines) ; lignes retirées de la commande (quantité 0) écartées |
| Marketplace d'une commande | Passerelle de paiement de la commande (jeu `payments`, passerelle au plus gros montant), `… via Shopping Feed` retiré : `leroymerlin` → Leroy Merlin, sauf les commandes dont le numéro d'origine commence par 014 → **Technomat** (ligne suivante), `amazon`/`amazon fba` → Amazon FR, `epmm`/`monechelle`/`manomano` → ManoMano, `cdiscount`/`clogistique` → Cdiscount, `maxeda`, `castoramafr` → Castorama, `bricomarche`, `dartybomp` → Darty, `boulanger`, `bricobravo` → Brico Bravo, `but`, `worten`, `bol` → Bol.com. Toute autre passerelle (bricodepotes, carrefour, vente-unique, leclerc…) et les commandes à 0 € sans paiement (envois de remplacement) → « Autre » ; la liste des passerelles inconnues est donnée en avertissement |
| Site web | Marketplace « Site Web » (boutique bestherm.fr) |
| Technomat | Commandes de la passerelle `leroymerlin` dont le **numéro d'origine** (attribut de commande `leroymerlin Number`, ex. `014-120208-A`) commence par **014**. C'est la ligne « BRICOMAN » de l'ODP, renommée : janvier → 3 octobre 2026, Shopify donne 961 unités et 89,6 k€ HT, comme l'application (janvier, mars et mai identiques au centime). Shopify ne les distingue que par cet attribut (aucun filtre côté serveur) : le `plan` contient donc une requête **GraphQL de classification** (`plan.classification`, outil `graphql_query`, lecture seule : nom et attributs de commande des commandes Leroy Merlin de la fenêtre, `first` = 50 puis `after` = `pageInfo.endCursor` tant que `hasNextPage` vaut `true`). `apply` relit ces pages dans la transcription (ou `--ordres-lm fichier.json`, objet `nom → numéro`). **Une commande Leroy Merlin dont le numéro n'a pas été lu fait échouer l'extraction (code 3)** : jamais de classement au hasard. Préfixes connus : 001 France, 002 Espagne, 003 Portugal, 005, 006, 014 Technomat ; un autre format reste dans Leroy Merlin avec un avertissement. Pas d'objectif fiable : ni ligne du plan ni courbe |
| Produits | Référence Shopify → produit de l'application via `ABC_BY_SKU` et `skus` de `data/produits_meta.json` (suffixes `_never_used` et `-FLM` retirés, `/` remplacé par `-`). Référence inconnue : conservée sous son code, avertissement |
| Marque et norme | Table `data/produits_meta.json` (reproduit les courbes du fichier ODP, même quand la marque du vendeur Shopify diffère : l'écart est signalé en avertissement) |
| Pays | Noms Shopify (anglais) traduits vers les noms de l'application ; pays inconnu conservé tel quel |
| Jours | Jours de Paris, jours complets seulement (jusqu'à hier) |
| Semaines | Convention Excel (dimanche → samedi, semaine 1 = 1er au 3 janvier 2026) ; la semaine en cours est partielle |
| Lignes de commande, panier moyen | « Panier moyen » = CA ÷ nombre de lignes de l'ODP (74 632 lignes au 3 octobre), **pas** le panier par commande de Shopify (≈ 170 €). Dans l'ODP, la plupart des marketplaces (Amazon, Cdiscount, site web…) ont **une ligne par unité vendue** ; Leroy Merlin, ManoMano et « Autre » une ligne par commande et référence. Pour les jours Shopify, on compte donc les unités pour les premières (lignes ÷ unités ≥ 0,99 sur le socle ODP) et les lignes Shopify (commande × référence) pour les autres : le panier reste sur la base du fichier |
| N-1 | Mois entiers 2025 avant le mois en cours + coupe du 1er du mois en cours au même jour de 2025 (`data/n1_2025.json`) |
| `DMAX` | Plus ancienne des deux couvertures (si une boutique n'est pas à jour, tout l'écran s'arrête au dernier jour couvert par les deux) |

**Ce qui n'est pas prolongé** (reste calculé sur le fichier ODP, donc arrêté à `DMAX_ODP`) : publicité, concurrence,
élasticité-prix et simulations, associations de produits (paniers), catalogue, transporteurs et entrepôts. Le bloc
« Données à jour » de l'onglet Vue d'ensemble le rappelait ; ce rappel a été retiré de l'écran le 17 octobre 2026 (« garde l'essentiel ») :
il reste ici, et `SOUS_INFOS = true` dans `App.jsx` le fait revenir.

## Suivi quotidien (premier bloc de la Vue d'ensemble)

Le bloc « Données à jour » est un suivi du quotidien : puces de période (`7 j · 13 j` (les jours de ventes Shopify disponibles après la fin du fichier ODP ; avec un historique plus long : 7 / 14 / 30 / 90 j)), CA HT de la période avec sa variation par rapport aux mêmes dates de
l'an dernier, histogramme par jour (marketplaces + site web) avec la courbe pointillée de l'an dernier, top 10 des produits et part du CA par pays — sur la
période ou, en touchant une barre, sur ce seul jour. Il suit le filtre marketplace global. `suiviDonnees()` dans `App.jsx` lit les lignes Shopify qui prolongent le fichier ODP (après `DMAX_ODP`, schéma 1 : jour × marketplace × produit × pays) et `data/n1_2025.json` pour les mêmes jours de 2025 (par marketplace et par produit, sans détail par pays).

**Jour touché : même date ou même jour de la semaine** : par défaut un jour touché est comparé à la même date l'an dernier (`suiviAnAvant`), comme tout le reste du bloc ;
le choix « Même jour de semaine » le compare au jour 364 jours avant (`suiviCalc(…, semaine = true)`), de même jour de la semaine. Mémorisé dans `localStorage`
(clé `homy_suivi_jour_semaine`) ; l'étiquette « vs … » d'un jour touché indique le jour de la semaine comparé.

**Écart en € et mobile** : à côté de la variation en %, chaque produit du top 10 et le chiffre en tête affichent l'écart en euros avec les mêmes dates de l'an dernier
(« +19k€ », « -4.2k€ », « +840€ »), sur la même base que le % ; « nouveau » = produit absent l'an dernier (écart = son CA) ; rien sur un seul jour ni sans base de
comparaison. Sous 1 024 px de large, le top 10 et la part par pays s'affichent un à la fois (onglets « Produits | Marketplaces | % par pays », choix mémorisé dans `localStorage`,
clé `homy_suivi_onglet`) ; sur ordinateur, les volets restent côte à côte (trois colonnes dès 1 280 px).

**Top 10 marketplaces** : volet « Marketplaces » (absent quand un filtre marketplace est actif) : le classement des canaux de vente — marketplaces et site web, en bleu —
par CA HT sur la période ou le jour touché, avec part du CA, unités, variation en % et écart en € (`topMp` dans `suiviCalc`). La variation se calcule canal par canal et seulement
pour un canal comparable : pas pour le site web (2025 partiel dans le fichier ODP), ni pour « Autre » (regroupement ODP 2025 ≠ marketplaces nommées aujourd'hui), ni pour une
marketplace absente de `data/n1_2025.json` (`n1Connait`). Contrairement aux produits, les canaux gardent leur variation sur un jour touché (comme le chiffre en tête).

**Plan 2026 : objectif du jour et « % du plan »** : la courbe verte en escalier de l'histogramme et la ligne « Objectif · % · écart » sous le chiffre en tête comparent le CA au plan hebdomadaire
(`OBJECTIF_2026.hebdo`, semaines Excel dimanche → samedi, `excelWeekOf`). L'objectif d'un jour = objectif de sa semaine ÷ 7 × **poids de son jour de la semaine** (`suiviPoidsJours`) :
`suiviProfilJours` parcourt les tranches de jours du périmètre (`S.tranchesJours(mpF)` : les jours Shopify après `DMAX_ODP` (tous canaux, ou ceux de la marketplace filtrée) et les jours 2025 de `data/n1_2025.json` (marketplaces seules ; pas de tranche 2025 pour le site web)), retient les semaines entières (dimanche → samedi) dont les 7 jours ont une
vente, mesure la part de chaque jour dans la moyenne de sa semaine et fait la moyenne de ces parts ; il faut au moins `SUIVI_PROFIL_MIN` = 8 semaines, sinon le périmètre prend le profil de l'ensemble
des canaux (puis, à défaut, une répartition à plat ÷ 7). Les poids ont pour moyenne 1 : le total de chaque semaine entière reste celui du plan. Avec un filtre marketplace, l'objectif est le prorata de son objectif annuel
(`DATA.mp_vs_objectif`, `partObj`) ; sans objectif fiable (« Autre », « But », « Technomat ») : ni ligne du plan ni courbe. L'objectif d'une période est la somme des objectifs de ses jours, celui d'un jour touché
est le sien ; le plan ne couvre que les semaines 1 à 52 de 2026 (une fenêtre qui en sort n'affiche pas d'objectif). Les repères de test sont `data-suivi="plan"` (`data-objectif`, `data-pct`),
`data-suivi="objectif"` (légende) et `data-suivi="objectif-jour"` (un point invisible par jour sur la courbe, `data-d` / `data-obj`). La courbe d'objectif mensuel de la tendance est tracée après le masque
de la fourchette anticipée, avec des points pleins ; tous ces libellés sont traduits (`suivi_obj_*`, `obj_2026_*`).

**« Donnée comparable »** : l'an dernier = les mêmes dates calendaires un an plus tôt (29 févr. → 28 févr.). Jamais de variation calculée sur une base incomplète. Le « Site Web » 2025 du fichier ODP ne contient qu'une petite partie des ventes réelles du site (la boutique du site n'était pas encore dans ces chiffres) : tant que cette version est en ligne, la comparaison se fait donc sur les **marketplaces seules** (légende « 2025 · marketplaces », mention « Δ marketplaces » au-dessus du top 10, pas de variation pour le site web) ; pour une marketplace absente du fichier 2025 (Boulanger, Brico Bravo, Maxeda, Worten), pour « Autre » (regroupement du fichier ODP 2025 qui n'a pas le même contenu qu'aujourd'hui) ou pour le site web seul, aucune comparaison. Le fichier 2025 n'a pas de détail par pays : pas de variation par pays. Ces limites disparaissent avec la version « tout vient de Shopify » (historique complet des deux boutiques).

Ces affichages ne reposent sur aucun fichier de plus : tout est recalculé au chargement à partir des lignes ci-dessus. `smoke.mjs` en contrôle les chiffres
contre un calcul indépendant fait dans le test (CA, variation et écart en € de chaque produit, parts de pays, onglets mobile compris).

## Répartitions (onglet Marques › Répartitions)

Trois découpages du même cube — **pays**, **marque** (Bestherm · HOM'Y · Thomson) et **type de produit** (catégorie ou sous-catégorie) — croisés avec la marketplace (le site web en fait partie) et le mois, en CA HT et en
quantités, 2025 et 2026. `repartitions.js` les calcule depuis les constantes de `App.jsx` **après** le prolongement ; rien n'est écrit dans `shopify_extension.json`.

| Constante | Forme | Remarque |
|---|---|---|
| `PAYS_MONTHLY` | `[pays, marketplace, année, mois, CA HT, quantité]` | 6e élément (quantité) pour 2026 seulement ; 2025 reste à 5 éléments : pas de quantités par pays en 2025 |
| `SKU_MARQUE` | marque de chaque produit, parallèle à `SKU_PRODUIT` | d'après `data/produits_meta.json` ; `extension.js` l'étend pour chaque produit nouveau |
| `SKU_MONTHLY` | `[iProduit, iMarketplace, année, mois, CA HT, quantité]` | marque, catégorie (`PRODUCT_TO_CATEGORY`) et sous-catégorie (`SKU_SOUS_SOUS_FAMILLE`) en dérivent |

- Le prolongement ajoute la quantité des ventes Shopify aux seules lignes pays qui en portent une (`rp.length >= 6`) : une année sans quantité ne reçoit jamais de quantité partielle.
- `construireRepartitions(constantes)` renvoie un cube ; `vue`, `matrice` et `partsParMarketplace` (avec `exclure: ["France"]` pour « hors France ») en tirent le graphique, le classement et le détail ; `dispoQte` dit si
  les quantités existent pour un découpage et une année (sinon l'écran affiche le CA et le signale).
- Palette de 8 teintes (`PALETTE`), couleur fixe par entité (`COULEURS_FIXES`), « Autres » en gris (`GRIS`). Validation : `node <dataviz>/scripts/validate_palette.js "#F75212,#3F93F4,#0DAC79,#987CE9,#E66162,#00A4BA,#C28408,#DD5DA2" --mode dark`
  sur le fond #0A0908 puis #161514 ; à refaire si une teinte change.
- Après un nouvel export ODP : `node scripts/extension/preparer_repartitions.mjs <LIGNES ODP 2026.csv> [--ecrire]` (voir `INSTRUCTIONS_DEPLOIEMENT.md`).

## Garde-fous

- Boutique vérifiée à chaque extraction (`shopDomain`) : rien n'est écrit si un résultat vient de l'autre boutique. Les
  résultats sont rangés par boutique et par texte de requête.
- Chaque jour : les lignes doivent retrouver exactement le total du jour de Shopify (unités et montant) ; liste tronquée
  (3 000 lignes) refusée ; moins de 2 % des commandes sans passerelle de paiement (hors commandes à 0 €).
- Technomat : chaque commande Leroy Merlin de la fenêtre doit avoir son numéro d'origine lu (sinon code 3, rien n'est écrit ; les commandes manquantes de tous les jours sont citées d'un coup) ; préfixe inconnu ou numéro absent : laissée dans Leroy Merlin avec un avertissement. Une commande créée avant la fenêtre peut avoir une ligne dans la fenêtre (modification ou remboursement tardif) : la requête de classification ne la ramène pas, le message d'échec donne alors la requête GraphQL de lecture par nom (`orders(query:"name:SHOP1 OR name:SHOP2")`, 50 noms au plus), dont le résultat est relu comme le reste dans la transcription.
- Pas de régression : la couverture ne peut pas reculer et les jours communs avec l'extraction précédente ne peuvent pas
  varier de plus de 15 % au total (`--force` pour passer outre, en connaissance de cause).
- Les deux boutiques sont **indépendantes** : si l'une échoue, l'autre est quand même mise à jour ; l'application garde alors les
  chiffres de la veille pour la boutique en échec (`DMAX` = dernier jour couvert par les deux) et le bandeau affiche
  « Non actualisé depuis N j » à partir de 2 jours.
- Application : un nouvel export ODP qui couvre ces jours les remplace automatiquement (jours ≤ `DMAX_ODP` ignorés, sans doublon).
- Application : extraction invalide ou incohérente → socle ODP seul, bandeau d'alerte. Rien n'est affiché à moitié.
- Lecture seule, aucune donnée de client (agrégats par jour, commande, référence, pays, passerelle), `switch-shop` jamais appelé.

## Procédure (tâche planifiée du matin, 6 h 58 heure de Paris, ou lancement manuel)

Toutes les commandes se lancent depuis la racine du dépôt.

1. **Dépôt** : `add_repo` (AMSQIA / homy-pilotage, accès push), puis `git clone --depth 1 https://github.com/AMSQIA/homy-pilotage`.
2. **Contrôles** :
   ```bash
   TODAY=$(TZ=Europe/Paris date +%F)                    # à calculer UNE fois, puis à réutiliser telle quelle
   node scripts/extension/selftest.mjs                   # SELFTEST_OK attendu
   node scripts/extension/refresh_extension.mjs check --today $TODAY
   ```
3. **Marketplaces** : connecteur Shopify de Claude, outil `get-shop-info` → nom `BESTHERM` (sinon : boutique des marketplaces en
   échec, ne jamais appeler `switch-shop`). Puis
   ```bash
   node scripts/extension/refresh_extension.mjs plan --today $TODAY --boutique marketplaces
   ```
   affiche les requêtes ShopifyQL (deux par jour : ventes et paiements, plus un contrôle). `"vide": true` = déjà à jour. Lancer
   **chaque** requête avec `run-analytics-query`, **texte exact**, dans le même message. Ne rien recopier à la main : le script
   relit les résultats dans la transcription de la session (`~/.claude/projects/**.jsonl`).
   Puis la requête GraphQL de **classification** (`plan.classification.graphql`, outil `graphql_query`, texte exact, `first` = 50, puis `after` = `pageInfo.endCursor` tant que `hasNextPage` vaut `true`) : elle donne le numéro d'origine des commandes Leroy Merlin de la fenêtre (une journée ≈ 130 commandes, 3 pages), relu comme le reste dans la transcription. Aucune donnée client : seuls le nom de commande et ses attributs sont demandés. Les bornes de la requête sont des minuits de Paris écrits en UTC **entre apostrophes** (`created_at:>='2026-10-25T23:00:00Z' created_at:<'2026-10-26T23:00:00Z'` pour le 26 octobre) : la recherche de Shopify interprète de travers les dates sans apostrophes (constaté le 27 octobre 2026 : `created_at:<…+01:00` est ignoré, `created_at:>=…Z` est ramené au jour entier), ce qui ramenait des commandes de la veille et du lendemain — sans effet sur les chiffres (seules les commandes du jour sont lues), mais des pages inutiles. Ne pas reformater ces bornes. Si `apply` répond « classification Technomat incomplète » alors que toutes les pages ont été lues, ce sont des commandes créées avant la fenêtre : lancer la requête par nom que le message propose, puis relancer `apply`.
4. **Écriture** (les deux boutiques ; le site est lu par le script lui-même, par le relais) :
   ```bash
   export MCP_SITE_KEY=...        # clé du relais (variable Vercel MCP_SITE_KEY), jamais écrite dans le dépôt
   node scripts/extension/refresh_extension.mjs apply --today $TODAY
   ```
   Les lignes `AVERTISSEMENT` ne bloquent pas (références ou passerelles inconnues, pays sans traduction, marque divergente) :
   à reprendre dans le compte rendu. `--dry-run` : essai sans écriture ; `--boutique marketplaces|site` : une seule boutique ;
   `--reprendre N` : réextrait aussi les N derniers jours déjà extraits (correction tardive) ; `--du AAAA-MM-JJ` force le début. `--ordres-lm fichier.json` : numéros d'origine fournis par un fichier (objet `{"SHOP1": "014-1-A"}` ou pages GraphQL) au lieu de la transcription.
5. **Vérifications** :
   ```bash
   node scripts/extension/selftest.mjs                   # SELFTEST_OK : les chiffres de chaque onglet s'accordent
   git status --short                                    # seul shopify_extension.json peut être modifié
   npm install --no-audit --no-fund && npx vite build
   node scripts/extension/smoke.mjs                      # SMOKE_OK ; code 77 = navigateur indisponible (continuer, le signaler)
   ```
6. **Publication** : `git add shopify_extension.json`, commit (`Données Shopify : ventes du <du> au <au>`), `git fetch origin`,
   `git rebase origin/main` si besoin, `GIT_TERMINAL_PROMPT=0 git push origin main`. Vercel redéploie tout seul.
7. **Contrôle en ligne** (jusqu'à 6 minutes) : `https://homy-pilotage.vercel.app/` référence un fichier `assets/index-*.js` ;
   il doit contenir la valeur de `extrait_a` du fichier poussé.

## Après un nouvel export ODP

1. Régénérer les constantes de `App.jsx` depuis l'export (comme d'habitude) et avancer `DMAX_ODP`
   (`const DMIN = "…", DMAX_ODP = "…";` doit rester sur une seule ligne et dans ce format : le script la lit).
2. Recalculer dans le socle `kpi.nb_lignes_2026` et `gf.nb_lignes_mp` (nombre de lignes ODP, global et par marketplace) :
   ils servent au panier moyen.
3. `node scripts/extension/selftest.mjs`, puis `node scripts/extension/refresh_extension.mjs apply --du <DMAX_ODP + 1 jour>` si
   des jours sont à réextraire. Les jours déjà dans l'ODP sont écartés tout seuls : l'application reste juste même sans cette étape.
4. `data/n1_2025.json` : à reconstruire (`build_n1.mjs`) seulement si l'export 2025 change.
5. Si les constantes ont été régénérées, `PAYS_MONTHLY` n'a plus la quantité des lignes 2026 et `SKU_MARQUE` peut manquer : `node scripts/extension/preparer_repartitions.mjs <export LIGNES ODP 2026.csv> --ecrire`.

## Codes de sortie

`refresh_extension.mjs` : **0** réussi · **1** erreur d'utilisation ou de structure (`App.jsx` n'importe plus le fichier JSON,
constantes illisibles, résultat de l'extraction invalide) · **2** contrôle de cohérence échoué : rien n'est écrit (boutique
inattendue, total du jour, couverture, régression) · **3** résultats manquants (relancer exactement les requêtes ShopifyQL et GraphQL du
`plan`, même `--today`, toutes les pages) : y compris numéros d'origine des commandes Leroy Merlin non lus (classification Technomat incomplète) ; ou aucune boutique mise à jour.

`site_query.mjs` : 0 réussi · 1 erreur d'utilisation (clé absente, option inconnue) · 2 refus ou erreur du relais ou de Shopify.

`selftest.mjs` : 0 cohérent · 1 contrôle en échec. `smoke.mjs` : 0 ok · 2 échec d'affichage · 77 test impossible. `preparer_repartitions.mjs` : 0 ok · 2 erreur d'utilisation ou rapprochement impossible (rien n'est écrit).

## Limites connues

- Technomat n'est distinguée de Leroy Merlin que par le préfixe 014 du numéro d'origine de la commande : si la marketplace changeait ce format, ses commandes retomberaient dans Leroy Merlin (avertissement « préfixe connu »). Jusqu'au 3 octobre, la séparation vient de l'ODP (ligne « BRICOMAN », mêmes commandes). Pas d'objectif fiable : ni ligne du plan ni courbe.
- La marketplace est déduite de la passerelle de paiement ; `epmm`/`monechelle` sont rattachées à ManoMano et `clogistique` à
  Cdiscount (hypothèse). Une passerelle nouvelle tombe dans « Autre » tant qu'elle n'est pas ajoutée à `PASSERELLES`.
- Les références absentes du catalogue de l'application gardent leur code ; `HT15-24FERL` est rattachée à STELLINA 1500W
  (déduction, `data/produits_meta.json`).
- Le nombre de lignes de commande est estimé (règle ci-dessus ; Leroy Merlin recompte un peu moins de lignes que l'ODP) : le panier
  moyen peut s'écarter d'un à deux euros d'un recalcul complet sur un nouvel export ODP, qui le remplace.
- La coupe N-1 des 2 ans en arrière (2024) n'est plus affichée une fois l'application prolongée.
- `data/n1_2025.json` couvre octobre → décembre 2025 ; l'extension est limitée à l'année 2026 (changement d'année : mise à jour à prévoir).
