import { DateTime } from 'luxon'
import ProfileInterest from '#models/profile_interest'
import WatchHistory from '#models/watch_history'
import TmdbService from '#services/tmdb_service'
import db from '@adonisjs/lucid/services/db'

const DECAY_DAYS_THRESHOLD = 30
const DECAY_AMOUNT = 0.5
const AFFINITY_INCREMENT = 2.0
const COLD_START_SCORE = 10.0

export default class RecommendationService {
  private readonly tmdb: TmdbService

  constructor() {
    this.tmdb = new TmdbService()
  }

  /**
   * Appelé quand un contenu est terminé (is_finished = true).
   * Met à jour affinity_score + applique le decay.
   */
  async onContentFinished(profileId: number, tmdbId: string, mediaType: 'movie' | 'tv'): Promise<void> {
    // Récupérer les genres du contenu depuis TMDB
    let genreIds: number[] = []
    try {
      if (mediaType === 'movie') {
        const movie = await this.tmdb.getMovie(Number(tmdbId))
        genreIds = movie.genre_ids
      } else {
        const show = await this.tmdb.getTvShow(Number(tmdbId))
        genreIds = show.genre_ids
      }
    } catch {
      return // TMDB indisponible — on skip silencieusement
    }

    const now = DateTime.now()

    // Upsert affinity_score pour chaque genre du contenu
    for (const genreId of genreIds) {
      const existing = await ProfileInterest.query()
        .where('profile_id', profileId)
        .where('genre_id', genreId)
        .first()

      if (existing) {
        existing.affinityScore += AFFINITY_INCREMENT
        existing.lastWatchedAt = now
        await existing.save()
      } else {
        await ProfileInterest.create({
          profileId,
          genreId,
          affinityScore: COLD_START_SCORE + AFFINITY_INCREMENT,
          lastWatchedAt: now,
        })
      }
    }

    // Decay -0.5 sur les genres non regardés depuis plus de 30 jours
    const decayCutoff = now.minus({ days: DECAY_DAYS_THRESHOLD }).toISO()
    await db
      .from('profile_interests')
      .where('profile_id', profileId)
      .whereNotIn('genre_id', genreIds)
      .where((q) => {
        q.whereNull('last_watched_at').orWhere('last_watched_at', '<', decayCutoff)
      })
      .decrement('affinity_score', DECAY_AMOUNT)
  }

  /**
   * Génère les rangées de la home page pour un profil.
   */
  async generateHomeRows(profileId: number): Promise<HomeRow[]> {
    const rows: HomeRow[] = []

    // Rangée 1 : "Parce que vous avez vu X" — TMDB Similar du dernier visionnage
    const lastWatched = await WatchHistory.query()
      .where('profile_id', profileId)
      .orderBy('updated_at', 'desc')
      .first()

    if (lastWatched) {
      try {
        const similar =
          lastWatched.mediaType === 'movie'
            ? await this.tmdb.getSimilarMovies(Number(lastWatched.tmdbId))
            : await this.tmdb.getSimilarShows(Number(lastWatched.tmdbId))

        if (similar.length > 0) {
          const title =
            lastWatched.mediaType === 'movie'
              ? (await this.tmdb.getMovie(Number(lastWatched.tmdbId))).title
              : (await this.tmdb.getTvShow(Number(lastWatched.tmdbId))).name

          rows.push({
            type: 'similar',
            title: `Parce que vous avez vu ${title}`,
            items: similar.slice(0, 20).map(this.normalizeItem),
          })
        }
      } catch {
        // TMDB indisponible — on skip
      }
    }

    // Rangée 2 : "Vos Genres Favoris" — Top 3 genre_id par affinity_score
    const topGenres = await ProfileInterest.query()
      .where('profile_id', profileId)
      .orderBy('affinity_score', 'desc')
      .limit(3)

    for (const interest of topGenres) {
      try {
        const items = await this.tmdb.getTrendingByGenre(interest.genreId, 'movie')
        if (items.length > 0) {
          rows.push({
            type: 'genre',
            title: 'Vos Genres Favoris',
            items: items.slice(0, 20).map(this.normalizeItem),
          })
          break // Une seule rangée genres favoris
        }
      } catch {
        // skip
      }
    }

    // Rangée 3 : "Populaire sur la plateforme" — agrégation watch_histories globales
    const popular = await db
      .from('watch_histories')
      .select('tmdb_id', 'media_type')
      .count('* as views')
      .groupBy('tmdb_id', 'media_type')
      .orderBy('views', 'desc')
      .limit(20)

    if (popular.length > 0) {
      const popularItems = await Promise.allSettled(
        popular.map(async (row) => {
          if (row.media_type === 'movie') {
            return this.normalizeItem(await this.tmdb.getMovie(Number(row.tmdb_id)))
          }
          return this.normalizeItem(await this.tmdb.getTvShow(Number(row.tmdb_id)))
        })
      )

      const successItems = popularItems
        .filter((r): r is PromiseFulfilledResult<HomeItem> => r.status === 'fulfilled')
        .map((r) => r.value)

      if (successItems.length > 0) {
        rows.push({
          type: 'popular',
          title: 'Populaire sur la plateforme',
          items: successItems,
        })
      }
    }

    // Rangée 4 : "Tendances cette semaine" — toujours affiché (cold start)
    try {
      const trendingMovies = await this.tmdb.getTrending('movie', 'week')
      const trendingSeries = await this.tmdb.getTrending('tv', 'week')
      if (trendingMovies.length > 0) {
        rows.push({
          type: 'popular',
          title: 'Films tendance cette semaine',
          items: trendingMovies.slice(0, 20).map(this.normalizeItem),
        })
      }
      if (trendingSeries.length > 0) {
        rows.push({
          type: 'popular',
          title: 'Séries tendance cette semaine',
          items: trendingSeries.slice(0, 20).map(this.normalizeItem),
        })
      }
    } catch {
      // TMDB indisponible
    }

    return rows
  }

  private normalizeItem(item: any): HomeItem {
    return {
      tmdb_id: item.tmdb_id,
      title: item.title ?? item.name,
      media_type: item.title ? 'movie' : 'tv',
      poster_url: item.poster_url,
      backdrop_url: item.backdrop_url,
    }
  }
}

export interface HomeItem {
  tmdb_id: number
  title: string
  media_type: 'movie' | 'tv'
  poster_url: string | null
  backdrop_url: string | null
}

export interface HomeRow {
  type: 'similar' | 'genre' | 'popular'
  title: string
  items: HomeItem[]
}
