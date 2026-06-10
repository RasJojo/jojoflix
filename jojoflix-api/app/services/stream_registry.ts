const STREAM_TTL_MS = 4 * 60 * 60 * 1000 // 4h

export interface ActiveStreamSession {
  user_id: string
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

interface StreamEntry {
  streamId: string
  directUrl?: string
  session?: ActiveStreamSession
  expiresAt: number
}

// Singleton in-memory store — survives for the process lifetime.
const store = new Map<string, StreamEntry>()

const ACTIVE_WINDOW_SECONDS = (() => {
  const raw = Number(process.env.MONITOR_ACTIVE_STREAM_WINDOW_SECONDS ?? 20)
  if (!Number.isFinite(raw) || raw < 5) return 20
  return Math.floor(raw)
})()

function isExpired(entry: StreamEntry): boolean {
  return Date.now() > entry.expiresAt
}

function prune(): void {
  for (const [userId, entry] of store) {
    if (isExpired(entry)) store.delete(userId)
  }
}

export default class StreamRegistry {
  async register(
    userId: string,
    streamId: string,
    directUrl?: string,
    session?: RegisterStreamSessionInput
  ): Promise<void> {
    prune()
    const now = new Date().toISOString()
    const existing = store.get(userId)
    const entry: StreamEntry = {
      streamId,
      directUrl: directUrl ?? existing?.directUrl,
      expiresAt: Date.now() + STREAM_TTL_MS,
    }
    if (session?.tmdb_id && session.media_type) {
      entry.session = {
        user_id: userId,
        stream_id: streamId,
        profile_id: session.profile_id ?? null,
        tmdb_id: session.tmdb_id,
        media_type: session.media_type,
        season: session.season ?? null,
        episode: session.episode ?? null,
        source_key: session.source_key ?? null,
        source_provider: session.source_provider ?? null,
        started_at: session.started_at ?? now,
        last_activity_at: session.last_activity_at ?? now,
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
    } else if (existing?.session) {
      entry.session = existing.session
    }
    // Atomicity note: Node.js is single-threaded, so Map reads/writes here are
    // never truly concurrent. The real protection against stale state is the
    // invalidate() tombstone (streamId === '__invalidated__') combined with the
    // __invalidated__ check in getActiveUrl(), which guarantees callers see null
    // until a complete register() with a real URL has run.
    store.set(userId, entry)
  }

  async getActive(userId: string): Promise<string | null> {
    const entry = store.get(userId)
    if (!entry || isExpired(entry)) return null
    return entry.streamId
  }

  async getActiveUrl(userId: string): Promise<string | null> {
    const entry = store.get(userId)
    if (!entry || isExpired(entry)) return null
    // Tombstone set by invalidate() — no active URL until a full register() is done.
    if (entry.streamId === '__invalidated__') return null
    return entry.directUrl ?? null
  }

  async getUrlByStream(userId: string, streamId: string): Promise<string | null> {
    const entry = store.get(userId)
    if (!entry || isExpired(entry) || entry.streamId !== streamId) return null
    return entry.directUrl ?? null
  }

  async touchSession(
    userId: string,
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
    const entry = store.get(userId)
    if (!entry || isExpired(entry) || entry.streamId !== streamId || !entry.session) return
    entry.session = {
      ...entry.session,
      ...patch,
      last_activity_at: patch.last_activity_at ?? new Date().toISOString(),
    }
    entry.expiresAt = Date.now() + STREAM_TTL_MS
  }

  async listSessions(): Promise<ActiveStreamSession[]> {
    prune()
    const sessions: ActiveStreamSession[] = []
    const cutoff = Date.now() - ACTIVE_WINDOW_SECONDS * 1000
    for (const entry of store.values()) {
      if (!entry.session) continue
      const lastActivity = Date.parse(entry.session.last_activity_at)
      if (Number.isFinite(lastActivity) && lastActivity >= cutoff) {
        sessions.push(entry.session)
      }
    }
    return sessions.sort(
      (a, b) => (Date.parse(b.last_activity_at) || 0) - (Date.parse(a.last_activity_at) || 0)
    )
  }

  async endSession(userId: string, streamId: string): Promise<void> {
    const entry = store.get(userId)
    if (entry && entry.streamId === streamId) store.delete(userId)
  }

  async clear(userId: string): Promise<void> {
    store.delete(userId)
  }

  /**
   * Invalidate the current stream for a user without registering a new one.
   * Stores a tombstone entry (no URL) so that concurrent getActiveUrl() calls
   * return null until a full register() with a URL is performed.
   */
  async invalidate(userId: string): Promise<void> {
    prune()
    const streamId = '__invalidated__'
    const entry: StreamEntry = {
      streamId,
      expiresAt: Date.now() + STREAM_TTL_MS,
    }
    store.set(userId, entry)
  }

  async hasActiveStream(userId: string): Promise<boolean> {
    const entry = store.get(userId)
    return !!entry && !isExpired(entry)
  }
}
