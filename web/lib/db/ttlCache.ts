// Shared short-TTL cache for read-heavy API routes backed by the remote
// Supabase Postgres — same shape content-library/route.ts already proved
// out (measured live: ~2-3s/request even warm, genuine round-trip
// latency, not a reconnect cost). The data these routes serve only
// changes on explicit user actions (decide, remix, import, create), not
// from merely navigating between pages, so a short cache turns "every
// page flip repays the round trip" into "pays it once per TTL window."
// globalThis-backed so the Map survives Turbopack/Next dev module reloads.
const globalForCache = globalThis as unknown as {
  ttlCaches?: Map<string, Map<string, { body: unknown; expiresAt: number }>>;
};

function getStore(namespace: string) {
  if (!globalForCache.ttlCaches) globalForCache.ttlCaches = new Map();
  if (!globalForCache.ttlCaches.has(namespace)) globalForCache.ttlCaches.set(namespace, new Map());
  return globalForCache.ttlCaches.get(namespace)!;
}

/** Returns the cached body for (namespace, key) if still fresh, else runs
 * `compute`, caches its result for `ttlMs`, and returns it. */
export async function withTtlCache<T>(namespace: string, key: string, ttlMs: number, compute: () => Promise<T>): Promise<T> {
  const store = getStore(namespace);
  const cached = store.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.body as T;

  const body = await compute();
  store.set(key, { body, expiresAt: Date.now() + ttlMs });
  return body;
}

/** Call after a mutation so the next read is never stale — e.g. a Keep/
 * Discard decision should show up immediately, not after the TTL lapses.
 * Omit `key` to clear every cached entry in that namespace (every brand). */
export function invalidateTtlCache(namespace: string, key?: string) {
  const store = getStore(namespace);
  if (key) store.delete(key);
  else store.clear();
}
