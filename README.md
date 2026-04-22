# 🎬 JojoFlix

Plateforme de streaming self-hosted multiplateforme avec support complet des sous-titres, profils utilisateur, et sources torrent smart-ranked.

## 🎯 Vue d'ensemble

JojoFlix est une suite complète pour découvrir et regarder du contenu multimédia (films, séries, documentaires) en streaming, avec:

- **Backend puissant**: API AdonisJS v6 (ESM strict), PostgreSQL, Redis cache
- **App multiplateforme**: Flutter (Android, iOS, macOS, Web)
- **Sources intelligentes**: Real-Debrid + Torrentio/MediaFusion avec ranking smart
- **Sous-titres**: Intégration SubSense pour 30+ langues
- **Profiles multiples**: Gestion multi-user comme Netflix
- **Contenu français**: Boost VOSTFR, DramaYo, support complet français

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        CLIENT APPLICATIONS                      │
├──────────┬──────────┬──────────┬──────────┬──────────────────────┤
│ Android  │   iOS    │  macOS   │ Web(Ng) │ Windows (minimal)   │
│ (mobile) │ (mobile) │ (desktop)│ (web)   │                    │
└────┬─────┴────┬─────┴────┬─────┴────┬────┴─────────────┬────────┘
     │          │          │          │                  │
     │   All built with Flutter + Riverpod + go_router   │
     │                                                   │
     └─────────────────────┬──────────────────────────────┘
                           │ HTTPS/Bearer Token
     ┌─────────────────────▼──────────────────────────────┐
     │       NGINX REVERSE PROXY (Port 80/443)           │
     │  • Static web serve • API proxy • SSL termination  │
     └──────────┬──────────────────────────────┬──────────┘
                │                              │
     ┌──────────▼────────────┐    ┌────────────▼──────────┐
     │   API Backend         │    │  External Services   │
     │  (Port 3333)          │    │                      │
     │                       │    │ • TMDB API           │
     │ AdonisJS v6 + ESM    │    │ • Real-Debrid        │
     │ Node 24              │    │ • SubSense           │
     │                       │    │ • MediaFusion        │
     │ Controllers:          │    │ • Torrentio          │
     │ • /auth              │    │                      │
     │ • /media             │    └────────────────────────┘
     │ • /progress          │
     │ • /streaming         │
     │ • /subtitles         │
     │ • /search            │
     │                       │
     └──────────┬────────────┘
                │
    ┌───────────┴──────────────┬────────────┐
    │                          │            │
┌───▼────────────┐   ┌────────▼──┐   ┌────▼─────────┐
│   PostgreSQL   │   │   Redis   │   │ File System  │
│    Database    │   │   Cache   │   │ (Subtitles)  │
│                │   │           │   │              │
│ • Users        │   │ • Session │   │ • .vtt files │
│ • Profiles     │   │ • Streams │   │ • Metadata   │
│ • Watched      │   │ • Cached  │   │              │
│ • Markers      │   │   Data    │   │              │
└────────────────┘   └───────────┘   └──────────────┘
```

---

## 📊 Flux de données

### 1️⃣ Authentication Flow
```
User (App)
    │
    ├─ POST /auth/register
    │   {email, password}
    │
    ├─ POST /auth/login
    │   {email, password}
    │
    ▼
API Backend
    │
    ├─ Hash password (bcrypt)
    ├─ Create AccessToken (opaque, DB-stored)
    ├─ Create Session (Redis)
    │
    ▼
Response + Bearer Token
    │
    ├─ Store in secure storage
    ├─ Use in Authorization header
    │
    ▼
All subsequent requests include token ✅
```

### 2️⃣ Media Discovery Flow
```
User opens Home Screen
    │
    ▼
App calls GET /api/home
    │ + Bearer Token
    ├─ Fetch continue_watching (user profile)
    │
    ▼
API Backend
    │
    ├─ Query DB: watch_history for active profile
    ├─ For each item: enrich with TMDB metadata
    │  (title, poster, backdrop, rating)
    │
    ├─ Redis Cache: store 5-minute TTL
    │
    ▼
Return: {
  continueWatching: [
    {
      tmdbId: 12345,
      title: "Breaking Bad S2E5",
      poster: "...",
      progress: 34%,
      watchedAt: "2026-04-20"
    }
  ],
  trending: [...],
  recommendations: [...]
}
    │
    ▼
App renders with Hero animations ✅
```

### 3️⃣ Streaming & Source Selection Flow
```
User clicks play on media
    │
    ▼
App calls GET /api/streaming/sources/{mediaId}
    │ + bearer token
    │
    ▼
API Backend
    │
    ├─ Query Redis: cached sources (if available)
    │  if (cached && fresh) return sources
    │
    ├─ Fetch from MediaFusion/Torrentio:
    │  GET https://provider.com/search?keyword=Breaking+Bad+S2E5
    │
    ├─ Receive torrent streams:
    │  {
    │    "magnet": "magnet:?xt=...",
    │    "title": "[1080p] Breaking Bad S02E05",
    │    "seeders": 450,
    │    "type": "movie"
    │  }
    │
    ├─ Score & Rank each source:
    │  • Language detection (FR > ENG > OTHER)
    │  • VOSTFR boost (subtitled FR)
    │  • Quality parsing (1080p > 720p > 480p)
    │  • Seed count weight
    │  • Provider reputation
    │  • Explicit label detection
    │
    ├─ Request Real-Debrid stream URL:
    │  POST https://api.real-debrid.com/rest/1.0/unrestrict/link
    │  {link: "magnet:?xt=..."}
    │
    ├─ Receive direct HTTP stream:
    │  {
    │    "filename": "Breaking.Bad.S02E05.1080p.mkv",
    │    "link": "https://rd-stream-12345.realdebrid.com/...",
    │    "filesize": 2147483648,
    │    "duration": 2700
    │  }
    │
    ├─ Fetch subtitles via SubSense:
    │  GET https://subsense-api.com/api/subtitles
    │  {query: "Breaking Bad S2E5", languages: ["fr", "en"]}
    │
    ├─ Cache everything in Redis (1 hour TTL)
    │
    ▼
Return sources with metadata:
{
  sources: [
    {
      id: "1080p-fr-vostfr",
      title: "[1080p] Breaking Bad - S2E5 - VOSTFR",
      quality: "1080p",
      language: "VOSTFR",
      streamUrl: "https://rd-stream.../file.mkv",
      seeders: 450,
      subtitles: [
        {lang: "fr", url: "https://subtitle-store/...vtt"}
      ]
    },
    {id: "720p-en", ...},
    ...
  ]
}
    │
    ▼
App selects best source + subtitles
    │
    ├─ POST /api/streaming/play/{sourceId}
    │  Register in StreamRegistry (prevent concurrent plays)
    │
    ▼
App initializes media_kit player
    │
    ├─ Load stream URL from Real-Debrid
    ├─ Load subtitles VTT
    ├─ Restore position from DB
    │
    ▼
User watches content ✅
    │
    ├─ Every 10 seconds: sync progress
    │  POST /api/progress/update
    │  {mediaId, position: 1200, duration: 2700}
    │
    ▼
On video end
    │
    ├─ Mark as watched
    ├─ Record in watch_history
    ├─ Trigger recommendations engine
    │
    ▼
Complete ✅
```

### 4️⃣ Progress & Watchlist Flow
```
User bookmarks episode / marks as watched
    │
    ▼
App POST /api/progress/sync
    │ {
    │   mediaId: 12345,
    │   position: 1200,
    │   duration: 2700,
    │   watched: true
    │ }
    │
    ▼
API Backend
    │
    ├─ Create/update watch_history record
    ├─ Invalidate Redis cache (continue_watching)
    ├─ Trigger recommendation recalc
    │
    ▼
Sync to all devices ✅
```

---

## 🛠️ Composants clés

### Backend Services

| Service | Rôle |
|---------|------|
| `TmdbService` | Récupère metadata films/séries (couvertures, castings, etc) |
| `RealDebridService` | Proxy vers Real-Debrid, extraction URLs directes |
| `SubtitleService` | Gestion SubSense, conversion VTT, multi-langue |
| `TorrentScoringService` | Ranking intelligent des sources torrents |
| `CacheWrapper` | Redis wrapper pour TTL auto et invalidation |
| `StreamRegistry` | Prévient lectures concurrentes, gère sessions |
| `RecommendationService` | Suggestions basées watch_history + likes |

### App Components

| Composant | Rôle |
|-----------|------|
| `LoginScreen` | Auth email/password + toggle register |
| `ProfilesScreen` | Sélection profil, création, suppression |
| `HomeScreen` | Hero banner, continue watching, trending |
| `DetailScreen` | Backdrop, cast, saisons/épisodes, progression |
| `PlayerScreen` | Media_kit player avec contrôles gestuels |
| `PlayerOverlay` | Contrôles volume/brightness, skip intro |
| `SearchScreen` | Recherche TMDB multi-type (movie/tv/person) |

---

## 🚀 Installation & Démarrage

### Prerequis
```bash
# Vérifier les versions
node -v         # v24+
docker -v       # latest
flutter -v      # 3.22+
```

### 1. Setup Backend

```bash
cd jojoflix-api

# Installer dépendances
npm install

# Configurer environnement
cp .env.example .env
# Éditer .env avec:
# - DB credentials
# - API keys (TMDB, Real-Debrid, SubSense, etc)
# - URLs proxy

# Lancer migrations DB
npm run ace migration:run

# Démarrer backend
npm run dev
# Backend écoute sur http://localhost:3333
```

### 2. Setup Frontend (Flutter)

```bash
cd jojoflix_app

# Installer dépendances
flutter pub get

# Générer fichiers build_runner
flutter pub run build_runner build --delete-conflicting-outputs

# Run sur device/simulator
flutter run --dart-define=API_BASE_URL=http://10.0.2.2:3333
```

### 3. Docker Compose (Complet)

Pour une stack complète (API + DB + Redis + Nginx):

```bash
# Depuis racine du projet
docker compose up --build -d

# Logs
docker compose logs -f api

# Arrêter
docker compose down
```

Services disponibles:
- **API**: `http://localhost:3333`
- **Web (Nginx)**: `http://localhost`
- **DB**: `localhost:5432`
- **Redis**: `localhost:6379`

---

## 📱 Builds & Déploiement

### Build Android (release APK)

```bash
cd jojoflix_app

flutter build apk --release \
  --dart-define=API_BASE_URL=https://api.jojoflix.com

# APK: build/app/outputs/flutter-app.apk
```

### Build iOS (release)

```bash
flutter build ios --release \
  --dart-define=API_BASE_URL=https://api.jojoflix.com

# Ouvrir dans Xcode pour signing + deploy
open ios/Runner.xcworkspace
```

### Deploy Backend

```bash
# Sur serveur, depuis /app/jojoflix-api/
docker compose -f docker-compose.server.yml up -d --build

# Vérifier health
curl https://api.jojoflix.com/
# {"status": "ok", "service": "jojoflix-api"}
```

---

## 🔑 Variables d'environnement

**Backend** (`.env`):
```bash
# Core
APP_KEY=your-secret-key
APP_URL=http://localhost:3333
NODE_ENV=production

# Database
DB_HOST=postgres
DB_PORT=5432
DB_USER=jojoflix
DB_PASSWORD=secure-pwd
DB_DATABASE=jojoflix

# Redis
REDIS_HOST=redis
REDIS_PORT=6379

# APIs externes
TMDB_API_KEY=your_tmdb_key
RD_API_KEY=your_realdebrid_key
SUBSENSE_API_KEY=your_subsense_key
MEDIAFUSION_URL=https://provider/manifest.json
```

**App** (build-time):
```bash
--dart-define=API_BASE_URL=https://api.jojoflix.com
```

---

## 🧪 Tests & Qualité

```bash
# Backend
cd jojoflix-api
npm run typecheck    # Type checking TypeScript
npm run lint         # ESLint

# Frontend
cd jojoflix_app
flutter analyze      # Static analysis
flutter test         # Unit tests
flutter test --coverage
```

---

## 📚 Flux métier détaillés

### Profils utilisateur

Chaque utilisateur peut avoir **plusieurs profils** (comme Netflix):

```
User (account owner)
  │
  ├─ Profile "Moi" (watch_history indépendante)
  ├─ Profile "Partner" (regarde en parallèle)
  └─ Profile "Kids" (contenu filtré)

Lors du login → sélection profil
→ Toutes les données ensuite scopées au profil
```

### Ranking des sources

L'algorithme évalue chaque torrent:

```
Score = (
  quality_boost[resolution] * 0.25 +
  language_boost[language] * 0.35 +
  seeders_score[count] * 0.25 +
  provider_reputation * 0.15
)

Exemple:
[1080p VOSTFR] 450 seeders → Score: 8.5 ⭐ (sélectionné)
[720p ENG] 1200 seeders → Score: 7.2
[480p] 50 seeders → Score: 4.1
```

### Sous-titres & Pistes audio

SubSense détecte automatiquement et mappe les pistes:

```
Torrent: "Breaking.Bad.S02E05.MULTi.1080p.mkv"
  Audio tracks: [fra, eng, ita]
  Subtitle tracks: [fra, eng]

SubSense query:
  → Search "Breaking Bad S2E5"
  → Match source metadata
  → Provide: [FR.srt, EN.srt, etc]

App reconciles:
  → Play eng audio + fr subs (user pref)
```

---

## 🐛 Dépannage courant

| Problème | Solution |
|----------|----------|
| **Login échoue** | Vérifier API_BASE_URL au build, certificat SSL, backend running |
| **Pas de sources** | Vérifier Real-Debrid API key, quota atteint? |
| **Subtitles manquent** | Vérifier SubSense API key, language code |
| **Lag lecteur** | Réduire qualité source, vérifier bande passante, codec incompatible? |
| **Crash au démarrage** | `flutter clean` puis rebuild, version Flutter à jour? |

---

## 📖 Références

- **Backend**: [AdonisJS v6 Docs](https://docs.adonisjs.com/)
- **Frontend**: [Flutter Docs](https://flutter.dev/docs)
- **APIs**: [TMDB](https://developer.themoviedb.org/), [Real-Debrid](https://api.real-debrid.com/), [SubSense](https://subsense.dev/)
- **Streaming**: [MediaFusion](https://mediafusion.dev/), [Torrentio](https://torrentio.stremio.com/)

---

**Made with ❤️ • Self-hosted streaming made simple**
