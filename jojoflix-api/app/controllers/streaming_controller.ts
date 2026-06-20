import type { HttpContext } from '@adonisjs/core/http'
import TorrentScoringService, { type TorrentSource } from '#services/torrent_scoring_service'
import RealDebridService from '#services/real_debrid_service'
import StreamRegistry from '#services/stream_registry'
import CacheWrapper, { CACHE_TTL } from '#services/cache_wrapper'
import { auth as betterAuth } from '#services/better_auth'
import crypto from 'node:crypto'
import got from 'got'
import { pipeline } from 'node:stream/promises'
import { SocksProxyAgent } from 'socks-proxy-agent'
import env from '#start/env'

export default class StreamingController {
  private readonly scoring: TorrentScoringService
  private readonly rd: RealDebridService
  private readonly registry: StreamRegistry
  private readonly cache: CacheWrapper
  private readonly torProxyAgent?: SocksProxyAgent

  constructor() {
    this.scoring = new TorrentScoringService()
    this.rd = new RealDebridService()
    this.registry = new StreamRegistry()
    this.cache = new CacheWrapper()
    const torrentioProxy = env.get('TORRENTIO_PROXY')
    this.torProxyAgent = torrentioProxy ? new SocksProxyAgent(torrentioProxy) : undefined
  }

  async movie(ctx: HttpContext) {
    const { params, request, response } = ctx
    const userId = await this.resolveUserId(ctx)
    if (!userId) {
      return response.unauthorized({
        error: { code: 'AUTH_INVALID', message: 'Non authentifié', status: 401 },
      })
    }
    const tmdbId = params.tmdb_id as string
    const sourceKey = request.input('source_key') as string | undefined
    const magnet = request.input('magnet') as string | undefined

    try {
      const reusableDirectUrl = await this.getReusableDirectUrl(userId, request)
      if (reusableDirectUrl) {
        const started = await this.proxyStream(
          userId,
          reusableDirectUrl,
          request,
          response,
          sourceKey ?? 'active-stream',
          sourceKey ?? 'active-stream',
          { tmdbId, mediaType: 'movie' }
        )
        if (started) return
      }

      const source = await this.resolveSource(tmdbId, 'movie', sourceKey, magnet)
      return this.streamWithFallback({
        userId,
        tmdbId,
        mediaType: 'movie',
        preferredSource: source,
        request,
        response,
      })
    } catch (error) {
      if (error instanceof Error && error.message !== 'NO_SOURCE_FOUND') {
        throw error
      }
      return response.status(404).json({
        error: { code: 'NO_SOURCE_FOUND', message: 'Aucune source disponible', status: 404 },
      })
    }
  }

  async tvEpisode(ctx: HttpContext) {
    const { params, request, response } = ctx
    const userId = await this.resolveUserId(ctx)
    if (!userId) {
      return response.unauthorized({
        error: { code: 'AUTH_INVALID', message: 'Non authentifié', status: 401 },
      })
    }
    const tmdbId = params.tmdb_id as string
    const season = Number(params.season)
    const episode = Number(params.episode)
    const sourceKey = request.input('source_key') as string | undefined
    const magnet = request.input('magnet') as string | undefined

    try {
      const reusableDirectUrl = await this.getReusableDirectUrl(userId, request)
      if (reusableDirectUrl) {
        const started = await this.proxyStream(
          userId,
          reusableDirectUrl,
          request,
          response,
          sourceKey ?? 'active-stream',
          sourceKey ?? 'active-stream',
          { tmdbId, mediaType: 'tv', season, episode }
        )
        if (started) return
      }

      const source = await this.resolveSource(tmdbId, 'tv', sourceKey, magnet, season, episode)
      return this.streamWithFallback({
        userId,
        tmdbId,
        mediaType: 'tv',
        season,
        episode,
        preferredSource: source,
        request,
        response,
      })
    } catch (error) {
      if (error instanceof Error && error.message !== 'NO_SOURCE_FOUND') {
        throw error
      }
      return response.status(404).json({
        error: { code: 'NO_SOURCE_FOUND', message: 'Aucune source disponible', status: 404 },
      })
    }
  }

  async prewarmTvEpisode(ctx: HttpContext) {
    const { params, request, response } = ctx
    const userId = await this.resolveUserId(ctx)
    if (!userId) {
      return response.unauthorized({
        error: { code: 'AUTH_INVALID', message: 'Non authentifié', status: 401 },
      })
    }

    const tmdbId = params.tmdb_id as string
    const season = Number(params.season)
    const episode = Number(params.episode)
    const sourceKey = request.input('source_key') as string | undefined

    try {
      const source = await this.resolveSource(tmdbId, 'tv', sourceKey, undefined, season, episode)
      const candidates = await this.getSourceFallbackCandidates(
        tmdbId,
        'tv',
        source,
        season,
        episode
      )

      for (const candidate of candidates.slice(0, 5)) {
        try {
          await this.resolveDirectUrl(candidate, 'tv', season, episode, {
            timeoutMs: 8_000,
            maxRdAttempts: 5,
          })
          if (candidate.key !== source.key) {
            console.info(
              `[stream:prewarm] switched-source tmdb=${tmdbId} s=${season} e=${episode} from=${source.key} to=${candidate.key}`
            )
          }
          return response.ok({
            data: { warmed: true, source_ready: true, source_key: candidate.key },
          })
        } catch (error) {
          console.warn(
            `[stream:prewarm] direct-url failed tmdb=${tmdbId} s=${season} e=${episode} key=${candidate.key} error=${error instanceof Error ? error.message : String(error)}`
          )
          if (!this.isSourceAvailabilityError(error)) throw error
        }
      }

      return response.ok({ data: { warmed: false, source_ready: false } })
    } catch (error) {
      console.warn(
        `[stream:prewarm] source failed tmdb=${tmdbId} s=${season} e=${episode} error=${error instanceof Error ? error.message : String(error)}`
      )
      return response.ok({ data: { warmed: false } })
    }
  }

  private async resolveUserId(ctx: HttpContext): Promise<string | null> {
    if (ctx.betterAuthUser) return ctx.betterAuthUser.id

    const authHeader = ctx.request.header('authorization') ?? ctx.request.header('Authorization')
    let token: string | null = null
    if (authHeader) {
      const match = authHeader.match(/^Bearer\s+(.+)$/i)
      if (match?.[1]) token = match[1].trim()
    }
    if (!token) {
      const queryToken = ctx.request.input('token') as string | undefined
      token = queryToken && queryToken.trim().length > 0 ? queryToken.trim() : null
    }
    if (!token) return null

    const session = await betterAuth.api
      .getSession({ headers: new Headers({ authorization: `Bearer ${token}` }) })
      .catch(() => null)
    return session?.user.id ?? null
  }

  async movieSources({ params, request, response }: HttpContext) {
    const tmdbId = params.tmdb_id as string
    const providersMode = String(request.input('providers') ?? 'fast').toLowerCase()
    const includeSlowProviders = providersMode === 'full'
    try {
      const sources = await this.scoring.getScoredSources(tmdbId, 'movie', undefined, undefined, {
        includeSlowProviders,
      })
      return response.ok({ data: sources })
    } catch (error) {
      if (error instanceof Error && error.message === 'NO_SOURCE_FOUND') {
        return response.ok({ data: [] })
      }
      throw error
    }
  }

  async tvSources({ params, request, response }: HttpContext) {
    const tmdbId = params.tmdb_id as string
    const season = Number(params.season)
    const episode = Number(params.episode)
    const providersMode = String(request.input('providers') ?? 'fast').toLowerCase()
    const includeSlowProviders = providersMode === 'full'
    try {
      const sources = await this.scoring.getScoredSources(tmdbId, 'tv', season, episode, {
        includeSlowProviders,
      })
      return response.ok({ data: sources })
    } catch (error) {
      if (error instanceof Error && error.message === 'NO_SOURCE_FOUND') {
        return response.ok({ data: [] })
      }
      throw error
    }
  }

  private async resolveSource(
    tmdbId: string,
    mediaType: 'movie' | 'tv',
    sourceKey?: string,
    magnetOverride?: string,
    season?: number,
    episode?: number
  ): Promise<TorrentSource> {
    if (sourceKey || magnetOverride) {
      const all = await this.scoring.getScoredSources(tmdbId, mediaType, season, episode)

      if (sourceKey) {
        const selected = all.find((item) => item.key === sourceKey)
        if (selected) return selected
      }

      if (magnetOverride) {
        const selected = all.find((item) => item.magnet === magnetOverride)
        if (selected) return selected
      }

      // Fallback: forcer un refetch complet (incluant fournisseurs lents comme MediaFusion)
      // au cas où la source choisie vient d'un rafraîchissement "full".
      const refreshed = await this.scoring.getScoredSources(tmdbId, mediaType, season, episode, {
        includeSlowProviders: true,
        forceRefresh: true,
      })

      if (sourceKey) {
        const selected = refreshed.find((item) => item.key === sourceKey)
        if (selected) return selected
      }

      if (magnetOverride) {
        const selected = refreshed.find((item) => item.magnet === magnetOverride)
        if (selected) return selected
      }
    }

    const { best } = await this.scoring.scoreAndSelectSource(tmdbId, mediaType, season, episode)
    return best
  }

  private async getReusableDirectUrl(
    userId: string,
    request: HttpContext['request']
  ): Promise<string | null> {
    const requestedStreamId = this.normalizeStreamId(request.input('stream_id'))
    if (!requestedStreamId) return null
    return this.registry.getUrlByStream(userId, requestedStreamId)
  }

  private async streamWithFallback(params: {
    userId: string
    tmdbId: string
    mediaType: 'movie' | 'tv'
    preferredSource: TorrentSource
    request: HttpContext['request']
    response: HttpContext['response']
    season?: number
    episode?: number
  }) {
    const { userId, tmdbId, mediaType, season, episode, preferredSource, request, response } =
      params

    const candidates = await this.getSourceFallbackCandidates(
      tmdbId,
      mediaType,
      preferredSource,
      season,
      episode
    )
    const streamed = await this.trySources(candidates, {
      userId,
      tmdbId,
      mediaType,
      season,
      episode,
      preferredSource,
      request,
      response,
    })

    if (!streamed) {
      // Toutes les URLs directes ont échoué (probablement expirées). Force-refresh et retente.
      console.info(
        `[stream:refresh] all sources failed, force-refreshing tmdb=${tmdbId} type=${mediaType} s=${season ?? '-'} e=${episode ?? '-'}`
      )
      const refreshed = await this.getSourceFallbackCandidates(
        tmdbId,
        mediaType,
        preferredSource,
        season,
        episode,
        true
      )
      const streamedAfterRefresh = await this.trySources(refreshed, {
        userId,
        tmdbId,
        mediaType,
        season,
        episode,
        preferredSource,
        request,
        response,
        afterRefresh: true,
      })

      if (!streamedAfterRefresh) {
        // Purge le cache : toutes les sources (fraîchement récupérées) ont échoué.
        // La prochaine tentative de l'utilisateur repartira de zéro depuis les providers.
        console.info(
          `[stream:invalidate] purging stale cache tmdb=${tmdbId} type=${mediaType} s=${season ?? '-'} e=${episode ?? '-'}`
        )
        await this.scoring.invalidateSources(tmdbId, mediaType, season, episode)
        return response.status(502).json({
          error: {
            code: 'NO_PLAYABLE_SOURCE',
            message: 'Aucune source lisible pour le moment. Change de source ou réessaie.',
            status: 502,
          },
        })
      }
    }
  }

  private async trySources(
    allSources: TorrentSource[],
    params: {
      userId: string
      tmdbId: string
      mediaType: 'movie' | 'tv'
      season?: number
      episode?: number
      preferredSource: TorrentSource
      request: HttpContext['request']
      response: HttpContext['response']
      afterRefresh?: boolean
    }
  ): Promise<boolean> {
    const {
      userId,
      tmdbId,
      mediaType,
      season,
      episode,
      preferredSource,
      request,
      response,
      afterRefresh,
    } = params

    if (allSources.length === 0) return false

    const deadline = Date.now() + (afterRefresh ? 25_000 : 30_000)
    const maxSourcesToTry = afterRefresh ? 6 : 8

    for (const source of allSources.slice(0, maxSourcesToTry)) {
      const remainingMs = deadline - Date.now()
      if (remainingMs <= 0) break

      try {
        console.info(
          `[stream:resolve] provider=${source.provider} key=${source.key} has_direct_url=${source.has_direct_url}`
        )
        const directUrl = await this.resolveDirectUrl(source, mediaType, season, episode, {
          timeoutMs: Math.min(remainingMs, 12_000),
          maxRdAttempts: 7,
        })
        console.info(`[stream:resolved] url=${directUrl.substring(0, 80)}`)

        if (source.key !== preferredSource.key) {
          console.info(
            `[stream:fallback] switched-source tmdb=${tmdbId} type=${mediaType} from=${preferredSource.key} to=${source.key}${afterRefresh ? ' (after refresh)' : ''}`
          )
        }

        const started = await this.proxyStream(
          userId,
          directUrl,
          request,
          response,
          preferredSource.key,
          source.key,
          {
            tmdbId,
            mediaType,
            season,
            episode,
            sourceProvider: source.provider,
          }
        )
        console.info(`[stream:proxy] started=${started} key=${source.key}`)
        if (started) return true
      } catch (error) {
        console.warn(
          `[stream:error] key=${source.key} error=${error instanceof Error ? error.message : String(error)}`
        )
        if (this.isSourceAvailabilityError(error)) continue
        throw error
      }
    }

    return false
  }

  private async getSourceFallbackCandidates(
    tmdbId: string,
    mediaType: 'movie' | 'tv',
    preferredSource: TorrentSource,
    season?: number,
    episode?: number,
    forceRefresh = false
  ): Promise<TorrentSource[]> {
    let fromScoring: TorrentSource[] = []
    try {
      fromScoring = await this.scoring.getScoredSources(tmdbId, mediaType, season, episode, {
        includeSlowProviders: true,
        forceRefresh,
      })
    } catch (error) {
      if (!(error instanceof Error) || error.message !== 'NO_SOURCE_FOUND') {
        throw error
      }
    }

    const ordered: TorrentSource[] = []
    const seen = new Set<string>()
    const pushUnique = (item?: TorrentSource) => {
      if (!item) return
      const signature =
        item.key ||
        `${item.provider}|${item.magnet}|${item.direct_url ?? ''}|${item.file_idx ?? 'na'}`
      if (seen.has(signature)) return
      seen.add(signature)
      ordered.push(item)
    }

    pushUnique(preferredSource)
    for (const source of fromScoring) {
      pushUnique(source)
    }

    // Promouvoir les sources [RD+] puis les providers non-Torrentio juste après
    // la source préférée. Quand Torrentio renvoie 403/not cached, essayer 7 autres
    // entrées Torrentio avant MediaFusion rend le lancement trop lent et fragile.
    const preferred = ordered[0]
    const rest = ordered.slice(1)
    const isRdPlus = (s: TorrentSource) => (s.raw_name ?? '').includes('[RD+]')
    const rdPlusSources = rest.filter(isRdPlus)
    const nonTorrentioSources = rest.filter((s) => !isRdPlus(s) && s.provider !== 'torrentio')
    const torrentioSources = rest.filter((s) => !isRdPlus(s) && s.provider === 'torrentio')

    return [preferred, ...rdPlusSources, ...nonTorrentioSources, ...torrentioSources]
  }

  private async resolveDirectUrl(
    source: TorrentSource,
    mediaType: 'movie' | 'tv' = 'movie',
    season?: number,
    episode?: number,
    options: { timeoutMs?: number; maxRdAttempts?: number } = {}
  ): Promise<string> {
    if (source.direct_url) {
      // Torrentio resolve URLs : on les suit via le proxy Tor pour contourner le blocage
      // Cloudflare sur l'IP du VPS. Torrentio gère lui-même l'unrestriction RD et redirige
      // vers l'URL CDN finale — on n'appelle jamais addMagnet/unrestrictLink pour ces URLs.
      if (this.isTorrentioResolveUrl(source.direct_url)) {
        return this.resolveCachedTorrentioUrl(source.direct_url, options.timeoutMs ?? 12_000)
      }
      return source.direct_url
    }

    if (!source.magnet) {
      throw new Error('NO_SOURCE_FOUND')
    }

    const resolvePromise = this.rd.unrestrictLink(source.magnet, {
      fileIdx: source.file_idx ?? null,
      maxAttempts: options.maxRdAttempts,
      season: mediaType === 'tv' ? (season ?? null) : null,
      episode: mediaType === 'tv' ? (episode ?? null) : null,
    })

    if (!options.timeoutMs) return resolvePromise
    return this.withTimeout(
      resolvePromise,
      options.timeoutMs,
      'RD_ERROR: Timeout resolving direct link'
    )
  }

  private isTorrentioResolveUrl(url: string): boolean {
    try {
      const parsed = new URL(url)
      return (
        parsed.hostname.includes('torrentio.strem.fun') && parsed.pathname.includes('/resolve/')
      )
    } catch {
      return false
    }
  }

  private async followTorrentioResolveUrl(url: string): Promise<string> {
    const agentOpts = this.torProxyAgent
      ? { agent: { https: this.torProxyAgent, http: this.torProxyAgent } }
      : {}

    const stream = got.stream(url, {
      ...agentOpts,
      followRedirect: true,
      retry: { limit: 0 },
      timeout: { connect: 20_000 },
      headers: { 'user-agent': 'Mozilla/5.0 (JOJOFLIX)' },
    })

    return new Promise<string>((resolve, reject) => {
      stream.once('response', (res) => {
        if (!stream.destroyed) stream.destroy()
        const finalUrl: string = (res as any).url ?? url
        // Si la redirection reste sur torrentio.strem.fun, c'est une erreur côté Torrentio
        // (ex: /videos/failed_unexpected_v2.mp4) — le torrent n'est pas dans le cache RD.
        try {
          const finalHost = new URL(finalUrl).hostname
          if (finalHost.includes('torrentio.strem.fun')) {
            reject(new Error('TORRENTIO_RESOLVE_FAILED: torrent not cached in RD'))
            return
          }
        } catch {
          reject(new Error('TORRENTIO_RESOLVE_FAILED: invalid final URL'))
          return
        }
        resolve(finalUrl)
      })
      stream.once('error', (err: Error) => {
        reject(new Error(`TORRENTIO_RESOLVE_FAILED: ${err.message}`))
      })
    })
  }

  private async resolveCachedTorrentioUrl(url: string, timeoutMs: number): Promise<string> {
    const cacheKey = `torrentio:resolved:${crypto.createHash('md5').update(url).digest('hex')}`
    const cached = await this.cache.get<string>(cacheKey)
    if (cached) return cached

    const resolved = await this.withTimeout(
      this.followTorrentioResolveUrl(url),
      timeoutMs,
      'TORRENTIO_RESOLVE_FAILED: Timeout resolving direct URL'
    )
    await this.cache.set(cacheKey, resolved, CACHE_TTL.RD_LINK)
    return resolved
  }

  private async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    timeoutMessage: string
  ): Promise<T> {
    let timer: NodeJS.Timeout | null = null
    const timeout = new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs)
    })

    try {
      return await Promise.race([promise, timeout])
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  private isDramayoCdnUrl(url: string): boolean {
    try {
      const { hostname } = new URL(url)
      return hostname.includes('cdnvideo') || hostname.includes('dramayo')
    } catch {
      return false
    }
  }

  private isSourceAvailabilityError(error: unknown): boolean {
    if (!(error instanceof Error)) return false
    const message = error.message.toUpperCase()
    return (
      message.includes('RD_ERROR') ||
      message.includes('TORRENTIO_RESOLVE_FAILED') ||
      message.includes('TIMEOUT') ||
      message.includes('ECONNRESET') ||
      message.includes('EAI_AGAIN')
    )
  }

  // Retourne true si le streaming a démarré (ou si une réponse d'erreur a déjà été envoyée),
  // false si l'upstream a répondu 4xx/5xx avant d'envoyer des headers → la source suivante peut être tentée.
  private async proxyStream(
    userId: string,
    directUrl: string,
    request: HttpContext['request'],
    response: HttpContext['response'],
    requestedSourceKey: string,
    selectedSourceKey: string,
    metadata: {
      tmdbId: string
      mediaType: 'movie' | 'tv'
      season?: number
      episode?: number
      sourceProvider?: string
    }
  ): Promise<boolean> {
    const requestedStreamId = this.normalizeStreamId(request.input('stream_id'))
    const streamId = requestedStreamId ?? crypto.randomUUID()

    // Stream proxy (Range + backpressure) : on ne renvoie jamais l'URL RD au client.
    const rangeHeader = request.header('range')
    const proxyHeaders: Record<string, string> = {}
    if (rangeHeader) proxyHeaders['Range'] = rangeHeader
    const isDramayoCdn = this.isDramayoCdnUrl(directUrl)
    // DramaYo CDN requiert un Referer pour servir les manifests HLS (sinon 403)
    if (isDramayoCdn) {
      proxyHeaders['Referer'] = 'https://www.dramayo.com/'
      proxyHeaders['Origin'] = 'https://www.dramayo.com'
      proxyHeaders['User-Agent'] = 'Mozilla/5.0 (JOJOFLIX)'
    }
    const agentOpts =
      isDramayoCdn && this.torProxyAgent
        ? { agent: { https: this.torProxyAgent, http: this.torProxyAgent } }
        : {}
    const upstream = got.stream(directUrl, {
      ...agentOpts,
      throwHttpErrors: false,
      decompress: false,
      retry: { limit: 0 },
      timeout: { connect: 15_000 },
      headers: Object.keys(proxyHeaders).length > 0 ? proxyHeaders : undefined,
    })

    // BUG #9 fix: store the cleanup listener so we can remove it on the error path,
    // preventing a dangling listener from leaking on every failed proxy stream.
    const cleanupListener = () => {
      if (!upstream.destroyed) upstream.destroy()
    }
    response.response.once('close', cleanupListener)

    try {
      const started = await new Promise<boolean>((resolve, reject) => {
        upstream.once('response', (upstreamResponse) => {
          void (async () => {
            const statusCode = upstreamResponse.statusCode ?? 500
            const finalUrl: string = (upstreamResponse as any).url ?? directUrl
            console.info(
              `[stream:upstream] status=${statusCode} finalUrl=${finalUrl.substring(0, 100)}`
            )

            // resolve(false) toujours EN PREMIER pour éviter une race condition :
            // upstream.destroy() peut émettre 'error' de façon synchrone, ce qui appellerait
            // reject() avant resolve(), forçant le catch à envoyer un 502 au lieu de continuer.
            if (statusCode >= 400) {
              resolve(false)
              if (!upstream.destroyed) upstream.destroy()
              return
            }

            // Rejeter les réponses non-vidéo : JSON, HTML, XML → mpv voit des "streams filtrés"
            // car il tente de les parser comme container vidéo et échoue à sélectionner des pistes.
            const contentType = (upstreamResponse.headers['content-type'] ?? '').toLowerCase()
            const isVideoLike =
              contentType.startsWith('video/') ||
              contentType.startsWith('audio/') ||
              contentType.includes('octet-stream') ||
              contentType.includes('mpeg') ||
              contentType === '' // Certains CDN n'envoient pas de Content-Type, on laisse passer
            if (
              !isVideoLike &&
              (contentType.includes('json') ||
                contentType.includes('html') ||
                contentType.includes('xml') ||
                contentType.includes('text/plain'))
            ) {
              console.warn(
                `[stream:upstream] non-video content-type="${contentType}" → reject source`
              )
              resolve(false)
              if (!upstream.destroyed) upstream.destroy()
              return
            }

            // Détecter les vidéos d'erreur internes des providers :
            // MediaFusion sert mediafusion.elfhosted.com/static/exceptions/torrent_not_downloaded.mp4
            // (status 206, content-type video/mp4, mais c'est une vidéo "torrent pas téléchargé")
            // On détecte quand la redirection finale reste sur le même domaine que l'URL d'entrée.
            try {
              const finalHost = new URL(finalUrl).hostname
              const inputHost = new URL(directUrl).hostname
              if (finalHost === inputHost && finalUrl !== directUrl) {
                console.warn(
                  `[stream:upstream] internal error video detected host=${finalHost} path=${new URL(finalUrl).pathname}`
                )
                resolve(false)
                if (!upstream.destroyed) upstream.destroy()
                return
              }
            } catch {
              // URL invalide : on continue le streaming normalement
            }

            const wrongEpisode = this.detectWrongEpisodeFinalUrl(finalUrl, metadata)
            if (wrongEpisode) {
              console.warn(
                `[stream:upstream] wrong episode detected expected=s${metadata.season}e${metadata.episode} got=s${wrongEpisode.season ?? '?'}e${wrongEpisode.episode} pattern=${wrongEpisode.pattern}`
              )
              resolve(false)
              if (!upstream.destroyed) upstream.destroy()
              return
            }

            await this.registry.register(userId, streamId, directUrl, {
              profile_id: this.normalizeProfileId(request.input('profile_id')),
              tmdb_id: metadata.tmdbId,
              media_type: metadata.mediaType,
              season: metadata.season ?? null,
              episode: metadata.episode ?? null,
              source_key: selectedSourceKey,
              source_provider: metadata.sourceProvider ?? null,
              direct_url_host: this.directUrlHost(finalUrl),
              user_agent: request.header('user-agent') ?? null,
            })

            response.response.statusCode = statusCode
            response.header('x-jojoflix-stream-id', streamId)
            response.header('x-jojoflix-requested-source-key', requestedSourceKey)
            response.header('x-jojoflix-selected-source-key', selectedSourceKey)
            response.header(
              'x-jojoflix-source-fallback',
              // BUG #14 fix: use strict equality to avoid type coercion on source key comparison.
              requestedSourceKey === selectedSourceKey ? '0' : '1'
            )

            const headersToForward = [
              'content-type',
              'content-length',
              'content-range',
              'accept-ranges',
              'etag',
              'last-modified',
              'cache-control',
            ]

            for (const name of headersToForward) {
              const value = upstreamResponse.headers[name]
              if (value !== undefined) {
                response.header(name, String(value))
              }
            }

            if (!response.response.getHeader('accept-ranges')) {
              response.header('accept-ranges', 'bytes')
            }

            pipeline(upstream, response.response)
              .then(() => {
                response.response.removeListener('close', cleanupListener)
                resolve(true)
              })
              .catch(reject)
          })().catch(reject)
        })

        upstream.once('error', reject)
      })
      return started
    } catch (error) {
      try {
        if (!response.response.headersSent) {
          // BUG #9 fix: remove the close listener before sending an error response
          // so it doesn't fire and destroy an already-handled upstream.
          response.response.removeListener('close', cleanupListener)
          response.status(502).json({
            error: { code: 'STREAM_PROXY_FAILED', message: 'Erreur de streaming', status: 502 },
          })
          return true // réponse d'erreur envoyée
        }
        if (!response.response.writableEnded) {
          response.response.end()
        }
        response.response.removeListener('close', cleanupListener)
      } catch {
        // Headers already sent — absorb the exception silently
      }
      return true // stream déjà commencé
    }
  }

  private normalizeStreamId(value: unknown): string | null {
    const streamId = String(value ?? '').trim()
    if (!streamId) return null
    if (!/^[a-zA-Z0-9._:-]{1,120}$/.test(streamId)) return null
    return streamId
  }

  private normalizeProfileId(value: unknown): number | null {
    const parsed = Number(value)
    if (!Number.isInteger(parsed) || parsed < 0) return null
    return parsed
  }

  private directUrlHost(url: string): string | null {
    try {
      return new URL(url).hostname
    } catch {
      return null
    }
  }

  private detectWrongEpisodeFinalUrl(
    finalUrl: string,
    metadata: { mediaType: 'movie' | 'tv'; season?: number; episode?: number }
  ): { season: number | null; episode: number; pattern: string } | null {
    if (metadata.mediaType !== 'tv' || metadata.season == null || metadata.episode == null) {
      return null
    }

    const probeText = this.episodeProbeText(finalUrl)
    const markers = this.extractEpisodeMarkers(probeText)
    if (markers.length === 0) return null

    const seasonMarkers = markers.filter((marker) => marker.season != null)
    for (const marker of seasonMarkers) {
      if (this.markerMatchesRequestedEpisode(marker, metadata.season, metadata.episode)) {
        return null
      }
    }

    if (seasonMarkers.length > 0) {
      return seasonMarkers[0]
    }

    const episodeMarker = markers[0]
    if (this.markerMatchesRequestedEpisode(episodeMarker, metadata.season, metadata.episode)) {
      return null
    }
    return episodeMarker
  }

  private episodeProbeText(url: string): string {
    try {
      const parsed = new URL(url)
      return decodeURIComponent(parsed.pathname)
    } catch {
      try {
        return decodeURIComponent(url)
      } catch {
        return url
      }
    }
  }

  private extractEpisodeMarkers(text: string): Array<{
    season: number | null
    episode: number
    endEpisode: number | null
    pattern: string
  }> {
    const markers: Array<{
      season: number | null
      episode: number
      endEpisode: number | null
      pattern: string
    }> = []

    const seasonEpisode =
      /\bS0*(\d{1,2})[\s._-]*E0*(\d{1,3})(?:\s*(?:-|–|~|to)\s*(?:S0*\d{1,2}[\s._-]*)?E?0*(\d{1,3}))?/gi
    for (const match of text.matchAll(seasonEpisode)) {
      markers.push({
        season: Number(match[1]),
        episode: Number(match[2]),
        endEpisode: match[3] ? Number(match[3]) : null,
        pattern: match[0],
      })
    }

    const xPattern = /\b0*(\d{1,2})x0*(\d{1,3})(?:\s*(?:-|–|~|to)\s*0*(\d{1,3}))?\b/gi
    for (const match of text.matchAll(xPattern)) {
      markers.push({
        season: Number(match[1]),
        episode: Number(match[2]),
        endEpisode: match[3] ? Number(match[3]) : null,
        pattern: match[0],
      })
    }

    if (markers.length > 0) return markers

    const episodeOnly =
      /(?:^|[^\w])(?:ep|episode)[\s._-]*0*(\d{1,3})(?:\s*(?:-|–|~|to)\s*(?:ep|episode)?[\s._-]*0*(\d{1,3}))?(?=$|[^\w])/gi
    for (const match of text.matchAll(episodeOnly)) {
      markers.push({
        season: null,
        episode: Number(match[1]),
        endEpisode: match[2] ? Number(match[2]) : null,
        pattern: match[0].trim(),
      })
    }

    return markers
  }

  private markerMatchesRequestedEpisode(
    marker: { season: number | null; episode: number; endEpisode: number | null },
    season: number,
    episode: number
  ): boolean {
    if (marker.season != null && marker.season !== season) return false
    if (marker.endEpisode != null) {
      return episode >= marker.episode && episode <= marker.endEpisode
    }
    return marker.episode === episode
  }
}
