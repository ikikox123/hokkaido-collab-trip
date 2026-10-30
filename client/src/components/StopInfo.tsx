import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import {
  cleanStopHours,
  cleanStopNote,
  STOP_HOURS_MAX,
  STOP_NOTE_MAX,
  STOP_NOTE_MAX_LINES,
  stopTextLength,
} from '../../../server/src/stopInfo.js';
import { useI18n } from '../i18n/I18nProvider';
import { localizeError } from '../i18n/errors';
import { displayStopTitle } from '../i18n/stopNames';
import { stopInfoPatch, stopInfoView, type StopInfoPatch } from '../lib/stopInfo';
import type { Stop } from '../types/trip';

type SaveResult = { ok: boolean; error?: string };

export function ClockIcon({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.5 2" />
    </svg>
  );
}

/**
 * Hours (one line) and, under them, the note clamped to two lines (tap to expand).
 * Renders nothing unless the stop has hours: a note on its own stays inline beside the time
 * (see StopInlineNote), so cards without hours keep the height they always had.
 */
export function StopInfoLines({ stop }: { stop: Pick<Stop, 'hours' | 'notes'> }) {
  const { t } = useI18n();
  const { hours, notes } = stopInfoView(stop);
  const [open, setOpen] = useState(false);
  if (!hours) return null;
  return (
    <div className="stop-info mt-1 min-w-0 space-y-0.5" onClick={(e) => e.stopPropagation()}>
      <p className="stop-hours flex min-w-0 items-center gap-1.5 text-sm font-semibold text-slate-700" title={hours}>
        <ClockIcon />
        <span className="sr-only">{t('stopInfoHoursLabel')}：</span>
        <span className="min-w-0 truncate">{hours}</span>
      </p>
      {notes && (
        <button
          type="button"
          className="stop-note block w-full min-w-0 rounded-lg text-left text-sm leading-snug text-slate-600"
          aria-expanded={open}
          title={open ? t('stopNoteCollapse') : t('stopNoteExpand')}
          onClick={() => setOpen((v) => !v)}
        >
          <span className={`block whitespace-pre-line break-words ${open ? '' : 'line-clamp-2'}`}>{notes}</span>
        </button>
      )}
    </div>
  );
}

/**
 * A note without hours sits to the right of the time capsule on one line, as it always did.
 * Tapping it opens the full text on its own row.
 */
export function StopInlineNote({ stop }: { stop: Pick<Stop, 'hours' | 'notes'> }) {
  const { t } = useI18n();
  const { hours, notes } = stopInfoView(stop);
  const [open, setOpen] = useState(false);
  if (hours || !notes) return null;
  return (
    <button
      type="button"
      className={`stop-note min-w-0 text-left ${open ? 'basis-full whitespace-pre-line break-words leading-snug' : 'flex-1 truncate'}`}
      aria-expanded={open}
      title={open ? t('stopNoteCollapse') : t('stopNoteExpand')}
      onClick={() => setOpen((v) => !v)}
    >
      {notes}
    </button>
  );
}

/** Icon-only pill (clock + pencil) beside the time capsule. Only rendered for trip companions. */
export function StopInfoEditButton({
  title,
  onOpen,
  buttonRef,
}: {
  title: string;
  onOpen: () => void;
  buttonRef: React.RefObject<HTMLButtonElement>;
}) {
  const { t, locale } = useI18n();
  const label = t('stopInfoEditAria', { title: displayStopTitle(locale, title) });
  return (
    <button
      ref={buttonRef}
      type="button"
      className="stop-info-edit cute-press inline-flex min-h-touch min-w-touch shrink-0 items-center justify-center gap-0.5 rounded-full border-2 border-ink bg-butter-100 text-ink"
      aria-label={label}
      title={label}
      onClick={(e) => {
        e.stopPropagation();
        onOpen();
      }}
    >
      <ClockIcon size={14} />
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M4 20h4L19 9l-4-4L4 16v4z" />
      </svg>
    </button>
  );
}

/**
 * Small editor for opening hours (one line) and the note (up to three lines).
 * Enter in the hours field saves; in the note Enter adds a line and Ctrl/⌘+Enter saves.
 * Esc cancels; the caller returns focus to the edit button. The server validates again.
 */
export function StopInfoEditor({
  stop,
  onSave,
  onClose,
}: {
  stop: Stop;
  onSave: (patch: StopInfoPatch) => Promise<SaveResult>;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const id = useId();
  const hoursRef = useRef<HTMLInputElement>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const start = stopInfoView(stop);
  const [hours, setHours] = useState(start.hours);
  const [note, setNote] = useState(start.notes);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const hoursClean = cleanStopHours(hours);
  const noteClean = cleanStopNote(note);
  const hoursCount = stopTextLength(hoursClean.ok ? hoursClean.value : hours.trim());
  const noteCount = stopTextLength(noteClean.ok ? noteClean.value : note.trim());
  const hoursOver = hoursCount > STOP_HOURS_MAX;
  const noteOver = noteCount > STOP_NOTE_MAX || note.split(/\r?\n/).filter((l) => l.trim()).length > STOP_NOTE_MAX_LINES;

  useEffect(() => {
    hoursRef.current?.focus();
  }, []);

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    if (busy) return;
    const result = stopInfoPatch(stop, { hours, notes: note });
    if (!result.ok) {
      setError(localizeError(result.error, t));
      (cleanStopHours(hours).ok ? noteRef : hoursRef).current?.focus();
      return;
    }
    if (Object.keys(result.patch).length === 0) {
      onClose();
      return;
    }
    setBusy(true);
    const saved = await onSave(result.patch);
    setBusy(false);
    if (saved.ok) {
      onClose();
      return;
    }
    setError(localizeError(saved.error || t('cannotUpdate'), t));
    hoursRef.current?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLFormElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }
  }

  const fieldClass =
    'mt-0.5 w-full min-w-0 rounded-xl border border-ink bg-white px-3 text-base text-ink';
  return (
    <form
      className="stop-info-editor cute-enter mt-1 flex min-w-0 flex-col gap-1.5"
      aria-label={t('stopInfoEditAria', { title: stop.title })}
      onSubmit={submit}
      onKeyDown={onKeyDown}
      onClick={(e) => e.stopPropagation()}
    >
      <div>
        <label htmlFor={`${id}-hours`} className="flex items-center gap-1 text-xs font-bold text-slate-500">
          <ClockIcon size={12} />
          {t('stopInfoHoursLabel')}
        </label>
        <input
          ref={hoursRef}
          id={`${id}-hours`}
          className={`${fieldClass} min-h-touch`}
          value={hours}
          placeholder={t('stopInfoHoursPlaceholder')}
          autoComplete="off"
          enterKeyHint="done"
          aria-invalid={hoursOver || undefined}
          disabled={busy}
          onChange={(e) => {
            setHours(e.target.value);
            setError(null);
          }}
        />
        <p className={`text-right text-[11px] tabular-nums ${hoursOver ? 'font-bold text-red-600' : 'text-slate-400'}`}>
          {hoursCount}/{STOP_HOURS_MAX}
        </p>
      </div>
      <div>
        <label htmlFor={`${id}-note`} className="text-xs font-bold text-slate-500">
          {t('stopInfoNoteLabel')}
        </label>
        <textarea
          ref={noteRef}
          id={`${id}-note`}
          className={`${fieldClass} min-h-[5rem] resize-y py-2 leading-snug`}
          rows={3}
          value={note}
          placeholder={t('stopInfoNotePlaceholder')}
          aria-invalid={noteOver || undefined}
          aria-describedby={`${id}-hint`}
          disabled={busy}
          onChange={(e) => {
            setNote(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              void submit();
            }
          }}
        />
        <p className={`text-right text-[11px] tabular-nums ${noteOver ? 'font-bold text-red-600' : 'text-slate-400'}`}>
          {noteCount}/{STOP_NOTE_MAX}
        </p>
      </div>
      <p id={`${id}-hint`} className={`text-[11px] leading-snug ${error ? 'font-bold text-red-600' : 'text-slate-500'}`} role={error ? 'alert' : undefined} aria-live="polite">
        {error ||
          `${t('stopInfoHint', { hours: STOP_HOURS_MAX, note: STOP_NOTE_MAX, lines: STOP_NOTE_MAX_LINES })} ${t('stopInfoCtrlEnter')}`}
      </p>
      <div className="flex justify-end gap-2">
        <button
          type="button"
          className="cute-press min-h-touch rounded-full border-2 border-ink bg-white px-4 text-sm font-bold text-ink"
          onClick={onClose}
          disabled={busy}
        >
          {t('cancel')}
        </button>
        <button
          type="submit"
          className="cute-press min-h-touch rounded-full border-2 border-ink bg-lavender-300 px-5 text-sm font-bold text-ink disabled:opacity-50"
          disabled={busy || hoursOver || noteOver}
        >
          {t('save')}
        </button>
      </div>
    </form>
  );
}
