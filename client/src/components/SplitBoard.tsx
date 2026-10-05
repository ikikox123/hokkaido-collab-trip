import { useEffect, useMemo, useState } from 'react';
import type { Socket } from 'socket.io-client';
import type { FxView } from '../../../server/src/fx.js';
import {
  billToCsv,
  convertMinor,
  crossSettlement,
  currencyBooks,
  formatMinor,
  toMinor,
  type BillInput,
  type Currency,
  type Expense,
  type Transfer,
} from '../../../server/src/split.js';
import { localizeError } from '../i18n/errors';
import type { Translate } from '../i18n/I18nProvider';
import { useI18n } from '../i18n/I18nProvider';
import { splitModeLabel } from '../i18n/labels';
import { displayStopTitle } from '../i18n/stopNames';
import { downloadText, emitAck } from '../lib/bill';
import { splitShareText } from '../lib/splitLink';
import type { TripState } from '../types/trip';
import { ExpenseEditor } from './ExpenseEditor';
import { FxCard } from './FxCard';

type Props = {
  trip: TripState;
  canEdit: boolean;
  userId: string | null;
  username: string | null;
  socket: Socket | null;
  token: string | null;
  fx: FxView | null;
  composeToken: number;
  onNeedLogin: () => void;
  onJumpToDay: (day: number, stopId: string | null) => void;
};

type Filter = 'all' | Currency;

function minorOf(expense: Expense) {
  return Number.isInteger(expense.amountMinor) ? expense.amountMinor : toMinor(expense.amount, expense.currency);
}

function TransferList({
  transfers,
  currency,
  nameOf,
}: {
  transfers: Transfer[];
  currency: Currency;
  nameOf: (id: string) => string;
}) {
  const { t } = useI18n();
  return (
    <ul className="mt-1 space-y-2">
      {transfers.map((transfer) => (
        <li key={`${transfer.fromId}-${transfer.toId}-${transfer.amountMinor}`} className="rounded-xl bg-snow-50 px-3 py-2">
          <p className="text-base font-semibold text-slate-800">
            {t('pays', { from: nameOf(transfer.fromId), to: nameOf(transfer.toId) })}
          </p>
          <p className="text-lg font-bold text-ice-700">{formatMinor(transfer.amountMinor, currency)}</p>
        </li>
      ))}
    </ul>
  );
}

function netPhrase(netMinor: number, currency: Currency, t: Translate) {
  if (netMinor === 0) return t('settled');
  if (netMinor > 0) return t('netReceive', { amount: formatMinor(netMinor, currency) });
  return t('netPay', { amount: formatMinor(-netMinor, currency) });
}

export function SplitBoard({
  trip,
  canEdit,
  userId,
  username,
  socket,
  token,
  fx,
  composeToken,
  onNeedLogin,
  onJumpToDay,
}: Props) {
  const { t, locale } = useI18n();
  const members = trip.members ?? [];
  const expenses = trip.expenses ?? [];
  const settlements = trip.settlements ?? [];
  const [filter, setFilter] = useState<Filter>('all');
  const [editor, setEditor] = useState<Expense | null | 'new'>(null);
  const [pending, setPending] = useState(false);
  const [accountName, setAccountName] = useState('');
  const [payerId, setPayerId] = useState('');
  const [payeeId, setPayeeId] = useState('');
  const [settleAmount, setSettleAmount] = useState('');
  const [settleCurrency, setSettleCurrency] = useState<Currency>('JPY');
  const [formError, setFormError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [shareFallback, setShareFallback] = useState<string | null>(null);
  const [settleIn, setSettleIn] = useState<Currency>('TWD');
  const isMember = Boolean(userId && members.some((member) => member.id === userId));
  const canSettle = Boolean(canEdit && isMember);
  const selfId = isMember ? userId : null;
  const books = useMemo(
    () => currencyBooks({ ...trip, members, expenses, settlements }),
    [trip, members, expenses, settlements],
  );
  const rate = fx?.effective?.twdPerJpy;
  const cross = useMemo(
    () => (rate ? crossSettlement({ ...trip, members, expenses }, settleIn, rate) : null),
    [trip, members, expenses, settleIn, rate],
  );

  useEffect(() => {
    if (composeToken > 0 && canSettle) {
      setFormError(null);
      setEditor('new');
    }
  }, [composeToken, canSettle]);

  const visible = expenses
    .filter((expense) => filter === 'all' || expense.currency === filter)
    .slice()
    .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));

  function nameOf(id: string) {
    return members.find((member) => member.id === id)?.displayName || t('memberLeft');
  }

  async function send(event: string, payload: Record<string, unknown>) {
    if (!canEdit || !token) {
      onNeedLogin();
      return { ok: false, error: t('loginToEdit') };
    }
    if (!socket) return { ok: false, error: t('notConnected') };
    setPending(true);
    setFormError(null);
    try {
      const result = await emitAck(socket, event, { ...payload, token });
      if (!result.ok) setFormError(localizeError(result.error || '無法更新', t));
      return result;
    } finally {
      setPending(false);
    }
  }

  async function sendAsMember(event: string, payload: Record<string, unknown>) {
    if (!canSettle) {
      if (!canEdit || !token) onNeedLogin();
      else setFormError(t('onlyMembersAct'));
      return { ok: false, error: t('onlyMembersAct') };
    }
    return send(event, payload);
  }

  function startAdd() {
    if (!canSettle) {
      if (!canEdit || !token) onNeedLogin();
      else setFormError(members.length === 0 ? t('loggedInNotMember') : t('askCompanionToAdd'));
      return;
    }
    setFormError(null);
    setEditor('new');
  }

  async function copyLink() {
    const text = splitShareText(window.location.origin);
    try {
      await navigator.clipboard.writeText(text);
      setShareFallback(null);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setShareFallback(text);
    }
  }

  async function saveExpense(input: BillInput) {
    const result = await send('expense:upsert', { expense: input });
    if (result.ok) setEditor(null);
  }

  async function removeExpense(expense: Expense) {
    if (!confirm(t('deleteExpenseConfirm'))) return;
    const result = await send('expense:delete', { id: expense.id });
    if (result.ok) setEditor(null);
  }

  const payerValue = payerId || selfId || members[0]?.id || '';
  const payeeValue = payeeId || members.find((member) => member.id !== payerValue)?.id || '';

  return (
    <div className="flex h-full min-h-0 flex-col overflow-x-hidden">
      <div className="flex shrink-0 items-center gap-2 border-b border-slate-100 bg-white px-3 py-2">
        <h2 className="min-w-0 flex-1 truncate text-base font-bold text-ice-700">{t('tabSplit')}</h2>
        {canEdit && (
          <button
            type="button"
            className="min-h-touch shrink-0 rounded-xl bg-snow-100 px-3 text-sm font-bold text-slate-700"
            onClick={() => void copyLink()}
          >
            {copied ? t('copied') : t('copyLink')}
          </button>
        )}
        <button
          type="button"
          className="min-h-touch shrink-0 rounded-xl bg-snow-100 px-3 text-sm font-bold text-slate-700"
          onClick={() =>
            downloadText(
              `hokkaido-split-${trip.roomCode || 'room'}.csv`,
              billToCsv(trip, rate ?? null),
              'text/csv;charset=utf-8',
            )
          }
        >
          {t('exportCsv')}
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-3 py-3">
        <p className="text-sm text-slate-500">{t('splitIntro')}</p>
        {!canEdit && (
          <p className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">{t('guestCanView')}</p>
        )}
        {canEdit && !isMember && members.length === 0 && (
          <p className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">{t('loggedInNotMember')}</p>
        )}
        {canEdit && !isMember && members.length > 0 && (
          <p className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">{t('askCompanionToAdd')}</p>
        )}
        {shareFallback && (
          <label className="block rounded-xl border border-slate-200 bg-white p-3 text-sm">
            <span className="font-bold text-slate-700">{t('copyYourself')}</span>
            <textarea
              readOnly
              className="mt-2 w-full rounded-lg border border-slate-200 p-2 text-base"
              rows={3}
              value={shareFallback}
              onFocus={(event) => event.currentTarget.select()}
            />
          </label>
        )}
        {formError && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{formError}</p>}

        <FxCard
          fx={fx}
          canEdit={canSettle}
          pending={pending}
          onOverride={(basis, value) => void send('fx:override', { basis, value })}
          onClear={() => void send('fx:clearOverride', {})}
        />

        <section className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-base font-bold text-ice-700">{t('crossTitle')}</h3>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {(
              [
                ['TWD', t('viewTwd')],
                ['JPY', t('viewJpy')],
              ] as [Currency, string][]
            ).map(([currency, label]) => (
              <button
                key={currency}
                type="button"
                className={`min-h-touch rounded-xl text-base font-bold ${
                  settleIn === currency ? 'bg-ice-600 text-white' : 'bg-snow-100 text-slate-700'
                }`}
                onClick={() => setSettleIn(currency)}
              >
                {label}
              </button>
            ))}
          </div>
          {!cross ? (
            <p className="mt-2 text-sm text-slate-600">{t('noRateSettle')}</p>
          ) : cross.transfers.length === 0 ? (
            <p className="mt-2 text-sm text-slate-600">{settleIn === 'TWD' ? t('balancedTwd') : t('balancedJpy')}</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {cross.transfers.map((transfer) => (
                <li key={`${transfer.fromId}-${transfer.toId}-${transfer.amountMinor}`} className="rounded-xl bg-snow-50 px-3 py-2">
                  <p className="text-base font-semibold text-slate-800">
                    {t('pays', { from: nameOf(transfer.fromId), to: nameOf(transfer.toId) })}
                  </p>
                  <p className="text-lg font-bold text-ice-700">{formatMinor(transfer.amountMinor, settleIn)}</p>
                </li>
              ))}
            </ul>
          )}
        </section>

        <h3 className="text-sm font-bold text-slate-500">{t('originalBooks')}</h3>

        {(['JPY', 'TWD'] as Currency[]).map((currency) => {
          const book = books[currency];
          const mine = selfId && book.nets ? book.nets.find((net) => net.memberId === selfId) : undefined;
          const still = book.remaining ?? book.suggested;
          return (
            <section
              key={currency}
              className={`rounded-2xl border bg-white p-3 shadow-sm ${
                currency === 'JPY' ? 'border-ice-200' : 'border-amber-200'
              }`}
            >
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="text-base font-bold text-ice-700">{currency === 'JPY' ? t('yen') : t('twd')}</h3>
                <p className="text-sm text-slate-500">
                  {t('spentLine', { amount: formatMinor(book.spentMinor, currency) })}
                </p>
              </div>

              {book.recordedOnly ? (
                <p className="mt-2 text-sm font-semibold text-slate-700">{t('recordedNotDebt')}</p>
              ) : (
                <>
                  <h4 className="mt-3 text-sm font-bold text-slate-500">{t('expenseSettlement')}</h4>
                  {!book.hasExpenses && <p className="mt-1 text-sm text-slate-600">{t('noSpendCurrency')}</p>}
                  {still && (
                    <>
                      <h4 className="mt-3 text-sm font-bold text-slate-500">
                        {book.remaining ? t('stillNeedTransfer') : t('suggestedTransfers')}
                      </h4>
                      {book.remaining ? (
                        book.remainingSettled ? (
                          <p className="mt-1 rounded-xl bg-snow-100 px-3 py-2 text-base font-bold text-slate-900">
                            {t('settled')}
                          </p>
                        ) : (
                          <TransferList transfers={book.remaining} currency={currency} nameOf={nameOf} />
                        )
                      ) : still.length === 0 ? (
                        <p className="mt-1 text-sm text-slate-600">{t('alreadyBalanced')}</p>
                      ) : (
                        <TransferList transfers={still} currency={currency} nameOf={nameOf} />
                      )}
                    </>
                  )}
                  {book.notices.length > 0 && (
                    <>
                      <h4 className="mt-3 text-sm font-bold text-slate-500">{t('overpayOrReversed')}</h4>
                      <ul className="mt-1 space-y-2">
                        {book.notices.map((notice) => (
                          <li
                            key={`${notice.kind}-${notice.fromId}-${notice.toId}`}
                            className="rounded-xl bg-snow-50 px-3 py-2 text-base font-semibold text-slate-800"
                          >
                            {notice.kind === 'overpay'
                              ? t('overpaid', {
                                  from: nameOf(notice.fromId),
                                  to: nameOf(notice.toId),
                                  amount: formatMinor(notice.amountMinor, currency),
                                })
                              : t('reversedPay', {
                                  from: nameOf(notice.fromId),
                                  to: nameOf(notice.toId),
                                  amount: formatMinor(notice.amountMinor, currency),
                                })}
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                  {mine && (
                    <p className="mt-2 rounded-xl bg-snow-100 px-3 py-2 text-base font-bold text-slate-900">
                      {t('youNet', { phrase: netPhrase(mine.netMinor, currency, t) })}
                    </p>
                  )}
                  {book.nets && (
                    <>
                      <h4 className="mt-3 text-sm font-bold text-slate-500">{t('netEach')}</h4>
                      <ul>
                        {book.nets.map((net) => (
                          <li
                            key={net.memberId}
                            className="flex min-h-touch items-center justify-between gap-3 border-t border-slate-100 text-base"
                          >
                            <span className="min-w-0 truncate font-semibold">
                              {nameOf(net.memberId)}
                              {net.memberId === selfId ? t('youSuffix') : ''}
                            </span>
                            <span
                              className={`shrink-0 font-bold ${
                                net.netMinor > 0 ? 'text-ice-700' : net.netMinor < 0 ? 'text-sakura-500' : 'text-slate-400'
                              }`}
                            >
                              {netPhrase(net.netMinor, currency, t)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </>
              )}

              <h4 className="mt-3 text-sm font-bold text-slate-500">{t('recordedTransfers')}</h4>
              {book.recorded.length === 0 ? (
                <p className="mt-1 text-sm text-slate-600">{t('noRecordedCurrency')}</p>
              ) : (
                <ul className="mt-1 space-y-2">
                  {book.recorded.map((row) => (
                    <li key={`${row.payerId}-${row.payeeId}`} className="rounded-xl bg-snow-50 px-3 py-2">
                      <p className="text-base font-semibold text-slate-800">
                        {t('pays', { from: nameOf(row.payerId), to: nameOf(row.payeeId) })}
                      </p>
                      <p className="text-lg font-bold text-ice-700">
                        {t('recordedTotal', { amount: formatMinor(row.amountMinor, currency) })}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}

        <div className="grid grid-cols-3 gap-2">
          {(
            [
              ['all', t('filterAll')],
              ['JPY', t('yen')],
              ['TWD', t('twd')],
            ] as [Filter, string][]
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={`min-h-touch rounded-xl text-sm font-bold ${
                filter === value ? 'bg-ice-600 text-white' : 'bg-white text-slate-700'
              }`}
              onClick={() => setFilter(value)}
            >
              {label}
            </button>
          ))}
        </div>

        {visible.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-300 bg-white px-3 py-6 text-center text-base text-slate-500">
            {expenses.length === 0 ? t('noExpenses') : t('noExpensesFilter')}
          </p>
        ) : (
          <ul className="space-y-2">
            {visible.map((expense) => {
              const day = trip.days.find((item) => item.day === expense.day);
              const stop = trip.stops.find((item) => item.id === expense.stopId);
              const shareLine = expense.shares
                .map((share) => {
                  const minor = Number.isInteger(share.amountMinor)
                    ? share.amountMinor
                    : toMinor(share.amount, expense.currency);
                  return `${nameOf(share.memberId)} ${formatMinor(minor, expense.currency)}`;
                })
                .join(t('listSep'));
              const other = expense.currency === 'JPY' ? 'TWD' : 'JPY';
              const converted = rate ? convertMinor(minorOf(expense), expense.currency, other, rate) : NaN;
              return (
                <li key={expense.id} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-md px-2 py-0.5 text-sm font-bold text-white ${
                        expense.currency === 'JPY' ? 'bg-ice-600' : 'bg-amber-500'
                      }`}
                    >
                      {expense.currency === 'JPY' ? t('yen') : t('twd')}
                    </span>
                    <span className="rounded-md bg-snow-100 px-2 py-0.5 text-sm font-bold text-slate-600">
                      {splitModeLabel(t, expense.mode)}
                    </span>
                    <span className="text-lg font-bold">{formatMinor(minorOf(expense), expense.currency)}</span>
                    {Number.isFinite(converted) && (
                      <span className="text-sm font-semibold text-slate-500">
                        {t('approxAmount', { amount: formatMinor(converted, other) })}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 break-words text-base font-semibold">{expense.note || t('noNote')}</p>
                  <p className="mt-1 text-sm text-slate-600">{t('paidBy', { name: nameOf(expense.payerId) })}</p>
                  <p className="mt-1 break-words text-sm text-slate-600">{shareLine}</p>
                  {(day || expense.stopId) && (
                    <button
                      type="button"
                      className="mt-2 min-h-touch max-w-full truncate rounded-lg text-left text-sm font-semibold text-ice-700"
                      onClick={() => onJumpToDay(expense.day ?? stop?.day ?? 1, expense.stopId)}
                    >
                      {day ? `${day.label} ${day.date.slice(5)}` : t('itineraryWord')}
                      {expense.stopId ? ` · ${stop ? displayStopTitle(locale, stop.title) : t('stopDeleted')}` : ''}
                    </button>
                  )}
                  {canSettle && (
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        className="min-h-touch rounded-xl bg-snow-100 text-base font-bold text-slate-800"
                        onClick={() => {
                          setFormError(null);
                          setEditor(expense);
                        }}
                      >
                        {t('edit')}
                      </button>
                      <button
                        type="button"
                        className="min-h-touch rounded-xl border border-red-200 text-base font-bold text-red-700"
                        onClick={() => void removeExpense(expense)}
                      >
                        {t('delete')}
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <section className="rounded-2xl border border-slate-200 bg-white p-3">
          <h3 className="text-base font-bold text-ice-700">{t('companions')}</h3>
          <p className="mt-1 text-sm text-slate-500">{t('companionsHint')}</p>
          {members.length === 0 ? (
            <p className="mt-2 text-sm text-slate-600">{t('noCompanions')}</p>
          ) : (
            <ul className="mt-2">
              {members.map((member) => (
                <li key={member.id} className="border-t border-slate-100 py-2">
                  <div className="flex items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-base font-semibold">
                        {member.displayName || t('unknownAccount')}
                        {member.id === selfId ? t('youSuffix') : ''}
                      </p>
                      {member.username && (
                        <p className="text-sm text-slate-500">{t('accountLine', { username: member.username })}</p>
                      )}
                    </div>
                    {canSettle && (
                      <button
                        type="button"
                        className="min-h-touch shrink-0 rounded-xl border border-slate-200 px-3 text-sm font-bold text-slate-600"
                        onClick={() => {
                          if (
                            !confirm(
                              t('removeConfirm', {
                                name: member.displayName || member.username || t('thisCompanion'),
                              }),
                            )
                          )
                            return;
                          void sendAsMember('member:remove', { id: member.id });
                        }}
                      >
                        {t('remove')}
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {canEdit && !isMember && members.length === 0 && (
            <button
              type="button"
              className="mt-2 min-h-touch w-full rounded-xl bg-ice-600 text-base font-bold text-white"
              onClick={() => {
                if (!username) {
                  onNeedLogin();
                  return;
                }
                void send('member:add', { username });
              }}
            >
              {t('addMyself')}
            </button>
          )}
          {canSettle && (
            <form
              className="mt-2 flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                void sendAsMember('trip:addMember', { username: accountName }).then((result) => {
                  if (result.ok) setAccountName('');
                });
              }}
            >
              <input
                className="min-h-touch min-w-0 flex-1 rounded-xl border border-slate-200 px-3 text-base"
                value={accountName}
                maxLength={32}
                placeholder={t('registeredAccountPlaceholder')}
                aria-label={t('companionAccountAria')}
                autoCapitalize="none"
                autoCorrect="off"
                onChange={(event) => setAccountName(event.target.value)}
              />
              <button type="submit" className="min-h-touch shrink-0 rounded-xl bg-ice-600 px-4 text-sm font-bold text-white">
                {t('join')}
              </button>
            </form>
          )}
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
          <h3 className="text-base font-bold text-ice-700">{t('recordedSettlements')}</h3>
          <p className="mt-1 text-sm text-slate-500">{t('recordedSettlementsHint')}</p>
          {canSettle && members.length < 2 && <p className="mt-2 text-sm text-slate-600">{t('needTwoCompanions')}</p>}
          {canSettle && members.length >= 2 && (
            <form
              className="mt-3 space-y-2"
              onSubmit={(event) => {
                event.preventDefault();
                const payer = payerId || selfId || members[0]?.id || '';
                const payee = payeeId || members.find((member) => member.id !== payer)?.id || '';
                void sendAsMember('settlement:add', {
                  settlement: { payerId: payer, payeeId: payee, amount: settleAmount, currency: settleCurrency },
                }).then((result) => {
                  if (result.ok) setSettleAmount('');
                });
              }}
            >
              <label className="block text-sm font-bold text-slate-600">
                {t('payer')}
                <select
                  className="mt-1 min-h-touch w-full rounded-xl border border-slate-200 bg-white px-3 text-base"
                  value={payerValue}
                  onChange={(event) => setPayerId(event.target.value)}
                >
                  {members.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.displayName || member.username || member.id}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm font-bold text-slate-600">
                {t('payee')}
                <select
                  className="mt-1 min-h-touch w-full rounded-xl border border-slate-200 bg-white px-3 text-base"
                  value={payeeValue}
                  onChange={(event) => setPayeeId(event.target.value)}
                >
                  {members.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.displayName || member.username || member.id}
                    </option>
                  ))}
                </select>
              </label>
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    ['JPY', t('yen')],
                    ['TWD', t('twd')],
                  ] as [Currency, string][]
                ).map(([currency, label]) => (
                  <button
                    key={currency}
                    type="button"
                    className={`min-h-touch rounded-xl text-base font-bold ${
                      settleCurrency === currency ? 'bg-ice-600 text-white' : 'bg-snow-100 text-slate-700'
                    }`}
                    onClick={() => setSettleCurrency(currency)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <input
                className="min-h-touch w-full rounded-xl border border-slate-200 px-3 text-base"
                inputMode="decimal"
                placeholder={t('amount')}
                aria-label={t('settleAmountAria')}
                value={settleAmount}
                onChange={(event) => setSettleAmount(event.target.value)}
              />
              <button type="submit" className="min-h-touch w-full rounded-xl bg-ice-600 text-base font-bold text-white">
                {t('recordSettlement')}
              </button>
            </form>
          )}
          {settlements.length === 0 ? (
            <p className="mt-3 text-sm text-slate-600">{t('noRecordedSettlements')}</p>
          ) : (
            <ul
              className="mt-3 max-h-64 space-y-2 overflow-y-auto overscroll-contain pr-1"
              aria-label={t('recordedSettlements')}
            >
              {settlements.map((row) => (
                <li key={row.id} className="rounded-xl bg-snow-50 px-3 py-2">
                  <p className="text-base font-semibold text-slate-800">
                    {t('pays', { from: nameOf(row.payerId), to: nameOf(row.payeeId) })}
                  </p>
                  <p className="text-lg font-bold text-ice-700">
                    {formatMinor(
                      Number.isInteger(row.amountMinor) ? row.amountMinor : toMinor(row.amount, row.currency),
                      row.currency,
                    )}
                  </p>
                  {canSettle && (
                    <button
                      type="button"
                      className="mt-2 min-h-touch rounded-xl border border-red-200 px-3 text-sm font-bold text-red-700"
                      onClick={() => {
                        if (!confirm(t('deleteSettlementConfirm'))) return;
                        void sendAsMember('settlement:delete', { id: row.id });
                      }}
                    >
                      {t('delete')}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="shrink-0 border-t border-slate-200 bg-white px-3 py-2">
        <button
          type="button"
          className="min-h-touch w-full rounded-xl bg-ice-600 text-lg font-bold text-white shadow active:bg-ice-700"
          onClick={startAdd}
        >
          {t('addExpense')}
        </button>
      </div>

      {editor !== null && (
        <ExpenseEditor
          trip={trip}
          expense={editor === 'new' ? null : editor}
          selfId={selfId}
          pending={pending}
          onClose={() => setEditor(null)}
          onSubmit={(input) => void saveExpense(input)}
          onDelete={() => {
            if (editor !== 'new') void removeExpense(editor);
          }}
        />
      )}
    </div>
  );
}
