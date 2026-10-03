/**
 * Trip persistence.
 * Production reads data/state.json and refuses to start when it is missing.
 * Development may create a seed room only when that file is absent.
 * The live itinerary snapshot is not read, fetched, or stored by this module.
 */

import fs from 'fs';
import path from 'path';

export function migrateSplitFields(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    throw new Error('saved trip is not an object');
  }
  if (!Array.isArray(state.stops)) {
    throw new Error('saved trip has no stops array');
  }
  const next = { ...state };
  if (!Array.isArray(next.members)) next.members = [];
  if (!Array.isArray(next.expenses)) next.expenses = [];
  if (!Array.isArray(next.settlements)) next.settlements = [];
  if (!next.fx || typeof next.fx !== 'object' || Array.isArray(next.fx)) {
    next.fx = { quote: null, override: null, stale: false, error: null };
  }
  return next;
}

/** Seed geocode may run only for a room created from seed, never for state.json. */
export function shouldApplySeedCorrection(source) {
  return source !== 'file';
}

export function loadPersistedTrip({ dataDir, nodeEnv = process.env.NODE_ENV, createSeed, fsImpl = fs } = {}) {
  const stateFile = path.join(path.resolve(dataDir), 'state.json');
  if (fsImpl.existsSync(stateFile)) {
    let parsed;
    try {
      parsed = JSON.parse(fsImpl.readFileSync(stateFile, 'utf8'));
    } catch (err) {
      const error = new Error(
        `Refusing to start: ${stateFile} could not be read (${err.message}). Left the file in place and did not replace it with seed.`,
      );
      error.code = 'STATE_UNREADABLE';
      throw error;
    }
    try {
      return { source: 'file', stateFile, state: migrateSplitFields(parsed) };
    } catch (err) {
      const error = new Error(
        `Refusing to start: ${stateFile} is not a saved trip (${err.message}). Left the file in place and did not replace it with seed.`,
      );
      error.code = 'STATE_INVALID';
      throw error;
    }
  }

  if (nodeEnv === 'production') {
    const error = new Error(
      `Refusing to start: ${stateFile} is missing and NODE_ENV=production. Not calling createSeedState, not writing a seed file, and not serving.`,
    );
    error.code = 'STATE_MISSING';
    throw error;
  }

  if (typeof createSeed !== 'function') {
    throw new Error('createSeed is required when state.json is missing outside production');
  }
  return { source: 'seed', stateFile, state: createSeed() };
}
