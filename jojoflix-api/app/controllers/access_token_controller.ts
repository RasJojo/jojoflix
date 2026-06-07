import { auth, toWebHeaders } from '#services/better_auth'
import StreamRegistry from '#services/stream_registry'
import { loginValidator } from '#validators/user'
import type { HttpContext } from '@adonisjs/core/http'

export default class AccessTokenController {
  async store({ request, response }: HttpContext) {
    const { email, password } = await request.validateUsing(loginValidator)

    const headers = new Headers({ 'content-type': 'application/json' })
    const webReq = new Request('http://localhost/api/auth/sign-in/email', {
      method: 'POST',
      headers,
      body: JSON.stringify({ email, password }),
    })

    const webRes = await auth.handler(webReq)

    if (!webRes.ok) {
      const body = await webRes.json().catch(() => ({}))
      return response.status(webRes.status).json({
        error: { code: 'AUTH_FAILED', message: (body as any).message ?? 'Email ou mot de passe invalide', status: webRes.status },
      })
    }

    const data = (await webRes.json()) as { user: { id: string; name: string; email: string } }
    const token = webRes.headers.get('set-auth-token')

    return response.ok({
      data: {
        user: { id: data.user.id, fullName: data.user.name, email: data.user.email },
        token,
      },
    })
  }

  async destroy({ betterAuthUser, request, response }: HttpContext) {
    if (!betterAuthUser) return response.unauthorized({ error: { code: 'AUTH_REQUIRED', status: 401 } })

    const registry = new StreamRegistry()
    await registry.clear(betterAuthUser.id)

    const headers = toWebHeaders(request.headers())
    const webReq = new Request('http://localhost/api/auth/sign-out', { method: 'POST', headers })
    await auth.handler(webReq)

    return response.ok({ data: { message: 'Déconnecté avec succès' } })
  }
}
