import type { HttpContext } from '@adonisjs/core/http'
import ConvexRepository from '#services/convex_repository'
import RecommendationService from '#services/recommendation_service'
import vine from '@vinejs/vine'

const syncValidator = vine.create({
  profile_id: vine.string().optional(),
  tmdb_id: vine.string(),
  media_type: vine.enum(['movie', 'tv'] as const),
  season_num: vine.number().positive().optional(),
  episode_num: vine.number().positive().optional(),
  current_time: vine.number().min(0),
  total_duration: vine.number().min(0),
})

export default class ProgressController {
  async show({ betterAuthUser, params, request, response }: HttpContext) {
    const user = betterAuthUser!
    const { mediaType, tmdbId } = params
    const repo = new ConvexRepository()

    const profileIdRaw = request.header('x-profile-id')
    const profileId = profileIdRaw?.trim() || null

    if (!profileId) return response.ok({ data: null })

    const profile = await repo.getProfileOfUser(profileId, user.id)
    if (!profile) return response.ok({ data: null })

    const history = await repo.getWatchHistory(
      profile._id,
      tmdbId,
      mediaType as 'movie' | 'tv'
    )

    if (!history) return response.ok({ data: null })

    return response.ok({
      data: {
        current_time: history.currentTime,
        total_duration: history.totalDuration,
        progress: history.totalDuration > 0 ? history.currentTime / history.totalDuration : 0,
        season: history.seasonNum,
        episode: history.episodeNum,
      },
    })
  }

  async sync({ betterAuthUser, request, response }: HttpContext) {
    const user = betterAuthUser!
    const data = await request.validateUsing(syncValidator)
    const repo = new ConvexRepository()

    const profileIdHeader = request.header('x-profile-id')
    const profileIdRaw = data.profile_id ?? profileIdHeader?.trim() ?? null
    if (!profileIdRaw) {
      return response.badRequest({
        error: { code: 'MISSING_PROFILE', message: 'Profile ID manquant', status: 400 },
      })
    }

    const profile = await repo.getProfileOfUser(profileIdRaw, user.id)
    if (!profile) {
      return response.notFound({
        error: { code: 'PROFILE_NOT_FOUND', message: 'Profil introuvable', status: 404 },
      })
    }

    const isFinished = data.total_duration > 0 && data.current_time >= data.total_duration * 0.9

    const prevHistory = await repo.getWatchHistory(
      profile._id,
      data.tmdb_id,
      data.media_type,
      data.season_num ?? null,
      data.episode_num ?? null
    )
    const wasFinished = prevHistory?.isFinished ?? false

    const history = await repo.upsertWatchHistory({
      profileId: profile._id,
      tmdbId: data.tmdb_id,
      mediaType: data.media_type,
      seasonNum: data.season_num ?? null,
      episodeNum: data.episode_num ?? null,
      currentTime: data.current_time,
      totalDuration: data.total_duration,
      isFinished,
    })

    if (isFinished && !wasFinished) {
      const recommendation = new RecommendationService()
      recommendation
        .onContentFinished(profile._id, data.tmdb_id, data.media_type)
        .catch(() => {})
    }

    return response.ok({
      data: {
        id: history._id,
        is_finished: isFinished,
        current_time: data.current_time,
      },
    })
  }
}
