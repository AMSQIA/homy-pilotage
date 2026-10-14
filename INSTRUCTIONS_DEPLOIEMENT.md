# HOM'Y Pilotage — instructions et notes de mise à jour

## Mise à jour du 14 octobre 2026 (soir) — Flash Shopify actualisé chaque matin

Le bloc « Flash Shopify » (haut de l'onglet « Vue d'ensemble », avec « Toutes marketplaces ») est désormais **recalculé
chaque matin** par une tâche planifiée, et exprimé sur la **même base que l'Excel**.

| Indicateur (4 → 13 octobre 2026) | Valeur |
|---|---|
| CA HT comparable | **474 788 €** = (ventes nettes + taxes) ÷ 1,2 |
| Commandes / unités | 2 851 / 4 826 |
| Panier moyen | 167 € |
| Évolution vs mêmes dates 2025 | **+15,3 %** (411 651 € mesurés dans Shopify 2025, même convention) |
| Cumul 2026 estimé | **7,98 M€**, soit 53,2 % de l'objectif de 15 M€ (fichier ODP au 3 octobre + flash, site web non inclus depuis le 4) |
| Contrôle ODP, 20/09 → 03/10 | Shopify 524 070 € contre 524 086 € dans l'ODP hors site web (écart de 16 €) |

- **Pourquoi « HT comparable »** : la version précédente affichait les ventes nettes Shopify, qui restent en TTC pour les
  commandes sans taxe enregistrée (surévaluation d'environ 2 %). Sur la base HT comparable, Shopify et l'ODP concordent à
  16 € près sur les deux dernières semaines complètes.
- **N-1** : mesuré dans Shopify (mêmes dates calendaires 2025) et non plus dans l'Excel : même périmètre, même convention.
- **Données** : fichier `shopify_flash.json` (importé par `App.jsx`), écrit uniquement par `scripts/flash/refresh_flash.mjs`.
  `App.jsx` n'est jamais modifié par l'actualisation quotidienne. Détail et procédure : `scripts/flash/README.md`.
- **Bloc à part** : les KPI, courbes, plan, estimations et autres onglets restent calculés sur le fichier ODP (site web
  compris, jusqu'au 3 octobre). Ils ne bougent qu'avec un nouvel export ODP. La boutique Shopify du site web n'est pas
  lisible en même temps que BESTHERM.
- **Garde-fous** : boutique vérifiée à chaque extraction, couverture des listes contrôlée, pas de régression, contrôle
  d'écart avec l'ODP (refus d'écrire au-delà de 8 %). Dans l'application : les jours déjà couverts par l'ODP sont ignorés
  (pas de doublon après une mise à jour de l'ODP), et une pastille « Non actualisé depuis N j » apparaît après 2 jours.
- **Après un nouvel export ODP** : relancer l'actualisation le jour même (étapes 3 à 8 du README) ; sinon les listes
  pays et produits restent masquées jusqu'au lendemain matin.

## Contenu du dépôt

- `App.jsx` — ventes du 1er janvier au **03/10/2026** (fin de la semaine Excel 40), plan 2026 (15 M€) intégré, plus le
  composant « Flash Shopify ».
- `shopify_flash.json` — données du bloc « Flash Shopify », actualisées chaque matin.
- `scripts/flash/` — script d'actualisation, auto-test, test d'affichage et mode d'emploi (`README.md`).
- `api/chat.mjs` — relais de l'assistant IA (le texte de contexte indique maintenant le 3 octobre comme dernière donnée).

## Mise en ligne

Un commit sur `main` suffit : Vercel redéploie tout seul. Le dossier `api` est au même niveau que
`App.jsx` (pas dans `src`).

## Activer l'assistant IA (une seule fois)

Sans clé, l'app marche normalement en « mode local » (réponses rapides calculées
dans l'app). Pour brancher l'assistant IA :

1. vercel.com → projet `homy-pilotage` → **Settings** → **Environment Variables**
2. Ajoute `ANTHROPIC_API_KEY` avec **ta** clé API (ne la colle jamais dans le code,
   dans GitHub ni dans une conversation). Coche Production, Preview, Development.
3. **Save**, puis **Deployments** → `⋯` sur le dernier déploiement → **Redeploy**
   (Vercel n'applique pas une variable à un déploiement déjà en ligne).
4. Vérifie : ouvre `https://homy-pilotage.vercel.app/api/chat`. Tu dois lire
   `{"ok":true,"configured":true,"model":"claude-sonnet-5-5"}`.
   `"configured":false` = variable absente, ou pas de redéploiement depuis.

Optionnel : la variable `ANTHROPIC_MODEL` permet de changer de modèle sans toucher au code
(par défaut `claude-sonnet-5-5`).

## Fichiers inutiles à supprimer du dépôt (facultatif)

`api/login.mjs`, `api/data.mjs` et `api/_data.json` viennent d'une ancienne
architecture : l'app actuelle ne s'en sert pas (les données sont dans `App.jsx`
et le mot de passe est vérifié dans le navigateur). `_data.json` est de plus un
instantané périmé (12 septembre).

## Ce qui change dans cette mise à jour (12 octobre, après-midi)

### Le fichier reçu : « Lignes ODP » jusqu'à la semaine 40

Onglet « Lignes ODP » du classeur `DASHBOARD_ONLINE … TEST_2` : 74 632 lignes de commande du
01/01 au **03/10/2026** (dimanche 27/09 → samedi 03/10 = semaine 40). Il contient toutes les lignes
déjà présentes dans l'app, plus les ventes du 20/09 au 03/10 : l'app est recalculée à partir de lui
(2024 et 2025 inchangés).

**Colonne Date contrôlée** sur les 74 632 lignes :

- aucun écart avec les colonnes Mois, Année et Semaine du fichier (semaines Excel, dimanche → samedi) ;
- cohérente avec les dates codées dans les numéros de commande : Leroy Merlin (29 843 lignes) aucune date
  antérieure à la commande, 98,8 % expédiées sous 20 jours ; ManoMano (5 070 lignes) même mois que la commande
  pour 5 062 lignes, mois suivant pour 8.

**Écarts avec la version précédente (données au 19/09)**

- 5 181 lignes nouvelles du 20/09 au 03/10 : 586 498 € HT, 6 452 unités ;
- 36 lignes de septembre arrivées tardivement dans le fichier (31 Amazon FR, 3 « Autre », 2 ManoMano) : +3 914 € ;
- 78 lignes du 17 au 19/09 (9 040 €) reclassées de « Autre » vers « Site Web » ;
- janvier → août : inchangés (seuls 2 montants ManoMano de février et d'avril bougent de 0,03 €, arrondi du fichier).

### Effet sur les chiffres

| Indicateur | Avant (19/09) | Après (03/10) |
|---|---|---|
| CA HT 2026 à date | 6 918 912,94 € | **7 509 325,69 €** |
| Unités vendues | 74 294 | **80 787** |
| Lignes de commande | 69 415 | 74 632 |
| Panier moyen | 99,67 € | 100,62 € |
| Part de l'objectif annuel (15 M€) | 46,13 % | **50,06 %** |
| Plan cumulé attendu à date | 7 326 532 € (S38, 48,8 %) | 8 274 406 € (S40, 55,2 %) |
| Écart au plan | −2,7 pt | **−5,1 pt** |
| Évolution à période comparable | +49,4 % | **+40,2 %** (5 356 876 € en 2025 à la même date) |
| Septembre 2026 | 607 675 € (19 jours) | 1 065 772 € (mois complet, −9,4 % vs sept. 2025) |
| Octobre 2026 à date (1er–3) | — | 132 316 € |
| Semaine 40 (27/09 → 03/10) | — | 333 274 € · 3 700 u. (≈ 70 % de l'objectif hebdomadaire de 479 k€) |

L'évolution à période comparable baisse parce que les deux dernières semaines 2026 (590 k€) sont environ
19 % sous la même période 2025 (727 k€, début de saison de chauffe 2025 très fort).
L'écart au plan se creuse pour la même raison : le plan prévoit ≈ 474 k€ par semaine sur ces deux semaines.

Tout ce qui dérive des lignes de commande a été recalculé : KPI, courbes mensuelles et hebdomadaires (jusqu'à S40),
marques, marketplaces, catégories, pays, suivi des prix, classement ABC, paniers (60 paires), élasticité,
tableau « simulation d'une hausse de +5 % » (il reposait sur un calcul d'élasticité plus ancien : il est maintenant
régénéré avec la règle documentée).

### Catalogue et référentiels

- 3 produits vendus pour la première fois : STELLINA 1000W, STELLINA 2000W, SORIA 500W (retirés de la liste
  « catalogue non vendu », 41 → 38).
- SKU techniques rapprochés : filtre à charbon, livraison Shopify, variantes `_never_used` (HESTIA 500W BLANC).
- 2 nouveaux pays dans les ventes : Estonie, « Canaries, îles » (traductions ajoutées).

### Fenêtres de calcul qui ne sont plus figées

Plusieurs calculs reposaient sur des mois écrits en dur ; ils suivent maintenant la date de la dernière donnée :

- **Estimation de fin d'année** : croissance du cumul (janvier → septembre) et croissance récente (moyenne des
  3 derniers mois entiers, juillet → septembre) appliquées à octobre–décembre 2025 ; le mois en cours (octobre, 3 jours)
  est anticipé comme un mois entier. Résultat **13,9 – 14,2 M€** (92 – 95 % de l'objectif). Avec les anciennes
  fenêtres figées (janvier → août, juin → août), le même calcul aurait donné 14,6 – 16,4 M€ : septembre complet
  (−9,4 % vs 2025) pèse maintenant dans la croissance récente.
- **Cycle de vie produit** : comparaison sur les 3 derniers mois entiers (juillet → septembre).
- Textes et coupes N-1 (« 1er au 3 octobre 2025 », libellés des périodes) alignés sur le 03/10.

### À savoir

- Données publicitaires : le fichier « Dépenses budget marketing 2026 – year to date » ne contient des dépenses
  que de janvier à juin ; les % de budget consommé restent sous-estimés (mention dans l'onglet Campagnes Ads).
- Deux lignes ManoMano (19/02 et 22/04, ARIA 1000W) n'ont pas de SKU dans le fichier : elles sont rattachées à
  ARIA 1000W (SKU HT10PDC). Celle du 22/04 (123,27 € pour 1 unité) vaut environ le double du prix habituel sur
  ManoMano : si c'est une erreur de saisie, à corriger dans la source.

---

## Rappel — mise à jour du 12 octobre (matin)

Le fichier « Lignes ODP (4) » s'arrêtait au 15/08/2026 alors que l'app contenait déjà les ventes jusqu'au 19/09 :
fusion sans perte (l'app garde tout, on y ajoute ce que le fichier contient en plus), 59 296 lignes identiques
du 01/01 au 15/08, 2 lignes ManoMano ajoutées (voir ci-dessus).

---

## Rappel — mise à jour du 7 octobre 2026

À cette date, les ventes allaient jusqu'au 19/09/2026 et les comparaisons ont été remises à la **même période**
(1er janvier → même jour) :

| Indicateur | Avant le 7 oct. | Au 7 oct. |
|---|---|---|
| CA 2025 année complète | 9 599 287 € | 9 782 582 € (Bricomarché +134 329 € et lignes non rapprochées reprises) |
| CA 2025 du 1er janv. au 19 sept. | 4 638 940 € | 4 630 298 € |
| Évolution du CA total | +49,1 % | **+49,4 %** |
| ARIA 1000W (meilleur produit) | −31 % (2026 à date vs 2025 année entière) | **+32,1 %** (même période) |
| Bestherm | −36 % (idem) | **+27,5 %** |
| Thomson | +141,5 % (idem) | +2 818 % — base 2025 de 35 255 € seulement (marque lancée mi-2025), non significatif |
| Septembre à date (19 jours) | −48 % | **+0,8 %** (607 675 € vs 603 035 €) |
| Catégories couvertes | 77,8 % du CA | 100 % |

Toutes les évolutions (total, marketplaces, marques, produits, export Excel, assistant IA)
comparent 2026 à la **même période** de 2025. L'année 2025 complète reste affichée à part quand c'est utile.

### Plan 2026

- Objectif annuel 15 000 000 € HT, plan mensuel et hebdomadaire (52 semaines Excel, dimanche → samedi).
- Plan cumulé attendu au 19/09 (S38) : 7 326 532 € = 48,8 % de l'objectif annuel ; réalisé 46,1 % → **−2,7 pt**.
- Semaine S38 (13 → 19 sept.) : 232 556 € pour un objectif de 441 647 € (53 %).
- Les objectifs par marketplace (Σ 14,47 M€) et par pays (Σ 15,08 M€) ne se somment pas à 15 M€ :
  laissés tels quels, à rapprocher avec l'équipe.

### À savoir

- « Autre » : son évolution (−30 %) n'est pas interprétable (des canaux récents ont pu y être classés).
- Le bouton « Voir le détail dans Supply » (onglet supprimé, il ouvrait une page vide) a été retiré.
