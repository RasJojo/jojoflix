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

## 🏗️ Architecture Système

```mermaid
graph TB
    subgraph clients["📱 Client Applications"]
        android["Android<br/>(Mobile)"]
        ios["iOS<br/>(Mobile)"]
        macos["macOS<br/>(Desktop)"]
        web["Web<br/>(Nginx)"]
        windows["Windows<br/>(Minimal)"]
    end
    
    clients -->|"HTTPS<br/>Bearer Token"| nginx["🔀 NGINX Reverse Proxy<br/>Port 80/443"]
    
    subgraph backend["⚙️ Backend Services"]
        api["API AdonisJS v6<br/>Port 3333<br/><br/>Controllers:<br/>• /auth<br/>• /media<br/>• /progress<br/>• /streaming<br/>• /subtitles"]
    end
    
    subgraph external["🌐 External Services"]
        tmdb["TMDB API<br/>Metadata"]
        rd["Real-Debrid<br/>Streaming Proxy"]
        subsense["SubSense<br/>Subtitles"]
        mediafusion["MediaFusion<br/>Torrent Sources"]
    end
    
    nginx --> api
    api --> tmdb
    api --> rd
    api --> subsense
    api --> mediafusion
    
    subgraph storage["💾 Data Layer"]
        postgres["PostgreSQL<br/>Database<br/><br/>• Users<br/>• Profiles<br/>• Watch History<br/>• Markers"]
        redis["Redis Cache<br/><br/>• Sessions<br/>• Streams<br/>• Cached Data"]
        filesystem["File System<br/><br/>• Subtitles .vtt<br/>• Metadata"]
    end
    
    api --> postgres
    api --> redis
    api --> filesystem
    
    style clients fill:#e1f5ff
    style backend fill:#f3e5f5
    style external fill:#e8f5e9
    style storage fill:#fff3e0
```

---

## 📊 Flux de Données

### 1️⃣ Authentication Flow

```mermaid
sequenceDiagram
    participant User as User (App)
    participant API as API Backend
    participant DB as PostgreSQL
    participant Redis as Redis
    
    User->>API: POST /auth/login<br/>{email, password}
    API->>DB: Query user by email
    DB-->>API: User record
    API->>API: Verify password (bcrypt)
    API->>DB: Create AccessToken
    DB-->>API: Token stored
    API->>Redis: Store session<br/>TTL: 7 days
    Redis-->>API: ✅ Cached
    API-->>User: Bearer Token<br/>+ User Data
    Note over User: Store in secure storage<br/>Include in all requests
```

### 2️⃣ Media Discovery Flow

```mermaid
sequenceDiagram
    participant User as User (App)
    participant API as API Backend
    participant Redis as Redis Cache
    participant DB as PostgreSQL
    participant TMDB as TMDB API
    
    User->>API: GET /api/home<br/>+ Bearer Token
    API->>Redis: Check cache
    alt Cached (TTL valid)
        Redis-->>API: Return cached data
        API-->>User: ✅ Fast response
    else Cache miss
        API->>DB: Query watch_history<br/>for active profile
        DB-->>API: Raw records
        API->>TMDB: Enrich with metadata<br/>(poster, backdrop, rating)
        TMDB-->>API: Enhanced data
        API->>Redis: Cache 5 minutes TTL
        API-->>User: {continueWatching, trending}
    end
```

### 3️⃣ Streaming & Source Selection Flow

```mermaid
graph LR
    A["🎬 User Clicks Play"] -->|GET /streaming/sources| B["API Backend"]
    
    B --> C{Redis Cache?}
    C -->|Hit| D["Return cached<br/>sources"]
    C -->|Miss| E["Fetch Torrents<br/>MediaFusion/Torrentio"]
    
    E --> F["📊 Score & Rank<br/>Algorithm"]
    F --> F1["Quality Boost<br/>1080p: +25%"]
    F --> F2["Language Boost<br/>VOSTFR: +35%"]
    F --> F3["Seeders Score<br/>+25%"]
    F --> F4["Reputation<br/>+15%"]
    
    F1 & F2 & F3 & F4 --> G["🎯 Ranked Sources"]
    
    G --> H["Real-Debrid<br/>Stream Proxy"]
    H --> I["Get Direct URL<br/>+ Duration"]
    
    I --> J["SubSense<br/>Subtitles"]
    J --> K["Cache All<br/>1 hour TTL"]
    
    K --> L["Return to App<br/>Best source selected"]
    D --> L
    
    L --> M["📱 App<br/>Initializes Player"]
    
    style A fill:#e1f5ff
    style G fill:#f3e5f5
    style H fill:#fff3e0
    style M fill:#e8f5e9
```

### 4️⃣ Intelligent Ranking Algorithm

```mermaid
graph TD
    A["Torrent Source"] --> B["Extract Metadata"]
    B --> B1["Resolution<br/>1080p, 720p, etc"]
    B --> B2["Language<br/>FR, ENG, etc"]
    B --> B3["Seeders<br/>Count"]
    B --> B4["Explicit Labels<br/>Detect"]
    
    B1 --> C["🧮 Calculate Score"]
    B2 --> C
    B3 --> C
    B4 --> C
    
    C --> D["Score = <br/>quality×0.25 +<br/>language×0.35 +<br/>seeders×0.25 +<br/>reputation×0.15"]
    
    D --> E{Score > 7?}
    E -->|YES| F["✅ Recommended<br/>Show to user"]
    E -->|NO| G["❌ Hidden<br/>Fallback option"]
    
    F --> H["[1080p VOSTFR]<br/>Score: 8.5"]
    G --> I["[720p ENG]<br/>Score: 7.2"]
    
    style C fill:#f3e5f5
    style H fill:#c8e6c9
    style I fill:#ffccbc
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

```mermaid
graph TD
    subgraph screens["📱 Screens"]
        login["LoginScreen<br/>Email/Password<br/>+ Toggle Register"]
        profiles["ProfilesScreen<br/>Select/Create<br/>Profile"]
        home["HomeScreen<br/>Hero Banner<br/>Continue Watching<br/>Trending"]
        detail["DetailScreen<br/>Backdrop<br/>Cast<br/>Seasons/Episodes"]
        player["PlayerScreen<br/>media_kit player<br/>Gesture controls<br/>PiP mode"]
        search["SearchScreen<br/>TMDB Search<br/>Multi-type"]
    end
    
    subgraph providers["🔄 State Providers"]
        auth["authStateProvider<br/>Token + User"]
        profile["profileProvider<br/>Active Profile"]
        player_state["videoPlayerProvider<br/>Playback State"]
    end
    
    subgraph repos["💾 Repositories"]
        auth_repo["authRepository"]
        detail_repo["detailRepository"]
        source_repo["sourceRepository"]
        progress_repo["progressRepository"]
    end
    
    login --> auth
    profiles --> profile
    home --> profile
    detail --> player
    search --> detail
    
    auth --> auth_repo
    detail --> detail_repo
    player --> source_repo
    player --> progress_repo
    
    style screens fill:#e1f5ff
    style providers fill:#f3e5f5
    style repos fill:#fff3e0
```

---

## 🚀 Installation & Démarrage

### Prerequis
```bash
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

```mermaid
graph LR
    A["User Account"] --> B["Profile 1<br/>Moi"]
    A --> C["Profile 2<br/>Partner"]
    A --> D["Profile 3<br/>Kids<br/>Filtré"]
    
    B --> E["watch_history<br/>indépendante"]
    C --> F["watch_history<br/>indépendante"]
    D --> G["watch_history<br/>indépendante"]
    
    E --> H["Recommandations<br/>personnalisées"]
    F --> H
    G --> H
    
    style A fill:#f3e5f5
    style B fill:#c8e6c9
    style C fill:#c8e6c9
    style D fill:#ffccbc
```

### Système de caching

```mermaid
graph TD
    A["Request"] --> B{In Redis Cache?}
    B -->|YES| C{TTL valid?}
    C -->|YES| D["Return cached<br/>✅ Fast"]
    C -->|NO| E["Delete stale<br/>Fetch fresh"]
    B -->|NO| E
    E --> F["Process request<br/>⚙️ Compute"]
    F --> G["Store in Redis<br/>with TTL"]
    G --> H["Return to client"]
    D --> H
    
    style D fill:#c8e6c9
    style H fill:#e1f5ff
```

---

## 🐛 Dépannage courant

| Problème | Solution |
|----------|----------|
| **Login échoue** | Vérifier API_BASE_URL au build, certificat SSL, backend running |
| **Pas de sources** | Vérifier Real-Debrid API key, quota atteint? |
| **Subtitles manquent** | Vérifier SubSense API key, language code |
| **Lag lecteur** | Réduire qualité source, vérifier bande passante |
| **Crash au démarrage** | `flutter clean` puis rebuild, version Flutter à jour? |

---

## 📖 Références

- **Backend**: [AdonisJS v6 Docs](https://docs.adonisjs.com/)
- **Frontend**: [Flutter Docs](https://flutter.dev/docs)
- **APIs**: [TMDB](https://developer.themoviedb.org/), [Real-Debrid](https://api.real-debrid.com/), [SubSense](https://subsense.dev/)
- **Streaming**: [MediaFusion](https://mediafusion.dev/), [Torrentio](https://torrentio.stremio.com/)

---

**Made with ❤️ • Self-hosted streaming made simple**
