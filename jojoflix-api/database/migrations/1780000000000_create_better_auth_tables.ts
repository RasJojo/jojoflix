import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    // Better Auth uses camelCase column names and TEXT primary keys.
    // Timestamps are stored as INTEGER (Unix ms).
    await this.db.rawQuery(`
      CREATE TABLE IF NOT EXISTS "user" (
        "id"            TEXT    NOT NULL PRIMARY KEY,
        "name"          TEXT    NOT NULL,
        "email"         TEXT    NOT NULL UNIQUE,
        "emailVerified" INTEGER NOT NULL DEFAULT 0,
        "image"         TEXT,
        "createdAt"     INTEGER NOT NULL,
        "updatedAt"     INTEGER NOT NULL
      )
    `)

    await this.db.rawQuery(`
      CREATE TABLE IF NOT EXISTS "session" (
        "id"          TEXT    NOT NULL PRIMARY KEY,
        "expiresAt"   INTEGER NOT NULL,
        "token"       TEXT    NOT NULL UNIQUE,
        "createdAt"   INTEGER NOT NULL,
        "updatedAt"   INTEGER NOT NULL,
        "ipAddress"   TEXT,
        "userAgent"   TEXT,
        "userId"      TEXT    NOT NULL REFERENCES "user"("id") ON DELETE CASCADE
      )
    `)

    await this.db.rawQuery(`
      CREATE TABLE IF NOT EXISTS "account" (
        "id"                     TEXT    NOT NULL PRIMARY KEY,
        "accountId"              TEXT    NOT NULL,
        "providerId"             TEXT    NOT NULL,
        "userId"                 TEXT    NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
        "accessToken"            TEXT,
        "refreshToken"           TEXT,
        "idToken"                TEXT,
        "accessTokenExpiresAt"   INTEGER,
        "refreshTokenExpiresAt"  INTEGER,
        "scope"                  TEXT,
        "password"               TEXT,
        "createdAt"              INTEGER NOT NULL,
        "updatedAt"              INTEGER NOT NULL
      )
    `)

    await this.db.rawQuery(`
      CREATE TABLE IF NOT EXISTS "verification" (
        "id"         TEXT    NOT NULL PRIMARY KEY,
        "identifier" TEXT    NOT NULL,
        "value"      TEXT    NOT NULL,
        "expiresAt"  INTEGER NOT NULL,
        "createdAt"  INTEGER,
        "updatedAt"  INTEGER
      )
    `)
  }

  async down() {
    await this.db.rawQuery(`DROP TABLE IF EXISTS "verification"`)
    await this.db.rawQuery(`DROP TABLE IF EXISTS "account"`)
    await this.db.rawQuery(`DROP TABLE IF EXISTS "session"`)
    await this.db.rawQuery(`DROP TABLE IF EXISTS "user"`)
  }
}
