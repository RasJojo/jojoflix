import { useEffect, useMemo, useState } from 'react'
import {
  Activity,
  Cpu,
  Gauge,
  HardDriveDownload,
  LogOut,
  MemoryStick,
  RefreshCw,
  Server,
  Tv,
  Users,
  Wifi,
} from 'lucide-react'

type Snapshot = {
  generated_at: string
  overview: {
    active_streams: number
    active_profiles: number
    application_egress_mbps: number
    average_session_mbps: number
    total_bytes_sent: number
    configured_max_uplink_mbps: number | null
    uplink_headroom_mbps: number | null
    estimated_additional_streams: number | null
    cpu_percent: number | null
    load_average: number[]
    memory: {
      total_mb: number | null
      used_mb: number | null
      available_mb: number | null
      used_percent: number | null
    }
    gpu: {
      available: boolean
      gpus: Array<{
        name: string
        utilization_percent: number | null
        memory_used_mb: number | null
        memory_total_mb: number | null
        memory_used_percent: number | null
        temperature_c: number | null
      }>
    }
    process: {
      pid: number
      uptime_seconds: number
      rss_mb: number
      heap_used_mb: number
    }
    host: {
      platform: string
      release: string
      uptime_seconds: number
      cpu_cores: number
      hostname: string
    }
  }
  sessions: Session[]
}

type Session = {
  user_id: number
  stream_id: string
  profile_id: number | null
  profile_name: string | null
  user_label: string | null
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
  content_title: string | null
  content_poster_url: string | null
  watched_for_seconds: number
}

const STORAGE_KEY = 'jojoflix-monitor-auth'
const DEFAULT_BASE_URL =
  (import.meta.env.VITE_MONITOR_API_BASE_URL as string | undefined)?.trim() ||
  'https://jojoflixapi.jojoserv.com'
const POLL_MS = 5000

type StoredAuth = {
  baseUrl: string
  email: string
  token: string
}

function readStoredAuth(): StoredAuth | null {
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as StoredAuth
  } catch {
    return null
  }
}

function writeStoredAuth(value: StoredAuth | null) {
  if (!value) {
    window.localStorage.removeItem(STORAGE_KEY)
    return
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value))
}

export default function App() {
  const stored = useMemo(readStoredAuth, [])
  const [baseUrl, setBaseUrl] = useState(stored?.baseUrl ?? DEFAULT_BASE_URL)
  const [email, setEmail] = useState(stored?.email ?? '')
  const [password, setPassword] = useState('')
  const [token, setToken] = useState(stored?.token ?? '')
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastRefreshLabel, setLastRefreshLabel] = useState('Jamais')

  useEffect(() => {
    if (!token) return

    let cancelled = false
    let timer: number | null = null

    const load = async () => {
      setLoading(true)
      try {
        const response = await fetch(`${sanitizeBaseUrl(baseUrl)}/api/monitoring/overview`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        })
        if (response.status === 401) {
          throw new Error('Session expirée. Reconnecte-toi.')
        }
        if (!response.ok) {
          throw new Error(`Monitoring indisponible (${response.status})`)
        }
        const json = (await response.json()) as { data: Snapshot }
        if (cancelled) return
        setSnapshot(json.data)
        setError(null)
        setLastRefreshLabel(new Date().toLocaleTimeString('fr-FR'))
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Erreur de monitoring')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()
    timer = window.setInterval(() => {
      void load()
    }, POLL_MS)

    return () => {
      cancelled = true
      if (timer) window.clearInterval(timer)
    }
  }, [baseUrl, token])

  const handleLogin = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setLoading(true)
    setError(null)

    try {
      const response = await fetch(`${sanitizeBaseUrl(baseUrl)}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email, password }),
      })
      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload?.error?.message ?? 'Connexion impossible')
      }
      const nextToken = payload?.data?.token as string | undefined
      if (!nextToken) {
        throw new Error('Token de session manquant')
      }
      setToken(nextToken)
      writeStoredAuth({
        baseUrl: sanitizeBaseUrl(baseUrl),
        email,
        token: nextToken,
      })
      setPassword('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connexion impossible')
    } finally {
      setLoading(false)
    }
  }

  const handleLogout = () => {
    setToken('')
    setSnapshot(null)
    setPassword('')
    writeStoredAuth(null)
  }

  if (!token) {
    return (
      <main className="shell shell-login">
        <section className="login-card">
          <div className="eyebrow">JOJOFLIX MONITOR</div>
          <h1>Monitoring de la plateforme</h1>
          <p>
            Vue live sur les streams actifs, le débit réellement consommé par Jojoflix,
            et la charge machine visible depuis le backend.
          </p>
          <form className="login-form" onSubmit={handleLogin}>
            <label>
              API
              <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
            </label>
            <label>
              Email
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
              />
            </label>
            <label>
              Mot de passe
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
            </label>
            <button type="submit" disabled={loading}>
              {loading ? 'Connexion...' : 'Entrer dans le dashboard'}
            </button>
          </form>
          {error ? <div className="error-banner">{error}</div> : null}
        </section>
      </main>
    )
  }

  const overview = snapshot?.overview
  const sessions = snapshot?.sessions ?? []

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <div className="eyebrow">JOJOFLIX MONITOR</div>
          <h1>Dashboard d’exploitation</h1>
        </div>
        <div className="topbar-actions">
          <span className="status-pill">
            <RefreshCw size={16} />
            Dernière sync: {lastRefreshLabel}
          </span>
          <button className="ghost-button" onClick={handleLogout}>
            <LogOut size={16} />
            Déconnexion
          </button>
        </div>
      </header>

      {error ? <div className="error-banner">{error}</div> : null}

      {overview ? (
        <>
          <section className="hero-grid">
            <MetricCard
              icon={<Activity size={18} />}
              label="Streams actifs"
              value={overview.active_streams}
              sub={`${overview.active_profiles} profils distincts`}
              tone="red"
            />
            <MetricCard
              icon={<Wifi size={18} />}
              label="Débit Jojoflix"
              value={`${overview.application_egress_mbps.toFixed(2)} Mbps`}
              sub={`moyenne ${overview.average_session_mbps.toFixed(2)} Mbps / session`}
              tone="blue"
            />
            <MetricCard
              icon={<Cpu size={18} />}
              label="CPU"
              value={overview.cpu_percent !== null ? `${overview.cpu_percent}%` : 'n/a'}
              sub={`load ${overview.load_average.join(' / ')}`}
              tone="amber"
            />
            <MetricCard
              icon={<MemoryStick size={18} />}
              label="Mémoire"
              value={
                overview.memory.used_percent !== null ? `${overview.memory.used_percent}%` : 'n/a'
              }
              sub={
                overview.memory.used_mb !== null && overview.memory.total_mb !== null
                  ? `${formatMegabytes(overview.memory.used_mb)} / ${formatMegabytes(overview.memory.total_mb)}`
                  : 'indisponible'
              }
              tone="green"
            />
          </section>

          <section className="panel-grid">
            <article className="panel">
              <div className="panel-header">
                <div>
                  <div className="panel-title">Capacité réseau</div>
                  <div className="panel-subtitle">
                    Basée sur le trafic réellement servi par Jojoflix
                  </div>
                </div>
                <Gauge size={18} />
              </div>
              <div className="capacity-grid">
                <InfoRow label="Débit courant" value={`${overview.application_egress_mbps.toFixed(2)} Mbps`} />
                <InfoRow
                  label="Uplink configuré"
                  value={
                    overview.configured_max_uplink_mbps !== null
                      ? `${overview.configured_max_uplink_mbps.toFixed(1)} Mbps`
                      : 'non défini'
                  }
                />
                <InfoRow
                  label="Marge restante"
                  value={
                    overview.uplink_headroom_mbps !== null
                      ? `${overview.uplink_headroom_mbps.toFixed(2)} Mbps`
                      : 'n/a'
                  }
                />
                <InfoRow
                  label="Streams additionnels estimés"
                  value={
                    overview.estimated_additional_streams !== null
                      ? String(overview.estimated_additional_streams)
                      : 'n/a'
                  }
                />
              </div>
              <p className="panel-note">
                Pour une vraie estimation de capacité max, définis côté backend
                <code> MONITOR_MAX_UPLINK_MBPS</code>.
              </p>
            </article>

            <article className="panel">
              <div className="panel-header">
                <div>
                  <div className="panel-title">Machine</div>
                  <div className="panel-subtitle">Vue exposée par le backend</div>
                </div>
                <Server size={18} />
              </div>
              <div className="capacity-grid">
                <InfoRow label="Host" value={overview.host.hostname} />
                <InfoRow label="OS" value={`${overview.host.platform} ${overview.host.release}`} />
                <InfoRow label="Uptime hôte" value={formatDuration(overview.host.uptime_seconds)} />
                <InfoRow label="Uptime backend" value={formatDuration(overview.process.uptime_seconds)} />
                <InfoRow label="RSS backend" value={formatMegabytes(overview.process.rss_mb)} />
                <InfoRow label="Heap backend" value={formatMegabytes(overview.process.heap_used_mb)} />
              </div>
            </article>

            <article className="panel panel-gpu">
              <div className="panel-header">
                <div>
                  <div className="panel-title">GPU</div>
                  <div className="panel-subtitle">Best effort depuis le runtime backend</div>
                </div>
                <HardDriveDownload size={18} />
              </div>
              {overview.gpu.available ? (
                <div className="gpu-list">
                  {overview.gpu.gpus.map((gpu) => (
                    <div key={gpu.name} className="gpu-card">
                      <strong>{gpu.name}</strong>
                      <span>Charge {gpu.utilization_percent ?? 'n/a'}%</span>
                      <span>
                        VRAM {gpu.memory_used_mb ?? 'n/a'} / {gpu.memory_total_mb ?? 'n/a'} MB
                      </span>
                      <span>Temp {gpu.temperature_c ?? 'n/a'}°C</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="panel-note">
                  GPU non exposé au conteneur backend. Le dashboard montrera alors uniquement les
                  métriques process + trafic Jojoflix.
                </p>
              )}
            </article>
          </section>

          <section className="panel sessions-panel">
            <div className="panel-header">
              <div>
                <div className="panel-title">Sessions actives</div>
                <div className="panel-subtitle">
                  Profils actuellement en lecture, contenu, source et débit observé
                </div>
              </div>
              <Users size={18} />
            </div>
            {sessions.length === 0 ? (
              <div className="empty-state">Aucune lecture active pour le moment.</div>
            ) : (
              <div className="session-list">
                {sessions.map((session) => (
                  <article key={session.stream_id} className="session-card">
                    <div className="session-main">
                      <div className="session-title-row">
                        <div>
                          <h2>{session.content_title ?? `${session.media_type.toUpperCase()} ${session.tmdb_id}`}</h2>
                          <div className="session-meta">
                            <span>{session.profile_name ?? 'Profil inconnu'}</span>
                            <span>{session.user_label ?? `User ${session.user_id}`}</span>
                            <span>{session.mode === 'web_transcode' ? 'Web transcode' : 'Direct'}</span>
                          </div>
                        </div>
                        <span className="provider-badge">{session.source_provider ?? 'source'}</span>
                      </div>
                      <div className="session-grid">
                        <InfoRow label="Lecture" value={formatMediaRef(session)} />
                        <InfoRow label="Débit" value={formatMbps(session.current_bitrate_mbps)} />
                        <InfoRow label="Volume servi" value={formatBytes(session.bytes_sent)} />
                        <InfoRow
                          label="CPU stream"
                          value={formatStreamCpu(session)}
                        />
                        <InfoRow
                          label="RAM stream"
                          value={formatStreamMemory(session)}
                        />
                        <InfoRow
                          label="GPU stream"
                          value={formatStreamGpu(session)}
                        />
                        <InfoRow label="Depuis" value={formatDuration(session.watched_for_seconds)} />
                        <InfoRow label="Dernière activité" value={formatDateTime(session.last_activity_at)} />
                        <InfoRow label="Host" value={session.direct_url_host ?? 'n/a'} />
                      </div>
                      <div className="session-source-key">
                        {formatResourceScope(session)}
                        {' · '}
                        {session.source_key ?? 'source_key indisponible'}
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </>
      ) : (
        <section className="panel loading-panel">Chargement du snapshot de monitoring…</section>
      )}
    </main>
  )
}

function MetricCard({
  icon,
  label,
  value,
  sub,
  tone,
}: {
  icon: React.ReactNode
  label: string
  value: string | number
  sub: string
  tone: 'red' | 'blue' | 'amber' | 'green'
}) {
  return (
    <article className={`metric-card tone-${tone}`}>
      <div className="metric-icon">{icon}</div>
      <div className="metric-label">{label}</div>
      <div className="metric-value">{value}</div>
      <div className="metric-sub">{sub}</div>
    </article>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="info-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function sanitizeBaseUrl(value: string) {
  return value.trim().replace(/\/+$/, '')
}

function formatBytes(value: number) {
  if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(2)} GB`
  if (value >= 1024 ** 2) return `${(value / 1024 ** 2).toFixed(1)} MB`
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${value} B`
}

function formatMegabytes(value: number) {
  if (value >= 1024) return `${(value / 1024).toFixed(2)} GB`
  return `${value.toFixed(1)} MB`
}

function formatDuration(seconds: number) {
  const hrs = Math.floor(seconds / 3600)
  const mins = Math.floor((seconds % 3600) / 60)
  const secs = seconds % 60
  if (hrs > 0) return `${hrs}h ${mins}m`
  if (mins > 0) return `${mins}m ${secs}s`
  return `${secs}s`
}

function formatDateTime(value: string) {
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return value
  return new Date(timestamp).toLocaleString('fr-FR')
}

function formatMediaRef(session: Session) {
  if (session.media_type === 'movie') return 'Film'
  const season = session.season ?? 0
  const episode = session.episode ?? 0
  return `S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}`
}

function formatMbps(value: number | null) {
  if (value === null) return 'n/a'
  return `${value.toFixed(2)} Mbps`
}

function formatStreamCpu(session: Session) {
  if (session.resource_scope !== 'transcode_process') return 'partagé'
  if (session.stream_cpu_percent === null) return 'n/a'
  return `${session.stream_cpu_percent.toFixed(1)}%`
}

function formatStreamMemory(session: Session) {
  if (session.resource_scope !== 'transcode_process') return 'partagée'
  if (session.stream_memory_mb === null) return 'n/a'
  return formatMegabytes(session.stream_memory_mb)
}

function formatStreamGpu(session: Session) {
  if (session.resource_scope !== 'transcode_process') return 'partagé'
  if (session.stream_gpu_percent === null) return 'n/a'
  return `${session.stream_gpu_percent.toFixed(1)}%`
}

function formatResourceScope(session: Session) {
  if (session.resource_scope === 'transcode_process') {
    return `Transcode dédié${session.transcode_pid ? ` · PID ${session.transcode_pid}` : ''}`
  }
  return 'Proxy direct · CPU/RAM mutualisés'
}
