# HOM'Y Pilotage — instructions et notes de mise à jour

## Mise à jour du 15 octobre 2026 — Flash Shopify du site web (bestherm.fr)

Le bloc « Flash Shopify » couvre désormais **les deux boutiques Shopify** : les marketplaces (BESTHERM) et le **site web**
(bestherm.fr). La tâche planifiée de 6 h 58 (heure de Paris) actualise les deux chaque matin, jusqu'à la veille.

**Dans l'application** (haut de « Vue d'ensemble », avec « Toutes marketplaces » ou avec le filtre « Site Web »)

- Trois onglets : **Total** (affiché par défaut : somme exacte des deux boutiques, barres empilées marketplaces + site),
  **Marketplaces** et **Site web**. Avec le filtre « Site Web » en haut de l'application, la carte ne montre que le site.
- Dans chaque onglet : CA HT, commandes, unités, panier moyen, évolution vs mêmes dates 2025, courbe jour par jour et cumul
  2026 estimé (Total : ODP + les deux boutiques ; Site web : ventes « Site Web » de l'ODP + flash du site, comparées à
  l'objectif du site de 1,4 M€). Pays et produits les plus vendus dans les onglets par boutique.
- Textes en français, anglais, espagnol et chinois.

**Premier bloc réel (4 → 14 octobre 2026)**

| | Marketplaces | Site web | Total |
|---|---|---|---|
| CA HT | 515 215 € | 56 411 € | **571 626 €** |
| Commandes | 3 108 | 215 | 3 323 |
| Unités | 5 244 | 476 | 5 720 |
| Panier moyen | 166 € | 262 € | 172 € |
| Évolution vs mêmes dates 2025 | +10,9 % (464 722 €) | +27,2 % (44 351 €) | **+12,3 %** (509 073 €) |

Cumul 2026 estimé : **8,08 M€**, soit 53,9 % de l'objectif de 15 M€ (fichier ODP au 3 octobre + les deux boutiques).

**Base de calcul du site** : les **ventes brutes hors taxes** de Shopify (`gross_sales`, avant remises et retours). C'est la
base du canal « Site Web » de l'ODP : sur 10 semaines (26/07 → 03/10/2026), l'ODP vaut 1,000 × les ventes brutes du site
(entre 0,89 et 1,05 selon la semaine). Les ventes nettes sont 8,6 % plus basses et ne s'additionneraient pas à l'ODP. Les
marketplaces gardent leur règle : (ventes nettes + taxes) ÷ 1,2. Contrôle du site contre l'ODP « Site Web », 20/09 → 03/10 :
Shopify 62 651 € contre 62 412 € (+0,4 %). Seuils : avertissement à 5 %, refus d'écrire à 12 % (marketplaces : 3 % et 8 %).

**Garde-fous** : les deux boutiques sont indépendantes (si l'une échoue, l'autre est quand même mise à jour ; l'application
garde les chiffres de la veille pour la boutique en échec, avec la pastille « Non actualisé depuis N j » à partir de
2 jours) ; boutique vérifiée à chaque extraction ; lecture seule ; aucune donnée de client ; `switch-shop` n'est jamais
appelé. Détail, procédure et codes de sortie : `scripts/flash/README.md`.

### Comment le site est lu : un relais en lecture seule

Le connecteur Shopify de Claude ne sert qu'**une boutique à la fois** (changer de boutique coupe la première). Le site passe
donc par `api/mcp-site.mjs`, une porte à part hébergée sur ce projet Vercel, qui ne fait que lire : requêtes ShopifyQL
(jeux `sales`, `sessions`, `products`), des agrégats uniquement ; les requêtes qui visent des données de client (e-mail,
téléphone, nom, adresse) sont refusées. Le script `scripts/flash/site_query.mjs` l'appelle directement avec la clé du relais.
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
4. **Contrôle en ligne de commande** : `export MCP_SITE_KEY=...` puis `node scripts/flash/site_query.mjs --info` → la
   boutique `besthermshop.myshopify.com`.
5. **Facultatif, connecteur Claude** : Customize → Connectors → **Add custom connector** (Team ou Enterprise : un Owner
   l'ajoute dans Organization settings → Connectors). Nom : `Shopify Site` ; adresse :
   `https://homy-pilotage.vercel.app/api/mcp-site?key=<MCP_SITE_KEY>` ; authentification : **No sign-in** (la clé est dans
   l'adresse). Il permet d'interroger le site depuis une conversation, sans toucher à la connexion BESTHERM.

**Clé du relais** : la tâche planifiée du matin la contient dans son propre texte (elle l'exporte avant d'appeler
`site_query.mjs`) ; elle n'est jamais écrite dans le dépôt, et l'adresse du connecteur facultatif est à traiter comme un
mot de passe. *Pour la changer* : modifier `MCP_SITE_KEY` dans Vercel, redéployer, puis remplacer la clé dans le texte de la
tâche planifiée (et dans l'adresse du connecteur Claude s'il est installé). Vingt clés fausses depuis une même adresse
bloquent celle-ci pendant 5 minutes. *Pour couper l'accès* : supprimer `MCP_SITE_KEY` (le relais répond alors 503) ou
désinstaller l'application dans Shopify.

**Tests** (aucun ne touche aux boutiques) :

- `node scripts/flash/selftest.mjs` → `SELFTEST_OK` : calculs et contrôles des deux boutiques, sur données synthétiques ;
- `node scripts/flash/smoke.mjs` → `SMOKE_OK` : affichage des trois onglets, filtre « Site Web », 4 langues, mobile ;
- `node scripts/flash/test_mcp_site.mjs` → `TEST_MCP_SITE_OK` : relais avec Shopify simulé, sans réseau. Il ne fait pas
  partie de l'actualisation du matin : un défaut ici ne la bloque jamais.

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
- Le test d'affichage de la tâche du matin (`scripts/flash/smoke.mjs`) accepte les deux parcours.

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
  compris, jusqu'au 3 octobre). Ils ne bougent qu'avec un nouvel export ODP. (Ce soir-là, la boutique Shopify du site web
  n'était pas lisible en même temps que BESTHERM ; depuis le 15 octobre elle a son propre bloc : voir la note du 15 octobre.)
- **Garde-fous** : boutique vérifiée à chaque extraction, couverture des listes contrôlée, pas de régression, contrôle
  d'écart avec l'ODP (refus d'écrire au-delà de 8 %). Dans l'application : les jours déjà couverts par l'ODP sont ignorés
  (pas de doublon après une mise à jour de l'ODP), et une pastille « Non actualisé depuis N j » apparaît après 2 jours.
- **Après un nouvel export ODP** : relancer l'actualisation le jour même (étapes 3 à 8 du README) ; sinon les listes
  pays et produits restent masquées jusqu'au lendemain matin.

## Contenu du dépôt

- `App.jsx` — ventes du 1er janvier au **03/10/2026** (fin de la semaine Excel 40), plan 2026 (15 M€) intégré, plus le
  composant « Flash Shopify » (onglets Total, Marketplaces, Site web).
- `shopify_flash.json` — données du « Flash Shopify », boutique des marketplaces (BESTHERM), actualisées chaque matin.
- `shopify_flash_site.json` — données du « Flash Shopify », boutique du site web (bestherm.fr), actualisées chaque matin.
- `scripts/flash/` — script d'actualisation (`refresh_flash.mjs`, une entrée par boutique), lecture du site par le relais
  (`site_query.mjs`), auto-test, test d'affichage et mode d'emploi (`README.md`), plus le test du relais
  (`test_mcp_site.mjs`).
- `api/mcp-site.mjs` — relais MCP en lecture seule de la boutique Shopify du site web (voir la note du 15 octobre).
- `api/chat.mjs` — relais de l'assistant IA (le texte de contexte indique maintenant le 3 octobre comme dernière donnée).

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
