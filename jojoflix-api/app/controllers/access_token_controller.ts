import User from '#models/user'
import StreamRegistry from '#services/stream_registry'
import { loginValidator } from '#validators/user'
import type { HttpContext } from '@adonisjs/core/http'
import UserTransformer from '#transformers/user_transformer'

export default class AccessTokenController {
  async store({ request, serialize }: HttpContext) {
    const { email, password } = await request.validateUsing(loginValidator)

    const user = await User.verifyCredentials(email, password)
    const token = await User.accessTokens.create(user)

    return serialize({
      user: UserTransformer.transform(user),
      token: token.value!.release(),
    })
  }

  async destroy({ auth, response }: HttpContext) {
    const user = auth.getUserOrFail()

    // Couper le flux actif Redis AVANT de révoquer le token
    const registry = new StreamRegistry()
    await registry.clear(user.id)

    if (user.currentAccessToken) {
      await User.accessTokens.delete(user, user.currentAccessToken.identifier)
    }

    return response.ok({
      data: { message: 'Déconnecté avec succès' },
    })
  }
}
