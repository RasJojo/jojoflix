#!/usr/bin/env node
/**
 * Migration: PostgreSQL → Better Auth (SQLite) + Convex (jojoflix)
 *
 * Usage:
 *   DATABASE_URL=postgres://user:pass@host:5432/db \
 *   DB_PATH=/path/to/jojoflix.db \
 *   node scripts/migrate_postgres_to_convex.mjs
 *
 * Pour un SSH tunnel depuis ta machine :
 *   ssh -L 5432:localhost:5432 user@jarvis &
 *   DATABASE_URL=postgres://jojoflix:PASS@localhost:5432/jojoflix \
 *   DB_PATH=/path/to/jojoflix.db \
 *   node scripts/migrate_postgres_to_convex.mjs
 *
 * Flags :
 *   --dry-run   Lit les données sans rien écrire dans Convex ni SQLite
 */

import pg from 'pg'
import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'

const { Client } = pg

// ── Config ────────────────────────────────────────────────────────────────────

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) {
  console.error('❌  DATABASE_URL manquant')
  process.exit(1)
}

const DB_PATH = process.env.DB_PATH
if (!DB_PATH) {
  console.error('❌  DB_PATH manquant (chemin vers la base SQLite Better Auth)')
  process.exit(1)
}

const CONVEX_URL = 'https://convex.jojoserv.com'
const ADMIN_KEY =
  '[REMOVED_CONVEX_ADMIN_KEY]'

const DRY_RUN = process.argv.includes('--dry-run')

// ── Helpers ───────────────────────────────────────────────────────────────────

async function callMutation(path, args) {
  if (DRY_RUN) {
    console.log(`  [dry-run] mutation ${path}`, JSON.stringify(args).slice(0, 120))
    return { _id: `dry:${Math.random().toString(36).slice(2)}` }
  }
  const res = await fetch(`${CONVEX_URL}/api/mutation`, {
    method: 'POST',
    headers: {
      Authorization: `Convex ${ADMIN_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ path, args, format: 'json' }),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}: ${text}`)
  const json = JSON.parse(text)
  if (json.status === 'error') throw new Error(`${path} → ${json.errorMessage}`)
  return json.value
}

async function callQuery(path, args) {
  const res = await fetch(`${CONVEX_URL}/api/query`, {
    method: 'POST',
    headers: {
      Authorization: `Convex ${ADMIN_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ path, args, format: 'json' }),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}: ${text}`)
  const json = JSON.parse(text)
  if (json.status === 'error') throw new Error(`${path} → ${json.errorMessage}`)
  return json.value
}

function toMs(ts) {
  if (!ts) return Date.now()
  return new Date(ts).getTime()
}

function progress(label, done, total) {
  process.stdout.write(`\r  ${label}: ${done}/${total}`)
  if (done === total) process.stdout.write('\n')
}

// ── User migration (PG → Better Auth SQLite) ─────────────────────────────────

/**
 * Migrates PostgreSQL users into Better Auth SQLite tables.
 * Returns a Map<pgUserId: number, betterAuthUserId: string>.
 */
async function migrateUsers(db, sqlite) {
  console.log('\n── Users ─────────────────────────────────────────────')

  const { rows } = await db.query(
    'SELECT id, email, password, full_name, created_at, updated_at FROM users ORDER BY id'
  )
  console.log(`  PostgreSQL: ${rows.length} users`)

  const userIdMap = new Map() // pgIntId → betterAuthStringId

  const findUser = sqlite.prepare('SELECT id FROM "user" WHERE email = ?')
  const insertUser = sqlite.prepare(`
    INSERT OR IGNORE INTO "user" (id, name, email, "emailVerified", image, "createdAt", "updatedAt")
    VALUES (?, ?, ?, 1, NULL, ?, ?)
  `)
  const insertAccount = sqlite.prepare(`
    INSERT OR IGNORE INTO "account" (id, "accountId", "providerId", "userId", password, "createdAt", "updatedAt")
    VALUES (?, ?, 'credential', ?, ?, ?, ?)
  `)

  let created = 0
  let existing = 0

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    progress('Users', i + 1, rows.length)

    const existingUser = findUser.get(row.email)
    if (existingUser) {
      userIdMap.set(row.id, existingUser.id)
      existing++
      continue
    }

    const newUserId = randomUUID()
    const nowMs = toMs(row.created_at)
    const updatedMs = toMs(row.updated_at ?? row.created_at)
    const name = row.full_name ?? row.email.split('@')[0]

    if (!DRY_RUN) {
      insertUser.run(newUserId, name, row.email, nowMs, updatedMs)
      insertAccount.run(randomUUID(), newUserId, newUserId, row.password ?? null, nowMs, updatedMs)
    } else {
      console.log(`  [dry-run] user ${row.email} → ${newUserId}`)
    }

    userIdMap.set(row.id, newUserId)
    created++
  }

  console.log(`  ✅ ${created} créés, ${existing} existants déjà (${DRY_RUN ? 'dry-run' : 'live'})`)
  return userIdMap
}

// ── Convex migrations ─────────────────────────────────────────────────────────

async function migrateProfiles(db, userIdMap) {
  console.log('\n── Profiles ──────────────────────────────────────────')

  const { rows } = await db.query('SELECT * FROM profiles ORDER BY id')
  console.log(`  PostgreSQL: ${rows.length} profiles`)

  const profileIdMap = new Map() // old int id → new Convex string id
  let skipped = 0
  let existing = 0

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    progress('Profiles', i + 1, rows.length)

    const userId = userIdMap.get(row.user_id)
    if (!userId) {
      skipped++
      continue
    }

    // Check if already migrated (idempotency)
    const existingProfiles = await callQuery('jojoflix:getProfilesByUser', { userId })
    if (Array.isArray(existingProfiles) && existingProfiles.length > 0) {
      const match = existingProfiles.find((p) => p.name === row.name) ?? existingProfiles[0]
      profileIdMap.set(row.id, match._id)
      existing++
      continue
    }

    let preferences = row.preferences ?? {}
    if (typeof preferences === 'string') {
      try { preferences = JSON.parse(preferences) } catch { preferences = {} }
    }

    const result = await callMutation('jojoflix:createProfile', {
      userId,
      name: row.name,
      avatarUrl: row.avatar_url ?? undefined,
      isKids: row.is_kids ?? false,
      preferences,
      createdAtMs: toMs(row.created_at),
      updatedAtMs: toMs(row.updated_at ?? row.created_at),
    })

    profileIdMap.set(row.id, result?._id ?? result)
  }

  console.log(
    `  ✅ ${rows.length - skipped - existing} créés, ${existing} existants, ${skipped} skippés (user inconnu) (${DRY_RUN ? 'dry-run' : 'live'})`
  )
  return profileIdMap
}

async function migrateWatchHistories(db, profileIdMap) {
  console.log('\n── Watch histories ───────────────────────────────────')

  const { rows } = await db.query('SELECT * FROM watch_histories ORDER BY id')
  console.log(`  PostgreSQL: ${rows.length} entrées`)

  let skipped = 0
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    progress('WatchHistories', i + 1, rows.length)

    const profileId = profileIdMap.get(row.profile_id)
    if (!profileId) { skipped++; continue }

    await callMutation('jojoflix:upsertWatchHistory', {
      profileId,
      tmdbId: String(row.tmdb_id),
      mediaType: row.media_type,
      seasonNum: row.season_num ?? undefined,
      episodeNum: row.episode_num ?? undefined,
      currentTime: row.current_time ?? 0,
      totalDuration: row.total_duration ?? 0,
      isFinished: row.is_finished ?? false,
      createdAtMs: toMs(row.created_at),
      updatedAtMs: toMs(row.updated_at ?? row.created_at),
    })
  }

  console.log(`  ✅ ${rows.length - skipped} migrés, ${skipped} skippés (profile_id inconnu)`)
}

async function migrateProfileInterests(db, profileIdMap) {
  console.log('\n── Profile interests ─────────────────────────────────')

  const { rows } = await db.query('SELECT * FROM profile_interests ORDER BY id')
  console.log(`  PostgreSQL: ${rows.length} entrées`)

  let skipped = 0
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    progress('Interests', i + 1, rows.length)

    const profileId = profileIdMap.get(row.profile_id)
    if (!profileId) { skipped++; continue }

    await callMutation('jojoflix:upsertInterest', {
      profileId,
      genreId: row.genre_id,
      affinityScore: parseFloat(row.affinity_score) ?? 10.0,
      lastWatchedAtMs: row.last_watched_at ? toMs(row.last_watched_at) : undefined,
      createdAtMs: toMs(row.created_at),
      updatedAtMs: toMs(row.updated_at ?? row.created_at),
    })
  }

  console.log(`  ✅ ${rows.length - skipped} migrés, ${skipped} skippés`)
}

async function migrateMediaMarkers(db) {
  console.log('\n── Media markers ─────────────────────────────────────')

  const { rows } = await db.query('SELECT * FROM media_markers ORDER BY id')
  console.log(`  PostgreSQL: ${rows.length} markers`)

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    progress('Markers', i + 1, rows.length)

    await callMutation('jojoflix:createMediaMarker', {
      tmdbId: String(row.tmdb_id),
      markerType: row.marker_type,
      startTime: row.start_time,
      endTime: row.end_time,
      createdAtMs: toMs(row.created_at),
    })
  }

  console.log(`  ✅ ${rows.length} markers migrés`)
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n🚀 Migration PostgreSQL → Better Auth + Convex (jojoflix)${DRY_RUN ? ' [DRY-RUN]' : ''}`)
  console.log(`   PG:     ${DATABASE_URL.replace(/:([^@]+)@/, ':***@')}`)
  console.log(`   SQLite: ${DB_PATH}`)
  console.log(`   Convex: ${CONVEX_URL}\n`)

  const db = new Client({ connectionString: DATABASE_URL })
  await db.connect()
  console.log('✅ Connecté à PostgreSQL')

  const sqlite = new Database(DB_PATH)
  console.log('✅ Connecté à SQLite (Better Auth)')

  try {
    const userIdMap = await migrateUsers(db, sqlite)
    const profileIdMap = await migrateProfiles(db, userIdMap)
    await migrateWatchHistories(db, profileIdMap)
    await migrateProfileInterests(db, profileIdMap)
    await migrateMediaMarkers(db)

    console.log('\n✅ Migration terminée !\n')
    if (DRY_RUN) {
      console.log('ℹ️  Mode dry-run : rien n\'a été écrit dans Convex ni dans SQLite.')
      console.log('   Relance sans --dry-run pour migrer pour de vrai.\n')
    }
  } catch (err) {
    console.error('\n❌ Erreur :', err.message)
    process.exit(1)
  } finally {
    await db.end()
    sqlite.close()
  }
}

main()
