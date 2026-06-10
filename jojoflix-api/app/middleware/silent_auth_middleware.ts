import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import { auth, toWebHeaders } from '#services/better_auth'

export default class SilentAuthMiddleware {
  async handle(ctx: HttpContext, next: NextFn) {
    const headers = toWebHeaders(ctx.request.headers())
    const session = await auth.api.getSession({ headers }).catch(() => null)
    if (session) ctx.betterAuthUser = session.user
    return next()
  }
}
