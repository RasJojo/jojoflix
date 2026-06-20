/*
|--------------------------------------------------------------------------
| Routes file
|--------------------------------------------------------------------------
|
| The routes file is used for defining the HTTP routes.
|
*/

import { middleware } from '#start/kernel'
import router from '@adonisjs/core/services/router'
import { controllers } from '#generated/controllers'
import ProfilesController from '#controllers/profiles_controller'
import HomeController from '#controllers/home_controller'
import StreamingController from '#controllers/streaming_controller'
import TranscodeController from '#controllers/transcode_controller'
import SubtitlesController from '#controllers/subtitles_controller'
import ProgressController from '#controllers/progress_controller'
import MediaController from '#controllers/media_controller'
import PeopleController from '#controllers/people_controller'
import WatchlistController from '#controllers/watchlist_controller'
import DownloadController from '#controllers/download_controller'
import HealthController from '#controllers/health_controller'

router.get('/', () => {
  return { status: 'ok', service: 'jojoflix-api' }
})

router.get('/health', () => {
  return { status: 'ok', service: 'jojoflix-api' }
})
router.get('/health/deep', [HealthController, 'deep'])

router
  .group(() => {
    router.get('health', () => {
      return { status: 'ok', service: 'jojoflix-api' }
    })

    // ── Auth ────────────────────────────────────────────────────────────────
    router
      .group(() => {
        router.post('register', [controllers.NewAccount, 'store'])
        router.post('login', [controllers.AccessToken, 'store'])
        router.post('logout', [controllers.AccessToken, 'destroy']).use(middleware.auth())
      })
      .prefix('auth')

    // ── Profiles ─────────────────────────────────────────────────────────────
    router
      .group(() => {
        router.get('/', [ProfilesController, 'index'])
        router.post('/', [ProfilesController, 'store'])
        router.put('/:id', [ProfilesController, 'update'])
        router.delete('/:id', [ProfilesController, 'destroy'])
        router.post('/:id/select', [ProfilesController, 'select'])
      })
      .prefix('profiles')
      .use(middleware.auth())

    // ── Home ─────────────────────────────────────────────────────────────────
    router.get('home/:profile_id', [HomeController, 'show']).use(middleware.auth())
    router.get('browse/:mediaType', [HomeController, 'browse']).use(middleware.auth())

    // ── Sources (sélecteur manuel) ────────────────────────────────────────────
    router
      .group(() => {
        router.get('movie/:tmdb_id', [StreamingController, 'movieSources'])
        router.get('tv/:tmdb_id/s/:season/e/:episode', [StreamingController, 'tvSources'])
      })
      .prefix('sources')
      .use(middleware.auth())

    // ── Streaming Proxy ───────────────────────────────────────────────────────
    router
      .group(() => {
        router.get('prewarm/tv/:tmdb_id/s/:season/e/:episode', [StreamingController, 'prewarmTvEpisode'])
        router.get('movie/:tmdb_id', [StreamingController, 'movie'])
        router.get('tv/:tmdb_id/s/:season/e/:episode', [StreamingController, 'tvEpisode'])
      })
      .prefix('stream')
      // Auth gérée dans StreamingController pour supporter Bearer + ?token=.

    // ── Subtitles & Markers ───────────────────────────────────────────────────
    router
      .group(() => {
        router.get('list/:tmdb_id', [SubtitlesController, 'list'])       // liste sans quota
        router.post('download', [SubtitlesController, 'download'])        // télécharge sur demande
        router.get('vtt/:id', [SubtitlesController, 'serveVtt'])          // proxy .vtt
        router.get('markers/:tmdb_id', [SubtitlesController, 'markers'])
        router.post('markers', [SubtitlesController, 'storeMarker'])
      })
      .prefix('subtitles')
      // Auth gérée dans SubtitlesController pour supporter Bearer + ?token= sur /vtt.

    // ── Media detail + Search ─────────────────────────────────────────────────
    router.get('media/:mediaType/:tmdbId', [MediaController, 'show']).use(middleware.auth())
    router.get('search', [MediaController, 'search']).use(middleware.auth())
    router.get('people/:personId', [PeopleController, 'show']).use(middleware.auth())

    // ── Watchlist ──────────────────────────────────────────────────────────────
    router
      .group(() => {
        router.get('/:id/watchlist', [WatchlistController, 'index'])
        router.post('/:id/watchlist', [WatchlistController, 'store'])
        router.delete('/:id/watchlist/:mediaType/:tmdbId', [WatchlistController, 'destroy'])
      })
      .prefix('profiles')
      .use(middleware.auth())

    // ── Transcoding (sélection piste audio via FFmpeg) ────────────────────────
    router
      .group(() => {
        router.get('info', [TranscodeController, 'info'])
        router.get('tracks', [TranscodeController, 'tracks'])
        router.get('subtitle', [TranscodeController, 'subtitle'])
        // audio gère sa propre auth (Bearer header ou ?token= pour media_kit)
        router.get('audio', [TranscodeController, 'audio'])
      })
      .prefix('transcode')

    // ── Download ──────────────────────────────────────────────────────────────
    router
      .group(() => {
        router.get('movie/:tmdb_id', [DownloadController, 'movie'])
        router.get('tv/:tmdb_id/s/:season/e/:episode', [DownloadController, 'tvEpisode'])
        router.get('stream/movie/:tmdb_id', [DownloadController, 'streamMovie'])
        router.get('stream/tv/:tmdb_id/s/:season/e/:episode', [DownloadController, 'streamTvEpisode'])
      })
      .prefix('download')
      .use(middleware.auth())

    // ── Progress ──────────────────────────────────────────────────────────────
    router.get('progress/:mediaType/:tmdbId', [ProgressController, 'show']).use(middleware.auth())
    router.post('progress/sync', [ProgressController, 'sync']).use(middleware.auth())
  })
  .prefix('/api')
