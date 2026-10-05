import { isTripMember } from './split.js';

/**
 * trip:addMember gate.
 * An empty roster may still accept the caller themself. Every other add
 * requires the caller to already be a member of this trip.
 */
export function tripMemberAddAllowed(state, callerId, accountId) {
  const members = Array.isArray(state?.members) ? state.members : [];
  const emptySelf = members.length === 0
    && typeof callerId === 'string'
    && callerId.trim() !== ''
    && callerId === accountId;
  if (emptySelf) return { ok: true };
  if (!isTripMember(state, callerId)) {
    return { ok: false, error: '只有這趟行程的旅伴可以這樣做' };
  }
  return { ok: true };
}
