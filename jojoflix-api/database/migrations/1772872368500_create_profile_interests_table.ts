import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'profile_interests'

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

      table.integer('genre_id').notNullable() // TMDB genre_id
      table.float('affinity_score').notNullable().defaultTo(10.0)
      table.timestamp('last_watched_at').nullable()

      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()

      table.unique(['profile_id', 'genre_id'])
      table.index(['profile_id', 'affinity_score'], 'profile_interests_score_index')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
