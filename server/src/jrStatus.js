/**
 * JR Hokkaido operation summary from the public JSON the official site loads.
 *
 * The operation top page fetches ./json/top/top.json (Traditional Chinese pages
 * fetch top_tc.json) and renders status codes 0 / 1 / 2. robots.txt allows
 * /webunkou/ and only disallows retired paths. This module does not scrape HTML.
 * Area JSON is requested only when a status code is 1 (a disruption), and the
 * official honbun is shown verbatim. Cache is at least 5 minutes.
 *
 * If the JSON cannot be read, callers still get the official page URL.
 */

import { assertFinalHost, fetchRemote, headerValue } from './remoteFetch.js';

export const JR_OFFICIAL_URL = 'https://www3.jrhokkaido.co.jp/webunkou/';
export const JR_TOP_JSON = 'https://www3.jrhokkaido.co.jp/webunkou/json/top/top_tc.json';
export const JR_TTL_MS = 5 * 60 * 1000;
export const JR_FAILURE_COOLDOWN_MS = 30 * 1000;
const JSON_MAX_CHARS = 1_000_000;

/** Same codes the official page's public script labels in Traditional Chinese. */
export const JR_STATUS_LABEL = {
  0: '無停駛、延遲訊息',
  1: '停駛、延遲30分鐘以上、暫停行駛',
  2: '服務時間外',
};

const AREAS = [
  {
    id: 'spo',
    name: '札幌近郊',
    href: 'https://www3.jrhokkaido.co.jp/webunkou/area_spo_tc.html',
    file: '01',
    primary: true,
  },
  {
    id: 'doo',
    name: '道央',
    href: 'https://www3.jrhokkaido.co.jp/webunkou/area_doo_tc.html',
    file: '02',
    primary: true,
  },
  {
    id: 'dohoku',
    name: '道北',
    href: 'https://www3.jrhokkaido.co.jp/webunkou/area_dohoku_tc.html',
    file: '04',
    primary: true,
  },
  {
    id: 'donan',
    name: '道南',
    href: 'https://www3.jrhokkaido.co.jp/webunkou/area_donan_tc.html',
    file: '03',
    primary: false,
  },
  {
    id: 'doto',
    name: '道東',
    href: 'https://www3.jrhokkaido.co.jp/webunkou/area_doto_tc.html',
    file: '05',
    primary: false,
  },
  {
    id: 'shin',
    name: '北海道新幹線',
    href: 'https://www3.jrhokkaido.co.jp/webunkou/senku.html?id=24',
    file: '06',
    primary: false,
  },
];

const CALM_HONBUN = new Set([
  '目前沒有延遲訊息',
  '目前沒有延遲訊息。',
  '現在、遅れに関する情報はありません。',
  '現在、遅れに関する情報はありません',
]);

const defaultCache = createJrCache();
let defaultInflight = null;

export function createJrCache() {
  return { fresh: null, publicResult: null, nextTryMs: 0, etag: null };
}

export function jrStatusLabel(status) {
  if (status === 0 || status === 1 || status === 2) return JR_STATUS_LABEL[status];
  return '狀態不明，請看官方頁';
}

export function normalizeJrStatus(value) {
  const status = Number(value);
  if (status === 0 || status === 1 || status === 2) return status;
  return null;
}

/** Drop markup that sometimes arrives inside honbun. The words themselves stay. */
export function plainJrText(value) {
  return String(value || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function extractJrNotes(data, areaId) {
  const list = data?.today?.gaikyo;
  if (!Array.isArray(list)) return [];
  const notes = [];
  for (const item of list) {
    const title = plainJrText(item?.title || '');
    const honbun = plainJrText(item?.honbun || '');
    if (!title && !honbun) continue;
    const eikyo = item?.eikyo && typeof item.eikyo === 'object' ? item.eikyo : null;
    if (eikyo) {
      const flagged = Object.entries(eikyo).filter(([, value]) => value === 1 || value === '1');
      const mine = eikyo[areaId] === 1 || eikyo[areaId] === '1';
      if (flagged.length && !mine) continue;
    }
    if (!title && CALM_HONBUN.has(honbun)) continue;
    const text = [title, honbun].filter(Boolean).join('　');
    if (text && !notes.includes(text)) notes.push(text);
  }
  return notes;
}

function presentArea(area, todayStatus, tomorrowStatus, notes) {
  const status = normalizeJrStatus(todayStatus);
  const tomorrow = normalizeJrStatus(tomorrowStatus);
  return {
    id: area.id,
    name: area.name,
    status,
    label: jrStatusLabel(status),
    tomorrowStatus: tomorrow,
    tomorrowLabel: tomorrow === 1 ? jrStatusLabel(1) : '',
    href: area.href,
    notes,
  };
}

export function areasFromTop(data) {
  const today = data?.today?.status;
  if (!today || typeof today !== 'object') return null;
  const tomorrow = data?.tomorrow?.status && typeof data.tomorrow.status === 'object' ? data.tomorrow.status : {};
  const areas = [];
  for (const area of AREAS) {
    const status = normalizeJrStatus(today[area.id]);
    if (!area.primary && status !== 1) continue;
    if (!area.primary && !(area.id in today)) continue;
    areas.push(presentArea(area, today[area.id], tomorrow[area.id], []));
  }
  return {
    officialTime: typeof data.time === 'string' ? data.time : '',
    areas,
  };
}

function errorResult() {
  return {
    ok: false,
    stale: false,
    officialUrl: JR_OFFICIAL_URL,
    officialTime: '',
    fetchedAt: null,
    areas: [],
    error: '暫時無法取得運行摘要',
  };
}

function areaJsonUrl(file) {
  if (!/^\d{2}$/.test(file)) throw new Error('bad area file');
  return `https://www3.jrhokkaido.co.jp/webunkou/json/area/area_${file}_tc.json`;
}

async function readJson(url, options, etag) {
  const res = await fetchRemote(url, {
    fetchImpl: options.fetchImpl,
    timeoutMs: options.timeoutMs ?? 10000,
    etag,
  });
  assertFinalHost(res, 'www3.jrhokkaido.co.jp');
  if (res.status === 304) return { unchanged: true, etag: headerValue(res, 'etag') };
  if (!res.ok) throw new Error(`jr ${res.status}`);
  const text = await res.text();
  if (text.length > JSON_MAX_CHARS) throw new Error('jr payload too large');
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) throw new Error('jr payload not json');
  return { unchanged: false, etag: headerValue(res, 'etag'), data: JSON.parse(trimmed) };
}

async function refreshJr(cache, options) {
  const nowMs = options.nowMs;
  const warn = options.warn ?? ((message) => console.warn(message));
  try {
    const top = await readJson(JR_TOP_JSON, options, cache.etag);
    if (top.unchanged) {
      if (!cache.fresh) throw new Error('jr not modified without cache');
      const again = { ...cache.fresh, fetchedAt: options.now().toISOString(), stale: false };
      cache.fresh = again;
      cache.publicResult = again;
      cache.nextTryMs = nowMs + (options.ttlMs ?? JR_TTL_MS);
      cache.etag = top.etag || cache.etag;
      return again;
    }
    const parsed = areasFromTop(top.data);
    if (!parsed) throw new Error('jr status missing');
    cache.etag = top.etag || cache.etag;

    const areas = [];
    for (const area of parsed.areas) {
      let notes = [];
      if (area.status === 1) {
        const meta = AREAS.find((item) => item.id === area.id);
        try {
          const detail = await readJson(areaJsonUrl(meta.file), options);
          notes = extractJrNotes(detail.data, area.id);
        } catch (err) {
          warn(`[jr] area ${area.id} detail failed: ${err.message || err}`);
        }
      }
      areas.push({ ...area, notes });
    }

    const result = {
      ok: true,
      stale: false,
      officialUrl: JR_OFFICIAL_URL,
      officialTime: parsed.officialTime,
      fetchedAt: options.now().toISOString(),
      areas,
    };
    cache.fresh = result;
    cache.publicResult = result;
    cache.nextTryMs = nowMs + (options.ttlMs ?? JR_TTL_MS);
    return result;
  } catch (err) {
    warn(`[jr] ${err.message || err}`);
    const cooldown = options.failureCooldownMs ?? JR_FAILURE_COOLDOWN_MS;
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

export async function getJrStatus(options = {}) {
  const cache = options.cache ?? defaultCache;
  const now = options.now ?? (() => new Date());
  const nowMs = now().getTime();
  if (cache.publicResult && nowMs < cache.nextTryMs) return cache.publicResult;

  const run = () => refreshJr(cache, { ...options, now, nowMs });
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
