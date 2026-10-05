import test from 'node:test';
import assert from 'node:assert/strict';
import { memberAddAllowed } from './split.js';
import { collaborativeTripReadable, tripMemberAddAllowed } from './memberAccess.js';

test('self-join is only allowed while the roster is empty', () => {
  const empty = { members: [] };
  assert.equal(memberAddAllowed(empty, 'u1', 'u1').ok, true);
  assert.deepEqual(tripMemberAddAllowed(empty, 'u1', 'u1'), memberAddAllowed(empty, 'u1', 'u1'));
  const addingOther = memberAddAllowed(empty, 'u1', 'u2');
  assert.equal(addingOther.ok, false);
  assert.equal(addingOther.error, '只有這趟行程的旅伴可以這樣做');

  const occupied = { members: [{ id: 'u1' }, { id: 'u2' }] };
  const self = memberAddAllowed(occupied, 'u3', 'u3');
  assert.equal(self.ok, false);
  assert.equal(self.error, '只有這趟行程的旅伴可以這樣做');
  assert.deepEqual(tripMemberAddAllowed(occupied, 'u3', 'u3'), self);
  assert.equal(memberAddAllowed(occupied, 'u1', 'u3').ok, true);
  assert.equal(tripMemberAddAllowed(occupied, 'u2', 'u9').ok, true);
});

test('collaborative read uses companion membership, with an empty-list exception', () => {
  assert.equal(collaborativeTripReadable({ members: [] }, 'u1'), true);
  assert.equal(collaborativeTripReadable({ members: [] }, ''), true);
  assert.equal(collaborativeTripReadable({}, 'u1'), true);
  const occupied = { members: [{ id: 'u2' }] };
  assert.equal(collaborativeTripReadable(occupied, 'u2'), true);
  assert.equal(collaborativeTripReadable(occupied, 'u1'), false);
  assert.equal(collaborativeTripReadable(occupied, ''), false);
});