import type { HttpContext } from '@adonisjs/core/http'
import MonitoringService from '#services/monitoring_service'

export default class MonitoringController {
  private readonly monitoring = new MonitoringService()
  private readonly allowedEmails = new Set(
    String(process.env.MONITOR_ADMIN_EMAILS ?? '')
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean)
  )

  async overview({ auth, response }: HttpContext) {
    const user = auth.getUserOrFail()
    if (this.allowedEmails.size > 0 && !this.allowedEmails.has(String(user.email).toLowerCase())) {
      return response.forbidden({
        error: {
          code: 'MONITORING_FORBIDDEN',
          message: 'Ce compte ne peut pas accéder au dashboard',
          status: 403,
        },
      })
    }
    const snapshot = await this.monitoring.snapshot()
    return response.ok({ data: snapshot })
  }
}
