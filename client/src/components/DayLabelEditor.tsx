import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { cleanDayLabel, DAY_LABEL_MAX, dayLabelLength, defaultDayLabel } from '../../../server/src/dayLabel.js';
import { useI18n } from '../i18n/I18nProvider';
import { localizeError } from '../i18n/errors';

type SaveResult = { ok: boolean; error?: string };

/** Pencil button that opens an inline field for renaming one day. Only rendered for trip companions. */
export function DayLabelEditButton({
  label,
  shownLabel,
  onOpen,
  buttonRef,
}: {
  label: string;
  shownLabel: string;
  onOpen: () => void;
  buttonRef: React.RefObject<HTMLButtonElement>;
}) {
  const { t } = useI18n();
  return (
    <button
      ref={buttonRef}
      type="button"
      className="day-label-edit cute-press inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-[1.5px] border-ink bg-white text-ink"
      aria-label={t('dayLabelEdit', { day: shownLabel || label })}
      title={t('dayLabelEdit', { day: shownLabel || label })}
      onClick={onOpen}
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M4 20h4L19 9l-4-4L4 16v4z" />
        <path d="M13.5 6.5l4 4" />
      </svg>
    </button>
  );
}

/**
 * Inline day-name form. Enter saves, Esc cancels; focus starts in the field and the caller
 * moves it back to the pencil button on close. The server cleans and validates again.
 */
export function DayLabelEditor({
  label,
  position,
  onSave,
  onClose,
}: {
  label: string;
  /** 1-based position of the day, used for the D{n} reset hint. */
  position: number;
  onSave: (label: string) => Promise<SaveResult>;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(label);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const cleaned = cleanDayLabel(value);
  const count = cleaned.ok ? dayLabelLength(cleaned.label) : dayLabelLength(value.trim());
  const over = count > DAY_LABEL_MAX;
  const fallback = defaultDayLabel(position);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const result = cleanDayLabel(value);
    if (!result.ok) {
      setError(localizeError(result.error, t));
      inputRef.current?.focus();
      return;
    }
    setBusy(true);
    const saved = await onSave(result.label);
    setBusy(false);
    if (saved.ok) {
      onClose();
      return;
    }
    setError(localizeError(saved.error || t('cannotUpdate'), t));
    inputRef.current?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLFormElement>) {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    onClose();
  }

  return (
    <form className="day-label-editor cute-enter flex min-w-0 flex-col gap-1" onSubmit={submit} onKeyDown={onKeyDown}>
      <label htmlFor={`${id}-input`} className="text-xs font-bold text-slate-500">
        {t('dayLabelInput')}
      </label>
      <div className="flex min-w-0 items-center gap-1.5">
        <input
          ref={inputRef}
          id={`${id}-input`}
          className="min-h-touch min-w-0 flex-1 rounded-xl border border-ink bg-white px-3 text-base font-bold text-ink"
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            setError(null);
          }}
          placeholder={fallback}
          autoComplete="off"
          enterKeyHint="done"
          aria-invalid={over || Boolean(error)}
          aria-describedby={`${id}-hint`}
          disabled={busy}
        />
        <button
          type="submit"
          className="cute-press flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-2 border-ink bg-lavender-300 text-ink disabled:opacity-50"
          aria-label={t('save')}
          disabled={busy || over}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M5 12.5l4.5 4.5L19 7.5" />
          </svg>
        </button>
        <button
          type="button"
          className="cute-press flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-2 border-ink bg-white text-ink"
          aria-label={t('cancel')}
          onClick={onClose}
          disabled={busy}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden>
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
      <p id={`${id}-hint`} className="flex items-baseline gap-2 text-[11px] leading-snug" aria-live="polite">
        <span className={`min-w-0 flex-1 ${error || over ? 'font-bold text-red-600' : 'text-slate-500'}`}>
          {error || (over ? t('dayLabelTooLong') : t('dayLabelHint', { max: DAY_LABEL_MAX, fallback }))}
        </span>
        <span className={`shrink-0 tabular-nums ${over ? 'font-bold text-red-600' : 'text-slate-400'}`}>
          {count}/{DAY_LABEL_MAX}
        </span>
      </p>
    </form>
  );
}
