import type { HttpContext } from '@adonisjs/core/http'
import WatchHistory from '#models/watch_history'
import RecommendationService from '#services/recommendation_service'
import Profile from '#models/profile'
import vine from '@vinejs/vine'

const syncValidator = vine.create({
  profile_id: vine.number().min(1).optional(),
  tmdb_id: vine.string(),
  media_type: vine.enum(['movie', 'tv'] as const),
  season_num: vine.number().positive().optional(),
  episode_num: vine.number().positive().optional(),
  current_time: vine.number().min(0),
  total_duration: vine.number().min(0),
})

export default class ProgressController {
  async show({ auth, params, request, response }: HttpContext) {
    const user = auth.getUserOrFail()
    const { mediaType, tmdbId } = params
    const profileIdHeader = request.header('x-profile-id')
    const profileId = profileIdHeader ? Number(profileIdHeader) : null

    if (!profileId) {
      return response.ok({ data: null })
    }

    const profile = await Profile.query()
      .where('id', profileId)
      .where('user_id', user.id)
      .first()

    if (!profile) {
      return response.ok({ data: null })
    }

    // Pour les films, une seule entrée. Pour les séries, on prend la dernière.
    const history = await WatchHistory.query()
      .where('profile_id', profile.id)
      .where('tmdb_id', tmdbId)
      .where('media_type', mediaType)
      .where('is_finished', false)
      .orderBy('updated_at', 'desc')
      .first()

    if (!history) {
      return response.ok({ data: null })
    }

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

  async sync({ auth, request, response }: HttpContext) {
    const user = auth.getUserOrFail()
    const data = await request.validateUsing(syncValidator)

    // Lire le profileId depuis le body ou le header X-Profile-Id en fallback
    const profileIdHeader = request.header('x-profile-id')
    const profileIdRaw = data.profile_id ?? (profileIdHeader ? Number(profileIdHeader) : null)
    if (!profileIdRaw) {
      return response.badRequest({ error: { code: 'MISSING_PROFILE', message: 'Profile ID manquant', status: 400 } })
    }

    // Vérifier que le profil appartient à l'utilisateur
    const profile = await Profile.query()
      .where('id', profileIdRaw)
      .where('user_id', user.id)
      .firstOrFail()
    // Remplacer data.profile_id par profileIdRaw dans les requêtes suivantes

    const isFinished = data.total_duration > 0 && data.current_time >= data.total_duration * 0.9

    // Upsert watch_history
    const existing = await WatchHistory.query()
      .where('profile_id', profile.id)
      .where('tmdb_id', data.tmdb_id)
      .where('media_type', data.media_type)
      .where((q) => {
        if (data.season_num != null) q.where('season_num', data.season_num)
        else q.whereNull('season_num')
      })
      .where((q) => {
        if (data.episode_num != null) q.where('episode_num', data.episode_num)
        else q.whereNull('episode_num')
      })
      .first()

    let history: WatchHistory
    if (existing) {
      existing.merge({
        currentTime: data.current_time,
        totalDuration: data.total_duration,
        isFinished,
      })
      await existing.save()
      history = existing
    } else {
      history = await WatchHistory.create({
        profileId: profile.id,
        tmdbId: data.tmdb_id,
        mediaType: data.media_type,
        seasonNum: data.season_num ?? null,
        episodeNum: data.episode_num ?? null,
        currentTime: data.current_time,
        totalDuration: data.total_duration,
        isFinished,
      })
    }

    // Si le contenu vient d'être terminé → mettre à jour le moteur de recommandation
    if (isFinished && !existing?.isFinished) {
      const recommendation = new RecommendationService()
      // Fire-and-forget : ne pas bloquer la réponse
      recommendation
        .onContentFinished(profile.id, data.tmdb_id, data.media_type)
        .catch(() => {}) // silencieux
    }

    return response.ok({
      data: {
        id: history.id,
        is_finished: isFinished,
        current_time: data.current_time,
      },
    })
  }
}
