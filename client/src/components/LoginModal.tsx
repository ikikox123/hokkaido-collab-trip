import { FormEvent, useState } from 'react';
import { useI18n } from '../i18n/I18nProvider';
import { localizeError } from '../i18n/errors';
import { loginRequest, registerRequest, saveAuth } from '../lib/auth';
import type { User } from '../types/trip';

type Props = {
  open: boolean;
  onClose: () => void;
  onLogin: (user: User, token: string) => void;
  /** Render the form in the page instead of a dialog. */
  embedded?: boolean;
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

export function LoginModal({ open, onClose, onLogin, embedded = false }: Props) {
  const [mode, setMode] = useState<Mode>('login');
  const [username, setUsername] = useState('alice');
  const [password, setPassword] = useState('demo1234');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { t } = useI18n();
  const isRegister = mode === 'register';

  if (!embedded && !open) return null;

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

  const card = (
      <div
        className="max-h-[92dvh] w-full overflow-y-auto rounded-2xl bg-white p-5 shadow-xl"
        role={embedded ? undefined : 'dialog'}
        aria-modal={embedded ? undefined : true}
        aria-labelledby="login-title"
        onClick={embedded ? undefined : (e) => e.stopPropagation()}
      >
        {!embedded && <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-slate-200 sm:hidden" />}
        <h2 id="login-title" className="text-lg font-bold text-ice-700">
          {isRegister ? t('registerTitle') : t('loginTitle')}
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          {isRegister ? (
            t('registerHint')
          ) : (
            <>
              {t('demoAccounts')} <code className="bg-snow-100 px-1 rounded">alice</code> /{' '}
              <code className="bg-snow-100 px-1 rounded">bob</code>
              {t('listSep')}
              {t('demoPasswordLabel')} <code className="bg-snow-100 px-1 rounded">demo1234</code>
            </>
          )}
        </p>
        <form className="mt-4 space-y-3" onSubmit={handleSubmit}>
          <label className="block">
            <span className="text-sm font-medium">{t('username')}</span>
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
            <span className="text-sm font-medium">{t('password')}</span>
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
              {localizeError(error, t)}
            </p>
          )}
          <button
            type="submit"
            disabled={loading}
            className="w-full min-h-touch rounded-xl bg-ice-600 text-white font-semibold active:bg-ice-700 disabled:opacity-60"
          >
            {loading ? (isRegister ? t('registering') : t('loggingIn')) : isRegister ? t('registerAndLogin') : t('login')}
          </button>
          <button
            type="button"
            className="w-full min-h-touch rounded-xl text-ice-700 font-medium"
            onClick={switchMode}
          >
            {isRegister ? t('haveAccount') : t('needAccount')}
          </button>
          {!embedded && (
            <button
              type="button"
              className="w-full min-h-touch rounded-xl text-slate-600"
              onClick={onClose}
            >
              {t('browseAsGuest')}
            </button>
          )}
        </form>
      </div>
  );

  if (embedded) return card;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
      onClick={onClose}
    >
      {card}
    </div>
  );
}
