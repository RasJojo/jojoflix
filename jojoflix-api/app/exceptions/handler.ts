import app from '@adonisjs/core/services/app'
import { type HttpContext, ExceptionHandler, errors } from '@adonisjs/core/http'
import { errors as vineErrors } from '@vinejs/vine'

export default class HttpExceptionHandler extends ExceptionHandler {
  protected debug = !app.inProduction

  async handle(error: unknown, ctx: HttpContext) {
    // Validation errors (VineJS) → 422
    if (error instanceof vineErrors.E_VALIDATION_ERROR) {
      return ctx.response.status(422).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Les données fournies sont invalides',
          status: 422,
          details: error.messages,
        },
      })
    }

    // AdonisJS HTTP exceptions (404, 401, 403…)
    if (error instanceof errors.E_HTTP_EXCEPTION) {
      const codeMap: Record<number, string> = {
        401: 'AUTH_INVALID',
        403: 'FORBIDDEN',
        404: 'NOT_FOUND',
        409: 'CONFLICT',
        422: 'VALIDATION_ERROR',
        500: 'INTERNAL_ERROR',
      }
      const status = error.status ?? 500
      return ctx.response.status(status).json({
        error: {
          code: codeMap[status] ?? 'HTTP_ERROR',
          message: error.message,
          status,
        },
      })
    }

    // Unknown errors → 500
    if (error instanceof Error) {
      const status = 500
      return ctx.response.status(status).json({
        error: {
          code: 'INTERNAL_ERROR',
          message: app.inProduction ? 'Une erreur interne est survenue' : error.message,
          status,
        },
      })
    }

    return super.handle(error, ctx)
  }

  async report(error: unknown, ctx: HttpContext) {
    return super.report(error, ctx)
  }
}
