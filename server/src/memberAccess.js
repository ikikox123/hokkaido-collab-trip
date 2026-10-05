import { memberAddAllowed } from './split.js';

/**
 * Same rule as member:add. Kept as its own name so trip:addMember cannot drift.
 */
export function tripMemberAddAllowed(state, callerId, accountId) {
  return memberAddAllowed(state, callerId, accountId);
}
