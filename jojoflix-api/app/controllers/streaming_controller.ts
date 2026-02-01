import type { HttpContext } from '@adonisjs/core/http'
import TorrentScoringService, { type TorrentSource } from '#services/torrent_scoring_service'
import RealDebridService from '#services/real_debrid_service'
import StreamRegistry from '#services/stream_registry'
import User from '#models/user'
import crypto from 'node:crypto'
import got from 'got'
import { pipeline } from 'node:stream/promises'
import { Secret } from '@adonisjs/core/helpers'

export default class StreamingController {
  private readonly scoring: TorrentScoringService
  private readonly rd: RealDebridService
  private readonly registry: StreamRegistry

  constructor() {
    this.scoring = new TorrentScoringService()
    this.rd = new RealDebridService()
    this.registry = new StreamRegistry()
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

    const allSources = await this.getSourceFallbackCandidates(
      tmdbId,
      mediaType,
      preferredSource,
      season,
      episode
    )
    if (allSources.length === 0) {
      return response.status(404).json({
        error: { code: 'NO_SOURCE_FOUND', message: 'Aucune source disponible', status: 404 },
      })
    }

    const deadline = Date.now() + 9_000
    const maxSourcesToTry = 6
    let hadSourceAvailabilityFailure = false

    for (const source of allSources.slice(0, maxSourcesToTry)) {
      const remainingMs = deadline - Date.now()
      if (remainingMs <= 0) break

      try {
        const directUrl = await this.resolveDirectUrl(source)
        const probeTimeoutMs = Math.min(3_000, Math.max(1_000, remainingMs))
        const playable = await this.probeDirectUrl(directUrl, probeTimeoutMs)
        if (!playable) {
          hadSourceAvailabilityFailure = true
          continue
        }

        if (source.key !== preferredSource.key) {
          console.info(
            `[stream:fallback] switched-source tmdb=${tmdbId} type=${mediaType} from=${preferredSource.key} to=${source.key}`
          )
        }
        return this.proxyStream(
          userId,
          directUrl,
          request,
          response,
          preferredSource.key,
          source.key
        )
      } catch (error) {
        if (this.isSourceAvailabilityError(error)) {
          hadSourceAvailabilityFailure = true
          continue
        }
        throw error
      }
    }

    if (hadSourceAvailabilityFailure) {
      return response.status(502).json({
        error: {
          code: 'NO_PLAYABLE_SOURCE',
          message: 'Aucune source lisible pour le moment. Change de source ou réessaie.',
          status: 502,
        },
      })
    }

    return response.status(404).json({
      error: { code: 'NO_SOURCE_FOUND', message: 'Aucune source disponible', status: 404 },
    })
  }

  private async getSourceFallbackCandidates(
    tmdbId: string,
    mediaType: 'movie' | 'tv',
    preferredSource: TorrentSource,
    season?: number,
    episode?: number
  ): Promise<TorrentSource[]> {
    let fromScoring: TorrentSource[] = []
    try {
      fromScoring = await this.scoring.getScoredSources(tmdbId, mediaType, season, episode, {
        includeSlowProviders: true,
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

    return ordered
  }

  private async resolveDirectUrl(source: TorrentSource): Promise<string> {
    if (source.direct_url) return source.direct_url

    if (!source.magnet) {
      throw new Error('NO_SOURCE_FOUND')
    }

    return this.rd.unrestrictLink(source.magnet, {
      fileIdx: source.file_idx ?? null,
    })
  }

  private async probeDirectUrl(directUrl: string, timeoutMs: number): Promise<boolean> {
    const probe = got.stream(directUrl, {
      throwHttpErrors: false,
      decompress: false,
      retry: { limit: 0 },
      timeout: { connect: timeoutMs, request: timeoutMs },
      headers: { Range: 'bytes=0-1024' },
    })

    try {
      const statusCode = await new Promise<number>((resolve, reject) => {
        probe.once('response', (upstreamResponse) => {
          resolve(upstreamResponse.statusCode ?? 500)
          if (!probe.destroyed) probe.destroy()
        })
        probe.once('error', reject)
      })
      if ((statusCode >= 200 && statusCode < 400) || statusCode === 416) {
        return true
      }
      return false
    } catch {
      return false
    } finally {
      if (!probe.destroyed) probe.destroy()
    }
  }

  private isSourceAvailabilityError(error: unknown): boolean {
    if (!(error instanceof Error)) return false
    const message = error.message.toUpperCase()
    return (
      message.includes('RD_ERROR') ||
      message.includes('TIMEOUT') ||
      message.includes('ECONNRESET') ||
      message.includes('EAI_AGAIN')
    )
  }

  private async proxyStream(
    userId: number,
    directUrl: string,
    request: HttpContext['request'],
    response: HttpContext['response'],
    requestedSourceKey: string,
    selectedSourceKey: string
  ) {
    // 1. Invalider l'ancien flux et enregistrer le nouveau
    const streamId = crypto.randomUUID()
    await this.registry.register(userId, streamId)

    // 2. Vérifier que ce flux est toujours actif (pas invalidé entre-temps)
    const activeStreamId = await this.registry.getActive(userId)
    if (activeStreamId !== streamId) {
      return response.status(499).json({
        error: {
          code: 'STREAM_INVALIDATED',
          message: 'Le flux a été interrompu suite à une déconnexion',
          status: 499,
        },
      })
    }

    // 3. Stocker l'URL directe pour le transcoding (sélection piste audio)
    await this.registry.register(userId, streamId, directUrl)

    // 4. Stream proxy (Range + backpressure) : on ne renvoie jamais l'URL RD au client.
    const rangeHeader = request.header('range')
    const upstream = got.stream(directUrl, {
      throwHttpErrors: false,
      decompress: false,
      retry: { limit: 0 },
      timeout: { connect: 10_000 },
      headers: rangeHeader ? { Range: rangeHeader } : undefined,
    })

    response.response.once('close', () => {
      if (!upstream.destroyed) upstream.destroy()
    })

    try {
      await new Promise<void>((resolve, reject) => {
        upstream.once('response', (upstreamResponse) => {
          const statusCode = upstreamResponse.statusCode ?? 500
          if (statusCode >= 400) {
            if (!response.response.headersSent) {
              response.status(502).json({
                error: { code: 'UPSTREAM_ERROR', message: 'Flux indisponible', status: 502 },
              })
            }
            upstream.destroy()
            resolve()
            return
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

          pipeline(upstream, response.response).then(resolve).catch(reject)
        })

        upstream.once('error', reject)
      })
    } catch (error) {
      if (!response.response.headersSent) {
        return response.status(502).json({
          error: { code: 'STREAM_PROXY_FAILED', message: 'Erreur de streaming', status: 502 },
        })
      }
      if (!response.response.writableEnded) {
        response.response.end()
      }
      return
    }
  }
}
