# HOM'Y Pilotage — instructions et notes de mise à jour

## Mise à jour du 24 octobre 2026 (soir) — navigation mobile allégée et figée, version Shopify seul

**Demande** : « La barre de navigation est insupportable sur mobile, peux-tu optimiser et figer. » Même changement que sur l'application en ligne (version ODP + prolongement Shopify), reporté ici pour que la version Shopify seul
contienne tout ce qui est en ligne au moment de la bascule. Il ne touche **aucune donnée ni aucun calcul** : seuls l'habillage de l'écran, `index.html` et le test d'affichage changent.

**Constat** : sur téléphone, rien n'était réellement figé, et les barres prenaient trop de place. Trois causes :

1. le conteneur de l'application portait `overflow-x-hidden` : un élément `sticky` se colle alors au plus proche ancêtre qui masque le débordement, ici un conteneur qui ne défile pas ; l'en-tête partait donc avec la page ;
2. la classe `.liquid-glass` impose `position: relative; overflow: hidden` et annulait le `fixed` de la barre du bas : elle défilait avec le contenu ;
3. la bande des filtres était calée à une hauteur écrite en dur (`top: 57`), fausse dès que l'en-tête changeait de hauteur (bandeau de démonstration, filtres sur deux lignes).

**Ce qui change** (téléphone, moins de 768 px ; **ordinateur et tablette inchangés**, l'en-tête et la bande de filtres d'origine restent comme avant) :

- **Barre du haut figée, une seule ligne de 53 px** : logo (touche « remonter en haut »), puce **Période**, puce **Marketplace** (quand une marketplace est choisie, la puce prend la couleur de la marketplace et une croix remplace la flèche pour revenir à « Toutes ») ;
  les dates personnalisées passent sur une ligne à part, seulement quand on choisit « Personnalisé ».
  Les puces sont de vrais menus natifs (roue sur iPhone, liste sur Android) posés en transparence sur la puce, en police de 16 px : iPhone ne zoome plus sur la page à l'ouverture d'un menu.
  Le bandeau du mode démonstration est dans le même bloc figé, au-dessus de la barre.
- **Barre du bas réellement fixe** (`position: fixed`, 57 px) : les sept onglets restent à portée de pouce ; **l'onglet actif s'élargit et affiche son nom court** (Aperçu · Marketplaces · Marques · Prix · Ads · Concurrence · Data, et leurs équivalents en anglais, espagnol et chinois) ; marge de sécurité `env(safe-area-inset-bottom)` pour les iPhone sans bouton ;
  elle se retire pendant la saisie dans un champ de texte (le clavier ne la remonte plus au milieu de l'écran) et revient ensuite. Le bas de page garde de la marge pour que rien ne passe dessous.
- **Sous-onglets** (Marques › Marque · Répartitions · Produits…, Concurrence) : une seule ligne qui défile sur le côté au lieu de plusieurs lignes empilées ; la bande se **fige sous la barre du haut** en prenant sa position réelle (variable CSS `--barre-haut`, mesurée à l'écran : elle suit le bandeau de démonstration ou un changement de hauteur) et prend un fond opaque dès qu'elle est collée.
- **Changer d'onglet remet la page en haut** (sauf à l'ouverture) ; **toucher l'onglet déjà actif remonte en douceur**.
- **Suivi Prix** : le champ de recherche du simulateur ne prend plus le focus à l'ouverture (il ouvrait le clavier et faisait sauter la page, et la barre du bas disparaissait aussitôt).
- `index.html` : `theme-color` (#0A0908) pour que la barre d'état du navigateur prenne la couleur de l'application.

**Fichiers** : `App.jsx` (composants `BarreMobile`, `PuceFiltre`, `BottomTabBar`, `SousOnglets` ; `app-racine` remplace `overflow-x-hidden` par `overflow-x: clip` avec repli `hidden`), `index.html`, `scripts/extension/smoke.mjs`. Aucun autre fichier touché.

**Tests** : `node scripts/extension/smoke.mjs --navigation` ne lance que ce contrôle (lancé aussi dans l'exécution complète) : à 390 et 360 px, les deux barres restent à leur place avant et après un long défilement
(haut collé à 0, bas collé au bord de l'écran, au moins 80 % de l'écran laissé au contenu) ; les sept onglets (un seul actif, nom court affiché, page remontée, aucun débordement horizontal) ; un appui sur l'onglet actif remonte la page ; les puces de période et de marketplace
(valeurs, croix, dates personnalisées) ; les sous-onglets de Marques et de Concurrence (une ligne, figés sous la barre du haut) ; saisie (barre du bas retirée puis rétablie), mode démonstration, aucun champ qui prend le focus sur Suivi Prix ; les quatre langues (libellés complets pour l'accessibilité, nom court de l'onglet actif, puce « Toutes ») ;
et, à 768 px et plus, la disposition d'origine (barres mobiles absentes). Ce contrôle échoue bien lorsqu'on réintroduit les défauts d'origine (vérifié sur la version en ligne).

**Pistes, si besoin** : figer aussi l'en-tête sur ordinateur (il défile toujours avec la page, comme avant) ; passer à 16 px les champs de saisie des autres onglets (le simulateur de prix, par exemple), car iPhone zoome sur la page à l'ouverture d'un champ plus petit.

## Mise à jour du 24 octobre 2026 — onglet Marques › Répartitions (pays, marque, type de produit × mois × marketplace), version Shopify seul

**Demande** : placer sur la page Marques, « à l'endroit le plus pertinent » et « comme un vrai visual data manager » : (1) le CA et les quantités par pays, par mois et par
marketplace et site web ; (2) la répartition du CA et des quantités entre Bestherm et Thomson, par mois et par marketplace ; (3) la répartition par type de produit, avec le CA et les
quantités par mois et par marketplace. L'écran est en ligne depuis le 24 octobre sur la version actuelle (calculée sur l'ODP) ; cette section le reporte sur la version Shopify seul pour
que le passage à Shopify seul n'en perde rien.

**Où** : nouveau sous-onglet **Marques › Répartitions** (entre « Marque » et « Produits » ; adresse directe `?tab=marques&sousTab=repartitions`), plus un lien « Détail par mois et par
marketplace » sous le graphique de l'onglet « Marque ». Les trois demandes sont trois découpages du même cube (entité × marketplace × mois) : elles se lisent de la même façon, dans un
seul écran, et l'onglet « Marque » reste léger (« garde l'essentiel »).

**Ce que l'écran montre**

- **Commandes** : découpage (Pays | Marque | Type de produit, avec Catégorie | Sous-catégorie), mesure (CA HT | Quantités), année (2026 | 2025) ; « Hors France » pour le découpage par pays
  (la France pèse l'essentiel du CA : sans ce bouton, les autres marchés sont des filets illisibles).
- **Évolution mensuelle** : histogramme empilé en valeurs ou en parts de 100 % ; six entités tracées une à une, le reste regroupé en « Autres (n) » en gris ; bulle (mois, total, montant et part
  de chaque entité) ; légende cliquable ; vue « Tableau » équivalente ; mois en cours estompé et signalé.
- **Classement** : CA, quantités et part de chaque entité, trié par la mesure choisie ; toucher une ligne isole l'entité dans le détail.
- **Détail par marketplace et par mois** : montant (carte de chaleur à une seule teinte) ou **part de l'entité dans chaque case** ; sous-total des marketplaces, site web isolé dessous, total ;
  barre de répartition entre entités sur chaque ligne ; toucher une marketplace filtre le graphique et le classement. Sur mobile, le total reste collé au nom de la marketplace pendant le défilement des mois.
- Le filtre marketplace global (haut de l'application) verrouille le périmètre du graphique et du classement (pastille avec cadenas). Le filtre de dates global ne s'applique pas : l'écran est mensuel,
  l'année se choisit dans l'onglet.

**Données** — tout est recalculé par `socle.js` au chargement à partir de `shopify_extension.json` : même jour et mêmes totaux que le reste du tableau de bord. Aucun nouveau fichier ; une seule
information nouvelle à extraire, la quantité par pays (voir ci-dessous).

| Découpage | Source |
|---|---|
| Pays | `PAYS_MONTHLY` : `[pays, marketplace, année, mois, CA HT, quantité]` (quantité : voir ci-dessous) |
| Marque | `SKU_MONTHLY` × **`SKU_MARQUE`** (nouvelle constante de `socle.js` : marque de chaque produit, parallèle à `SKU_PRODUIT` — celle du fournisseur Shopify, sinon celle de la table de référence, sinon Bestherm) |
| Catégorie | `SKU_MONTHLY` × `PRODUCT_TO_CATEGORY` ; les produits hors catalogue (pièces, accessoires, livraison) forment « Autres produits » |
| Sous-catégorie | `SKU_MONTHLY` × `SKU_SOUS_SOUS_FAMILLE` des produits catégorisés |

- **Quantités par pays** : l'extraction ne portait que le CA par pays. `transformer.mjs` ajoute désormais la quantité de chaque ligne jour × pays × marketplace (5e élément de `pays_jour`) : ce sont les
  mêmes lignes de vente que le détail par produit, les deux se recoupent donc exactement ; `refresh_extension.mjs` la reconduit à la fusion. `socle.js` donne la quantité (6e élément de `PAYS_MONTHLY`) pour une
  année **seulement si toutes ses lignes pays en portent une** : jamais de quantité partielle, jamais d'estimation. Une extraction plus ancienne (4 éléments par ligne) reste valide : le CA par pays
  s'affiche, le bouton « Quantités » est désactivé pour le découpage par pays et l'écran le dit. Les quantités par marque et par type de produit viennent du détail par produit : toujours présentes.
- **À faire une fois** : la première extraction complète de l'historique (« Reconstruire tout l'historique », `README.md` du dossier `scripts/extension`) porte les quantités par pays pour **2025 comme pour 2026**
  (contrairement à la version ODP, qui n'a pas de quantités par pays en 2025). Une actualisation du matin qui reprend quelques jours sur une extraction plus ancienne, sans quantités, laisse l'année sans
  quantités par pays jusqu'à cette reconstruction ; `selftest.mjs` l'affiche en information (ce n'est pas une erreur : état prévu) et l'écran l'indique.
- **Totaux** : chaque découpage retombe sur les KPI ; les marques sur `monthly_by_brand` ; les catégories sur `category_by_mp` ; le détail par pays sur le détail par produit, marketplace par marketplace
  et mois par mois (quantités exactes, CA à quelques centimes près : les lignes pays et les lignes produit sont arrondies chacune de leur côté, `selftest.mjs` tolère `0,02 × √(nombre de lignes) + 1 €`).
- **Valeurs négatives** : un remboursement compté à sa date (et non à celle de la commande) peut rendre une case, voire un pays entier, négatif ; le montant est conservé tel quel (somme exacte), la case
  n'est pas colorée, le classement le place en dernier.
- **Site web 2025** : la boutique du site n'existe dans Shopify que depuis mai 2025 ; une note l'indique en 2025 quand le site est dans le périmètre. Ne pas le comparer à 2026 sur l'année entière.

**Couleurs** — palette de 8 teintes sur fond sombre, **validée avec `validate_palette.js`** de la compétence dataviz (clarté OKLCH 0,48–0,67, chroma ≥ 0,1, contraste ≥ 3:1 sur #0A0908 et sur le fond d'une carte,
écart daltonien ≥ 14,5 et en vision normale ≥ 21,5 entre teintes voisines). La couleur suit l'entité, jamais son rang : France orange, Belgique bleu, Espagne vert, etc. ; **Bestherm #F75212, HOM'Y #8B5CF6,
Thomson #D50032**, empilés dans cet ordre fixe (l'orange et le rouge, trop proches, ne se touchent jamais) ; « Autres » en gris neutre. Le nom est toujours écrit (légende, classement, bulle) : la couleur n'est
jamais seule à identifier une entité.

**Fichiers** : `repartitions.js` (nouveau : calculs purs, couleurs), `socle.js` (`SKU_MARQUE`, quantité par pays), `scripts/extension/transformer.mjs` et `refresh_extension.mjs` (quantité par pays), `App.jsx` (écran, textes
en 4 langues, sous-onglet, assistant), `api/chat.mjs` (sous-onglet `repartitions` pour l'assistant IA), `selftest.mjs`, `selftest_socle.mjs`, `selftest_pipeline.mjs`, `smoke.mjs`.

**Tests** : `selftest.mjs` (3 bis) contrôle sur les vraies données que chaque total par découpage, par mois et par marketplace retombe sur les KPI, `monthly_by_brand` et `category_by_mp`, que le détail par pays égale le
détail par produit, que « Hors France » retire exactement la France, que « Autres » ne perd rien, que les couleurs suivent l'entité, qu'une valeur négative reste cohérente et que les quantités par pays n'apparaissent que
si toute l'année en porte ; `selftest_socle.mjs` et `selftest_pipeline.mjs` couvrent la quantité par pays (année mixte, ligne manquante, ancien format, quantité négative). `smoke.mjs` recalcule dans le test les chiffres
attendus et vérifie l'écran case par case (total, classement, légende, bulle, vue tableau, parts, entité et marketplace choisies, repli sans quantités, couleurs des marques, lien depuis « Marque », filtre global,
4 langues, mobile 390 et 360 px). `node scripts/extension/smoke.mjs --repartitions` ne lance que cet écran.

## Mise à jour du 21 octobre 2026 — objectif du jour pondéré par jour de la semaine, « % du plan » et courbes d'objectif

**Demande** : avis sur les deux courbes d'objectif ajoutées ce jour-là par une autre session (objectif mensuel dans la courbe de tendance ; « objectif du jour » = objectif de la semaine
÷ 7 dans le suivi quotidien), puis « Ok » aux améliorations proposées. Les deux courbes sont conservées ; ce qui suit les complète.

**Ce qui change**

- **Objectif du jour pondéré** : l'objectif de la semaine du plan (semaines Excel, dimanche → samedi, `OBJECTIF_2026.hebdo`) n'est plus divisé à plat par 7 — ce qui donnait la même
  barre à viser un lundi et un samedi, alors que le lundi vend nettement plus. Il est réparti selon le **poids habituel de chaque jour de la semaine**, mesuré sur l'historique
  journalier du périmètre affiché : pour chaque semaine entière (dimanche → samedi, un jour de vente chaque jour), part de chaque jour dans la moyenne de sa semaine, puis moyenne de ces
  parts sur toutes les semaines. Il faut **au moins 8 semaines entières** ; les poids ont pour moyenne 1, donc **le total de chaque semaine reste celui du plan**. Ordre de grandeur
  sur l'ensemble des canaux (français, 14 semaines) : lundi ≈ 1,28, mardi ≈ 1,12, mercredi ≈ 1,01, vendredi ≈ 0,99, jeudi ≈ 0,92, dimanche ≈ 0,88, samedi ≈ 0,82.
- **Périmètre** : avec un filtre marketplace (ou le site web), l'objectif est ramené au prorata de son objectif annuel (comme avant) et le profil des jours est celui de ce canal s'il
  repose sur 8 semaines entières au moins ; sinon (peu d'historique, jours sans vente) c'est le profil de l'ensemble des canaux ; à défaut de tout profil, répartition à plat (÷ 7). Les
  marketplaces sans objectif fiable (« Autre », « But », « Bricoman ») n'ont ni courbe ni ligne du plan.
- **« % du plan » à côté du CA en tête** : une ligne « Objectif 966k€ · 71 % · -280k€ » donne l'objectif de la période affichée (somme des objectifs de ses jours), la part atteinte par le
  CA et l'écart en €, en vert au-dessus du plan et en rouge en dessous ; sur un jour touché : « Objectif du jour 55 603 € · … ». Les trois chiffres se lisent d'un coup d'œil, sans
  comparer la courbe aux barres.
- **Courbe d'objectif de l'histogramme** : en escalier, un palier par jour (aux limites des barres), légende « Objectif (plan 2026) » ; la bulle d'un jour ajoute « Objectif du jour »
  avec l'écart du CA du jour à cet objectif.
- **Courbe de tendance : finitions** — la courbe d'objectif mensuel est tracée **après** le masque de la fourchette anticipée (avant, elle disparaissait derrière lui dès que
  l'anticipé dépassait le plan), avec des points pleins ; ses libellés (courbe, légende, bulle, « Objectif du jour », « Objectif ») sont **traduits** en français, anglais, espagnol et
  chinois.

**Source du profil** : tout l'historique journalier de `shopify_extension.json` (schéma 2 : jour × marketplace × produit), site web compris.

**À savoir**

- Le profil repose sur tout l'historique Shopify disponible : il s'affine chaque matin avec les nouvelles ventes.
- C'est une répartition de l'objectif, pas une prévision : le poids des jours est celui du passé (jours fériés et opérations commerciales ne sont pas pris en compte).
- Le plan hebdomadaire ne couvre que les semaines 1 à 52 de 2026 : une fenêtre qui touche la semaine du 27 décembre ou 2027 n'affiche pas d'objectif.
- **Reste à faire** : la carte « Objectif du mois » (sous la courbe de tendance) calcule encore son « attendu à ce jour » par un prorata linéaire du mois (≈ 1 403 226 € au 20 octobre)
  alors que le plan hebdomadaire donne ≈ 1 374 995 € à la même date (2 % d'écart) ; à harmoniser une prochaine fois.

**Tests** : `smoke.mjs` recalcule dans le test, sans passer par le code de l'application, les semaines Excel, le profil des jours (avec son repli sur l'ensemble des canaux), l'objectif de
chaque jour, le total de chaque semaine entière, la ligne du plan (libellé, montant, part, écart, couleur) sur la période et sur un jour touché, la bulle et la légende dans les quatre
langues, les filtres marketplace (profil propre, repli, site web, marketplace sans objectif), et sur la courbe de tendance l'ordre de tracé, les points pleins, les libellés et les montants
des bulles de juillet et de novembre. Le contrôle de débordement mobile du suivi couvre la nouvelle ligne.

## Mise à jour du 19 octobre 2026 — top 10 marketplaces dans le suivi quotidien

**Demande** : « Très bien cette mise en forme, peux-tu y ajouter le top 10 marketplace ? » (premier bloc « Données à jour »).

**Interprétation** : le classement des canaux de vente — les marketplaces et le site web — par CA HT sur la période affichée ou, en touchant une barre, sur ce seul jour, dans
la même forme que le top 10 produits. (Si l'idée était plutôt « le top 10 des produits de chaque marketplace » : c'est ce que fait déjà le filtre marketplace global, qui limite
tout le bloc, top 10 produits compris, à la marketplace choisie.)

**Ce que montre le volet « Marketplaces »** :

- Une ligne par canal, du plus gros au plus petit CA HT (dix au plus) : rang, nom, CA HT, part du CA affiché, unités, barre proportionnelle au premier. Le **site web** y figure
  sur une barre bleue, comme dans l'histogramme ; les marketplaces sont en orange.
- Variation par rapport à l'an dernier **en % et, dessous, en €**, avec les mêmes formats que le top 10 produits (« nouveau » pour un canal sans vente l'an dernier), calculée
  canal par canal et **seulement quand ce canal est comparable** : le site web l'est depuis sa première vente Shopify (fin mai 2025), une marketplace l'est quand l'historique
  remonte assez loin ; sinon (période dont l'an dernier commence avant), pas de variation pour le site web, et aucune variation du tout si l'historique est trop court.
  Les produits n'ont pas de variation sur un seul jour (trop volatile), mais les canaux la gardent quand on touche une barre, comme le chiffre en tête.
- **Avec un filtre marketplace actif**, le volet disparaît (il n'y aurait qu'une ligne) : le bloc garde « Produits » et « % par pays ».
- **Disposition** : sous 1 024 px (mobile), les volets s'affichent un à la fois sous des onglets « Produits | Marketplaces | % par pays » (l'ancien onglet « Top 10 » devient
  « Produits » ; le choix reste mémorisé sur l'appareil, et un choix « Marketplaces » mémorisé retombe sur « Produits » quand un filtre marketplace est actif). Sur ordinateur, les volets
  restent côte à côte : trois colonnes dès 1 280 px (Produits | Marketplaces | % par pays) ; de 1 024 à 1 279 px, les produits à gauche et, à droite, les marketplaces au-dessus des pays.

**Données** : rien de plus à fournir. `suiviCalc` (`App.jsx`) additionne, en même temps que les produits, le CA et les unités par canal (marketplace ou site web) sur les lignes
de `shopify_extension.json` (schéma 2), et lit le CA de l'an dernier de chaque canal dans le même historique, au même format, avec le même calcul.

**Tests** : `smoke.mjs` recalcule dans le test, sans passer par le code de l'application, le classement des canaux (ordre, CA, part, unités, variation en % et écart en € — ou leur
absence pour un canal non comparable —, « nouveau »), sur la période comme sur un jour touché, avec les puces, les quatre langues et les filtres marketplace (volet absent) ; il
vérifie aussi la disposition (trois colonnes dès 1 280 px, deux de 1 024 à 1 279 px), les trois onglets sur mobile (390 et 360 px, choix mémorisé, retour sur « Produits » avec un
filtre actif) et l'absence de débordement ou de nom tronqué.

## Mise à jour du 17 octobre 2026 (nuit) — premier bloc « Données à jour » : suivi quotidien

**Demande** : dans le premier bloc, le top 10 des produits sur la date, le % par pays sur la date de l'histogramme et le suivi, sur l'histogramme, de
la performance de l'année précédente sur le même exercice pour une donnée comparable — un vrai suivi du quotidien.

**Ce que montre le bloc** (haut de « Vue d'ensemble », ouvert par défaut ; un clic sur l'en-tête le replie) :

- **Période** : puces `7 j · 14 j · 30 j · 90 j` ; le choix est mémorisé sur l'appareil.
- **Chiffre en tête** : CA HT de la période, variation par rapport aux mêmes dates de l'an dernier **en % et en €** (« ▼ -19.3 % -140k€ »), dates comparées indiquées (« vs 4–16 oct. 2025 »).
- **Commandes et panier moyen** (sous le chiffre en tête) : nombre de commandes de la période ou du jour (commandes à CA > 0, par marketplace d'après la passerelle
  de paiement ; champ `commandes` de `shopify_extension.json`) et panier moyen = CA HT ÷ commandes, chacun avec sa variation par rapport aux mêmes dates de l'an
  dernier. Le CA étant commandes × panier, on voit si une variation vient du volume ou du panier. Variations seulement quand l'an dernier est comparable sur tout le
  périmètre (même règle que le chiffre en tête) ; le filtre marketplace et le jour touché s'appliquent aussi.
- **Histogramme** du CA HT par jour (marketplaces + site web) avec la courbe pointillée de l'an dernier aux mêmes dates. **Toucher une barre** sélectionne
  ce jour : le chiffre en tête, le top 10 et les pays passent à ce seul jour ; « Période entière » revient à la période. Pour ce jour, un choix
  « Même date | Même jour de semaine » indique à quoi le comparer l'an dernier : à la même date (par défaut, comme tous les « vs 2025 » de l'écran) ou au même
  jour de la semaine (364 jours avant : un jeudi au jeudi correspondant). L'étiquette « vs … » précise alors le jour de la semaine comparé ; le choix est mémorisé sur l'appareil.
- **Top 10 produits** de la période ou du jour : CA HT, part du CA, unités, variation par rapport à l'an dernier **en % et, dessous, en €** (« nouveau » pour un
  produit absent l'an dernier ; pas de variation sur un seul jour).
- **Part du CA par pays** sur les mêmes dates : les 6 premiers pays puis « Autres », avec l'écart de part en points par rapport à l'an dernier quand il existe.
- Le bloc suit le filtre marketplace global (Site Web, Leroy Merlin…) : barres, top 10 et pays se limitent à cette marketplace.
- **Sur mobile** (écran de moins de 1 024 px), le top 10 et la part par pays s'affichent **un à la fois**, sous des onglets « Top 10 | % par pays » (le choix est
  mémorisé sur l'appareil) ; les lignes du top 10 sont plus serrées. Sur un écran de 390 px le bloc passe d'environ 1 220 px de haut à 905 px (top 10) ou 730 px (pays).
  Les dix produits restent tous affichés ; sur ordinateur, les deux volets restent côte à côte, sans onglets. (Depuis le 19 octobre : trois onglets « Produits | Marketplaces | % par pays », voir la section ci-dessus.)

**Écart en €** : le % seul exagère les petites bases (+211 % peut ne valoir que +19 k€), donc chaque produit du top 10 et le chiffre en tête affichent aussi l'écart
en euros avec les mêmes dates de l'an dernier : « +19k€ » dès 10 000 €, « +4.2k€ » de 1 000 à 9 999 €, « +840€ » en dessous. Il se calcule sur la même base que le % (les
marketplaces seules quand seules elles sont comparables, voir plus bas) ; pour un produit « nouveau », c'est son CA. Dès 100 %, la variation s'affiche sans décimale
(« +128 % »), et « ×12 » à partir de +500 %. Rien n'est affiché sur un seul jour ni quand l'an dernier n'est pas comparable.

**Interprétation de « % par pays »** : part du CA HT de chaque pays sur la période affichée (le « % obj. » du bloc Pays de l'onglet Marketplaces, qui rapporte le
CA de l'année à l'objectif annuel du pays, n'a pas de sens sur quelques jours ; il reste inchangé dans son onglet).

**« Donnée comparable »** : l'an dernier = les mêmes dates calendaires un an plus tôt (29 févr. → 28 févr.). Jamais de variation calculée sur une base incomplète : le site web n'existe dans Shopify que depuis sa première vente (fin mai 2025) ; pour une période dont l'an dernier commence avant cette date, la comparaison se fait sur les **marketplaces seules** (légende « 2025 · marketplaces », mention « Δ marketplaces » au-dessus du top 10, pas de variation pour le site web) ; si l'historique ne remonte pas assez loin, aucune comparaison. Les variations par pays sont des écarts de part du CA, en points.

**Données** : `suiviDonnees()` dans `App.jsx` lit `shopify_extension.json` (schéma 2 : lignes jour × marketplace × produit, et `pays_jour` pour les pays) : les mêmes jours de l'an dernier sont lus dans le même historique, au même format, avec le même calcul.

**Tests** : `smoke.mjs` recalcule dans le test, directement depuis les fichiers du dépôt et sans passer par le code de l'application, le CA de la période et de
chaque jour, la variation par rapport à l'an dernier, le top 10 (produits, montants, ordre, variation en % et écart en € de chaque produit), l'écart en € en tête, les commandes et le panier moyen (avec leurs variations), la part de chaque pays, avec les puces de période, le jour touché et
son retour, les filtres Leroy Merlin et Site Web, les quatre langues et, sur mobile (390 et 360 px), les onglets « Top 10 | % par pays » (un seul volet à la fois, choix mémorisé, libellés dans les quatre langues) et l'absence de débordement.

## Mise à jour du 17 octobre 2026 (soir) — tableau de bord allégé : « garde l'essentiel »

**Demande** : « trop de sous-info », en gardant le top produits, le % par pays et le « vs 2025 » sur les courbes.

**Retiré de l'affichage** (rien n'est supprimé du code : l'interrupteur `SOUS_INFOS` en tête des composants de `App.jsx`, à `false`,
masque ces éléments ; le remettre à `true` les fait tous revenir) :

- les sous-titres explicatifs sous les titres de section et de bloc (une cinquantaine) ;
- les notes de méthode sous les graphiques et tableaux (panier moyen et meilleure vente hors filtre de date, zone en pointillés,
  couverture des marques / catégories / puissances, nombre de résultats, « donnée globale 2025+2026 »…) ;
- dans le premier bloc « Données à jour », la phrase de source sous le titre et les cinq notes du bas (portée des chiffres, règles de
  calcul, Bricoman, ce qui reste calculé sur l'ODP, dernière extraction) — le bloc lui-même est **conservé** : titre, dernier jour de
  données, pastille ambre « Non actualisé depuis N j » à partir de 2 jours (extraction illisible : l'écran « Données Shopify indisponibles » remplace tout le tableau de bord) et graphique du CA HT par
  jour (marketplaces / site web) avec ses totaux, **ouvert par défaut** (un clic sur l'en-tête le replie, le choix est mémorisé) ;
- la ligne des dates sous le bloc « Données à jour » et les dates de la base de comparaison (« vs 5 957 343 € sur la même période 2025 » remplace
  « vs 5 957 343 € · 2025-01-01 → 2025-10-16 »), la pastille verte « Source : Shopify » et le doublon « Tous montants HT » du pied de page.

**Conservé tel quel** : le bloc « Données à jour » avec son graphique du CA par jour, la liste « Tous les produits » classée par CA (avec les badges Top / Flop, la recherche et le détail par produit),
la répartition par pays avec « NN % obj. », toutes les pastilles et courbes « vs 2025 », les KPI, l'estimation de fin d'année, l'objectif
du mois, les alertes de couleur (marketplaces en déclin, pays sous l'objectif).

**Corrigé au passage (affichage mobile, déjà présent avant)** : la colonne « vs 2025 » du tableau des marketplaces, le ROAS du détail par
pays, le budget consommé des campagnes et la colonne « vs 2025 » du reste du top 15 étaient rognés sur un écran de 390 px ; les tableaux
mensuels (CA par mois des 6 premiers produits, suivi des prix) étaient coupés à partir de juin sans pouvoir défiler ; « Juin » et « Juil »
s'affichaient tous deux « Jui ». Les barres décoratives de ces tableaux ne s'affichent plus que sur grand écran, tous les chiffres restent.

**Tests** : `smoke.mjs` vérifie désormais le bloc « Données à jour » (titre, date, graphique journalier ouvert par défaut et repliable, 4 langues), l'absence des sous-informations retirées, la présence des
trois vues conservées et le défilement du tableau mensuel sur mobile (`SMOKE_OK`). Les explications retirées de l'écran (règles de calcul,
limites) restent décrites dans `scripts/extension/README.md`.

## Mise à jour du 17 octobre 2026 — toute l'application à jour avec les deux boutiques Shopify

**Constat** : les KPI ne correspondaient pas à Shopify. Le fichier ODP s'arrête au 3 octobre, et le bloc « Flash Shopify » des
14-15 octobre n'ajoutait les ventes suivantes que dans une carte à part : le chiffre d'affaires cumulé, les courbes, les
marketplaces, les marques, les produits, les pays, le plan et les comparaisons avec 2025 restaient arrêtés au 3 octobre.

**Maintenant** : les ventes des deux boutiques (marketplaces BESTHERM + site bestherm.fr) du 4 au 16 octobre sont **ajoutées à
tous les tableaux** : toute l'application s'arrête au même jour (16 octobre), et la tâche planifiée du matin (6 h 58, heure de
Paris) la prolonge chaque jour jusqu'à la veille. Un bloc « **Données à jour · jusqu'au 16 oct.** » (haut de « Vue
d'ensemble ») indique le dernier jour couvert et montre le CA HT de chaque jour (la version initiale détaillait aussi d'où viennent
les chiffres ; ces explications ont été retirées le soir même, voir la note du dessus). Le bloc « Flash Shopify » est supprimé (ses chiffres sont désormais dans les KPI).

| Indicateur | Fichier ODP au 3 oct. | Avec Shopify au 16 oct. |
|---|---|---|
| CA HT 2026 à date | 7 509 326 € | **8 155 665 €** (+646 339 € : marketplaces 580 334 €, site web 66 005 €) |
| Unités vendues | 80 787 | **87 233** |
| Part de l'objectif annuel (15 M€) | 50,06 % | **54,37 %** |
| Panier moyen (CA ÷ lignes ODP) | 100,62 € | **102,10 €** |
| Plan cumulé attendu à date | S40 : 55,2 % | S42 (6 jours sur 7) : **61,1 %**, soit −6,7 pt |
| Évolution à période comparable | +40,2 % (vs 5 356 876 €) | **+36,9 %** (vs 5 957 343 €, 1er janv. → 16 oct. 2025) |
| Octobre 2026 à date | 132 316 € (1er → 3) | **778 655 €** (1er → 16) |
| Semaines | S40 : 333 274 € | S41 : 333 319 € · S42 (partielle, 6 jours) : 313 020 € |
| Marketplaces (CA HT) | Leroy Merlin 3,15 M€ · Amazon FR 1,60 M€ · Site Web 0,80 M€ · ManoMano 0,70 M€ | Leroy Merlin **3,43 M€** · Amazon FR **1,74 M€** · Site Web **0,86 M€** · ManoMano **0,75 M€** |

**Ce qui est recalculé avec Shopify** : KPI (CA, unités, panier, % de l'objectif), courbes mensuelles et hebdomadaires, marketplaces
et objectifs, marques, produits (classements, meilleures ventes, courbes), pays, catégories et normes, suivi des prix, plan et
écart au plan, comparaisons avec la même période de 2025 (du 1er janvier au jour de la dernière donnée, coupe N-1 du mois en
cours relue dans l'ODP 2025), export Excel et assistant. **Ce qui reste calculé sur le fichier ODP** (donc arrêté au 3 octobre) :
publicité, concurrence, élasticité-prix et simulations, associations de produits, catalogue, transporteurs et entrepôts.

**Règles de calcul** (détail : `scripts/extension/README.md`)

- Marketplaces : CA HT = (ventes nettes + taxes) ÷ 1,2, comme la colonne « CA HT » de l'ODP ; la marketplace d'une commande est
  celle de sa passerelle de paiement. **Bricoman n'est pas séparable de Leroy Merlin dans Shopify** : depuis le 4 octobre ses
  ventes sont comptées dans Leroy Merlin. Passerelles inconnues (Carrefour, bricodepotes…) et commandes à 0 € : « Autre ».
- Site web : ventes brutes hors taxes (`gross_sales`), base du canal « Site Web » de l'ODP (mesuré : 1,000 × l'ODP sur 10
  semaines).
- Les lignes de port ne sont pas comptées (l'ODP n'en contient presque pas). L'ancien « Flash » les incluait : +115 € de TVA.
- Marque et norme des produits : table `data/produits_meta.json` (reproduit les courbes de l'ODP, même quand la marque du
  vendeur Shopify diffère : ALMA, MIRA, FIFTY BLANC, LILA, AZRA, VAIL, LISA, ALOA CONNECT restent Bestherm).
- Références absentes du catalogue : conservées sous leur code (EAN 3760381650252 : 123 €, GD20-20RC-24RC-FILTRE-HEPA : 96 €) ;
  `HT15-24FERL` est rattachée à STELLINA 1500W (déduction).
- Panier moyen = CA ÷ lignes de l'ODP (une ligne par unité pour Amazon, Cdiscount, site web… ; une ligne par commande et
  référence pour Leroy Merlin, ManoMano, « Autre »), **pas** le panier par commande de Shopify (≈ 170 €). Les lignes Shopify
  sont comptées selon la même règle.
- La semaine et le mois en cours sont partiels : le plan est calculé au prorata des jours écoulés.

**Garde-fous** : application atomique (extraction invalide ou incohérente : l'application garde le fichier ODP seul et le bandeau
le dit), total de chaque jour contrôlé contre Shopify, boutiques indépendantes (si l'une échoue, l'autre est mise à jour et
l'écran s'arrête au dernier jour couvert par les deux, avec « Non actualisé depuis N j » après 2 jours), lecture seule, aucune
donnée de client. Un nouvel export ODP qui couvre les jours Shopify les remplace automatiquement (aucun doublon).

**Tâche planifiée du matin** : elle clone le dépôt, lance `selftest.mjs`, lit les ventes de la veille (connecteur Shopify pour
les marketplaces, relais pour le site), écrit `shopify_extension.json` (seul fichier modifié), contrôle (`selftest.mjs`, build,
`smoke.mjs`), publie sur `main` et vérifie le site en ligne. Procédure complète : `scripts/extension/README.md`.

**Tests** (aucun ne touche aux boutiques) :

- `node scripts/extension/selftest.mjs` → `SELFTEST_OK` : sur les vraies données du dépôt, chaque tableau augmente exactement du CA,
  des unités et des lignes de l'extraction ; totaux identiques entre KPI, courbes, marketplaces, marques, pays, semaines ;
  extraction invalide ou marketplace inconnue (rien n'est modifié) ; extraction déjà couverte par l'ODP ; chevauchement ;
  déterminisme ;
- `npx vite build && node scripts/extension/smoke.mjs` → `SMOKE_OK` : bloc « Données à jour » avec son suivi quotidien (période, jour touché, mêmes jours l'an dernier, top 10 produits avec variation et écart en €, part du CA par pays, onglets mobile, choix même date / même jour de la semaine ; 4 langues, pastille de fraîcheur),
  sous-informations absentes, vues conservées (produits, % par pays, vs 2025), chiffres affichés = chiffres calculés, filtres marketplace,
  7 onglets sans erreur JavaScript, mobile (tableaux défilables).

**Retiré** : bloc « Flash Shopify », `shopify_flash.json`, `shopify_flash_site.json`, `scripts/flash/` (le relais et son test ont été
déplacés dans `scripts/extension/`). Pour revenir en arrière : `git revert` du commit « Toute l'application prolongée avec les ventes Shopify ».

**Limites** : voir `scripts/extension/README.md` (Bricoman dans Leroy Merlin, passerelles hypothétiques EPMM/Monechelle → ManoMano
et CLogistique → Cdiscount, lignes de commande estimées, année 2026 seulement).

## Relais en lecture seule de la boutique du site (mis en place le 15 octobre 2026)

Le connecteur Shopify de Claude ne sert qu'**une boutique à la fois** (changer de boutique coupe la première). Le site passe
donc par `api/mcp-site.mjs`, une porte à part hébergée sur ce projet Vercel, qui ne fait que lire : requêtes ShopifyQL
(jeux `sales`, `sessions`, `products`), des agrégats uniquement ; les requêtes qui visent des données de client (e-mail,
téléphone, nom, adresse) sont refusées. Le script `scripts/extension/refresh_extension.mjs` l'appelle directement avec la clé du relais (`scripts/extension/site_query.mjs`).
Un connecteur personnalisé côté Claude est possible mais **facultatif** : l'actualisation du matin n'en dépend pas.

**Mise en place (une seule fois, déjà faite)**

1. **Shopify, boutique du site** : Dev Dashboard → application en lecture seule (« HOM'Y Pilotage - lecture »), droit
   **`read_reports`** seul. Puis **Installer l'application** sur la boutique du site (Accueil de l'application → Installer
   l'application) : sans cette étape, Shopify refuse le jeton. Noter l'identifiant client et le secret (ne jamais les coller
   dans une conversation).
2. **Vercel** (projet `homy-pilotage` → Settings → Environment Variables, tous les environnements) : quatre variables,
   chacune avec **sa** valeur.

   | Variable | Contenu |
   |---|---|
   | `SHOPIFY_SITE_SHOP` | la partie `xxxx` de `xxxx.myshopify.com` (boutique du site : `besthermshop`), sans le reste |
   | `SHOPIFY_SITE_CLIENT_ID` | identifiant client de l'application (32 caractères) |
   | `SHOPIFY_SITE_CLIENT_SECRET` | secret de l'application (il commence par `shpss_`) |
   | `MCP_SITE_KEY` | clé du relais, choisie par vous : c'est son mot de passe. 24 caractères minimum (40 conseillés), **lettres et chiffres uniquement** (elle se place dans une adresse web : pas de `#`, `&`, `+`, `%`, espace) |

   Puis **Redeploy** (Vercel n'applique pas une variable à un déploiement déjà en ligne). Variante : `SHOPIFY_SITE_TOKEN`
   (jeton d'administration fixe) à la place de l'identifiant et du secret ; `SHOPIFY_SITE_API_VERSION` facultative (défaut
   `2026-04`). Facultatif : marquer ces variables « Sensitive » dans Vercel (leur valeur n'est alors plus affichée).
3. **Vérifier** : ouvrir `https://homy-pilotage.vercel.app/api/mcp-site?key=<MCP_SITE_KEY>` dans le navigateur →
   `"configured": true` et la boutique du site. Si `false` : `manque` liste les variables absentes, `identiques` celles qui
   portent la même valeur (erreur de collage), `formes_plausibles` indique si chaque valeur a la forme attendue,
   `cle_assez_longue` et `cle_url_sure` signalent une clé trop courte ou avec des caractères spéciaux. Sans la clé, la page
   ne révèle que `cle_definie` et `cle_valide` (jamais la clé elle-même).
4. **Contrôle en ligne de commande** : `export MCP_SITE_KEY=...` puis `node scripts/extension/site_query.mjs --info` → la
   boutique `besthermshop.myshopify.com`.
5. **Facultatif, connecteur Claude** : Customize → Connectors → **Add custom connector** (Team ou Enterprise : un Owner
   l'ajoute dans Organization settings → Connectors). Nom : `Shopify Site` ; adresse :
   `https://homy-pilotage.vercel.app/api/mcp-site?key=<MCP_SITE_KEY>` ; authentification : **No sign-in** (la clé est dans
   l'adresse). Il permet d'interroger le site depuis une conversation, sans toucher à la connexion BESTHERM.

**Boutique des marketplaces (BESTHERM), même relais** (ajout du 17 octobre 2026) : les outils acceptent l'argument
`boutique: "marketplaces"` (le site reste la boutique par défaut). La boutique lue est **`46a3f9-2.myshopify.com` par défaut** : la
variable `SHOPIFY_MP_SHOP` est facultative (elle ne sert qu'à viser une autre boutique ; saisie mais mal formée, elle est refusée
avec un message, sans repli silencieux). Mise en place : **installer sur BESTHERM l'application « HOM'Y Pilotage - lecture »**
(Dev Dashboard → l'application → Accueil → **Installer l'application**, boutique BESTHERM, même organisation Shopify que la
boutique du site) ; l'identifiant et le secret de l'application du site sont réutilisés, aucune autre variable n'est à saisir.
Tant que l'application n'est pas installée, le relais répond `app_not_installed` (« The application is not installed on this
shop »).
Si BESTHERM est dans une autre organisation, Shopify répond « application et boutique pas dans la même organisation » : créer
alors une seconde application en lecture seule (`read_reports`) dans l'organisation de BESTHERM, saisir son identifiant et son
secret dans `SHOPIFY_MP_CLIENT_ID` et `SHOPIFY_MP_CLIENT_SECRET` (Vercel, tous les environnements) puis **Redeploy**.
Contrôle : `export MCP_SITE_KEY=...` puis `node scripts/extension/site_query.mjs --info --boutique marketplaces` → boutique
`46a3f9-2.myshopify.com`, nom BESTHERM ; la page `/api/mcp-site?key=<MCP_SITE_KEY>` détaille la boutique dans `marketplaces`
(`configured`, `boutique`, `boutique_par_defaut`, `manque`).

**Clé du relais** : la tâche planifiée du matin la contient dans son propre texte (elle l'exporte avant d'appeler
`refresh_extension.mjs apply`) ; elle n'est jamais écrite dans le dépôt, et l'adresse du connecteur facultatif est à traiter comme un
mot de passe. *Pour la changer* : modifier `MCP_SITE_KEY` dans Vercel, redéployer, puis remplacer la clé dans le texte de la
tâche planifiée (et dans l'adresse du connecteur Claude s'il est installé). Vingt clés fausses depuis une même adresse
bloquent celle-ci pendant 5 minutes. *Pour couper l'accès* : supprimer `MCP_SITE_KEY` (le relais répond alors 503) ou
désinstaller l'application dans Shopify.

**Tests** (aucun ne touche aux boutiques) :

- `node scripts/extension/test_mcp_site.mjs` → `TEST_MCP_SITE_OK` : relais avec Shopify simulé, sans réseau. Il ne fait pas
  partie de l'actualisation du matin : un défaut ici ne la bloque jamais. Les tests du prolongement (`selftest.mjs`,
  `smoke.mjs`) sont décrits dans la note du 17 octobre.

## Mise à jour du 14 octobre 2026 (nuit) — écran de conversation retiré

Après l'écran d'accès (mot de passe), l'app ouvre **directement le dashboard** (Vue d'ensemble, toutes marketplaces).
Les deux étapes de conversation (« Pose ta question, ou choisis une destination », puis « Quelle marketplace ? »)
ne s'affichent plus.

- Langue : reprise du navigateur (français, anglais, espagnol ou chinois, sinon français) ; `?lang=` dans l'adresse reste
  prioritaire. Le sélecteur de langue du dashboard est inchangé.
- Les liens directs (`?tab=`, `?marketplace=`, `?periode=`…) fonctionnent comme avant.
- **L'assistant IA (question libre) se trouvait dans la première étape : il n'est plus accessible.** Son code (`ChatRouter`
  dans `App.jsx`) et le relais `api/chat.mjs` restent dans le dépôt, inutilisés. La clé `ANTHROPIC_API_KEY` n'a donc plus
  d'effet visible tant que l'écran n'est pas remis.
- Pour remettre l'écran : annuler le commit « Retire les deux étapes de conversation » (`git revert`).

## Contenu du dépôt

- `App.jsx` — ventes du 1er janvier au **03/10/2026** (fin de la semaine Excel 40, fichier ODP), plan 2026 (15 M€) intégré ; au
  chargement, les ventes Shopify de `shopify_extension.json` sont ajoutées à tous les tableaux (voir la note du 17 octobre).
- `extension.js` — module qui ajoute ces ventes aux constantes de `App.jsx` et recalcule ce qui en dérive.
- `shopify_extension.json` — ventes des deux boutiques Shopify après la fin du fichier ODP, actualisées chaque matin.
- `data/n1_2025.json` — ventes 2025 d'octobre à décembre, pour la comparaison « même période 2025 » ; `data/produits_meta.json` —
  marque, norme et attributs des produits, correspondances de références.
- `scripts/extension/` — actualisation (`refresh_extension.mjs`), relais du site (`site_query.mjs`), tests (`selftest.mjs`,
  `smoke.mjs`, `test_mcp_site.mjs`), construction du fichier N-1 (`build_n1.mjs`) et mode d'emploi (`README.md`).
- `api/mcp-site.mjs` — relais MCP en lecture seule de la boutique Shopify du site web (voir la note du 15 octobre).
- `api/chat.mjs` — relais de l'assistant IA (le texte de contexte ne fige plus aucune date : il suit `donnees_jusqu_au`).

## Mise en ligne

Un commit sur `main` suffit : Vercel redéploie tout seul. Le dossier `api` est au même niveau que
`App.jsx` (pas dans `src`).

## Activer l'assistant IA (une seule fois)

> Depuis le 14 octobre (nuit), l'écran de conversation qui porte l'assistant est retiré du parcours (voir la note en haut
> du fichier) : cette étape n'a d'effet que si l'écran est remis.

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
