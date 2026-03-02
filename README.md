# 🎙 Murmur — Tableaux collaboratifs temps réel

Application de type Padlet avec backend Node.js, synchronisation WebSocket et base de données SQLite.

## Stack technique

| Couche | Technologie |
|---|---|
| Serveur HTTP | Node.js + Express |
| Temps réel | Socket.io (WebSocket) |
| Base de données | SQLite via `better-sqlite3` |
| Auth | JWT + bcryptjs (hash du PIN) |
| Frontend | HTML/CSS/JS vanilla |

## Installation

### Prérequis
- Node.js ≥ 18
- npm

### 1. Installer les dépendances

```bash
cd murmur
npm install
```

### 2. Configurer l'environnement

```bash
cp .env.example .env
# Éditez .env et changez JWT_SECRET !
```

### 3. Démarrer le serveur

```bash
# Production
npm start

# Développement (redémarrage automatique)
npm run dev
```

### 4. Ouvrir dans le navigateur

```
http://localhost:3000
```

---

## Architecture

```
murmur/
├── server.js          ← Backend (Express + Socket.io + SQLite)
├── public/
│   └── index.html     ← Frontend SPA
├── package.json
├── .env.example
└── murmur.db          ← Base SQLite (créée automatiquement)
```

## API REST

| Méthode | Route | Auth | Description |
|---|---|---|---|
| POST | `/api/register` | — | Créer un compte |
| POST | `/api/login` | — | Se connecter |
| GET | `/api/boards` | JWT | Lister ses tableaux |
| POST | `/api/boards` | JWT | Créer un tableau |
| GET | `/api/boards/:id` | JWT/public | Détails + cartes |
| PATCH | `/api/boards/:id` | JWT | Renommer / changer partage |
| DELETE | `/api/boards/:id` | JWT | Supprimer |
| POST | `/api/boards/:id/cards` | JWT | Ajouter une note |
| PATCH | `/api/cards/:id` | JWT | Modifier une note |
| DELETE | `/api/cards/:id` | JWT | Supprimer une note |

## Événements Socket.io

| Événement | Direction | Description |
|---|---|---|
| `board:join` | Client → Serveur | Rejoindre un tableau |
| `board:state` | Serveur → Client | État initial |
| `card:added` | Serveur → Clients | Nouvelle note (broadcast) |
| `card:updated` | Serveur → Clients | Note modifiée |
| `card:deleted` | Serveur → Clients | Note supprimée |
| `card:move_live` | Client → Serveur | Déplacement temps réel |
| `card:typing_live` | Client → Serveur | Frappe en direct |
| `board:presence` | Serveur → Clients | Nombre de connectés |

## Déploiement en production

### Sur un VPS (Ubuntu)

```bash
# Installer Node.js
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Cloner / uploader le projet
# puis :
npm install --production

# Avec PM2 pour la persistance
npm install -g pm2
pm2 start server.js --name murmur
pm2 save
pm2 startup
```

### Avec Nginx (reverse proxy)

```nginx
server {
    listen 80;
    server_name votre-domaine.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }
}
```

> N'oubliez pas d'activer HTTPS avec Certbot : `sudo certbot --nginx`
