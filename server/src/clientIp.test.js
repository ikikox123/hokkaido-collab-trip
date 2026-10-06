import test from 'node:test';
import assert from 'node:assert/strict';
import { clientIp } from './clientIp.js';

function request({ realIp, forwarded, remoteAddress } = {}) {
  const headers = {};
  if (realIp !== undefined) headers['x-real-ip'] = realIp;
  if (forwarded !== undefined) headers['x-forwarded-for'] = forwarded;
  return { headers, socket: remoteAddress === undefined ? {} : { remoteAddress } };
}

test('uses X-Real-IP when present', () => {
  assert.equal(
    clientIp(request({
      realIp: ' 203.0.113.8, 10.0.0.2 ',
      forwarded: '198.51.100.1',
      remoteAddress: '127.0.0.1',
    })),
    '203.0.113.8',
  );
  assert.equal(
    clientIp(request({ realIp: '::ffff:203.0.113.9', remoteAddress: '10.0.0.1' })),
    '203.0.113.9',
  );
});

test('a client-supplied X-Forwarded-For does not affect the result', () => {
  assert.equal(
    clientIp(request({
      realIp: '203.0.113.8',
      forwarded: '198.51.100.77, 203.0.113.8',
      remoteAddress: '127.0.0.1',
    })),
    '203.0.113.8',
  );
  assert.equal(
    clientIp(request({ forwarded: '198.51.100.77', remoteAddress: '::ffff:127.0.0.1' })),
    '127.0.0.1',
  );
});

test('no X-Real-IP falls back to the socket address', () => {
  assert.equal(clientIp(request({ remoteAddress: '::ffff:192.0.2.10' })), '192.0.2.10');
  assert.equal(clientIp(request({ realIp: '  , 10.0.0.1 ', remoteAddress: '10.1.1.1' })), '10.1.1.1');
  assert.equal(clientIp(request({})), 'unknown');
});
