import type { HttpContext } from '@adonisjs/core/http'
import RecommendationService from '#services/recommendation_service'
import TmdbService from '#services/tmdb_service'
import ConvexRepository from '#services/convex_repository'
import { rememberHomeRows } from '#services/home_cache_service'

export default class HomeController {
  private getMediaTitle(meta: { title?: string; name?: string }) {
    return meta.title ?? meta.name ?? ''
  }

  async show({ betterAuthUser, params, response }: HttpContext) {
    const user = betterAuthUser!
    const repo = new ConvexRepository()

    const profile = await repo.getProfileOfUser(params.profile_id, user.id)
    if (!profile) {
      return response.notFound({
        error: { code: 'NOT_FOUND', message: 'Profil introuvable', status: 404 },
      })
    }

    const allRows = await rememberHomeRows(profile._id, async () => {
      const tmdb = new TmdbService()
      const recommendationService = new RecommendationService()
      const metadataCache = new Map<string, Promise<any>>()
      const getMetadata = (mediaType: 'movie' | 'tv', tmdbId: string) => {
        const key = `${mediaType}:${tmdbId}`
        const existing = metadataCache.get(key)
        if (existing) return existing
        const promise =
          mediaType === 'tv' ? tmdb.getTvShow(Number(tmdbId)) : tmdb.getMovie(Number(tmdbId))
        metadataCache.set(key, promise)
        return promise
      }

      const [rows, continueWatchingRaw] = await Promise.all([
        recommendationService.generateHomeRows(profile._id),
        repo.getActiveWatchHistory(profile._id),
      ])
      const watchlistEntries = Array.isArray(profile.preferences?.watchlist)
        ? profile.preferences.watchlist
        : []

      const seenWorks = new Set<string>()
      const continueWatching = continueWatchingRaw
        .filter((h) => {
          const workKey = `${h.mediaType}:${h.tmdbId}`
          if (seenWorks.has(workKey)) return false
          seenWorks.add(workKey)
          return true
        })
        .slice(0, 20)

      const enrichedContinue = await Promise.all(
        continueWatching.map(async (h) => {
          try {
            const meta = await getMetadata(h.mediaType, h.tmdbId)
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
            return null
          }
        })
      )

      const enrichedWatchlist = await Promise.all(
        watchlistEntries.slice(0, 20).map(async (entry: any) => {
          try {
            const mediaType = entry?.media_type === 'tv' ? 'tv' : 'movie'
            const tmdbId = String(entry?.tmdb_id ?? '').trim()
            if (!tmdbId) return null

            const meta = await getMetadata(mediaType, tmdbId)

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

      const watchlistItems = enrichedWatchlist.filter(
        (item): item is NonNullable<typeof item> => item !== null
      )
      const continueItems = enrichedContinue.filter(
        (item): item is NonNullable<typeof item> => item !== null
      )

      return [
        ...(continueItems.length > 0
          ? [{ type: 'continue_watching', title: 'Continuer de regarder', items: continueItems }]
          : []),
        ...(watchlistItems.length > 0
          ? [{ type: 'watchlist', title: 'Ma liste', items: watchlistItems }]
          : []),
        ...rows,
      ]
    })

    return response.ok({ data: { rows: allRows } })
  }

  async browse({ params, response }: HttpContext) {
    const mediaType = params.mediaType as 'movie' | 'tv'
    if (mediaType !== 'movie' && mediaType !== 'tv') {
      return response.badRequest({ message: 'mediaType must be movie or tv' })
    }

    const tmdb = new TmdbService()

    const genres =
      mediaType === 'movie'
        ? [
            { id: 28, label: 'Action' },
            { id: 35, label: 'Comédie' },
            { id: 18, label: 'Drame' },
            { id: 53, label: 'Thriller' },
            { id: 878, label: 'Science-Fiction' },
            { id: 27, label: 'Horreur' },
          ]
        : [
            { id: 10759, label: 'Action & Aventure' },
            { id: 35, label: 'Comédie' },
            { id: 18, label: 'Drame' },
            { id: 10765, label: 'Science-Fiction & Fantastique' },
            { id: 16, label: 'Animation' },
            { id: 9648, label: 'Mystère' },
          ]

    const [trending, ...genreResults] = await Promise.all([
      tmdb.getTrending(mediaType, 'week'),
      ...genres.map((g) => tmdb.getTrendingByGenre(g.id, mediaType)),
    ])

    const normalize = (item: any) => ({
      tmdb_id: String(item.tmdb_id),
      media_type: mediaType,
      title: (item.title ?? item.name ?? '') as string,
      poster_url: item.poster_url ?? null,
      backdrop_url: item.backdrop_url ?? null,
      current_time: null,
      total_duration: null,
      progress: null,
    })

    const browseRows = [
      {
        type: 'trending',
        title: mediaType === 'movie' ? 'Films tendance' : 'Séries tendance',
        items: trending.map(normalize),
      },
      ...genres.map((g, i) => ({
        type: 'genre',
        title: g.label,
        items: genreResults[i].map(normalize),
      })),
    ]

    return response.ok({ data: { rows: browseRows } })
  }
}
