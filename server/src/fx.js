/**
 * Live JPY↔TWD quote from Yahoo Finance's public chart endpoint (no API key).
 * Forex prints update through the trading day; the last print stays put when
 * the market is closed. A failed refresh keeps the previous good quote.
 */

const ENDPOINTS = [
  'https://query1.finance.yahoo.com/v8/finance/chart/JPYTWD=X?interval=1m&range=1d',
  'https://query2.finance.yahoo.com/v8/finance/chart/JPYTWD=X?interval=1m&range=1d',
];

export const FX_PROVIDER = 'yahoo-finance';
export const FX_PROVIDER_LABEL = 'Yahoo Finance';

function roundRate(value) {
  return Math.round(value * 1e8) / 1e8;
}

export function parseYahooChart(body, now = new Date()) {
  const meta = body?.chart?.result?.[0]?.meta;
  if (!meta || meta.instrumentType !== 'CURRENCY' || meta.currency !== 'TWD' || meta.symbol !== 'JPYTWD=X') {
    throw new Error('匯率內容無法解析');
  }
  const price = Number(meta.regularMarketPrice);
  if (!Number.isFinite(price) || price <= 0) throw new Error('匯率內容無法解析');
  if (price < 0.05 || price > 1) throw new Error('匯率超出合理範圍');
  const marketUnix = Number(meta.regularMarketTime);
  const twdPerJpy = roundRate(price);
  return {
    twdPerJpy,
    jpyPerTwd: roundRate(1 / twdPerJpy),
    marketTime: Number.isFinite(marketUnix) ? new Date(marketUnix * 1000).toISOString() : null,
    fetchedAt: now.toISOString(),
    provider: FX_PROVIDER,
    providerLabel: FX_PROVIDER_LABEL,
  };
}

export async function fetchLiveRate(fetchImpl = fetch, now = new Date()) {
  let lastStatus = 0;
  for (const url of ENDPOINTS) {
    try {
      const res = await fetchImpl(url, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'Mozilla/5.0 (compatible; hokkaido-collab-trip/1.0)',
        },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) {
        lastStatus = res.status;
        continue;
      }
      return parseYahooChart(await res.json(), now);
    } catch (err) {
      if (err?.name === 'AbortError') lastStatus = 0;
    }
  }
  throw new Error(lastStatus ? `匯率來源回應 ${lastStatus}` : '匯率來源沒有回應');
}

function isRate(value) {
  return Number.isFinite(value) && value > 0;
}

function cleanQuote(quote) {
  if (!quote || !isRate(Number(quote.twdPerJpy))) return null;
  const twdPerJpy = roundRate(Number(quote.twdPerJpy));
  return {
    twdPerJpy,
    jpyPerTwd: isRate(Number(quote.jpyPerTwd)) ? roundRate(Number(quote.jpyPerTwd)) : roundRate(1 / twdPerJpy),
    marketTime: typeof quote.marketTime === 'string' ? quote.marketTime : null,
    fetchedAt: typeof quote.fetchedAt === 'string' ? quote.fetchedAt : null,
    provider: FX_PROVIDER,
    providerLabel: FX_PROVIDER_LABEL,
  };
}

function cleanOverride(override) {
  if (!override || !isRate(Number(override.twdPerJpy))) return null;
  const twdPerJpy = roundRate(Number(override.twdPerJpy));
  return {
    twdPerJpy,
    jpyPerTwd: isRate(Number(override.jpyPerTwd)) ? roundRate(Number(override.jpyPerTwd)) : roundRate(1 / twdPerJpy),
    setAt: typeof override.setAt === 'string' ? override.setAt : null,
    setBy: typeof override.setBy === 'string' ? override.setBy : '',
    setById: typeof override.setById === 'string' ? override.setById : '',
  };
}

export function normalizeFx(raw) {
  const quote = cleanQuote(raw?.quote);
  return {
    quote,
    override: cleanOverride(raw?.override),
    stale: Boolean(raw?.stale) && Boolean(quote),
    error: typeof raw?.error === 'string' ? raw.error : null,
  };
}

export function parseOverride(input) {
  const basis = input?.basis === 'jpyPerTwd' ? 'jpyPerTwd' : input?.basis === 'twdPerJpy' ? 'twdPerJpy' : null;
  if (!basis) return { ok: false, error: '請選擇匯率方向' };
  const text = String(input?.value ?? '').trim().replace(/,/g, '');
  if (!/^\d+(\.\d+)?$/.test(text)) return { ok: false, error: '請輸入大於 0 的匯率' };
  const numeric = Number(text);
  if (!Number.isFinite(numeric) || numeric <= 0) return { ok: false, error: '請輸入大於 0 的匯率' };
  const twdPerJpy = basis === 'twdPerJpy' ? numeric : 1 / numeric;
  if (twdPerJpy < 0.05 || twdPerJpy > 1) return { ok: false, error: '這個數字不像日圓兌新台幣，請確認方向' };
  const rounded = roundRate(twdPerJpy);
  return { ok: true, twdPerJpy: rounded, jpyPerTwd: roundRate(1 / rounded) };
}

export function presentFx(raw) {
  const fx = normalizeFx(raw);
  let effective = null;
  if (fx.override) {
    effective = {
      source: 'manual',
      twdPerJpy: fx.override.twdPerJpy,
      jpyPerTwd: fx.override.jpyPerTwd,
      at: fx.override.setAt,
      by: fx.override.setBy,
      stale: false,
      providerLabel: '手動匯率',
    };
  } else if (fx.quote) {
    effective = {
      source: 'live',
      twdPerJpy: fx.quote.twdPerJpy,
      jpyPerTwd: fx.quote.jpyPerTwd,
      at: fx.quote.fetchedAt,
      marketTime: fx.quote.marketTime,
      stale: fx.stale,
      providerLabel: fx.quote.providerLabel,
    };
  }
  return {
    quote: fx.quote,
    override: fx.override,
    stale: fx.stale,
    error: fx.error,
    effective,
  };
}

export function createFxBook(initial) {
  let current = normalizeFx(initial);
  let pending = null;
  let lastAttemptAt = 0;

  return {
    get() {
      return current;
    },
    async refresh(options = {}) {
      const minIntervalMs = options.minIntervalMs ?? 0;
      const force = Boolean(options.force);
      const now = Date.now();
      if (!force && now - lastAttemptAt < minIntervalMs) return current;
      if (pending) return pending;
      lastAttemptAt = now;
      pending = (async () => {
        try {
          const quote = await fetchLiveRate(options.fetchImpl, options.now ? new Date(options.now) : new Date());
          current = { ...current, quote, stale: false, error: null };
        } catch {
          current = {
            ...current,
            stale: Boolean(current.quote),
            error: current.quote ? '無法重新取得匯率，沿用上次成功的資料' : '目前拿不到匯率',
          };
        } finally {
          pending = null;
        }
        return current;
      })();
      return pending;
    },
    setOverride(override) {
      current = { ...current, override };
      return current;
    },
    clearOverride() {
      current = { ...current, override: null };
      return current;
    },
  };
}
