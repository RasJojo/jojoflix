import { Env } from '@adonisjs/core/env'

export default await Env.create(new URL('../', import.meta.url), {
  // Node
  NODE_ENV: Env.schema.enum(['development', 'production', 'test'] as const),
  PORT: Env.schema.number(),
  HOST: Env.schema.string({ format: 'host' }),
  LOG_LEVEL: Env.schema.string(),

  // App
  APP_KEY: Env.schema.secret(),
  APP_URL: Env.schema.string({ format: 'url', tld: false }),

  // Database (SQLite)
  DB_PATH: Env.schema.string(),

  // Convex
  CONVEX_URL: Env.schema.string({ format: 'url', tld: false }),
  CONVEX_ADMIN_KEY: Env.schema.secret(),

  // Third-party APIs
  RD_API_KEY: Env.schema.secret(),
  TMDB_API_KEY: Env.schema.secret(),
  OPENSUBS_API_KEY: Env.schema.secret(),
  SUBDL_API_KEY: Env.schema.string.optional(),
  SUBSOURCE_API_KEY: Env.schema.string.optional(),
  FLARESOLVERR_URL: Env.schema.string.optional(),
  MEDIAFUSION_URL: Env.schema.string.optional(),
  TORRENTIO_URL: Env.schema.string.optional(),
  TORRENTIO_PROXY: Env.schema.string.optional(),
  DRAMAYO_URL: Env.schema.string.optional(),
})
