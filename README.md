# JojoFlix

Plateforme de streaming self-hosted:
- Backend API: AdonisJS + PostgreSQL + Redis
- Frontend app: Flutter (Android, iOS, macOS, Web)
- Sources: MediaFusion / Torrentio via backend proxy

## Sommaire
1. Prerequis
2. Structure du repo
3. Configuration
4. Lancement local (Docker)
5. Build des clients Flutter
6. Deploiement serveur
7. Commandes utiles
8. Troubleshooting

## 1. Prerequis
- Docker + Docker Compose
- Node.js (pour le backend si run hors Docker)
- Flutter SDK
- Xcode (iOS/macOS), Android SDK (Android)

## 2. Structure du repo
- `jojoflix-api/`: API AdonisJS
- `jojoflix_app/`: app Flutter multiplateforme
- `nginx/`: conf Nginx pour servir le front web + proxy API
- `docker-compose.yml`: stack locale complete (nginx + api + db + redis)
- `Makefile`: commandes de build/restart

## 3. Configuration
Copier `.env.example` vers `.env` puis remplir les valeurs:

```bash
cp .env.example .env
```

Variables critiques:
- `APP_KEY`
- `DB_USER`, `DB_PASSWORD`, `DB_DATABASE`
- `RD_API_KEY`
- `TMDB_API_KEY`
- `OPENSUBS_API_KEY`
- `MEDIAFUSION_URL` (addon manifest)
- `TORRENTIO_URL` (fallback)

## 4. Lancement local (Docker)
### Demarrage complet
```bash
make start
```

### Arret
```bash
make stop
```

### Rebuild backend seulement
```bash
make build-back
```

### Logs API
```bash
make logs
```

## 5. Build des clients Flutter
Depuis `jojoflix_app/`.

### Web (release)
```bash
flutter build web --release --dart-define=API_BASE_URL=https://jojoflixapi.jojoserv.com
```

### macOS (release)
```bash
flutter build macos --release --dart-define=API_BASE_URL=https://jojoflixapi.jojoserv.com
```

### Android (release + install device)
```bash
flutter run -d <ANDROID_DEVICE_ID> --release --no-resident --dart-define=API_BASE_URL=https://jojoflixapi.jojoserv.com
```

### iOS/iPad (release + install device)
```bash
flutter run -d <IOS_DEVICE_ID> --release --no-resident --dart-define=API_BASE_URL=https://jojoflixapi.jojoserv.com
```

## 6. Deploiement serveur (resume)
Exemple de flow utilise:
1. Sync du dossier `jojoflix-api/` vers le serveur
2. Rebuild/restart Docker sur le serveur
3. Verification API

Exemple verification:
```bash
curl https://jojoflixapi.jojoserv.com/
```

Reponse attendue:
```json
{"status":"ok","service":"jojoflix-api"}
```

## 7. Commandes utiles
### Etat git
```bash
git status
git log --oneline --decorate --max-count=20
```

### Qualite backend
```bash
cd jojoflix-api
npm run typecheck
```

### Qualite frontend
```bash
cd jojoflix_app
flutter analyze
```

## 8. Troubleshooting
### Web: lecture moins fiable que natif
Le web depend du moteur media du navigateur (codecs/conteneurs limites). Les plateformes natives (macOS/iOS/Android) sont plus robustes pour MKV, multi-audio, sous-titres complexes.

### `ERR_CONNECTION_REFUSED` en web
- verifier que le serveur statique web est lance
- verifier que l'API distante est joignable
- verifier `API_BASE_URL` utilise au build

### Login KO sur mobile/tablette
- verifier l'URL API utilisee par le build
- verifier certificat/TLS du domaine API
- verifier que le backend tourne (`/` -> status ok)
