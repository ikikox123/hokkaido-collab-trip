import test from 'node:test';
import assert from 'node:assert/strict';
import { bearerToken, constantTimeEqual, generateSavedKey, isSavedKeyToken, KEY_ONLY_FOR_SAVING, parseSavedKey, savedKeyMatches, sha256Hex } from './savedKey.js';
import { createSavedRateLimiter } from './savedRateLimit.js';

test('keys are prefixed, high entropy, and unique', async () => {
  const a = await generateSavedKey();
  const b = await generateSavedKey();
  assert.match(a.key, /^hks_[0-9a-f]{16}_[A-Za-z0-9_-]{43}$/);
  assert.equal(a.keyId.length, 16);
  assert.notEqual(a.key, b.key);
  const parsed = parseSavedKey(a.key);
  assert.equal(parsed.keyId, a.keyId);
  assert.equal(await sha256Hex(parsed.secret), a.hash);
  assert.ok(!a.hash.includes(parsed.secret));
});

test('matching uses the stored hash only', async () => {
  const { key, hash } = await generateSavedKey();
  const { secret } = parseSavedKey(key);
  assert.equal(await savedKeyMatches(secret, hash), true);
  assert.equal(await savedKeyMatches(secret + 'x', hash), false);
  assert.equal(await savedKeyMatches('', hash), false);
});

test('malformed keys and headers are rejected', () => {
  for (const bad of [null, '', 'hks_', 'abc', 'hks_zzzzzzzz_' + 'a'.repeat(43), 'hks_00000000_' + 'a'.repeat(42), 'eyJhbGciOi.a.b']) {
    assert.equal(parseSavedKey(bad), null, String(bad));
  }
  assert.equal(bearerToken('Bearer abc'), 'abc');
  assert.equal(bearerToken('Basic abc'), null);
  assert.equal(bearerToken(null), null);
});

test('constantTimeEqual compares whole strings', () => {
  assert.equal(constantTimeEqual('abc', 'abc'), true);
  assert.equal(constantTimeEqual('abc', 'abd'), false);
  assert.equal(constantTimeEqual('abc', 'abcd'), false);
});

test('rate limiter: 10 per minute, 200 per day, windows reset', () => {
  let t = 1_000_000;
  const limiter = createSavedRateLimiter({ now: () => t });
  for (let i = 0; i < 10; i++) assert.equal(limiter.attempt('k').ok, true);
  const blocked = limiter.attempt('k');
  assert.equal(blocked.ok, false);
  assert.ok(blocked.retryAfterSec >= 1 && blocked.retryAfterSec <= 60);
  assert.equal(limiter.attempt('other').ok, true, 'keys are independent');
  t += 61_000;
  assert.equal(limiter.attempt('k').ok, true);
  let day = 0;
  for (let minute = 0; minute < 40; minute++) {
    t += 61_000;
    for (let i = 0; i < 10; i++) if (limiter.attempt('k').ok) day += 1;
  }
  assert.ok(day <= 199, `day cap holds (${day})`);
  t += 61_000;
  assert.equal(limiter.attempt('k').ok, false);
  t += 24 * 60 * 60 * 1000;
  assert.equal(limiter.attempt('k').ok, true);
});

test('keys with the older 8-hex id still parse', () => {
  const old = `hks_0a1b2c3d_${'a'.repeat(43)}`;
  assert.deepEqual(parseSavedKey(old), { keyId: '0a1b2c3d', secret: 'a'.repeat(43) });
  assert.equal(parseSavedKey(`hks_0a1b2c_${'a'.repeat(43)}`), null);
  assert.equal(parseSavedKey(`hks_${'0'.repeat(33)}_${'a'.repeat(43)}`), null);
});

test('a Shortcut key is recognised where a login token belongs, with a clear message', async () => {
  const { key } = await generateSavedKey();
  assert.equal(isSavedKeyToken(key), true);
  assert.equal(isSavedKeyToken('eyJhbGciOi.payload.sig'), false);
  assert.equal(isSavedKeyToken(null), false);
  assert.equal(KEY_ONLY_FOR_SAVING, '這把金鑰只能用來收藏');
});
