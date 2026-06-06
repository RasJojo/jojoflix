import ConvexRepository from '#services/convex_repository'

export default class CacheWrapper {
  private readonly repo: ConvexRepository

  constructor() {
    this.repo = new ConvexRepository()
  }

  async remember<T>(key: string, ttlSeconds: number, callback: () => Promise<T>): Promise<T> {
    const cached = await this.repo.getCacheEntry<T>(key)
    if (cached !== null) return cached

    const value = await callback()
    const expiresAtMs = Date.now() + ttlSeconds * 1000
    await this.repo.setCacheEntry(key, value, expiresAtMs)
    return value
  }

  async get<T>(key: string): Promise<T | null> {
    return this.repo.getCacheEntry<T>(key)
  }

  async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    const expiresAtMs = Date.now() + ttlSeconds * 1000
    await this.repo.setCacheEntry(key, value, expiresAtMs)
  }

  async forget(key: string): Promise<void> {
    await this.repo.deleteCacheEntry(key)
  }
}

export const CACHE_TTL = {
  TMDB_METADATA: 3600,
  TMDB_SEARCH: 1800,
  TORRENTIO: 1800,
  SUBTITLES: 86400,
  MARKERS: 604800,
  RD_LINK: 1800,
} as const
