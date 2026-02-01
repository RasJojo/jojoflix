import type { HttpContext } from '@adonisjs/core/http'
import RecommendationService from '#services/recommendation_service'
import TmdbService from '#services/tmdb_service'
import WatchHistory from '#models/watch_history'
import Profile from '#models/profile'

export default class HomeController {
  private getMediaTitle(meta: { title?: string; name?: string }) {
    return meta.title ?? meta.name ?? ''
  }

  async show({ auth, params, response }: HttpContext) {
    const user = auth.getUserOrFail()

    const profile = await Profile.query()
      .where('id', params.profile_id)
      .where('user_id', user.id)
      .firstOrFail()

    const tmdb = new TmdbService()
    const recommendationService = new RecommendationService()
    const rows = await recommendationService.generateHomeRows(profile.id)
    const watchlistEntries = Array.isArray(profile.preferences?.watchlist)
      ? profile.preferences.watchlist
      : []

    const continueWatchingRaw = await WatchHistory.query()
      .where('profile_id', profile.id)
      .where('is_finished', false)
      .where('current_time', '>', 0)
      .orderBy('updated_at', 'desc')
      .limit(100)

    // Une seule entrée par œuvre dans "Continuer à regarder".
    // Le tri par updated_at DESC garantit que la première occurrence
    // correspond au dernier épisode/film consulté.
    const seenWorks = new Set<string>()
    const continueWatching = continueWatchingRaw
      .filter((h) => {
        const workKey = `${h.mediaType}:${h.tmdbId}`
        if (seenWorks.has(workKey)) return false
        seenWorks.add(workKey)
        return true
      })
      .slice(0, 20)

    // Enrichir avec les métadonnées TMDB (titre, poster, backdrop)
    const enrichedContinue = await Promise.all(
      continueWatching.map(async (h) => {
        try {
          let meta: any
          if (h.mediaType === 'movie') {
            meta = await tmdb.getMovie(Number(h.tmdbId))
          } else {
            meta = await tmdb.getTvShow(Number(h.tmdbId))
          }
          return {
            tmdb_id: h.tmdbId,
            media_type: h.mediaType,
            title: meta.title ?? meta.name,
            poster_url: meta.poster_url,
            backdrop_url: meta.backdrop_url,
            season_num: h.seasonNum,
            episode_num: h.episodeNum,
            current_time: h.currentTime,
            total_duration: h.totalDuration,
            progress: h.totalDuration > 0 ? h.currentTime / h.totalDuration : 0,
          }
        } catch {
          return {
            tmdb_id: h.tmdbId,
            media_type: h.mediaType,
            title: h.tmdbId,
            poster_url: null,
            backdrop_url: null,
            season_num: h.seasonNum,
            episode_num: h.episodeNum,
            current_time: h.currentTime,
            total_duration: h.totalDuration,
            progress: h.totalDuration > 0 ? h.currentTime / h.totalDuration : 0,
          }
        }
      })
    )

    const enrichedWatchlist = await Promise.all(
      watchlistEntries.slice(0, 20).map(async (entry: any) => {
        try {
          const mediaType = entry?.media_type === 'tv' ? 'tv' : 'movie'
          const tmdbId = String(entry?.tmdb_id ?? '').trim()
          if (!tmdbId) return null

          const meta =
            mediaType === 'tv'
              ? await tmdb.getTvShow(Number(tmdbId))
              : await tmdb.getMovie(Number(tmdbId))

          return {
            tmdb_id: tmdbId,
            media_type: mediaType,
            title: this.getMediaTitle(meta),
            poster_url: meta.poster_url,
            backdrop_url: meta.backdrop_url,
            current_time: null,
            total_duration: null,
            progress: null,
          }
        } catch {
          return null
        }
      })
    )

    const watchlistItems = enrichedWatchlist.filter((item): item is NonNullable<typeof item> => item !== null)

    const allRows = [
      ...(enrichedContinue.length > 0
        ? [{ type: 'continue_watching', title: 'Continuer de regarder', items: enrichedContinue }]
        : []),
      ...(watchlistItems.length > 0
        ? [
            {
              type: 'watchlist',
              title: 'Ma liste',
              items: watchlistItems,
            },
          ]
        : []),
      ...rows,
    ]

    return response.ok({ data: { rows: allRows } })
  }
}
