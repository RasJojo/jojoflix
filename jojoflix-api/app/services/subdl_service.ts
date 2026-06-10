import CacheWrapper, { CACHE_TTL } from '#services/cache_wrapper'
import got from 'got'

const SUBDL_BASE = 'https://api.subdl.com/api/v1'
const SUBDL_DOWNLOAD_BASE = 'https://dl.subdl.com'

export interface SubdlEntry {
  file_id: string
  language: string
  release_name: string
  full_season: boolean
  episode?: number
  season?: number
}

interface SubdlApiSubtitle {
  name?: string
  language?: string
  release_name?: string
  full_season?: boolean
  season?: number
  episode?: number
  url?: string
}

export default class SubdlService {
  private readonly cache: CacheWrapper
  private readonly apiKey: string

  constructor(apiKey: string) {
    this.cache = new CacheWrapper()
    this.apiKey = apiKey
  }

  async listSubtitles(imdbId: string, season?: number, episode?: number): Promise<SubdlEntry[]> {
    const numericImdb = imdbId.replace(/^tt/i, '')
    const cacheKey = `subdl:v1:list:${numericImdb}:s${season ?? 'na'}:e${episode ?? 'na'}`

    const cached = await this.cache.get<SubdlEntry[]>(cacheKey)
    if (cached && Array.isArray(cached) && cached.length > 0) return cached

    const params: Record<string, string> = {
      api_key: this.apiKey,
      imdb_id: `tt${numericImdb}`,
      languages: 'FR,EN',
    }
    if (season != null) {
      params.type = 'tv'
      params.season_number = String(season)
      if (episode != null) params.episode_number = String(episode)
    } else {
      params.type = 'movie'
    }

    const data = await got
      .get(`${SUBDL_BASE}/subtitles`, {
        searchParams: params,
        timeout: { request: 10_000 },
        retry: { limit: 1 },
      })
      .json<{ status: boolean; subtitles?: SubdlApiSubtitle[] }>()

    if (!data.status || !data.subtitles?.length) {
      // Cache negative results with a shorter TTL so repeated requests for
      // titles with no subtitles don't hammer the SubDL API quota.
      await this.cache.set(cacheKey, [], Math.floor(CACHE_TTL.SUBTITLES / 4))
      return []
    }

    const entries: SubdlEntry[] = []
    const seen = new Set<string>()

    for (const sub of data.subtitles) {
      if (!sub.url) continue
      // Skip full-season packs when looking for a specific episode
      if (episode != null && sub.full_season) continue

      const fileId = sub.url
      if (seen.has(fileId)) continue
      seen.add(fileId)

      entries.push({
        file_id: fileId,
        language: this.normalizeLanguage(sub.language),
        release_name: sub.release_name ?? sub.name ?? 'Unknown',
        full_season: sub.full_season ?? false,
        season: sub.season,
        episode: sub.episode,
      })
    }

    await this.cache.set(cacheKey, entries, CACHE_TTL.SUBTITLES)
    return entries
  }

  async getDownloadUrl(fileId: string): Promise<string> {
    // fileId from SUBDL is a path like /subtitle/xxx.zip — ensure leading slash
    const path = fileId.startsWith('/') ? fileId : `/${fileId}`
    return `${SUBDL_DOWNLOAD_BASE}${path}`
  }

  private normalizeLanguage(language?: string): string {
    if (!language) return 'en'
    const l = language.toLowerCase().trim()
    const map: Record<string, string> = {
      fr: 'fr', french: 'fr', fre: 'fr', fra: 'fr',
      en: 'en', english: 'en', eng: 'en',
    }
    return map[l] ?? l
  }
}
