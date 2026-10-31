/**
 * The ingest pipeline, shared by the Worker and the tests: page fetch (allow-list only), extraction
 * (AI with heuristic fallback), then a free Nominatim lookup. Everything outside is injected.
 */
import { canonicalSourceUrl, extractHtmlMeta, buildExtractionInput, heuristicExtract, aiExtract, decideExtraction, statusWithGeo, resolveDistrict } from './savedPlace.js';
import { checkFetchUrl, fetchPage } from './safeFetch.js';

/**
 * Returns { sourceUrl, fetched: 'ok'|'failed'|'skipped', fields, via, ai: 'unbound'|'error'|'answered'|'skipped' (skipped: bound but nothing to send), geo }.
 * `fields` has name/country/city/district/type/confidence/status; `geo` is { lat, lng, address, precision } or null.
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
  // aiExtract swallows errors, so watch the binding to tell "no AI" from "AI failed" from "AI answered".
  let aiState = ai && typeof ai.run === 'function' ? 'skipped' : 'unbound';
  const watched =
    aiState === 'unbound'
      ? ai
      : {
          async run(...args) {
            try {
              const answer = await ai.run(...args);
              aiState = 'answered';
              return answer;
            } catch (error) {
              aiState = 'error';
              throw error;
            }
          },
        };
  const aiResult = input ? await aiExtract(watched, input, model) : null;
  const decided = decideExtraction({ ai: aiResult, heuristic, text: text || cleanUrl });
  const { status, via, streetAddress, ...fields } = decided;
  let geo = null;
  if (geocode && fields.name && (via === 'ai' || fields.confidence >= 0.35)) {
    try {
      geo = await geocode({ ...fields, streetAddress });
    } catch {
      geo = null;
    }
  }
  // A pasted street address that Nominatim found is the exact spot: no need for a human look.
  const byAddress = geo?.matched === 'address' && geo.precision === 'place';
  const area = resolveDistrict(fields, geo, byAddress ? 'ready' : statusWithGeo(status, geo));
  return { sourceUrl: allowed ? cleanUrl : '', fetched, fields: { ...fields, district: area.district }, status: area.status, via, ai: aiState, geo, rejectedUrl: Boolean(url) && !allowed };
}
