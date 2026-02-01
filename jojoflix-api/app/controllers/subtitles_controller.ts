import type { HttpContext } from '@adonisjs/core/http'
import SubtitlesService, { type SubtitleEntry } from '#services/subtitles_service'
import TmdbService from '#services/tmdb_service'
import MediaMarker from '#models/media_marker'
import CacheWrapper, { CACHE_TTL } from '#services/cache_wrapper'
import User from '#models/user'
import got from 'got'
import { Secret } from '@adonisjs/core/helpers'
import logger from '@adonisjs/core/services/logger'

export default class SubtitlesController {
  /**
   * Liste les sous-titres disponibles — sans téléchargement, sans quota consommé.
   * Appelé à l'ouverture du sélecteur dans le player.
   */
  async list({ auth, params, request, response }: HttpContext) {
    auth.getUserOrFail()
    const { tmdb_id } = params
    const season = request.qs().season ? Number(request.qs().season) : undefined
    const episode = request.qs().episode ? Number(request.qs().episode) : undefined
    const tmdb = new TmdbService()

    // Résoudre le IMDB ID depuis TMDB (movie ou série)
    let imdbId: string | null = null
    try {
      const mediaType = season != null ? 'tv' : 'movie'
      imdbId = await tmdb.getImdbId(Number(tmdb_id), mediaType)
    } catch {
      return response.ok({ data: [] })
    }

    if (!imdbId) return response.ok({ data: [] })

    const service = new SubtitlesService()
    try {
      const lookupCandidates = await this.buildSubtitleLookupCandidates(
        tmdb,
        Number(tmdb_id),
        season,
        episode
      )

      let entries: SubtitleEntry[] = []
      let selectedCandidateLabel = 'requested'
      for (const candidate of lookupCandidates) {
        entries = await service.listSubtitles(imdbId, candidate.season, candidate.episode)
        if (entries.length > 0) {
          selectedCandidateLabel = candidate.label
          break
        }
      }

      if (selectedCandidateLabel !== 'requested' && season != null && episode != null) {
        logger.info(
          {
            tmdbId: tmdb_id,
            imdbId,
            season,
            episode,
            selectedCandidateLabel,
            resultCount: entries.length,
          },
          'Subtitles list used fallback numbering'
        )
      }

      return response.ok({ data: entries })
    } catch (error) {
      const upstreamStatus = this.extractUpstreamStatus(error)
      logger.warn(
        {
          tmdbId: tmdb_id,
          imdbId,
          season,
          episode,
          upstreamStatus,
          err: error instanceof Error ? error.message : String(error),
        },
        'Subtitles list failed'
      )
      return response.ok({ data: [] })
    }
  }

  /**
   * Télécharge un sous-titre spécifique par file_id — consomme 1 quota.
   * Appelé uniquement quand l'utilisateur sélectionne un sous-titre explicitement.
   */
  async download({ auth, request, response }: HttpContext) {
    auth.getUserOrFail()
    const fileId = Number(request.input('file_id'))
    const language = request.input('language', 'fr')

    if (!fileId) {
      return response.badRequest({
        error: { code: 'MISSING_FILE_ID', message: 'file_id requis', status: 400 },
      })
    }

    const service = new SubtitlesService()
    try {
      const result = await service.downloadSubtitle(fileId, language)
      const normalizedLang = String(result.language || 'und')
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '')
      const proxyId = `${fileId}_${normalizedLang || 'und'}`

      // Stocker l'URL réelle en cache (jamais exposée au client Flutter)
      const cache = new CacheWrapper()
      await cache.set(`vtt:url:${proxyId}`, result.url, CACHE_TTL.SUBTITLES)
      const normalizedVtt = await this.fetchNormalizedVtt(result.url)
      await cache.set(`vtt:raw:${proxyId}`, normalizedVtt, CACHE_TTL.SUBTITLES)
      const token = this.extractAccessTokenFromRequest(request)
      const proxyUrl = token
        ? `/api/subtitles/vtt/${proxyId}?token=${encodeURIComponent(token)}`
        : `/api/subtitles/vtt/${proxyId}`

      return response.ok({
        data: {
          proxy_url: proxyUrl,
          language: result.language,
        },
      })
    } catch (error) {
      const upstreamStatus = this.extractUpstreamStatus(error)
      const isRateLimit = upstreamStatus === 429
      logger.warn(
        {
          fileId,
          language,
          upstreamStatus,
          err: error instanceof Error ? error.message : String(error),
        },
        'Subtitles download failed'
      )
      return response.status(isRateLimit ? 429 : 422).send({
        error: {
          code: isRateLimit ? 'SUBTITLE_RATE_LIMIT' : 'SUBTITLE_DOWNLOAD_FAILED',
          message: isRateLimit
            ? 'Subtitles Pro a temporairement limité les requêtes'
            : 'Impossible de télécharger ce sous-titre',
          status: isRateLimit ? 429 : 422,
        },
      })
    }
  }

  /**
   * Proxy VTT — sert le fichier directement au player.
   * L'URL réelle Subtitles n'est jamais retournée au client.
   */
  async serveVtt({ auth, request, params, response }: HttpContext) {
    // Supporte Bearer ou ?token= pour le fetch direct du player (media_kit).
    if (!(await this.resolveUserId(auth, request))) {
      return response.unauthorized({
        error: { code: 'AUTH_INVALID', message: 'Non authentifié', status: 401 },
      })
    }

    const cache = new CacheWrapper()
    const cacheKey = `vtt:raw:${params.id}`

    const cached = await cache.get<string>(cacheKey)
    if (cached) {
      response.header('Access-Control-Allow-Origin', '*')
      response.header('Content-Type', 'text/vtt')
      return response.ok(cached)
    }

    const subtitleUrl = await cache.get<string>(`vtt:url:${params.id}`)
    if (!subtitleUrl) {
      return response.notFound({ error: { code: 'NOT_FOUND', status: 404 } })
    }

    let vttContent: string
    try {
      vttContent = await this.fetchNormalizedVtt(subtitleUrl)
    } catch (error) {
      const upstreamStatus = this.extractUpstreamStatus(error)
      const isRateLimit = upstreamStatus === 429
      logger.warn(
        {
          subtitleId: params.id,
          subtitleUrl,
          upstreamStatus,
          err: error instanceof Error ? error.message : String(error),
        },
        'Subtitles vtt fetch failed'
      )
      return response.status(isRateLimit ? 429 : 502).send({
        error: {
          code: isRateLimit ? 'SUBTITLE_RATE_LIMIT' : 'SUBTITLE_FETCH_FAILED',
          message: isRateLimit
            ? 'Subtitles Pro a temporairement limité les requêtes'
            : 'Impossible de récupérer le sous-titre',
          status: isRateLimit ? 429 : 502,
        },
      })
    }

    await cache.set(cacheKey, vttContent, CACHE_TTL.SUBTITLES)

    response.header('Access-Control-Allow-Origin', '*')
    response.header('Content-Type', 'text/vtt')
    return response.ok(vttContent)
  }

  async markers({ auth, params, response }: HttpContext) {
    auth.getUserOrFail()
    const { tmdb_id } = params

    const cache = new CacheWrapper()
    const cacheKey = `markers:${tmdb_id}`

    const markers = await cache.remember(cacheKey, CACHE_TTL.MARKERS, async () => {
      const dbMarkers = await MediaMarker.query().where('tmdb_id', tmdb_id)
      return dbMarkers.map((m) => ({
        type: m.markerType,
        start_time: m.startTime,
        end_time: m.endTime,
      }))
    })

    return response.ok({ data: markers })
  }

  async storeMarker({ auth, request, response }: HttpContext) {
    auth.getUserOrFail()
    const { tmdb_id, marker_type, start_time, end_time } = request.body()
    const marker = await MediaMarker.create({
      tmdbId: tmdb_id,
      markerType: marker_type,
      startTime: start_time,
      endTime: end_time,
    })

    const cache = new CacheWrapper()
    await cache.forget(`markers:${tmdb_id}`)

    return response.created({ data: marker })
  }

  private extractAccessTokenFromRequest(request: HttpContext['request']): string | null {
    const authHeader = request.header('authorization') ?? request.header('Authorization')
    if (authHeader) {
      const match = authHeader.match(/^Bearer\s+(.+)$/i)
      if (match && match[1]) return match[1].trim()
    }

    const queryToken = request.input('token') as string | undefined
    return queryToken && queryToken.trim().length > 0 ? queryToken.trim() : null
  }

  private async resolveUserId(
    auth: HttpContext['auth'],
    request: HttpContext['request']
  ): Promise<number | null> {
    try {
      const user = auth.getUserOrFail()
      return user.id
    } catch {
      // fallback token query/bearer
    }

    const token = this.extractAccessTokenFromRequest(request)
    if (!token) return null

    const accessToken = await User.accessTokens.verify(new Secret(token))
    if (!accessToken || accessToken.isExpired()) return null
    return Number(accessToken.tokenableId)
  }

  private async buildSubtitleLookupCandidates(
    tmdb: TmdbService,
    tmdbId: number,
    season?: number,
    episode?: number
  ): Promise<Array<{ season?: number; episode?: number; label: string }>> {
    const candidates: Array<{ season?: number; episode?: number; label: string }> = []
    const seen = new Set<string>()

    const push = (candidateSeason: number | undefined, candidateEpisode: number | undefined, label: string) => {
      const normalizedSeason =
        candidateSeason != null && Number.isFinite(candidateSeason) ? Math.floor(candidateSeason) : undefined
      const normalizedEpisode =
        candidateEpisode != null && Number.isFinite(candidateEpisode) ? Math.floor(candidateEpisode) : undefined

      if (
        normalizedSeason != null &&
        normalizedEpisode != null &&
        (normalizedSeason <= 0 || normalizedEpisode <= 0)
      ) {
        return
      }

      const key = `${normalizedSeason ?? '-'}:${normalizedEpisode ?? '-'}`
      if (seen.has(key)) return
      seen.add(key)
      candidates.push({ season: normalizedSeason, episode: normalizedEpisode, label })
    }

    push(season, episode, 'requested')

    if (season == null || episode == null) {
      return candidates
    }

    const remapped = await tmdb.remapCollapsedSeasonOneEpisode(tmdbId, season, episode)
    if (remapped) {
      push(remapped.season, remapped.episode, 'remapped')
    }

    if (season > 1) {
      const absoluteEpisode = await tmdb.toAbsoluteEpisode(tmdbId, season, episode)
      if (absoluteEpisode && absoluteEpisode > 0) {
        push(1, absoluteEpisode, 'absolute')
      }

      // Cas anime TMDB en "S1 absolue" mais UI en vraies saisons.
      const collapsedEpisode = await tmdb.toCollapsedSeasonOneEpisode(tmdbId, season, episode)
      if (collapsedEpisode && collapsedEpisode > 0) {
        push(1, collapsedEpisode, 'collapsed')
      }
    }

    return candidates
  }

  private async fetchNormalizedVtt(subtitleUrl: string): Promise<string> {
    const rawBuffer = await got
      .get(subtitleUrl, {
        timeout: { request: 15000 },
        retry: { limit: 1 },
      })
      .buffer()

    let text: string
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(rawBuffer)
    } catch {
      text = new TextDecoder('latin1').decode(rawBuffer)
    }

    text = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')

    const trimmed = text.trimStart()
    if (!trimmed.startsWith('WEBVTT')) {
      return this.srtToVtt(trimmed)
    }

    // VTT : dédoublonnage entête (ancien addon OpenSubtitles)
    const headerMatches = [...text.matchAll(/(^|\n)WEBVTT\b/gi)]
    if (headerMatches.length > 1) {
      const secondHeaderIndex = headerMatches[1].index ?? -1
      const prelude = text.slice(0, secondHeaderIndex)
      if (/Subtitles v3\+/i.test(prelude) || /=>/i.test(prelude)) {
        text = text.slice(secondHeaderIndex)
      }
    }

    return this.decodeHtmlEntities(text.trimStart())
  }

  private srtToVtt(srt: string): string {
    const lines = srt.split('\n')
    const output: string[] = ['WEBVTT', '']

    let i = 0
    while (i < lines.length) {
      const line = lines[i].trim()

      // Sauter les numéros de séquence SRT (ligne composée uniquement de chiffres)
      if (/^\d+$/.test(line)) {
        i++
        continue
      }

      // Ligne de timing SRT → VTT (virgule → point)
      if (/\d{2}:\d{2}:\d{2},\d{3}\s*-->\s*\d{2}:\d{2}:\d{2},\d{3}/.test(line)) {
        output.push(line.replace(/,(\d{3})/g, '.$1'))
        i++
        // Collecter les lignes de texte qui suivent
        while (i < lines.length && lines[i].trim() !== '') {
          output.push(this.decodeHtmlEntities(lines[i]))
          i++
        }
        output.push('')
        continue
      }

      i++
    }

    return output.join('\n')
  }

  private decodeHtmlEntities(text: string): string {
    return text
      .replaceAll('&gt;', '>')
      .replaceAll('&lt;', '<')
      .replaceAll('&amp;', '&')
      .replaceAll('&quot;', '"')
      .replaceAll('&#39;', "'")
      .replaceAll(/&#(\d+);/g, (_: string, dec: string) => {
        const code = Number(dec)
        return Number.isFinite(code) ? String.fromCharCode(code) : `&#${dec};`
      })
      .replaceAll(/&#x([0-9a-fA-F]+);/g, (_: string, hex: string) => {
        const code = Number.parseInt(hex, 16)
        return Number.isFinite(code) ? String.fromCharCode(code) : `&#x${hex};`
      })
  }

  private extractUpstreamStatus(error: unknown): number | null {
    if (
      error &&
      typeof error === 'object' &&
      'response' in error &&
      (error as { response?: { statusCode?: number } }).response?.statusCode
    ) {
      return Number((error as { response?: { statusCode?: number } }).response?.statusCode)
    }
    return null
  }
}
