import { isTripMember, memberAddAllowed } from './split.js';

/**
 * Same rule as member:add. Kept as its own name so trip:addMember cannot drift.
 */
export function tripMemberAddAllowed(state, callerId, accountId) {
  return memberAddAllowed(state, callerId, accountId);
}

/** Socket ack and HTTP 403 when a logged-in account is not on the companion list. */
export const NOT_COMPANION_ERROR = '你還不是這趟行程的旅伴';

/**
 * Read access for the collaborative trip.
 * Uses the same membership test as requireTripMember (`isTripMember`).
 * An empty companion list is the only exception, so the first logged-in
 * account can still open the trip and add themself.
 */
export function collaborativeTripReadable(state, accountId) {
  const members = Array.isArray(state?.members) ? state.members : [];
  if (members.length === 0) return true;
  return isTripMember(state, accountId);
}
