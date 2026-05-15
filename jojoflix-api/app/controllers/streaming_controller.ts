import type { HttpContext } from '@adonisjs/core/http'
import TorrentScoringService, { type TorrentSource } from '#services/torrent_scoring_service'
import RealDebridService from '#services/real_debrid_service'
import StreamRegistry from '#services/stream_registry'
import User from '#models/user'
import crypto from 'node:crypto'
import got from 'got'
import { pipeline } from 'node:stream/promises'
import { Secret } from '@adonisjs/core/helpers'
import { SocksProxyAgent } from 'socks-proxy-agent'
import env from '#start/env'

export default class StreamingController {
  private readonly scoring: TorrentScoringService
  private readonly rd: RealDebridService
  private readonly registry: StreamRegistry
  private readonly torProxyAgent?: SocksProxyAgent

  constructor() {
    this.scoring = new TorrentScoringService()
    this.rd = new RealDebridService()
    this.registry = new StreamRegistry()
    const torrentioProxy = env.get('TORRENTIO_PROXY')
    this.torProxyAgent = torrentioProxy ? new SocksProxyAgent(torrentioProxy) : undefined
  }

  async movie({ auth, params, request, response }: HttpContext) {
    const userId = await this.resolveUserId(auth, request)
    if (!userId) {
      return response.unauthorized({
        error: { code: 'AUTH_INVALID', message: 'Non authentifié', status: 401 },
      })
    }
    const tmdbId = params.tmdb_id as string
    const sourceKey = request.input('source_key') as string | undefined
    const magnet = request.input('magnet') as string | undefined

    try {
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

  async tvEpisode({ auth, params, request, response }: HttpContext) {
    const userId = await this.resolveUserId(auth, request)
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

  async prewarmTvEpisode({ auth, params, request, response }: HttpContext) {
    const userId = await this.resolveUserId(auth, request)
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
      return response.ok({ data: { warmed: true, source_key: source.key } })
    } catch {
      return response.ok({ data: { warmed: false } })
    }
  }

  private async resolveUserId(
    auth: HttpContext['auth'],
    request: HttpContext['request']
  ): Promise<number | null> {
    try {
      const user = auth.getUserOrFail()
      return user.id
    } catch {
      // Fallback token pour players qui ne passent pas Authorization.
    }

    const queryToken = request.input('token') as string | undefined
    if (!queryToken) return null

    const accessToken = await User.accessTokens.verify(new Secret(queryToken))
    if (!accessToken || accessToken.isExpired()) return null

    return Number(accessToken.tokenableId)
  }

  async movieSources({ auth, params, request, response }: HttpContext) {
    auth.getUserOrFail()
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

  async tvSources({ auth, params, request, response }: HttpContext) {
    auth.getUserOrFail()
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

  private async streamWithFallback(params: {
    userId: number
    tmdbId: string
    mediaType: 'movie' | 'tv'
    preferredSource: TorrentSource
    request: HttpContext['request']
    response: HttpContext['response']
    season?: number
    episode?: number
  }) {
    const {
      userId,
      tmdbId,
      mediaType,
      season,
      episode,
      preferredSource,
      request,
      response,
    } = params

    const candidates = await this.getSourceFallbackCandidates(tmdbId, mediaType, preferredSource, season, episode)
    const streamed = await this.trySources(candidates, { userId, tmdbId, mediaType, preferredSource, request, response })

    if (!streamed) {
      // Toutes les URLs directes ont échoué (probablement expirées). Force-refresh et retente.
      console.info(`[stream:refresh] all sources failed, force-refreshing tmdb=${tmdbId} type=${mediaType} s=${season ?? '-'} e=${episode ?? '-'}`)
      const refreshed = await this.getSourceFallbackCandidates(tmdbId, mediaType, preferredSource, season, episode, true)
      const streamedAfterRefresh = await this.trySources(refreshed, { userId, tmdbId, mediaType, preferredSource, request, response, afterRefresh: true })

      if (!streamedAfterRefresh) {
        // Purge le cache : toutes les sources (fraîchement récupérées) ont échoué.
        // La prochaine tentative de l'utilisateur repartira de zéro depuis les providers.
        console.info(`[stream:invalidate] purging stale cache tmdb=${tmdbId} type=${mediaType} s=${season ?? '-'} e=${episode ?? '-'}`)
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
      userId: number
      tmdbId: string
      mediaType: 'movie' | 'tv'
      preferredSource: TorrentSource
      request: HttpContext['request']
      response: HttpContext['response']
      afterRefresh?: boolean
    }
  ): Promise<boolean> {
    const { userId, tmdbId, mediaType, preferredSource, request, response, afterRefresh } = params

    if (allSources.length === 0) return false

    const deadline = Date.now() + 60_000
    const maxSourcesToTry = 15

    for (const source of allSources.slice(0, maxSourcesToTry)) {
      const remainingMs = deadline - Date.now()
      if (remainingMs <= 0) break

      try {
        console.info(`[stream:resolve] provider=${source.provider} key=${source.key} has_direct_url=${source.has_direct_url}`)
        const directUrl = await this.resolveDirectUrl(source)
        console.info(`[stream:resolved] url=${directUrl.substring(0, 80)}`)

        if (source.key !== preferredSource.key) {
          console.info(
            `[stream:fallback] switched-source tmdb=${tmdbId} type=${mediaType} from=${preferredSource.key} to=${source.key}${afterRefresh ? ' (after refresh)' : ''}`
          )
        }

        const started = await this.proxyStream(userId, directUrl, request, response, preferredSource.key, source.key)
        console.info(`[stream:proxy] started=${started} key=${source.key}`)
        if (started) return true
      } catch (error) {
        console.warn(`[stream:error] key=${source.key} error=${error instanceof Error ? error.message : String(error)}`)
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
        item.key || `${item.provider}|${item.magnet}|${item.direct_url ?? ''}|${item.file_idx ?? 'na'}`
      if (seen.has(signature)) return
      seen.add(signature)
      ordered.push(item)
    }

    pushUnique(preferredSource)
    for (const source of fromScoring) {
      pushUnique(source)
    }

    // Promouvoir les sources [RD+] (déjà dans la bibliothèque RD de l'utilisateur) juste
    // après la source préférée, avant les autres sources non-vérifiées. Sans ce tri,
    // les sources FRENCH non-disponibles (score élevé) remplissent les 8 premiers slots
    // et on n'atteint jamais les sources qui marchent réellement.
    const preferred = ordered[0]
    const rest = ordered.slice(1)
    const isRdPlus = (s: TorrentSource) => (s.raw_name ?? '').includes('[RD+]')
    const rdPlusSources = rest.filter(isRdPlus)
    const otherSources = rest.filter((s) => !isRdPlus(s))

    return [preferred, ...rdPlusSources, ...otherSources]
  }

  private async resolveDirectUrl(source: TorrentSource): Promise<string> {
    if (source.direct_url) {
      // Torrentio resolve URLs : on les suit via le proxy Tor pour contourner le blocage
      // Cloudflare sur l'IP du VPS. Torrentio gère lui-même l'unrestriction RD et redirige
      // vers l'URL CDN finale — on n'appelle jamais addMagnet/unrestrictLink pour ces URLs.
      if (this.isTorrentioResolveUrl(source.direct_url)) {
        return this.followTorrentioResolveUrl(source.direct_url)
      }
      return source.direct_url
    }

    if (!source.magnet) {
      throw new Error('NO_SOURCE_FOUND')
    }

    return this.rd.unrestrictLink(source.magnet, {
      fileIdx: source.file_idx ?? null,
    })
  }

  private isTorrentioResolveUrl(url: string): boolean {
    try {
      const parsed = new URL(url)
      return parsed.hostname.includes('torrentio.strem.fun') && parsed.pathname.includes('/resolve/')
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
    userId: number,
    directUrl: string,
    request: HttpContext['request'],
    response: HttpContext['response'],
    requestedSourceKey: string,
    selectedSourceKey: string
  ): Promise<boolean> {
    // 1. Invalider l'ancien flux et enregistrer le nouveau
    const streamId = crypto.randomUUID()
    await this.registry.register(userId, streamId)

    // 2. Vérifier que ce flux est toujours actif (pas invalidé entre-temps)
    const activeStreamId = await this.registry.getActive(userId)
    if (activeStreamId !== streamId) {
      response.status(499).json({
        error: {
          code: 'STREAM_INVALIDATED',
          message: 'Le flux a été interrompu suite à une déconnexion',
          status: 499,
        },
      })
      return true // réponse envoyée, ne pas tenter d'autre source
    }

    // 3. Stocker l'URL directe pour le transcoding (sélection piste audio)
    await this.registry.register(userId, streamId, directUrl)

    // 4. Stream proxy (Range + backpressure) : on ne renvoie jamais l'URL RD au client.
    const rangeHeader = request.header('range')
    const upstream = got.stream(directUrl, {
      throwHttpErrors: false,
      decompress: false,
      retry: { limit: 0 },
      timeout: { connect: 15_000 },
      headers: rangeHeader ? { Range: rangeHeader } : undefined,
    })

    response.response.once('close', () => {
      if (!upstream.destroyed) upstream.destroy()
    })

    try {
      const started = await new Promise<boolean>((resolve, reject) => {
        upstream.once('response', (upstreamResponse) => {
          const statusCode = upstreamResponse.statusCode ?? 500
          const finalUrl: string = (upstreamResponse as any).url ?? directUrl
          console.info(`[stream:upstream] status=${statusCode} finalUrl=${finalUrl.substring(0, 100)}`)

          // resolve(false) toujours EN PREMIER pour éviter une race condition :
          // upstream.destroy() peut émettre 'error' de façon synchrone, ce qui appellerait
          // reject() avant resolve(), forçant le catch à envoyer un 502 au lieu de continuer.
          if (statusCode >= 400) {
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
              console.warn(`[stream:upstream] internal error video detected host=${finalHost} path=${new URL(finalUrl).pathname}`)
              resolve(false)
              if (!upstream.destroyed) upstream.destroy()
              return
            }
          } catch {
            // URL invalide : on continue le streaming normalement
          }

          response.response.statusCode = statusCode
          response.header('x-jojoflix-requested-source-key', requestedSourceKey)
          response.header('x-jojoflix-selected-source-key', selectedSourceKey)
          response.header(
            'x-jojoflix-source-fallback',
            requestedSourceKey == selectedSourceKey ? '0' : '1'
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

          pipeline(upstream, response.response).then(() => resolve(true)).catch(reject)
        })

        upstream.once('error', reject)
      })
      return started
    } catch (error) {
      if (!response.response.headersSent) {
        response.status(502).json({
          error: { code: 'STREAM_PROXY_FAILED', message: 'Erreur de streaming', status: 502 },
        })
        return true // réponse d'erreur envoyée
      }
      if (!response.response.writableEnded) {
        response.response.end()
      }
      return true // stream déjà commencé
    }
  }
}
