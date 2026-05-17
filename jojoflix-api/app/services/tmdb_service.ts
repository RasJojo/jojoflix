import env from '#start/env'
import CacheWrapper, { CACHE_TTL } from '#services/cache_wrapper'

const TMDB_BASE_URL = 'https://api.themoviedb.org/3'
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p'

export type TmdbImageSize = 'w185' | 'w342' | 'w500' | 'w780' | 'w1280'

export interface TmdbMovie {
  tmdb_id: number
  title: string
  overview: string
  release_date: string
  vote_average: number
  genre_ids: number[]
  poster_url: string | null
  backdrop_url: string | null
  imdb_id?: string
}

export interface TmdbShow {
  tmdb_id: number
  name: string
  overview: string
  first_air_date: string
  vote_average: number
  genre_ids: number[]
  poster_url: string | null
  backdrop_url: string | null
  number_of_seasons: number
}

export interface TmdbPersonCredit {
  tmdb_id: number
  media_type: 'movie' | 'tv'
  title: string
  overview: string
  release_date: string
  poster_url: string | null
  backdrop_url: string | null
  character?: string | null
}

export default class TmdbService {
  private readonly apiKey: string
  private readonly cache: CacheWrapper

  constructor() {
    this.apiKey = env.get('TMDB_API_KEY').release()
    this.cache = new CacheWrapper()
  }

  /**
   * Construit une URL d'image TMDB dimensionnée côté backend.
   * Jamais "original" envoyé au client.
   */
  imageUrl(path: string | null, size: TmdbImageSize): string | null {
    if (!path) return null
    return `${TMDB_IMAGE_BASE}/${size}${path}`
  }

  async getMovie(tmdbId: number): Promise<TmdbMovie> {
    const cacheKey = `tmdb:movie:${tmdbId}`
    return this.cache.remember(cacheKey, CACHE_TTL.TMDB_METADATA, async () => {
      const data = await this.fetch<any>(`/movie/${tmdbId}`, { append_to_response: 'external_ids' })
      return this.normalizeMovie(data)
    })
  }

  async getTvShow(tmdbId: number): Promise<TmdbShow> {
    const cacheKey = `tmdb:tv:${tmdbId}`
    return this.cache.remember(cacheKey, CACHE_TTL.TMDB_METADATA, async () => {
      const data = await this.fetch<any>(`/tv/${tmdbId}`)
      return this.normalizeShow(data)
    })
  }

  async getImdbId(tmdbId: number, mediaType: 'movie' | 'tv'): Promise<string | null> {
    const cacheKey = `tmdb:imdb:${mediaType}:${tmdbId}`
    return this.cache.remember(cacheKey, CACHE_TTL.TMDB_METADATA, async () => {
      if (mediaType === 'movie') {
        const data = await this.fetch<any>(`/movie/${tmdbId}`, {
          append_to_response: 'external_ids',
        })
        return data.external_ids?.imdb_id ?? data.imdb_id ?? null
      } else {
        const data = await this.fetch<any>(`/tv/${tmdbId}/external_ids`)
        return data.imdb_id ?? null
      }
    })
  }

  async getSimilarMovies(tmdbId: number): Promise<TmdbMovie[]> {
    const cacheKey = `tmdb:movie:${tmdbId}:similar`
    return this.cache.remember(cacheKey, CACHE_TTL.TMDB_SEARCH, async () => {
      const data = await this.fetch<any>(`/movie/${tmdbId}/similar`)
      return (data.results ?? []).slice(0, 20).map((m: any) => this.normalizeMovie(m))
    })
  }

  async getSimilarShows(tmdbId: number): Promise<TmdbShow[]> {
    const cacheKey = `tmdb:tv:${tmdbId}:similar`
    return this.cache.remember(cacheKey, CACHE_TTL.TMDB_SEARCH, async () => {
      const data = await this.fetch<any>(`/tv/${tmdbId}/similar`)
      return (data.results ?? []).slice(0, 20).map((s: any) => this.normalizeShow(s))
    })
  }

  async getMovieDetail(tmdbId: number): Promise<any> {
    const cacheKey = `tmdb:movie:${tmdbId}:detail:v2`
    return this.cache.remember(cacheKey, CACHE_TTL.TMDB_METADATA, async () => {
      const data = await this.fetch<any>(`/movie/${tmdbId}`, {
        append_to_response: 'credits,external_ids,videos',
      })
      return {
        tmdb_id: data.id,
        title: data.title,
        media_type: 'movie',
        overview: data.overview,
        release_date: data.release_date,
        rating: data.vote_average,
        runtime: data.runtime,
        poster_url: this.imageUrl(data.poster_path, 'w342'),
        backdrop_url: this.imageUrl(data.backdrop_path, 'w1280'),
        imdb_id: data.external_ids?.imdb_id,
        trailer_key: this.extractTrailerKey(data.videos?.results),
        genres: (data.genres ?? []).map((g: any) => g.name as string),
        cast: (data.credits?.cast ?? []).slice(0, 20).map((c: any) => ({
          person_id: c.id,
          name: c.name,
          character: c.character,
          profile_url: this.imageUrl(c.profile_path, 'w185'),
        })),
        seasons: [],
      }
    })
  }

  async getTvDetail(tmdbId: number): Promise<any> {
    const cacheKey = `tmdb:tv:${tmdbId}:detail:v2`
    return this.cache.remember(cacheKey, CACHE_TTL.TMDB_METADATA, async () => {
      const data = await this.fetch<any>(`/tv/${tmdbId}`, {
        append_to_response: 'credits,videos',
      })
      const seasonResults = await Promise.allSettled(
        (data.seasons ?? [])
          .filter((s: any) => s.season_number > 0)
          .map((s: any) => this.getTvSeason(tmdbId, s.season_number))
      )
      const seasons = seasonResults
        .filter((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled')
        .map((r) => r.value)
      return {
        tmdb_id: data.id,
        title: data.name,
        media_type: 'tv',
        overview: data.overview,
        release_date: data.first_air_date,
        rating: data.vote_average,
        runtime: null,
        poster_url: this.imageUrl(data.poster_path, 'w342'),
        backdrop_url: this.imageUrl(data.backdrop_path, 'w1280'),
        trailer_key: this.extractTrailerKey(data.videos?.results),
        genres: (data.genres ?? []).map((g: any) => g.name as string),
        cast: (data.credits?.cast ?? []).slice(0, 20).map((c: any) => ({
          person_id: c.id,
          name: c.name,
          character: c.character,
          profile_url: this.imageUrl(c.profile_path, 'w185'),
        })),
        seasons,
      }
    })
  }

  private extractTrailerKey(videos: any[] | undefined): string | null {
    if (!videos?.length) return null
    const trailer = videos.find(
      (v: any) =>
        v.site === 'YouTube' &&
        (v.type === 'Trailer' || v.type === 'Teaser') &&
        v.official === true
    ) ?? videos.find(
      (v: any) => v.site === 'YouTube' && (v.type === 'Trailer' || v.type === 'Teaser')
    )
    return trailer?.key ?? null
  }

  async getTvSeason(tmdbId: number, seasonNumber: number): Promise<any> {
    const cacheKey = `tmdb:tv:${tmdbId}:season:${seasonNumber}`
    return this.cache.remember(cacheKey, CACHE_TTL.TMDB_METADATA, async () => {
      const data = await this.fetch<any>(`/tv/${tmdbId}/season/${seasonNumber}`)
      return {
        season_number: data.season_number,
        name: data.name,
        episodes: (data.episodes ?? []).map((e: any) => ({
          episode_number: e.episode_number,
          name: e.name,
          overview: e.overview,
          runtime: e.runtime,
          still_url: this.imageUrl(e.still_path, 'w342'),
        })),
      }
    })
  }

  async getTvEpisodeGroups(tmdbId: number): Promise<any[]> {
    const cacheKey = `tmdb:tv:${tmdbId}:episode-groups`
    return this.cache.remember(cacheKey, CACHE_TTL.TMDB_METADATA, async () => {
      const data = await this.fetch<any>(`/tv/${tmdbId}/episode_groups`)
      return Array.isArray(data?.results) ? data.results : []
    })
  }

  async getEpisodeGroupDetail(groupId: string): Promise<any | null> {
    if (!groupId) return null
    const cacheKey = `tmdb:episode-group:${groupId}`
    return this.cache.remember(cacheKey, CACHE_TTL.TMDB_METADATA, async () => {
      try {
        return await this.fetch<any>(`/tv/episode_group/${groupId}`)
      } catch {
        return null
      }
    })
  }

  /**
   * Convertit une paire (saison, épisode) en numérotation absolue
   * basée sur l'ordre exposé par TMDB.
   *
   * Exemple: S3E7 -> E53 si S1=23 et S2=23.
   */
  async toAbsoluteEpisode(
    tmdbId: number,
    seasonNumber: number,
    episodeNumber: number
  ): Promise<number | null> {
    if (!Number.isFinite(seasonNumber) || !Number.isFinite(episodeNumber)) {
      return null
    }
    if (seasonNumber <= 0 || episodeNumber <= 0) return null
    if (seasonNumber === 1) return episodeNumber

    const detail = await this.getTvDetail(tmdbId)
    const seasons = Array.isArray(detail?.seasons) ? detail.seasons : []
    if (seasons.length === 0) return null

    const sorted = [...seasons].sort(
      (a: any, b: any) => Number(a.season_number ?? 0) - Number(b.season_number ?? 0)
    )

    let offset = 0
    for (const season of sorted) {
      const currentSeason = Number(season?.season_number ?? 0)
      if (!Number.isFinite(currentSeason) || currentSeason <= 0) continue

      const episodes = Array.isArray(season?.episodes) ? season.episodes.length : 0
      if (currentSeason < seasonNumber) {
        offset += episodes
        continue
      }

      if (currentSeason === seasonNumber) {
        return offset + episodeNumber
      }

      break
    }

    return null
  }

  /**
   * Cas TMDB "S1 absolue" (anime/ordering spécial):
   * convertit S1E49 -> S3E2 en s'appuyant sur un episode_group de type "Seasons".
   */
  async remapCollapsedSeasonOneEpisode(
    tmdbId: number,
    seasonNumber: number,
    episodeNumber: number
  ): Promise<{ season: number; episode: number } | null> {
    if (seasonNumber !== 1 || episodeNumber <= 0) return null

    const detail = await this.getTvDetail(tmdbId)
    const regularSeasons = (Array.isArray(detail?.seasons) ? detail.seasons : []).filter(
      (season: any) => Number(season?.season_number ?? 0) > 0
    )
    if (regularSeasons.length !== 1) return null

    const seasonOneEpisodes = Array.isArray(regularSeasons[0]?.episodes)
      ? regularSeasons[0].episodes.length
      : 0
    if (seasonOneEpisodes <= 24) return null

    const groups = await this.getTvEpisodeGroups(tmdbId)
    const bestGroupId = this.pickBestSeasonEpisodeGroupId(groups)
    if (!bestGroupId) return null

    const groupDetail = await this.getEpisodeGroupDetail(bestGroupId)
    const mapped = this.mapAbsoluteEpisodeUsingGroup(groupDetail, episodeNumber)
    if (!mapped) return null

    if (mapped.season === seasonNumber && mapped.episode === episodeNumber) {
      return null
    }

    return mapped
  }

  /**
   * Convertit une numérotation "vraies saisons" (S2E1, S3E4, ...)
   * vers une numérotation absolue S1:E* quand TMDB est en saison unique.
   *
   * Exemple (anime): S2E1 -> S1E24 (ou E25 selon ordering du groupe choisi).
   */
  async toCollapsedSeasonOneEpisode(
    tmdbId: number,
    seasonNumber: number,
    episodeNumber: number
  ): Promise<number | null> {
    if (!Number.isFinite(seasonNumber) || !Number.isFinite(episodeNumber)) return null
    if (seasonNumber <= 0 || episodeNumber <= 0) return null
    if (seasonNumber === 1) return episodeNumber

    const groups = await this.getTvEpisodeGroups(tmdbId)
    const bestGroupId = this.pickBestSeasonEpisodeGroupId(groups)
    if (!bestGroupId) return null

    const groupDetail = await this.getEpisodeGroupDetail(bestGroupId)
    return this.mapGroupedSeasonEpisodeToAbsolute(groupDetail, seasonNumber, episodeNumber)
  }

  private pickBestSeasonEpisodeGroupId(groups: any[]): string | null {
    if (!Array.isArray(groups) || groups.length === 0) return null

    const seasonGroups = groups.filter(
      (group: any) => Number(group?.type ?? 0) === 6 && Number(group?.group_count ?? 0) >= 2
    )
    if (seasonGroups.length === 0) return null

    const scored = seasonGroups
      .map((group: any) => {
        const name = String(group?.name ?? '').toLowerCase()
        let score = Number(group?.episode_count ?? 0)
        if (name.includes('season') || name.includes('saison')) score += 500
        if (name.includes('order')) score += 50
        return { id: String(group?.id ?? ''), score }
      })
      .filter((entry) => entry.id.length > 0)
      .sort((a, b) => b.score - a.score)

    return scored[0]?.id ?? null
  }

  private mapAbsoluteEpisodeUsingGroup(
    groupDetail: any,
    absoluteEpisode: number
  ): { season: number; episode: number } | null {
    const groups = Array.isArray(groupDetail?.groups) ? groupDetail.groups : []
    if (groups.length === 0) return null

    const ordered = [...groups].sort(
      (a: any, b: any) => Number(a?.order ?? 0) - Number(b?.order ?? 0)
    )

    for (const group of ordered) {
      const seasonOrder = Number(group?.order ?? 0)
      if (!Number.isFinite(seasonOrder) || seasonOrder <= 0) continue
      const episodes = Array.isArray(group?.episodes) ? group.episodes : []
      const index = episodes.findIndex(
        (episode: any) => Number(episode?.episode_number ?? 0) === absoluteEpisode
      )
      if (index >= 0) {
        return { season: seasonOrder, episode: index + 1 }
      }
    }

    return null
  }

  private mapGroupedSeasonEpisodeToAbsolute(
    groupDetail: any,
    seasonNumber: number,
    episodeNumber: number
  ): number | null {
    const groups = Array.isArray(groupDetail?.groups) ? groupDetail.groups : []
    if (groups.length === 0) return null

    const ordered = [...groups]
      .filter((group: any) => Number(group?.order ?? 0) > 0)
      .sort((a: any, b: any) => Number(a?.order ?? 0) - Number(b?.order ?? 0))

    let absoluteOffset = 0
    for (const group of ordered) {
      const groupSeason = Number(group?.order ?? 0)
      const episodes = Array.isArray(group?.episodes) ? group.episodes : []
      if (groupSeason < seasonNumber) {
        absoluteOffset += episodes.length
        continue
      }
      if (groupSeason > seasonNumber) break

      const indexByEpisodeNumber = episodes.findIndex(
        (episode: any) => Number(episode?.episode_number ?? 0) === episodeNumber
      )
      const resolvedIndex =
        indexByEpisodeNumber >= 0
          ? indexByEpisodeNumber
          : episodeNumber > 0 && episodeNumber <= episodes.length
            ? episodeNumber - 1
            : -1
      if (resolvedIndex < 0) return null

      return absoluteOffset + resolvedIndex + 1
    }

    return null
  }

  async searchMulti(query: string): Promise<any[]> {
    const cacheKey = `tmdb:search:${query}`
    return this.cache.remember(cacheKey, CACHE_TTL.TMDB_SEARCH, async () => {
      const data = await this.fetch<any>('/search/multi', { query })
      return (data.results ?? [])
        .filter((r: any) => r.media_type === 'movie' || r.media_type === 'tv')
        .slice(0, 20)
        .map((r: any) => ({
          ...(r.media_type === 'movie' ? this.normalizeMovie(r) : this.normalizeShow(r)),
          media_type: r.media_type,
        }))
    })
  }

  async getPersonDetail(personId: number): Promise<any> {
    const cacheKey = `tmdb:person:${personId}:detail`
    return this.cache.remember(cacheKey, CACHE_TTL.TMDB_METADATA, async () => {
      const data = await this.fetch<any>(`/person/${personId}`, {
        append_to_response: 'combined_credits',
      })
      const credits = this.normalizePersonCredits(data.combined_credits?.cast ?? [])
      return {
        person_id: data.id,
        name: data.name ?? '',
        biography: data.biography ?? '',
        birthday: data.birthday ?? null,
        place_of_birth: data.place_of_birth ?? null,
        known_for_department: data.known_for_department ?? null,
        profile_url: this.imageUrl(data.profile_path, 'w500'),
        credits,
      }
    })
  }

  async getTrending(
    mediaType: 'movie' | 'tv' | 'all' = 'all',
    timeWindow: 'day' | 'week' = 'week'
  ): Promise<any[]> {
    const cacheKey = `tmdb:trending:${mediaType}:${timeWindow}`
    return this.cache.remember(cacheKey, CACHE_TTL.TMDB_SEARCH, async () => {
      const data = await this.fetch<any>(`/trending/${mediaType}/${timeWindow}`)
      return (data.results ?? [])
        .slice(0, 20)
        .map((item: any) =>
          item.media_type === 'tv' ? this.normalizeShow(item) : this.normalizeMovie(item)
        )
    })
  }

  async getTrendingByGenre(
    genreId: number,
    mediaType: 'movie' | 'tv'
  ): Promise<(TmdbMovie | TmdbShow)[]> {
    const cacheKey = `tmdb:trending:${mediaType}:genre:${genreId}`
    return this.cache.remember(cacheKey, CACHE_TTL.TMDB_SEARCH, async () => {
      const data = await this.fetch<any>(`/discover/${mediaType}`, {
        with_genres: String(genreId),
        sort_by: 'popularity.desc',
      })
      return (data.results ?? [])
        .slice(0, 20)
        .map((item: any) =>
          mediaType === 'movie' ? this.normalizeMovie(item) : this.normalizeShow(item)
        )
    })
  }

  private normalizeMovie(data: any): TmdbMovie {
    return {
      tmdb_id: data.id,
      title: data.title,
      overview: data.overview,
      release_date: data.release_date,
      vote_average: data.vote_average,
      genre_ids: data.genre_ids ?? data.genres?.map((g: any) => g.id) ?? [],
      poster_url: this.imageUrl(data.poster_path, 'w342'),
      backdrop_url: this.imageUrl(data.backdrop_path, 'w1280'),
      imdb_id: data.external_ids?.imdb_id ?? data.imdb_id,
    }
  }

  private normalizeShow(data: any): TmdbShow {
    return {
      tmdb_id: data.id,
      name: data.name,
      overview: data.overview,
      first_air_date: data.first_air_date,
      vote_average: data.vote_average,
      genre_ids: data.genre_ids ?? data.genres?.map((g: any) => g.id) ?? [],
      poster_url: this.imageUrl(data.poster_path, 'w342'),
      backdrop_url: this.imageUrl(data.backdrop_path, 'w1280'),
      number_of_seasons: data.number_of_seasons ?? 1,
    }
  }

  private normalizePersonCredits(items: any[]): TmdbPersonCredit[] {
    const seen = new Set<string>()
    return items
      .filter((item) => item?.media_type === 'movie' || item?.media_type === 'tv')
      .map((item) => {
        const mediaType = item.media_type === 'tv' ? 'tv' : 'movie'
        return {
          tmdb_id: item.id,
          media_type: mediaType,
          title: mediaType === 'tv' ? item.name : item.title,
          overview: item.overview ?? '',
          release_date: mediaType === 'tv' ? item.first_air_date ?? '' : item.release_date ?? '',
          poster_url: this.imageUrl(item.poster_path, 'w342'),
          backdrop_url: this.imageUrl(item.backdrop_path, 'w780'),
          character: item.character ?? null,
        } satisfies TmdbPersonCredit
      })
      .filter((item) => {
        if (!item.title) return false
        const key = `${item.media_type}:${item.tmdb_id}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
      .sort((a, b) => {
        const dateA = a.release_date || ''
        const dateB = b.release_date || ''
        return dateB.localeCompare(dateA)
      })
      .slice(0, 60)
  }

  private async fetch<T>(path: string, params: Record<string, string> = {}): Promise<T> {
    const url = new URL(`${TMDB_BASE_URL}${path}`)
    const allParams = { api_key: this.apiKey, language: 'fr-FR', ...params }
    for (const [k, v] of Object.entries(allParams)) url.searchParams.set(k, v)
    const res = await fetch(url.toString())
    if (!res.ok) throw new Error(`TMDB HTTP ${res.status} on ${path}`)
    return res.json() as Promise<T>
  }
}
// TMDB
