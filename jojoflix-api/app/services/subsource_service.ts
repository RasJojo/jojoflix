import CacheWrapper, { CACHE_TTL } from '#services/cache_wrapper'
import got from 'got'

// Circuit breaker for FlareSolverr — prevents AdonisJS worker saturation when
// FlareSolverr is hanging or unavailable.
let flareFailCount = 0
let flareLastFailTime = 0
const FLARE_CIRCUIT_OPEN_THRESHOLD = 3
const FLARE_CIRCUIT_COOLDOWN_MS = 60_000

const FLARE_SESSION_ID = 'subsource_v1'
const SUBSOURCE_HOST = 'https://subsource.net'
const API_HOST = 'https://api.subsource.net'
const OFFICIAL_API_BASE = 'https://api.subsource.net/api/v1'

// TTLs in seconds
const CF_SESSION_TTL = 1800 // 30 min
const DOWNLOAD_URL_TTL = 7200 // 2h — download hash tokens expire

export interface SubsourceEntry {
  file_id: string
  language: string
  release_name: string
  subId: string
  detailPath: string // e.g. "reborn-rich-season-1-2022/french/2963495"
}

interface FlareSolverrResponse {
  status: string
  solution?: {
    status: number
    response: string
    userAgent: string
    cookies: Array<{ name: string; value: string }>
  }
}

interface CfSession {
  cookieStr: string
  userAgent: string
}

export default class SubsourceService {
  private readonly cache: CacheWrapper
  private readonly flareSolverrUrl: string
  private readonly apiKey: string

  constructor(apiKey: string, flareSolverrUrl: string) {
    this.cache = new CacheWrapper()
    this.flareSolverrUrl = flareSolverrUrl
    this.apiKey = apiKey.trim()
  }

  async listSubtitles(
    movieName: string,
    _imdbId: string,
    season?: number,
    episode?: number,
    year?: number
  ): Promise<SubsourceEntry[]> {
    if (!year) return []

    const slug = this.buildSlug(movieName, year)
    const cacheKey = `subsource:v2:list:${slug}:s${season ?? 'na'}:e${episode ?? 'na'}`

    const cached = await this.cache.get<SubsourceEntry[]>(cacheKey)
    if (cached && Array.isArray(cached) && cached.length > 0) return cached

    const apiEntries = await this.listSubtitlesViaApi(_imdbId, season, episode)
    if (apiEntries.length > 0) {
      await this.cache.set(cacheKey, apiEntries, CACHE_TTL.SUBTITLES)
      return apiEntries
    }

    await this.ensureSession()

    // Try base slug, then slug with season suffix (some shows: "reborn-rich-season-1-2022")
    const slugVariants =
      season != null ? [slug, this.buildSlug(`${movieName} Season ${season}`, year)] : [slug]

    const allEntries: SubsourceEntry[] = []
    for (const variant of slugVariants) {
      if (allEntries.length > 0) break
      for (const lang of ['french', 'english']) {
        try {
          const entries = await this.scrapeListingPage(variant, lang, season, episode)
          allEntries.push(...entries)
        } catch {
          // best-effort per language
        }
      }
    }

    if (allEntries.length > 0) {
      await this.cache.set(cacheKey, allEntries, CACHE_TTL.SUBTITLES)
    }
    return allEntries
  }

  async getDownloadUrl(detailPath: string, { forceRefresh = false } = {}): Promise<string> {
    const subId = this.extractSubId(detailPath)
    if (this.apiKey && subId) return `subsource-api:${subId}`

    const cacheKey = `subsource:v2:dl:${detailPath}`
    if (!forceRefresh) {
      const cached = await this.cache.get<string>(cacheKey)
      if (cached) return cached
    }

    await this.ensureSession()

    const url = `${SUBSOURCE_HOST}/subtitle/${detailPath}`
    const html = await this.flareFetch(url, 90_000)
    const downloadUrl = this.parseDownloadUrl(html)

    await this.cache.set(cacheKey, downloadUrl, DOWNLOAD_URL_TTL)
    return downloadUrl
  }

  /**
   * Download the zip file using cf_clearance from api.subsource.net.
   * Retries once with a fresh download URL if the zip extraction fails
   * (e.g. the URL token expired and the server returned an HTML error page).
   */
  async downloadFile(downloadUrl: string, detailPath?: string): Promise<string> {
    if (downloadUrl.startsWith('subsource-api:')) {
      const subId = downloadUrl.slice('subsource-api:'.length)
      return this.downloadFileViaApi(subId)
    }

    const session = await this.getCfSession()

    const buffer = await got
      .get(downloadUrl, {
        headers: {
          'User-Agent': session.userAgent,
          Cookie: session.cookieStr,
        },
        timeout: { request: 30_000 },
        retry: { limit: 0 },
      })
      .buffer()

    try {
      return await this.extractSrtFromZip(buffer)
    } catch (err) {
      if (!detailPath) throw err

      // URL token likely expired — invalidate cache and retry with a fresh URL
      await this.cache.forget(`subsource:v2:dl:${detailPath}`)
      const freshUrl = await this.getDownloadUrl(detailPath, { forceRefresh: true })
      const freshSession = await this.getCfSession()
      const freshBuffer = await got
        .get(freshUrl, {
          headers: {
            'User-Agent': freshSession.userAgent,
            Cookie: freshSession.cookieStr,
          },
          timeout: { request: 30_000 },
          retry: { limit: 0 },
        })
        .buffer()
      return await this.extractSrtFromZip(freshBuffer)
    }
  }

  // ─── Private: FlareSolverr session ──────────────────────────────────────────

  private async listSubtitlesViaApi(
    imdbId: string,
    season?: number,
    episode?: number
  ): Promise<SubsourceEntry[]> {
    if (!this.apiKey) return []

    const movieIds = await this.findMovieIdsViaApi(imdbId, season)
    if (movieIds.length === 0) return []

    const entries: SubsourceEntry[] = []
    const seen = new Set<string>()
    for (const movieId of movieIds) {
      for (const language of ['french', 'english']) {
        const data = await this.officialApiGet<{
          success: boolean
          data?: Array<{
            subtitleId: number
            language: string
            releaseInfo?: string[]
            link?: string
            hearingImpaired?: boolean
          }>
        }>('/subtitles', {
          movieId: String(movieId),
          language,
          limit: '100',
          sort: 'newest',
        })

        if (!data.success || !Array.isArray(data.data)) continue
        for (const item of data.data) {
          const releaseName =
            item.releaseInfo?.filter(Boolean).join(' / ').trim() || `SubSource ${item.subtitleId}`
          if (episode != null) {
            const detectedEp = this.extractEpisodeNumber(releaseName.toLowerCase())
            if (detectedEp !== null && detectedEp !== episode) continue
          }

          const detailPath =
            item.link?.replace(/^\/subtitle\//, '') ||
            `api/${this.normalizeLanguage(item.language)}/${item.subtitleId}`
          const key = `${detailPath}:${item.subtitleId}`
          if (seen.has(key)) continue
          seen.add(key)

          entries.push({
            file_id: `subsource:html:${detailPath}`,
            language: this.normalizeLanguage(item.language),
            release_name: releaseName,
            subId: String(item.subtitleId),
            detailPath,
          })
        }
      }
    }

    return entries
  }

  private async findMovieIdsViaApi(imdbId: string, season?: number): Promise<number[]> {
    const normalizedImdb = imdbId.trim()
    if (!normalizedImdb) return []

    const data = await this.officialApiGet<{
      success: boolean
      data?: Array<{ movieId: number; season?: number | null }>
    }>('/movies/search', {
      searchType: 'imdb',
      imdb: normalizedImdb,
      ...(season != null ? { season: String(season) } : {}),
    })

    if (!data.success || !Array.isArray(data.data)) return []
    return data.data
      .filter((item) => season == null || item.season == null || item.season === season)
      .map((item) => item.movieId)
      .filter((id, index, ids) => Number.isFinite(id) && ids.indexOf(id) === index)
  }

  private async downloadFileViaApi(subId: string): Promise<string> {
    const buffer = await got
      .get(`${OFFICIAL_API_BASE}/subtitles/${encodeURIComponent(subId)}/download`, {
        headers: {
          'X-API-Key': this.apiKey,
          Accept: 'application/zip,*/*',
        },
        timeout: { request: 30_000 },
        retry: { limit: 0 },
      })
      .buffer()

    return this.extractSrtFromZip(buffer)
  }

  private async officialApiGet<T>(
    path: string,
    searchParams: Record<string, string>
  ): Promise<T> {
    return got
      .get(`${OFFICIAL_API_BASE}${path}`, {
        headers: {
          'X-API-Key': this.apiKey,
          Accept: 'application/json',
        },
        searchParams,
        timeout: { request: 30_000 },
        retry: { limit: 0 },
      })
      .json<T>()
  }

  private extractSubId(detailPath: string): string | null {
    const parts = detailPath.split('/').filter(Boolean)
    const subId = parts[parts.length - 1]
    return /^\d+$/.test(subId) ? subId : null
  }

  private async ensureSession(): Promise<void> {
    // Create persistent session if not already created
    const sessionKey = 'subsource:flare_session_created'
    const exists = await this.cache.get<boolean>(sessionKey)
    if (exists) return

    try {
      await got
        .post(`${this.flareSolverrUrl}/v1`, {
          json: { cmd: 'sessions.create', session_id: FLARE_SESSION_ID },
          timeout: { request: 30_000 },
          retry: { limit: 0 },
        })
        .json()
    } catch {
      // Session might already exist — that's fine
    }

    // Warm up the session by visiting subsource.net to get cf_clearance
    await this.flareFetch(`${SUBSOURCE_HOST}`, 60_000)
    // Also warm api.subsource.net for download requests
    try {
      await this.flareFetch(API_HOST, 60_000)
    } catch {
      // best-effort
    }

    await this.cache.set(sessionKey, true, CF_SESSION_TTL)
    await this.cache.forget('subsource:cf_session:v2') // clear any stale cookies
  }

  private async getCfSession(): Promise<CfSession> {
    const cacheKey = 'subsource:cf_session:v2'
    const cached = await this.cache.get<CfSession>(cacheKey)
    if (cached) return cached

    const flarePayload = { cmd: 'request.get', url: API_HOST, session: FLARE_SESSION_ID, maxTimeout: 60_000 }
    const flareResponse = await got
      .post(`${this.flareSolverrUrl}/v1`, {
        json: flarePayload,
        timeout: { request: 70_000 },
        retry: { limit: 0 },
      })
      .json<FlareSolverrResponse>()

    if (flareResponse.status !== 'ok' || !flareResponse.solution) {
      throw new Error(`FlareSolverr challenge failed: ${flareResponse.status}`)
    }

    const cookieStr = flareResponse.solution.cookies.map((c) => `${c.name}=${c.value}`).join('; ')
    const session: CfSession = { cookieStr, userAgent: flareResponse.solution.userAgent }
    await this.cache.set(cacheKey, session, CF_SESSION_TTL)
    return session
  }

  private async flareFetch(url: string, maxTimeout = 60_000): Promise<string> {
    // Circuit breaker: if FlareSolverr has failed repeatedly within the cooldown window,
    // fail fast instead of blocking a worker thread.
    if (
      flareFailCount >= FLARE_CIRCUIT_OPEN_THRESHOLD &&
      Date.now() - flareLastFailTime < FLARE_CIRCUIT_COOLDOWN_MS
    ) {
      throw new Error('FlareSolverr circuit open — too many recent failures, skipping')
    }

    try {
      const flareResponse = await got
        .post(`${this.flareSolverrUrl}/v1`, {
          json: { cmd: 'request.get', url, session: FLARE_SESSION_ID, maxTimeout },
          timeout: { request: maxTimeout + 15_000 },
          retry: { limit: 0 },
        })
        .json<FlareSolverrResponse>()

      if (flareResponse.status !== 'ok' || !flareResponse.solution) {
        flareFailCount++
        flareLastFailTime = Date.now()
        throw new Error(`FlareSolverr fetch failed for ${url}: ${flareResponse.status}`)
      }

      flareFailCount = 0
      return flareResponse.solution.response
    } catch (err) {
      flareFailCount++
      flareLastFailTime = Date.now()
      throw err
    }
  }

  // ─── Private: HTML scraping ──────────────────────────────────────────────────

  private async scrapeListingPage(
    slug: string,
    lang: string,
    season?: number,
    episode?: number
  ): Promise<SubsourceEntry[]> {
    const url =
      season != null
        ? `${SUBSOURCE_HOST}/subtitles/${slug}/season-${season}/${lang}`
        : `${SUBSOURCE_HOST}/subtitles/${slug}/${lang}`

    const html = await this.flareFetch(url, 60_000)
    return this.parseListingHtml(html, lang, episode)
  }

  private parseListingHtml(html: string, lang: string, episode?: number): SubsourceEntry[] {
    const entries: SubsourceEntry[] = []
    const seen = new Set<string>()

    // Extract subtitle rows from the HTML table
    const rowRegex = /<tr class="subtitles-table-row[^"]*"[^>]*>(.*?)<\/tr>/gs
    let rowMatch: RegExpExecArray | null
    while ((rowMatch = rowRegex.exec(html)) !== null) {
      const row = rowMatch[1]

      // Extract href (format: /subtitle/{detailPath})
      const hrefMatch = row.match(/href="\/subtitle\/([^"]+)"/)
      if (!hrefMatch) continue
      const detailPath = hrefMatch[1]

      if (seen.has(detailPath)) continue
      seen.add(detailPath)

      // Extract the subId from the last path segment
      const pathParts = detailPath.split('/')
      const subId = pathParts[pathParts.length - 1]

      // Extract release name (second <a> text in the row)
      const texts = [...row.matchAll(/data-discover="true">([^<]+)</g)].map((m) => m[1].trim())
      const releaseName = texts[1] ?? texts[0] ?? 'Unknown'

      // Filter by episode if specified
      if (episode != null) {
        const releaseLower = releaseName.toLowerCase()
        const detectedEp = this.extractEpisodeNumber(releaseLower)
        if (detectedEp !== null && detectedEp !== episode) continue
        // No episode marker → season pack or ambiguous, include it
      }

      entries.push({
        file_id: `subsource:html:${detailPath}`,
        language: this.normalizeLanguage(lang),
        release_name: releaseName,
        subId,
        detailPath,
      })
    }

    return entries
  }

  private parseDownloadUrl(html: string): string {
    const patterns = [
      /href="(https:\/\/api\.subsource\.net\/v1\/subtitle\/download\/[^"]+)"/,
      /href="(https:\/\/api\.subsource\.net[^"]*download[^"]*)"/,
      /"(https:\/\/api\.subsource\.net[^"]*download[^"]*)"/,
      /action="([^"]*download[^"]*)"/i,
      /data-url="([^"]*download[^"]*)"/i,
      /window\.location\s*=\s*['"]([^'"]*download[^'"]*)['"]]/i,
    ]
    for (const re of patterns) {
      const m = html.match(re)
      if (m) return m[1].startsWith('http') ? m[1] : `${API_HOST}${m[1]}`
    }
    throw new Error('SubSource: no download link found in detail page HTML')
  }

  private async extractSrtFromZip(zipBuffer: Buffer): Promise<string> {
    const { inflateRawSync } = await import('node:zlib')
    const SUPPORTED = ['.srt', '.vtt', '.ass', '.ssa']
    const candidates: Array<{ name: string; data: Buffer }> = []

    let offset = 0
    while (offset < zipBuffer.length - 30) {
      if (zipBuffer.readUInt32LE(offset) !== 0x04034b50) { offset++; continue }
      const compression = zipBuffer.readUInt16LE(offset + 8)
      const compressedSize = zipBuffer.readUInt32LE(offset + 18)
      const fnLen = zipBuffer.readUInt16LE(offset + 26)
      const extraLen = zipBuffer.readUInt16LE(offset + 28)
      // Validate fnLen before slicing to avoid reading garbage filename data.
      if (fnLen <= 0 || offset + 30 + fnLen > zipBuffer.length) { offset++; continue }
      const fileName = zipBuffer.slice(offset + 30, offset + 30 + fnLen).toString('utf-8').toLowerCase()
      const dataOffset = offset + 30 + fnLen + extraLen

      if (SUPPORTED.some((ext) => fileName.endsWith(ext))) {
        // Validate data bounds before slicing to avoid OOB reads on corrupt zips.
        if (dataOffset + compressedSize > zipBuffer.length) { offset = dataOffset + compressedSize; continue }
        const raw = zipBuffer.slice(dataOffset, dataOffset + compressedSize)
        const data = compression === 8 ? inflateRawSync(raw) : raw
        candidates.push({ name: fileName, data })
      }

      offset = dataOffset + compressedSize
    }

    if (candidates.length === 0) throw new Error('SubSource: no SRT/VTT file found in downloaded zip')

    // Prefer .srt/.vtt, fall back to .ass/.ssa
    const best =
      candidates.find((c) => c.name.endsWith('.srt') || c.name.endsWith('.vtt')) ?? candidates[0]

    let text = best.data.toString('utf-8').replace(/^﻿/, '')
    if (best.name.endsWith('.ass') || best.name.endsWith('.ssa')) {
      text = this.assToSrt(text)
    }
    return text
  }

  private assToSrt(ass: string): string {
    const lines = ass.split('\n')
    const events: string[] = []
    let inEvents = false

    for (const line of lines) {
      const trimmed = line.trim()
      if (trimmed === '[Events]') { inEvents = true; continue }
      if (trimmed.startsWith('[') && trimmed !== '[Events]') { inEvents = false; continue }
      if (!inEvents || !trimmed.startsWith('Dialogue:')) continue

      // Format: Dialogue: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text
      const parts = trimmed.split(',')
      if (parts.length < 10) continue
      const start = this.assTimeToSrt(parts[1])
      const end = this.assTimeToSrt(parts[2])
      const text = parts.slice(9).join(',')
        .replace(/\{[^}]*\}/g, '')   // strip ASS tags
        .replace(/\\N/g, '\n')
        .replace(/\\n/g, '\n')
        .trim()
      if (text) events.push(`${start} --> ${end}\n${text}`)
    }

    return events.map((e, i) => `${i + 1}\n${e}`).join('\n\n')
  }

  private assTimeToSrt(t: string): string {
    // ASS: H:MM:SS.cs → SRT: HH:MM:SS,ms
    const [hms, cs] = t.trim().split('.')
    const [h, m, s] = hms.split(':')
    const ms = String(Number(cs ?? '0') * 10).padStart(3, '0')
    return `${h.padStart(2, '0')}:${m}:${s},${ms}`
  }

  // ─── Private: Utilities ──────────────────────────────────────────────────────

  private buildSlug(title: string, year: number): string {
    return (
      title
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '') // remove diacritics
        .replace(/[^a-z0-9\s]/g, '') // keep alphanumeric and spaces
        .trim()
        .replace(/\s+/g, '-') // spaces to hyphens
        .replace(/-+/g, '-') // collapse multiple hyphens
        .replace(/^-|-$/g, '') + // trim edge hyphens
      '-' +
      year
    )
  }

  private extractEpisodeNumber(releaseLower: string): number | null {
    // Batch/range releases (e.g. S01E01-E16, E01-E16, E01-16) cover all episodes → treat as season pack
    if (/e\d{2,3}[-–]e?\d{2,3}/i.test(releaseLower)) return null
    if (/s\d{1,2}e\d{2,3}[-–]e?\d{2,3}/i.test(releaseLower)) return null

    // S01E02 — standard TV notation (must not be a range, checked above)
    const sxxeMatch = releaseLower.match(/s\d{1,2}e(\d{2,3})/)
    if (sxxeMatch) return parseInt(sxxeMatch[1], 10)

    // EP02, EP.02, EP 02, Episode 2, Episode.2 — standalone episode markers
    const epMatch = releaseLower.match(
      /(?:^|[\s.\-_[(])(?:ep(?:isode)?[.\s_]?(\d{1,3})|e(\d{2,3}))(?:$|[\s.\-_\])])/
    )
    if (epMatch) return parseInt(epMatch[1] ?? epMatch[2], 10)

    return null
  }

  private normalizeLanguage(lang: string): string {
    const l = lang.toLowerCase().trim()
    const map: Record<string, string> = {
      french: 'fr',
      fre: 'fr',
      fra: 'fr',
      english: 'en',
      eng: 'en',
    }
    return map[l] ?? l
  }
}
