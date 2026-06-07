import type { HttpContext } from '@adonisjs/core/http'
import TmdbService from '#services/tmdb_service'
import ConvexRepository from '#services/convex_repository'

export default class MediaController {
  async show({ betterAuthUser, params, request, response }: HttpContext) {
    const user = betterAuthUser!
    const { mediaType, tmdbId } = params
    const tmdb = new TmdbService()

    let detail: any
    if (mediaType === 'movie') {
      detail = await tmdb.getMovieDetail(Number(tmdbId))
    } else if (mediaType === 'tv') {
      detail = await tmdb.getTvDetail(Number(tmdbId))
    } else {
      return response.badRequest({
        error: { code: 'INVALID_MEDIA_TYPE', message: 'mediaType doit être movie ou tv', status: 400 },
      })
    }

    if (mediaType === 'tv' && detail.seasons?.length > 0) {
      const profileIdHeader = request.header('x-profile-id')
      const profileId = profileIdHeader?.trim() || null

      if (profileId) {
        const repo = new ConvexRepository()
        const profile = await repo.getProfileOfUser(profileId, user.id)

        if (profile) {
          const histories = await repo.getWatchHistoriesByTmdb(profile._id, tmdbId, 'tv')

          const progressMap = new Map<string, number>()
          for (const h of histories) {
            const key = `${h.seasonNum}-${h.episodeNum}`
            const prog = h.totalDuration > 0 ? h.currentTime / h.totalDuration : 0
            progressMap.set(key, prog)
          }

          detail.seasons = detail.seasons.map((season: any) => ({
            ...season,
            episodes: season.episodes.map((ep: any) => ({
              ...ep,
              progress: progressMap.get(`${season.season_number}-${ep.episode_number}`) ?? null,
            })),
          }))
        }
      }
    }

    return response.ok({ data: detail })
  }

  async search({ request, response }: HttpContext) {
    const query = request.input('q', '').trim()

    if (query.length < 2) {
      return response.ok({ data: [] })
    }

    const tmdb = new TmdbService()
    const results = await tmdb.searchMulti(query)
    return response.ok({ data: results })
  }
}
