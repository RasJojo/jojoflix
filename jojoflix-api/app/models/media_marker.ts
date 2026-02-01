import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'

export default class MediaMarker extends BaseModel {
  static table = 'media_markers'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare tmdbId: string

  @column()
  declare markerType: 'intro' | 'outro'

  @column()
  declare startTime: number

  @column()
  declare endTime: number

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime
}
