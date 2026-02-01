import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import type { Authenticators } from '@adonisjs/auth/types'

/**
 * Auth middleware is used authenticate HTTP requests and deny
 * access to unauthenticated users.
 */
export default class AuthMiddleware {
  async handle(
    ctx: HttpContext,
    next: NextFn,
    options: {
      guards?: (keyof Authenticators)[]
    } = {}
  ) {
    // media_kit web ne supporte pas toujours les headers custom sur les URLs médias.
    // On accepte donc ?token=... uniquement pour les routes de lecture.
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

    if (!hasAuthHeader && isPlaybackRoute && queryToken) {
      ctx.request.request.headers.authorization = `Bearer ${queryToken}`
    }

    await ctx.auth.authenticateUsing(options.guards)
    return next()
  }
}
