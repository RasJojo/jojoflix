import env from '#start/env'
import CacheWrapper, { CACHE_TTL } from '#services/cache_wrapper'
import TmdbService from '#services/tmdb_service'
import got from 'got'
import crypto from 'node:crypto'

export interface TorrentSource {
  key: string
  name: string
  resolution: string
  size_gb: number | null
  tags: string[]
  score: number
  preference_rank?: number
  cached_rank?: number
  provider: 'mediafusion' | 'torrentio' | 'dramayo'
  magnet: string
  direct_url?: string // URL déjà résolue (MediaFusion/Dramayo) — bypasse RD
  has_direct_url: boolean
  info_hash?: string
  file_idx?: number | null
}

interface SourceFetchOptions {
  includeSlowProviders?: boolean
  forceRefresh?: boolean
}

type SourceProvidersMode = 'fast' | 'full'

interface SourceSortKey {
  episodeLabelRank: number
  languageRank: number
  providerRank: number
  cachedRank: number
  resolutionRank: number
  qualityRank: number
  sizeRank: number
}

interface ScoredCandidate {
  source: TorrentSource
  sort: SourceSortKey
}

// Regex de scoring — précis et complets, pas de TODO
const SCORE_RULES = [
  { pattern: /\b(TRUEFRENCH|VFF)\b/i, score: 100 },
  { pattern: /\bMULTI\b/i, score: 80 },
  { pattern: /\b(VOSTFR|SUBFRENCH)\b/i, score: 50 },
  { pattern: /\b2160p\b/i, score: 40 },
  { pattern: /\b1080p\b/i, score: 30 },
  { pattern: /\b720p\b/i, score: 20 },
  { pattern: /\b480p\b/i, score: 10 },
  { pattern: /\b(HDR|HDR10|DOLBY|ATMOS)\b/i, score: 5 },
  { pattern: /\b(CAM|HDCAM|TS|DVDSCR|TELESYNC)\b/i, score: -50 },
] as const

const RESOLUTION_PATTERNS: [RegExp, string][] = [
  [/\b2160p\b/i, '4K'],
  [/\b1080p\b/i, '1080p'],
  [/\b720p\b/i, '720p'],
  [/\b480p\b/i, '480p'],
]

const SIZE_PATTERN = /(\d+(?:\.\d+)?)\s*(GB|GiB|MB|MiB)/i
const FRENCH_PATTERNS = [
  /\bfrench\b/i,
  /\bfrancais\b/i,
  /\bfrançais\b/i,
  /\bvf\b/i,
  /\bvff\b/i,
  /\btruefrench\b/i,
  /🇫🇷/u,
]
const ENGLISH_PATTERNS = [/\benglish\b/i, /\banglais\b/i, /\beng\b/i, /🇬🇧/u, /🇺🇸/u]
const JAPANESE_PATTERNS = [/\bjapanese\b/i, /\bjaponais\b/i, /\bjpn\b/i, /🇯🇵/u]
const KOREAN_PATTERNS = [/\bkorean\b/i, /\bcoreen\b/i, /\bcoréen\b/i, /\bkor\b/i, /🇰🇷/u]
const GERMAN_PATTERNS = [/\bgerman\b/i, /\ballemand\b/i, /\bdeu\b/i, /\bger\b/i, /🇩🇪/u]
const ITALIAN_PATTERNS = [/\bitalian\b/i, /\bitalien\b/i, /\bita\b/i, /🇮🇹/u]
const SPANISH_PATTERNS = [/\bspanish\b/i, /\bespagnol\b/i, /\bspa\b/i, /🇪🇸/u]
const PORTUGUESE_PATTERNS = [/\bportuguese\b/i, /\bportugais\b/i, /\bpor\b/i, /🇵🇹/u, /🇧🇷/u]
const RUSSIAN_PATTERNS = [/\brussian\b/i, /\brusse\b/i, /\brus\b/i, /🇷🇺/u]
const POLISH_PATTERNS = [/\bpolish\b/i, /\bpolonais\b/i, /\bpol\b/i, /🇵🇱/u]
const TURKISH_PATTERNS = [/\bturkish\b/i, /\bturc\b/i, /\btur\b/i, /🇹🇷/u]
const CZECH_PATTERNS = [/\bczech\b/i, /\btcheque\b/i, /\bcze\b/i, /🇨🇿/u]
const HUNGARIAN_PATTERNS = [/\bhungarian\b/i, /\bhongrois\b/i, /\bhun\b/i, /🇭🇺/u]
const UKRAINIAN_PATTERNS = [/\bukrainian\b/i, /\bukrainien\b/i, /\bukr\b/i, /🇺🇦/u]
const ARABIC_PATTERNS = [/\barabic\b/i, /\barabe\b/i, /\bara\b/i, /🇸🇦/u]
const CHINESE_PATTERNS = [/\bchinese\b/i, /\bchinois\b/i, /\bchi\b/i, /\bzho\b/i, /🇨🇳/u]
const VOSTFR_PATTERNS = [/\bVOSTFR\b/i, /\bSUBFRENCH\b/i, /\bVOST\b/i]
const COMPACT_LANGUAGE_CODES = [
  'french',
  'francais',
  'français',
  'fra',
  'fre',
  'vf',
  'vff',
  'vfq',
  'english',
  'anglais',
  'eng',
  'japanese',
  'japonais',
  'jpn',
  'korean',
  'coreen',
  'coréen',
  'kor',
  'german',
  'allemand',
  'deu',
  'ger',
  'italian',
  'italien',
  'ita',
  'spanish',
  'espagnol',
  'spa',
  'portuguese',
  'portugais',
  'por',
  'russian',
  'russe',
  'rus',
  'polish',
  'polonais',
  'pol',
  'turkish',
  'turc',
  'tur',
  'czech',
  'tcheque',
  'cze',
  'hungarian',
  'hongrois',
  'hun',
  'ukrainian',
  'ukrainien',
  'ukr',
  'arabic',
  'arabe',
  'ara',
  'chinese',
  'chinois',
  'chi',
  'zho',
] as const
const COMPACT_LANGUAGE_PREFIX_RE = new RegExp(
  `(\\d+x)(?=(${COMPACT_LANGUAGE_CODES.join('|')})\\b)`,
  'ig'
)

export default class TorrentScoringService {
  private readonly cache: CacheWrapper
  private readonly torrentioUrl: string
  private readonly mediaFusionUrl: string | null
  private readonly dramaYoUrl: string | null
  private readonly tmdb: TmdbService

  constructor() {
    this.cache = new CacheWrapper()
    this.torrentioUrl =
      this.normalizeAddonBaseUrl(env.get('TORRENTIO_URL')) ?? 'https://torrentio.strem.fun'
    this.mediaFusionUrl = this.normalizeAddonBaseUrl(env.get('MEDIAFUSION_URL'))
    this.dramaYoUrl = this.normalizeAddonBaseUrl(env.get('DRAMAYO_URL'))
    this.tmdb = new TmdbService()
  }

  async scoreAndSelectSource(
    tmdbId: string,
    mediaType: 'movie' | 'tv',
    season?: number,
    episode?: number,
    options: SourceFetchOptions = {}
  ): Promise<{ best: TorrentSource; all: TorrentSource[] }> {
    const includeSlowProviders = options.includeSlowProviders ?? false
    const forceRefresh = options.forceRefresh ?? false
    const mode: SourceProvidersMode = includeSlowProviders ? 'full' : 'fast'
    const cacheKey = this.cacheKey(tmdbId, mediaType, season, episode, mode)

    if (!forceRefresh) {
      const cached = await this.cache.get<TorrentSource[]>(cacheKey)
      if (this.isCacheShapeValid(cached)) {
        return { best: cached[0], all: cached }
      }
    }

    let torrentioRaw: any[] = []
    let mediaFusionRaw: any[] = []
    let dramaYoRaw: any[] = []
    if (includeSlowProviders) {
      ;[torrentioRaw, mediaFusionRaw, dramaYoRaw] = await Promise.all([
        this.fetchTorrentio(tmdbId, mediaType, season, episode),
        this.fetchMediaFusion(tmdbId, mediaType, season, episode, 'full'),
        this.fetchDramaYo(tmdbId, mediaType, season, episode),
      ])
    } else {
      torrentioRaw = await this.fetchTorrentio(tmdbId, mediaType, season, episode)
      if (torrentioRaw.length === 0) {
        mediaFusionRaw = await this.fetchMediaFusion(tmdbId, mediaType, season, episode, 'fast')
      }
    }

    const scored = [
      ...mediaFusionRaw.map((item) =>
        this.scoreCandidate(item, 'mediafusion', season, episode)
      ),
      ...dramaYoRaw.map((item) => this.scoreCandidate(item, 'dramayo', season, episode)),
      ...torrentioRaw.map((item) => this.scoreCandidate(item, 'torrentio', season, episode)),
    ]
      .filter((item) => item.source.magnet.length > 0 || item.source.direct_url)
      .sort((a, b) => this.compareCandidates(a, b, mediaType))
      .map((item) => item.source)

    if (scored.length === 0) {
      throw new Error('NO_SOURCE_FOUND')
    }

    await this.cache.set(cacheKey, scored, CACHE_TTL.TORRENTIO)
    return { best: scored[0], all: scored }
  }

  /**
   * Retourne la liste depuis le cache (pour l'endpoint /api/sources/).
   * Déclenche un fetch si cache manquant.
   */
  async getScoredSources(
    tmdbId: string,
    mediaType: 'movie' | 'tv',
    season?: number,
    episode?: number,
    options: SourceFetchOptions = {}
  ): Promise<TorrentSource[]> {
    const includeSlowProviders = options.includeSlowProviders ?? false
    const forceRefresh = options.forceRefresh ?? false
    const mode: SourceProvidersMode = includeSlowProviders ? 'full' : 'fast'
    const cacheKey = this.cacheKey(tmdbId, mediaType, season, episode, mode)
    const cached = await this.cache.get<TorrentSource[]>(cacheKey)
    const hasCachedMediaFusion = this.cacheHasMediaFusion(cached)
    if (this.isCacheShapeValid(cached) && !forceRefresh) {
      if (!includeSlowProviders || hasCachedMediaFusion) return cached
    }

    const { all } = await this.scoreAndSelectSource(tmdbId, mediaType, season, episode, {
      includeSlowProviders,
      forceRefresh: forceRefresh || (includeSlowProviders && !hasCachedMediaFusion),
    })
    return all
  }

  private isCacheShapeValid(cached: TorrentSource[] | null): cached is TorrentSource[] {
    return Boolean(
      cached &&
      cached.length > 0 &&
      cached.every(
        (item) =>
          item.key && typeof item.has_direct_url === 'boolean' && typeof item.provider === 'string'
      )
    )
  }

  private cacheHasMediaFusion(cached: TorrentSource[] | null): boolean {
    if (!this.isCacheShapeValid(cached)) return false
    return cached.some((item) => item.provider === 'mediafusion')
  }

  private score(item: {
    name: string
    description?: string
    infoHash?: string
    fileIdx?: number
    url?: string
    provider: 'mediafusion' | 'torrentio' | 'dramayo'
    behaviorHints?: any
  }): TorrentSource {
    // Pour MediaFusion, le nom est court et la description contient les détails
    const fullText = `${item.name} ${item.description ?? ''} ${item.behaviorHints?.filename ?? ''}`
    const name = item.name
    let totalScore = 0
    const tags: string[] = []

    for (const rule of SCORE_RULES) {
      if (rule.pattern.test(fullText)) {
        totalScore += rule.score
        const match = fullText.match(rule.pattern)
        if (match && rule.score > 0) tags.push(match[0].toUpperCase())
      }
    }

    // Les sources MediaFusion (url directe) sont boostées — plus rapides car déjà résolues
    if (item.url) totalScore += 200

    const resolution = this.extractResolution(fullText)
    const sizeGb =
      this.extractSizeFromHints(item.behaviorHints?.videoSize) ?? this.extractSize(fullText)
    const magnet = item.infoHash
      ? `magnet:?xt=urn:btih:${item.infoHash}&tr=udp://tracker.opentrackr.org:1337/announce`
      : ''
    const directUrl = item.url
    const normalizedFileIdx = Number.isFinite(item.fileIdx) ? Number(item.fileIdx) : null
    const keySeed = `${item.provider}|${
      item.infoHash ?? directUrl ?? `${name}|${item.description ?? ''}`
    }|${normalizedFileIdx ?? 'na'}`
    const key = crypto.createHash('sha1').update(keySeed).digest('hex').slice(0, 16)

    return {
      key,
      name: this.cleanName(item.behaviorHints?.filename ?? name),
      resolution,
      size_gb: sizeGb,
      tags: [...new Set(tags)],
      score: totalScore,
      provider: item.provider,
      magnet,
      direct_url: directUrl,
      has_direct_url: Boolean(directUrl),
      info_hash: item.infoHash,
      file_idx: normalizedFileIdx,
    }
  }

  private scoreCandidate(
    item: {
      name: string
      description?: string
      infoHash?: string
      fileIdx?: number
      url?: string
      behaviorHints?: any
    },
    provider: 'mediafusion' | 'torrentio' | 'dramayo',
    season?: number,
    episode?: number
  ): ScoredCandidate {
    const source = this.score({ ...item, provider })
    const fullText = `${item.name} ${item.description ?? ''} ${item.behaviorHints?.filename ?? ''}`
    const sort: SourceSortKey = {
      episodeLabelRank: this.extractEpisodeLabelRank(fullText, season, episode),
      languageRank: this.extractLanguageRank(fullText),
      providerRank: this.extractProviderRank(source),
      cachedRank: this.extractCachedRank(fullText, source),
      resolutionRank: this.resolutionRank(source.resolution),
      qualityRank: source.score,
      sizeRank: source.size_gb ?? 0,
    }

    source.preference_rank = sort.episodeLabelRank * 100 + sort.languageRank
    source.cached_rank = sort.cachedRank

    return { source, sort }
  }

  private compareCandidates(
    a: ScoredCandidate,
    b: ScoredCandidate,
    mediaType: 'movie' | 'tv'
  ): number {
    if (mediaType === 'tv' && a.sort.episodeLabelRank !== b.sort.episodeLabelRank) {
      return a.sort.episodeLabelRank - b.sort.episodeLabelRank
    }
    if (a.sort.languageRank !== b.sort.languageRank) {
      return a.sort.languageRank - b.sort.languageRank
    }
    if (a.sort.providerRank !== b.sort.providerRank) {
      return a.sort.providerRank - b.sort.providerRank
    }
    if (a.sort.cachedRank !== b.sort.cachedRank) {
      return b.sort.cachedRank - a.sort.cachedRank
    }
    // Pour les épisodes, on privilégie la taille de fichier (qualité perçue)
    // avant la pondération textuelle du nom.
    if (mediaType === 'tv' && a.sort.sizeRank !== b.sort.sizeRank) {
      return b.sort.sizeRank - a.sort.sizeRank
    }
    if (a.sort.resolutionRank !== b.sort.resolutionRank) {
      return b.sort.resolutionRank - a.sort.resolutionRank
    }
    if (a.sort.qualityRank !== b.sort.qualityRank) {
      return b.sort.qualityRank - a.sort.qualityRank
    }
    if (a.sort.sizeRank !== b.sort.sizeRank) {
      return b.sort.sizeRank - a.sort.sizeRank
    }
    return b.source.score - a.source.score
  }

  private extractEpisodeLabelRank(text: string, season?: number, episode?: number): number {
    if (!season || !episode) return 2

    const boundedPairs = this.extractEpisodePairs(text)
    if (boundedPairs.length > 0) {
      for (const pair of boundedPairs) {
        if (pair.season === season && pair.episode === episode) {
          return 0
        }
      }
      // Présence d'un label explicite mais différent.
      return 3
    }

    const weakEpisodePattern = new RegExp(
      `\\b(?:E|EP|EPISODE)\\s*0*${episode}\\b`,
      'i'
    )
    if (weakEpisodePattern.test(text)) {
      return 1
    }

    return 2
  }

  private extractEpisodePairs(text: string): Array<{ season: number; episode: number }> {
    const pairs: Array<{ season: number; episode: number }> = []
    const patterns = [
      /\bS(?:AISON)?\s*0*(\d{1,2})[\s._-]*E(?:P(?:ISODE)?)?\s*0*(\d{1,3})\b/gi,
      /\b(\d{1,2})\s*[xX]\s*0*(\d{1,3})\b/g,
    ]

    for (const pattern of patterns) {
      for (const match of text.matchAll(pattern)) {
        const season = Number(match[1])
        const episode = Number(match[2])
        if (!Number.isFinite(season) || !Number.isFinite(episode)) continue
        // Filtre anti faux positifs (ex: x264, 1080x265).
        if (season < 1 || season > 60 || episode < 1 || episode > 500) continue
        pairs.push({ season, episode })
      }
    }

    return pairs
  }

  private extractLanguageRank(text: string): number {
    const normalizedText = this.normalizeLanguageText(text)
    const hasFrench = FRENCH_PATTERNS.some((pattern) => pattern.test(normalizedText))
    const hasVostfr = VOSTFR_PATTERNS.some((pattern) => pattern.test(normalizedText))
    const hasEnglish = ENGLISH_PATTERNS.some((pattern) => pattern.test(normalizedText))
    const hasJapanese = JAPANESE_PATTERNS.some((pattern) => pattern.test(normalizedText))
    const hasKorean = KOREAN_PATTERNS.some((pattern) => pattern.test(normalizedText))
    const hasGerman = GERMAN_PATTERNS.some((pattern) => pattern.test(normalizedText))
    const hasItalian = ITALIAN_PATTERNS.some((pattern) => pattern.test(normalizedText))
    const hasSpanish = SPANISH_PATTERNS.some((pattern) => pattern.test(normalizedText))
    const hasPortuguese = PORTUGUESE_PATTERNS.some((pattern) => pattern.test(normalizedText))
    const hasRussian = RUSSIAN_PATTERNS.some((pattern) => pattern.test(normalizedText))
    const hasPolish = POLISH_PATTERNS.some((pattern) => pattern.test(normalizedText))
    const hasTurkish = TURKISH_PATTERNS.some((pattern) => pattern.test(normalizedText))
    const hasCzech = CZECH_PATTERNS.some((pattern) => pattern.test(normalizedText))
    const hasHungarian = HUNGARIAN_PATTERNS.some((pattern) => pattern.test(normalizedText))
    const hasUkrainian = UKRAINIAN_PATTERNS.some((pattern) => pattern.test(normalizedText))
    const hasArabic = ARABIC_PATTERNS.some((pattern) => pattern.test(normalizedText))
    const hasChinese = CHINESE_PATTERNS.some((pattern) => pattern.test(normalizedText))
    const languageCount = this.countListedLanguages(normalizedText)
    const hasMulti = /\bmulti\b/i.test(text) || languageCount >= 3
    const hasExplicitDisfavoredLanguage =
      hasGerman ||
      hasItalian ||
      hasSpanish ||
      hasPortuguese ||
      hasRussian ||
      hasPolish ||
      hasTurkish ||
      hasCzech ||
      hasHungarian ||
      hasUkrainian ||
      hasArabic ||
      hasChinese

    if (/\b(TRUEFRENCH|VFF|VFQ)\b/i.test(normalizedText)) return 0
    if (hasFrench && !hasVostfr && !hasMulti && languageCount <= 1) return 1
    if (hasVostfr && !hasMulti) return 2
    if (hasFrench && !hasMulti && languageCount <= 2) return 3
    if (hasFrench) return 4
    if (hasEnglish && !hasExplicitDisfavoredLanguage && !hasMulti && languageCount <= 1) return 5
    if (hasJapanese && !hasExplicitDisfavoredLanguage && !hasMulti && languageCount <= 1) return 6
    if (hasKorean && !hasExplicitDisfavoredLanguage && !hasMulti && languageCount <= 1) return 7
    if (hasEnglish && !hasExplicitDisfavoredLanguage && languageCount <= 2) return 8
    if (hasJapanese && !hasExplicitDisfavoredLanguage && languageCount <= 2) return 9
    if (hasKorean && !hasExplicitDisfavoredLanguage && languageCount <= 2) return 10
    if (!hasExplicitDisfavoredLanguage && !hasMulti) return 11
    if (hasEnglish && !hasExplicitDisfavoredLanguage) return 12
    if (hasJapanese && !hasExplicitDisfavoredLanguage) return 13
    if (hasKorean && !hasExplicitDisfavoredLanguage) return 14
    if (hasExplicitDisfavoredLanguage) return 41 + languageCount
    return 26 + languageCount
  }

  private countListedLanguages(text: string): number {
    const languageGroups = [
      FRENCH_PATTERNS,
      ENGLISH_PATTERNS,
      JAPANESE_PATTERNS,
      KOREAN_PATTERNS,
      GERMAN_PATTERNS,
      ITALIAN_PATTERNS,
      SPANISH_PATTERNS,
      PORTUGUESE_PATTERNS,
      RUSSIAN_PATTERNS,
      POLISH_PATTERNS,
      TURKISH_PATTERNS,
      CZECH_PATTERNS,
      HUNGARIAN_PATTERNS,
      UKRAINIAN_PATTERNS,
      ARABIC_PATTERNS,
      CHINESE_PATTERNS,
    ]

    return languageGroups.reduce((count, patterns) => {
      return count + (patterns.some((pattern) => pattern.test(text)) ? 1 : 0)
    }, 0)
  }

  private normalizeLanguageText(text: string): string {
    return text.replace(COMPACT_LANGUAGE_PREFIX_RE, '$1 ')
  }

  private extractCachedRank(text: string, source: TorrentSource): number {
    if (/⚡|cached/i.test(text)) return 2
    if (source.has_direct_url) return 1
    return 0
  }

  private extractProviderRank(source: TorrentSource): number {
    if (source.provider === 'torrentio') return 0
    if (source.provider === 'mediafusion') return 1
    return 2 // dramayo : complément de dernier recours dans le slow path
  }

  private resolutionRank(resolution: string): number {
    const normalized = resolution.toLowerCase()
    if (normalized === '4k' || normalized === '2160p') return 4
    if (normalized === '1080p') return 3
    if (normalized === '720p') return 2
    if (normalized === '480p') return 1
    return 0
  }

  private extractSizeFromHints(videoSize?: number): number | null {
    if (!videoSize) return null
    return Math.round((videoSize / (1024 * 1024 * 1024)) * 100) / 100
  }

  private extractResolution(name: string): string {
    for (const [pattern, label] of RESOLUTION_PATTERNS) {
      if (pattern.test(name)) return label
    }
    return 'Unknown'
  }

  private extractSize(name: string): number | null {
    const match = name.match(SIZE_PATTERN)
    if (!match) return null
    const value = Number.parseFloat(match[1])
    const unit = match[2].toUpperCase()
    if (unit === 'MB' || unit === 'MIB') return Math.round((value / 1024) * 100) / 100
    return value
  }

  private cleanName(name: string): string {
    // Enlever les métadonnées techniques pour n'afficher que le titre épuré
    return name
      .replace(/\[.*?\]/g, '')
      .replace(/\(.*?\)/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim()
      .split('\n')[0]
      .trim()
  }

  private async fetchTorrentio(
    tmdbId: string,
    mediaType: 'movie' | 'tv',
    season?: number,
    episode?: number
  ): Promise<any[]> {
    // Résoudre l'IMDB ID depuis TMDB (Torrentio requiert un vrai IMDB ID)
    const imdbId = await this.tmdb.getImdbId(Number(tmdbId), mediaType)
    if (!imdbId) return []

    const type = mediaType === 'movie' ? 'movie' : 'series'
    const idCandidates = await this.buildStremioIdCandidates(
      tmdbId,
      mediaType,
      imdbId,
      season,
      episode
    )

    let lastError: string | null = null
    for (const candidateId of idCandidates) {
      try {
        const url = `${this.torrentioUrl}/stream/${type}/${candidateId}.json`
        const data = await got
          .get(url, {
            retry: { limit: 0 },
            timeout: { connect: 4_000, request: 10_000 },
            headers: {
              'user-agent': 'Mozilla/5.0 (JOJOFLIX)',
              'accept': 'application/json',
            },
          })
          .json<{ streams?: any[] }>()
        const streams = data.streams ?? []
        if (streams.length > 0) {
          if (candidateId !== idCandidates[0]) {
            console.info(
              `[sources:torrentio] episode-fallback tmdb=${tmdbId} req=s${season}e${episode} used=${candidateId}`
            )
          }
          return streams
        }
      } catch (error) {
        lastError = error instanceof Error ? error.message : 'unknown error'
      }
    }

    if (lastError) {
      console.warn(
        `[sources:torrentio] tmdb=${tmdbId} type=${mediaType} s=${season ?? '-'} e=${episode ?? '-'} error=${lastError}`
      )
    }
    return []
  }

  private async fetchMediaFusion(
    tmdbId: string,
    mediaType: 'movie' | 'tv',
    season?: number,
    episode?: number,
    mode: 'fast' | 'full' = 'fast'
  ): Promise<any[]> {
    if (!this.mediaFusionUrl) return []

    const imdbId = await this.tmdb.getImdbId(Number(tmdbId), mediaType)
    if (!imdbId) return []

    const type = mediaType === 'movie' ? 'movie' : 'series'
    const idCandidates = await this.buildStremioIdCandidates(
      tmdbId,
      mediaType,
      imdbId,
      season,
      episode
    )

    let lastError: string | null = null
    for (const candidateId of idCandidates) {
      try {
        const url = `${this.mediaFusionUrl}/stream/${type}/${candidateId}.json`
        const connectTimeoutMs = mode === 'full' ? 5_000 : 3_000
        const requestTimeoutMs = mode === 'full' ? 45_000 : 5_000
        const data = await got
          .get(url, {
            retry: { limit: 0 },
            timeout: { connect: connectTimeoutMs, request: requestTimeoutMs },
            headers: {
              'user-agent': 'Mozilla/5.0 (JOJOFLIX)',
              'accept': 'application/json',
            },
          })
          .json<{ streams?: any[] }>()
        const streams = data.streams ?? []
        if (streams.length > 0) {
          if (candidateId !== idCandidates[0]) {
            console.info(
              `[sources:mediafusion] episode-fallback mode=${mode} tmdb=${tmdbId} req=s${season}e${episode} used=${candidateId}`
            )
          }
          return streams
        }
      } catch (error) {
        lastError = error instanceof Error ? error.message : 'unknown error'
      }
    }

    if (lastError) {
      console.warn(
        `[sources:mediafusion] mode=${mode} tmdb=${tmdbId} type=${mediaType} s=${season ?? '-'} e=${episode ?? '-'} error=${lastError}`
      )
    }
    return []
  }

  private async fetchDramaYo(
    tmdbId: string,
    mediaType: 'movie' | 'tv',
    season?: number,
    episode?: number
  ): Promise<any[]> {
    if (!this.dramaYoUrl) return []

    const imdbId = await this.tmdb.getImdbId(Number(tmdbId), mediaType)
    if (!imdbId) return []

    const type = mediaType === 'movie' ? 'movie' : 'series'
    const idCandidates = await this.buildStremioIdCandidates(
      tmdbId,
      mediaType,
      imdbId,
      season,
      episode
    )

    for (const candidateId of idCandidates) {
      try {
        const url = `${this.dramaYoUrl}/stream/${type}/${candidateId}.json`
        const data = await got
          .get(url, {
            retry: { limit: 0 },
            timeout: { connect: 4_000, request: 8_000 },
            headers: { 'user-agent': 'Mozilla/5.0 (JOJOFLIX)', 'accept': 'application/json' },
          })
          .json<{ streams?: any[] }>()
        const streams = data.streams ?? []
        if (streams.length > 0) return streams
      } catch {
        // Source non disponible pour ce contenu
      }
    }
    return []
  }

  private async buildStremioIdCandidates(
    tmdbId: string,
    mediaType: 'movie' | 'tv',
    imdbId: string,
    season?: number,
    episode?: number
  ): Promise<string[]> {
    const normalizedImdbId = imdbId.startsWith('tt') ? imdbId : `tt${imdbId}`
    if (mediaType !== 'tv' || !season || !episode) {
      return [normalizedImdbId]
    }

    const candidates: string[] = []

    // Cas TMDB "S1 absolue" (anime): on essaie d'abord le remap vers les saisons réelles.
    const remapped = await this.tmdb.remapCollapsedSeasonOneEpisode(Number(tmdbId), season, episode)
    if (remapped) {
      candidates.push(`${normalizedImdbId}:${remapped.season}:${remapped.episode}`)
    }

    candidates.push(`${normalizedImdbId}:${season}:${episode}`)

    // Fallback anime/ordering: certaines bases attendent une numérotation absolue
    // dans S1 (ex: S3E7 côté UI -> S1E53 côté addon).
    if (season > 1) {
      try {
        const absoluteEpisode = await this.tmdb.toAbsoluteEpisode(Number(tmdbId), season, episode)
        if (absoluteEpisode && absoluteEpisode > 0) {
          const absoluteCandidate = `${normalizedImdbId}:1:${absoluteEpisode}`
          if (!candidates.includes(absoluteCandidate)) {
            candidates.push(absoluteCandidate)
          }
        }
      } catch {
        // On garde la candidate principale si la conversion échoue.
      }
    }

    return candidates
  }

  private cacheKey(
    tmdbId: string,
    mediaType: string,
    season?: number,
    episode?: number,
    mode: SourceProvidersMode = 'fast'
  ): string {
    if (mediaType === 'tv' && season && episode) {
      return `sources:v5:${mode}:${mediaType}:${tmdbId}:s${season}e${episode}`
    }
    return `sources:v5:${mode}:${mediaType}:${tmdbId}`
  }

  private normalizeAddonBaseUrl(url?: string | null): string | null {
    if (!url) return null
    const trimmed = url.trim().replace(/\/+$/, '')
    return trimmed.endsWith('/manifest.json') ? trimmed.slice(0, -'/manifest.json'.length) : trimmed
  }
}
// Improved VOSTFR ranking, SubSense integration, DramaYo slow path
// Scoring
// FR boost
