import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addMember,
  addSettlement,
  billToCsv,
  deleteExpense,
  deleteSettlement,
  ensureBill,
  formatMinor,
  fromMinor,
  isTripMember,
  memberAddAllowed,
  minTransfers,
  prepareExpense,
  removeMember,
  settlementOf,
  toMinor,
  upsertExpense,
} from './split.js';

const members = [
  { id: 'a', displayName: 'Alice' },
  { id: 'b', displayName: 'Bob' },
  { id: 'c', displayName: 'Cara' },
  { id: 'd', displayName: 'Dana' },
];

function trip(extra = {}) {
  return {
    members,
    expenses: [],
    days: [
      { day: 1, date: '2027-02-12', label: 'D1 抵達' },
      { day: 2, date: '2027-02-13', label: 'D2 札幌' },
    ],
    stops: [
      { id: 's6', day: 1, title: 'すすきの晚餐' },
      { id: 's8', day: 2, title: '札幌電視塔' },
    ],
    ...extra,
  };
}

function shareMap(expense) {
  return Object.fromEntries(expense.shares.map((share) => [share.memberId, share.amountMinor]));
}

function cleared(people, transfers) {
  const map = new Map(people.map((person) => [person.id, person.amount]));
  for (const transfer of transfers) {
    map.set(transfer.fromId, map.get(transfer.fromId) + transfer.amount);
    map.set(transfer.toId, map.get(transfer.toId) - transfer.amount);
  }
  return [...map.values()].every((value) => value === 0);
}

function bruteMinCount(amounts) {
  const arr = amounts.filter((amount) => amount !== 0);
  function dfs(start) {
    while (start < arr.length && arr[start] === 0) start += 1;
    if (start === arr.length) return 0;
    let min = Infinity;
    for (let other = start + 1; other < arr.length; other++) {
      if (arr[start] * arr[other] >= 0) continue;
      arr[other] += arr[start];
      min = Math.min(min, 1 + dfs(start + 1));
      arr[other] -= arr[start];
    }
    return min;
  }
  return dfs(0);
}

test('JPY rounds to 0 decimals and TWD to cents', () => {
  assert.equal(toMinor('100.4', 'JPY'), 100);
  assert.equal(toMinor('100.5', 'JPY'), 101);
  assert.equal(toMinor('10.234', 'TWD'), 1023);
  assert.equal(toMinor('10.235', 'TWD'), 1024);
  assert.equal(toMinor('10', 'TWD'), 1000);
  for (let minor = -2000; minor <= 20000; minor++) {
    assert.equal(toMinor(fromMinor(minor, 'TWD'), 'TWD'), minor);
    assert.equal(toMinor(fromMinor(minor, 'JPY'), 'JPY'), minor);
  }
});

test('equal split assigns leftover yen and cents to earlier people', () => {
  const yen = prepareExpense(trip(), {
    payerId: 'a',
    currency: 'JPY',
    amount: '100',
    mode: 'equal',
    memberIds: ['a', 'b', 'c'],
    note: '拉麵',
  });
  assert.equal(yen.ok, true);
  assert.deepEqual(shareMap(yen.expense), { a: 34, b: 33, c: 33 });
  assert.equal(
    yen.expense.shares.reduce((sum, share) => sum + share.amountMinor, 0),
    yen.expense.amountMinor,
  );

  const twd = prepareExpense(trip(), {
    payerId: 'a',
    currency: 'TWD',
    amount: '100',
    mode: 'equal',
    memberIds: ['c', 'a', 'b'],
  });
  assert.equal(twd.ok, true);
  assert.deepEqual(shareMap(twd.expense), { a: 3334, b: 3333, c: 3333 });
  assert.equal(twd.expense.shares[0].amount, 33.34);
});

test('custom amounts must meet the total within 1 yen or 0.01 TWD', () => {
  const snapped = prepareExpense(trip(), {
    payerId: 'b',
    currency: 'JPY',
    amount: 100,
    mode: 'custom',
    memberIds: ['a', 'b', 'c'],
    parts: [
      { memberId: 'a', amount: 33 },
      { memberId: 'b', amount: 33 },
      { memberId: 'c', amount: 33 },
    ],
  });
  assert.equal(snapped.ok, true);
  assert.deepEqual(shareMap(snapped.expense), { a: 34, b: 33, c: 33 });

  const cents = prepareExpense(trip(), {
    payerId: 'a',
    currency: 'TWD',
    amount: '10',
    mode: 'custom',
    memberIds: ['a', 'b', 'c'],
    parts: [
      { memberId: 'a', amount: '3.33' },
      { memberId: 'b', amount: '3.33' },
      { memberId: 'c', amount: '3.33' },
    ],
  });
  assert.equal(cents.ok, true);
  assert.deepEqual(shareMap(cents.expense), { a: 334, b: 333, c: 333 });

  const exact = prepareExpense(trip(), {
    payerId: 'a',
    currency: 'TWD',
    amount: '1000',
    mode: 'custom',
    memberIds: ['a', 'b', 'c'],
    parts: [
      { memberId: 'a', amount: '400' },
      { memberId: 'b', amount: '300' },
      { memberId: 'c', amount: '300' },
    ],
  });
  assert.equal(exact.ok, true);
  assert.deepEqual(shareMap(exact.expense), { a: 40000, b: 30000, c: 30000 });

  const off = prepareExpense(trip(), {
    payerId: 'a',
    currency: 'JPY',
    amount: 100,
    mode: 'custom',
    memberIds: ['a', 'b'],
    parts: [
      { memberId: 'a', amount: 60 },
      { memberId: 'b', amount: 30 },
    ],
  });
  assert.equal(off.ok, false);

  const offTwd = prepareExpense(trip(), {
    payerId: 'a',
    currency: 'TWD',
    amount: '10',
    mode: 'custom',
    memberIds: ['a', 'b', 'c'],
    parts: [
      { memberId: 'a', amount: '3.30' },
      { memberId: 'b', amount: '3.30' },
      { memberId: 'c', amount: '3.30' },
    ],
  });
  assert.equal(offTwd.ok, false);
});

test('ratio weights use the largest remainder and still sum to the total', () => {
  const even = prepareExpense(trip(), {
    payerId: 'c',
    currency: 'JPY',
    amount: 1000,
    mode: 'ratio',
    memberIds: ['a', 'b', 'c'],
    parts: [
      { memberId: 'a', weight: 1 },
      { memberId: 'b', weight: 2 },
      { memberId: 'c', weight: 1 },
    ],
  });
  assert.equal(even.ok, true);
  assert.deepEqual(shareMap(even.expense), { a: 250, b: 500, c: 250 });

  const messy = prepareExpense(trip(), {
    payerId: 'a',
    currency: 'JPY',
    amount: 100,
    mode: 'ratio',
    memberIds: ['a', 'b', 'c'],
    parts: [
      { memberId: 'a', weight: 1.5 },
      { memberId: 'b', weight: 1.5 },
      { memberId: 'c', weight: 1 },
    ],
  });
  assert.equal(messy.ok, true);
  assert.deepEqual(shareMap(messy.expense), { a: 38, b: 37, c: 25 });
  assert.equal(
    messy.expense.shares.reduce((sum, share) => sum + share.amountMinor, 0),
    100,
  );

  const rejected = prepareExpense(trip(), {
    payerId: 'a',
    currency: 'JPY',
    amount: 100,
    mode: 'ratio',
    memberIds: ['a', 'b'],
    parts: [
      { memberId: 'a', weight: 1 },
      { memberId: 'b', weight: 0 },
    ],
  });
  assert.equal(rejected.ok, false);
});

test('exclude keeps named people out and splits the rest equally', () => {
  const one = prepareExpense(trip(), {
    payerId: 'd',
    currency: 'JPY',
    amount: 900,
    mode: 'exclude',
    memberIds: ['d'],
    note: '包車',
  });
  assert.equal(one.ok, true);
  assert.deepEqual(shareMap(one.expense), { a: 300, b: 300, c: 300 });

  const expense = prepareExpense(trip(), {
    payerId: 'd',
    currency: 'JPY',
    amount: 900,
    mode: 'exclude',
    memberIds: ['d', 'b'],
    note: '包車',
    day: 2,
    stopId: 's8',
  });
  assert.equal(expense.ok, true);
  assert.deepEqual(shareMap(expense.expense), { a: 450, c: 450 });
  assert.equal(expense.expense.day, 2);
  assert.equal(expense.expense.stopId, 's8');
  assert.deepEqual(expense.expense.memberIds, ['b', 'd']);

  const everyone = prepareExpense(trip(), {
    payerId: 'a',
    currency: 'JPY',
    amount: 100,
    mode: 'exclude',
    memberIds: ['a', 'b', 'c', 'd'],
  });
  assert.equal(everyone.ok, false);

  const mismatch = prepareExpense(trip(), {
    payerId: 'a',
    currency: 'JPY',
    amount: 100,
    mode: 'equal',
    memberIds: ['a'],
    day: 2,
    stopId: 's6',
  });
  assert.equal(mismatch.ok, false);
});

test('minimum transfers clear the +4/+3/-2/-2/-3 case in 3 payments', () => {
  const nets = [
    { id: 'a', amount: 4 },
    { id: 'b', amount: 3 },
    { id: 'c', amount: -2 },
    { id: 'd', amount: -2 },
    { id: 'e', amount: -3 },
  ];
  const transfers = minTransfers(nets);
  assert.equal(transfers.length, 3);
  assert.equal(transfers.length, bruteMinCount(nets.map((net) => net.amount)));
  assert.equal(cleared(nets, transfers), true);
});

test('disjoint debts settle as separate pairs', () => {
  const nets = [
    { id: 'a', amount: 5 },
    { id: 'b', amount: -5 },
    { id: 'c', amount: 4 },
    { id: 'd', amount: -4 },
  ];
  const transfers = minTransfers(nets);
  assert.equal(transfers.length, 2);
  assert.equal(transfers.length, bruteMinCount(nets.map((net) => net.amount)));
  assert.equal(cleared(nets, transfers), true);
});

test('smoke fixture keeps JPY and TWD apart and suggests minimum transfers', () => {
  let state = trip();
  const steps = [
    {
      payerId: 'a',
      currency: 'JPY',
      amount: 100,
      mode: 'equal',
      memberIds: ['a', 'b', 'c'],
      note: '均分',
    },
    {
      payerId: 'b',
      currency: 'JPY',
      amount: 200,
      mode: 'custom',
      memberIds: ['a', 'b', 'c'],
      parts: [
        { memberId: 'a', amount: 50 },
        { memberId: 'b', amount: 50 },
        { memberId: 'c', amount: 100 },
      ],
      note: '自訂',
    },
    {
      payerId: 'c',
      currency: 'JPY',
      amount: 300,
      mode: 'ratio',
      memberIds: ['a', 'b', 'c'],
      parts: [
        { memberId: 'a', weight: 1 },
        { memberId: 'b', weight: 1 },
        { memberId: 'c', weight: 1 },
      ],
      note: '比例',
    },
    {
      payerId: 'd',
      currency: 'JPY',
      amount: 90,
      mode: 'exclude',
      memberIds: ['d'],
      note: '排除',
    },
    {
      payerId: 'a',
      currency: 'TWD',
      amount: '10',
      mode: 'equal',
      memberIds: ['a', 'b'],
      note: '台幣均分',
    },
    {
      payerId: 'b',
      currency: 'TWD',
      amount: '20.50',
      mode: 'custom',
      memberIds: ['a', 'b'],
      parts: [
        { memberId: 'a', amount: '10.25' },
        { memberId: 'b', amount: '10.25' },
      ],
      note: '台幣自訂',
    },
  ];
  for (const step of steps) {
    const result = upsertExpense(state, step);
    assert.equal(result.ok, true, result.error);
    state = result.state;
  }

  const settlement = settlementOf(state);
  const yenNet = Object.fromEntries(settlement.JPY.nets.map((net) => [net.memberId, net.netMinor]));
  const twdNet = Object.fromEntries(settlement.TWD.nets.map((net) => [net.memberId, net.netMinor]));
  assert.deepEqual(yenNet, { a: -114, b: -13, c: 37, d: 90 });
  assert.deepEqual(twdNet, { a: -525, b: 525, c: 0, d: 0 });
  assert.deepEqual(
    settlement.JPY.transfers.map((transfer) => [transfer.fromId, transfer.toId, transfer.amountMinor]),
    [
      ['a', 'd', 90],
      ['a', 'c', 24],
      ['b', 'c', 13],
    ],
  );
  assert.deepEqual(
    settlement.TWD.transfers.map((transfer) => [transfer.fromId, transfer.toId, transfer.amountMinor]),
    [['a', 'b', 525]],
  );
  assert.equal(settlement.TWD.transfers[0].amount, 5.25);
  assert.equal(
    settlement.JPY.transfers.reduce((sum, transfer) => sum + transfer.amountMinor, 0) === 525,
    false,
  );

  const csv = billToCsv(state);
  assert.match(csv, /均分/);
  assert.match(csv, /台幣自訂/);
  assert.match(csv, /JPY,Alice,Dana,90/);
  assert.match(csv, /TWD,Alice,Bob,5\.25/);
  assert.equal(csv.charCodeAt(0), 0xfeff);
});

test('a saved trip without bill fields keeps its stops and starts from an empty roster', () => {
  const state = ensureBill({ stops: [{ id: 's1' }], roomCode: 'HOKKAIDO2027' });
  assert.deepEqual(state.members, []);
  assert.deepEqual(state.expenses, []);
  assert.deepEqual(state.settlements, []);
  assert.equal(state.stops[0].id, 's1');
  assert.equal(state.roomCode, 'HOKKAIDO2027');
  assert.equal(formatMinor(1500, 'JPY').replace(/,/g, ''), '¥1500');
  assert.equal(formatMinor(3334, 'TWD').replace(/,/g, ''), 'NT$33.34');
});

test('member removal is blocked while an expense still names them', () => {
  const accounts = [
    { id: 'a', username: 'alice', displayName: 'Alice' },
    { id: 'u9', username: 'cara', displayName: 'Cara' },
  ];
  let state = trip();
  const addedResult = addMember(state, { username: 'cara' }, accounts);
  assert.equal(addedResult.ok, true, addedResult.error);
  state = addedResult.state;
  const added = state.members.find((member) => member.id === 'u9');
  assert.ok(added);
  assert.equal(added.displayName, undefined);
  const saved = upsertExpense(state, {
    payerId: 'a',
    currency: 'JPY',
    amount: 50,
    mode: 'equal',
    memberIds: ['a', added.id],
  });
  assert.equal(saved.ok, true);
  const blocked = removeMember(saved.state, added.id);
  assert.equal(blocked.ok, false);
  const removedExpense = deleteExpense(saved.state, saved.state.expenses[0].id);
  assert.equal(removedExpense.ok, true);
  const removed = removeMember(removedExpense.state, added.id);
  assert.equal(removed.ok, true);
  assert.equal(
    removed.state.members.some((member) => member.id === added.id),
    false,
  );
});

test('a companion is an existing account and the member id is that account id', () => {
  const registeredId = 'u_0123456789abcdef';
  const accounts = [
    { id: 'u1', username: 'alice', displayName: 'Alice' },
    { id: 'u2', username: 'bob', displayName: 'Bob' },
    { id: registeredId, username: 'mika', displayName: 'Mika' },
  ];
  const state = ensureBill({
    stops: [],
    members: [{ id: 'm-local', displayName: '別的名字', userId: 'u1' }],
  });
  assert.deepEqual(state.members, [{ id: 'u1' }]);
  assert.equal(state.members[0].userId, undefined);
  assert.equal(state.members[0].displayName, undefined);
  assert.equal(isTripMember(state, 'u1'), true);
  assert.equal(isTripMember(state, 'u2'), false);
  const empty = ensureBill({ stops: [], members: [] });
  assert.equal(memberAddAllowed(empty, 'u1', 'u1').ok, true);
  const blocked = memberAddAllowed(empty, 'u1', 'u2');
  assert.equal(blocked.ok, false);
  const self = addMember(empty, { username: 'alice' }, accounts);
  assert.equal(self.ok, true, self.error);
  assert.deepEqual(self.state.members, [{ id: 'u1' }]);
  assert.equal(memberAddAllowed(self.state, 'u1', 'u2').ok, true);
  assert.equal(memberAddAllowed(self.state, 'u2', registeredId).ok, false);

  const added = addMember(state, { username: ' Bob ' }, accounts);
  assert.equal(added.ok, true, added.error);
  assert.deepEqual(
    added.state.members.map((member) => member.id),
    ['u1', 'u2'],
  );
  assert.equal(added.state.members[1].displayName, undefined);

  const registered = addMember(added.state, { username: 'mika' }, accounts);
  assert.equal(registered.ok, true, registered.error);
  assert.equal(registered.state.members.at(-1).id, registeredId);
  assert.match(registered.state.members.at(-1).id, /^u_[0-9a-f]{16}$/);

  const named = addMember(state, { displayName: '小明' }, accounts);
  assert.equal(named.ok, false);
  const missing = addMember(state, { username: 'new@example.com' }, accounts);
  assert.equal(missing.ok, false);
  assert.match(missing.error, /找不到這個帳號/);
  const duplicate = addMember(added.state, { username: 'Alice' }, accounts);
  assert.equal(duplicate.ok, false);
});

test('a directed settlement stores payer id, payee id, and amount', () => {
  const mika = 'u_0123456789abcdef';
  let state = ensureBill({
    stops: [],
    members: [
      { id: 'u1', displayName: 'Alice' },
      { id: 'u2', displayName: 'Bob' },
      { id: mika, displayName: 'Mika' },
    ],
  });
  const saved = addSettlement(state, {
    payerId: 'u1',
    payeeId: mika,
    amount: '1200',
    currency: 'JPY',
  });
  assert.equal(saved.ok, true, saved.error);
  const row = saved.state.settlements[0];
  assert.equal(row.payerId, 'u1');
  assert.equal(row.payeeId, mika);
  assert.equal(row.amount, 1200);
  assert.equal(row.currency, 'JPY');
  state = saved.state;

  const outsider = addSettlement(state, { payerId: 'u1', payeeId: 'u9', amount: 10, currency: 'JPY' });
  assert.equal(outsider.ok, false);
  const same = addSettlement(state, { payerId: 'u1', payeeId: 'u1', amount: 10, currency: 'JPY' });
  assert.equal(same.ok, false);

  const twd = addSettlement(state, { payerId: 'u2', payeeId: 'u1', amount: '5.25', currency: 'TWD' });
  assert.equal(twd.ok, true, twd.error);
  assert.equal(twd.state.settlements[1].payerId, 'u2');
  assert.equal(twd.state.settlements[1].payeeId, 'u1');
  assert.equal(twd.state.settlements[1].amount, 5.25);

  const csv = billToCsv(twd.state);
  assert.match(csv, /記下的結算,付款人,收款人,金額/);
  assert.match(csv, /JPY,Alice,Mika,1200/);
  assert.match(csv, /TWD,Bob,Alice,5\.25/);

  const blocked = removeMember(twd.state, 'u2');
  assert.equal(blocked.ok, false);
  const cleared = deleteSettlement(twd.state, twd.state.settlements[1].id);
  assert.equal(cleared.ok, true);
  assert.equal(cleared.state.settlements.length, 1);
  assert.equal(cleared.state.settlements[0].payerId, 'u1');
  assert.equal(cleared.state.settlements[0].payeeId, mika);
  assert.equal(cleared.state.settlements[0].amount, 1200);
});
