import { auth } from '#services/better_auth'
import { signupValidator } from '#validators/user'
import type { HttpContext } from '@adonisjs/core/http'

export default class NewAccountController {
  async store({ request, response }: HttpContext) {
    const { fullName, email, password } = await request.validateUsing(signupValidator)

    const headers = new Headers({ 'content-type': 'application/json' })
    const webReq = new Request('http://localhost/api/auth/sign-up/email', {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: fullName ?? email.split('@')[0], email, password }),
    })

    const webRes = await auth.handler(webReq)

    if (!webRes.ok) {
      const body = await webRes.json().catch(() => ({}))
      const status = webRes.status === 422 ? 409 : webRes.status
      return response.status(status).json({
        error: { code: 'REGISTER_FAILED', message: (body as any).message ?? 'Inscription impossible', status },
      })
    }

    const data = (await webRes.json()) as { user: { id: string; name: string; email: string } }
    const token = webRes.headers.get('set-auth-token')

    return response.created({
      data: {
        user: { id: data.user.id, fullName: data.user.name, email: data.user.email },
        token,
      },
    })
  }
}
