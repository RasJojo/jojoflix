import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import Profile from '#models/profile'

export default class ProfileInterest extends BaseModel {
  static table = 'profile_interests'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare profileId: number

  @column()
  declare genreId: number

  @column()
  declare affinityScore: number

  @column.dateTime()
  declare lastWatchedAt: DateTime | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime

  @belongsTo(() => Profile)
  declare profile: BelongsTo<typeof Profile>
}
// Interests
