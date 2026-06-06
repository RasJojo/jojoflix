import type { HttpContext } from '@adonisjs/core/http'
import TorrentScoringService, { type TorrentSource } from '#services/torrent_scoring_service'
import RealDebridService from '#services/real_debrid_service'
import env from '#start/env'
import got from 'got'
import { pipeline } from 'node:stream/promises'
import { SocksProxyAgent } from 'socks-proxy-agent'

export default class DownloadController {
  private readonly scoring: TorrentScoringService
  private readonly rd: RealDebridService
  private readonly torProxyAgent?: SocksProxyAgent

  constructor() {
    this.scoring = new TorrentScoringService()
    this.rd = new RealDebridService()
    const torrentioProxy = env.get('TORRENTIO_PROXY')
    this.torProxyAgent = torrentioProxy ? new SocksProxyAgent(torrentioProxy) : undefined
  }

  // Returns direct URL metadata (for display purposes)
  async movie({ params, request, response }: HttpContext) {
    const tmdbId = params.tmdb_id as string
    const sourceKey = request.input('source_key') as string | undefined

    try {
      const source = await this.resolveSource(tmdbId, 'movie', sourceKey)
      const directUrl = await this.resolveDirectUrl(source)
      return response.ok({
        data: { direct_url: directUrl, source_key: source.key, size_gb: source.size_gb ?? null },
      })
    } catch (error) {
      if (error instanceof Error && error.message === 'NO_SOURCE_FOUND') {
        return response.status(404).json({
          error: { code: 'NO_SOURCE_FOUND', message: 'Aucune source disponible', status: 404 },
        })
      }
      throw error
    }
  }

  async tvEpisode({ params, request, response }: HttpContext) {
    const tmdbId = params.tmdb_id as string
    const season = Number(params.season)
    const episode = Number(params.episode)
    const sourceKey = request.input('source_key') as string | undefined

    try {
      const source = await this.resolveSource(tmdbId, 'tv', sourceKey, season, episode)
      const directUrl = await this.resolveDirectUrl(source, 'tv', season, episode)
      return response.ok({
        data: { direct_url: directUrl, source_key: source.key, size_gb: source.size_gb ?? null },
      })
    } catch (error) {
      if (error instanceof Error && error.message === 'NO_SOURCE_FOUND') {
        return response.status(404).json({
          error: { code: 'NO_SOURCE_FOUND', message: 'Aucune source disponible', status: 404 },
        })
      }
      throw error
    }
  }

  // Proxy-download endpoints — streams the file through the server so the
  // client never sees the RD URL (which is IP-locked to the server's IP).
  async streamMovie({ params, request, response }: HttpContext) {
    const tmdbId = params.tmdb_id as string
    const sourceKey = request.input('source_key') as string | undefined
    console.info(`[download:start] type=movie tmdb=${tmdbId} source_key=${sourceKey ?? 'auto'}`)

    try {
      const source = await this.resolveSource(tmdbId, 'movie', sourceKey)
      const directUrl = await this.resolveDirectUrl(source)
      console.info(`[download:resolved] type=movie tmdb=${tmdbId} url=${directUrl.substring(0, 80)}`)
      return this.proxyDownload(directUrl, response)
    } catch (error) {
      if (error instanceof Error && error.message === 'NO_SOURCE_FOUND') {
        return response.status(404).json({
          error: { code: 'NO_SOURCE_FOUND', message: 'Aucune source disponible', status: 404 },
        })
      }
      throw error
    }
  }

  async streamTvEpisode({ params, request, response }: HttpContext) {
    const tmdbId = params.tmdb_id as string
    const season = Number(params.season)
    const episode = Number(params.episode)
    const sourceKey = request.input('source_key') as string | undefined
    console.info(`[download:start] type=tv tmdb=${tmdbId} s=${season} e=${episode} source_key=${sourceKey ?? 'auto'}`)

    try {
      const source = await this.resolveSource(tmdbId, 'tv', sourceKey, season, episode)
      const directUrl = await this.resolveDirectUrl(source, 'tv', season, episode)
      console.info(`[download:resolved] type=tv tmdb=${tmdbId} s=${season} e=${episode} url=${directUrl.substring(0, 80)}`)
      return this.proxyDownload(directUrl, response)
    } catch (error) {
      if (error instanceof Error && error.message === 'NO_SOURCE_FOUND') {
        return response.status(404).json({
          error: { code: 'NO_SOURCE_FOUND', message: 'Aucune source disponible', status: 404 },
        })
      }
      throw error
    }
  }

  private async proxyDownload(
    directUrl: string,
    response: HttpContext['response']
  ): Promise<void> {
    const isDramayoCdn = this.isDramayoCdnUrl(directUrl)
    const agentOpts =
      isDramayoCdn && this.torProxyAgent
        ? { agent: { https: this.torProxyAgent, http: this.torProxyAgent } }
        : {}
    const headers = isDramayoCdn
      ? {
          'Referer': 'https://www.dramayo.com/',
          'Origin': 'https://www.dramayo.com',
          'User-Agent': 'Mozilla/5.0 (JOJOFLIX)',
        }
      : undefined
    const upstream = got.stream(directUrl, {
      ...agentOpts,
      throwHttpErrors: false,
      decompress: false,
      retry: { limit: 0 },
      timeout: { connect: 15_000 },
      headers,
    })

    response.response.once('close', () => {
      if (!upstream.destroyed) upstream.destroy()
    })

    await new Promise<void>((resolve, reject) => {
      upstream.once('response', (upstreamResponse) => {
        const statusCode = upstreamResponse.statusCode ?? 500

        if (statusCode >= 400) {
          upstream.destroy()
          if (!response.response.headersSent) {
            response.status(statusCode).json({
              error: { code: 'UPSTREAM_ERROR', message: 'Source unavailable', status: statusCode },
            })
          }
          resolve()
          return
        }

        response.response.statusCode = statusCode

        const headersToForward = ['content-type', 'content-length', 'accept-ranges']
        for (const name of headersToForward) {
          const value = upstreamResponse.headers[name]
          if (value !== undefined) {
            response.header(name, String(value))
          }
        }
        if (!response.response.getHeader('content-type')) {
          response.header('content-type', 'video/x-matroska')
        }
        response.header('content-disposition', 'attachment')

        pipeline(upstream, response.response).then(() => resolve()).catch(reject)
      })

      upstream.once('error', reject)
    })
  }

  private async resolveSource(
    tmdbId: string,
    mediaType: 'movie' | 'tv',
    sourceKey?: string,
    season?: number,
    episode?: number
  ): Promise<TorrentSource> {
    if (sourceKey) {
      const sources = await this.scoring.getScoredSources(tmdbId, mediaType, season, episode)
      const found = sources.find((s) => s.key === sourceKey)
      if (found) return found
    }
    const { best } = await this.scoring.scoreAndSelectSource(tmdbId, mediaType, season, episode)
    return best
  }

  private async resolveDirectUrl(
    source: TorrentSource,
    mediaType?: 'movie' | 'tv',
    season?: number,
    episode?: number
  ): Promise<string> {
    if (source.direct_url) {
      if (this.isTorrentioResolveUrl(source.direct_url)) {
        return this.followTorrentioResolveUrl(source.direct_url)
      }
      return source.direct_url
    }
    if (!source.magnet) throw new Error('NO_SOURCE_FOUND')
    return this.rd.unrestrictLink(source.magnet, {
      fileIdx: source.file_idx ?? null,
      season: mediaType === 'tv' ? (season ?? null) : null,
      episode: mediaType === 'tv' ? (episode ?? null) : null,
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

  private isDramayoCdnUrl(url: string): boolean {
    try {
      const { hostname } = new URL(url)
      return hostname.includes('cdnvideo') || hostname.includes('dramayo')
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
}
