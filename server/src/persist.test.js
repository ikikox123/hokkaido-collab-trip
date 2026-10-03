import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { loadPersistedTrip, migrateSplitFields, shouldApplySeedCorrection } from './persist.js';

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'hokkaido-state-'));
}

const saved = {
  roomCode: 'HOKKAIDO2027',
  tripName: '已編輯的行程',
  updatedAt: '2026-10-03T06:26:11.377Z',
  days: [{ day: 1, date: '2027-02-12', label: '自訂第一天' }],
  stops: [{ id: 'custom-stop', day: 1, title: '使用者改過的站', lat: 43.1, lng: 141.3 }],
  legs: [{ id: 'leg-kept', fromStopId: 'a', toStopId: 'b', mode: 'walk' }],
  lodging: { name: '住過的飯店', lat: 43, lng: 141 },
  flights: { outbound: 'kept', inbound: 'kept' },
};

test('an existing state.json is kept and only empty split fields are added', () => {
  const dir = tempDir();
  const file = path.join(dir, 'state.json');
  fs.writeFileSync(file, JSON.stringify(saved));
  let seeded = false;
  const loaded = loadPersistedTrip({
    dataDir: dir,
    nodeEnv: 'production',
    createSeed: () => {
      seeded = true;
      throw new Error('seed must not run');
    },
  });
  assert.equal(seeded, false);
  assert.equal(loaded.source, 'file');
  assert.equal(loaded.state.updatedAt, saved.updatedAt);
  assert.deepEqual(loaded.state.stops, saved.stops);
  assert.deepEqual(loaded.state.days, saved.days);
  assert.deepEqual(loaded.state.legs, saved.legs);
  assert.deepEqual(loaded.state.lodging, saved.lodging);
  assert.deepEqual(loaded.state.flights, saved.flights);
  assert.deepEqual(loaded.state.members, []);
  assert.deepEqual(loaded.state.expenses, []);
  assert.deepEqual(loaded.state.settlements, []);
  assert.equal(loaded.state.fx.quote, null);
  assert.equal(loaded.state.fx.override, null);
  assert.equal(fs.readFileSync(file, 'utf8'), JSON.stringify(saved));
});

test('saved members, expenses, and fx are not replaced with defaults', () => {
  const dir = tempDir();
  const state = {
    ...saved,
    members: [{ id: 'friend', displayName: '旅伴' }],
    expenses: [{ id: 'e1' }],
    settlements: [{ id: 'st1', payerId: 'u1', payeeId: 'u2', amount: 500 }],
    fx: { quote: { twdPerJpy: 0.2 }, override: { twdPerJpy: 0.21 }, stale: false, error: null },
  };
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify(state));
  const loaded = loadPersistedTrip({
    dataDir: dir,
    nodeEnv: 'production',
    createSeed: () => {
      throw new Error('seed must not run');
    },
  });
  assert.deepEqual(loaded.state.members, state.members);
  assert.deepEqual(loaded.state.expenses, state.expenses);
  assert.deepEqual(loaded.state.settlements, state.settlements);
  assert.equal(loaded.state.fx.quote.twdPerJpy, 0.2);
  assert.equal(loaded.state.fx.override.twdPerJpy, 0.21);
});

test('production exits the loader when state.json is missing and does not seed or write', () => {
  const dir = tempDir();
  let seeded = false;
  assert.throws(
    () =>
      loadPersistedTrip({
        dataDir: dir,
        nodeEnv: 'production',
        createSeed: () => {
          seeded = true;
          return { stops: [{ id: 'seed' }] };
        },
      }),
    /Refusing to start: .*state\.json is missing and NODE_ENV=production/,
  );
  assert.equal(seeded, false);
  assert.equal(fs.existsSync(path.join(dir, 'state.json')), false);
});

test('a corrupt state.json is left in place in production and is not replaced', () => {
  const dir = tempDir();
  const file = path.join(dir, 'state.json');
  fs.writeFileSync(file, '{');
  assert.throws(
    () =>
      loadPersistedTrip({
        dataDir: dir,
        nodeEnv: 'production',
        createSeed: () => {
          throw new Error('seed must not run');
        },
      }),
    /could not be read/,
  );
  assert.equal(fs.readFileSync(file, 'utf8'), '{');
});

test('development may seed only when state.json is absent', () => {
  const dir = tempDir();
  const loaded = loadPersistedTrip({
    dataDir: dir,
    nodeEnv: 'development',
    createSeed: () => ({ stops: [{ id: 'seed-stop' }], members: [{ id: 'u1', displayName: 'Alice' }], expenses: [] }),
  });
  assert.equal(loaded.source, 'seed');
  assert.equal(loaded.state.stops[0].id, 'seed-stop');
  assert.equal(fs.existsSync(path.join(dir, 'state.json')), false);
});

test('a trip loaded from state.json does not run seed geocode correction', () => {
  assert.equal(shouldApplySeedCorrection('file'), false);
  assert.equal(shouldApplySeedCorrection('seed'), true);
});

test('migrateSplitFields does not invent members when the saved list is empty', () => {
  const migrated = migrateSplitFields({ ...saved, members: [], expenses: [] });
  assert.deepEqual(migrated.members, []);
  assert.deepEqual(migrated.stops, saved.stops);
});
