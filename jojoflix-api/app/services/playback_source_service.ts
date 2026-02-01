import TorrentScoringService, { type TorrentSource } from '#services/torrent_scoring_service'
import RealDebridService from '#services/real_debrid_service'

export interface ResolvePlaybackSourceParams {
  tmdbId: string
  mediaType: 'movie' | 'tv'
  sourceKey?: string | null
  season?: number | null
  episode?: number | null
  timeoutMs?: number
}

export interface ResolvedPlaybackSource {
  source: TorrentSource
  directUrl: string
}

export default class PlaybackSourceService {
  private readonly scoring: TorrentScoringService
  private readonly rd: RealDebridService
  private static readonly RD_RESOLVE_TIMEOUT_MS = 8_000

  constructor() {
    this.scoring = new TorrentScoringService()
    this.rd = new RealDebridService()
  }

  async resolve(params: ResolvePlaybackSourceParams): Promise<ResolvedPlaybackSource> {
    const timeoutMs = Math.max(2_500, params.timeoutMs ?? 12_000)
    const source = await this.resolveSource(
      params.tmdbId,
      params.mediaType,
      params.sourceKey ?? undefined,
      params.season ?? undefined,
      params.episode ?? undefined
    )
    const directUrl = await this.resolveDirectUrl(
      source,
      timeoutMs,
      params.mediaType,
      params.season ?? undefined,
      params.episode ?? undefined
    )
    return { source, directUrl }
  }

  private async resolveSource(
    tmdbId: string,
    mediaType: 'movie' | 'tv',
    sourceKey?: string,
    season?: number,
    episode?: number
  ): Promise<TorrentSource> {
    if (sourceKey) {
      const fast = await this.scoring.getScoredSources(tmdbId, mediaType, season, episode)
      const selectedFast = fast.find((item) => item.key === sourceKey)
      if (selectedFast) return selectedFast

      const full = await this.scoring.getScoredSources(tmdbId, mediaType, season, episode, {
        includeSlowProviders: true,
        forceRefresh: true,
      })
      const selectedFull = full.find((item) => item.key === sourceKey)
      if (selectedFull) return selectedFull
    }

    const { best } = await this.scoring.scoreAndSelectSource(tmdbId, mediaType, season, episode)
    return best
  }

  private async resolveDirectUrl(
    source: TorrentSource,
    remainingMs: number,
    mediaType: 'movie' | 'tv',
    season?: number,
    episode?: number
  ): Promise<string> {
    if (source.direct_url) return source.direct_url

    if (!source.magnet) {
      throw new Error('NO_SOURCE_FOUND')
    }

    const timeoutMs = Math.max(
      2_500,
      Math.min(remainingMs, PlaybackSourceService.RD_RESOLVE_TIMEOUT_MS)
    )

    return this.withTimeout(
      this.rd.unrestrictLink(source.magnet, {
        fileIdx: source.file_idx ?? null,
        season: mediaType === 'tv' ? season ?? null : null,
        episode: mediaType === 'tv' ? episode ?? null : null,
      }),
      timeoutMs,
      'RD_ERROR: Timeout resolving direct link'
    )
  }

  private async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    timeoutMessage: string
  ): Promise<T> {
    let timer: NodeJS.Timeout | null = null
    const timeoutPromise = new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs)
    })

    try {
      return await Promise.race([promise, timeoutPromise])
    } finally {
      if (timer) clearTimeout(timer)
    }
  }
}
