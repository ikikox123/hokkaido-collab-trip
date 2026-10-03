export const FX_PROVIDER: string;
export const FX_PROVIDER_LABEL: string;

export interface FxQuote {
  twdPerJpy: number;
  jpyPerTwd: number;
  marketTime: string | null;
  fetchedAt: string | null;
  provider: string;
  providerLabel: string;
}

export interface FxOverride {
  twdPerJpy: number;
  jpyPerTwd: number;
  setAt: string | null;
  setBy: string;
  setById: string;
}

export interface FxEffective {
  source: 'manual' | 'live';
  twdPerJpy: number;
  jpyPerTwd: number;
  at: string | null;
  by?: string;
  marketTime?: string | null;
  stale: boolean;
  providerLabel: string;
}

export interface FxState {
  quote: FxQuote | null;
  override: FxOverride | null;
  stale: boolean;
  error: string | null;
}

export interface FxView extends FxState {
  effective: FxEffective | null;
}

export function parseYahooChart(body: unknown, now?: Date): FxQuote;
export function fetchLiveRate(fetchImpl?: typeof fetch, now?: Date): Promise<FxQuote>;
export function normalizeFx(raw: unknown): FxState;
export function parseOverride(input: { basis?: string; value?: string | number }):
  | { ok: true; twdPerJpy: number; jpyPerTwd: number }
  | { ok: false; error: string };
export function presentFx(raw: unknown): FxView;
export function createFxBook(initial?: unknown): {
  get(): FxState;
  refresh(options?: {
    minIntervalMs?: number;
    force?: boolean;
    fetchImpl?: typeof fetch;
    now?: string | number | Date;
  }): Promise<FxState>;
  setOverride(override: FxOverride): FxState;
  clearOverride(): FxState;
};
