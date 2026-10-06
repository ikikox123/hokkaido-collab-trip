/** In-memory register attempts. Nothing here is written to state.json or users.json. */

const HOUR_MS = 60 * 60 * 1000;

export function createRegisterRateLimiter({ limit = 5, windowMs = HOUR_MS, now = Date.now } = {}) {
  const hits = new Map();

  function prune(at) {
    for (const [storedIp, stamps] of hits) {
      const recent = stamps.filter((stamp) => at - stamp < windowMs);
      if (recent.length === 0) hits.delete(storedIp);
      else if (recent.length !== stamps.length) hits.set(storedIp, recent);
    }
  }

  function attempt(ip, at = now()) {
    prune(at);
    const key = typeof ip === 'string' && ip ? ip : 'unknown';
    const recent = hits.get(key) || [];
    if (recent.length >= limit) return false;
    recent.push(at);
    hits.set(key, recent);
    return true;
  }

  return {
    attempt,
    size() {
      return hits.size;
    },
  };
}
