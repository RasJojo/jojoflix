import type { HttpContext } from '@adonisjs/core/http'
import Profile from '#models/profile'
import StreamRegistry from '#services/stream_registry'
import { createProfileValidator, updateProfileValidator } from '#validators/profile'

const MAX_PROFILES_PER_USER = 5

export default class ProfilesController {
  async index({ auth, response }: HttpContext) {
    const user = auth.getUserOrFail()
    const profiles = await Profile.query().where('user_id', user.id).orderBy('created_at', 'asc')

    return response.ok({
      data: profiles.map((p) => this.serialize(p)),
    })
  }

  async store({ auth, request, response }: HttpContext) {
    const user = auth.getUserOrFail()

    const existing = await Profile.query().where('user_id', user.id).count('* as total')
    const count = Number(existing[0].$extras.total)
    if (count >= MAX_PROFILES_PER_USER) {
      return response.conflict({
        error: {
          code: 'PROFILE_LIMIT_REACHED',
          message: `Maximum ${MAX_PROFILES_PER_USER} profils par compte`,
          status: 409,
        },
      })
    }

    const data = await request.validateUsing(createProfileValidator)
    const profile = await Profile.create({
      userId: user.id,
      name: data.name,
      avatarUrl: data.avatar_url ?? null,
      isKids: data.is_kids ?? false,
      preferences: {},
    })

    return response.created({ data: this.serialize(profile) })
  }

  async update({ auth, params, request, response }: HttpContext) {
    const user = auth.getUserOrFail()
    const profile = await Profile.query()
      .where('id', params.id)
      .where('user_id', user.id)
      .firstOrFail()

    const data = await request.validateUsing(updateProfileValidator)

    profile.merge({
      name: data.name ?? profile.name,
      avatarUrl: data.avatar_url !== undefined ? (data.avatar_url ?? null) : profile.avatarUrl,
      isKids: data.is_kids ?? profile.isKids,
      preferences: data.preferences
        ? { ...profile.preferences, ...data.preferences }
        : profile.preferences,
    })
    await profile.save()

    return response.ok({ data: this.serialize(profile) })
  }

  async destroy({ auth, params, response }: HttpContext) {
    const user = auth.getUserOrFail()
    const profiles = await Profile.query().where('user_id', user.id)

    if (profiles.length <= 1) {
      return response.conflict({
        error: {
          code: 'LAST_PROFILE',
          message: 'Impossible de supprimer le dernier profil',
          status: 409,
        },
      })
    }

    const profile = profiles.find((p) => p.id === Number(params.id))
    if (!profile) {
      return response.forbidden({
        error: { code: 'FORBIDDEN', message: 'Profil introuvable', status: 403 },
      })
    }

    await profile.delete()
    return response.ok({ data: { message: 'Profil supprimé' } })
  }

  async select({ auth, params, response }: HttpContext) {
    const user = auth.getUserOrFail()
    const profile = await Profile.query()
      .where('id', params.id)
      .where('user_id', user.id)
      .firstOrFail()

    // Couper tout flux actif précédent lors du switch de profil
    const registry = new StreamRegistry()
    await registry.clear(user.id)

    return response.ok({
      data: {
        profile_id: profile.id,
        name: profile.name,
        is_kids: profile.isKids,
        preferences: profile.preferences,
      },
    })
  }

  private serialize(profile: Profile) {
    return {
      id: profile.id,
      name: profile.name,
      avatar_url: profile.avatarUrl,
      is_kids: profile.isKids,
      preferences: profile.preferences,
      created_at: profile.createdAt,
    }
  }
}
