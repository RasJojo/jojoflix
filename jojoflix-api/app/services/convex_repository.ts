import env from '#start/env'
import got from 'got'

type ConvexKind = 'query' | 'mutation'

export interface ProfilePreferences {
  audio?: string
  subtitles?: string
  auto_skip_intro?: boolean
  watchlist?: Array<{
    tmdb_id: string
    media_type: 'movie' | 'tv'
    added_at?: string | null
  }>
}

export interface ConvexProfile {
  _id: string
  userId: string
  name: string
  avatarUrl: string | null
  isKids: boolean
  preferences: ProfilePreferences
  createdAtMs: number
  updatedAtMs: number
}

export interface ConvexWatchHistory {
  _id: string
  profileId: string
  tmdbId: string
  mediaType: 'movie' | 'tv'
  seasonNum: number | null
  episodeNum: number | null
  currentTime: number
  totalDuration: number
  isFinished: boolean
  createdAtMs: number
  updatedAtMs: number
}

export interface ConvexProfileInterest {
  _id: string
  profileId: string
  genreId: number
  affinityScore: number
  lastWatchedAtMs: number | null
  createdAtMs: number
  updatedAtMs: number
}

export interface ConvexMediaMarker {
  _id: string
  tmdbId: string
  markerType: 'intro' | 'outro'
  startTime: number
  endTime: number
  createdAtMs: number
}

export default class ConvexRepository {
  private readonly url: string
  private readonly adminKey: string

  constructor() {
    this.url = env.get('CONVEX_URL').replace(/\/$/, '')
    this.adminKey = env.get('CONVEX_ADMIN_KEY').release()
  }

  private async call<T>(kind: ConvexKind, path: string, args: Record<string, unknown>): Promise<T> {
    const result = await got
      .post(`${this.url}/api/${kind}`, {
        json: { path, args, format: 'json' },
        headers: { Authorization: `Convex ${this.adminKey}` },
        timeout: { request: 15_000 },
        retry: { limit: 0 },
      })
      .json<{ status: string; value?: T; errorMessage?: string }>()

    if (result.status === 'error') {
      throw new Error(`Convex ${kind} ${path}: ${result.errorMessage}`)
    }
    return result.value as T
  }

  // ── Profiles ──────────────────────────────────────────────────────────────

  async getProfilesByUser(userId: string): Promise<ConvexProfile[]> {
    return this.call('query', 'jojoflix:getProfilesByUser', { userId })
  }

  async getProfile(profileId: string): Promise<ConvexProfile | null> {
    return this.call('query', 'jojoflix:getProfile', { profileId })
  }

  async getProfileOfUser(profileId: string, userId: string): Promise<ConvexProfile | null> {
    return this.call('query', 'jojoflix:getProfileOfUser', { profileId, userId })
  }

  async countProfilesByUser(userId: string): Promise<number> {
    return this.call('query', 'jojoflix:countProfilesByUser', { userId })
  }

  async createProfile(data: {
    userId: string
    name: string
    avatarUrl?: string | null
    isKids: boolean
    preferences: ProfilePreferences
  }): Promise<ConvexProfile> {
    return this.call('mutation', 'jojoflix:createProfile', {
      userId: data.userId,
      name: data.name,
      avatarUrl: data.avatarUrl ?? undefined,
      isKids: data.isKids,
      preferences: data.preferences,
    })
  }

  async updateProfile(
    profileId: string,
    data: {
      name?: string
      avatarUrl?: string | null
      isKids?: boolean
      preferences?: ProfilePreferences
    }
  ): Promise<ConvexProfile> {
    return this.call('mutation', 'jojoflix:updateProfile', { profileId, ...data })
  }

  async deleteProfile(profileId: string): Promise<void> {
    return this.call('mutation', 'jojoflix:deleteProfile', { profileId })
  }

  // ── Watch History ─────────────────────────────────────────────────────────

  async getWatchHistory(
    profileId: string,
    tmdbId: string,
    mediaType: 'movie' | 'tv',
    seasonNum?: number | null,
    episodeNum?: number | null
  ): Promise<ConvexWatchHistory | null> {
    return this.call('query', 'jojoflix:getWatchHistory', {
      profileId,
      tmdbId,
      mediaType,
      seasonNum: seasonNum ?? null,
      episodeNum: episodeNum ?? null,
    })
  }

  async getActiveWatchHistory(profileId: string): Promise<ConvexWatchHistory[]> {
    return this.call('query', 'jojoflix:getActiveWatchHistory', { profileId })
  }

  async getWatchHistoriesByTmdb(
    profileId: string,
    tmdbId: string,
    mediaType: 'movie' | 'tv'
  ): Promise<ConvexWatchHistory[]> {
    return this.call('query', 'jojoflix:getWatchHistoriesByTmdb', { profileId, tmdbId, mediaType })
  }

  async getLastWatched(profileId: string): Promise<ConvexWatchHistory | null> {
    return this.call('query', 'jojoflix:getLastWatched', { profileId })
  }

  async upsertWatchHistory(data: {
    profileId: string
    tmdbId: string
    mediaType: 'movie' | 'tv'
    seasonNum?: number | null
    episodeNum?: number | null
    currentTime: number
    totalDuration: number
    isFinished: boolean
  }): Promise<ConvexWatchHistory> {
    return this.call('mutation', 'jojoflix:upsertWatchHistory', {
      profileId: data.profileId,
      tmdbId: data.tmdbId,
      mediaType: data.mediaType,
      seasonNum: data.seasonNum ?? null,
      episodeNum: data.episodeNum ?? null,
      currentTime: data.currentTime,
      totalDuration: data.totalDuration,
      isFinished: data.isFinished,
    })
  }

  // ── Profile Interests ─────────────────────────────────────────────────────

  async getTopInterests(profileId: string, limit: number): Promise<ConvexProfileInterest[]> {
    return this.call('query', 'jojoflix:getTopInterests', { profileId, limit })
  }

  async getInterest(profileId: string, genreId: number): Promise<ConvexProfileInterest | null> {
    return this.call('query', 'jojoflix:getInterest', { profileId, genreId })
  }

  async upsertInterest(data: {
    profileId: string
    genreId: number
    affinityScore: number
    lastWatchedAtMs: number
  }): Promise<void> {
    return this.call('mutation', 'jojoflix:upsertInterest', data)
  }

  async decrementStaleInterests(
    profileId: string,
    excludeGenreIds: number[],
    decayCutoffMs: number,
    amount: number
  ): Promise<void> {
    return this.call('mutation', 'jojoflix:decrementStaleInterests', {
      profileId,
      excludeGenreIds,
      decayCutoffMs,
      amount,
    })
  }

  // ── Media Markers ─────────────────────────────────────────────────────────

  async getMarkersByTmdb(tmdbId: string): Promise<ConvexMediaMarker[]> {
    return this.call('query', 'jojoflix:getMarkersByTmdb', { tmdbId })
  }

  async createMediaMarker(data: {
    tmdbId: string
    markerType: 'intro' | 'outro'
    startTime: number
    endTime: number
  }): Promise<ConvexMediaMarker> {
    return this.call('mutation', 'jojoflix:createMediaMarker', data)
  }

  // ── API Cache ─────────────────────────────────────────────────────────────

  async getCacheEntry<T>(key: string): Promise<T | null> {
    return this.call<T | null>('query', 'jojoflix:getCacheEntry', { key })
  }

  async setCacheEntry(key: string, value: unknown, expiresAtMs: number): Promise<void> {
    return this.call('mutation', 'jojoflix:setCacheEntry', { key, value, expiresAtMs })
  }

  async deleteCacheEntry(key: string): Promise<void> {
    return this.call('mutation', 'jojoflix:deleteCacheEntry', { key })
  }
}
