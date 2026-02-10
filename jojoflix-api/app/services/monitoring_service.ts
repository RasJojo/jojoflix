import StreamRegistry, { type ActiveStreamSession } from '#services/stream_registry'
import TmdbService from '#services/tmdb_service'
import Profile from '#models/profile'
import User from '#models/user'
import os from 'node:os'
import { readFile } from 'node:fs/promises'
import { execFile as execFileCallback } from 'node:child_process'
import { promisify } from 'node:util'

const execFile = promisify(execFileCallback)

interface CpuSample {
  idle: number
  total: number
}

interface EnrichedStreamSession extends ActiveStreamSession {
  profile_name: string | null
  user_label: string | null
  content_title: string | null
  content_poster_url: string | null
  watched_for_seconds: number
}

interface MediaSummary {
  title: string | null
  poster_url: string | null
}

export default class MonitoringService {
  private readonly registry = new StreamRegistry()
  private readonly tmdb = new TmdbService()
  private readonly configuredMaxUplinkMbps = this.readNumberEnv('MONITOR_MAX_UPLINK_MBPS')

  async snapshot() {
    const activeSessions = await this.registry.listSessions()
    const hydratedSessions = await this.attachPerStreamResources(activeSessions)
    const enrichedSessions = await this.enrichSessions(hydratedSessions)
    const overview = await this.buildOverview(enrichedSessions)

    return {
      generated_at: new Date().toISOString(),
      overview,
      sessions: enrichedSessions,
    }
  }

  private async buildOverview(sessions: EnrichedStreamSession[]) {
    const [cpuPercent, memory, gpu] = await Promise.all([
      this.sampleCpuUsagePercent(),
      this.readMemoryStats(),
      this.readGpuStats(),
    ])

    const activeCount = sessions.length
    const totalBytesSent = sessions.reduce((sum, session) => sum + session.bytes_sent, 0)
    const totalEgressMbps = Number(
      sessions
        .reduce((sum, session) => sum + Math.max(session.current_bitrate_mbps ?? 0, 0), 0)
        .toFixed(3)
    )
    const averageSessionMbps =
      activeCount > 0 ? Number((totalEgressMbps / activeCount).toFixed(3)) : 0

    let headroomMbps: number | null = null
    let estimatedAdditionalStreams: number | null = null
    if (this.configuredMaxUplinkMbps !== null) {
      headroomMbps = Number(
        Math.max(this.configuredMaxUplinkMbps - totalEgressMbps, 0).toFixed(3)
      )
      if (averageSessionMbps > 0) {
        estimatedAdditionalStreams = Math.max(
          Math.floor((headroomMbps ?? 0) / averageSessionMbps),
          0
        )
      }
    }

    return {
      active_streams: activeCount,
      active_profiles: new Set(
        sessions
          .map((session) => session.profile_id)
          .filter((value): value is number => typeof value === 'number' && value > 0)
      ).size,
      application_egress_mbps: totalEgressMbps,
      average_session_mbps: averageSessionMbps,
      total_bytes_sent: totalBytesSent,
      configured_max_uplink_mbps: this.configuredMaxUplinkMbps,
      uplink_headroom_mbps: headroomMbps,
      estimated_additional_streams: estimatedAdditionalStreams,
      cpu_percent: cpuPercent,
      load_average: os.loadavg().map((value) => Number(value.toFixed(2))),
      memory,
      gpu,
      process: {
        pid: process.pid,
        uptime_seconds: Math.round(process.uptime()),
        rss_mb: Number((process.memoryUsage().rss / 1024 / 1024).toFixed(1)),
        heap_used_mb: Number((process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1)),
      },
      host: {
        platform: os.platform(),
        release: os.release(),
        uptime_seconds: Math.round(os.uptime()),
        cpu_cores: os.cpus().length,
        hostname: os.hostname(),
      },
    }
  }

  private async enrichSessions(
    sessions: ActiveStreamSession[]
  ): Promise<EnrichedStreamSession[]> {
    if (sessions.length === 0) return []

    const profileIds = Array.from(
      new Set(
        sessions
          .map((session) => session.profile_id)
          .filter((value): value is number => typeof value === 'number' && value > 0)
      )
    )
    const userIds = Array.from(new Set(sessions.map((session) => session.user_id)))
    const mediaKeys = Array.from(
      new Set(sessions.map((session) => `${session.media_type}:${session.tmdb_id}`))
    )

    const [profiles, users, mediaEntries] = await Promise.all([
      profileIds.length > 0 ? Profile.query().whereIn('id', profileIds) : Promise.resolve([]),
      userIds.length > 0 ? User.query().whereIn('id', userIds) : Promise.resolve([]),
      Promise.all(
        mediaKeys.map(async (key) => {
          const [mediaType, tmdbId] = key.split(':')
          try {
            if (mediaType === 'movie') {
              const movie = await this.tmdb.getMovie(Number(tmdbId))
              return [
                key,
                {
                  title: movie.title,
                  poster_url: movie.poster_url ?? null,
                },
              ] as [string, MediaSummary]
            }

            const show = await this.tmdb.getTvShow(Number(tmdbId))
            return [
              key,
              {
                title: show.name,
                poster_url: show.poster_url ?? null,
              },
            ] as [string, MediaSummary]
          } catch {
            return [
              key,
              {
                title: null,
                poster_url: null,
              },
            ] as [string, MediaSummary]
          }
        })
      ),
    ])

    const profileById = new Map(profiles.map((profile) => [profile.id, profile]))
    const userById = new Map(users.map((user) => [user.id, user]))
    const mediaByKey = new Map(mediaEntries)

    return sessions.map((session) => {
      const profile =
        session.profile_id && profileById.has(session.profile_id)
          ? profileById.get(session.profile_id)!
          : null
      const user = userById.get(session.user_id) ?? null
      const media = mediaByKey.get(`${session.media_type}:${session.tmdb_id}`) ?? null
      const startedAtMs = Date.parse(session.started_at)
      const watchedForSeconds =
        Number.isFinite(startedAtMs) && startedAtMs > 0
          ? Math.max(Math.round((Date.now() - startedAtMs) / 1000), 0)
          : 0

      return {
        ...session,
        profile_name: profile?.name ?? null,
        user_label: user?.fullName ?? user?.email ?? null,
        content_title: media?.title ?? null,
        content_poster_url: media?.poster_url ?? null,
        watched_for_seconds: watchedForSeconds,
      }
    })
  }

  private async attachPerStreamResources(
    sessions: ActiveStreamSession[]
  ): Promise<ActiveStreamSession[]> {
    return Promise.all(
      sessions.map(async (session) => {
        if (session.resource_scope !== 'transcode_process' || !session.transcode_pid) {
          return {
            ...session,
            stream_cpu_percent: null,
            stream_memory_mb: null,
            stream_gpu_percent: null,
          }
        }

        const metrics = await this.readProcessMetrics(session.transcode_pid)
        if (!metrics) {
          return {
            ...session,
            stream_cpu_percent: null,
            stream_memory_mb: null,
            stream_gpu_percent: null,
          }
        }

        return {
          ...session,
          stream_cpu_percent: metrics.cpu_percent,
          stream_memory_mb: metrics.memory_mb,
          stream_gpu_percent: null,
        }
      })
    )
  }

  private async sampleCpuUsagePercent(): Promise<number | null> {
    const first = await this.readCpuSample()
    if (!first) return null
    await new Promise((resolve) => setTimeout(resolve, 140))
    const second = await this.readCpuSample()
    if (!second) return null

    const totalDelta = second.total - first.total
    const idleDelta = second.idle - first.idle
    if (totalDelta <= 0) return null

    return Number((((1 - idleDelta / totalDelta) * 100) || 0).toFixed(1))
  }

  private async readCpuSample(): Promise<CpuSample | null> {
    try {
      const content = await readFile('/proc/stat', 'utf8')
      const cpuLine = content
        .split('\n')
        .map((line) => line.trim())
        .find((line) => line.startsWith('cpu '))
      if (!cpuLine) return null

      const parts = cpuLine
        .split(/\s+/)
        .slice(1)
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value))
      if (parts.length < 4) return null

      const idle = (parts[3] ?? 0) + (parts[4] ?? 0)
      const total = parts.reduce((sum, value) => sum + value, 0)
      return { idle, total }
    } catch {
      return null
    }
  }

  private async readMemoryStats() {
    try {
      const content = await readFile('/proc/meminfo', 'utf8')
      const map = new Map<string, number>()
      for (const line of content.split('\n')) {
        const match = /^([A-Za-z_]+):\s+(\d+)/.exec(line.trim())
        if (!match) continue
        map.set(match[1], Number(match[2]))
      }

      const totalKb = map.get('MemTotal') ?? 0
      const availableKb = map.get('MemAvailable') ?? map.get('MemFree') ?? 0
      const usedKb = Math.max(totalKb - availableKb, 0)
      const usedPercent = totalKb > 0 ? Number(((usedKb / totalKb) * 100).toFixed(1)) : null

      return {
        total_mb: Number((totalKb / 1024).toFixed(1)),
        used_mb: Number((usedKb / 1024).toFixed(1)),
        available_mb: Number((availableKb / 1024).toFixed(1)),
        used_percent: usedPercent,
      }
    } catch {
      return {
        total_mb: null,
        used_mb: null,
        available_mb: null,
        used_percent: null,
      }
    }
  }

  private async readGpuStats() {
    try {
      const { stdout } = await execFile(
        'nvidia-smi',
        [
          '--query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu',
          '--format=csv,noheader,nounits',
        ],
        { timeout: 1200 }
      )
      const lines = stdout
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)

      const gpus = lines
        .map((line) => {
          const [name, util, memUsed, memTotal, temp] = line.split(',').map((value) => value.trim())
          const used = Number(memUsed)
          const total = Number(memTotal)
          return {
            name,
            utilization_percent: Number.isFinite(Number(util)) ? Number(util) : null,
            memory_used_mb: Number.isFinite(used) ? used : null,
            memory_total_mb: Number.isFinite(total) ? total : null,
            memory_used_percent:
              Number.isFinite(used) && Number.isFinite(total) && total > 0
                ? Number(((used / total) * 100).toFixed(1))
                : null,
            temperature_c: Number.isFinite(Number(temp)) ? Number(temp) : null,
          }
        })
        .filter((gpu) => gpu.name.length > 0)

      return {
        available: gpus.length > 0,
        gpus,
      }
    } catch {
      return {
        available: false,
        gpus: [],
      }
    }
  }

  private async readProcessMetrics(
    pid: number
  ): Promise<{ cpu_percent: number | null; memory_mb: number | null } | null> {
    try {
      const { stdout } = await execFile(
        'ps',
        ['-p', String(pid), '-o', '%cpu=', '-o', 'rss='],
        { timeout: 1200 }
      )
      const [cpuRaw = '', rssRaw = ''] = stdout
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)

      if (!cpuRaw && !rssRaw) return null

      const cpu = Number(cpuRaw.replace(',', '.'))
      const rssKb = Number(rssRaw)
      return {
        cpu_percent: Number.isFinite(cpu) ? Number(cpu.toFixed(1)) : null,
        memory_mb: Number.isFinite(rssKb) ? Number((rssKb / 1024).toFixed(1)) : null,
      }
    } catch {
      return null
    }
  }

  private readNumberEnv(name: string): number | null {
    const raw = process.env[name]
    if (!raw) return null
    const parsed = Number(raw)
    if (!Number.isFinite(parsed) || parsed <= 0) return null
    return parsed
  }
}
// Monitoring
