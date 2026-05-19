import env from '#start/env'
import CacheWrapper, { CACHE_TTL } from '#services/cache_wrapper'
import got from 'got'
import crypto from 'node:crypto'

const RD_BASE_URL = 'https://api.real-debrid.com/rest/1.0'
const RD_BLOCKED_TTL_SECONDS = 15 * 60 // 15min
const RD_UNAVAILABLE_TTL_SECONDS = 20 * 60 // 20 min

interface UnrestrictOptions {
  fileIdx?: number | null
  maxAttempts?: number
  season?: number | null
  episode?: number | null
}

interface RdTorrentFile {
  id: number
  path: string
  bytes: number
  selected: number
}

interface RdTorrentInfo {
  status: string
  links: string[]
  files: RdTorrentFile[]
}

export default class RealDebridService {
  private readonly apiKey: string
  private readonly cache: CacheWrapper

  constructor() {
    this.apiKey = env.get('RD_API_KEY').release()
    this.cache = new CacheWrapper()
  }

  /**
   * Résout un lien magnétique via Real-Debrid.
   * Retourne le lien direct — JAMAIS transmis au client Flutter.
   * Le résultat est caché 2h pour éviter les appels répétés.
   */
  async unrestrictLink(magnetOrLink: string, options: UnrestrictOptions = {}): Promise<string> {
    const normalizedFileIdx =
      options.fileIdx != null && Number.isFinite(options.fileIdx)
        ? Number(options.fileIdx)
        : null
    const normalizedSeason =
      options.season != null && Number.isFinite(options.season) ? Number(options.season) : null
    const normalizedEpisode =
      options.episode != null && Number.isFinite(options.episode) ? Number(options.episode) : null
    const cacheSeed = `${magnetOrLink}|file_idx=${normalizedFileIdx ?? 'na'}|season=${
      normalizedSeason ?? 'na'
    }|episode=${normalizedEpisode ?? 'na'}`
    const cacheKey = `rd:link:${crypto.createHash('md5').update(cacheSeed).digest('hex')}`
    const blockedKey = `rd:blocked:${crypto.createHash('md5').update(cacheSeed).digest('hex')}`
    const unavailableKey = `rd:unavailable:${crypto.createHash('md5').update(cacheSeed).digest('hex')}`

    const cached = await this.cache.get<string>(cacheKey)
    if (cached) return cached
    const blocked = await this.cache.get<boolean>(blockedKey)
    if (blocked) {
      throw new Error('RD_ERROR: Magnet blocked (cached 451)')
    }
    const unavailable = await this.cache.get<boolean>(unavailableKey)
    if (unavailable) {
      throw new Error('RD_ERROR: Magnet unavailable (cached)')
    }

    try {
      // Étape 1 : Ajouter le magnet dans RD (torrent → fichier)
      const torrentId = await this.addMagnet(magnetOrLink)

      // Étape 2 : Attendre que RD traite le torrent et sélectionner le fichier principal
      const maxAttempts =
        options.maxAttempts != null && Number.isFinite(options.maxAttempts)
          ? Math.max(1, Number(options.maxAttempts))
          : 15
      const directLink = await this.selectAndUnrestrict(
        torrentId,
        {
          fileIdx: normalizedFileIdx,
          season: normalizedSeason,
          episode: normalizedEpisode,
        },
        maxAttempts
      )

      await this.cache.set(cacheKey, directLink, CACHE_TTL.RD_LINK)
      return directLink
    } catch (error) {
      if (this.isPermanentBlockedError(error)) {
        await this.cache.set(blockedKey, true, RD_BLOCKED_TTL_SECONDS)
      } else if (this.isTemporarilyUnavailableError(error)) {
        await this.cache.set(unavailableKey, true, RD_UNAVAILABLE_TTL_SECONDS)
      }
      if (error instanceof Error && error.message.toUpperCase().includes('RD_ERROR')) {
        throw error
      }
      const message = this.extractRdErrorMessage(error)
      throw new Error(`RD_ERROR: ${message}`)
    }
  }

  private async addMagnet(magnet: string): Promise<string> {
    try {
      const data = await got
        .post(`${RD_BASE_URL}/torrents/addMagnet`, {
          headers: { Authorization: `Bearer ${this.apiKey}` },
          form: { magnet },
          retry: { limit: 0 },
          timeout: { connect: 3_000, request: 6_000 },
        })
        .json<{ id: string }>()

      return data.id
    } catch (error) {
      throw new Error(`RD_ERROR: ${this.extractRdErrorMessage(error)}`)
    }
  }

  private async selectAndUnrestrict(
    torrentId: string,
    options: UnrestrictOptions = {},
    maxAttempts = 15
  ): Promise<string> {
    // Sélectionner tous les fichiers du torrent
    await got.post(`${RD_BASE_URL}/torrents/selectFiles/${torrentId}`, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
      form: { files: 'all' },
      retry: { limit: 0 },
      timeout: { connect: 3_000, request: 6_000 },
    })

    // Attendre que le torrent soit prêt (max 30s, poll toutes les 2s)
    const info = await this.pollTorrentReady(torrentId, maxAttempts)

    if (!info.links || info.links.length === 0) {
      throw new Error('RD_ERROR: No links available')
    }

    const mainLink = this.pickBestLink(info, options)

    // Unrestrict le lien
    const unrestricted = await got
      .post(`${RD_BASE_URL}/unrestrict/link`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
        form: { link: mainLink },
        retry: { limit: 0 },
        timeout: { connect: 3_000, request: 6_000 },
      })
      .json<{ download: string }>()

    return unrestricted.download
  }

  private async pollTorrentReady(torrentId: string, maxAttempts: number): Promise<RdTorrentInfo> {
    for (let i = 0; i < maxAttempts; i++) {
      const info = await got
        .get(`${RD_BASE_URL}/torrents/info/${torrentId}`, {
          headers: { Authorization: `Bearer ${this.apiKey}` },
          retry: { limit: 0 },
          timeout: { connect: 3_000, request: 5_000 },
        })
        .json<RdTorrentInfo>()

      if (info.status === 'downloaded') {
        return info
      }

      if (['error', 'magnet_error', 'virus', 'dead'].includes(info.status)) {
        throw new Error(`RD_ERROR: Torrent status = ${info.status}`)
      }

      if (i < maxAttempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, 1_200))
      }
    }

    throw new Error('RD_ERROR: Timeout waiting for torrent to be ready')
  }

  private pickBestLink(info: RdTorrentInfo, options: UnrestrictOptions = {}): string {
    const links = info.links ?? []
    if (links.length === 0) {
      throw new Error('RD_ERROR: No links available')
    }

    const fileIdx =
      options.fileIdx != null && Number.isFinite(options.fileIdx) ? Number(options.fileIdx) : null
    const season =
      options.season != null && Number.isFinite(options.season) ? Number(options.season) : null
    const episode =
      options.episode != null && Number.isFinite(options.episode) ? Number(options.episode) : null
    const selected = this.selectedFiles(info)
    const selectedWithIdx = selected.map((file, idx) => ({ file, idx }))

    if (fileIdx != null && fileIdx >= 0) {
      // fileIdx Torrentio est 0-based sur la liste des liens.
      if (fileIdx < links.length) {
        const byIndex = selectedWithIdx[fileIdx]
        if (!byIndex || !this.matchesRequestedEpisode(byIndex.file.path, season, episode)) {
          const matchedIndex = this.pickEpisodeMatchedIndex(selectedWithIdx, season, episode)
          if (matchedIndex != null && matchedIndex < links.length) {
            return links[matchedIndex]
          }
        }
        return links[fileIdx]
      }

      // Fallback rare: map via id RD (souvent 1-based).
      const pos = selected.findIndex((file) => file.id === fileIdx + 1)
      if (pos >= 0 && pos < links.length) {
        if (!this.matchesRequestedEpisode(selected[pos].path, season, episode)) {
          const matchedIndex = this.pickEpisodeMatchedIndex(selectedWithIdx, season, episode)
          if (matchedIndex != null && matchedIndex < links.length) {
            return links[matchedIndex]
          }
        }
        return links[pos]
      }
    }

    const matchedIndex = this.pickEpisodeMatchedIndex(selectedWithIdx, season, episode)
    if (matchedIndex != null && matchedIndex < links.length) {
      return links[matchedIndex]
    }

    // Fallback robuste: plus gros fichier vidéo parmi les fichiers sélectionnés.
    if (selected.length > 0 && selected.length === links.length) {
      const videoIndexes = selected
        .map((file, idx) => ({ file, idx }))
        .filter(({ file }) => this.isVideoFile(file.path))
      const ranked = (videoIndexes.length > 0 ? videoIndexes : selected.map((file, idx) => ({ file, idx })))
        .sort((a, b) => b.file.bytes - a.file.bytes)
      return links[ranked[0].idx]
    }

    return links[0]
  }

  private isVideoFile(path: string): boolean {
    return /\.(mkv|mp4|avi|mov|wmv|webm|m4v|ts|m2ts)$/i.test(path)
  }

  private selectedFiles(info: RdTorrentInfo): RdTorrentFile[] {
    return (info.files ?? [])
      .filter((file) => file.selected === 1)
      .sort((a, b) => a.id - b.id)
  }

  private pickEpisodeMatchedIndex(
    selected: Array<{ file: RdTorrentFile; idx: number }>,
    season?: number | null,
    episode?: number | null
  ): number | null {
    if (!season || !episode || selected.length === 0) return null

    const matches = selected.filter(({ file }) =>
      this.matchesRequestedEpisode(file.path, season, episode)
    )
    if (matches.length === 0) return null

    matches.sort((a, b) => {
      const aIsVideo = this.isVideoFile(a.file.path) ? 1 : 0
      const bIsVideo = this.isVideoFile(b.file.path) ? 1 : 0
      if (aIsVideo !== bIsVideo) return bIsVideo - aIsVideo
      return b.file.bytes - a.file.bytes
    })

    return matches[0].idx
  }

  private matchesRequestedEpisode(
    path: string,
    season?: number | null,
    episode?: number | null
  ): boolean {
    if (!season || !episode) return false

    const normalized = this.normalizeEpisodePath(path)
    const exactPatterns = [
      new RegExp(`\\bs0*${season}\\s*e0*${episode}\\b`, 'i'),
      new RegExp(`\\b${season}\\s*x\\s*0*${episode}\\b`, 'i'),
      new RegExp(`\\bseason\\s*0*${season}\\s*episode\\s*0*${episode}\\b`, 'i'),
    ]

    if (exactPatterns.some((pattern) => pattern.test(normalized))) {
      return true
    }

    if (season !== 1) return false

    return new RegExp(`\\b(?:e|ep|episode)\\s*0*${episode}\\b`, 'i').test(normalized)
  }

  private normalizeEpisodePath(path: string): string {
    return path
      .replaceAll(/[()[\]{}]/g, ' ')
      .replaceAll(/[._-]+/g, ' ')
      .replaceAll(/\s+/g, ' ')
      .trim()
  }

  private isPermanentBlockedError(error: unknown): boolean {
    const message = this.extractRdErrorMessage(error).toLowerCase()
    return message.includes('status code 451') || message.includes('unavailable for legal reasons')
  }

  private isTemporarilyUnavailableError(error: unknown): boolean {
    const message = this.extractRdErrorMessage(error).toLowerCase()
    return (
      message.includes('error transfering magnet link') ||
      message.includes('error transferring magnet link') ||
      message.includes('no seeders') ||
      message.includes('no peers') ||
      message.includes('torrent status = magnet_error') ||
      message.includes('torrent status = dead')
    )
  }

  private extractRdErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      const responseBody = (error as Error & { response?: { body?: unknown } }).response?.body
      const parsed = this.parseRdErrorBody(responseBody)
      if (parsed) return parsed
      return error.message
    }
    return String(error)
  }

  private parseRdErrorBody(body: unknown): string | null {
    if (body == null) return null

    if (typeof body === 'string') {
      const trimmed = body.trim()
      if (!trimmed) return null
      try {
        const parsed = JSON.parse(trimmed) as Record<string, unknown>
        return this.parseRdErrorBody(parsed)
      } catch {
        return trimmed
      }
    }

    if (typeof body === 'object') {
      const record = body as Record<string, unknown>
      const direct =
        (typeof record.error === 'string' && record.error) ||
        (typeof record.message === 'string' && record.message) ||
        (typeof record.error_message === 'string' && record.error_message)
      if (direct) return direct
    }

    return null
  }
}
// RD
