import type { HttpContext } from '@adonisjs/core/http'
import SubtitlesService, { type SubtitleEntry } from '#services/subtitles_service'
import SubdlService from '#services/subdl_service'
import SubsourceService from '#services/subsource_service'
import TmdbService from '#services/tmdb_service'
import CacheWrapper, { CACHE_TTL } from '#services/cache_wrapper'
import ConvexRepository from '#services/convex_repository'
import StreamRegistry from '#services/stream_registry'
import {
  extractSubtitleTrackAsVtt,
  isTextSubtitleCodec,
  probeMediaInfo,
  type SubtitleTrackInfoPayload,
} from '#services/media_probe_service'
import { auth as betterAuth } from '#services/better_auth'
import got from 'got'
import logger from '@adonisjs/core/services/logger'
import env from '#start/env'
import crypto from 'node:crypto'

export default class SubtitlesController {
  private readonly registry = new StreamRegistry()

  /**
   * Liste les sous-titres disponibles — sans téléchargement, sans quota consommé.
   * Appelé à l'ouverture du sélecteur dans le player.
   */
  async list(ctx: HttpContext) {
    const { params, request, response } = ctx
    const tmdbId = params.tmdb_id as string
    const season = request.qs().season ? Number(request.qs().season) : undefined
    const episode = request.qs().episode ? Number(request.qs().episode) : undefined
    const tmdb = new TmdbService()

    // Résoudre le IMDB ID depuis TMDB (movie ou série)
    let imdbId: string | null = null
    try {
      const mediaType = season !== undefined ? 'tv' : 'movie'
      imdbId = await tmdb.getImdbId(Number(tmdbId), mediaType)
    } catch {
      return response.ok({ data: [] })
    }

    if (!imdbId) return response.ok({ data: [] })

    const service = new SubtitlesService()
    try {
      const lookupCandidates = await this.buildSubtitleLookupCandidates(
        tmdb,
        Number(tmdbId),
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

      if (selectedCandidateLabel !== 'requested' && season !== undefined && episode !== undefined) {
        logger.info(
          {
            tmdbId,
            imdbId,
            season,
            episode,
            selectedCandidateLabel,
            resultCount: entries.length,
          },
          'Subtitles list used fallback numbering'
        )
      }

      const hasFrench = () =>
        entries.some((e) => ['fr', 'french'].includes(e.language.toLowerCase()))

      // ── SubDL fallback — si pas de sous-titre français ────────────────────
      if (!hasFrench()) {
        const subdlKey = env.get('SUBDL_API_KEY')
        if (subdlKey) {
          try {
            const subdl = new SubdlService(subdlKey)
            const subdlEntries = await subdl.listSubtitles(imdbId, season, episode)
            // When a specific episode is requested, drop entries tagged for a
            // different episode — SubDL can return adjacent episodes in its response.
            const relevantSubdl =
              episode !== undefined
                ? subdlEntries.filter(
                    (e) => e.episode === null || e.episode === undefined || e.episode === episode
                  )
                : subdlEntries
            const mapped = relevantSubdl.map((e) => ({
              file_id: `subdl:${e.file_id}`,
              language: e.language,
              release_name: e.release_name,
              hearing_impaired: false,
            }))
            entries = [...entries, ...mapped]
            if (mapped.length > 0) {
              logger.info({ tmdbId, count: mapped.length }, 'Subtitles from SubDL')
            }
          } catch (err) {
            logger.warn(
              { err: err instanceof Error ? err.message : String(err) },
              'SubDL list failed'
            )
          }
        }
      }

      // ── SubSource fallback — si toujours pas de sous-titre français ───────
      if (!hasFrench()) {
        const flareSolverrUrl = this.resolveFlareSolverrUrl()
        try {
          const mediaType = season !== undefined ? 'tv' : 'movie'
          let title: string | undefined
          let year: number | undefined
          if (mediaType === 'movie') {
            const movie = await tmdb.getMovie(Number(tmdbId))
            title = movie.title
            year = movie.release_date ? new Date(movie.release_date).getFullYear() : undefined
          } else {
            const show = await tmdb.getTvShow(Number(tmdbId))
            title = show.name
            year = show.first_air_date ? new Date(show.first_air_date).getFullYear() : undefined
          }

          if (title && year) {
            const subsource = new SubsourceService(
              env.get('SUBSOURCE_API_KEY') ?? '',
              flareSolverrUrl
            )
            const ssEntries = await subsource.listSubtitles(title, imdbId, season, episode, year)
            const mapped = ssEntries.map((e) => ({
              file_id: e.file_id,
              language: e.language,
              release_name: e.release_name,
              hearing_impaired: false,
            }))
            entries = [...entries, ...mapped]
            if (mapped.length > 0) {
              logger.info({ tmdbId, count: mapped.length }, 'Subtitles from SubSource')
            }
          }
        } catch (err) {
          logger.warn(
            { err: err instanceof Error ? err.message : String(err) },
            'SubSource list failed'
          )
        }
      }

      const embeddedEntries = await this.listEmbeddedSubtitles(ctx)
      return response.ok({ data: this.mergeSubtitleEntries(embeddedEntries, entries) })
    } catch (error) {
      const upstreamStatus = this.extractUpstreamStatus(error)
      logger.warn(
        {
          tmdbId,
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
  async download(ctx: HttpContext) {
    const { request, response } = ctx
    const fileId = String(request.input('file_id') ?? '').trim()
    const language = request.input('language', 'fr')

    if (!fileId) {
      return response.badRequest({
        error: { code: 'MISSING_FILE_ID', message: 'file_id requis', status: 400 },
      })
    }

    try {
      const cache = new CacheWrapper()
      const normalizedLang = String(language || 'und')
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '')
      const proxyId = crypto.createHash('md5').update(`${fileId}:${normalizedLang}`).digest('hex')

      let vttContent: string

      if (fileId.startsWith('embedded:')) {
        // Check cache first — extraction from a remote 4K file takes ~60s, avoid re-extracting
        const cachedVtt = await cache.get<string>(`vtt:raw:${proxyId}`)
        if (cachedVtt) {
          const token = this.extractAccessTokenFromRequest(request)
          const proxyUrl = token
            ? `/api/subtitles/vtt/${proxyId}?token=${encodeURIComponent(token)}`
            : `/api/subtitles/vtt/${proxyId}`
          return response.ok({ data: { proxy_url: proxyUrl, language } })
        }
        const embeddedVtt = await this.downloadEmbeddedSubtitle(ctx, fileId)
        if (!embeddedVtt) throw new Error('Embedded subtitle unavailable')
        vttContent = embeddedVtt
      } else if (fileId.startsWith('subsource:html:')) {
        // ── SubSource download ──────────────────────────────────────────────
        const detailPath = fileId.slice('subsource:html:'.length)
        const flareSolverrUrl = this.resolveFlareSolverrUrl()
        const subsource = new SubsourceService(env.get('SUBSOURCE_API_KEY') ?? '', flareSolverrUrl)
        const downloadUrl = await subsource.getDownloadUrl(detailPath)
        const srtContent = await subsource.downloadFile(downloadUrl, detailPath)
        vttContent = this.srtToVtt(srtContent.replace(/^\uFEFF/, ''))
      } else if (fileId.startsWith('subdl:')) {
        // ── SubDL download ──────────────────────────────────────────────────
        const subdlPath = fileId.slice('subdl:'.length)
        const subdlKey = env.get('SUBDL_API_KEY') ?? ''
        const subdl = new SubdlService(subdlKey)
        const zipUrl = await subdl.getDownloadUrl(subdlPath)
        const zipBuffer = await got
          .get(zipUrl, { timeout: { request: 30_000 }, retry: { limit: 0 } })
          .buffer()
        const { inflateRawSync } = await import('node:zlib')
        // basic zip extraction — find first .srt
        const srtContent = this.extractFromZipBuffer(zipBuffer, inflateRawSync)
        vttContent = this.srtToVtt(srtContent.replace(/^\uFEFF/, ''))
      } else {
        // ── OpenSubtitles download ──────────────────────────────────────────
        const service = new SubtitlesService()
        const result = await service.downloadSubtitle(fileId, language)
        await cache.set(`vtt:url:${proxyId}`, result.url, CACHE_TTL.SUBTITLES)
        vttContent = await this.fetchNormalizedVtt(result.url)
      }

      await cache.set(`vtt:raw:${proxyId}`, vttContent, CACHE_TTL.SUBTITLES)
      const token = this.extractAccessTokenFromRequest(request)
      const proxyUrl = token
        ? `/api/subtitles/vtt/${proxyId}?token=${encodeURIComponent(token)}`
        : `/api/subtitles/vtt/${proxyId}`

      return response.ok({ data: { proxy_url: proxyUrl, language } })
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

  private async listEmbeddedSubtitles(ctx: HttpContext): Promise<SubtitleEntry[]> {
    const directUrl = await this.resolveActiveDirectUrl(ctx)
    if (!directUrl) return []

    try {
      const fingerprint = this.streamFingerprint(directUrl)
      const cache = new CacheWrapper()
      const probeCacheKey = `probe:tracks:${fingerprint}`

      let subtitleTracks: SubtitleTrackInfoPayload[] | null = await cache.get<SubtitleTrackInfoPayload[]>(probeCacheKey)
      if (!subtitleTracks) {
        const info = await probeMediaInfo(directUrl)
        subtitleTracks = info.subtitle_tracks
        await cache.set(probeCacheKey, subtitleTracks, CACHE_TTL.SUBTITLES)
      }

      const embedded = subtitleTracks
        .filter((track) => isTextSubtitleCodec(track.codec))
        .map((track) => ({
          file_id: `embedded:${fingerprint}:${track.index}`,
          language: this.normalizeEmbeddedLanguage(track),
          release_name: this.embeddedSubtitleReleaseName(track),
          hearing_impaired: this.isHearingImpairedTrack(track),
        }))

      if (embedded.length > 0) {
        logger.info(
          { count: embedded.length, totalTracks: subtitleTracks.length },
          'Subtitles from embedded active stream'
        )
      } else if (subtitleTracks.length > 0) {
        logger.warn(
          {
            totalTracks: subtitleTracks.length,
            codecs: subtitleTracks.map((track) => track.codec),
          },
          'Embedded subtitle tracks are not text-extractable'
        )
      }

      return embedded
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'Embedded subtitle probe failed'
      )
      return []
    }
  }

  private async downloadEmbeddedSubtitle(ctx: HttpContext, fileId: string): Promise<string | null> {
    const parsed = this.parseEmbeddedSubtitleFileId(fileId)
    if (!parsed) return null

    const directUrl = await this.resolveActiveDirectUrl(ctx)
    if (!directUrl || this.streamFingerprint(directUrl) !== parsed.fingerprint) {
      throw new Error('Embedded subtitle stream changed')
    }

    return extractSubtitleTrackAsVtt(directUrl, parsed.trackIndex)
  }

  private parseEmbeddedSubtitleFileId(
    fileId: string
  ): { fingerprint: string; trackIndex: number } | null {
    const match = fileId.match(/^embedded:([a-f0-9]{16}):(\d+)$/i)
    if (!match) return null

    const trackIndex = Number(match[2])
    if (!Number.isInteger(trackIndex) || trackIndex < 0) return null
    return { fingerprint: match[1].toLowerCase(), trackIndex }
  }

  private async resolveActiveDirectUrl(ctx: HttpContext): Promise<string | null> {
    const userId = await this.resolveUserId(ctx)
    if (!userId) return null
    return this.registry.getActiveUrl(userId)
  }

  private streamFingerprint(url: string): string {
    return crypto.createHash('sha256').update(url).digest('hex').slice(0, 16)
  }

  private mergeSubtitleEntries(
    embeddedEntries: SubtitleEntry[],
    externalEntries: SubtitleEntry[]
  ): SubtitleEntry[] {
    const merged: SubtitleEntry[] = []
    const seen = new Set<string>()

    for (const entry of [...embeddedEntries, ...externalEntries]) {
      if (seen.has(entry.file_id)) continue
      seen.add(entry.file_id)
      merged.push(entry)
    }

    return merged
  }

  private normalizeEmbeddedLanguage(track: SubtitleTrackInfoPayload): string {
    const raw = `${track.language ?? ''} ${track.title ?? ''}`.trim().toLowerCase()
    if (/\b(fr|fra|fre|french|français|francais|vostfr|truefrench|vff|vfq)\b/.test(raw)) {
      return 'fr'
    }
    if (/\b(en|eng|english|anglais)\b/.test(raw)) return 'en'
    if (/\b(es|spa|spanish|espagnol)\b/.test(raw)) return 'es'
    if (/\b(de|deu|ger|german|allemand)\b/.test(raw)) return 'de'
    if (/\b(it|ita|italian|italien)\b/.test(raw)) return 'it'
    if (/\b(pt|por|portuguese|portugais)\b/.test(raw)) return 'pt'
    if (/\b(ja|jpn|japanese|japonais)\b/.test(raw)) return 'ja'
    if (/\b(ko|kor|korean|coréen|coreen)\b/.test(raw)) return 'ko'
    if (/\b(zh|zho|chi|chinese|chinois)\b/.test(raw)) return 'zh'

    const normalized = String(track.language ?? '')
      .trim()
      .toLowerCase()
    return normalized || 'und'
  }

  private embeddedSubtitleReleaseName(track: SubtitleTrackInfoPayload): string {
    const parts = [
      'Piste intégrée',
      track.title?.trim(),
      track.codec.trim().toUpperCase(),
      track.default ? 'Défaut' : null,
      track.forced ? 'Forcé' : null,
    ].filter((value): value is string => Boolean(value && value.trim()))

    return parts.join(' • ')
  }

  private isHearingImpairedTrack(track: SubtitleTrackInfoPayload): boolean {
    const text = `${track.title ?? ''} ${track.language ?? ''}`.toLowerCase()
    return /\b(sdh|cc|hi|hearing|malentendant|sme)\b/.test(text)
  }

  private extractFromZipBuffer(buf: Buffer, inflateRawSync: (b: Buffer) => Buffer): string {
    let offset = 0
    while (offset < buf.length - 30) {
      if (buf.readUInt32LE(offset) !== 0x04034b50) {
        offset++
        continue
      }
      const compression = buf.readUInt16LE(offset + 8)
      const compressedSize = buf.readUInt32LE(offset + 18)
      const fnLen = buf.readUInt16LE(offset + 26)
      const extraLen = buf.readUInt16LE(offset + 28)
      const fileName = buf
        .slice(offset + 30, offset + 30 + fnLen)
        .toString('utf-8')
        .toLowerCase()
      const dataOffset = offset + 30 + fnLen + extraLen
      if (fileName.endsWith('.srt') || fileName.endsWith('.vtt')) {
        const slice = buf.slice(dataOffset, dataOffset + compressedSize)
        return compression === 8 ? inflateRawSync(slice).toString('utf-8') : slice.toString('utf-8')
      }
      offset = dataOffset + compressedSize
    }
    throw new Error('No SRT/VTT file found in zip')
  }

  /**
   * Proxy VTT — sert le fichier directement au player.
   * L'URL réelle Subtitles n'est jamais retournée au client.
   */
  async serveVtt(ctx: HttpContext) {
    const { params, response } = ctx
    // Supporte Bearer ou ?token= pour le fetch direct du player (media_kit).
    if (!(await this.resolveUserId(ctx))) {
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

  async markers({ params, response }: HttpContext) {
    const tmdbId = params.tmdb_id as string

    const cache = new CacheWrapper()
    const cacheKey = `markers:${tmdbId}`

    const markers = await cache.remember(cacheKey, CACHE_TTL.MARKERS, async () => {
      const repo = new ConvexRepository()
      const dbMarkers = await repo.getMarkersByTmdb(tmdbId)
      return dbMarkers.map((m) => ({
        type: m.markerType,
        start_time: m.startTime,
        end_time: m.endTime,
      }))
    })

    return response.ok({ data: markers })
  }

  async storeMarker({ request, response }: HttpContext) {
    const body = request.body()
    const tmdbId = body.tmdb_id
    const markerType = body.marker_type
    const startTime = body.start_time
    const endTime = body.end_time
    const repo = new ConvexRepository()
    const marker = await repo.createMediaMarker({
      tmdbId,
      markerType,
      startTime,
      endTime,
    })

    const cache = new CacheWrapper()
    await cache.forget(`markers:${tmdbId}`)

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

  private async resolveUserId(ctx: HttpContext): Promise<string | null> {
    if (ctx.betterAuthUser) return ctx.betterAuthUser.id

    const token = this.extractAccessTokenFromRequest(ctx.request)
    if (!token) return null

    const session = await betterAuth.api
      .getSession({ headers: new Headers({ authorization: `Bearer ${token}` }) })
      .catch(() => null)
    return session?.user.id ?? null
  }

  private resolveFlareSolverrUrl(): string {
    const configured = env.get('FLARESOLVERR_URL')?.trim()
    if (configured) return configured

    return env.get('NODE_ENV') === 'production'
      ? 'http://jojoflix-flaresolverr:8191'
      : 'http://127.0.0.1:8191'
  }

  private async buildSubtitleLookupCandidates(
    tmdb: TmdbService,
    tmdbId: number,
    season?: number,
    episode?: number
  ): Promise<Array<{ season?: number; episode?: number; label: string }>> {
    const candidates: Array<{ season?: number; episode?: number; label: string }> = []
    const seen = new Set<string>()

    const push = (
      candidateSeason: number | undefined,
      candidateEpisode: number | undefined,
      label: string
    ) => {
      const normalizedSeason =
        candidateSeason !== undefined && Number.isFinite(candidateSeason)
          ? Math.floor(candidateSeason)
          : undefined
      const normalizedEpisode =
        candidateEpisode !== undefined && Number.isFinite(candidateEpisode)
          ? Math.floor(candidateEpisode)
          : undefined

      if (
        normalizedSeason !== undefined &&
        normalizedEpisode !== undefined &&
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

    if (season === undefined || episode === undefined) {
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
        timeout: { request: 12000 },
        retry: { limit: 0 },
      })
      .buffer()

    let text: string
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(rawBuffer)
    } catch {
      text = new TextDecoder('latin1').decode(rawBuffer)
    }

    text = text
      .replace(/^\uFEFF/, '')
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')

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
