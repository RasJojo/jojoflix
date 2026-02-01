import redis from '@adonisjs/redis/services/main'

const STREAM_KEY_PREFIX = 'stream:active:'
const STREAM_URL_PREFIX = 'stream:url:'
const STREAM_URL_BY_ID_PREFIX = 'stream:url:id:'
const STREAM_SESSION_KEY_PREFIX = 'stream:session:'
const STREAM_SESSION_SET_KEY = 'stream:session:index'
const STREAM_TTL_SECONDS = 4 * 60 * 60 // 4h
const STREAM_ACTIVE_WINDOW_SECONDS = (() => {
  const raw = Number(process.env.MONITOR_ACTIVE_STREAM_WINDOW_SECONDS ?? 20)
  if (!Number.isFinite(raw) || raw < 5) return 20
  return Math.floor(raw)
})()

export interface ActiveStreamSession {
  user_id: number
  stream_id: string
  profile_id: number | null
  tmdb_id: string
  media_type: 'movie' | 'tv'
  season: number | null
  episode: number | null
  source_key: string | null
  source_provider: string | null
  started_at: string
  last_activity_at: string
  bytes_sent: number
  current_bitrate_mbps: number | null
  direct_url_host: string | null
  mode: 'direct' | 'web_transcode'
  user_agent: string | null
  resource_scope: 'shared_proxy' | 'transcode_process'
  transcode_pid: number | null
  stream_cpu_percent: number | null
  stream_memory_mb: number | null
  stream_gpu_percent: number | null
}

export interface RegisterStreamSessionInput {
  profile_id?: number | null
  tmdb_id?: string
  media_type?: 'movie' | 'tv'
  season?: number | null
  episode?: number | null
  source_key?: string | null
  source_provider?: string | null
  started_at?: string
  last_activity_at?: string
  bytes_sent?: number
  current_bitrate_mbps?: number | null
  direct_url_host?: string | null
  mode?: 'direct' | 'web_transcode'
  user_agent?: string | null
  resource_scope?: 'shared_proxy' | 'transcode_process'
  transcode_pid?: number | null
  stream_cpu_percent?: number | null
  stream_memory_mb?: number | null
  stream_gpu_percent?: number | null
}

/**
 * StreamRegistry — Registre Redis des flux actifs.
 *
 * Mémorise les derniers flux/URLs vus pour un utilisateur.
 * Utilisé pour les endpoints de transcodage et le debug.
 */
export default class StreamRegistry {
  /**
   * Enregistre un flux vu pour un utilisateur.
   */
  async register(
    userId: number,
    streamId: string,
    directUrl?: string,
    session?: RegisterStreamSessionInput
  ): Promise<void> {
    const key = `${STREAM_KEY_PREFIX}${userId}`
    await redis.set(key, streamId, 'EX', STREAM_TTL_SECONDS)
    if (directUrl) {
      await redis.set(`${STREAM_URL_PREFIX}${userId}`, directUrl, 'EX', STREAM_TTL_SECONDS)
      await redis.set(
        `${STREAM_URL_BY_ID_PREFIX}${userId}:${streamId}`,
        directUrl,
        'EX',
        STREAM_TTL_SECONDS
      )
    }

    if (session?.tmdb_id && session.media_type) {
      const nowIso = new Date().toISOString()
      const sessionKey = this.sessionKey(userId, streamId)
      const payload: ActiveStreamSession = {
        user_id: userId,
        stream_id: streamId,
        profile_id: session.profile_id ?? null,
        tmdb_id: session.tmdb_id,
        media_type: session.media_type,
        season: session.season ?? null,
        episode: session.episode ?? null,
        source_key: session.source_key ?? null,
        source_provider: session.source_provider ?? null,
        started_at: session.started_at ?? nowIso,
        last_activity_at: session.last_activity_at ?? nowIso,
        bytes_sent: session.bytes_sent ?? 0,
        current_bitrate_mbps: session.current_bitrate_mbps ?? null,
        direct_url_host: session.direct_url_host ?? null,
        mode: session.mode ?? 'direct',
        user_agent: session.user_agent ?? null,
        resource_scope: session.resource_scope ?? 'shared_proxy',
        transcode_pid: session.transcode_pid ?? null,
        stream_cpu_percent: session.stream_cpu_percent ?? null,
        stream_memory_mb: session.stream_memory_mb ?? null,
        stream_gpu_percent: session.stream_gpu_percent ?? null,
      }
      await redis.set(sessionKey, JSON.stringify(payload), 'EX', STREAM_TTL_SECONDS)
      await redis.sadd(STREAM_SESSION_SET_KEY, sessionKey)
      await redis.expire(STREAM_SESSION_SET_KEY, STREAM_TTL_SECONDS)
    }
  }

  /**
   * Retourne le streamId actif pour un utilisateur, ou null.
   */
  async getActive(userId: number): Promise<string | null> {
    const key = `${STREAM_KEY_PREFIX}${userId}`
    return redis.get(key)
  }

  /**
   * Retourne l'URL directe du flux actif pour un utilisateur, ou null.
   */
  async getActiveUrl(userId: number): Promise<string | null> {
    return redis.get(`${STREAM_URL_PREFIX}${userId}`)
  }

  /**
   * Retourne l'URL directe d'un stream précis.
   */
  async getUrlByStream(userId: number, streamId: string): Promise<string | null> {
    return redis.get(`${STREAM_URL_BY_ID_PREFIX}${userId}:${streamId}`)
  }

  async touchSession(
    userId: number,
    streamId: string,
    patch: Partial<
      Pick<
        ActiveStreamSession,
        | 'bytes_sent'
        | 'last_activity_at'
        | 'current_bitrate_mbps'
        | 'resource_scope'
        | 'transcode_pid'
        | 'stream_cpu_percent'
        | 'stream_memory_mb'
        | 'stream_gpu_percent'
      >
    >
  ): Promise<void> {
    const key = this.sessionKey(userId, streamId)
    const raw = await redis.get(key)
    if (!raw) return

    const parsed = this.parseSession(raw)
    if (!parsed) {
      await redis.del(key)
      await redis.srem(STREAM_SESSION_SET_KEY, key)
      return
    }

    const merged: ActiveStreamSession = {
      ...parsed,
      ...patch,
      last_activity_at: patch.last_activity_at ?? new Date().toISOString(),
    }

    await redis.set(key, JSON.stringify(merged), 'EX', STREAM_TTL_SECONDS)
    await redis.sadd(STREAM_SESSION_SET_KEY, key)
    await redis.expire(STREAM_SESSION_SET_KEY, STREAM_TTL_SECONDS)
  }

  async listSessions(): Promise<ActiveStreamSession[]> {
    const keys = await redis.smembers(STREAM_SESSION_SET_KEY)
    if (keys.length === 0) return []

    const values = await redis.mget(...keys)
    const sessions: ActiveStreamSession[] = []
    const staleKeys: string[] = []

    for (let index = 0; index < keys.length; index += 1) {
      const raw = values[index]
      if (!raw) {
        staleKeys.push(keys[index])
        continue
      }
      const parsed = this.parseSession(raw)
      if (!parsed) {
        staleKeys.push(keys[index])
        continue
      }
      if (this.isSessionStale(parsed)) {
        staleKeys.push(keys[index])
        continue
      }
      sessions.push(parsed)
    }

    if (staleKeys.length > 0) {
      await redis.srem(STREAM_SESSION_SET_KEY, ...staleKeys)
    }

    return sessions.sort((a, b) => {
      const left = Date.parse(b.last_activity_at) || 0
      const right = Date.parse(a.last_activity_at) || 0
      return left - right
    })
  }

  async endSession(userId: number, streamId: string): Promise<void> {
    const sessionKey = this.sessionKey(userId, streamId)
    await redis.del(sessionKey, `${STREAM_URL_BY_ID_PREFIX}${userId}:${streamId}`)
    await redis.srem(STREAM_SESSION_SET_KEY, sessionKey)

    const activeStreamId = await this.getActive(userId)
    if (activeStreamId === streamId) {
      await redis.del(`${STREAM_KEY_PREFIX}${userId}`, `${STREAM_URL_PREFIX}${userId}`)
    }
  }

  /**
   * Supprime le flux actif pour un utilisateur.
   * Appelé au logout et au switch de profil.
   */
  async clear(userId: number): Promise<void> {
    await redis.del(`${STREAM_KEY_PREFIX}${userId}`, `${STREAM_URL_PREFIX}${userId}`)

    const sessionKeys = await redis.smembers(STREAM_SESSION_SET_KEY)
    const ownedKeys = sessionKeys.filter((key) => key.startsWith(`${STREAM_SESSION_KEY_PREFIX}${userId}:`))
    if (ownedKeys.length > 0) {
      await redis.del(...ownedKeys)
      await redis.srem(STREAM_SESSION_SET_KEY, ...ownedKeys)
    }
  }

  /**
   * Vérifie si un flux est actif pour un utilisateur.
   */
  async hasActiveStream(userId: number): Promise<boolean> {
    const active = await this.getActive(userId)
    return active !== null
  }

  private sessionKey(userId: number, streamId: string): string {
    return `${STREAM_SESSION_KEY_PREFIX}${userId}:${streamId}`
  }

  private parseSession(raw: string): ActiveStreamSession | null {
    try {
      return JSON.parse(raw) as ActiveStreamSession
    } catch {
      return null
    }
  }

  private isSessionStale(session: ActiveStreamSession): boolean {
    const lastActivityAt = Date.parse(session.last_activity_at)
    if (!Number.isFinite(lastActivityAt) || lastActivityAt <= 0) return true
    return Date.now() - lastActivityAt > STREAM_ACTIVE_WINDOW_SECONDS * 1000
  }
}
