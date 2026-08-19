# hom'y — Pilotage Bestherm & Thomson

Application de suivi KPI, prête à déployer. Ce dossier est un projet **Vite + React + Tailwind** standard.

## Ce que Claude a préparé
- `src/App.jsx` — l'application complète (dashboard + écran d'entrée)
- `package.json` — toutes les dépendances déclarées (React, Recharts, Lucide, Tailwind)
- Fichiers de config Vite/Tailwind/PostCSS déjà écrits, rien à modifier

## Ce que Claude n'a PAS pu faire
Cet environnement n'a pas d'accès internet — je n'ai donc **pas pu exécuter `npm install` ni `npm run build`** pour vérifier que le projet compile réellement. La structure est standard et j'ai vérifié la syntaxe du code à la main, mais un test réel (par toi, ou par Vercel automatiquement à l'étape 3 ci-dessous) reste nécessaire avant de considérer que c'est 100% fonctionnel.

## Déploiement — 100% navigateur, sans rien installer

### Étape 1 — Créer le dépôt sur GitHub
1. Va sur [github.com/new](https://github.com/new)
2. Nom du dépôt : `homy-pilotage` (ou ce que tu veux)
3. Laisse "Public" ou "Private" selon ta préférence, ne coche aucune case d'initialisation
4. Clique **Create repository**

### Étape 2 — Envoyer les fichiers
Sur la page du dépôt vide qui s'affiche :
1. Clique **uploading an existing file**
2. Si tu es sur ordinateur : dézippe le fichier que je te donne, puis glisse **tout le contenu du dossier** (pas le dossier lui-même, son contenu) dans la zone d'upload — `src/`, `package.json`, `index.html`, etc.
3. Si le glisser-déposer d'un dossier ne fonctionne pas depuis ton navigateur : utilise plutôt **Add file → Create new file** pour chaque fichier, et colle le contenu à la main (plus long mais fonctionne toujours)
4. En bas de page, clique **Commit changes**

### Étape 3 — Déployer sur Vercel
1. Va sur [vercel.com/new](https://vercel.com/new)
2. Connecte-toi avec ton compte GitHub (bouton "Continue with GitHub")
3. Sélectionne le dépôt `homy-pilotage` dans la liste
4. Vercel détecte automatiquement "Vite" — ne change rien aux réglages proposés
5. Clique **Deploy**
6. Après 1-2 minutes, tu obtiens une URL du type `homy-pilotage.vercel.app` — c'est ton app, en ligne

### Si le build échoue à l'étape 3
Vercel affichera un journal d'erreur (onglet "Build Logs"). Copie-colle ce message d'erreur ici dans le chat — c'est le moyen le plus rapide pour moi de corriger, plutôt que de deviner.

## Rappel important
Le mot de passe (`Anthony<3`) est visible dans le code source (`src/App.jsx`) — n'importe qui sachant ouvrir les outils développeur du navigateur peut le lire. C'est un verrou d'accès simple, pas une vraie sécurité.
