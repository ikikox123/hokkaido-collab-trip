import test from 'node:test';
import assert from 'node:assert/strict';
import { createRegisterRateLimiter } from './registerRateLimit.js';

const HOUR_MS = 60 * 60 * 1000;

test('one IP can register five times per hour and a sixth waits', () => {
  let now = 1_000_000;
  const limiter = createRegisterRateLimiter({ now: () => now });
  for (let i = 0; i < 5; i += 1) assert.equal(limiter.attempt('203.0.113.10'), true);
  assert.equal(limiter.attempt('203.0.113.10'), false);
  assert.equal(limiter.attempt('203.0.113.11'), true);
  now += HOUR_MS;
  assert.equal(limiter.attempt('203.0.113.10'), true);
});

test('checking the limit drops expired IP entries', () => {
  let now = 5_000;
  const limiter = createRegisterRateLimiter({ now: () => now });
  assert.equal(limiter.attempt('203.0.113.10'), true);
  assert.equal(limiter.attempt('203.0.113.11'), true);
  assert.equal(limiter.size(), 2);
  now += HOUR_MS;
  assert.equal(limiter.attempt('203.0.113.12'), true);
  assert.equal(limiter.size(), 1);
});
