import CacheWrapper, { CACHE_TTL } from '#services/cache_wrapper'
import got from 'got'

const DEFAULT_MANIFEST_URL =
  'https://subsense.nepiraw.com/txjvs4rj-IuOxgfqym-UNBQtf5gY7Kibu2I2BS-aopNAN0nYndCMm7uTa9nxqtfid9b_tp2zu2iYgqXmwReTLDINKT905aPlkWNqEELU-ggBDfr_6HYae_6SP8hfR0IOKw5gsPGtNisc0nKeaxfC1apWIK8b8vKIV320boJ1pr5a4f3iw1Wk8XZh4U2ySvoVf2KKu2PuTEivKqhdzaUhLVg/manifest.json'

export interface SubtitleEntry {
  file_id: number
  language: string
  release_name: string
  hearing_impaired: boolean
}

export interface SubtitleResult {
  url: string
  language: string
}

interface CachedSubtitleEntry extends SubtitleEntry {
  _url: string
}

interface StremioSubtitleItem {
  id?: string | number
  sub_id?: string | number
  lang?: string
  lang_code?: string
  label?: string
  title?: string
  name?: string
  url?: string
}

export default class SubtitlesService {
  private readonly cache: CacheWrapper
  private readonly addonBaseUrl: string

  constructor() {
    this.cache = new CacheWrapper()
    this.addonBaseUrl = this.resolveAddonBaseUrl(
      process.env.SUBTITLES_ADDON_MANIFEST_URL ?? DEFAULT_MANIFEST_URL
    )
  }

  async listSubtitles(imdbId: string, season?: number, episode?: number): Promise<SubtitleEntry[]> {
    const { mediaType, mediaId } = this.buildStremioMediaRef(imdbId, season, episode)
    const cacheKey = `subtitles:list:${mediaType}:${mediaId}`

    // Cache hit — re-hydrater les URL keys seulement si le format est valide (contient _url)
    const cached = await this.cache.get<CachedSubtitleEntry[]>(cacheKey)
    if (cached && Array.isArray(cached) && cached.length > 0 && cached[0]._url) {
      for (const entry of cached) {
        if (entry._url) {
          await this.cache.set(`subtitles:url:${entry.file_id}`, entry._url, CACHE_TTL.SUBTITLES)
        }
      }
      return cached.map(({ _url: _, ...entry }) => entry)
    }

    const data = await got
      .get(`${this.addonBaseUrl}/subtitles/${mediaType}/${mediaId}.json`)
      .json<{ subtitles?: StremioSubtitleItem[] }>()

    const subtitles = data.subtitles ?? []
    const entries: CachedSubtitleEntry[] = []

    for (let i = 0; i < subtitles.length; i++) {
      const item = subtitles[i]
      if (!item.url) continue

      const resolvedUrl = this.preferVttUrl(item.url)
      const language = this.normalizeLanguage(item.lang ?? item.lang_code)
      const fileId = this.hashUrl(resolvedUrl)
      const releaseName = item.label ?? item.title ?? item.name ?? String(item.id ?? item.sub_id ?? `Subtitle #${i + 1}`)

      await this.cache.set(`subtitles:url:${fileId}`, resolvedUrl, CACHE_TTL.SUBTITLES)
      entries.push({ file_id: fileId, language, release_name: releaseName, hearing_impaired: false, _url: resolvedUrl })
    }

    await this.cache.set(cacheKey, entries, CACHE_TTL.SUBTITLES)
    return entries.map(({ _url: _, ...entry }) => entry)
  }

  async downloadSubtitle(fileId: number, language: string): Promise<SubtitleResult> {
    const cachedUrl = await this.cache.get<string>(`subtitles:url:${fileId}`)
    if (!cachedUrl) throw new Error(`Subtitle URL not found in cache for file_id=${fileId}`)
    return { url: cachedUrl, language: this.normalizeLanguage(language) }
  }

  private preferVttUrl(url: string): string {
    try {
      const parsed = new URL(url)
      if (parsed.hostname.includes('wyzie.io')) {
        parsed.searchParams.set('format', 'vtt')
      }
      return parsed.toString()
    } catch {
      return url
    }
  }

  private hashUrl(url: string): number {
    let hash = 5381
    for (let i = 0; i < url.length; i++) {
      hash = ((hash << 5) + hash + url.charCodeAt(i)) >>> 0
    }
    return hash === 0 ? 1 : hash
  }

  private resolveAddonBaseUrl(manifestUrl: string): string {
    const trimmed = manifestUrl.trim().replace(/\/+$/, '')
    return trimmed.endsWith('/manifest.json') ? trimmed.slice(0, -'/manifest.json'.length) : trimmed
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
// Subtitles
