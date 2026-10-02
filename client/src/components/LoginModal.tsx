import { FormEvent, useState } from 'react';
import { loginRequest, saveAuth } from '../lib/auth';
import type { User } from '../types/trip';

type Props = {
  open: boolean;
  onClose: () => void;
  onLogin: (user: User, token: string) => void;
};

export function LoginModal({ open, onClose, onLogin }: Props) {
  const [username, setUsername] = useState('alice');
  const [password, setPassword] = useState('demo1234');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (!open) return null;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const data = await loginRequest(username.trim(), password);
      saveAuth(data.token, data.user);
      onLogin(data.user, data.token);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : '登入失敗');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="login-title"
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl bg-white p-5 pb-[calc(1.25rem+var(--safe-bottom))] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-slate-200 sm:hidden" />
        <h2 id="login-title" className="text-lg font-bold text-ice-700">
          登入協作編輯
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          示範帳號：<code className="bg-snow-100 px-1 rounded">alice</code> /{' '}
          <code className="bg-snow-100 px-1 rounded">bob</code>，密碼{' '}
          <code className="bg-snow-100 px-1 rounded">demo1234</code>
        </p>
        <form className="mt-4 space-y-3" onSubmit={handleSubmit}>
          <label className="block">
            <span className="text-sm font-medium">帳號</span>
            <input
              className="mt-1 w-full min-h-touch rounded-xl border border-slate-200 px-3 text-base outline-none focus:border-ice-500 focus:ring-2 focus:ring-ice-500/30"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium">密碼</span>
            <input
              type="password"
              className="mt-1 w-full min-h-touch rounded-xl border border-slate-200 px-3 text-base outline-none focus:border-ice-500 focus:ring-2 focus:ring-ice-500/30"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full min-h-touch rounded-xl bg-ice-600 text-white font-semibold active:bg-ice-700 disabled:opacity-60"
          >
            {loading ? '登入中…' : '登入'}
          </button>
          <button
            type="button"
            className="w-full min-h-touch rounded-xl text-slate-600"
            onClick={onClose}
          >
            先以訪客瀏覽
          </button>
        </form>
      </div>
    </div>
  );
}
