import type { SessionUser } from '#services/better_auth'

declare module '@adonisjs/core/http' {
  interface HttpContext {
    betterAuthUser?: SessionUser
  }
}
