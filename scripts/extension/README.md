# Données 100 % Shopify : toute l'application, de 2024 à hier

Plus aucun fichier Excel / ODP. Chaque chiffre, courbe et tableau de l'application (KPI, courbes mensuelles et hebdomadaires,
marketplaces, marques, produits, pays, catégories, normes, prix, élasticités, paniers, plan, comparaisons avec l'année précédente)
est **recalculé au chargement** à partir des ventes des **deux boutiques Shopify**, jour par jour, de janvier 2024 à la veille.
Tous les onglets s'arrêtent au même jour, `DMAX`, et s'accordent entre eux au centime.

```
 Shopify BESTHERM (marketplaces) ─┐                                          ┌─► KPI, courbes, marketplaces, marques,
 Shopify bestherm.fr (site web) ──┼─► refresh_extension.mjs ─► shopify_extension.json ─► socle.js ─┤   produits, pays, catégories, plan, N-1…
 (chaque matin, lecture seule)    ┘   data/referentiel.json (noms, familles, objectifs) ┘  (au chargement) └─► bandeau « Données à jour »
```

| Fichier | Rôle |
|---|---|
| `shopify_extension.json` | **Toutes les ventes** des deux boutiques : une ligne par jour × marketplace × produit (toutes les années), plus le détail par pays et les commandes (depuis l'année précédente) et les paires de produits (année en cours). **Seul fichier écrit par l'actualisation quotidienne.** |
| `socle.js` | Moteur de calcul pur, utilisé par `App.jsx` au chargement : recalcule les 22 constantes du tableau de bord à partir de l'extraction et de la table de référence. Atomique : au moindre problème il ne construit rien et l'application affiche un écran d'erreur (jamais un tableau à moitié juste) |
| `data/referentiel.json` | Table de référence, **sans aucune vente** : nom, marque de secours, norme NF/CE, famille et sous-familles de chaque produit, correspondance référence (SKU) et titre Shopify → produit, passerelle de paiement → marketplace, objectifs du plan (annuel et par marketplace) |
| `data/hors_shopify.json` | Chiffres qui n'existent pas dans Shopify (publicité par marketplace et par pays), conservés tels quels |
| `scripts/extension/refresh_extension.mjs` | Commandes `check`, `plan`, `apply`, `status` : fenêtres de dates, collecte, contrôles, fusion, écriture |
| `scripts/extension/transformer.mjs` | Transformation pure des résultats ShopifyQL en agrégats quotidiens, et tous les contrôles de cohérence |
| `scripts/extension/collecte.mjs` | Sources des résultats : relais (script), transcription du connecteur Shopify de Claude, fichiers |
| `scripts/extension/site_query.mjs` | Client du relais en lecture seule `api/mcp-site.mjs` (les deux boutiques) |
| `scripts/extension/selftest.mjs` | Contrôle de cohérence de tout le tableau de bord sur les vraies données (`selftest_socle.mjs` : moteur sur un jeu fictif aux résultats connus ; `selftest_pipeline.mjs` : chaîne d'extraction sur des résultats ShopifyQL synthétiques, ligne de commande comprise) |
| `scripts/extension/smoke.mjs` | Test d'affichage sur le build (`dist/`) dans Chromium |
| `scripts/extension/test_mcp_site.mjs` | Test du relais (Shopify simulé, sans réseau) ; ne fait pas partie de l'actualisation du matin |

`App.jsx` n'est jamais modifié par l'actualisation quotidienne : pas de conflit avec les envois manuels, un commit de quelques centaines de ko par jour.

## Règles de calcul

| Élément | Règle |
|---|---|
| CA HT marketplaces (BESTHERM) | **(ventes nettes + taxes) ÷ 1,2**, ligne par ligne (lignes `product` et `sale_adjustment`). Les ventes nettes sont celles de Shopify : remises déduites, retours déduits **à la date du retour** |
| CA HT site web (bestherm.fr) | **Ventes nettes** (déjà hors taxes, remises et retours déduits) : égales au chiffre « Ventes nettes » du tableau de bord Shopify, exactement |
| Port | Les lignes de port (`shipping`) n'ont aucune vente nette (seulement de la TVA) : non comptées. La ligne « Livraison » de l'application correspond aux lignes produit de référence `SHOPIFYSHIPPINGPRODUCT` |
| Retours et ajustements | Un remboursement est une ligne négative à la date du remboursement. Un `sale_adjustment` (correction sans produit) est rattaché aux lignes remboursées de la même commande, au prorata ; à défaut à toutes ses lignes ; à défaut au produit technique « Ajustements Shopify » : le total de chaque jour égale celui de Shopify |
| Marketplace d'une commande | Passerelle de paiement de la commande (jeu `payments`, passerelle au plus gros montant ; `… via Shopping Feed` retiré), traduite par `passerelles` de `data/referentiel.json` : `leroymerlin` → Leroy Merlin (**Bricoman n'est pas séparable dans Shopify : ses ventes sont comptées dans Leroy Merlin**), `amazon`, `amazon fba`, `amazon prime` → Amazon FR, `epmm`, `monechelle`, `manomano`, `manomanopro` → ManoMano, `cdiscount`, `clogistique` → Cdiscount, `maxeda` → Maxeda, `castoramafr` → Castorama, `bricomarche` → Bricomarché, `dartybomp`, `darty` → Darty, `boulanger` → Boulanger, `bricobravo` → Brico Bravo, `but` → But, `worten` → Worten, `bol` → Bol.com. Toute autre passerelle (Fnac, Carrefour, Leclerc, PriceMinister, bricodepotes, vente-unique, ubaldi, `manual` : ≈ 0,5 % des paiements de BESTHERM) et les commandes à 0 € sans paiement (envois de remplacement) → « Autre » (avertissement avec la liste) |
| Site web | Marketplace « Site Web » (boutique bestherm.fr) |
| Produits | Référence Shopify normalisée (`_never_used` et `-FLM` retirés, `/` → `-`) → produit de la table (`skus`) ; sans référence reconnue : titre Shopify normalisé (`titres`) ; à défaut le titre lui-même (produit nouveau, à ajouter à la table : avertissement) |
| Marque | Celle du **fournisseur Shopify** (`product_vendor` : Bestherm, Thomson, HOM'Y), la plus fréquente par produit ; à défaut la marque de la table |
| Famille, norme NF/CE, catégories | Table de référence (Shopify ne les porte pas) |
| Pays | Noms Shopify (anglais) traduits en français ; pays inconnu conservé tel quel (avertissement) |
| Commandes, panier moyen | Une commande compte si son CA est > 0 (ni les 0 €, ni les remboursements seuls). **Panier moyen = CA HT ÷ commandes** (par marketplace aussi) : c'est le vrai panier par commande |
| Jours, semaines | Jours de Paris, jours complets seulement (jusqu'à hier) ; semaines Excel (dimanche → samedi, semaine 1 = celle du 1er janvier) ; la première (partielle) et la semaine en cours sont exclues des élasticités |
| Comparaison N-1 | Mois entiers de l'année précédente avant le mois en cours + coupe du 1er du mois en cours au même jour de l'année précédente, lues dans les mêmes lignes quotidiennes |
| Classes ABC | Par chiffre d'affaires de l'année : A jusqu'à 50 % du CA cumulé, B jusqu'à 80 %, C jusqu'à 98 %, D le reste, NC sans vente (l'ancienne classe ODP, issue des entrepôts, n'est pas reproductible) |
| Élasticité-prix | Régression log-log hebdomadaire (quantité ~ prix moyen) par produit × marketplace sur les semaines complètes de l'année : 4 semaines et 2 % d'écart de prix au minimum ; « fiable » à partir de 8 semaines, R² ≥ 0,25 et 5 % d'écart de prix |
| Saisonnalité | Poids de chaque mois dans le CA des deux années complètes précédentes (indice moyen = 1) |
| `DMAX` | Plus ancienne des deux couvertures : si une boutique n'est pas à jour, tout l'écran s'arrête au dernier jour couvert par les deux |

**Ce qui ne vient pas de Shopify** (conservé tel quel, repéré comme tel dans l'application) : publicité (`data/hors_shopify.json`),
concurrence et catalogue des produits non vendus (constantes de `App.jsx`), **objectifs du plan** (annuel, par marketplace, par
pays, par semaine : `data/referentiel.json` et `App.jsx`), famille / norme / catégorie des produits (`data/referentiel.json`).
Ces éléments se mettent à jour à la main quand le plan ou le catalogue change.

**Affichage allégé (17 octobre 2026, « garde l'essentiel »)** : les explications ci-dessus (règles de calcul, limites, ce qui ne vient pas de
Shopify) ne s'affichent plus sur l'écran — elles restent décrites ici. Le bloc « Données à jour » garde son graphique du CA par jour
(ouvert par défaut, un clic sur l'en-tête le replie ; pastille « Non actualisé depuis N j » à partir de 2 jours) mais plus ses notes
explicatives, et les sous-titres et notes de méthode sous les graphiques sont masqués ;
les avertissements d'extraction (produit absent du référentiel, ligne hors période, passerelle inconnue) ne sont plus affichés : la tâche du
matin les lit dans sa sortie et les traite (voir la procédure). Interrupteur : `const SOUS_INFOS = false;` dans `App.jsx` (à `true`, tout
revient, y compris les notes du bloc « Données à jour »). Le top des produits, le « % obj. » par pays et les comparaisons « vs 2025 » sont conservés.

## Suivi quotidien (premier bloc de la Vue d'ensemble)

Le bloc « Données à jour » est un suivi du quotidien : puces de période (`7 j · 14 j · 30 j · 90 j`), CA HT de la période avec sa variation par rapport aux mêmes dates de
l'an dernier, histogramme par jour (marketplaces + site web) avec la courbe pointillée de l'an dernier, top 10 des produits et part du CA par pays — sur la
période ou, en touchant une barre, sur ce seul jour. Il suit le filtre marketplace global. `suiviDonnees()` dans `App.jsx` lit `shopify_extension.json` (schéma 2 : lignes jour × marketplace × produit, et `pays_jour` pour les pays) : les mêmes jours de l'an dernier sont lus dans le même historique, au même format, avec le même calcul.

**« Donnée comparable »** : l'an dernier = les mêmes dates calendaires un an plus tôt (29 févr. → 28 févr.). Jamais de variation calculée sur une base incomplète : le site web n'existe dans Shopify que depuis sa première vente (fin mai 2025) ; pour une période dont l'an dernier commence avant cette date, la comparaison se fait sur les **marketplaces seules** (légende « 2025 · marketplaces », mention « Δ marketplaces » au-dessus du top 10, pas de variation pour le site web) ; si l'historique ne remonte pas assez loin, aucune comparaison. Les variations par pays sont des écarts de part du CA, en points.

Ces affichages ne reposent sur aucun fichier de plus : tout est recalculé au chargement à partir des lignes ci-dessus. `smoke.mjs` en contrôle les chiffres
contre un calcul indépendant fait dans le test.

## Garde-fous

- Boutique vérifiée à chaque extraction (`shopDomain`) : rien n'est écrit si un résultat vient de l'autre boutique. Les résultats sont
  rangés par boutique et par texte de requête.
- **Chaque jour** : les lignes doivent retrouver exactement le total du jour de Shopify (unités, ventes nettes, taxes) ; liste tronquée
  (10 000 lignes) : la fenêtre est coupée en deux et relue ; moins de 2 % des commandes sans passerelle de paiement (hors commandes à 0 €).
- Pas de régression : la couverture ne peut pas reculer et les jours communs avec l'extraction précédente ne peuvent pas varier de plus de
  15 % au total (`--force` pour passer outre, en connaissance de cause).
- Les deux boutiques sont **indépendantes** : si l'une échoue, l'autre est quand même mise à jour ; l'application garde alors les chiffres de la
  veille pour la boutique en échec (`DMAX` = dernier jour couvert par les deux) et le bandeau affiche « Non actualisé depuis N j » à partir de
  2 jours. Exception : à la première extraction (rien de couvert), l'échec d'une boutique interdit toute écriture.
- Le tableau de bord est reconstruit comme l'application le fera avant d'écrire : un échec de `socle.js` interdit l'écriture ; l'écriture est
  atomique (fichier temporaire puis renommage).
- Application : extraction invalide ou incohérente → écran d'erreur explicite, rien n'est affiché à moitié.
- Lecture seule, aucune donnée de client (agrégats par jour, commande, référence, pays, passerelle), `switch-shop` jamais appelé.

## Procédure (tâche planifiée du matin, 6 h 58 heure de Paris, ou lancement manuel)

Toutes les commandes se lancent depuis la racine du dépôt.

1. **Dépôt** : `add_repo` (AMSQIA / homy-pilotage, accès push), puis `git clone --depth 1 https://github.com/AMSQIA/homy-pilotage`.
2. **Contrôles** :
   ```bash
   export MCP_SITE_KEY=...                               # clé du relais (variable Vercel MCP_SITE_KEY), jamais écrite dans le dépôt
   TODAY=$(TZ=Europe/Paris date +%F)                    # à calculer UNE fois, puis à réutiliser telle quelle
   node scripts/extension/selftest.mjs                   # SELFTEST_OK attendu
   node scripts/extension/refresh_extension.mjs check --today $TODAY
   ```
   `check` indique, pour chaque boutique, la couverture actuelle et la fenêtre du jour, si le relais répond (`OK · relais … : joignable`), et
   reconstruit le tableau de bord. Une ligne `AVERTISSEMENT · relais site indisponible` annonce un échec de la boutique du site.
3. **Marketplaces — seulement si `check` annonce `INFO · relais marketplaces indisponible`** (relais pas encore configuré pour BESTHERM ;
   sinon passer à l'étape 4, le script lit BESTHERM lui-même). Connecteur Shopify de Claude, outil `get-shop-info` → nom `BESTHERM`
   (sinon : boutique des marketplaces en échec, ne jamais appeler `switch-shop`). Puis
   ```bash
   node scripts/extension/refresh_extension.mjs plan --today $TODAY --boutique marketplaces
   ```
   affiche les requêtes ShopifyQL (une fenêtre de 14 jours = ventes, paiements, contrôle). `"vide": true` = déjà à jour. Lancer **chaque**
   requête avec `run-analytics-query`, **texte exact**, dans le même message ; ne rien recopier à la main : le script relit les résultats dans
   la transcription de la session (`~/.claude/projects/**.jsonl`). Ce repli ne sert que pour quelques jours : l'historique complet
   (plus de 140 requêtes) passe obligatoirement par le relais.
4. **Écriture** (les deux boutiques ; le script les lit lui-même par le relais) :
   ```bash
   node scripts/extension/refresh_extension.mjs apply --today $TODAY
   ```
   Par défaut la fenêtre va du dernier jour déjà extrait (repris : corrections tardives) à hier ; sans fichier valide, tout l'historique de
   chaque boutique est extrait (BESTHERM depuis 2024-01-01, le site depuis 2025-05-01). Les lignes `AVERTISSEMENT` ne bloquent pas
   (références ou passerelles inconnues, pays sans traduction) : à reprendre dans le compte rendu et à corriger dans
   `data/referentiel.json` (voir plus bas). Options : `--dry-run` (essai sans écriture), `--boutique marketplaces|site`, `--reprendre N` (jours
   déjà extraits repris, 0 = aucun, défaut 1), `--du` / `--au AAAA-MM-JJ` (forcer la fenêtre), `--cache dossier` (résultats du relais conservés :
   une reprise ne relit pas ce qui a réussi), `--concurrence N`, `--results fichier.json` (résultats ShopifyQL déjà obtenus),
   `--transcript fichier.jsonl`, `--out fichier.json`, `--force`.
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

### Reconstruire tout l'historique (rarement)

Supprimer `shopify_extension.json` (ou lancer `apply --du 2024-01-01 --boutique marketplaces`), puis `apply --cache <dossier>` : BESTHERM depuis
2024-01-01 (≈ 47 fenêtres de 14 jours × 3 requêtes), le site depuis 2025-05-01. Le cache permet de reprendre après une interruption sans tout relire.

### Ajouter une référence, un titre, une passerelle, un produit

Un avertissement `Produits absents de la table de référence` donne le nom et le code Shopify : ajouter la référence dans
`data/referentiel.json` › `skus` (code en majuscules → nom du produit), éventuellement le produit dans `produits` (marque de secours, norme,
famille, sous-familles, catégorie, indicateurs) ; pour une ligne sans référence, le titre normalisé dans `titres`. Un avertissement
`Passerelles de paiement inconnues` : ajouter la passerelle (minuscules, sans « via Shopping Feed ») dans `passerelles`. Puis relancer
`apply --du <premier jour concerné>` : les jours repris sont remplacés, jamais doublés. `selftest.mjs` refuse la publication si plus de
3 % du CA de l'année porte sur des produits absents de la table, ou plus de 10 % sur « Autre ».

## Codes de sortie

`refresh_extension.mjs` : **0** réussi · **1** erreur d'utilisation ou de structure (option inconnue, table de référence illisible, résultat
invalide) · **2** contrôle de cohérence échoué : rien n'est écrit (boutique inattendue, total du jour, couverture, régression, tableau de bord non
constructible) · **3** résultats ShopifyQL manquants (relancer exactement les requêtes du `plan`, même `--today`), aucune boutique mise à jour, ou
boutique en échec sans extraction antérieure.

`site_query.mjs` : 0 réussi · 1 erreur d'utilisation (clé absente, option inconnue) · 2 refus ou erreur du relais ou de Shopify.

`selftest.mjs` : 0 cohérent · 1 contrôle en échec. `smoke.mjs` : 0 ok · 2 échec d'affichage · 77 test impossible.

## Limites connues

- **Historique du site web** : la boutique bestherm.fr n'existe dans Shopify que depuis mai 2025 ; les ventes du site antérieures n'y sont pas.
  Le site s'affiche donc sur une période plus courte que les marketplaces, et la comparaison N-1 du site n'est pas homogène avant 2026.
- Bricoman n'est pas séparable de Leroy Merlin dans Shopify : ses ventes sont comptées dans Leroy Merlin sur toute la période.
- La marketplace est déduite de la passerelle de paiement ; `epmm` / `monechelle` sont rattachées à ManoMano et `clogistique` à Cdiscount
  (hypothèse). Une passerelle nouvelle tombe dans « Autre » tant qu'elle n'est pas ajoutée à `passerelles`.
- Un retour est compté à la date du remboursement (comme le tableau de bord Shopify), pas à la date de la commande d'origine : un mois peut être
  réduit par des retours de commandes plus anciennes.
- Le jeu `payments` donne la passerelle ; une commande payée par deux passerelles est classée selon la plus importante (signalé).
- Les marques viennent du fournisseur Shopify : un produit livré par un autre fournisseur change de marque dans les courbes.
- Les classes ABC sont recalculées sur le CA (pas sur la classe des entrepôts de l'ODP) ; l'élasticité exclut la première semaine, partielle.
- Plan, concurrence, publicité, catalogue des produits non vendus, famille / norme / catégorie : voir « Ce qui ne vient pas de Shopify ».
- **Changement d'année** (début 2027) : `socle.js` ignore les lignes postérieures au 31 décembre de l'année en cours (avertissement) ; passer
  `AN_DEFAUT` à l'année suivante, renouveler les objectifs (`data/referentiel.json`, `OBJECTIF_2026` et les libellés « 2026 » de `App.jsx`) et
  conserver l'historique : à prévoir avant le 1er janvier.
