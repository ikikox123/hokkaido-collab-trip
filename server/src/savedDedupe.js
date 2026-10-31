/**
 * Saved-place duplicates, pure. Two levels:
 *   link  - the same post (tracking parameters, www., threads.net/threads.com, trailing slash do not matter; host is case-folded, the path is not: post codes are case-sensitive);
 *   shop  - same normalized name (category word stripped, case / width / spaces ignored) and either
 *           within SAME_SHOP_METERS of each other or the same stored address.
 * Rows only need { name, lat, lng, address, source_url }.
 */
import { canonicalSourceUrl, stripNameCategory } from './savedPlace.js';

export const SAME_SHOP_METERS = 100;

/** Comparable form of a source link, or '' when there is none. Tracking query parameters and the hash are dropped. */
export function sourceKey(input) {
  const canonical = canonicalSourceUrl(input);
  if (!canonical) return '';
  try {
    const url = new URL(canonical);
    const host = url.hostname.toLowerCase().replace(/^www\./, '').replace(/^threads\.com$/, 'threads.net');
    return `${host}${url.pathname}`.replace(/\/+$/, '');
  } catch {
    return '';
  }
}

/** Shop name without category word, case, spaces, punctuation and full/half-width differences. */
export function shopNameKey(name) {
  return stripNameCategory(String(name ?? ''))
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '');
}

export function distanceMeters(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

const hasPos = (p) => Number.isFinite(p?.lat) && Number.isFinite(p?.lng);
const addressKey = (p) => String(p?.address ?? '').normalize('NFKC').toLowerCase().replace(/\s+/g, '');

export function sameLink(a, b) {
  const key = sourceKey(a?.source_url);
  return Boolean(key) && key === sourceKey(b?.source_url);
}

export function sameShop(a, b) {
  const name = shopNameKey(a?.name);
  if (!name || name === '未命名' || name !== shopNameKey(b?.name)) return false;
  if (hasPos(a) && hasPos(b) && distanceMeters(a, b) < SAME_SHOP_METERS) return true;
  const address = addressKey(a);
  return Boolean(address) && address === addressKey(b);
}

/** First candidate that is the same post or the same shop; { row, by: 'link' | 'shop' } or null. */
export function findDuplicate(place, candidates) {
  for (const row of candidates) if (sameLink(place, row)) return { row, by: 'link' };
  for (const row of candidates) if (sameShop(place, row)) return { row, by: 'shop' };
  return null;
}
