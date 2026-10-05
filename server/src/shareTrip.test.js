import test from 'node:test';
import assert from 'node:assert/strict';
import { toPublicShare } from './shareTrip.js';

const FORBIDDEN_KEYS = [
  'members',
  'username',
  'userId',
  'expenses',
  'settlements',
  'fx',
  'flights',
  'roomCode',
  'legs',
  'password',
  'passwordHash',
  'token',
  'updatedAt',
];

function collectKeys(value, found = new Set()) {
  if (!value || typeof value !== 'object') return found;
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, found);
    return found;
  }
  for (const [key, child] of Object.entries(value)) {
    found.add(key);
    collectKeys(child, found);
  }
  return found;
}

test('public share keeps only itinerary fields', () => {
  const shared = toPublicShare({
    roomCode: 'HOKKAIDO2027',
    tripName: '測試行程｜6 人',
    lodging: {
      name: 'Minn',
      address: '南1条',
      lat: 43.1,
      lng: 141.3,
      secret: 'lodging-secret',
    },
    flights: { outbound: 'secret-flight', inbound: 'secret-return' },
    days: [{ day: 1, date: '2027-02-12', label: 'D1 抵達', note: 'hidden-day' }],
    stops: [{
      id: 's1',
      day: 1,
      date: '2027-02-12',
      title: '札幌時計台',
      time: '10:00',
      notes: '集合',
      lat: 43.2,
      lng: 141.4,
      secret: 'stop-secret',
      members: [{ id: 'u1', username: 'alice' }],
    }],
    members: [{ id: 'u1', username: 'alice', displayName: 'Alice' }],
    expenses: [{ id: 'e1', note: 'secret expense', payerId: 'u1' }],
    settlements: [{ id: 'st1', payerId: 'u1', payeeId: 'u2' }],
    fx: { quote: { twdPerJpy: 0.2 } },
    legs: [{ id: 'leg1', summary: 'hidden leg' }],
    username: 'alice',
    updatedAt: '2020-01-01T00:00:00.000Z',
  });

  assert.deepEqual(shared, {
    tripName: '測試行程｜6 人',
    lodging: { name: 'Minn', address: '南1条', lat: 43.1, lng: 141.3 },
    days: [{ day: 1, date: '2027-02-12', label: 'D1 抵達' }],
    stops: [{
      id: 's1',
      day: 1,
      date: '2027-02-12',
      title: '札幌時計台',
      time: '10:00',
      notes: '集合',
      lat: 43.2,
      lng: 141.4,
    }],
  });

  const keys = collectKeys(shared);
  for (const key of FORBIDDEN_KEYS) assert.equal(keys.has(key), false, key);
  const body = JSON.stringify(shared);
  assert.equal(body.includes('alice'), false);
  assert.equal(body.includes('secret'), false);
  assert.equal(body.includes('u1'), false);
});
