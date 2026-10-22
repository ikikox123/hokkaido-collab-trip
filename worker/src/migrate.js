/** Same rule as server/src/persist.js, without its fs import. */
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
