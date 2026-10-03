import { useEffect, useMemo, useState } from 'react';
import type { Socket } from 'socket.io-client';
import type { FxView } from '../../../server/src/fx.js';
import {
  MODE_LABELS,
  billToCsv,
  convertMinor,
  crossSettlement,
  formatMinor,
  settlementOf,
  toMinor,
  type BillInput,
  type Currency,
  type Expense,
} from '../../../server/src/split.js';
import { downloadText, emitAck } from '../lib/bill';
import { splitShareText } from '../lib/splitLink';
import type { TripState } from '../types/trip';
import { ExpenseEditor } from './ExpenseEditor';
import { FxCard } from './FxCard';

type Props = {
  trip: TripState;
  canEdit: boolean;
  userId: string | null;
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

function netPhrase(netMinor: number, currency: Currency) {
  if (netMinor === 0) return '已結清';
  if (netMinor > 0) return `應收 ${formatMinor(netMinor, currency)}`;
  return `應付 ${formatMinor(-netMinor, currency)}`;
}

export function SplitBoard({
  trip,
  canEdit,
  userId,
  socket,
  token,
  fx,
  composeToken,
  onNeedLogin,
  onJumpToDay,
}: Props) {
  const members = trip.members ?? [];
  const expenses = trip.expenses ?? [];
  const [filter, setFilter] = useState<Filter>('all');
  const [editor, setEditor] = useState<Expense | null | 'new'>(null);
  const [pending, setPending] = useState(false);
  const [rename, setRename] = useState<{ id: string; value: string } | null>(null);
  const [memberName, setMemberName] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [shareFallback, setShareFallback] = useState<string | null>(null);
  const [settleIn, setSettleIn] = useState<Currency>('TWD');
  const selfId = members.find((member) => member.userId && member.userId === userId)?.id ?? null;
  const settlement = useMemo(() => settlementOf({ ...trip, members, expenses }), [trip, members, expenses]);
  const rate = fx?.effective?.twdPerJpy;
  const cross = useMemo(
    () => (rate ? crossSettlement({ ...trip, members, expenses }, settleIn, rate) : null),
    [trip, members, expenses, settleIn, rate],
  );

  useEffect(() => {
    if (composeToken > 0 && canEdit) {
      setFormError(null);
      setEditor('new');
    }
  }, [composeToken, canEdit]);

  const visible = expenses
    .filter((expense) => filter === 'all' || expense.currency === filter)
    .slice()
    .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));

  function nameOf(id: string) {
    return members.find((member) => member.id === id)?.displayName || '（已離開）';
  }

  async function send(event: string, payload: Record<string, unknown>) {
    if (!canEdit || !token) {
      onNeedLogin();
      return { ok: false, error: '請先登入才能編輯' };
    }
    if (!socket) return { ok: false, error: '尚未連線' };
    setPending(true);
    setFormError(null);
    try {
      const result = await emitAck(socket, event, { ...payload, token });
      if (!result.ok) setFormError(result.error || '無法更新');
      return result;
    } finally {
      setPending(false);
    }
  }

  function startAdd() {
    if (!canEdit || !token) {
      onNeedLogin();
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
    if (!confirm('確定刪除這筆支出？')) return;
    const result = await send('expense:delete', { id: expense.id });
    if (result.ok) setEditor(null);
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-x-hidden">
      <div className="flex shrink-0 items-center gap-2 border-b border-slate-100 bg-white px-3 py-2">
        <h2 className="min-w-0 flex-1 truncate text-base font-bold text-ice-700">分帳</h2>
        {canEdit && (
          <button
            type="button"
            className="min-h-touch shrink-0 rounded-xl bg-snow-100 px-3 text-sm font-bold text-slate-700"
            onClick={() => void copyLink()}
          >
            {copied ? '已複製' : '複製連結'}
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
          匯出
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-3 py-3">
        <p className="text-sm text-slate-500">支出用原幣別記。換算只用目前匯率，讓大家看該給多少台幣或日圓。</p>
        {!canEdit && (
          <p className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">
            還沒登入也可以看帳。要記一筆，按下面的新增支出。
          </p>
        )}
        {shareFallback && (
          <label className="block rounded-xl border border-slate-200 bg-white p-3 text-sm">
            <span className="font-bold text-slate-700">請自己複製這段</span>
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
          canEdit={canEdit}
          pending={pending}
          onOverride={(basis, value) => void send('fx:override', { basis, value })}
          onClear={() => void send('fx:clearOverride', {})}
        />

        <section className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-base font-bold text-ice-700">換算後怎麼結</h3>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {(
              [
                ['TWD', '用台幣看'],
                ['JPY', '用日圓看'],
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
            <p className="mt-2 text-sm text-slate-600">還沒有匯率，先不換算結算。</p>
          ) : cross.transfers.length === 0 ? (
            <p className="mt-2 text-sm text-slate-600">換成{settleIn === 'TWD' ? '台幣' : '日圓'}之後已經平衡。</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {cross.transfers.map((transfer) => (
                <li key={`${transfer.fromId}-${transfer.toId}-${transfer.amountMinor}`} className="rounded-xl bg-snow-50 px-3 py-2">
                  <p className="text-base font-semibold text-slate-800">
                    {nameOf(transfer.fromId)} 付給 {nameOf(transfer.toId)}
                  </p>
                  <p className="text-lg font-bold text-ice-700">{formatMinor(transfer.amountMinor, settleIn)}</p>
                </li>
              ))}
            </ul>
          )}
        </section>

        <h3 className="text-sm font-bold text-slate-500">各幣別原本的帳</h3>

        {(['JPY', 'TWD'] as Currency[]).map((currency) => {
          const book = settlement[currency];
          const spent = expenses
            .filter((expense) => expense.currency === currency)
            .reduce((sum, expense) => sum + minorOf(expense), 0);
          const mine = selfId ? book.nets.find((net) => net.memberId === selfId) : undefined;
          return (
            <section
              key={currency}
              className={`rounded-2xl border bg-white p-3 shadow-sm ${
                currency === 'JPY' ? 'border-ice-200' : 'border-amber-200'
              }`}
            >
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="text-base font-bold text-ice-700">{currency === 'JPY' ? '日圓' : '新台幣'}</h3>
                <p className="text-sm text-slate-500">支出 {formatMinor(spent, currency)}</p>
              </div>
              {mine && (
                <p className="mt-2 rounded-xl bg-snow-100 px-3 py-2 text-base font-bold text-slate-900">
                  你：{netPhrase(mine.netMinor, currency)}
                </p>
              )}
              <h4 className="mt-3 text-sm font-bold text-slate-500">建議轉帳</h4>
              {book.transfers.length === 0 ? (
                <p className="mt-1 text-sm text-slate-600">
                  {spent === 0 ? '還沒有這筆幣別的支出' : '已經平衡，不用再轉'}
                </p>
              ) : (
                <ul className="mt-1 space-y-2">
                  {book.transfers.map((transfer) => (
                    <li
                      key={`${transfer.fromId}-${transfer.toId}-${transfer.amountMinor}`}
                      className="rounded-xl bg-snow-50 px-3 py-2"
                    >
                      <p className="text-base font-semibold text-slate-800">
                        {nameOf(transfer.fromId)} 付給 {nameOf(transfer.toId)}
                      </p>
                      <p className="text-lg font-bold text-ice-700">{formatMinor(transfer.amountMinor, currency)}</p>
                    </li>
                  ))}
                </ul>
              )}
              <h4 className="mt-3 text-sm font-bold text-slate-500">每人淨額</h4>
              <ul>
                {book.nets.map((net) => (
                  <li
                    key={net.memberId}
                    className="flex min-h-touch items-center justify-between gap-3 border-t border-slate-100 text-base"
                  >
                    <span className="min-w-0 truncate font-semibold">
                      {nameOf(net.memberId)}
                      {net.memberId === selfId ? '（你）' : ''}
                    </span>
                    <span
                      className={`shrink-0 font-bold ${
                        net.netMinor > 0 ? 'text-ice-700' : net.netMinor < 0 ? 'text-sakura-500' : 'text-slate-400'
                      }`}
                    >
                      {netPhrase(net.netMinor, currency)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}

        <div className="grid grid-cols-3 gap-2">
          {(
            [
              ['all', '全部'],
              ['JPY', '日圓'],
              ['TWD', '新台幣'],
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
            {expenses.length === 0 ? '還沒有支出' : '這個幣別還沒有支出'}
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
                .join('、');
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
                      {expense.currency === 'JPY' ? '日圓' : '新台幣'}
                    </span>
                    <span className="rounded-md bg-snow-100 px-2 py-0.5 text-sm font-bold text-slate-600">
                      {MODE_LABELS[expense.mode]}
                    </span>
                    <span className="text-lg font-bold">{formatMinor(minorOf(expense), expense.currency)}</span>
                    {Number.isFinite(converted) && (
                      <span className="text-sm font-semibold text-slate-500">約 {formatMinor(converted, other)}</span>
                    )}
                  </div>
                  <p className="mt-1 break-words text-base font-semibold">{expense.note || '未填備註'}</p>
                  <p className="mt-1 text-sm text-slate-600">{nameOf(expense.payerId)} 付款</p>
                  <p className="mt-1 break-words text-sm text-slate-600">{shareLine}</p>
                  {(day || expense.stopId) && (
                    <button
                      type="button"
                      className="mt-2 min-h-touch max-w-full truncate rounded-lg text-left text-sm font-semibold text-ice-700"
                      onClick={() => onJumpToDay(expense.day ?? stop?.day ?? 1, expense.stopId)}
                    >
                      {day ? `${day.label} ${day.date.slice(5)}` : '行程'}
                      {expense.stopId ? ` · ${stop?.title || '站點已刪除'}` : ''}
                    </button>
                  )}
                  {canEdit && (
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        className="min-h-touch rounded-xl bg-snow-100 text-base font-bold text-slate-800"
                        onClick={() => {
                          setFormError(null);
                          setEditor(expense);
                        }}
                      >
                        編輯
                      </button>
                      <button
                        type="button"
                        className="min-h-touch rounded-xl border border-red-200 text-base font-bold text-red-700"
                        onClick={() => void removeExpense(expense)}
                      >
                        刪除
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <section className="rounded-2xl border border-slate-200 bg-white p-3">
          <h3 className="text-base font-bold text-ice-700">旅伴</h3>
          <ul className="mt-2">
            {members.map((member) => (
              <li key={member.id} className="border-t border-slate-100 py-2">
                {rename?.id === member.id ? (
                  <form
                    className="flex gap-2"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void send('member:rename', { id: member.id, displayName: rename.value }).then((result) => {
                        if (result.ok) setRename(null);
                      });
                    }}
                  >
                    <input
                      className="min-w-0 flex-1 min-h-touch rounded-xl border border-slate-200 px-3 text-base"
                      value={rename.value}
                      maxLength={20}
                      onChange={(event) => setRename({ id: member.id, value: event.target.value })}
                    />
                    <button type="submit" className="min-h-touch shrink-0 rounded-xl bg-ice-600 px-3 text-sm font-bold text-white">
                      儲存
                    </button>
                    <button
                      type="button"
                      className="min-h-touch shrink-0 rounded-xl bg-snow-100 px-3 text-sm font-bold"
                      onClick={() => setRename(null)}
                    >
                      取消
                    </button>
                  </form>
                ) : (
                  <div className="flex items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-base font-semibold">{member.displayName}</p>
                      {member.userId && <p className="text-sm text-slate-500">可登入</p>}
                    </div>
                    {canEdit && (
                      <>
                        <button
                          type="button"
                          className="min-h-touch shrink-0 rounded-xl bg-snow-100 px-3 text-sm font-bold"
                          onClick={() => setRename({ id: member.id, value: member.displayName })}
                        >
                          改名
                        </button>
                        <button
                          type="button"
                          className="min-h-touch shrink-0 rounded-xl border border-slate-200 px-3 text-sm font-bold text-slate-600"
                          onClick={() => {
                            if (!confirm(`確定移除「${member.displayName}」？`)) return;
                            void send('member:remove', { id: member.id });
                          }}
                        >
                          移除
                        </button>
                      </>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
          {canEdit && (
            <form
              className="mt-2 flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                void send('member:add', { displayName: memberName }).then((result) => {
                  if (result.ok) setMemberName('');
                });
              }}
            >
              <input
                className="min-w-0 flex-1 min-h-touch rounded-xl border border-slate-200 px-3 text-base"
                value={memberName}
                maxLength={20}
                placeholder="加入旅伴"
                onChange={(event) => setMemberName(event.target.value)}
              />
              <button type="submit" className="min-h-touch shrink-0 rounded-xl bg-ice-600 px-4 text-sm font-bold text-white">
                加入
              </button>
            </form>
          )}
        </section>
      </div>

      <div className="shrink-0 border-t border-slate-200 bg-white px-3 py-2">
        <button
          type="button"
          className="min-h-touch w-full rounded-xl bg-ice-600 text-lg font-bold text-white shadow active:bg-ice-700"
          onClick={startAdd}
        >
          新增支出
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
