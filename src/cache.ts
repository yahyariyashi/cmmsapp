// Memory cache that is also persisted to disk.
//  - get()      : fresh data only (5 min TTL) — unchanged behaviour for old callers
//  - getStale() : last known data regardless of age (up to 7 days) → show instantly,
//                 then refresh in the background (stale-while-revalidate)
// Call cache.clear() on sign-out so no ticket data stays on the phone.
import { readJson, writeJson, removeFile } from './storage';

type CacheEntry<T> = { data: T; timestamp: number };
const TTL = 5 * 60 * 1000; // fresh window
const MAX_STALE = 7 * 24 * 60 * 60 * 1000; // keep for a week
const MAX_BYTES = 1_500_000; // keep the cache file small
const FILE = 'mm_cache_v1.json';

const store = new Map<string, CacheEntry<unknown>>();
let hydrating: Promise<void> | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

function schedulePersist() {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    const entries = Array.from(store.entries()).sort(
      (a, b) => b[1].timestamp - a[1].timestamp
    );
    let obj: Record<string, CacheEntry<unknown>> = {};
    let size = 0;
    for (const [k, v] of entries) {
      const s = JSON.stringify(v).length;
      if (size + s > MAX_BYTES) continue; // drop oldest / biggest overflow
      size += s;
      obj[k] = v;
    }
    void writeJson(FILE, obj);
  }, 1500);
}

export const cache = {
  /** Load the disk copy once (safe to call many times). */
  hydrate(): Promise<void> {
    if (!hydrating) {
      hydrating = (async () => {
        const saved = await readJson<Record<string, CacheEntry<unknown>>>(FILE);
        if (!saved) return;
        const now = Date.now();
        for (const [k, v] of Object.entries(saved)) {
          if (!v || typeof v.timestamp !== 'number') continue;
          if (now - v.timestamp > MAX_STALE) continue;
          if (!store.has(k)) store.set(k, v); // never overwrite newer in-memory data
        }
      })();
    }
    return hydrating;
  },
  get<T>(key: string): T | null {
    const entry = store.get(key);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > TTL) return null; // stale → treat as miss (kept for getStale)
    return entry.data as T;
  },
  getStale<T>(key: string): T | null {
    const entry = store.get(key);
    return entry ? (entry.data as T) : null;
  },
  set<T>(key: string, data: T): void {
    store.set(key, { data, timestamp: Date.now() });
    schedulePersist();
  },
  invalidate(key: string): void {
    store.delete(key);
    schedulePersist();
  },
  invalidatePrefix(prefix: string): void {
    for (const k of Array.from(store.keys())) {
      if (k.startsWith(prefix)) store.delete(k);
    }
    schedulePersist();
  },
  clear(): void {
    store.clear();
    if (timer) clearTimeout(timer);
    timer = null;
    hydrating = Promise.resolve(); // do not re-load the file we are deleting
    void removeFile(FILE);
  },
  /** For Settings → storage info */
  stats(): { entries: number } {
    return { entries: store.size };
  },
};
