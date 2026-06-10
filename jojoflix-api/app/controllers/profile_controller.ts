import type { HttpContext } from '@adonisjs/core/http'

export default class ProfileController {
  async show({ betterAuthUser, response }: HttpContext) {
    if (!betterAuthUser) return response.unauthorized({ error: { code: 'AUTH_REQUIRED', status: 401 } })
    return response.ok({
      data: {
        id: betterAuthUser.id,
        fullName: betterAuthUser.name,
        email: betterAuthUser.email,
        initials: betterAuthUser.name
          ? betterAuthUser.name.split(' ').map((w: string) => w[0]).join('').toUpperCase().slice(0, 2)
          : betterAuthUser.email.slice(0, 2).toUpperCase(),
      },
    })
  }
}
