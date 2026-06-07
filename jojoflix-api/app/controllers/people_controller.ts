import type { HttpContext } from '@adonisjs/core/http'
import TmdbService from '#services/tmdb_service'

export default class PeopleController {
  async show({ params, response }: HttpContext) {
    const personId = Number(params.personId)
    if (!Number.isFinite(personId) || personId <= 0) {
      return response.badRequest({
        error: { code: 'INVALID_PERSON_ID', message: 'Person ID invalide', status: 400 },
      })
    }

    const tmdb = new TmdbService()
    const detail = await tmdb.getPersonDetail(personId)
    return response.ok({ data: detail })
  }
}
