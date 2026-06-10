import CacheWrapper, { CACHE_TTL } from '#services/cache_wrapper'
import got from 'got'

const OSUB_BASE = 'https://api.opensubtitles.com/api/v1'
const OSUB_USER_AGENT = 'JojoFlix v1.0'

export interface SubtitleEntry {
  file_id: string
  language: string
  release_name: string
  hearing_impaired: boolean
}

export interface SubtitleResult {
  url: string
  language: string
}

interface OSubFile {
  file_id: number
  file_name?: string
}

interface OSubEntry {
  attributes?: {
    language?: string
    release?: string
    hearing_impaired?: boolean
    files?: OSubFile[]
    feature_details?: { movie_name?: string }
  }
}

export default class SubtitlesService {
  private readonly cache: CacheWrapper
  private readonly apiKey: string

  constructor() {
    this.cache = new CacheWrapper()
    this.apiKey = process.env.OPENSUBS_API_KEY ?? ''
    if (!this.apiKey) {
      console.warn('[subtitles:opensubtitles] OPENSUBS_API_KEY is not set — subtitle requests will fail')
    }
  }

  async listSubtitles(imdbId: string, season?: number, episode?: number): Promise<SubtitleEntry[]> {
    const numericImdb = imdbId.replace(/^tt/i, '')
    const { mediaType, mediaId } = this.buildStremioMediaRef(imdbId, season, episode)
    const cacheKey = `subtitles:v2:list:${mediaType}:${mediaId}`

    const cached = await this.cache.get<SubtitleEntry[]>(cacheKey)
    if (cached && Array.isArray(cached) && cached.length > 0) return cached

    const params = new URLSearchParams({
      imdb_id: numericImdb,
      languages: 'fr',
      type: season != null ? 'episode' : 'movie',
    })
    if (season != null && episode != null) {
      params.set('season_number', String(season))
      params.set('episode_number', String(episode))
    }

    const data = await got
      .get(`${OSUB_BASE}/subtitles?${params}`, {
        headers: { 'Api-Key': this.apiKey, 'User-Agent': OSUB_USER_AGENT },
        timeout: { request: 10_000 },
        retry: { limit: 1 },
      })
      .json<{ data?: OSubEntry[] }>()

    const subtitles = data.data ?? []
    const entries: SubtitleEntry[] = []
    const seen = new Set<number>()

    for (const item of subtitles) {
      const attrs = item.attributes
      if (!attrs?.files?.length) continue

      for (const file of attrs.files) {
        if (!file.file_id || seen.has(file.file_id)) continue
        seen.add(file.file_id)

        const releaseName = attrs.release || attrs.feature_details?.movie_name || file.file_name || 'Unknown'
        entries.push({
          file_id: String(file.file_id),
          language: this.normalizeLanguage(attrs.language),
          release_name: releaseName,
          hearing_impaired: attrs.hearing_impaired ?? false,
        })

        await this.cache.set(`subtitles:ossub:${file.file_id}`, true, CACHE_TTL.SUBTITLES)
      }
    }

    await this.cache.set(cacheKey, entries, CACHE_TTL.SUBTITLES)
    return entries
  }

  async downloadSubtitle(fileId: string, language: string): Promise<SubtitleResult> {
    const numericId = Number(fileId)
    if (!Number.isNaN(numericId) && Number.isInteger(numericId) && numericId > 0) {
      const isOssub = await this.cache.get<boolean>(`subtitles:ossub:${numericId}`)
      if (isOssub) {
        const link = await this.getOsubDownloadLink(numericId)
        return { url: link, language: this.normalizeLanguage(language) }
      }
      // ossub flag may have expired from cache (24h TTL) — attempt direct download
      // rather than silently failing with "Subtitle not found".
      try {
        const link = await this.getOsubDownloadLink(numericId)
        return { url: link, language: this.normalizeLanguage(language) }
      } catch {
        // Not an OpenSubtitles file_id — fall through to url cache lookup
      }
    }

    const cachedUrl = await this.cache.get<string>(`subtitles:url:${fileId}`)
    if (!cachedUrl) throw new Error(`Subtitle not found for file_id=${fileId}`)
    return { url: cachedUrl, language: this.normalizeLanguage(language) }
  }

  private async getOsubDownloadLink(fileId: number): Promise<string> {
    const data = await got
      .post(`${OSUB_BASE}/download`, {
        json: { file_id: fileId, sub_format: 'srt' },
        headers: {
          'Api-Key': this.apiKey,
          'User-Agent': OSUB_USER_AGENT,
          'Content-Type': 'application/json',
        },
        timeout: { request: 10_000 },
        retry: { limit: 0 },
      })
      .json<{ link?: string; message?: string }>()

    if (!data.link) throw new Error(`OSSub download failed: ${data.message ?? 'no link'}`)
    return data.link
  }

  private buildStremioMediaRef(imdbId: string, season?: number, episode?: number) {
    const normalizedImdb = imdbId.startsWith('tt') ? imdbId : `tt${imdbId}`
    if (season != null && episode != null) {
      return { mediaType: 'series' as const, mediaId: `${normalizedImdb}:${season}:${episode}` }
    }
    return { mediaType: 'movie' as const, mediaId: normalizedImdb }
  }

  private normalizeLanguage(language?: string): string {
    if (!language) return 'en'
    const normalized = language.toLowerCase().trim().replace(/_/g, '-')
    if (normalized.length === 2 || normalized.includes('-')) return normalized

    const lang3to2: Record<string, string> = {
      fre: 'fr', fra: 'fr', eng: 'en', spa: 'es', ita: 'it', por: 'pt',
      deu: 'de', ger: 'de', nld: 'nl', rus: 'ru', jpn: 'ja', kor: 'ko',
      ara: 'ar', tur: 'tr', pol: 'pl', swe: 'sv', dan: 'da', nor: 'no',
      fin: 'fi', hun: 'hu', ces: 'cs', cze: 'cs', ron: 'ro', rum: 'ro',
      ukr: 'uk', zho: 'zh', chi: 'zh',
    }

    const langNameTo2: Record<string, string> = {
      french: 'fr', english: 'en', spanish: 'es', german: 'de', italian: 'it',
      portuguese: 'pt', arabic: 'ar', japanese: 'ja', russian: 'ru', turkish: 'tr',
      chinese: 'zh', korean: 'ko', dutch: 'nl', polish: 'pl', swedish: 'sv',
      danish: 'da', norwegian: 'no', finnish: 'fi', hungarian: 'hu', czech: 'cs',
      romanian: 'ro', ukrainian: 'uk', hebrew: 'he', greek: 'el',
    }

    return lang3to2[normalized] ?? langNameTo2[normalized] ?? normalized
  }
}
