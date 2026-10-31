/**
 * Fixed-window counters for the saved-places API: per minute and per day, keyed by a string
 * (key id, user id, or client address). In memory: a Durable Object restart resets them.
 */
export const INGEST_PER_MINUTE = 10;
export const INGEST_PER_DAY = 200;
const MAX_BUCKETS = 5000;

export function createSavedRateLimiter({
  perMinute = INGEST_PER_MINUTE,
  perDay = INGEST_PER_DAY,
  now = () => Date.now(),
} = {}) {
  const buckets = new Map();

  function prune(t) {
    if (buckets.size < MAX_BUCKETS) return;
    for (const [id, b] of buckets) if (b.dayEnd <= t) buckets.delete(id);
    if (buckets.size >= MAX_BUCKETS) buckets.delete(buckets.keys().next().value);
  }

  /** Returns { ok: true } and counts the call, or { ok: false, retryAfterSec }. */
  function attempt(id) {
    const t = now();
    let b = buckets.get(id);
    if (!b || b.dayEnd <= t) {
      prune(t);
      b = { minStart: t, minCount: 0, dayEnd: t + 24 * 60 * 60 * 1000, dayCount: 0 };
      buckets.set(id, b);
    }
    if (t - b.minStart >= 60_000) {
      b.minStart = t;
      b.minCount = 0;
    }
    if (b.dayCount >= perDay) return { ok: false, retryAfterSec: Math.ceil((b.dayEnd - t) / 1000) };
    if (b.minCount >= perMinute) return { ok: false, retryAfterSec: Math.ceil((b.minStart + 60_000 - t) / 1000) };
    b.minCount += 1;
    b.dayCount += 1;
    return { ok: true };
  }

  return { attempt };
}
