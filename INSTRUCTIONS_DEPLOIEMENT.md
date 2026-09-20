# Déploiement du backend sécurisé — homy-pilotage

## Correctif du 20 septembre — "mot de passe incorrect" à tort

Si tu avais l'erreur "mot de passe incorrect" alors que tu tapais le bon :
`api/login.mjs` avait une faille qui pouvait faire lire un mot de passe vide
au lieu du vrai, selon la façon exacte dont Vercel transmet la requête.
Corrigé et testé dans ce paquet — remplace `api/login.mjs` par cette
nouvelle version (les autres fichiers n'ont pas changé).

## Ce qui a changé

L'app ne contient plus aucune donnée d'entreprise dans son code. Le mot de
passe est vérifié par une fonction serveur, et les données ne sont envoyées
au navigateur qu'après une connexion réussie. Avant : tout (CA, prix,
catalogue, objectifs) était visible dans le code source dès le chargement de
la page, mot de passe ou pas. Maintenant : le fichier de code fait 390 Ko au
lieu de 1,56 Mo, et les vraies données vivent uniquement dans une fonction
serveur.

## Fichiers de ce livrable

- `App.jsx` — remplace ton fichier actuel à la racine du projet
- `api/login.mjs` — nouvelle fonction serveur (connexion)
- `api/data.mjs` — nouvelle fonction serveur (service des données)
- `api/_data.json` — les données elles-mêmes (1,13 Mo) — **ce fichier contient
  tout ton CA, tes prix, ton catalogue : ne le mets jamais dans `/public`,
  seulement dans `/api` comme indiqué ci-dessous**

## Étape 1 — Ajouter les fichiers dans GitHub

Dans ton dépôt `homy-pilotage` :
1. Remplace `App.jsx` à la racine par la nouvelle version
2. Crée un dossier `api` à la racine (au même niveau que `App.jsx`, PAS dans `src`)
3. Dépose dedans les 3 fichiers : `login.mjs`, `data.mjs`, `_data.json`

Structure attendue :
```
homy-pilotage/
├── App.jsx
├── main.jsx
├── index.html
├── package.json
├── api/
│   ├── login.mjs
│   ├── data.mjs
│   └── _data.json
```

## Étape 2 — Configurer les deux variables d'environnement sur Vercel

Sans elles, les fonctions serveur refusent de démarrer (erreur 500
volontaire plutôt que de tourner sans protection).

1. Va sur vercel.com → ton projet `homy-pilotage` → **Settings** → **Environment Variables**
2. Ajoute :

| Nom | Valeur | Exemple |
|---|---|---|
| `APP_PASSWORD` | Le mot de passe de connexion à l'app | (choisis-en un nouveau, plus long qu'"Anthony<3") |
| `SESSION_SECRET` | Une chaîne aléatoire longue, connue de toi seul | `5dd192898de95f5748380ac71abead24cf5a66f7bb2d02150d17a554f4430ffe` |

Pour `SESSION_SECRET`, utilise l'exemple généré ci-dessus ou génère le tien
(n'importe quelle chaîne aléatoire longue convient — ce n'est pas un mot de
passe à retenir, juste une clé technique). Ne le réutilise nulle part
ailleurs.

3. Coche les 3 environnements (Production, Preview, Development) pour
   chaque variable, puis sauvegarde.

## Étape 3 — Déployer

Commit + push comme d'habitude. Vercel redéploie automatiquement et détecte
le dossier `api/` pour créer les deux fonctions serveur — aucune
configuration Vercel supplémentaire n'est nécessaire.

## Étape 4 — Vérifier

1. Ouvre l'app dans une **fenêtre de navigation privée** (pour partir sans
   session)
2. Tu dois voir l'écran de connexion comme avant
3. Entre le nouveau mot de passe (celui mis dans `APP_PASSWORD`) → l'app doit
   se déverrouiller normalement
4. Recharge la page : tu ne devrais **pas** avoir à retaper le mot de passe
   (la session dure 12h)
5. Pour confirmer que les données sont bien protégées : dans un navigateur
   SANS être connecté, va sur `https://ton-app.vercel.app/api/data`
   directement — tu dois voir `{"error":"unauthorized"}`, pas tes données

Si l'étape 5 affiche autre chose que l'erreur, préviens-moi avant d'aller
plus loin.

## Si "mot de passe incorrect" persiste après ce correctif

1. Vérifie que la variable `APP_PASSWORD` a bien été **sauvegardée** sur
   Vercel (Settings → Environment Variables) — pas juste tapée sans cliquer
   sur Save
2. Vérifie qu'il n'y a pas d'espace collé par erreur avant/après la valeur
3. **Redéploie après avoir modifié une variable d'environnement** — Vercel
   ne l'applique pas rétroactivement à un déploiement déjà en ligne. Sur
   Vercel : Deployments → les trois points sur le dernier déploiement →
   Redeploy
4. Vérifie que tu remplaces bien `api/login.mjs` (pas seulement `App.jsx`)
   lors de l'upload sur GitHub

## Ce qui n'a pas changé

Rien côté visuel ni fonctionnel — c'est exactement la même app, avec la même
apparence et le même comportement. Seule la façon dont les données arrivent
jusqu'au navigateur a changé.
