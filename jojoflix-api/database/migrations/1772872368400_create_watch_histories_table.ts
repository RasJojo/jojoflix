import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'watch_histories'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id').notNullable()
      table
        .integer('profile_id')
        .notNullable()
        .unsigned()
        .references('id')
        .inTable('profiles')
        .onDelete('CASCADE')

      table.string('tmdb_id').notNullable()
      table.string('media_type').notNullable() // 'movie' | 'tv'
      table.integer('season_num').nullable()
      table.integer('episode_num').nullable()
      table.integer('current_time').notNullable().defaultTo(0) // secondes
      table.integer('total_duration').notNullable().defaultTo(0)
      table.boolean('is_finished').notNullable().defaultTo(false)

      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()

      // Index pour accélerer les lookups par profil
      table.index(['profile_id', 'tmdb_id', 'season_num', 'episode_num'], 'watch_histories_lookup_index')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
