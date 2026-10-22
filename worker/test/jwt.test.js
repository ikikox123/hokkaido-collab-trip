import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { signJwt, verifyJwt } from '../src/jwt.js';

// The Railway server's jsonwebtoken, so old and new tokens stay interchangeable.
const jwt = createRequire(new URL('../../server/package.json', import.meta.url))('jsonwebtoken');
const secret = 'test-secret';
const user = { id: 'u_0123456789abcdef', username: 'yuki', displayName: 'Yuki' };

test('a jsonwebtoken token verifies in the Worker', async () => {
  const token = jwt.sign(user, secret, { expiresIn: '7d' });
  const payload = await verifyJwt(token, secret);
  assert.equal(payload.id, user.id);
  assert.equal(payload.displayName, 'Yuki');
});

test('a Worker token verifies with jsonwebtoken', async () => {
  const token = await signJwt(user, secret);
  const payload = jwt.verify(token, secret);
  assert.equal(payload.username, 'yuki');
  assert.equal(payload.exp - payload.iat, 7 * 24 * 60 * 60);
});

test('wrong secret, tampering, expiry, and alg=none are rejected', async () => {
  const token = await signJwt(user, secret);
  assert.equal(await verifyJwt(token, 'other'), null);
  const [h, , s] = token.split('.');
  const forged = Buffer.from(JSON.stringify({ ...user, id: 'u1' })).toString('base64url');
  assert.equal(await verifyJwt(`${h}.${forged}.${s}`, secret), null);
  const old = await signJwt(user, secret, { now: Date.now() - 8 * 24 * 60 * 60 * 1000 });
  assert.equal(await verifyJwt(old, secret), null);
  const none = `${Buffer.from('{"alg":"none"}').toString('base64url')}.${forged}.`;
  assert.equal(await verifyJwt(none, secret), null);
  assert.equal(await verifyJwt('garbage', secret), null);
});
