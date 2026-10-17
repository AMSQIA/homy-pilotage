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
| `scripts/extension/selftest.mjs` | Contrôle de cohérence sur les vraies données du dépôt (à lancer avant toute publication) |
| `scripts/extension/smoke.mjs` | Test d'affichage sur le build (`dist/`) dans Chromium |
| `scripts/extension/test_mcp_site.mjs` | Test du relais (Shopify simulé, sans réseau) ; ne fait pas partie de l'actualisation du matin |
| `scripts/extension/build_n1.mjs` | Reconstruit `data/n1_2025.json` depuis l'export « LIGNE ODP 2025 » (rarement) |

`App.jsx` n'est jamais modifié par l'actualisation quotidienne : pas de conflit avec les envois manuels, un commit de
quelques ko par jour.

## Règles de calcul

| Élément | Règle |
|---|---|
| CA HT marketplaces | **(ventes nettes + taxes) ÷ 1,2** ligne par ligne, sur les lignes de type `product` seulement (les lignes de port n'ont que de la TVA : l'ODP n'en contient presque pas), comme le CA HT de l'ODP (TTC ÷ 1,2) |
| CA HT site web | **Ventes brutes hors taxes** (`gross_sales`, avant remises et retours) : base du canal « Site Web » de l'ODP (mesuré : l'ODP vaut 1,000 × les ventes brutes du site sur 10 semaines) ; lignes retirées de la commande (quantité 0) écartées |
| Marketplace d'une commande | Passerelle de paiement de la commande (jeu `payments`, passerelle au plus gros montant), `… via Shopping Feed` retiré : `leroymerlin` → Leroy Merlin (**Bricoman n'est pas séparable dans Shopify : ses ventes sont comptées dans Leroy Merlin**), `amazon`/`amazon fba` → Amazon FR, `epmm`/`monechelle`/`manomano` → ManoMano, `cdiscount`/`clogistique` → Cdiscount, `maxeda`, `castoramafr` → Castorama, `bricomarche`, `dartybomp` → Darty, `boulanger`, `bricobravo` → Brico Bravo, `but`, `worten`, `bol` → Bol.com. Toute autre passerelle (bricodepotes, carrefour, vente-unique, leclerc…) et les commandes à 0 € sans paiement (envois de remplacement) → « Autre » ; la liste des passerelles inconnues est donnée en avertissement |
| Site web | Marketplace « Site Web » (boutique bestherm.fr) |
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

**Écart en € et mobile** : à côté de la variation en %, chaque produit du top 10 et le chiffre en tête affichent l'écart en euros avec les mêmes dates de l'an dernier
(« +19k€ », « -4.2k€ », « +840€ »), sur la même base que le % ; « nouveau » = produit absent l'an dernier (écart = son CA) ; rien sur un seul jour ni sans base de
comparaison. Sous 1 024 px de large, le top 10 et la part par pays s'affichent un à la fois (onglets « Top 10 | % par pays », choix mémorisé dans `localStorage`,
clé `homy_suivi_onglet`) ; sur ordinateur, les deux volets restent côte à côte.

**« Donnée comparable »** : l'an dernier = les mêmes dates calendaires un an plus tôt (29 févr. → 28 févr.). Jamais de variation calculée sur une base incomplète. Le « Site Web » 2025 du fichier ODP ne contient qu'une petite partie des ventes réelles du site (la boutique du site n'était pas encore dans ces chiffres) : tant que cette version est en ligne, la comparaison se fait donc sur les **marketplaces seules** (légende « 2025 · marketplaces », mention « Δ marketplaces » au-dessus du top 10, pas de variation pour le site web) ; pour une marketplace absente du fichier 2025 (Boulanger, Brico Bravo, Maxeda, Worten) ou pour le site web seul, aucune comparaison. Le fichier 2025 n'a pas de détail par pays : pas de variation par pays. Ces limites disparaissent avec la version « tout vient de Shopify » (historique complet des deux boutiques).

Ces affichages ne reposent sur aucun fichier de plus : tout est recalculé au chargement à partir des lignes ci-dessus. `smoke.mjs` en contrôle les chiffres
contre un calcul indépendant fait dans le test (CA, variation et écart en € de chaque produit, parts de pays, onglets mobile compris).

## Garde-fous

- Boutique vérifiée à chaque extraction (`shopDomain`) : rien n'est écrit si un résultat vient de l'autre boutique. Les
  résultats sont rangés par boutique et par texte de requête.
- Chaque jour : les lignes doivent retrouver exactement le total du jour de Shopify (unités et montant) ; liste tronquée
  (3 000 lignes) refusée ; moins de 2 % des commandes sans passerelle de paiement (hors commandes à 0 €).
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
4. **Écriture** (les deux boutiques ; le site est lu par le script lui-même, par le relais) :
   ```bash
   export MCP_SITE_KEY=...        # clé du relais (variable Vercel MCP_SITE_KEY), jamais écrite dans le dépôt
   node scripts/extension/refresh_extension.mjs apply --today $TODAY
   ```
   Les lignes `AVERTISSEMENT` ne bloquent pas (références ou passerelles inconnues, pays sans traduction, marque divergente) :
   à reprendre dans le compte rendu. `--dry-run` : essai sans écriture ; `--boutique marketplaces|site` : une seule boutique ;
   `--reprendre N` : réextrait aussi les N derniers jours déjà extraits (correction tardive) ; `--du AAAA-MM-JJ` force le début.
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

## Codes de sortie

`refresh_extension.mjs` : **0** réussi · **1** erreur d'utilisation ou de structure (`App.jsx` n'importe plus le fichier JSON,
constantes illisibles, résultat de l'extraction invalide) · **2** contrôle de cohérence échoué : rien n'est écrit (boutique
inattendue, total du jour, couverture, régression) · **3** résultats ShopifyQL manquants (relancer exactement les requêtes du
`plan`, même `--today`) ou aucune boutique mise à jour.

`site_query.mjs` : 0 réussi · 1 erreur d'utilisation (clé absente, option inconnue) · 2 refus ou erreur du relais ou de Shopify.

`selftest.mjs` : 0 cohérent · 1 contrôle en échec. `smoke.mjs` : 0 ok · 2 échec d'affichage · 77 test impossible.

## Limites connues

- Bricoman n'est pas séparable de Leroy Merlin dans Shopify : depuis le 4 octobre ses ventes sont comptées dans Leroy Merlin.
- La marketplace est déduite de la passerelle de paiement ; `epmm`/`monechelle` sont rattachées à ManoMano et `clogistique` à
  Cdiscount (hypothèse). Une passerelle nouvelle tombe dans « Autre » tant qu'elle n'est pas ajoutée à `PASSERELLES`.
- Les références absentes du catalogue de l'application gardent leur code ; `HT15-24FERL` est rattachée à STELLINA 1500W
  (déduction, `data/produits_meta.json`).
- Le nombre de lignes de commande est estimé (règle ci-dessus ; Leroy Merlin recompte un peu moins de lignes que l'ODP) : le panier
  moyen peut s'écarter d'un à deux euros d'un recalcul complet sur un nouvel export ODP, qui le remplace.
- La coupe N-1 des 2 ans en arrière (2024) n'est plus affichée une fois l'application prolongée.
- `data/n1_2025.json` couvre octobre → décembre 2025 ; l'extension est limitée à l'année 2026 (changement d'année : mise à jour à prévoir).
