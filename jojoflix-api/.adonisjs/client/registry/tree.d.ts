/* eslint-disable prettier/prettier */
import type { routes } from './index.ts'

export interface ApiDefinition {
  newAccount: {
    store: typeof routes['new_account.store']
  }
  accessToken: {
    store: typeof routes['access_token.store']
    destroy: typeof routes['access_token.destroy']
  }
  profiles: {
    index: typeof routes['profiles.index']
    store: typeof routes['profiles.store']
    update: typeof routes['profiles.update']
    destroy: typeof routes['profiles.destroy']
    select: typeof routes['profiles.select']
  }
  home: {
    show: typeof routes['home.show']
  }
  streaming: {
    movieSources: typeof routes['streaming.movie_sources']
    tvSources: typeof routes['streaming.tv_sources']
    prewarmTvEpisode: typeof routes['streaming.prewarm_tv_episode']
    movie: typeof routes['streaming.movie']
    tvEpisode: typeof routes['streaming.tv_episode']
  }
  subtitles: {
    list: typeof routes['subtitles.list']
    download: typeof routes['subtitles.download']
    serveVtt: typeof routes['subtitles.serve_vtt']
    markers: typeof routes['subtitles.markers']
    storeMarker: typeof routes['subtitles.store_marker']
  }
  media: {
    show: typeof routes['media.show']
    search: typeof routes['media.search']
  }
  transcode: {
    tracks: typeof routes['transcode.tracks']
    audio: typeof routes['transcode.audio']
  }
  progress: {
    show: typeof routes['progress.show']
    sync: typeof routes['progress.sync']
  }
}
