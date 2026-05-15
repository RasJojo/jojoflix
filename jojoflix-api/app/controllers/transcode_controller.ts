import type { HttpContext } from '@adonisjs/core/http'
import StreamRegistry from '#services/stream_registry'
import User from '#models/user'
import { Secret } from '@adonisjs/core/helpers'
import { spawn } from 'node:child_process'

interface AudioTrackInfoPayload {
  index: number
  stream_index: number
  language: string | null
  title: string | null
  codec: string
  channels: number
}

interface SubtitleTrackInfoPayload {
  index: number
  stream_index: number
  language: string | null
  title: string | null
  codec: string
  forced: boolean
  default: boolean
}

interface MediaInfoPayload {
  duration_seconds: number | null
  audio_tracks: AudioTrackInfoPayload[]
  subtitle_tracks: SubtitleTrackInfoPayload[]
}

export default class TranscodeController {
  private readonly registry: StreamRegistry

  constructor() {
    this.registry = new StreamRegistry()
  }

  /**
   * GET /api/transcode/info
   * Retourne la durée + les pistes audio/sous-titres d'un flux actif.
   */
  async info({ auth, request, response }: HttpContext) {
    const userId = await this.resolveUserId(auth, request)
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
  async tracks({ auth, request, response }: HttpContext) {
    const userId = await this.resolveUserId(auth, request)
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
  async subtitle({ auth, request, response }: HttpContext) {
    const userId = await this.resolveUserId(auth, request)
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

    const rawTrack = Number(request.input('track', -1))
    const trackIndex = Number.isFinite(rawTrack) ? Math.floor(rawTrack) : -1
    if (trackIndex < 0) {
      return response.badRequest({
        error: { code: 'INVALID_SUBTITLE_TRACK', message: 'track invalide', status: 400 },
      })
    }

    try {
      const vtt = await extractSubtitleTrackAsVtt(directUrl, trackIndex)
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
  async audio({ auth, request, response }: HttpContext) {
    const userId = await this.resolveUserId(auth, request)
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

    const trackIndex = Number(request.input('track', 0))

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

    ff.stdout.pipe(response.response)
    response.response.on('close', () => ff.kill('SIGKILL'))

    await new Promise<void>((resolve) => {
      ff.on('close', resolve)
      ff.on('error', resolve)
    })
  }

  private async resolveDirectUrl(
    userId: number,
    request: HttpContext['request']
  ): Promise<string | null> {
    const requestedStreamId = String(request.input('stream_id') ?? '').trim()
    return (
      (requestedStreamId && (await this.registry.getUrlByStream(userId, requestedStreamId))) ||
      (await this.registry.getActiveUrl(userId))
    )
  }

  private async resolveUserId(
    auth: HttpContext['auth'],
    request: HttpContext['request']
  ): Promise<number | null> {
    try {
      const user = auth.getUserOrFail() as User
      return user.id
    } catch {
      // fallback query token
    }

    const queryToken = request.input('token') as string | undefined
    if (!queryToken) return null

    const accessToken = await User.accessTokens.verify(new Secret(queryToken))
    if (!accessToken || accessToken.isExpired()) return null

    return Number(accessToken.tokenableId)
  }
}

async function probeMediaInfo(url: string): Promise<MediaInfoPayload> {
  const info = await runFfprobe(url)
  const streams = Array.isArray(info.streams) ? info.streams : []
  const formatDuration = Number(info.format?.duration)

  const audioTracks: AudioTrackInfoPayload[] = streams
    .filter((stream: any) => stream.codec_type === 'audio')
    .map((stream: any, index: number) => ({
      index,
      stream_index: Number(stream.index ?? index),
      language: stream.tags?.language ?? null,
      title: stream.tags?.title ?? null,
      codec: String(stream.codec_name ?? ''),
      channels: Number(stream.channels ?? 0),
    }))

  const subtitleTracks: SubtitleTrackInfoPayload[] = streams
    .filter((stream: any) => stream.codec_type === 'subtitle')
    .map((stream: any, index: number) => ({
      index,
      stream_index: Number(stream.index ?? index),
      language: stream.tags?.language ?? null,
      title: stream.tags?.title ?? null,
      codec: String(stream.codec_name ?? ''),
      forced: Boolean(stream.disposition?.forced),
      default: Boolean(stream.disposition?.default),
    }))

  return {
    duration_seconds:
      Number.isFinite(formatDuration) && formatDuration > 0
        ? formatDuration
        : extractFallbackDurationSeconds(streams),
    audio_tracks: audioTracks,
    subtitle_tracks: subtitleTracks,
  }
}

function extractFallbackDurationSeconds(streams: any[]): number | null {
  let best = 0
  for (const stream of streams) {
    const value = Number(stream?.duration)
    if (Number.isFinite(value) && value > best) {
      best = value
    }
  }
  return best > 0 ? best : null
}

async function extractSubtitleTrackAsVtt(url: string, trackIndex: number): Promise<string | null> {
  return await new Promise<string | null>((resolve, reject) => {
    const args = [
      '-nostdin',
      '-i',
      url,
      '-vn',
      '-an',
      '-map',
      `0:s:${trackIndex}?`,
      '-c:s',
      'webvtt',
      '-f',
      'webvtt',
      'pipe:1',
    ]
    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'ignore'] })
    let out = ''
    const timer = setTimeout(() => {
      proc.kill('SIGKILL')
      reject(new Error('subtitle export timeout'))
    }, 60_000)

    proc.stdout.on('data', (chunk: Buffer) => {
      if (out.length < 1_500_000) {
        out += chunk.toString()
      }
    })
    proc.on('close', (code) => {
      clearTimeout(timer)
      if ((code ?? 1) !== 0 || !out.trim()) {
        resolve(null)
        return
      }
      resolve(normalizeWebVtt(out))
    })
    proc.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
  })
}

function normalizeWebVtt(raw: string): string {
  const text = raw.replaceAll('\r\n', '\n').replaceAll('\r', '\n').replaceAll('\uFEFF', '')
  const trimmed = text.trimLeft()
  if (trimmed.toUpperCase().startsWith('WEBVTT')) {
    return trimmed
  }
  return `WEBVTT\n\n${trimmed}`
}

async function runFfprobe(url: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const args = [
      '-v',
      'quiet',
      '-print_format',
      'json',
      '-show_streams',
      '-show_format',
      '-analyzeduration',
      '2500000',
      '-probesize',
      '2500000',
      url,
    ]
    const proc = spawn('ffprobe', args)
    let out = ''
    const timer = setTimeout(() => {
      proc.kill('SIGKILL')
      reject(new Error('ffprobe timeout'))
    }, 8_000)
    proc.stdout.on('data', (d: Buffer) => (out += d.toString()))
    proc.on('close', (code) => {
      clearTimeout(timer)
      if (code !== 0 || !out) return reject(new Error('ffprobe failed'))
      try {
        resolve(JSON.parse(out))
      } catch {
        reject(new Error('ffprobe parse error'))
      }
    })
    proc.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
  })
}
