/* eslint-disable prettier/prettier */
import type { AdonisEndpoint } from '@tuyau/core/types'
import type { Registry } from './schema.d.ts'
import type { ApiDefinition } from './tree.d.ts'

const placeholder: any = {}

const routes = {
  'new_account.store': {
    methods: ["POST"],
    pattern: '/api/auth/register',
    tokens: [{"old":"/api/auth/register","type":0,"val":"api","end":""},{"old":"/api/auth/register","type":0,"val":"auth","end":""},{"old":"/api/auth/register","type":0,"val":"register","end":""}],
    types: placeholder as Registry['new_account.store']['types'],
  },
  'access_token.store': {
    methods: ["POST"],
    pattern: '/api/auth/login',
    tokens: [{"old":"/api/auth/login","type":0,"val":"api","end":""},{"old":"/api/auth/login","type":0,"val":"auth","end":""},{"old":"/api/auth/login","type":0,"val":"login","end":""}],
    types: placeholder as Registry['access_token.store']['types'],
  },
  'access_token.destroy': {
    methods: ["POST"],
    pattern: '/api/auth/logout',
    tokens: [{"old":"/api/auth/logout","type":0,"val":"api","end":""},{"old":"/api/auth/logout","type":0,"val":"auth","end":""},{"old":"/api/auth/logout","type":0,"val":"logout","end":""}],
    types: placeholder as Registry['access_token.destroy']['types'],
  },
  'profiles.index': {
    methods: ["GET","HEAD"],
    pattern: '/api/profiles',
    tokens: [{"old":"/api/profiles","type":0,"val":"api","end":""},{"old":"/api/profiles","type":0,"val":"profiles","end":""}],
    types: placeholder as Registry['profiles.index']['types'],
  },
  'profiles.store': {
    methods: ["POST"],
    pattern: '/api/profiles',
    tokens: [{"old":"/api/profiles","type":0,"val":"api","end":""},{"old":"/api/profiles","type":0,"val":"profiles","end":""}],
    types: placeholder as Registry['profiles.store']['types'],
  },
  'profiles.update': {
    methods: ["PUT"],
    pattern: '/api/profiles/:id',
    tokens: [{"old":"/api/profiles/:id","type":0,"val":"api","end":""},{"old":"/api/profiles/:id","type":0,"val":"profiles","end":""},{"old":"/api/profiles/:id","type":1,"val":"id","end":""}],
    types: placeholder as Registry['profiles.update']['types'],
  },
  'profiles.destroy': {
    methods: ["DELETE"],
    pattern: '/api/profiles/:id',
    tokens: [{"old":"/api/profiles/:id","type":0,"val":"api","end":""},{"old":"/api/profiles/:id","type":0,"val":"profiles","end":""},{"old":"/api/profiles/:id","type":1,"val":"id","end":""}],
    types: placeholder as Registry['profiles.destroy']['types'],
  },
  'profiles.select': {
    methods: ["POST"],
    pattern: '/api/profiles/:id/select',
    tokens: [{"old":"/api/profiles/:id/select","type":0,"val":"api","end":""},{"old":"/api/profiles/:id/select","type":0,"val":"profiles","end":""},{"old":"/api/profiles/:id/select","type":1,"val":"id","end":""},{"old":"/api/profiles/:id/select","type":0,"val":"select","end":""}],
    types: placeholder as Registry['profiles.select']['types'],
  },
  'home.show': {
    methods: ["GET","HEAD"],
    pattern: '/api/home/:profile_id',
    tokens: [{"old":"/api/home/:profile_id","type":0,"val":"api","end":""},{"old":"/api/home/:profile_id","type":0,"val":"home","end":""},{"old":"/api/home/:profile_id","type":1,"val":"profile_id","end":""}],
    types: placeholder as Registry['home.show']['types'],
  },
  'streaming.movie_sources': {
    methods: ["GET","HEAD"],
    pattern: '/api/sources/movie/:tmdb_id',
    tokens: [{"old":"/api/sources/movie/:tmdb_id","type":0,"val":"api","end":""},{"old":"/api/sources/movie/:tmdb_id","type":0,"val":"sources","end":""},{"old":"/api/sources/movie/:tmdb_id","type":0,"val":"movie","end":""},{"old":"/api/sources/movie/:tmdb_id","type":1,"val":"tmdb_id","end":""}],
    types: placeholder as Registry['streaming.movie_sources']['types'],
  },
  'streaming.tv_sources': {
    methods: ["GET","HEAD"],
    pattern: '/api/sources/tv/:tmdb_id/s/:season/e/:episode',
    tokens: [{"old":"/api/sources/tv/:tmdb_id/s/:season/e/:episode","type":0,"val":"api","end":""},{"old":"/api/sources/tv/:tmdb_id/s/:season/e/:episode","type":0,"val":"sources","end":""},{"old":"/api/sources/tv/:tmdb_id/s/:season/e/:episode","type":0,"val":"tv","end":""},{"old":"/api/sources/tv/:tmdb_id/s/:season/e/:episode","type":1,"val":"tmdb_id","end":""},{"old":"/api/sources/tv/:tmdb_id/s/:season/e/:episode","type":0,"val":"s","end":""},{"old":"/api/sources/tv/:tmdb_id/s/:season/e/:episode","type":1,"val":"season","end":""},{"old":"/api/sources/tv/:tmdb_id/s/:season/e/:episode","type":0,"val":"e","end":""},{"old":"/api/sources/tv/:tmdb_id/s/:season/e/:episode","type":1,"val":"episode","end":""}],
    types: placeholder as Registry['streaming.tv_sources']['types'],
  },
  'streaming.prewarm_tv_episode': {
    methods: ["GET","HEAD"],
    pattern: '/api/stream/prewarm/tv/:tmdb_id/s/:season/e/:episode',
    tokens: [{"old":"/api/stream/prewarm/tv/:tmdb_id/s/:season/e/:episode","type":0,"val":"api","end":""},{"old":"/api/stream/prewarm/tv/:tmdb_id/s/:season/e/:episode","type":0,"val":"stream","end":""},{"old":"/api/stream/prewarm/tv/:tmdb_id/s/:season/e/:episode","type":0,"val":"prewarm","end":""},{"old":"/api/stream/prewarm/tv/:tmdb_id/s/:season/e/:episode","type":0,"val":"tv","end":""},{"old":"/api/stream/prewarm/tv/:tmdb_id/s/:season/e/:episode","type":1,"val":"tmdb_id","end":""},{"old":"/api/stream/prewarm/tv/:tmdb_id/s/:season/e/:episode","type":0,"val":"s","end":""},{"old":"/api/stream/prewarm/tv/:tmdb_id/s/:season/e/:episode","type":1,"val":"season","end":""},{"old":"/api/stream/prewarm/tv/:tmdb_id/s/:season/e/:episode","type":0,"val":"e","end":""},{"old":"/api/stream/prewarm/tv/:tmdb_id/s/:season/e/:episode","type":1,"val":"episode","end":""}],
    types: placeholder as Registry['streaming.prewarm_tv_episode']['types'],
  },
  'streaming.movie': {
    methods: ["GET","HEAD"],
    pattern: '/api/stream/movie/:tmdb_id',
    tokens: [{"old":"/api/stream/movie/:tmdb_id","type":0,"val":"api","end":""},{"old":"/api/stream/movie/:tmdb_id","type":0,"val":"stream","end":""},{"old":"/api/stream/movie/:tmdb_id","type":0,"val":"movie","end":""},{"old":"/api/stream/movie/:tmdb_id","type":1,"val":"tmdb_id","end":""}],
    types: placeholder as Registry['streaming.movie']['types'],
  },
  'streaming.tv_episode': {
    methods: ["GET","HEAD"],
    pattern: '/api/stream/tv/:tmdb_id/s/:season/e/:episode',
    tokens: [{"old":"/api/stream/tv/:tmdb_id/s/:season/e/:episode","type":0,"val":"api","end":""},{"old":"/api/stream/tv/:tmdb_id/s/:season/e/:episode","type":0,"val":"stream","end":""},{"old":"/api/stream/tv/:tmdb_id/s/:season/e/:episode","type":0,"val":"tv","end":""},{"old":"/api/stream/tv/:tmdb_id/s/:season/e/:episode","type":1,"val":"tmdb_id","end":""},{"old":"/api/stream/tv/:tmdb_id/s/:season/e/:episode","type":0,"val":"s","end":""},{"old":"/api/stream/tv/:tmdb_id/s/:season/e/:episode","type":1,"val":"season","end":""},{"old":"/api/stream/tv/:tmdb_id/s/:season/e/:episode","type":0,"val":"e","end":""},{"old":"/api/stream/tv/:tmdb_id/s/:season/e/:episode","type":1,"val":"episode","end":""}],
    types: placeholder as Registry['streaming.tv_episode']['types'],
  },
  'subtitles.list': {
    methods: ["GET","HEAD"],
    pattern: '/api/subtitles/list/:tmdb_id',
    tokens: [{"old":"/api/subtitles/list/:tmdb_id","type":0,"val":"api","end":""},{"old":"/api/subtitles/list/:tmdb_id","type":0,"val":"subtitles","end":""},{"old":"/api/subtitles/list/:tmdb_id","type":0,"val":"list","end":""},{"old":"/api/subtitles/list/:tmdb_id","type":1,"val":"tmdb_id","end":""}],
    types: placeholder as Registry['subtitles.list']['types'],
  },
  'subtitles.download': {
    methods: ["POST"],
    pattern: '/api/subtitles/download',
    tokens: [{"old":"/api/subtitles/download","type":0,"val":"api","end":""},{"old":"/api/subtitles/download","type":0,"val":"subtitles","end":""},{"old":"/api/subtitles/download","type":0,"val":"download","end":""}],
    types: placeholder as Registry['subtitles.download']['types'],
  },
  'subtitles.serve_vtt': {
    methods: ["GET","HEAD"],
    pattern: '/api/subtitles/vtt/:id',
    tokens: [{"old":"/api/subtitles/vtt/:id","type":0,"val":"api","end":""},{"old":"/api/subtitles/vtt/:id","type":0,"val":"subtitles","end":""},{"old":"/api/subtitles/vtt/:id","type":0,"val":"vtt","end":""},{"old":"/api/subtitles/vtt/:id","type":1,"val":"id","end":""}],
    types: placeholder as Registry['subtitles.serve_vtt']['types'],
  },
  'subtitles.markers': {
    methods: ["GET","HEAD"],
    pattern: '/api/subtitles/markers/:tmdb_id',
    tokens: [{"old":"/api/subtitles/markers/:tmdb_id","type":0,"val":"api","end":""},{"old":"/api/subtitles/markers/:tmdb_id","type":0,"val":"subtitles","end":""},{"old":"/api/subtitles/markers/:tmdb_id","type":0,"val":"markers","end":""},{"old":"/api/subtitles/markers/:tmdb_id","type":1,"val":"tmdb_id","end":""}],
    types: placeholder as Registry['subtitles.markers']['types'],
  },
  'subtitles.store_marker': {
    methods: ["POST"],
    pattern: '/api/subtitles/markers',
    tokens: [{"old":"/api/subtitles/markers","type":0,"val":"api","end":""},{"old":"/api/subtitles/markers","type":0,"val":"subtitles","end":""},{"old":"/api/subtitles/markers","type":0,"val":"markers","end":""}],
    types: placeholder as Registry['subtitles.store_marker']['types'],
  },
  'media.show': {
    methods: ["GET","HEAD"],
    pattern: '/api/media/:mediaType/:tmdbId',
    tokens: [{"old":"/api/media/:mediaType/:tmdbId","type":0,"val":"api","end":""},{"old":"/api/media/:mediaType/:tmdbId","type":0,"val":"media","end":""},{"old":"/api/media/:mediaType/:tmdbId","type":1,"val":"mediaType","end":""},{"old":"/api/media/:mediaType/:tmdbId","type":1,"val":"tmdbId","end":""}],
    types: placeholder as Registry['media.show']['types'],
  },
  'media.search': {
    methods: ["GET","HEAD"],
    pattern: '/api/search',
    tokens: [{"old":"/api/search","type":0,"val":"api","end":""},{"old":"/api/search","type":0,"val":"search","end":""}],
    types: placeholder as Registry['media.search']['types'],
  },
  'transcode.tracks': {
    methods: ["GET","HEAD"],
    pattern: '/api/transcode/tracks',
    tokens: [{"old":"/api/transcode/tracks","type":0,"val":"api","end":""},{"old":"/api/transcode/tracks","type":0,"val":"transcode","end":""},{"old":"/api/transcode/tracks","type":0,"val":"tracks","end":""}],
    types: placeholder as Registry['transcode.tracks']['types'],
  },
  'transcode.audio': {
    methods: ["GET","HEAD"],
    pattern: '/api/transcode/audio',
    tokens: [{"old":"/api/transcode/audio","type":0,"val":"api","end":""},{"old":"/api/transcode/audio","type":0,"val":"transcode","end":""},{"old":"/api/transcode/audio","type":0,"val":"audio","end":""}],
    types: placeholder as Registry['transcode.audio']['types'],
  },
  'progress.show': {
    methods: ["GET","HEAD"],
    pattern: '/api/progress/:mediaType/:tmdbId',
    tokens: [{"old":"/api/progress/:mediaType/:tmdbId","type":0,"val":"api","end":""},{"old":"/api/progress/:mediaType/:tmdbId","type":0,"val":"progress","end":""},{"old":"/api/progress/:mediaType/:tmdbId","type":1,"val":"mediaType","end":""},{"old":"/api/progress/:mediaType/:tmdbId","type":1,"val":"tmdbId","end":""}],
    types: placeholder as Registry['progress.show']['types'],
  },
  'progress.sync': {
    methods: ["POST"],
    pattern: '/api/progress/sync',
    tokens: [{"old":"/api/progress/sync","type":0,"val":"api","end":""},{"old":"/api/progress/sync","type":0,"val":"progress","end":""},{"old":"/api/progress/sync","type":0,"val":"sync","end":""}],
    types: placeholder as Registry['progress.sync']['types'],
  },
} as const satisfies Record<string, AdonisEndpoint>

export { routes }

export const registry = {
  routes,
  $tree: {} as ApiDefinition,
}

declare module '@tuyau/core/types' {
  export interface UserRegistry {
    routes: typeof routes
    $tree: ApiDefinition
  }
}
