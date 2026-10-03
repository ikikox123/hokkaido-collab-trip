import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createFxBook,
  parseOverride,
  parseYahooChart,
  presentFx,
} from './fx.js';
import { convertMinor, crossSettlement, upsertExpense } from './split.js';

const yahoo = {
  chart: {
    result: [
      {
        meta: {
          currency: 'TWD',
          symbol: 'JPYTWD=X',
          instrumentType: 'CURRENCY',
          regularMarketPrice: 0.1992,
          regularMarketTime: 1790976665,
        },
      },
    ],
  },
};

test('Yahoo chart quote parses to both directions and a market timestamp', () => {
  const quote = parseYahooChart(yahoo, new Date('2026-10-03T06:00:00.000Z'));
  assert.equal(quote.twdPerJpy, 0.1992);
  assert.equal(quote.jpyPerTwd, Math.round((1 / 0.1992) * 1e8) / 1e8);
  assert.equal(quote.marketTime, '2026-10-02T21:31:05.000Z');
  assert.equal(quote.fetchedAt, '2026-10-03T06:00:00.000Z');
  assert.equal(quote.providerLabel, 'Yahoo Finance');
  assert.throws(() => parseYahooChart({ chart: { result: [{ meta: { currency: 'USD' } }] } }));
});

test('manual override wins and a failed refresh keeps the last quote', async () => {
  const book = createFxBook(null);
  const ok = await book.refresh({
    force: true,
    now: '2026-10-03T06:00:00.000Z',
    fetchImpl: async () => ({ ok: true, json: async () => yahoo }),
  });
  assert.equal(ok.quote.twdPerJpy, 0.1992);
  assert.equal(ok.stale, false);

  const failed = await book.refresh({
    force: true,
    fetchImpl: async () => {
      throw new Error('down');
    },
  });
  assert.equal(failed.quote.twdPerJpy, 0.1992);
  assert.equal(failed.quote.fetchedAt, '2026-10-03T06:00:00.000Z');
  assert.equal(failed.stale, true);
  assert.match(failed.error, /沿用上次/);

  const parsed = parseOverride({ basis: 'jpyPerTwd', value: '5' });
  assert.equal(parsed.ok, true);
  book.setOverride({
    twdPerJpy: parsed.twdPerJpy,
    jpyPerTwd: parsed.jpyPerTwd,
    setAt: '2026-10-03T07:00:00.000Z',
    setBy: 'Alice',
    setById: 'u1',
  });
  const view = presentFx(book.get());
  assert.equal(view.effective.source, 'manual');
  assert.equal(view.effective.twdPerJpy, 0.2);
  assert.equal(view.effective.by, 'Alice');
  assert.equal(view.quote.twdPerJpy, 0.1992);

  const empty = createFxBook(null);
  const missing = await empty.refresh({
    force: true,
    fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({}) }),
  });
  assert.equal(missing.quote, null);
  assert.equal(presentFx(missing).effective, null);
  assert.match(missing.error, /目前拿不到匯率/);
  assert.equal(missing.stale, false);
});

test('override rejects a rate pointed the wrong way', () => {
  assert.equal(parseOverride({ basis: 'twdPerJpy', value: '5' }).ok, false);
  assert.equal(parseOverride({ basis: 'twdPerJpy', value: '0' }).ok, false);
  assert.equal(parseOverride({ basis: 'twdPerJpy', value: '0.1992' }).ok, true);
});

test('conversion is display-only and both settlement directions use the same rate', () => {
  assert.equal(convertMinor(1000, 'JPY', 'TWD', 0.2), 20000);
  assert.equal(convertMinor(20000, 'TWD', 'JPY', 0.2), 1000);
  assert.equal(convertMinor(-500, 'JPY', 'TWD', 0.2), -10000);

  let state = {
    members: [
      { id: 'a', displayName: 'Alice' },
      { id: 'b', displayName: 'Bob' },
    ],
    expenses: [],
    days: [],
    stops: [],
  };
  state = upsertExpense(state, {
    payerId: 'a',
    currency: 'JPY',
    amount: 1000,
    mode: 'equal',
    memberIds: ['a', 'b'],
    note: '拉麵',
  }).state;
  state = upsertExpense(state, {
    payerId: 'b',
    currency: 'TWD',
    amount: 100,
    mode: 'equal',
    memberIds: ['a', 'b'],
    note: '伴手禮',
  }).state;

  const twd = crossSettlement(state, 'TWD', 0.2);
  const jpy = crossSettlement(state, 'JPY', 0.2);
  assert.deepEqual(
    Object.fromEntries(twd.nets.map((net) => [net.memberId, net.netMinor])),
    { a: 5000, b: -5000 },
  );
  assert.deepEqual(
    jpy.transfers.map((transfer) => [transfer.fromId, transfer.toId, transfer.amountMinor]),
    [['b', 'a', 250]],
  );
  assert.equal(
    twd.nets.reduce((sum, net) => sum + net.netMinor, 0),
    0,
  );
  assert.equal(
    jpy.nets.reduce((sum, net) => sum + net.netMinor, 0),
    0,
  );
});
