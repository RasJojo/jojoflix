import '@adonisjs/core/types/http'

type ParamValue = string | number | bigint | boolean

export type ScannedRoutes = {
  ALL: {
    'new_account.store': { paramsTuple?: []; params?: {} }
    'access_token.store': { paramsTuple?: []; params?: {} }
    'access_token.destroy': { paramsTuple?: []; params?: {} }
    'profiles.index': { paramsTuple?: []; params?: {} }
    'profiles.store': { paramsTuple?: []; params?: {} }
    'profiles.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'profiles.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'profiles.select': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'home.show': { paramsTuple: [ParamValue]; params: {'profile_id': ParamValue} }
    'home.browse': { paramsTuple: [ParamValue]; params: {'mediaType': ParamValue} }
    'streaming.movie_sources': { paramsTuple: [ParamValue]; params: {'tmdb_id': ParamValue} }
    'streaming.tv_sources': { paramsTuple: [ParamValue,ParamValue,ParamValue]; params: {'tmdb_id': ParamValue,'season': ParamValue,'episode': ParamValue} }
    'streaming.prewarm_tv_episode': { paramsTuple: [ParamValue,ParamValue,ParamValue]; params: {'tmdb_id': ParamValue,'season': ParamValue,'episode': ParamValue} }
    'streaming.movie': { paramsTuple: [ParamValue]; params: {'tmdb_id': ParamValue} }
    'streaming.tv_episode': { paramsTuple: [ParamValue,ParamValue,ParamValue]; params: {'tmdb_id': ParamValue,'season': ParamValue,'episode': ParamValue} }
    'subtitles.list': { paramsTuple: [ParamValue]; params: {'tmdb_id': ParamValue} }
    'subtitles.download': { paramsTuple?: []; params?: {} }
    'subtitles.serve_vtt': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'subtitles.markers': { paramsTuple: [ParamValue]; params: {'tmdb_id': ParamValue} }
    'subtitles.store_marker': { paramsTuple?: []; params?: {} }
    'media.show': { paramsTuple: [ParamValue,ParamValue]; params: {'mediaType': ParamValue,'tmdbId': ParamValue} }
    'media.search': { paramsTuple?: []; params?: {} }
    'people.show': { paramsTuple: [ParamValue]; params: {'personId': ParamValue} }
    'watchlist.index': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'watchlist.store': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'watchlist.destroy': { paramsTuple: [ParamValue,ParamValue,ParamValue]; params: {'id': ParamValue,'mediaType': ParamValue,'tmdbId': ParamValue} }
    'transcode.info': { paramsTuple?: []; params?: {} }
    'transcode.tracks': { paramsTuple?: []; params?: {} }
    'transcode.subtitle': { paramsTuple?: []; params?: {} }
    'transcode.audio': { paramsTuple?: []; params?: {} }
    'download.movie': { paramsTuple: [ParamValue]; params: {'tmdb_id': ParamValue} }
    'download.tv_episode': { paramsTuple: [ParamValue,ParamValue,ParamValue]; params: {'tmdb_id': ParamValue,'season': ParamValue,'episode': ParamValue} }
    'download.stream_movie': { paramsTuple: [ParamValue]; params: {'tmdb_id': ParamValue} }
    'download.stream_tv_episode': { paramsTuple: [ParamValue,ParamValue,ParamValue]; params: {'tmdb_id': ParamValue,'season': ParamValue,'episode': ParamValue} }
    'progress.show': { paramsTuple: [ParamValue,ParamValue]; params: {'mediaType': ParamValue,'tmdbId': ParamValue} }
    'progress.sync': { paramsTuple?: []; params?: {} }
  }
  GET: {
    'profiles.index': { paramsTuple?: []; params?: {} }
    'home.show': { paramsTuple: [ParamValue]; params: {'profile_id': ParamValue} }
    'home.browse': { paramsTuple: [ParamValue]; params: {'mediaType': ParamValue} }
    'streaming.movie_sources': { paramsTuple: [ParamValue]; params: {'tmdb_id': ParamValue} }
    'streaming.tv_sources': { paramsTuple: [ParamValue,ParamValue,ParamValue]; params: {'tmdb_id': ParamValue,'season': ParamValue,'episode': ParamValue} }
    'streaming.prewarm_tv_episode': { paramsTuple: [ParamValue,ParamValue,ParamValue]; params: {'tmdb_id': ParamValue,'season': ParamValue,'episode': ParamValue} }
    'streaming.movie': { paramsTuple: [ParamValue]; params: {'tmdb_id': ParamValue} }
    'streaming.tv_episode': { paramsTuple: [ParamValue,ParamValue,ParamValue]; params: {'tmdb_id': ParamValue,'season': ParamValue,'episode': ParamValue} }
    'subtitles.list': { paramsTuple: [ParamValue]; params: {'tmdb_id': ParamValue} }
    'subtitles.serve_vtt': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'subtitles.markers': { paramsTuple: [ParamValue]; params: {'tmdb_id': ParamValue} }
    'media.show': { paramsTuple: [ParamValue,ParamValue]; params: {'mediaType': ParamValue,'tmdbId': ParamValue} }
    'media.search': { paramsTuple?: []; params?: {} }
    'people.show': { paramsTuple: [ParamValue]; params: {'personId': ParamValue} }
    'watchlist.index': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'transcode.info': { paramsTuple?: []; params?: {} }
    'transcode.tracks': { paramsTuple?: []; params?: {} }
    'transcode.subtitle': { paramsTuple?: []; params?: {} }
    'transcode.audio': { paramsTuple?: []; params?: {} }
    'download.movie': { paramsTuple: [ParamValue]; params: {'tmdb_id': ParamValue} }
    'download.tv_episode': { paramsTuple: [ParamValue,ParamValue,ParamValue]; params: {'tmdb_id': ParamValue,'season': ParamValue,'episode': ParamValue} }
    'download.stream_movie': { paramsTuple: [ParamValue]; params: {'tmdb_id': ParamValue} }
    'download.stream_tv_episode': { paramsTuple: [ParamValue,ParamValue,ParamValue]; params: {'tmdb_id': ParamValue,'season': ParamValue,'episode': ParamValue} }
    'progress.show': { paramsTuple: [ParamValue,ParamValue]; params: {'mediaType': ParamValue,'tmdbId': ParamValue} }
  }
  HEAD: {
    'profiles.index': { paramsTuple?: []; params?: {} }
    'home.show': { paramsTuple: [ParamValue]; params: {'profile_id': ParamValue} }
    'home.browse': { paramsTuple: [ParamValue]; params: {'mediaType': ParamValue} }
    'streaming.movie_sources': { paramsTuple: [ParamValue]; params: {'tmdb_id': ParamValue} }
    'streaming.tv_sources': { paramsTuple: [ParamValue,ParamValue,ParamValue]; params: {'tmdb_id': ParamValue,'season': ParamValue,'episode': ParamValue} }
    'streaming.prewarm_tv_episode': { paramsTuple: [ParamValue,ParamValue,ParamValue]; params: {'tmdb_id': ParamValue,'season': ParamValue,'episode': ParamValue} }
    'streaming.movie': { paramsTuple: [ParamValue]; params: {'tmdb_id': ParamValue} }
    'streaming.tv_episode': { paramsTuple: [ParamValue,ParamValue,ParamValue]; params: {'tmdb_id': ParamValue,'season': ParamValue,'episode': ParamValue} }
    'subtitles.list': { paramsTuple: [ParamValue]; params: {'tmdb_id': ParamValue} }
    'subtitles.serve_vtt': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'subtitles.markers': { paramsTuple: [ParamValue]; params: {'tmdb_id': ParamValue} }
    'media.show': { paramsTuple: [ParamValue,ParamValue]; params: {'mediaType': ParamValue,'tmdbId': ParamValue} }
    'media.search': { paramsTuple?: []; params?: {} }
    'people.show': { paramsTuple: [ParamValue]; params: {'personId': ParamValue} }
    'watchlist.index': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'transcode.info': { paramsTuple?: []; params?: {} }
    'transcode.tracks': { paramsTuple?: []; params?: {} }
    'transcode.subtitle': { paramsTuple?: []; params?: {} }
    'transcode.audio': { paramsTuple?: []; params?: {} }
    'download.movie': { paramsTuple: [ParamValue]; params: {'tmdb_id': ParamValue} }
    'download.tv_episode': { paramsTuple: [ParamValue,ParamValue,ParamValue]; params: {'tmdb_id': ParamValue,'season': ParamValue,'episode': ParamValue} }
    'download.stream_movie': { paramsTuple: [ParamValue]; params: {'tmdb_id': ParamValue} }
    'download.stream_tv_episode': { paramsTuple: [ParamValue,ParamValue,ParamValue]; params: {'tmdb_id': ParamValue,'season': ParamValue,'episode': ParamValue} }
    'progress.show': { paramsTuple: [ParamValue,ParamValue]; params: {'mediaType': ParamValue,'tmdbId': ParamValue} }
  }
  POST: {
    'new_account.store': { paramsTuple?: []; params?: {} }
    'access_token.store': { paramsTuple?: []; params?: {} }
    'access_token.destroy': { paramsTuple?: []; params?: {} }
    'profiles.store': { paramsTuple?: []; params?: {} }
    'profiles.select': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'subtitles.download': { paramsTuple?: []; params?: {} }
    'subtitles.store_marker': { paramsTuple?: []; params?: {} }
    'watchlist.store': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'progress.sync': { paramsTuple?: []; params?: {} }
  }
  PUT: {
    'profiles.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
  }
  DELETE: {
    'profiles.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'watchlist.destroy': { paramsTuple: [ParamValue,ParamValue,ParamValue]; params: {'id': ParamValue,'mediaType': ParamValue,'tmdbId': ParamValue} }
  }
}
declare module '@adonisjs/core/types/http' {
  export interface RoutesList extends ScannedRoutes {}
}