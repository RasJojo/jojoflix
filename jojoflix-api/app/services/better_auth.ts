import { betterAuth } from 'better-auth'
import Database from 'better-sqlite3'
import { bearer } from 'better-auth/plugins'
import { Scrypt } from '@adonisjs/hash/drivers/scrypt'
import env from '#start/env'

const adonisScrypt = new Scrypt({
  cost: 16384,
  blockSize: 8,
  parallelization: 1,
  maxMemory: 33554432,
})

async function hashPassword(password: string): Promise<string> {
  return adonisScrypt.make(password)
}

async function verifyPassword({
  hash,
  password,
}: {
  hash: string
  password: string
}): Promise<boolean> {
  return adonisScrypt.verify(hash, password)
}

export const auth = betterAuth({
  database: new Database(env.get('DB_PATH')),
  baseURL: env.get('APP_URL'),

  emailAndPassword: {
    enabled: true,
    password: { hash: hashPassword, verify: verifyPassword },
  },

  session: {
    expiresIn: 60 * 60 * 24 * 30, // 30 days
    updateAge: 60 * 60 * 24,
  },

  plugins: [bearer()],
})

export type SessionUser = typeof auth.$Infer.Session.user

/** Convert AdonisJS request.headers() to a Web API Headers object */
export function toWebHeaders(rawHeaders: Record<string, string | string[] | undefined>): Headers {
  const headers = new Headers()
  for (const [key, value] of Object.entries(rawHeaders)) {
    if (value === undefined) continue
    if (Array.isArray(value)) {
      for (const v of value) headers.append(key, v)
    } else {
      headers.set(key, value)
    }
  }
  return headers
}
