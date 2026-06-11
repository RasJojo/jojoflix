import { spawn } from 'node:child_process'

export interface AudioTrackInfoPayload {
  index: number
  stream_index: number
  language: string | null
  title: string | null
  codec: string
  channels: number
}

export interface SubtitleTrackInfoPayload {
  index: number
  stream_index: number
  language: string | null
  title: string | null
  codec: string
  forced: boolean
  default: boolean
}

export interface MediaInfoPayload {
  duration_seconds: number | null
  audio_tracks: AudioTrackInfoPayload[]
  subtitle_tracks: SubtitleTrackInfoPayload[]
}

const TEXT_SUBTITLE_CODECS = new Set([
  'ass',
  'eia_608',
  'microdvd',
  'mov_text',
  'mpl2',
  'srt',
  'ssa',
  'subrip',
  'text',
  'ttml',
  'webvtt',
])

export function isTextSubtitleCodec(codec: string | null | undefined): boolean {
  const normalized = String(codec ?? '')
    .trim()
    .toLowerCase()
  return normalized.length > 0 && TEXT_SUBTITLE_CODECS.has(normalized)
}

export async function probeMediaInfo(url: string): Promise<MediaInfoPayload> {
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

export async function extractSubtitleTrackAsVtt(
  url: string,
  trackIndex: number,
  signal?: AbortSignal
): Promise<string | null> {
  return await new Promise<string | null>((resolve, reject) => {
    const args = [
      '-nostdin',
      '-reconnect',
      '1',
      '-reconnect_streamed',
      '1',
      '-reconnect_delay_max',
      '5',
      '-analyzeduration',
      '2500000',
      '-probesize',
      '2500000',
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
    }, 150_000)

    if (signal) {
      signal.addEventListener('abort', () => {
        clearTimeout(timer)
        proc.kill('SIGKILL')
        resolve(null)
      }, { once: true })
    }

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
    // Drain stderr so the OS pipe buffer never fills and blocks the process.
    proc.stderr.resume()
    let out = ''
    // BUG #8 fix: guard against double-reject when the size-limit kill path fires.
    // The 'close' event always fires after kill(), so without this flag the promise
    // would reject twice — once from the data handler, once from the close handler.
    let rejected = false
    const MAX_PROBE_OUTPUT = 10_000_000 // 10 MB — guard against OOM on complex files
    const timer = setTimeout(() => {
      proc.kill('SIGKILL')
      reject(new Error('ffprobe timeout'))
    }, 8_000)
    proc.stdout.on('data', (d: Buffer) => {
      if (out.length >= MAX_PROBE_OUTPUT) {
        rejected = true
        clearTimeout(timer)
        proc.kill('SIGKILL')
        reject(new Error('ffprobe output exceeded size limit'))
        return
      }
      out += d.toString()
    })
    proc.on('close', (code) => {
      // BUG #8 fix: skip if already rejected via the size-limit branch above.
      if (rejected) return
      clearTimeout(timer)
      if (code !== 0 || !out) return reject(new Error('ffprobe failed'))
      try {
        resolve(JSON.parse(out))
      } catch {
        reject(new Error('ffprobe parse error'))
      }
    })
    proc.on('error', (error) => {
      if (rejected) return
      clearTimeout(timer)
      reject(error)
    })
  })
}
