import type { HttpContext } from '@adonisjs/core/http'
import Profile from '#models/profile'
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

  async index({ auth, params, response }: HttpContext) {
    const profile = await this.resolveProfile(auth.getUserOrFail().id, params.id)
    const items = await this.serializeWatchlist(profile)
    return response.ok({ data: items })
  }

  async store({ auth, params, request, response }: HttpContext) {
    const profile = await this.resolveProfile(auth.getUserOrFail().id, params.id)
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

    profile.preferences = {
      ...(profile.preferences ?? {}),
      watchlist: deduped.slice(0, 200),
    }
    await profile.save()

    return response.ok({ data: await this.serializeWatchlist(profile) })
  }

  async destroy({ auth, params, response }: HttpContext) {
    const profile = await this.resolveProfile(auth.getUserOrFail().id, params.id)
    const tmdbId = String(params.tmdbId ?? '').trim()
    const mediaType = params.mediaType === 'tv' ? 'tv' : params.mediaType === 'movie' ? 'movie' : null

    if (!tmdbId || !mediaType) {
      return response.badRequest({
        error: {
          code: 'INVALID_WATCHLIST_TARGET',
          message: 'Cible de watchlist invalide',
          status: 400,
        },
      })
    }

    const filtered = this.readWatchlist(profile).filter(
      (entry) => !(entry.tmdb_id === tmdbId && entry.media_type === mediaType)
    )
    profile.preferences = {
      ...(profile.preferences ?? {}),
      watchlist: filtered,
    }
    await profile.save()

    return response.ok({ data: await this.serializeWatchlist(profile) })
  }

  private async resolveProfile(userId: number, rawProfileId: string | number) {
    return Profile.query().where('id', rawProfileId).where('user_id', userId).firstOrFail()
  }

  private readWatchlist(profile: Profile): WatchlistEntry[] {
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

  private async serializeWatchlist(profile: Profile) {
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
