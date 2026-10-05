import { useI18n } from '../i18n/I18nProvider';
import { shareExportControlState } from '../lib/shareExport';

export function ShareExportBar({
  canExport,
  busy,
  placement,
  className = '',
  onCopy,
  onImage,
  onPdf,
}: {
  canExport: boolean;
  busy: boolean;
  placement: 'top' | 'bottom';
  className?: string;
  onCopy: () => void;
  onImage: () => void;
  onPdf: () => void;
}) {
  const { t } = useI18n();
  const controls = shareExportControlState(canExport, busy);
  const item =
    placement === 'bottom'
      ? 'min-h-touch min-w-0 flex-1 rounded-xl px-2 py-1 text-center text-sm font-bold leading-tight'
      : 'min-h-touch shrink-0 rounded-xl px-3 text-sm font-bold';
  const face = 'bg-white text-ice-700 ring-1 ring-slate-200 active:bg-snow-100 disabled:opacity-40';

  return (
    <div
      role="toolbar"
      aria-label={t('shareActions')}
      aria-busy={busy || undefined}
      className={`${placement === 'bottom' ? 'mx-auto flex max-w-2xl gap-2' : 'flex flex-wrap gap-2'} ${className}`}
    >
      <button type="button" className={`${item} ${face}`} onClick={onCopy}>
        {t('copyLink')}
      </button>
      <button type="button" className={`${item} ${face}`} disabled={controls.imageDisabled} onClick={onImage}>
        {t('shareExportImage')}
      </button>
      <button type="button" className={`${item} ${face}`} disabled={controls.pdfDisabled} onClick={onPdf}>
        {t('shareExportPdf')}
      </button>
    </div>
  );
}
