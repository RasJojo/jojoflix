import type { HttpContext } from '@adonisjs/core/http'
import env from '#start/env'
import got from 'got'

type CheckState = 'ok' | 'degraded' | 'skipped'

export default class HealthController {
  async deep({ response }: HttpContext) {
    const flaresolverr = await this.checkHttpService(env.get('FLARESOLVERR_URL'), 'flaresolverr')
    const status: CheckState = flaresolverr.status === 'degraded' ? 'degraded' : 'ok'

    return response.ok({
      status,
      service: 'jojoflix-api',
      uptime_seconds: Math.round(process.uptime()),
      memory_mb: Math.round(process.memoryUsage().rss / 1024 / 1024),
      providers: {
        convex: this.configured(env.get('CONVEX_URL')) && this.configuredSecret('CONVEX_ADMIN_KEY'),
        tmdb: this.configuredSecret('TMDB_API_KEY'),
        real_debrid: this.configuredSecret('RD_API_KEY'),
        opensubtitles: this.configuredSecret('OPENSUBS_API_KEY'),
        subdl: this.configured(env.get('SUBDL_API_KEY')),
        subsource: this.configured(env.get('SUBSOURCE_API_KEY')),
        torrentio: this.configured(env.get('TORRENTIO_URL')),
        torrentio_proxy: this.configured(env.get('TORRENTIO_PROXY')),
        mediafusion: this.configured(env.get('MEDIAFUSION_URL')),
        dramayo: this.configured(env.get('DRAMAYO_URL')),
        flaresolverr: flaresolverr.configured,
      },
      checks: {
        flaresolverr,
      },
    })
  }

  private configured(value?: string | null): boolean {
    return typeof value === 'string' && value.trim().length > 0
  }

  private configuredSecret(
    key: 'CONVEX_ADMIN_KEY' | 'TMDB_API_KEY' | 'RD_API_KEY' | 'OPENSUBS_API_KEY'
  ): boolean {
    return env.get(key).release().trim().length > 0
  }

  private async checkHttpService(url: string | undefined, name: string) {
    if (!this.configured(url)) {
      return { name, configured: false, status: 'skipped' as CheckState }
    }

    try {
      const result = await got.get(url!, {
        retry: { limit: 0 },
        timeout: { request: 2_500 },
        throwHttpErrors: false,
      })
      return {
        name,
        configured: true,
        status: result.statusCode < 500 ? ('ok' as CheckState) : ('degraded' as CheckState),
        http_status: result.statusCode,
      }
    } catch (error) {
      return {
        name,
        configured: true,
        status: 'degraded' as CheckState,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }
}
