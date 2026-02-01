import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import Profile from '#models/profile'

export default class WatchHistory extends BaseModel {
  static table = 'watch_histories'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare profileId: number

  @column()
  declare tmdbId: string

  @column()
  declare mediaType: 'movie' | 'tv'

  @column()
  declare seasonNum: number | null

  @column()
  declare episodeNum: number | null

  @column()
  declare currentTime: number

  @column()
  declare totalDuration: number

  @column()
  declare isFinished: boolean

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime

  @belongsTo(() => Profile)
  declare profile: BelongsTo<typeof Profile>
}
