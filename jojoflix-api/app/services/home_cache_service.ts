import CacheWrapper from '#services/cache_wrapper'

const HOME_ROWS_CACHE_TTL_SECONDS = 20

export function homeRowsCacheKey(profileId: string): string {
  return `home:rows:v2:${profileId}`
}

export async function forgetHomeRowsCache(profileId: string): Promise<void> {
  await new CacheWrapper().forget(homeRowsCacheKey(profileId)).catch(() => {})
}

export async function rememberHomeRows<T>(
  profileId: string,
  callback: () => Promise<T>
): Promise<T> {
  return new CacheWrapper().remember(
    homeRowsCacheKey(profileId),
    HOME_ROWS_CACHE_TTL_SECONDS,
    callback
  )
}
