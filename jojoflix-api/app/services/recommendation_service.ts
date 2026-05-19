import { DateTime } from 'luxon'
import ProfileInterest from '#models/profile_interest'
import WatchHistory from '#models/watch_history'
import TmdbService from '#services/tmdb_service'

const DECAY_DAYS_THRESHOLD = 30
const DECAY_AMOUNT = 0.5
const AFFINITY_INCREMENT = 2.0
const COLD_START_SCORE = 10.0

// TMDB genre IDs stable — pas besoin d'appel réseau pour les labels
const GENRE_NAMES: Record<number, string> = {
  28: 'Action', 12: 'Aventure', 16: 'Animation', 35: 'Comédie',
  80: 'Crime', 99: 'Documentaire', 18: 'Drame', 10751: 'Famille',
  14: 'Fantaisie', 36: 'Histoire', 27: 'Horreur', 9648: 'Mystère',
  10749: 'Romance', 878: 'Science-Fiction', 53: 'Thriller',
  10752: 'Guerre', 37: 'Western', 10759: 'Action & Aventure',
  10762: 'Enfants', 10765: 'Sci-Fi & Fantastique', 10766: 'Soap',
  10768: 'Guerre & Politique',
}

export default class RecommendationService {
  private readonly tmdb: TmdbService

  constructor() {
    this.tmdb = new TmdbService()
  }

  /**
   * Appelé quand un contenu est terminé (is_finished = true).
   * Met à jour affinity_score + applique le decay.
   */
  async onContentFinished(
    profileId: number,
    tmdbId: string,
    mediaType: 'movie' | 'tv'
  ): Promise<void> {
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
      return
    }

    const now = DateTime.now()

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

    // Decay -0.5 sur les genres non regardés depuis > 30 jours
    const decayCutoff = now.minus({ days: DECAY_DAYS_THRESHOLD }).toISO()
    const { default: db } = await import('@adonisjs/lucid/services/db')
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
   * Toutes les fetches indépendantes tournent en parallèle.
   */
  async generateHomeRows(profileId: number): Promise<HomeRow[]> {
    const rows: HomeRow[] = []

    // Charge l'historique et les genres favoris en parallèle
    const [lastWatched, topGenres] = await Promise.all([
      WatchHistory.query()
        .where('profile_id', profileId)
        .orderBy('updated_at', 'desc')
        .first(),
      ProfileInterest.query()
        .where('profile_id', profileId)
        .where('affinity_score', '>', 0)
        .orderBy('affinity_score', 'desc')
        .limit(3),
    ])

    // ── 1. "Parce que vous avez vu X" ──────────────────────────────────────
    if (lastWatched) {
      try {
        const mediaType = lastWatched.mediaType as 'movie' | 'tv'
        const [similar, meta] = await Promise.all([
          mediaType === 'movie'
            ? this.tmdb.getSimilarMovies(Number(lastWatched.tmdbId))
            : this.tmdb.getSimilarShows(Number(lastWatched.tmdbId)),
          mediaType === 'movie'
            ? this.tmdb.getMovie(Number(lastWatched.tmdbId))
            : this.tmdb.getTvShow(Number(lastWatched.tmdbId)),
        ])

        if (similar.length > 0) {
          rows.push({
            type: 'similar',
            title: `Parce que vous avez vu ${(meta as any).title ?? (meta as any).name}`,
            items: similar.slice(0, 20).map((i) => this.normalizeItem(i, mediaType)),
          })
        }
      } catch {}
    }

    // ── 2. Genres favoris — movies + séries en parallèle ───────────────────
    if (topGenres.length > 0) {
      const genreResults = await Promise.all(
        topGenres.flatMap((interest) => [
          this.tmdb.getTrendingByGenre(interest.genreId, 'movie').catch(() => []),
          this.tmdb.getTrendingByGenre(interest.genreId, 'tv').catch(() => []),
        ])
      )

      for (let i = 0; i < topGenres.length; i++) {
        const genreId = topGenres[i].genreId
        const genreName = GENRE_NAMES[genreId] ?? `Genre ${genreId}`
        const movies = genreResults[i * 2]
        const shows = genreResults[i * 2 + 1]

        if (movies.length > 0) {
          rows.push({
            type: 'genre',
            title: `Films · ${genreName}`,
            items: movies.slice(0, 20).map((it) => this.normalizeItem(it, 'movie')),
          })
        }
        if (shows.length > 0) {
          rows.push({
            type: 'genre',
            title: `Séries · ${genreName}`,
            items: shows.slice(0, 20).map((it) => this.normalizeItem(it, 'tv')),
          })
        }
        // Max 8 lignes issues des genres favoris
        if (rows.length >= 8) break
      }
    }

    // ── 3. Tendances (cold-start garanti) ──────────────────────────────────
    const [trendingMovies, trendingShows] = await Promise.all([
      this.tmdb.getTrending('movie', 'week').catch(() => []),
      this.tmdb.getTrending('tv', 'week').catch(() => []),
    ])

    if (trendingMovies.length > 0) {
      rows.push({
        type: 'popular',
        title: 'Films tendance cette semaine',
        items: trendingMovies.slice(0, 20).map((it) => this.normalizeItem(it, 'movie')),
      })
    }
    if (trendingShows.length > 0) {
      rows.push({
        type: 'popular',
        title: 'Séries tendance cette semaine',
        items: trendingShows.slice(0, 20).map((it) => this.normalizeItem(it, 'tv')),
      })
    }

    return rows
  }

  // Normalise un item TMDB en HomeItem avec mediaType explicite
  // (évite l'heuristique fragile title/name)
  private normalizeItem(item: any, mediaType: 'movie' | 'tv'): HomeItem {
    return {
      tmdb_id: String(item.tmdb_id ?? item.id),
      title: (item.title ?? item.name ?? '') as string,
      media_type: mediaType,
      poster_url: item.poster_url ?? null,
      backdrop_url: item.backdrop_url ?? null,
    }
  }
}

export interface HomeItem {
  tmdb_id: string
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
