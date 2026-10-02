/**
 * Hokkaido weather warnings from the JMA disaster-XML PULL Atom feeds.
 * https://xml.kishou.go.jp/xmlpull.html
 *
 * High-frequency extra.xml covers roughly the last 10 minutes. The long feed
 * extra_l.xml is read when we do not yet have a bulletin, or at a long interval,
 * so a warning issued earlier is not missed. Each bulletin URL is immutable and
 * is downloaded at most once per process. Results are cached and not polled in
 * a loop — refresh happens when /api/trip-alerts is requested after the TTL.
 *
 * Warning names are kept as published. This module only selects trip municipalities.
 */

import { assertFinalHost, fetchRemote, headerValue } from './remoteFetch.js';

export const JMA_PULL_PAGE = 'https://xml.kishou.go.jp/xmlpull.html';
export const JMA_EXTRA_FEED = 'https://www.data.jma.go.jp/developer/xml/feed/extra.xml';
export const JMA_EXTRA_LONG_FEED = 'https://www.data.jma.go.jp/developer/xml/feed/extra_l.xml';
export const JMA_TTL_MS = 5 * 60 * 1000;
export const JMA_LONG_INTERVAL_MS = 6 * 60 * 60 * 1000;
export const JMA_FAILURE_COOLDOWN_MS = 30 * 1000;
const FEED_MAX_CHARS = 8_000_000;
const BULLETIN_MAX_CHARS = 2_000_000;

/** Offices that publish warnings for the trip (Sapporo/Otaru/Chitose and Asahikawa/Biei/Furano). */
export const JMA_OFFICES = ['016000', '012000'];

export const TRIP_AREAS = [
  { id: 'sapporo', name: '札幌', municipality: '札幌市', office: '016000' },
  { id: 'otaru', name: '小樽', municipality: '小樽市', office: '016000' },
  { id: 'chitose', name: '千歲', municipality: '千歳市', office: '016000' },
  { id: 'asahikawa', name: '旭川', municipality: '旭川市', office: '012000' },
  { id: 'biei', name: '美瑛', municipality: '美瑛町', office: '012000' },
  { id: 'furano', name: '富良野', municipality: '富良野市', office: '012000' },
  { id: 'nakafurano', name: '中富良野', municipality: '中富良野町', office: '012000' },
];

const LEVEL_ORDER = { special: 0, warning: 1, advisory: 2, other: 3 };

const defaultCache = createJmaCache();
let defaultInflight = null;

export function createJmaCache() {
  return {
    fresh: null,
    publicResult: null,
    nextTryMs: 0,
    longCheckedAt: 0,
    bulletins: {},
    files: {},
    feeds: { short: { etag: null }, long: { etag: null } },
  };
}

export function warningLevel(name) {
  if (name.includes('特別警報')) return 'special';
  if (name.endsWith('警報')) return 'warning';
  if (name.endsWith('注意報')) return 'advisory';
  return 'other';
}

export function warningStatusLabel(status) {
  if (status === '発表') return '發布';
  if (status === '継続') return '持續';
  return status || '';
}

function decodeXml(value) {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();
}

export function isAllowedBulletinUrl(url) {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === 'https:' &&
      parsed.hostname === 'www.data.jma.go.jp' &&
      parsed.pathname.startsWith('/developer/xml/data/') &&
      /VPWW53_\d+\.xml$/.test(parsed.pathname)
    );
  } catch {
    return false;
  }
}

function isActiveStatus(status) {
  if (!status) return true;
  if (status.includes('なし') || status.includes('解除')) return false;
  return true;
}

/** Latest VPWW53 link per office code. Other bulletin types are ignored. */
export function latestVpww53Links(feedXml, officeCodes = JMA_OFFICES) {
  const wanted = new Set(officeCodes);
  const best = new Map();
  const chunks = String(feedXml).split('</entry>');
  for (const chunk of chunks) {
    const href = chunk.match(/<link\b[^>]*\shref="([^"]+)"/i);
    if (!href) continue;
    const url = href[1];
    if (!isAllowedBulletinUrl(url)) continue;
    const office = url.match(/VPWW53_(\d+)\.xml$/)?.[1];
    if (!office || !wanted.has(office)) continue;
    const updated = chunk.match(/<updated>([^<]+)<\/updated>/)?.[1]?.trim() || '';
    const prev = best.get(office);
    if (!prev || updated > prev.updated) best.set(office, { office, url, updated });
  }
  return [...best.values()];
}

export function parseWarningBulletin(xml) {
  const text = String(xml);
  const headlineRaw = text.match(/<Headline>[\s\S]*?<Text>([^<]*)<\/Text>/)?.[1] || '';
  const office = decodeXml(text.match(/<PublishingOffice>([^<]*)<\/PublishingOffice>/)?.[1] || '');
  const block = text.match(/<Warning type="気象警報・注意報（市町村等）">([\s\S]*?)<\/Warning>/);
  const byMunicipality = {};
  if (block) {
    for (const item of block[1].split('<Item>').slice(1)) {
      const areaName = item.match(/<Area>[\s\S]*?<Name>([^<]+)<\/Name>/)?.[1];
      if (!areaName) continue;
      const name = decodeXml(areaName);
      if (!byMunicipality[name]) byMunicipality[name] = [];
      for (const kindChunk of item.split('<Kind>').slice(1)) {
        const kind = kindChunk.split('</Kind>')[0];
        const kindName = decodeXml(kind.match(/<Name>([^<]+)<\/Name>/)?.[1] || '');
        const status = decodeXml(kind.match(/<Status>([^<]+)<\/Status>/)?.[1] || '');
        if (!kindName || !isActiveStatus(status)) continue;
        byMunicipality[name].push({
          name: kindName,
          status,
          statusLabel: warningStatusLabel(status),
          level: warningLevel(kindName),
        });
      }
    }
  }
  return { headline: decodeXml(headlineRaw), office, byMunicipality };
}

function dedupeKinds(kinds) {
  const seen = new Set();
  const out = [];
  for (const kind of kinds) {
    const key = `${kind.name}\0${kind.status}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(kind);
  }
  return out.sort((a, b) => (LEVEL_ORDER[a.level] ?? 9) - (LEVEL_ORDER[b.level] ?? 9));
}

export function summarizeTripWarnings(bulletins) {
  const areas = TRIP_AREAS.map((area) => {
    const parsed = bulletins[area.office]?.parsed;
    const list = parsed?.byMunicipality?.[area.municipality];
    if (!parsed || !list) {
      return { id: area.id, name: area.name, confirmed: false, active: [] };
    }
    return { id: area.id, name: area.name, confirmed: true, active: dedupeKinds(list) };
  });

  const headlines = [];
  const seenText = new Set();
  for (const office of JMA_OFFICES) {
    const parsed = bulletins[office]?.parsed;
    if (!parsed?.headline) continue;
    const hasActive = TRIP_AREAS.some(
      (area) => area.office === office && areas.find((item) => item.id === area.id)?.active.length,
    );
    if (!hasActive || seenText.has(parsed.headline)) continue;
    seenText.add(parsed.headline);
    headlines.push({ office: parsed.office || office, text: parsed.headline });
  }

  return { areas, headlines };
}

function errorResult() {
  return {
    ok: false,
    stale: false,
    partial: false,
    calm: false,
    fetchedAt: null,
    sourceUrl: JMA_PULL_PAGE,
    areas: [],
    headlines: [],
    error: '警報暫時無法更新',
  };
}

function applyFeed(cache, xml) {
  for (const link of latestVpww53Links(xml)) {
    const prev = cache.bulletins[link.office];
    if (!prev || link.updated > prev.updated) {
      if (!prev || prev.url !== link.url) {
        cache.bulletins[link.office] = { url: link.url, updated: link.updated, parsed: null };
      } else {
        prev.updated = link.updated;
      }
    }
  }
}

async function readFeed(url, slot, options) {
  const res = await fetchRemote(url, {
    fetchImpl: options.fetchImpl,
    timeoutMs: options.timeoutMs ?? 20000,
    etag: slot.etag,
  });
  assertFinalHost(res, 'www.data.jma.go.jp');
  if (res.status === 304) return { xml: null, confirmed: true };
  if (!res.ok) throw new Error(`jma feed ${res.status}`);
  const xml = await res.text();
  if (xml.length > FEED_MAX_CHARS) throw new Error('jma feed too large');
  if (!xml.includes('<feed')) throw new Error('jma feed not xml');
  slot.etag = headerValue(res, 'etag');
  return { xml, confirmed: true };
}

async function readBulletin(url, cache, options) {
  if (!isAllowedBulletinUrl(url)) throw new Error('bulletin url rejected');
  if (cache.files[url]) return cache.files[url];
  const res = await fetchRemote(url, {
    fetchImpl: options.fetchImpl,
    timeoutMs: options.timeoutMs ?? 15000,
  });
  assertFinalHost(res, 'www.data.jma.go.jp');
  if (!res.ok) throw new Error(`jma bulletin ${res.status}`);
  const xml = await res.text();
  if (xml.length > BULLETIN_MAX_CHARS) throw new Error('jma bulletin too large');
  if (!xml.includes('<Report')) throw new Error('jma bulletin not xml');
  cache.files[url] = xml;
  return xml;
}

async function refreshJma(cache, options) {
  const nowMs = options.nowMs;
  const warn = options.warn ?? ((message) => console.warn(message));
  try {
    let confirmed = false;
    try {
      const short = await readFeed(JMA_EXTRA_FEED, cache.feeds.short, options);
      confirmed = short.confirmed;
      if (short.xml) applyFeed(cache, short.xml);
    } catch (err) {
      warn(`[jma] short feed failed: ${err.message || err}`);
    }

    const missing = JMA_OFFICES.filter((office) => !cache.bulletins[office]);
    const longInterval = options.longIntervalMs ?? JMA_LONG_INTERVAL_MS;
    const longDue = !cache.longCheckedAt || nowMs - cache.longCheckedAt >= longInterval;
    if (missing.length || longDue) {
      try {
        const long = await readFeed(JMA_EXTRA_LONG_FEED, cache.feeds.long, options);
        cache.longCheckedAt = nowMs;
        confirmed = confirmed || long.confirmed;
        if (long.xml) applyFeed(cache, long.xml);
      } catch (err) {
        warn(`[jma] long feed failed: ${err.message || err}`);
        if (missing.length && !cache.fresh) throw err;
      }
    }
    if (!confirmed) throw new Error('jma feeds unavailable');

    for (const office of JMA_OFFICES) {
      const bulletin = cache.bulletins[office];
      if (!bulletin || bulletin.parsed) continue;
      const xml = await readBulletin(bulletin.url, cache, options);
      bulletin.parsed = parseWarningBulletin(xml);
    }

    const summary = summarizeTripWarnings(cache.bulletins);
    if (!summary.areas.some((area) => area.confirmed)) {
      throw new Error('no hokkaido warning bulletins');
    }
    const result = {
      ok: true,
      stale: false,
      partial: summary.areas.some((area) => !area.confirmed),
      calm: summary.areas.every((area) => area.confirmed && area.active.length === 0),
      fetchedAt: options.now().toISOString(),
      sourceUrl: JMA_PULL_PAGE,
      areas: summary.areas,
      headlines: summary.headlines,
    };
    cache.fresh = result;
    cache.publicResult = result;
    cache.nextTryMs = nowMs + (options.ttlMs ?? JMA_TTL_MS);
    return result;
  } catch (err) {
    warn(`[jma] ${err.message || err}`);
    const cooldown = options.failureCooldownMs ?? JMA_FAILURE_COOLDOWN_MS;
    if (cache.fresh) {
      const stale = { ...cache.fresh, stale: true };
      cache.publicResult = stale;
      cache.nextTryMs = nowMs + cooldown;
      return stale;
    }
    const failed = errorResult();
    cache.publicResult = failed;
    cache.nextTryMs = nowMs + cooldown;
    return failed;
  }
}

export async function getJmaWarnings(options = {}) {
  const cache = options.cache ?? defaultCache;
  const now = options.now ?? (() => new Date());
  const nowMs = now().getTime();
  if (cache.publicResult && nowMs < cache.nextTryMs) return cache.publicResult;

  const run = () => refreshJma(cache, { ...options, now, nowMs });
  if (cache === defaultCache) {
    if (!defaultInflight) {
      defaultInflight = run().finally(() => {
        defaultInflight = null;
      });
    }
    return defaultInflight;
  }
  return run();
}
