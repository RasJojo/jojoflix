import type { HttpContext } from '@adonisjs/core/http'
import ConvexRepository, { type ConvexProfile } from '#services/convex_repository'
import StreamRegistry from '#services/stream_registry'
import { createProfileValidator, updateProfileValidator } from '#validators/profile'

const MAX_PROFILES_PER_USER = 5

export default class ProfilesController {
  async index({ betterAuthUser, response }: HttpContext) {
    const user = betterAuthUser!
    const repo = new ConvexRepository()
    const profiles = await repo.getProfilesByUser(user.id)
    profiles.sort((a, b) => a.createdAtMs - b.createdAtMs)
    return response.ok({ data: profiles.map((p) => this.serialize(p)) })
  }

  async store({ betterAuthUser, request, response }: HttpContext) {
    const user = betterAuthUser!
    const repo = new ConvexRepository()

    const count = await repo.countProfilesByUser(user.id)
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
    const profile = await repo.createProfile({
      userId: user.id,
      name: data.name,
      avatarUrl: data.avatar_url ?? null,
      isKids: data.is_kids ?? false,
      preferences: {},
    })

    return response.created({ data: this.serialize(profile) })
  }

  async update({ betterAuthUser, params, request, response }: HttpContext) {
    const user = betterAuthUser!
    const repo = new ConvexRepository()
    const profile = await repo.getProfileOfUser(params.id, user.id)

    if (!profile) {
      return response.forbidden({
        error: { code: 'FORBIDDEN', message: 'Profil introuvable', status: 403 },
      })
    }

    const data = await request.validateUsing(updateProfileValidator)
    const updated = await repo.updateProfile(profile._id, {
      name: data.name ?? undefined,
      avatarUrl: data.avatar_url !== undefined ? (data.avatar_url ?? null) : undefined,
      isKids: data.is_kids ?? undefined,
      preferences: data.preferences
        ? { ...profile.preferences, ...data.preferences }
        : undefined,
    })

    return response.ok({ data: this.serialize(updated) })
  }

  async destroy({ betterAuthUser, params, response }: HttpContext) {
    const user = betterAuthUser!
    const repo = new ConvexRepository()
    const profiles = await repo.getProfilesByUser(user.id)

    if (profiles.length <= 1) {
      return response.conflict({
        error: {
          code: 'LAST_PROFILE',
          message: 'Impossible de supprimer le dernier profil',
          status: 409,
        },
      })
    }

    const profile = profiles.find((p) => p._id === params.id)
    if (!profile) {
      return response.forbidden({
        error: { code: 'FORBIDDEN', message: 'Profil introuvable', status: 403 },
      })
    }

    await repo.deleteProfile(profile._id)
    return response.ok({ data: { message: 'Profil supprimé' } })
  }

  async select({ betterAuthUser, params, response }: HttpContext) {
    const user = betterAuthUser!
    const repo = new ConvexRepository()
    const profile = await repo.getProfileOfUser(params.id, user.id)

    if (!profile) {
      return response.notFound({
        error: { code: 'NOT_FOUND', message: 'Profil introuvable', status: 404 },
      })
    }

    const registry = new StreamRegistry()
    await registry.clear(user.id)

    return response.ok({
      data: {
        profile_id: profile._id,
        name: profile.name,
        is_kids: profile.isKids,
        preferences: profile.preferences,
      },
    })
  }

  private serialize(profile: ConvexProfile) {
    return {
      id: profile._id,
      name: profile.name,
      avatar_url: profile.avatarUrl ?? null,
      is_kids: profile.isKids,
      preferences: profile.preferences,
      created_at: new Date(profile.createdAtMs).toISOString(),
    }
  }
}
