import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import { auth, toWebHeaders } from '#services/better_auth'
import { errors } from '@adonisjs/core'

export default class AuthMiddleware {
  async handle(ctx: HttpContext, next: NextFn) {
    // Support ?token= query param for media players that can't send Authorization headers
    const hasAuthHeader = Boolean(ctx.request.header('authorization'))
    const queryToken = ctx.request.input('token') as string | undefined
    const routePath = String(ctx.route?.pattern ?? '').replace(/^\/+/, '')
    const requestPath = ctx.request.url().replace(/^\/+/, '')

    const isPlaybackRoute =
      routePath.startsWith('api/stream/') ||
      routePath.startsWith('stream/') ||
      requestPath.startsWith('api/stream/') ||
      requestPath.startsWith('stream/') ||
      routePath.startsWith('api/transcode/audio') ||
      routePath.startsWith('transcode/audio') ||
      requestPath.startsWith('api/transcode/audio') ||
      requestPath.startsWith('transcode/audio')

    let tokenToVerify: string | undefined
    if (!hasAuthHeader && isPlaybackRoute && queryToken) {
      tokenToVerify = queryToken
    }

    const headers = toWebHeaders(ctx.request.headers())
    if (tokenToVerify && !hasAuthHeader) {
      headers.set('authorization', `Bearer ${tokenToVerify}`)
    }

    const session = await auth.api.getSession({ headers })
    if (!session) {
      throw new errors.E_HTTP_EXCEPTION('Unauthorized', { status: 401 })
    }

    ctx.betterAuthUser = session.user
    return next()
  }
}
