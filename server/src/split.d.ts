export type Currency = 'JPY' | 'TWD';
export type SplitMode = 'equal' | 'custom' | 'ratio' | 'exclude';

export interface BillMember {
  /** Login account id. Members are accounts, not a separate name list. */
  id: string;
  /** Filled from the login account when the trip is shown. */
  displayName?: string;
  username?: string;
}

export interface Settlement {
  id: string;
  payerId: string;
  payeeId: string;
  amount: number;
  amountMinor: number;
  currency: Currency;
  createdAt: string;
}

export interface ExpenseShare {
  memberId: string;
  amount: number;
  amountMinor: number;
}

export interface ExpensePart {
  memberId: string;
  amount?: number;
  weight?: number;
}

export interface Expense {
  id: string;
  payerId: string;
  currency: Currency;
  amount: number;
  amountMinor: number;
  note: string;
  day: number | null;
  stopId: string | null;
  mode: SplitMode;
  memberIds: string[];
  parts: ExpensePart[];
  shares: ExpenseShare[];
  createdAt: string;
  updatedAt: string;
}

export interface PreparedExpense {
  payerId: string;
  currency: Currency;
  amount: number;
  amountMinor: number;
  note: string;
  day: number | null;
  stopId: string | null;
  mode: SplitMode;
  memberIds: string[];
  parts: ExpensePart[];
  shares: ExpenseShare[];
}

export interface BillInput {
  id?: string;
  payerId: string;
  currency: string;
  amount: number | string;
  note?: string;
  day?: number | string | null;
  stopId?: string | null;
  mode: string;
  memberIds?: string[];
  parts?: { memberId: string; amount?: number | string; weight?: number | string }[];
}

export interface Transfer {
  fromId: string;
  toId: string;
  amount: number;
  amountMinor: number;
}

export interface NetBalance {
  memberId: string;
  net: number;
  netMinor: number;
}

export interface CurrencySettlement {
  nets: NetBalance[];
  transfers: Transfer[];
}

export interface RecordedTransfer {
  payerId: string;
  payeeId: string;
  amount: number;
  amountMinor: number;
}

export interface CurrencyBook {
  currency: Currency;
  spentMinor: number;
  hasExpenses: boolean;
  hasRecorded: boolean;
  /** Recorded transfers exist and this currency has no expenses. */
  recordedOnly: boolean;
  /** Expense nets. Null when this currency has no expenses, so the UI does not call everyone settled. */
  nets: NetBalance[] | null;
  /** Expense transfers. Null when there are no expenses, or when recorded transfers replace them with remaining. */
  suggested: Transfer[] | null;
  expenseBalanced: boolean;
  /** Null unless this currency has both expenses and recorded transfers. */
  remaining: Transfer[] | null;
  remainingSettled: boolean;
  recorded: RecordedTransfer[];
}

export interface AccountRef {
  id: string;
  username?: string;
  displayName?: string;
}

export interface BillFields {
  members: BillMember[];
  expenses: Expense[];
  settlements: Settlement[];
}

export const CURRENCIES: Currency[];
export const SPLIT_MODES: SplitMode[];
export const MODE_LABELS: Record<SplitMode, string>;

export function defaultMembers(): BillMember[];
export function ensureBill<T extends object>(state: T): T & BillFields;
export function isTripMember(state: object, accountId: string | null | undefined): boolean;
export function memberAddAllowed(
  state: object,
  callerId: string | null | undefined,
  accountId: string | null | undefined,
): { ok: true } | { ok: false; error: string };
export function fromMinor(minor: number, currency: Currency): number;
export function toMinor(amount: number | string, currency: Currency): number;
export function formatMinor(minor: number, currency: Currency): string;
export function formatMoney(amount: number | string, currency: Currency): string;
export function prepareExpense(
  state: object,
  input: BillInput,
): { ok: true; expense: PreparedExpense } | { ok: false; error: string };
export function upsertExpense<T extends object>(
  state: T,
  input: BillInput,
): { ok: true; state: T & BillFields } | { ok: false; error: string };
export function deleteExpense<T extends object>(
  state: T,
  id: string,
): { ok: true; state: T & BillFields } | { ok: false; error: string };
export function addMember<T extends object>(
  state: T,
  input: { username?: string; accountId?: string; id?: string },
  accounts: AccountRef[],
): { ok: true; state: T & BillFields } | { ok: false; error: string };
export function removeMember<T extends object>(
  state: T,
  id: string,
): { ok: true; state: T & BillFields } | { ok: false; error: string };
export function addSettlement<T extends object>(
  state: T,
  input: { payerId?: string; payeeId?: string; amount?: number | string; currency?: string },
): { ok: true; state: T & BillFields } | { ok: false; error: string };
export function deleteSettlement<T extends object>(
  state: T,
  id: string,
): { ok: true; state: T & BillFields } | { ok: false; error: string };
export function settlementOf(state: object): Record<Currency, CurrencySettlement>;
export function currencyBooks(state: object): Record<Currency, CurrencyBook>;
export function convertMinor(minor: number, from: Currency, to: Currency, twdPerJpy: number): number;
export function crossSettlement(
  state: object,
  target: Currency,
  twdPerJpy: number,
): CurrencySettlement & { currency: Currency; twdPerJpy: number } | null;
export function minTransfers(nets: { id: string; amount: number }[]): { fromId: string; toId: string; amount: number }[];
export function billToCsv(state: object, twdPerJpy?: number | null): string;
