import type { HttpContext } from '@adonisjs/core/http'
import StreamRegistry from '#services/stream_registry'
import ffmpegLimiter from '#services/ffmpeg_limiter'
import { auth as betterAuth } from '#services/better_auth'
import { extractSubtitleTrackAsVtt, probeMediaInfo } from '#services/media_probe_service'
import { spawn } from 'node:child_process'

export default class TranscodeController {
  private readonly registry: StreamRegistry

  constructor() {
    this.registry = new StreamRegistry()
  }

  /**
   * GET /api/transcode/info
   * Retourne la durée + les pistes audio/sous-titres d'un flux actif.
   */
  async info(ctx: HttpContext) {
    const { request, response } = ctx
    const userId = await this.resolveUserId(ctx)
    if (!userId) {
      return response.unauthorized({
        error: { code: 'AUTH_INVALID', message: 'Non authentifié', status: 401 },
      })
    }

    const directUrl = await this.resolveDirectUrl(userId, request)
    if (!directUrl) {
      return response.notFound({
        error: { code: 'NO_ACTIVE_STREAM', message: 'Aucun flux actif', status: 404 },
      })
    }

    try {
      const info = await probeMediaInfo(directUrl)
      return response.ok({ data: info })
    } catch {
      return response.internalServerError({
        error: { code: 'FFPROBE_ERROR', message: 'FFprobe indisponible', status: 500 },
      })
    }
  }

  /**
   * GET /api/transcode/tracks
   * Compat historique: retourne uniquement la liste audio.
   */
  async tracks(ctx: HttpContext) {
    const { request, response } = ctx
    const userId = await this.resolveUserId(ctx)
    if (!userId) {
      return response.unauthorized({
        error: { code: 'AUTH_INVALID', message: 'Non authentifié', status: 401 },
      })
    }

    const directUrl = await this.resolveDirectUrl(userId, request)
    if (!directUrl) {
      return response.notFound({
        error: { code: 'NO_ACTIVE_STREAM', message: 'Aucun flux actif', status: 404 },
      })
    }

    try {
      const info = await probeMediaInfo(directUrl)
      return response.ok({ data: info.audio_tracks })
    } catch {
      return response.internalServerError({
        error: { code: 'FFPROBE_ERROR', message: 'FFprobe indisponible', status: 500 },
      })
    }
  }

  /**
   * GET /api/transcode/subtitle?track=0
   * Exporte une piste de sous-titres intégrée en WebVTT pour le web player.
   */
  async subtitle(ctx: HttpContext) {
    const { request, response } = ctx
    const userId = await this.resolveUserId(ctx)
    if (!userId) {
      return response.unauthorized({
        error: { code: 'AUTH_INVALID', message: 'Non authentifié', status: 401 },
      })
    }

    const directUrl = await this.resolveDirectUrl(userId, request)
    if (!directUrl) {
      return response.notFound({
        error: { code: 'NO_ACTIVE_STREAM', message: 'Aucun flux actif', status: 404 },
      })
    }

    const MAX_SUBTITLE_TRACK_INDEX = 100
    const rawTrack = Number(request.input('track', -1))
    const trackIndex = Number.isFinite(rawTrack) ? Math.floor(rawTrack) : -1
    if (trackIndex < 0 || trackIndex > MAX_SUBTITLE_TRACK_INDEX) {
      return response.badRequest({
        error: { code: 'INVALID_SUBTITLE_TRACK', message: 'track invalide', status: 400 },
      })
    }

    const abortController = new AbortController()
    response.response.once('close', () => abortController.abort())

    try {
      const vtt = await extractSubtitleTrackAsVtt(directUrl, trackIndex, abortController.signal)
      if (!vtt) {
        return response.notFound({
          error: {
            code: 'SUBTITLE_TRACK_UNAVAILABLE',
            message: 'Piste de sous-titres indisponible',
            status: 404,
          },
        })
      }

      response.response.setHeader('Content-Type', 'text/vtt; charset=utf-8')
      response.response.setHeader('Cache-Control', 'no-cache')
      response.response.setHeader('Access-Control-Allow-Origin', '*')
      return response.send(vtt)
    } catch {
      return response.internalServerError({
        error: {
          code: 'SUBTITLE_EXPORT_FAILED',
          message: 'Impossible d’exporter ce sous-titre',
          status: 500,
        },
      })
    }
  }

  /**
   * GET /api/transcode/audio?track=0
   * Streame la vidéo avec la piste audio sélectionnée via FFmpeg.
   * Retranscode l'audio en AAC, copie la vidéo (pas de re-encode).
   */
  async audio(ctx: HttpContext) {
    const { request, response } = ctx
    const userId = await this.resolveUserId(ctx)
    if (!userId) {
      return response.unauthorized({
        error: { code: 'AUTH_INVALID', message: 'Non authentifié', status: 401 },
      })
    }

    const directUrl = await this.resolveDirectUrl(userId, request)
    if (!directUrl) {
      return response.notFound({
        error: { code: 'NO_ACTIVE_STREAM', message: 'Aucun flux actif', status: 404 },
      })
    }

    if (!ffmpegLimiter.acquire()) {
      return response.serviceUnavailable({
        error: { code: 'TRANSCODE_BUSY', message: 'Trop de transcodes en cours', status: 503 },
      })
    }

    const MAX_TRACK_INDEX = 100
    const rawTrackAudio = Number(request.input('track', 0))
    const trackIndex = Number.isFinite(rawTrackAudio) ? Math.floor(rawTrackAudio) : 0
    if (trackIndex < 0 || trackIndex > MAX_TRACK_INDEX) {
      ffmpegLimiter.release()
      return response.badRequest({
        error: { code: 'INVALID_TRACK', message: 'Indice de piste audio invalide', status: 400 },
      })
    }

    response.response.setHeader('Content-Type', 'video/mp4')
    response.response.setHeader('Transfer-Encoding', 'chunked')
    response.response.setHeader('Cache-Control', 'no-cache')
    response.response.setHeader('Access-Control-Allow-Origin', '*')

    const ffmpegArgs = [
      '-nostdin',
      '-analyzeduration',
      '1500000',
      '-probesize',
      '1500000',
      '-fflags',
      '+nobuffer',
      '-i',
      directUrl,
      '-map',
      '0:v:0',
      '-map',
      `0:a:${trackIndex}?`,
      '-c:v',
      'copy',
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      '-movflags',
      'frag_keyframe+empty_moov+faststart',
      '-f',
      'mp4',
      'pipe:1',
    ]

    const ff = spawn('ffmpeg', ffmpegArgs, { stdio: ['ignore', 'pipe', 'ignore'] })

    // BUG #1 fix: hard 4-hour deadline ensures the limiter slot is always released
    // even when the upstream TCP connection dies silently without a clean close.
    const killTimer = setTimeout(() => ff.kill('SIGKILL'), 4 * 60 * 60 * 1000)

    try {
      response.response.on('close', () => ff.kill('SIGKILL'))
      ff.stdout.pipe(response.response)

      await new Promise<void>((resolve) => {
        ff.on('close', (code) => {
          // BUG #2 fix: if ffmpeg exits non-zero and headers haven't been sent yet,
          // send a 502 error to prevent silent corrupt data from reaching the client.
          if (code !== 0 && !response.response.headersSent) {
            response.response.writeHead(502, { 'Content-Type': 'application/json' })
            response.response.end(JSON.stringify({
              error: { code: 'TRANSCODE_FAILED', message: 'FFmpeg a échoué', status: 502 },
            }))
          }
          resolve()
        })
        ff.on('error', resolve)
      })
    } finally {
      clearTimeout(killTimer)
      ffmpegLimiter.release()
    }
  }

  private async resolveDirectUrl(
    userId: string,
    request: HttpContext['request']
  ): Promise<string | null> {
    const requestedStreamId = String(request.input('stream_id') ?? '').trim()
    return (
      (requestedStreamId && (await this.registry.getUrlByStream(userId, requestedStreamId))) ||
      (await this.registry.getActiveUrl(userId))
    )
  }

  private async resolveUserId(ctx: HttpContext): Promise<string | null> {
    if (ctx.betterAuthUser) return ctx.betterAuthUser.id

    const queryToken = ctx.request.input('token') as string | undefined
    if (!queryToken) return null

    const session = await betterAuth.api
      .getSession({ headers: new Headers({ authorization: `Bearer ${queryToken}` }) })
      .catch(() => null)
    return session?.user.id ?? null
  }
}
