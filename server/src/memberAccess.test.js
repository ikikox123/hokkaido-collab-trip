import test from 'node:test';
import assert from 'node:assert/strict';
import { tripMemberAddAllowed } from './memberAccess.js';

test('an empty roster can accept the caller, and only a member can add someone else', () => {
  const empty = { members: [] };
  assert.equal(tripMemberAddAllowed(empty, 'u1', 'u1').ok, true);
  const blocked = tripMemberAddAllowed(empty, 'u1', 'u2');
  assert.equal(blocked.ok, false);
  assert.equal(blocked.error, '只有這趟行程的旅伴可以這樣做');

  const withAlice = { members: [{ id: 'u1' }] };
  assert.equal(tripMemberAddAllowed(withAlice, 'u1', 'u2').ok, true);
  assert.equal(tripMemberAddAllowed(withAlice, 'u2', 'u2').ok, false);
  assert.equal(tripMemberAddAllowed(withAlice, 'u2', 'u3').ok, false);
});
