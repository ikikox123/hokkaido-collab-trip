/**
 * Room bill split.
 * Expenses are stored and validated in JPY or TWD. convertMinor and
 * crossSettlement only change the display and the unified settlement.
 * Minor units: 1 yen, or 0.01 TWD. Shares are adjusted so they sum to the total
 * (custom input may be off by one minor unit: 1 yen or 0.01 TWD).
 */

export const CURRENCIES = ['JPY', 'TWD'];
export const SPLIT_MODES = ['equal', 'custom', 'ratio', 'exclude'];

export const MODE_LABELS = {
  equal: '均分',
  custom: '自訂金額',
  ratio: '比例',
  exclude: '排除',
};

const MEMBER_CAP = 20;
const EXPENSE_CAP = 500;
const NOTE_CAP = 200;
const NAME_CAP = 20;
/** Exact minimum-transfer search is fine through this many non-zero balances. */
const EXACT_SETTLE_LIMIT = 12;

export function defaultMembers() {
  return [
    { id: 'u1', displayName: 'Alice', userId: 'u1' },
    { id: 'u2', displayName: 'Bob', userId: 'u2' },
  ];
}

export function ensureBill(state) {
  if (!state || typeof state !== 'object') return state;
  const members = normalizeMembers(state.members);
  const expenses = Array.isArray(state.expenses) ? state.expenses.filter(isPlausibleExpense) : [];
  return { ...state, members, expenses };
}

export function fromMinor(minor, currency) {
  const value = Number(minor);
  if (!Number.isFinite(value)) return NaN;
  if (currency !== 'TWD') return value;
  const sign = value < 0 ? -1 : 1;
  const abs = Math.abs(value);
  return sign * (Math.trunc(abs / 100) + (abs % 100) / 100);
}

export function toMinor(amount, currency) {
  const numeric = typeof amount === 'number' ? amount : Number(String(amount).trim().replace(/,/g, ''));
  if (!Number.isFinite(numeric)) return NaN;
  const negative = numeric < 0;
  const [whole, frac = ''] = Math.abs(numeric).toFixed(6).split('.');
  let minor;
  if (currency === 'TWD') {
    minor = Number(whole) * 100 + Number((frac + '00').slice(0, 2));
    if ((frac[2] || '0') >= '5') minor += 1;
  } else {
    minor = Number(whole);
    if ((frac[0] || '0') >= '5') minor += 1;
  }
  if (!Number.isSafeInteger(minor)) return NaN;
  return negative ? -minor : minor;
}

export function formatMinor(minor, currency) {
  const value = Number(minor);
  if (!Number.isFinite(value)) return '';
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  if (currency === 'TWD') {
    const whole = Math.trunc(abs / 100).toLocaleString('zh-Hant');
    const frac = abs % 100;
    const body = frac === 0 ? whole : `${whole}.${String(frac).padStart(2, '0')}`;
    return `${sign}NT$${body}`;
  }
  return `${sign}¥${abs.toLocaleString('zh-Hant')}`;
}

export function formatMoney(amount, currency) {
  return formatMinor(toMinor(amount, currency), currency);
}

function minorFromDecimalString(text, currency) {
  if (!/^\d+(\.\d+)?$/.test(text)) return null;
  const [whole, frac = ''] = text.split('.');
  if (whole.length > 12) return null;
  let minor;
  if (currency === 'TWD') {
    minor = Number(whole) * 100 + Number((frac + '00').slice(0, 2));
    if ((frac[2] || '0') >= '5') minor += 1;
  } else {
    minor = Number(whole);
    if ((frac[0] || '0') >= '5') minor += 1;
  }
  return Number.isSafeInteger(minor) ? minor : null;
}

function amountCap(currency) {
  return currency === 'TWD' ? 100_000_000 : 10_000_000;
}

function fail(error) {
  return { ok: false, error };
}

export function prepareExpense(state, input) {
  if (!input || typeof input !== 'object') return fail('支出格式不正確');
  const members = normalizeMembers(state?.members);
  const currency = input.currency === 'TWD' ? 'TWD' : input.currency === 'JPY' ? 'JPY' : null;
  if (!currency) return fail('請選擇日圓或新台幣');
  if (!SPLIT_MODES.includes(input.mode)) return fail('請選擇分攤方式');

  const amountMinor = readPositiveMinor(input.amount, currency);
  if (!amountMinor.ok) return amountMinor;

  const payerId = typeof input.payerId === 'string' ? input.payerId : '';
  if (!members.some((member) => member.id === payerId)) return fail('請選擇付款人');

  const note = String(input.note ?? '').trim().replace(/\s+/g, ' ');
  if (note.length > NOTE_CAP) return fail('備註請在 200 字以內');

  const linked = resolveLink(state, input);
  if (!linked.ok) return linked;

  const picked = normalizePickedIds(input.memberIds, members);
  if (!picked.ok) return picked;

  let included;
  let memberIds;
  if (input.mode === 'exclude') {
    const excluded = new Set(picked.ids);
    included = members.map((member) => member.id).filter((id) => !excluded.has(id));
    memberIds = picked.ids;
    if (!included.length) return fail('排除後沒有人可以分攤');
  } else {
    included = picked.ids;
    memberIds = picked.ids;
    if (!included.length) return fail('請至少選一個人分攤');
  }

  const allocated = allocate(input, currency, amountMinor.minor, included, members);
  if (!allocated.ok) return allocated;

  const shares = included.map((id, index) => ({
    memberId: id,
    amountMinor: allocated.minors[index],
    amount: fromMinor(allocated.minors[index], currency),
  }));

  return {
    ok: true,
    expense: {
      payerId,
      currency,
      amount: fromMinor(amountMinor.minor, currency),
      amountMinor: amountMinor.minor,
      note,
      day: linked.day,
      stopId: linked.stopId,
      mode: input.mode,
      memberIds,
      parts: allocated.parts,
      shares,
    },
  };
}

export function upsertExpense(state, input) {
  const base = ensureBill(state);
  const editing = Boolean(input && input.id);
  if (!editing && base.expenses.length >= EXPENSE_CAP) return fail('支出太多了');
  const prepared = prepareExpense(base, input);
  if (!prepared.ok) return prepared;
  const now = new Date().toISOString();
  const expenses = [...base.expenses];
  if (editing) {
    const idx = expenses.findIndex((expense) => expense.id === input.id);
    if (idx < 0) return fail('找不到這筆支出');
    expenses[idx] = {
      ...prepared.expense,
      id: expenses[idx].id,
      createdAt: expenses[idx].createdAt || now,
      updatedAt: now,
    };
  } else {
    expenses.push({
      ...prepared.expense,
      id: newId('e'),
      createdAt: now,
      updatedAt: now,
    });
  }
  return { ok: true, state: { ...base, expenses } };
}

export function deleteExpense(state, id) {
  const base = ensureBill(state);
  if (!id || !base.expenses.some((expense) => expense.id === id)) return fail('找不到這筆支出');
  return { ok: true, state: { ...base, expenses: base.expenses.filter((expense) => expense.id !== id) } };
}

export function addMember(state, displayName) {
  const base = ensureBill(state);
  const cleaned = cleanName(displayName);
  if (!cleaned.ok) return cleaned;
  if (base.members.length >= MEMBER_CAP) return fail('旅伴最多 20 人');
  if (base.members.some((member) => member.displayName === cleaned.name)) return fail('已經有這位旅伴');
  return {
    ok: true,
    state: {
      ...base,
      members: [...base.members, { id: newId('m'), displayName: cleaned.name }],
    },
  };
}

export function renameMember(state, id, displayName) {
  const base = ensureBill(state);
  const cleaned = cleanName(displayName);
  if (!cleaned.ok) return cleaned;
  const idx = base.members.findIndex((member) => member.id === id);
  if (idx < 0) return fail('找不到這位旅伴');
  if (base.members.some((member) => member.id !== id && member.displayName === cleaned.name)) {
    return fail('已經有這位旅伴');
  }
  const members = base.members.map((member) =>
    member.id === id ? { ...member, displayName: cleaned.name } : member,
  );
  return { ok: true, state: { ...base, members } };
}

export function removeMember(state, id) {
  const base = ensureBill(state);
  const member = base.members.find((item) => item.id === id);
  if (!member) return fail('找不到這位旅伴');
  if (base.members.length <= 1) return fail('至少要留一位旅伴');
  const used = base.expenses.some(
    (expense) =>
      expense.payerId === id ||
      (expense.memberIds || []).includes(id) ||
      (expense.shares || []).some((share) => share.memberId === id),
  );
  if (used) return fail('這位旅伴已經出現在支出裡，請先修改那些支出');
  return { ok: true, state: { ...base, members: base.members.filter((item) => item.id !== id) } };
}

export function settlementOf(state) {
  const base = ensureBill(state);
  return {
    JPY: settleCurrency(base, 'JPY'),
    TWD: settleCurrency(base, 'TWD'),
  };
}

const RATE_SCALE = 100_000_000n;

function roundDiv(num, den) {
  const negative = num < 0n;
  const abs = negative ? -num : num;
  const rounded = (abs + den / 2n) / den;
  return Number(negative ? -rounded : rounded);
}

/** Convert minor units using TWD per 1 JPY. Splits themselves stay in the expense currency. */
export function convertMinor(minor, from, to, twdPerJpy) {
  const amount = Number(minor);
  if (!Number.isInteger(amount)) return NaN;
  if (from === to) return amount;
  const rate = Number(twdPerJpy);
  if (!Number.isFinite(rate) || rate <= 0) return NaN;
  const scaled = BigInt(Math.round(rate * 1e8));
  if (scaled <= 0n) return NaN;
  const value = BigInt(amount);
  if (from === 'JPY' && to === 'TWD') return roundDiv(value * scaled * 100n, RATE_SCALE);
  if (from === 'TWD' && to === 'JPY') return roundDiv(value * RATE_SCALE, scaled * 100n);
  return NaN;
}

/**
 * Nets and minimum transfers with every balance expressed in `target`.
 * Rounding dust is put on the largest balance so the books still sum to zero.
 */
export function crossSettlement(state, target, twdPerJpy) {
  if (target !== 'JPY' && target !== 'TWD') return null;
  const rate = Number(twdPerJpy);
  if (!Number.isFinite(rate) || rate <= 0) return null;
  const base = ensureBill(state);
  const native = settlementOf(base);
  const rows = base.members.map((member) => {
    let total = 0;
    for (const currency of CURRENCIES) {
      const net = native[currency].nets.find((item) => item.memberId === member.id);
      const minor = net?.netMinor || 0;
      total += currency === target ? minor : convertMinor(minor, currency, target, rate);
    }
    return { id: member.id, amount: total };
  });
  const drift = rows.reduce((sum, row) => sum + row.amount, 0);
  if (drift !== 0 && rows.length) {
    let index = 0;
    for (let i = 1; i < rows.length; i++) {
      if (Math.abs(rows[i].amount) > Math.abs(rows[index].amount)) index = i;
    }
    rows[index] = { ...rows[index], amount: rows[index].amount - drift };
  }
  const transfers = minTransfers(rows);
  return {
    currency: target,
    twdPerJpy: rate,
    nets: rows.map((row) => ({
      memberId: row.id,
      netMinor: row.amount,
      net: fromMinor(row.amount, target),
    })),
    transfers: transfers.map((transfer) => ({
      fromId: transfer.fromId,
      toId: transfer.toId,
      amountMinor: transfer.amount,
      amount: fromMinor(transfer.amount, target),
    })),
  };
}

export function minTransfers(nets) {
  const people = [];
  for (const net of nets || []) {
    const amount = Number(net?.amount);
    if (!Number.isInteger(amount) || amount === 0) continue;
    people.push({ id: String(net.id), amount });
  }
  if (!people.length) return [];
  const groups = people.length > EXACT_SETTLE_LIMIT ? [people] : partitionZeroSum(people);
  const transfers = [];
  for (const group of groups) transfers.push(...settleGroup(group));
  return transfers;
}

export function billToCsv(state, twdPerJpy) {
  const base = ensureBill(state);
  const nameOf = (id) => base.members.find((member) => member.id === id)?.displayName || '（已離開）';
  const dayOf = (day) => {
    if (day == null) return '';
    const found = (base.days || []).find((item) => item.day === day);
    return found ? `${found.label || ''} ${found.date || ''}`.trim() : `D${day}`;
  };
  const stopOf = (id) => {
    if (!id) return '';
    return (base.stops || []).find((stop) => stop.id === id)?.title || '（站點已刪除）';
  };
  const rate = Number(twdPerJpy);
  const lines = [];
  if (Number.isFinite(rate) && rate > 0) {
    lines.push(['使用匯率', `1 JPY = ${rate} TWD`, `1 TWD = ${Math.round((1 / rate) * 1e8) / 1e8} JPY`].join(','));
  }
  lines.push('幣別,金額,付款人,備註,行程日,站點,分帳方式,分攤人,分攤金額,換算幣別,換算金額');
  for (const expense of base.expenses) {
    const shares = expense.shares?.length ? expense.shares : [{ memberId: '', amount: '' }];
    for (const share of shares) {
      lines.push(
        [
          expense.currency,
          expense.amount,
          nameOf(expense.payerId),
          expense.note || '',
          dayOf(expense.day),
          stopOf(expense.stopId),
          MODE_LABELS[expense.mode] || expense.mode,
          share.memberId ? nameOf(share.memberId) : '',
          share.amount ?? '',
          Number.isFinite(rate) && rate > 0 ? (expense.currency === 'JPY' ? 'TWD' : 'JPY') : '',
          Number.isFinite(rate) && rate > 0
            ? fromMinor(
                convertMinor(
                  Number.isInteger(expense.amountMinor) ? expense.amountMinor : toMinor(expense.amount, expense.currency),
                  expense.currency,
                  expense.currency === 'JPY' ? 'TWD' : 'JPY',
                  rate,
                ),
                expense.currency === 'JPY' ? 'TWD' : 'JPY',
              )
            : '',
        ]
          .map(csvCell)
          .join(','),
      );
    }
  }
  lines.push('', '幣別,付款人,收款人,金額');
  const settlement = settlementOf(base);
  for (const currency of CURRENCIES) {
    const transfers = settlement[currency].transfers;
    if (!transfers.length) {
      lines.push([currency, '', '', ''].join(','));
      continue;
    }
    for (const transfer of transfers) {
      lines.push(
        [currency, nameOf(transfer.fromId), nameOf(transfer.toId), transfer.amount].map(csvCell).join(','),
      );
    }
  }
  if (Number.isFinite(rate) && rate > 0) {
    lines.push('', '換匯結算幣別,付款人,收款人,金額');
    for (const currency of CURRENCIES) {
      const cross = crossSettlement(base, currency, rate);
      if (!cross?.transfers.length) {
        lines.push([currency, '', '', ''].join(','));
        continue;
      }
      for (const transfer of cross.transfers) {
        lines.push([currency, nameOf(transfer.fromId), nameOf(transfer.toId), transfer.amount].map(csvCell).join(','));
      }
    }
  }
  lines.push('', '幣別,旅伴,淨額');
  for (const currency of CURRENCIES) {
    for (const net of settlement[currency].nets) {
      lines.push([currency, nameOf(net.memberId), net.net].map(csvCell).join(','));
    }
  }
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

function settleCurrency(state, currency) {
  const minor = new Map(state.members.map((member) => [member.id, 0]));
  for (const expense of state.expenses) {
    if (expense.currency !== currency) continue;
    const paid = expenseAmountMinor(expense);
    minor.set(expense.payerId, (minor.get(expense.payerId) || 0) + paid);
    for (const share of expense.shares || []) {
      minor.set(share.memberId, (minor.get(share.memberId) || 0) - shareMinor(share, currency));
    }
  }
  const seen = new Set(state.members.map((member) => member.id));
  const nets = state.members.map((member) => netRow(member.id, minor.get(member.id) || 0, currency));
  for (const [id, netMinor] of minor) {
    if (!seen.has(id) && netMinor !== 0) nets.push(netRow(id, netMinor, currency));
  }
  const transfers = minTransfers(
    [...minor.entries()].filter(([, amount]) => amount !== 0).map(([id, amount]) => ({ id, amount })),
  ).map((transfer) => ({
    fromId: transfer.fromId,
    toId: transfer.toId,
    amountMinor: transfer.amount,
    amount: fromMinor(transfer.amount, currency),
  }));
  return { nets, transfers };
}

function netRow(memberId, netMinor, currency) {
  return { memberId, netMinor, net: fromMinor(netMinor, currency) };
}

function expenseAmountMinor(expense) {
  return Number.isInteger(expense.amountMinor) ? expense.amountMinor : toMinor(expense.amount, expense.currency);
}

function shareMinor(share, currency) {
  return Number.isInteger(share.amountMinor) ? share.amountMinor : toMinor(share.amount, currency);
}

function partitionZeroSum(people) {
  const n = people.length;
  const total = people.reduce((sum, person) => sum + person.amount, 0);
  if (total !== 0 || n === 0) return [people];
  const size = 1 << n;
  const subsetSum = new Array(size).fill(0);
  for (let mask = 1; mask < size; mask++) {
    const bit = mask & -mask;
    const index = 31 - Math.clz32(bit);
    subsetSum[mask] = subsetSum[mask ^ bit] + people[index].amount;
  }
  const dp = new Int16Array(size).fill(-1);
  const choice = new Int32Array(size);
  dp[0] = 0;
  for (let mask = 1; mask < size; mask++) {
    if (subsetSum[mask] !== 0) continue;
    const low = mask & -mask;
    let best = -1;
    let bestSub = 0;
    for (let sub = mask; sub > 0; sub = (sub - 1) & mask) {
      if ((sub & low) === 0 || subsetSum[sub] !== 0) continue;
      const rest = mask ^ sub;
      if (dp[rest] < 0) continue;
      const count = dp[rest] + 1;
      if (count > best) {
        best = count;
        bestSub = sub;
      }
    }
    dp[mask] = best;
    choice[mask] = bestSub;
  }
  let mask = size - 1;
  if (dp[mask] < 0) return [people];
  const groups = [];
  while (mask) {
    const sub = choice[mask];
    if (!sub) return [people];
    const group = [];
    for (let index = 0; index < n; index++) {
      if (sub & (1 << index)) group.push(people[index]);
    }
    groups.push(group);
    mask ^= sub;
  }
  return groups;
}

function settleGroup(group) {
  const debtors = group
    .filter((person) => person.amount < 0)
    .map((person) => ({ id: person.id, amount: person.amount }))
    .sort((a, b) => a.amount - b.amount || (a.id < b.id ? -1 : 1));
  const creditors = group
    .filter((person) => person.amount > 0)
    .map((person) => ({ id: person.id, amount: person.amount }))
    .sort((a, b) => b.amount - a.amount || (a.id < b.id ? -1 : 1));
  const transfers = [];
  let debtorIndex = 0;
  let creditorIndex = 0;
  while (debtorIndex < debtors.length && creditorIndex < creditors.length) {
    const pay = Math.min(-debtors[debtorIndex].amount, creditors[creditorIndex].amount);
    if (pay > 0) {
      transfers.push({
        fromId: debtors[debtorIndex].id,
        toId: creditors[creditorIndex].id,
        amount: pay,
      });
      debtors[debtorIndex].amount += pay;
      creditors[creditorIndex].amount -= pay;
    }
    if (debtors[debtorIndex].amount === 0) debtorIndex += 1;
    if (creditors[creditorIndex].amount === 0) creditorIndex += 1;
  }
  return transfers;
}

function allocate(input, currency, amountMinor, included, members) {
  if (input.mode === 'equal' || input.mode === 'exclude') {
    return { ok: true, minors: allocateEqual(amountMinor, included.length), parts: [] };
  }
  if (input.mode === 'custom') {
    const minors = [];
    for (const id of included) {
      const part = findPart(input.parts, id);
      if (!part || part.amount == null || part.amount === '') return fail('請填每位的金額');
      const parsed = readNonNegativeMinor(part.amount, currency);
      if (!parsed.ok) return parsed;
      minors.push(parsed.minor);
    }
    const sum = minors.reduce((total, value) => total + value, 0);
    const diff = amountMinor - sum;
    if (Math.abs(diff) > 1) {
      return fail(currency === 'JPY' ? '自訂金額加總要等於總額（最多差 1 圓）' : '自訂金額加總要等於總額（最多差 0.01）');
    }
    if (diff !== 0) {
      let index = 0;
      for (let i = 1; i < minors.length; i++) {
        if (minors[i] > minors[index]) index = i;
      }
      if (minors[index] + diff < 0) {
        return fail(currency === 'JPY' ? '自訂金額加總要等於總額（最多差 1 圓）' : '自訂金額加總要等於總額（最多差 0.01）');
      }
      minors[index] += diff;
    }
    return {
      ok: true,
      minors,
      parts: included.map((id, index) => ({
        memberId: id,
        amount: fromMinor(minors[index], currency),
      })),
    };
  }
  const weights = [];
  const weightById = new Map();
  for (const id of included) {
    const part = findPart(input.parts, id);
    const weight = normalizeWeight(part?.weight);
    if (weight == null) return fail('請填大於 0 的比例');
    weights.push(Math.round(weight * 10000));
    weightById.set(id, weight);
  }
  return {
    ok: true,
    minors: allocateRatio(amountMinor, weights),
    parts: included.map((id) => ({ memberId: id, weight: weightById.get(id) })),
  };
}

function allocateEqual(amountMinor, count) {
  const base = Math.floor(amountMinor / count);
  let remainder = amountMinor - base * count;
  const minors = [];
  for (let index = 0; index < count; index++) {
    const extra = remainder > 0 ? 1 : 0;
    if (remainder > 0) remainder -= 1;
    minors.push(base + extra);
  }
  return minors;
}

function allocateRatio(amountMinor, weights) {
  const amount = BigInt(amountMinor);
  const bigWeights = weights.map((weight) => BigInt(weight));
  const total = bigWeights.reduce((sum, weight) => sum + weight, 0n);
  const floors = bigWeights.map((weight) => (amount * weight) / total);
  const ranked = bigWeights.map((weight, index) => ({ index, rem: (amount * weight) % total }));
  ranked.sort((a, b) => (a.rem === b.rem ? a.index - b.index : a.rem > b.rem ? -1 : 1));
  let left = amount - floors.reduce((sum, value) => sum + value, 0n);
  let cursor = 0;
  while (left > 0n) {
    floors[ranked[cursor].index] += 1n;
    left -= 1n;
    cursor += 1;
  }
  return floors.map((value) => Number(value));
}

function findPart(parts, id) {
  if (!Array.isArray(parts)) return null;
  return parts.find((part) => part && part.memberId === id) || null;
}

function normalizeWeight(value) {
  if (value == null || value === '') return null;
  const numeric = Number(String(value).trim());
  if (!Number.isFinite(numeric) || numeric <= 0 || numeric > 100000) return null;
  const rounded = Math.round(numeric * 10000) / 10000;
  return rounded > 0 ? rounded : null;
}

function readPositiveMinor(value, currency) {
  const parsed = readMinor(value, currency, false);
  if (!parsed.ok) return parsed;
  if (parsed.minor <= 0) return fail('金額必須是正數');
  if (parsed.minor > amountCap(currency)) return fail('金額太大');
  return parsed;
}

function readNonNegativeMinor(value, currency) {
  const parsed = readMinor(value, currency, true);
  if (!parsed.ok) return { ok: false, error: '分攤金額必須是 0 或正數' };
  if (parsed.minor < 0) return fail('分攤金額必須是 0 或正數');
  return parsed;
}

function readMinor(value, currency, allowZero) {
  if (value == null || value === '') return fail('請輸入金額');
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0 || (!allowZero && value === 0)) return fail('金額必須是正數');
    const minor = toMinor(value, currency);
    if (!Number.isInteger(minor)) return fail('金額必須是正數');
    return { ok: true, minor };
  }
  const text = String(value).trim().replace(/,/g, '');
  if (!/^\d+(\.\d+)?$/.test(text)) return fail('金額必須是正數');
  const minor = minorFromDecimalString(text, currency);
  if (minor == null) return fail('金額必須是正數');
  return { ok: true, minor };
}

function resolveLink(state, input) {
  const stops = Array.isArray(state?.stops) ? state.stops : [];
  const days = Array.isArray(state?.days) ? state.days : [];
  const stopId = typeof input.stopId === 'string' && input.stopId ? input.stopId : null;
  const stop = stopId ? stops.find((item) => item.id === stopId) : null;
  if (stopId && !stop) return fail('找不到這個站點');

  let day = null;
  if (!(input.day == null || input.day === '' || input.day === 'none')) {
    const parsed = Number(input.day);
    if (!Number.isInteger(parsed) || !days.some((item) => item.day === parsed)) return fail('日期不在行程裡');
    day = parsed;
  }
  if (stop && day != null && stop.day !== day) return fail('站點不在所選的那一天');
  if (stop && day == null) day = stop.day;
  return { ok: true, day, stopId };
}

function normalizePickedIds(memberIds, members) {
  if (!Array.isArray(memberIds)) return { ok: true, ids: [] };
  const known = new Set(members.map((member) => member.id));
  for (const id of memberIds) {
    if (typeof id !== 'string' || !known.has(id)) return fail('有不在旅伴名單裡的人');
  }
  const picked = new Set(memberIds);
  return { ok: true, ids: members.map((member) => member.id).filter((id) => picked.has(id)) };
}

function normalizeMembers(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const members = [];
  for (const raw of list) {
    if (!raw || typeof raw.id !== 'string') continue;
    const id = raw.id.trim();
    if (!id || seen.has(id)) continue;
    const displayName = String(raw.displayName || '').trim().replace(/\s+/g, ' ');
    if (!displayName) continue;
    const member = { id, displayName: displayName.slice(0, NAME_CAP) };
    if (raw.userId) member.userId = String(raw.userId);
    seen.add(id);
    members.push(member);
  }
  return members;
}

function isPlausibleExpense(expense) {
  return Boolean(
    expense &&
      typeof expense.id === 'string' &&
      (expense.currency === 'JPY' || expense.currency === 'TWD') &&
      Number.isFinite(Number(expense.amount)) &&
      typeof expense.payerId === 'string' &&
      Array.isArray(expense.shares),
  );
}

function cleanName(value) {
  const name = String(value || '').trim().replace(/\s+/g, ' ');
  if (!name) return fail('請輸入旅伴名字');
  if (name.length > NAME_CAP) return fail('名字請在 20 字以內');
  return { ok: true, name };
}

function csvCell(value) {
  const text = value == null ? '' : String(value);
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function newId(prefix) {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}
