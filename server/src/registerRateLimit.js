/** In-memory register attempts. Nothing here is written to state.json or users.json. */

const HOUR_MS = 60 * 60 * 1000;

export function createRegisterRateLimiter({ limit = 5, windowMs = HOUR_MS, now = Date.now } = {}) {
  const hits = new Map();

  function attempt(ip, at = now()) {
    const key = typeof ip === 'string' && ip ? ip : 'unknown';
    const recent = (hits.get(key) || []).filter((stamp) => at - stamp < windowMs);
    if (recent.length >= limit) {
      hits.set(key, recent);
      return false;
    }
    recent.push(at);
    hits.set(key, recent);
    return true;
  }

  return { attempt };
}
