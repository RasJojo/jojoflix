# JojoFlix Agent Guide

Ce fichier sert de point de reprise rapide pour un contributeur ou agent qui
arrive sur le depot.

## Objectif produit

JojoFlix est une app de streaming self-hosted:

- API AdonisJS dans `jojoflix-api/`.
- App Flutter dans `jojoflix_app/`.
- Monitor web dans `jojoflix_monitor/`.
- Donnees applicatives dans Convex, appelees uniquement par l'API.

La priorite habituelle est de corriger ou optimiser cote backend/API avant de
declencher un rebuild Flutter, tant que le contrat REST existant reste stable.

## Invariants a respecter

- Ne jamais commiter de secret: `.env`, cle Real-Debrid, TMDB, OpenSubtitles,
  SubSource, URL MediaFusion/Torrentio personnalisee, `APP_KEY`, token Convex.
- Garder les payloads REST compatibles avec l'app Flutter.
- Ne pas remplacer une correction backend simple par un changement client si ce
  n'est pas necessaire.
- Verifier les changements dans les fichiers deja modifies avant d'editer:
  l'arbre de travail peut contenir des changements utilisateur.
- Ne pas reinitialiser l'historique Git ou supprimer des changements existants
  sans demande explicite.
- Ne pas antidater artificiellement les commits; preferer des commits
  thematiques et un changelog clair.

## Carte backend

Fichiers a connaitre:

| Chemin | Role |
| --- | --- |
| `start/routes.ts` | Definition des routes HTTP |
| `start/env.ts` | Variables d'environnement requises |
| `app/services/convex_repository.ts` | Client HTTP Convex pour les fonctions `jojoflix:*` |
| `app/services/cache_wrapper.ts` | Cache applicatif stocke dans Convex |
| `app/services/home_cache_service.ts` | Cache court des rows accueil |
| `app/controllers/home_controller.ts` | Home, browse, watchlist row, recommendations |
| `app/controllers/progress_controller.ts` | Sync progression et reprise |
| `app/controllers/watchlist_controller.ts` | Watchlist dans `profile.preferences` |
| `app/services/recommendation_service.ts` | Interets de profil et lignes recommandees |
| `app/controllers/streaming_controller.ts` | Sources, Real-Debrid, streaming |
| `app/controllers/subtitles_controller.ts` | Sous-titres, markers, VTT |

## Convex

Le depot ne contient pas les fonctions Convex elles-memes; l'API suppose qu'un
deploiement Convex expose les chemins `jojoflix:*`.

Domaines stockes dans Convex:

- Profiles.
- Watch history par profil.
- Watchlist dans `profile.preferences.watchlist`.
- Profile interests pour les recommandations.
- Media markers intro/outro.
- Cache entries avec expiration.

Changements recents importants:

- `home:rows:v2:${profileId}` met en cache l'accueil environ 20 secondes.
- `ProgressController.sync` invalide ce cache apres une progression.
- `WatchlistController.store/destroy` invalident ce cache apres mutation.
- La reprise TV prend le dernier episode actif via `getWatchHistoriesByTmdb`.

## Commandes utiles

Backend:

```bash
cd jojoflix-api
npm install
cp .env.example .env
node ace migration:run
npm run dev
```

Checks backend:

```bash
cd jojoflix-api
npm run typecheck
npm run lint
```

Flutter:

```bash
cd jojoflix_app
flutter pub get
dart run build_runner build --delete-conflicting-outputs
flutter run --dart-define=API_BASE_URL=http://localhost:3333
```

Checks Flutter:

```bash
cd jojoflix_app
dart format lib test
flutter analyze
flutter test
```

Stack Docker:

```bash
cp .env.example .env
docker compose up --build -d
docker compose logs -f api
```

## Production

La production connue tourne sur Jarvis. Avant d'agir sur prod, verifier le
runtime reel sur le serveur plutot que de supposer que l'etat local correspond.

Checks rapides utiles:

```bash
curl https://jojoflixapi.jojoserv.com/health
docker ps
docker logs --tail=200 jojoflix-api
```

Un healthcheck vert prouve que l'API repond, pas que le playback fonctionne.
Pour un probleme de lecture, lire les logs de providers: Torrentio, MediaFusion,
Real-Debrid, sous-titres et URLs directes filtrees ou expirees.

## Style de changement

- Garder les changements scopes: controller/service concerne, doc associee,
  test/check minimal.
- Pour une optimisation backend, documenter si le contrat REST est preserve.
- Pour un changement Flutter, verifier `API_BASE_URL`, routing, provider Riverpod
  et comportement mobile/desktop si le fichier touche le player.
- Pour un changement streaming, tester au moins la resolution de sources et le
  cas d'echec provider.
- Pour un changement sous-titres, verifier VTT, timeout et conversion avant de
  toucher au player.
