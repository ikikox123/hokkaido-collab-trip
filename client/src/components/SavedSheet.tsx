import { useEffect, useId, useRef, type ReactNode } from 'react';

/** Small bottom sheet (centered on wide screens) used by the saved-places forms. */
export function SavedSheet({
  title,
  onClose,
  children,
  closeLabel,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  closeLabel: string;
}) {
  const titleId = useId();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('input, textarea, select, button')?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      onClose();
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      previous?.focus?.({ preventScroll: true });
    };
  }, [onClose]);

  return (
    <div
      className="saved-sheet-layer fixed inset-0 z-[2100] flex items-end justify-center sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      data-share-export-ignore="true"
    >
      <div className="menu-backdrop absolute inset-0" onClick={onClose} aria-hidden />
      <div
        ref={ref}
        className="saved-sheet th-glass relative max-h-[90dvh] w-full max-w-md overflow-y-auto overscroll-contain rounded-t-3xl border-2 border-b-0 border-ink bg-snow-50 p-4 pb-[max(1rem,var(--safe-bottom))] text-ink shadow-sticker sm:rounded-3xl sm:border-b-2"
      >
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 id={titleId} className="text-base font-bold">
            {title}
          </h2>
          <button
            type="button"
            className="btn btn-icon cute-press shrink-0"
            aria-label={closeLabel}
            onClick={onClose}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
