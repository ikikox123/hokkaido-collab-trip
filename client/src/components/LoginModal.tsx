import { FormEvent, useState } from 'react';
import { loginRequest, registerRequest, saveAuth } from '../lib/auth';
import type { User } from '../types/trip';

type Props = {
  open: boolean;
  onClose: () => void;
  onLogin: (user: User, token: string) => void;
};

type Mode = 'login' | 'register';

function blankCredentialMessage(username: string, password: string): string | null {
  const name = username.trim();
  const passBlank = password.trim() === '';
  if (!name && passBlank) return '請輸入帳號與密碼';
  if (!name) return '請輸入帳號';
  if (passBlank) return '請輸入密碼';
  return null;
}

export function LoginModal({ open, onClose, onLogin }: Props) {
  const [mode, setMode] = useState<Mode>('login');
  const [username, setUsername] = useState('alice');
  const [password, setPassword] = useState('demo1234');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const isRegister = mode === 'register';

  if (!open) return null;

  function switchMode() {
    setError(null);
    if (isRegister) {
      setMode('login');
      setUsername('alice');
      setPassword('demo1234');
      return;
    }
    setMode('register');
    setUsername('');
    setPassword('');
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const blank = blankCredentialMessage(username, password);
    if (blank) {
      setError(blank);
      return;
    }
    setLoading(true);
    setError(null);
    const fallback = isRegister ? '註冊失敗，請稍後再試' : '登入失敗，請稍後再試';
    try {
      const submit = isRegister ? registerRequest : loginRequest;
      const data = await submit(username.trim(), password);
      saveAuth(data.token, data.user);
      onLogin(data.user, data.token);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : fallback);
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
        className="max-h-[92dvh] w-full overflow-y-auto sm:max-w-md rounded-t-2xl sm:rounded-2xl bg-white p-5 pb-[calc(1.25rem+var(--safe-bottom))] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-slate-200 sm:hidden" />
        <h2 id="login-title" className="text-lg font-bold text-ice-700">
          {isRegister ? '註冊帳號' : '登入協作編輯'}
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          {isRegister ? (
            '註冊後會直接登入。用現在的帳號與密碼，就能加入房間一起編輯。'
          ) : (
            <>
              示範帳號：<code className="bg-snow-100 px-1 rounded">alice</code> /{' '}
              <code className="bg-snow-100 px-1 rounded">bob</code>，密碼{' '}
              <code className="bg-snow-100 px-1 rounded">demo1234</code>
            </>
          )}
        </p>
        <form className="mt-4 space-y-3" onSubmit={handleSubmit}>
          <label className="block">
            <span className="text-sm font-medium">帳號</span>
            <input
              className="mt-1 w-full min-h-touch rounded-xl border border-slate-200 px-3 text-base outline-none focus:border-ice-500 focus:ring-2 focus:ring-ice-500/30"
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium">密碼</span>
            <input
              type="password"
              className="mt-1 w-full min-h-touch rounded-xl border border-slate-200 px-3 text-base outline-none focus:border-ice-500 focus:ring-2 focus:ring-ice-500/30"
              autoComplete={isRegister ? 'new-password' : 'current-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {error && (
            <p className="text-sm text-red-600" role="alert">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={loading}
            className="w-full min-h-touch rounded-xl bg-ice-600 text-white font-semibold active:bg-ice-700 disabled:opacity-60"
          >
            {loading ? (isRegister ? '註冊中…' : '登入中…') : isRegister ? '註冊並登入' : '登入'}
          </button>
          <button
            type="button"
            className="w-full min-h-touch rounded-xl text-ice-700 font-medium"
            onClick={switchMode}
          >
            {isRegister ? '已有帳號？登入' : '還沒有帳號？註冊'}
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
