import { useMemo, useState } from 'react';
import {
  formatMinor,
  prepareExpense,
  type BillInput,
  type Currency,
  type Expense,
  type SplitMode,
} from '../../../server/src/split.js';
import { localizeError } from '../i18n/errors';
import { useI18n } from '../i18n/I18nProvider';
import { splitModeLabel } from '../i18n/labels';
import type { TripState } from '../types/trip';

const MODES: SplitMode[] = ['equal', 'custom', 'ratio', 'exclude'];

type Draft = {
  payerId: string;
  currency: Currency;
  amount: string;
  note: string;
  day: string;
  stopId: string;
  mode: SplitMode;
  selected: string[];
  values: Record<string, string>;
};

type Props = {
  trip: TripState;
  expense: Expense | null;
  selfId: string | null;
  pending: boolean;
  onClose: () => void;
  onSubmit: (input: BillInput) => void;
  onDelete: () => void;
};

function draftFrom(expense: Expense | null, trip: TripState, selfId: string | null): Draft {
  const members = trip.members ?? [];
  if (!expense) {
    const payerId = selfId && members.some((member) => member.id === selfId) ? selfId : members[0]?.id || '';
    return {
      payerId,
      currency: 'JPY',
      amount: '',
      note: '',
      day: '',
      stopId: '',
      mode: 'equal',
      selected: members.map((member) => member.id),
      values: {},
    };
  }
  const values: Record<string, string> = {};
  if (expense.mode === 'custom') {
    for (const part of expense.parts) {
      if (part.amount != null) values[part.memberId] = String(part.amount);
    }
  }
  if (expense.mode === 'ratio') {
    for (const part of expense.parts) {
      if (part.weight != null) values[part.memberId] = String(part.weight);
    }
  }
  return {
    payerId: expense.payerId,
    currency: expense.currency,
    amount: String(expense.amount),
    note: expense.note,
    day: expense.day == null ? '' : String(expense.day),
    stopId: expense.stopId || '',
    mode: expense.mode,
    selected: [...expense.memberIds],
    values,
  };
}

function toInput(draft: Draft, id?: string): BillInput {
  return {
    id,
    payerId: draft.payerId,
    currency: draft.currency,
    amount: draft.amount,
    note: draft.note,
    day: draft.day || null,
    stopId: draft.stopId || null,
    mode: draft.mode,
    memberIds: draft.selected,
    parts: draft.selected.map((memberId) => {
      if (draft.mode === 'custom') return { memberId, amount: draft.values[memberId] ?? '' };
      if (draft.mode === 'ratio') return { memberId, weight: draft.values[memberId] ?? '' };
      return { memberId };
    }),
  };
}

export function ExpenseEditor({ trip, expense, selfId, pending, onClose, onSubmit, onDelete }: Props) {
  const [draft, setDraft] = useState(() => draftFrom(expense, trip, selfId));
  const [showAdvanced, setShowAdvanced] = useState(() => {
    if (!expense) return false;
    const everyone = (trip.members ?? []).map((member) => member.id);
    const samePeople =
      expense.mode === 'equal' &&
      expense.memberIds.length === everyone.length &&
      everyone.every((id) => expense.memberIds.includes(id));
    return !samePeople || expense.day != null || Boolean(expense.stopId);
  });
  const members = trip.members ?? [];
  const { t } = useI18n();
  const preview = useMemo(() => prepareExpense(trip, toInput(draft, expense?.id)), [trip, draft, expense?.id]);

  const stops = trip.stops.filter((stop) => !draft.day || String(stop.day) === draft.day);
  const modeHint =
    draft.mode === 'equal'
      ? t('equalHint')
      : draft.mode === 'custom'
        ? t('customHint')
        : draft.mode === 'ratio'
          ? t('ratioHint')
          : t('excludeHint');

  function setMode(mode: SplitMode) {
    setDraft((current) => {
      if (current.mode === mode) return current;
      if (mode === 'exclude') return { ...current, mode, selected: [] };
      if (current.mode === 'exclude') {
        const excluded = new Set(current.selected);
        return {
          ...current,
          mode,
          selected: members.filter((member) => !excluded.has(member.id)).map((member) => member.id),
        };
      }
      const values = { ...current.values };
      if (mode === 'ratio') {
        for (const id of current.selected) {
          if (!values[id]) values[id] = '1';
        }
      }
      return { ...current, mode, values };
    });
  }

  function toggleMember(id: string) {
    setDraft((current) => {
      const on = current.selected.includes(id);
      const selected = on ? current.selected.filter((item) => item !== id) : [...current.selected, id];
      const values = { ...current.values };
      if (!on && current.mode === 'ratio' && !values[id]) values[id] = '1';
      return { ...current, selected, values };
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center" role="presentation">
      <button type="button" className="absolute inset-0 cursor-default" aria-label={t('close')} onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="expense-editor-title"
        className="relative z-10 flex max-h-[92dvh] w-full max-w-lg flex-col rounded-t-2xl bg-white shadow-xl sm:rounded-2xl"
      >
        <div className="shrink-0 px-4 pt-3">
          <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-slate-200 sm:hidden" />
          <h2 id="expense-editor-title" className="text-lg font-bold text-ice-700">
            {expense ? t('editExpense') : t('addExpense')}
          </h2>
        </div>
        <form
          className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (!preview.ok || pending) return;
            onSubmit(toInput(draft, expense?.id));
          }}
        >
          <label className="block">
            <span className="text-sm font-medium">{t('amount')}</span>
            <input
              autoFocus
              inputMode="decimal"
              className="mt-1 w-full min-h-touch rounded-xl border border-slate-200 px-3 text-base outline-none focus:border-ice-500 focus:ring-2 focus:ring-ice-500/30"
              value={draft.amount}
              placeholder={draft.currency === 'JPY' ? '1000' : '100.00'}
              onChange={(event) => setDraft((current) => ({ ...current, amount: event.target.value }))}
            />
          </label>

          <label className="block">
            <span className="text-sm font-medium">{t('payer')}</span>
            <select
              className="mt-1 w-full min-h-touch rounded-xl border border-slate-200 bg-white px-3 text-base"
              value={draft.payerId}
              onChange={(event) => setDraft((current) => ({ ...current, payerId: event.target.value }))}
            >
              {members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.displayName}
                </option>
              ))}
            </select>
          </label>

          <div>
            <span className="text-sm font-medium">{t('currency')}</span>
            <div className="mt-1 grid grid-cols-2 gap-2">
              {(['JPY', 'TWD'] as Currency[]).map((currency) => (
                <button
                  key={currency}
                  type="button"
                  className={`min-h-touch rounded-xl text-base font-bold ${
                    draft.currency === currency ? 'bg-ice-600 text-white' : 'bg-snow-100 text-slate-700'
                  }`}
                  onClick={() => setDraft((current) => ({ ...current, currency }))}
                >
                  {currency === 'JPY' ? t('yen') : t('twd')}
                </button>
              ))}
            </div>
          </div>

          <label className="block">
            <span className="text-sm font-medium">{t('note')}</span>
            <input
              className="mt-1 w-full min-h-touch rounded-xl border border-slate-200 px-3 text-base outline-none focus:border-ice-500 focus:ring-2 focus:ring-ice-500/30"
              value={draft.note}
              maxLength={200}
              placeholder={t('notePlaceholder')}
              onChange={(event) => setDraft((current) => ({ ...current, note: event.target.value }))}
            />
          </label>

          {!showAdvanced && draft.mode === 'equal' && (
            <p className="text-sm text-slate-500">{t('equalEveryone')}</p>
          )}

          <button
            type="button"
            className="min-h-touch w-full rounded-xl bg-snow-100 px-3 text-left text-base font-bold text-slate-800"
            aria-expanded={showAdvanced}
            onClick={() => setShowAdvanced((current) => !current)}
          >
            {showAdvanced ? t('collapseAdvanced') : t('advancedSplit')}
            <span className="mt-0.5 block text-sm font-medium text-slate-500">{t('advancedHint')}</span>
          </button>

          {showAdvanced && (
          <>
          <div>
            <span className="text-sm font-medium">{t('splitMethod')}</span>
            <div className="mt-1 grid grid-cols-2 gap-2">
              {MODES.map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className={`min-h-touch rounded-xl px-2 text-base font-bold ${
                    draft.mode === mode ? 'bg-ice-600 text-white' : 'bg-snow-100 text-slate-700'
                  }`}
                  onClick={() => setMode(mode)}
                >
                  {splitModeLabel(t, mode)}
                </button>
              ))}
            </div>
            <p className="mt-1 text-sm text-slate-500">{modeHint}</p>
          </div>

          <div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium">{draft.mode === 'exclude' ? t('excludedPeople') : t('whoShares')}</span>
              <button
                type="button"
                className="min-h-touch px-2 text-sm font-semibold text-ice-700"
                onClick={() =>
                  setDraft((current) => ({
                    ...current,
                    selected: current.selected.length === members.length ? [] : members.map((member) => member.id),
                    values:
                      current.mode === 'ratio'
                        ? Object.fromEntries(members.map((member) => [member.id, current.values[member.id] || '1']))
                        : current.values,
                  }))
                }
              >
                {draft.selected.length === members.length ? t('selectNone') : t('selectAll')}
              </button>
            </div>
            <ul className="mt-1 space-y-2">
              {members.map((member) => {
                const on = draft.selected.includes(member.id);
                return (
                  <li key={member.id} className="rounded-xl border border-slate-200 p-2">
                    <label className="flex min-h-touch items-center gap-3">
                      <input
                        type="checkbox"
                        className="h-5 w-5 shrink-0 accent-ice-600"
                        checked={on}
                        onChange={() => toggleMember(member.id)}
                      />
                      <span className="min-w-0 flex-1 truncate text-base font-semibold">{member.displayName}</span>
                    </label>
                    {on && draft.mode === 'custom' && (
                      <input
                        inputMode="decimal"
                        aria-label={t('amountOf', { name: member.displayName })}
                        className="mt-1 w-full min-h-touch rounded-lg border border-slate-200 px-3 text-base"
                        placeholder={t('amountPlaceholder')}
                        value={draft.values[member.id] ?? ''}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            values: { ...current.values, [member.id]: event.target.value },
                          }))
                        }
                      />
                    )}
                    {on && draft.mode === 'ratio' && (
                      <input
                        inputMode="decimal"
                        aria-label={t('ratioOf', { name: member.displayName })}
                        className="mt-1 w-full min-h-touch rounded-lg border border-slate-200 px-3 text-base"
                        placeholder={t('weightPlaceholder')}
                        value={draft.values[member.id] ?? ''}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            values: { ...current.values, [member.id]: event.target.value },
                          }))
                        }
                      />
                    )}
                  </li>
                );
              })}
            </ul>
          </div>

          <label className="block">
            <span className="text-sm font-medium">{t('dayOptional')}</span>
            <select
              className="mt-1 w-full min-h-touch rounded-xl border border-slate-200 bg-white px-3 text-base"
              value={draft.day}
              onChange={(event) => {
                const day = event.target.value;
                setDraft((current) => {
                  const stop = trip.stops.find((item) => item.id === current.stopId);
                  const stopId = stop && day && String(stop.day) !== day ? '' : current.stopId;
                  return { ...current, day, stopId };
                });
              }}
            >
              <option value="">{t('noDay')}</option>
              {trip.days.map((day) => (
                <option key={day.day} value={day.day}>
                  {day.label} {day.date.slice(5)}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="text-sm font-medium">{t('stopOptional')}</span>
            <select
              className="mt-1 w-full min-h-touch rounded-xl border border-slate-200 bg-white px-3 text-base"
              value={draft.stopId}
              onChange={(event) => {
                const stopId = event.target.value;
                const stop = trip.stops.find((item) => item.id === stopId);
                setDraft((current) => ({
                  ...current,
                  stopId,
                  day: stop ? String(stop.day) : current.day,
                }));
              }}
            >
              <option value="">{t('noStopLink')}</option>
              {stops.map((stop) => (
                <option key={stop.id} value={stop.id}>
                  {trip.days.find((day) => day.day === stop.day)?.label || `D${stop.day}`} · {stop.title}
                </option>
              ))}
            </select>
          </label>
          </>
          )}

          <div
            className={`rounded-xl px-3 py-2 text-sm ${
              preview.ok ? 'bg-snow-100 text-slate-700' : 'bg-red-50 text-red-700'
            }`}
          >
            {preview.ok ? (
              <>
                <p className="font-bold">{t('preview')}</p>
                <ul className="mt-1 space-y-1">
                  {preview.expense.shares.map((share) => (
                    <li key={share.memberId} className="flex justify-between gap-3">
                      <span className="min-w-0 truncate">
                        {members.find((member) => member.id === share.memberId)?.displayName || share.memberId}
                      </span>
                      <span className="shrink-0 font-semibold">
                        {formatMinor(share.amountMinor, preview.expense.currency)}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="mt-1 font-semibold">
                  {t('totalLine', { amount: formatMinor(preview.expense.amountMinor, preview.expense.currency) })}
                </p>
              </>
            ) : (
              <p>{localizeError(preview.error, t)}</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2 pb-1">
            <button
              type="button"
              className="min-h-touch rounded-xl bg-snow-100 text-base font-bold text-slate-700"
              onClick={onClose}
            >
              {t('cancel')}
            </button>
            <button
              type="submit"
              disabled={!preview.ok || pending}
              className="min-h-touch rounded-xl bg-ice-600 text-base font-bold text-white disabled:opacity-50"
            >
              {t('save')}
            </button>
          </div>
          {expense && (
            <button
              type="button"
              className="min-h-touch w-full rounded-xl border border-red-200 text-base font-bold text-red-700"
              onClick={onDelete}
              disabled={pending}
            >
              {t('deleteThis')}
            </button>
          )}
        </form>
        <div className="h-[max(0.75rem,var(--safe-bottom))] shrink-0" />
      </div>
    </div>
  );
}
