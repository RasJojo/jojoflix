/* eslint-disable prettier/prettier */
/// <reference path="../manifest.d.ts" />

import type { ExtractBody, ExtractErrorResponse, ExtractQuery, ExtractQueryForGet, ExtractResponse } from '@tuyau/core/types'
import type { InferInput, SimpleError } from '@vinejs/vine/types'

export type ParamValue = string | number | bigint | boolean

export interface Registry {
  'new_account.store': {
    methods: ["POST"]
    pattern: '/api/auth/register'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/user').signupValidator)>>
      paramsTuple: []
      params: {}
      query: ExtractQuery<InferInput<(typeof import('#validators/user').signupValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/new_account_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/new_account_controller').default['store']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'access_token.store': {
    methods: ["POST"]
    pattern: '/api/auth/login'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/user').loginValidator)>>
      paramsTuple: []
      params: {}
      query: ExtractQuery<InferInput<(typeof import('#validators/user').loginValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/access_token_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/access_token_controller').default['store']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'access_token.destroy': {
    methods: ["POST"]
    pattern: '/api/auth/logout'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/access_token_controller').default['destroy']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/access_token_controller').default['destroy']>>>
    }
  }
  'profiles.index': {
    methods: ["GET","HEAD"]
    pattern: '/api/profiles'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: unknown
      errorResponse: unknown
    }
  }
  'profiles.store': {
    methods: ["POST"]
    pattern: '/api/profiles'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: unknown
      errorResponse: unknown
    }
  }
  'profiles.update': {
    methods: ["PUT"]
    pattern: '/api/profiles/:id'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: unknown
      errorResponse: unknown
    }
  }
  'profiles.destroy': {
    methods: ["DELETE"]
    pattern: '/api/profiles/:id'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: unknown
      errorResponse: unknown
    }
  }
  'profiles.select': {
    methods: ["POST"]
    pattern: '/api/profiles/:id/select'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: unknown
      errorResponse: unknown
    }
  }
  'home.show': {
    methods: ["GET","HEAD"]
    pattern: '/api/home/:profile_id'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { profile_id: ParamValue }
      query: {}
      response: unknown
      errorResponse: unknown
    }
  }
  'home.browse': {
    methods: ["GET","HEAD"]
    pattern: '/api/browse/:mediaType'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { mediaType: ParamValue }
      query: {}
      response: unknown
      errorResponse: unknown
    }
  }
  'streaming.movie_sources': {
    methods: ["GET","HEAD"]
    pattern: '/api/sources/movie/:tmdb_id'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { tmdb_id: ParamValue }
      query: {}
      response: unknown
      errorResponse: unknown
    }
  }
  'streaming.tv_sources': {
    methods: ["GET","HEAD"]
    pattern: '/api/sources/tv/:tmdb_id/s/:season/e/:episode'
    types: {
      body: {}
      paramsTuple: [ParamValue, ParamValue, ParamValue]
      params: { tmdb_id: ParamValue; season: ParamValue; episode: ParamValue }
      query: {}
      response: unknown
      errorResponse: unknown
    }
  }
  'streaming.prewarm_tv_episode': {
    methods: ["GET","HEAD"]
    pattern: '/api/stream/prewarm/tv/:tmdb_id/s/:season/e/:episode'
    types: {
      body: {}
      paramsTuple: [ParamValue, ParamValue, ParamValue]
      params: { tmdb_id: ParamValue; season: ParamValue; episode: ParamValue }
      query: {}
      response: unknown
      errorResponse: unknown
    }
  }
  'streaming.movie': {
    methods: ["GET","HEAD"]
    pattern: '/api/stream/movie/:tmdb_id'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { tmdb_id: ParamValue }
      query: {}
      response: unknown
      errorResponse: unknown
    }
  }
  'streaming.tv_episode': {
    methods: ["GET","HEAD"]
    pattern: '/api/stream/tv/:tmdb_id/s/:season/e/:episode'
    types: {
      body: {}
      paramsTuple: [ParamValue, ParamValue, ParamValue]
      params: { tmdb_id: ParamValue; season: ParamValue; episode: ParamValue }
      query: {}
      response: unknown
      errorResponse: unknown
    }
  }
  'subtitles.list': {
    methods: ["GET","HEAD"]
    pattern: '/api/subtitles/list/:tmdb_id'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { tmdb_id: ParamValue }
      query: {}
      response: unknown
      errorResponse: unknown
    }
  }
  'subtitles.download': {
    methods: ["POST"]
    pattern: '/api/subtitles/download'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: unknown
      errorResponse: unknown
    }
  }
  'subtitles.serve_vtt': {
    methods: ["GET","HEAD"]
    pattern: '/api/subtitles/vtt/:id'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: unknown
      errorResponse: unknown
    }
  }
  'subtitles.markers': {
    methods: ["GET","HEAD"]
    pattern: '/api/subtitles/markers/:tmdb_id'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { tmdb_id: ParamValue }
      query: {}
      response: unknown
      errorResponse: unknown
    }
  }
  'subtitles.store_marker': {
    methods: ["POST"]
    pattern: '/api/subtitles/markers'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: unknown
      errorResponse: unknown
    }
  }
  'media.show': {
    methods: ["GET","HEAD"]
    pattern: '/api/media/:mediaType/:tmdbId'
    types: {
      body: {}
      paramsTuple: [ParamValue, ParamValue]
      params: { mediaType: ParamValue; tmdbId: ParamValue }
      query: {}
      response: unknown
      errorResponse: unknown
    }
  }
  'media.search': {
    methods: ["GET","HEAD"]
    pattern: '/api/search'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: unknown
      errorResponse: unknown
    }
  }
  'people.show': {
    methods: ["GET","HEAD"]
    pattern: '/api/people/:personId'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { personId: ParamValue }
      query: {}
      response: unknown
      errorResponse: unknown
    }
  }
  'watchlist.index': {
    methods: ["GET","HEAD"]
    pattern: '/api/profiles/:id/watchlist'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: unknown
      errorResponse: unknown
    }
  }
  'watchlist.store': {
    methods: ["POST"]
    pattern: '/api/profiles/:id/watchlist'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: unknown
      errorResponse: unknown
    }
  }
  'watchlist.destroy': {
    methods: ["DELETE"]
    pattern: '/api/profiles/:id/watchlist/:mediaType/:tmdbId'
    types: {
      body: {}
      paramsTuple: [ParamValue, ParamValue, ParamValue]
      params: { id: ParamValue; mediaType: ParamValue; tmdbId: ParamValue }
      query: {}
      response: unknown
      errorResponse: unknown
    }
  }
  'transcode.info': {
    methods: ["GET","HEAD"]
    pattern: '/api/transcode/info'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: unknown
      errorResponse: unknown
    }
  }
  'transcode.tracks': {
    methods: ["GET","HEAD"]
    pattern: '/api/transcode/tracks'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: unknown
      errorResponse: unknown
    }
  }
  'transcode.subtitle': {
    methods: ["GET","HEAD"]
    pattern: '/api/transcode/subtitle'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: unknown
      errorResponse: unknown
    }
  }
  'transcode.audio': {
    methods: ["GET","HEAD"]
    pattern: '/api/transcode/audio'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: unknown
      errorResponse: unknown
    }
  }
  'download.movie': {
    methods: ["GET","HEAD"]
    pattern: '/api/download/movie/:tmdb_id'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { tmdb_id: ParamValue }
      query: {}
      response: unknown
      errorResponse: unknown
    }
  }
  'download.tv_episode': {
    methods: ["GET","HEAD"]
    pattern: '/api/download/tv/:tmdb_id/s/:season/e/:episode'
    types: {
      body: {}
      paramsTuple: [ParamValue, ParamValue, ParamValue]
      params: { tmdb_id: ParamValue; season: ParamValue; episode: ParamValue }
      query: {}
      response: unknown
      errorResponse: unknown
    }
  }
  'download.stream_movie': {
    methods: ["GET","HEAD"]
    pattern: '/api/download/stream/movie/:tmdb_id'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { tmdb_id: ParamValue }
      query: {}
      response: unknown
      errorResponse: unknown
    }
  }
  'download.stream_tv_episode': {
    methods: ["GET","HEAD"]
    pattern: '/api/download/stream/tv/:tmdb_id/s/:season/e/:episode'
    types: {
      body: {}
      paramsTuple: [ParamValue, ParamValue, ParamValue]
      params: { tmdb_id: ParamValue; season: ParamValue; episode: ParamValue }
      query: {}
      response: unknown
      errorResponse: unknown
    }
  }
  'progress.show': {
    methods: ["GET","HEAD"]
    pattern: '/api/progress/:mediaType/:tmdbId'
    types: {
      body: {}
      paramsTuple: [ParamValue, ParamValue]
      params: { mediaType: ParamValue; tmdbId: ParamValue }
      query: {}
      response: unknown
      errorResponse: unknown
    }
  }
  'progress.sync': {
    methods: ["POST"]
    pattern: '/api/progress/sync'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: unknown
      errorResponse: unknown
    }
  }
}
