import { useCallback, useEffect, useRef, useState } from 'react';

export function useTimedNotice() {
  const [notice, setNotice] = useState<string | null>(null);
  const timer = useRef<number | null>(null);

  const flash = useCallback((message: string) => {
    setNotice(message);
    if (timer.current != null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setNotice(null), 2500);
  }, []);

  useEffect(
    () => () => {
      if (timer.current != null) window.clearTimeout(timer.current);
    },
    [],
  );

  return { notice, flash };
}

export function ShareNotice({ message, lift = false }: { message: string | null; lift?: boolean }) {
  if (!message) return null;
  const bottom = lift
    ? 'bottom-[calc(5.5rem+var(--safe-bottom))]'
    : 'bottom-[calc(1rem+var(--safe-bottom))]';
  return (
    <div
      role="status"
      data-share-export-ignore="true"
      className={`share-export-ignore print:hidden fixed left-1/2 z-[60] max-w-[90vw] -translate-x-1/2 rounded-full bg-slate-900/90 px-4 py-2.5 text-sm text-white shadow-lg ${bottom}`}
    >
      {message}
    </div>
  );
}
