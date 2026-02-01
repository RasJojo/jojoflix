import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import User from '#models/user'

export interface ProfilePreferences {
  audio?: string
  subtitles?: string
  auto_skip_intro?: boolean
  watchlist?: Array<{
    tmdb_id: string
    media_type: 'movie' | 'tv'
    added_at?: string | null
  }>
}

export default class Profile extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare userId: number

  @column()
  declare name: string

  @column()
  declare avatarUrl: string | null

  @column()
  declare isKids: boolean

  @column()
  declare preferences: ProfilePreferences

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime

  @belongsTo(() => User)
  declare user: BelongsTo<typeof User>
}
