# Project History

Ce depot peut etre publie avec une grande quantite de travail deja presente. La
raison est simple: JojoFlix a ete developpe en prive avant d'etre prepare pour
des contributions externes. L'historique Git ne doit donc pas etre lu comme le
seul journal du temps passe sur le projet.

Ce document donne une lecture produit et technique du travail realise, sans
inventer de dates de commits.

## Phases de travail

### Socle app et API

- App Flutter multiplateforme avec routing, authentification, profils et ecrans
  de base.
- API AdonisJS v6 en ESM strict.
- Auth locale avec Better Auth et stockage SQLite.
- Contrat REST stable entre l'app Flutter et l'API.

### Streaming et providers

- Integration TMDB pour metadata, recherche, details, saisons et episodes.
- Integration Real-Debrid pour resoudre les liens streamables.
- Providers Torrentio, MediaFusion et DramaYo derriere l'API.
- Scoring des sources pour privilegier qualite, langue, seeders et reputation.
- Gestion des echecs provider, URLs directes mortes et fallback de sources.

### Player Flutter

- Player base sur `media_kit`.
- Selection de source, reprise de lecture et synchronisation de progression.
- Gestion des sous-titres, pistes audio et cas de transcodage.
- Ajustements mobile/desktop autour du routing et de l'ecran player.

### Sous-titres

- Sources OpenSubtitles, SubDL et SubSource.
- Conversion et service de fichiers VTT.
- Timeouts et protections autour des extractions lentes.
- Markers intro/outro exposes par l'API.

### Convex et donnees applicatives

- Migration des donnees produit vers Convex pour profils, watch history,
  interests, watchlist, markers et cache applicatif.
- `ConvexRepository` centralise les appels aux fonctions `jojoflix:*`.
- `CacheWrapper` stocke les entrees TTL dans Convex.
- Cache court des rows accueil avec `home:rows:v2:${profileId}`.
- Invalidation du cache accueil apres progression et mutation watchlist.
- Reprise TV corrigee par recherche du dernier episode actif.

### Durcissement et exploitation

- Compose et exemples `.env` nettoyes pour eviter les secrets en clair.
- Documentation de reprise dans `AGENTS.md`.
- Checks backend avec `npm run typecheck`.
- Separation entre healthcheck API et verification du chemin playback.

## Comment lire les commits

Un commit massif ou une serie de commits rapproches peut correspondre a un
import public de travail prive. Pour comprendre la logique du projet, lire dans
cet ordre:

1. `README.md` pour l'architecture generale.
2. `AGENTS.md` pour les invariants et commandes de reprise.
3. `jojoflix-api/start/routes.ts` pour la surface HTTP.
4. `jojoflix-api/app/services/convex_repository.ts` pour les donnees Convex.
5. Les controllers API correspondant a la feature touchee.
6. Les repositories/providers Flutter correspondant au flux app.

## Notes pour contributeurs

- Les critiques de bonnes pratiques doivent partir de l'etat actuel du code,
  pas du rythme de publication GitHub.
- Les nouveaux changements doivent etre petits, scopes et verifies.
- Les gros imports doivent etre accompagnes d'une description claire du travail
  embarque et des checks effectues.
- Si une modification touche un secret, il faut le retirer du repo et regenerer
  la cle exposee.
