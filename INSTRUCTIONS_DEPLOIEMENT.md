# HOM'Y Pilotage — mise à jour du 12 octobre 2026

## Contenu du paquet

- `App.jsx` — remplace le fichier du même nom à la racine du dépôt `homy-pilotage`.
  Ventes jusqu'au 19/09/2026 (+ 2 lignes ManoMano ajoutées, voir plus bas), plan 2026 (15 M€) intégré.
- `api/chat.mjs` — relais de l'assistant IA (inchangé depuis le 7 octobre).

## Mise en ligne

1. Sur GitHub, remplace `App.jsx` (et `api/chat.mjs` s'il n'a jamais été mis à jour depuis le 7 octobre).
   Le dossier `api` est au même niveau que `App.jsx` (pas dans `src`).
2. Commit : Vercel redéploie tout seul.

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
instantané périmé (12 septembre). Ils sont volontairement absents de ce paquet.

## Ce qui change dans cette mise à jour (12 octobre)

### Le fichier reçu : « Lignes ODP (4) »

Ce fichier s'arrête au **15/08/2026**, alors que l'app contient déjà les ventes jusqu'au
**19/09/2026**. Le prendre comme remplacement aurait fait perdre un mois de ventes : j'ai donc
fait une **fusion** — l'app garde tout, et on y ajoute ce que le fichier contient en plus.

Comparaison ligne à ligne du 01/01 au 15/08 : 59 296 lignes identiques (écart de CA ≤ 0,05 € :
le fichier arrondit le CA à 0,1 €), mêmes canaux, pays et marques. **Deux lignes manquaient dans l'app**,
elles sont ajoutées :

| N° de commande | Date | Canal | Produit | Qté | CA HT |
|---|---|---|---|---|---|
| M2602505759878 | 19/02/2026 | ManoMano | ARIA 1000W | 1 | 69,90 € |
| M2604505986973 | 22/04/2026 | ManoMano | ARIA 1000W | 1 | 123,30 € |

- Ces deux lignes n'ont **pas de SKU** dans le fichier : elles sont rattachées à ARIA 1000W
  (SKU HT10PDC, le plus fréquent sur ManoMano). Cela ne joue que sur le classement ABC par SKU
  (HT10PDC : 116 342 € → 116 535 €, classe A inchangée).
- À l'inverse, 27 lignes du 11 au 15/08 (2 861,83 €) sont dans l'app mais pas dans le fichier :
  elles sont **conservées** (le fichier s'arrête au 15/08 et ne les contient pas).

### Effet sur les chiffres

| Indicateur | Avant | Après |
|---|---|---|
| CA HT 2026 à date | 6 918 719,74 € | **6 918 912,94 €** |
| Unités vendues | 74 292 | **74 294** |
| Lignes de commande | 69 413 | 69 415 |
| ManoMano | 631 985,80 € | 632 179,00 € |
| ARIA 1000W (meilleur produit) | 666 034,95 € | 666 228,15 € |
| Février 2026 | 801 336,99 € | 801 406,89 € |
| Avril 2026 | 601 954,60 € | 602 077,90 € |
| Part de l'objectif annuel | 46,12 % | 46,13 % |
| Évolution à période comparable | +49,4 % | +49,4 % (inchangée) |

Tout ce qui dérive des lignes de commande a été recalculé (KPI, courbes mensuelles et hebdomadaires S8 et S17,
marques, marketplaces, catégories, pays, suivi des prix, classement ABC, élasticité). Rien d'autre ne change :
le code de l'app est identique.

### À vérifier dans la source

La ligne du 22/04 (123,30 € pour **1 unité**) vaut environ le double du prix habituel de l'ARIA 1000W
sur ManoMano (≈ 58 € HT). Prise telle quelle, elle fait passer l'élasticité-prix ARIA 1000W × ManoMano
de −5,22 à −4,93 (un seul point extrême suffit à la déplacer). Si c'est une erreur de saisie, dites-le :
on la corrige ou on l'exclut.

### À savoir

- Le tableau « simulation d'une hausse de +5 % » (onglet Suivi Prix) repose sur un calcul d'élasticité un peu plus ancien
  que la table d'élasticité de l'app (ex. ARIA 1000W × Leroy Merlin : −6,26 dans la simulation, −6,30 dans la table).
  Il n'a pas été modifié ; il peut être recalculé sur demande.
- Les ventes **ne vont toujours pas au-delà du 19/09/2026**.

## Pour passer à début octobre

Envoie l'onglet **« Lignes ODP »** exporté **après le 19/09** (Excel ou CSV avec les mêmes colonnes) : les ventes
du 20/09 à aujourd'hui seront intégrées et tous les KPI recalculés comme ci-dessus.

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

- Données publicitaires : le fichier « Dépenses budget marketing 2026 – year to date » ne contient des dépenses
  que de janvier à juin. Les % de budget consommé sont donc sous-estimés ; une mention est affichée dans l'onglet Campagnes Ads.
- « Autre » : son évolution (−30 %) n'est pas interprétable (des canaux récents ont pu y être classés).
- Le bouton « Voir le détail dans Supply » (onglet supprimé, il ouvrait une page vide) a été retiré.
