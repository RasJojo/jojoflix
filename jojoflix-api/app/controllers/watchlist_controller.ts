import type { HttpContext } from '@adonisjs/core/http'
import ConvexRepository, { type ConvexProfile } from '#services/convex_repository'
import TmdbService from '#services/tmdb_service'

type WatchlistEntry = {
  tmdb_id: string
  media_type: 'movie' | 'tv'
  added_at?: string | null
}

export default class WatchlistController {
  private getMediaTitle(meta: { title?: string; name?: string }) {
    return meta.title ?? meta.name ?? ''
  }

  async index({ betterAuthUser, params, response }: HttpContext) {
    const user = betterAuthUser!
    const repo = new ConvexRepository()
    const profile = await this.resolveProfile(repo, user.id, params.id)
    if (!profile) {
      return response.notFound({ error: { code: 'NOT_FOUND', status: 404 } })
    }
    const items = await this.serializeWatchlist(profile)
    return response.ok({ data: items })
  }

  async store({ betterAuthUser, params, request, response }: HttpContext) {
    const user = betterAuthUser!
    const repo = new ConvexRepository()
    const profile = await this.resolveProfile(repo, user.id, params.id)
    if (!profile) {
      return response.notFound({ error: { code: 'NOT_FOUND', status: 404 } })
    }

    const tmdbId = String(request.input('tmdb_id') ?? '').trim()
    const mediaType = request.input('media_type')

    if (!tmdbId || (mediaType !== 'movie' && mediaType !== 'tv')) {
      return response.badRequest({
        error: {
          code: 'INVALID_WATCHLIST_PAYLOAD',
          message: 'tmdb_id et media_type sont requis',
          status: 400,
        },
      })
    }

    const existing = this.readWatchlist(profile)
    const deduped = existing.filter(
      (entry) => !(entry.tmdb_id === tmdbId && entry.media_type === mediaType)
    )
    deduped.unshift({
      tmdb_id: tmdbId,
      media_type: mediaType,
      added_at: new Date().toISOString(),
    })

    const updated = await repo.updateProfile(profile._id, {
      preferences: {
        ...(profile.preferences ?? {}),
        watchlist: deduped.slice(0, 200),
      },
    })

    return response.ok({ data: await this.serializeWatchlist(updated) })
  }

  async destroy({ betterAuthUser, params, response }: HttpContext) {
    const user = betterAuthUser!
    const repo = new ConvexRepository()
    const profile = await this.resolveProfile(repo, user.id, params.id)
    if (!profile) {
      return response.notFound({ error: { code: 'NOT_FOUND', status: 404 } })
    }

    const tmdbId = String(params.tmdbId ?? '').trim()
    const mediaType =
      params.mediaType === 'tv' ? 'tv' : params.mediaType === 'movie' ? 'movie' : null

    if (!tmdbId || !mediaType) {
      return response.badRequest({
        error: { code: 'INVALID_WATCHLIST_TARGET', message: 'Cible invalide', status: 400 },
      })
    }

    const filtered = this.readWatchlist(profile).filter(
      (entry) => !(entry.tmdb_id === tmdbId && entry.media_type === mediaType)
    )

    await repo.updateProfile(profile._id, {
      preferences: {
        ...(profile.preferences ?? {}),
        watchlist: filtered,
      },
    })

    return response.ok({ data: await this.serializeWatchlist({ ...profile, preferences: { ...profile.preferences, watchlist: filtered } }) })
  }

  private async resolveProfile(
    repo: ConvexRepository,
    userId: string,
    profileId: string
  ): Promise<ConvexProfile | null> {
    return repo.getProfileOfUser(profileId, userId)
  }

  private readWatchlist(profile: ConvexProfile): WatchlistEntry[] {
    const watchlist = profile.preferences?.watchlist
    if (!Array.isArray(watchlist)) return []

    return watchlist
      .map((entry) => ({
        tmdb_id: String(entry?.tmdb_id ?? '').trim(),
        media_type: (entry?.media_type === 'tv' ? 'tv' : 'movie') as 'movie' | 'tv',
        added_at: typeof entry?.added_at === 'string' ? entry.added_at : null,
      }))
      .filter((entry) => entry.tmdb_id.length > 0)
  }

  private async serializeWatchlist(profile: ConvexProfile) {
    const tmdb = new TmdbService()
    const entries = this.readWatchlist(profile)

    const items = await Promise.all(
      entries.map(async (entry) => {
        try {
          const meta =
            entry.media_type === 'tv'
              ? await tmdb.getTvShow(Number(entry.tmdb_id))
              : await tmdb.getMovie(Number(entry.tmdb_id))

          return {
            tmdb_id: entry.tmdb_id,
            media_type: entry.media_type,
            title: this.getMediaTitle(meta),
            poster_url: meta.poster_url ?? null,
            backdrop_url: meta.backdrop_url ?? null,
            added_at: entry.added_at ?? null,
          }
        } catch {
          return null
        }
      })
    )

    return items.filter((item): item is NonNullable<typeof item> => item !== null)
  }
}
