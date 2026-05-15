import redis from '@adonisjs/redis/services/main'

/**
 * CacheWrapper — Point d'accès centralisé à Redis.
 *
 * RÈGLE : Ne jamais appeler redis.get() directement dans un service.
 * Toujours passer par CacheWrapper.
 */
export default class CacheWrapper {
  /**
   * Récupère une valeur du cache ou l'hydrate via le callback.
   */
  async remember<T>(key: string, ttlSeconds: number, callback: () => Promise<T>): Promise<T> {
    const cached = await redis.get(key)
    if (cached) {
      return JSON.parse(cached) as T
    }

    const value = await callback()
    await redis.set(key, JSON.stringify(value), 'EX', ttlSeconds)
    return value
  }

  /**
   * Récupère une valeur du cache même si expirée (fallback gracieux).
   */
  async get<T>(key: string): Promise<T | null> {
    const cached = await redis.get(key)
    return cached ? (JSON.parse(cached) as T) : null
  }

  /**
   * Stocke une valeur dans le cache.
   */
  async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    await redis.set(key, JSON.stringify(value), 'EX', ttlSeconds)
  }

  /**
   * Invalide une clé du cache.
   */
  async forget(key: string): Promise<void> {
    await redis.del(key)
  }
}

// TTL constants
export const CACHE_TTL = {
  TMDB_METADATA: 3600, // 1h
  TMDB_SEARCH: 1800, // 30min
  TORRENTIO: 1800, // 30min
  SUBTITLES: 86400, // 24h
  MARKERS: 604800, // 7j
  RD_LINK: 7200, // 2h
} as const
// Cache
