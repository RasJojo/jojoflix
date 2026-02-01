import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'media_markers'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id').notNullable()
      table.string('tmdb_id').notNullable()
      table.string('marker_type').notNullable() // 'intro' | 'outro'
      table.integer('start_time').notNullable() // secondes
      table.integer('end_time').notNullable() // secondes

      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()

      table.index(['tmdb_id'], 'media_markers_tmdb_id_index')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
