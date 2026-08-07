# Déploiement sur Render

Brigands utilise Node.js, Express et Socket.IO. Il doit être déployé comme **Web Service**, et non comme site statique.

## Déploiement avec le Blueprint

1. Poussez le projet sur un dépôt GitHub ou GitLab.
2. Dans Render, créez un **Blueprint** depuis ce dépôt.
3. Render détecte automatiquement `render.yaml`.
4. Une fois le déploiement terminé, ouvrez directement l’URL `.onrender.com` du service.

Le Blueprint utilise :

- `npm ci` pour installer exactement les dépendances verrouillées ;
- `npm start` pour démarrer le serveur principal ;
- `/health` pour les contrôles de santé ;
- Node.js 20.

## Déploiement manuel

Si vous créez le service sans Blueprint :

- Runtime : `Node`
- Build Command : `npm ci`
- Start Command : `npm start`
- Health Check Path : `/health`

## Persistance

Les salons sont conservés en mémoire. Ils survivent aux déconnexions temporaires, mais disparaissent lors d’un redémarrage ou d’une mise en veille du service. Une seule instance Render doit être utilisée tant qu’aucun stockage partagé n’est ajouté.