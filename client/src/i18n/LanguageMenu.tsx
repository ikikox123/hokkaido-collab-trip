import type { Locale } from './messages.ts';
import { useI18n } from './I18nProvider.tsx';

const OPTIONS: { value: Locale; label: string }[] = [
  { value: 'zh-Hant', label: '繁中' },
  { value: 'ja', label: '日本語' },
  { value: 'en', label: 'English' },
];

export function LanguageMenu({
  tone = 'onDark',
  onPick,
}: {
  tone?: 'onDark' | 'light';
  /** When set, the choice stays on this page and is not written to `hokkaido.locale`. */
  onPick?: (locale: Locale) => void;
}) {
  const { locale, setLocale, t } = useI18n();
  const face =
    tone === 'light'
      ? 'border border-slate-200 bg-white text-ice-700'
      : 'border border-white/30 bg-white text-ice-700';
  return (
    <label className="shrink-0">
      <span className="sr-only">{t('language')}</span>
      <select
        className={`min-h-touch max-w-[9rem] rounded-lg px-2 text-sm font-bold ${face}`}
        value={locale}
        aria-label={t('language')}
        onChange={(event) => {
          const next = event.target.value;
          if (next !== 'zh-Hant' && next !== 'ja' && next !== 'en') return;
          if (onPick) onPick(next);
          else setLocale(next);
        }}
      >
        {OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
