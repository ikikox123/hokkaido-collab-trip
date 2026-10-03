import { text, type Locale } from './messages.ts';

/**
 * Top-left heading. Comes from the language pack, never from trip.tripName.
 */
export function pageHeading(locale: Locale): string {
  return text(locale, 'pageTitle');
}

/** Browser tab title. Same locale strings as the page heading. */
export function documentTitleFor(locale: Locale): string {
  return pageHeading(locale);
}

export function applyDocumentTitle(locale: Locale, target: { title: string }) {
  target.title = documentTitleFor(locale);
}

/**
 * Day-button text. Only a leading D1 / D2 prefix changes with the locale.
 * The suffix stays as stored, and the label argument is not rewritten.
 */
export function displayDayLabel(locale: Locale, label: string): string {
  if (locale === 'zh-Hant') return label;
  const match = /^D(\d+)/.exec(label);
  if (!match) return label;
  const prefix = locale === 'ja' ? `${match[1]}日目` : `Day ${match[1]}`;
  return prefix + label.slice(match[0].length);
}
