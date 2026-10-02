import { FormEvent, useRef, useState } from 'react';

const STOP_TITLE_MAX = 80;

type Props = {
  title: string;
  canEdit: boolean;
  onRename: (title: string) => void;
};

export function StopName({ title, canEdit, onRename }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const [error, setError] = useState<string | null>(null);
  const skipCommit = useRef(false);

  function begin() {
    skipCommit.current = false;
    setDraft(title);
    setError(null);
    setEditing(true);
  }

  function cancel() {
    skipCommit.current = true;
    setError(null);
    setEditing(false);
  }

  function commit(raw: string) {
    if (skipCommit.current) {
      skipCommit.current = false;
      return;
    }
    const next = raw.trim();
    if (!next) {
      skipCommit.current = true;
      setDraft(title);
      setError('名稱不可空白');
      setEditing(false);
      return;
    }
    if (next.length > STOP_TITLE_MAX) {
      setError('地點名稱過長');
      return;
    }
    skipCommit.current = true;
    setError(null);
    setEditing(false);
    if (next !== title) onRename(next);
  }

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const input = e.currentTarget.elements.namedItem('stop-title');
    const raw = input instanceof HTMLInputElement ? input.value : draft;
    commit(raw);
  }

  if (!canEdit) {
    return <span className="font-semibold text-[15px] leading-snug">{title}</span>;
  }

  if (editing) {
    return (
      <form className="min-w-0 flex-1" onSubmit={handleSubmit} onClick={(e) => e.stopPropagation()}>
        <input
          autoFocus
          name="stop-title"
          aria-label="地點名稱"
          aria-invalid={error ? true : undefined}
          enterKeyHint="done"
          autoComplete="off"
          maxLength={STOP_TITLE_MAX}
          className="w-full min-h-touch rounded-lg border border-ice-500 px-2 text-base font-semibold text-slate-900 outline-none focus:ring-2 focus:ring-ice-500/30"
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            if (error) setError(null);
          }}
          onFocus={(e) => e.target.select()}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              cancel();
            }
          }}
        />
        {error && (
          <p className="mt-0.5 text-sm text-red-600" role="alert">
            {error}
          </p>
        )}
      </form>
    );
  }

  return (
    <div className="min-w-0 flex-1">
      <button
        type="button"
        className="flex min-h-touch w-full items-center gap-2 rounded-lg px-0.5 text-left active:bg-snow-100"
        aria-label={`編輯地點名稱：${title}`}
        onClick={(e) => {
          e.stopPropagation();
          begin();
        }}
      >
        <span className="min-w-0 flex-1 font-semibold text-[15px] leading-snug">{title}</span>
        <span className="shrink-0 rounded-md bg-ice-600/10 px-2 py-1 text-sm font-semibold text-ice-700">
          改名
        </span>
      </button>
      {error && (
        <p className="mt-0.5 text-sm text-red-600" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
