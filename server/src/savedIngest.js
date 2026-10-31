/**
 * The ingest pipeline, shared by the Worker and the tests: page fetch (allow-list only), extraction
 * (AI with heuristic fallback), then a free Nominatim lookup. Everything outside is injected.
 */
import { canonicalSourceUrl, extractHtmlMeta, buildExtractionInput, heuristicExtract, aiExtract, decideExtraction } from './savedPlace.js';
import { checkFetchUrl, fetchPage } from './safeFetch.js';

/**
 * Returns { sourceUrl, fetched: 'ok'|'failed'|'skipped', fields, via, geo }.
 * `fields` has name/country/city/district/type/confidence/status; `geo` is { lat, lng, address } or null.
 */
export async function runIngest({ url, text, ai, model, fetchImpl, geocode }) {
  const cleanUrl = url ? canonicalSourceUrl(url) : '';
  const allowed = cleanUrl ? checkFetchUrl(cleanUrl).ok : false;
  let meta = null;
  let fetched = 'skipped';
  if (allowed) {
    const page = await fetchPage(cleanUrl, { fetchImpl });
    if (page.ok) {
      meta = extractHtmlMeta(page.html);
      fetched = 'ok';
    } else {
      fetched = 'failed';
    }
  }
  const input = buildExtractionInput({ meta, text });
  const heuristic = heuristicExtract({ meta, text });
  const aiResult = input ? await aiExtract(ai, input, model) : null;
  const decided = decideExtraction({ ai: aiResult, heuristic, text: text || cleanUrl });
  const { status, via, ...fields } = decided;
  let geo = null;
  if (geocode && fields.name && (via === 'ai' || fields.confidence >= 0.35)) {
    try {
      geo = await geocode(fields);
    } catch {
      geo = null;
    }
  }
  return { sourceUrl: allowed ? cleanUrl : '', fetched, fields, status, via, geo, rejectedUrl: Boolean(url) && !allowed };
}
