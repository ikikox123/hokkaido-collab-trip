export type StopMarkerKind = 'selected' | 'next' | 'normal';

/** Same highlight colors the map dots already use. */
export const STOP_MARKER_COLORS: Record<StopMarkerKind, string> = {
  selected: '#2563a8',
  next: '#ec4899',
  normal: '#64748b',
};

export function stopMarkerKind(
  stopId: string,
  selectedId: string | null,
  nextId: string | null,
): StopMarkerKind {
  if (stopId === selectedId) return 'selected';
  if (stopId === nextId) return 'next';
  return 'normal';
}

export type StopMarkerMetrics = {
  label: string;
  color: string;
  size: number;
  fontSize: number;
  border: number;
};

/**
 * Dot size and numeral size. Highlighted stops stay larger than the others.
 * Single digits use a larger type size so the number stays readable on a phone.
 */
export function stopMarkerMetrics(kind: StopMarkerKind, number: number): StopMarkerMetrics {
  const label = String(number);
  const highlighted = kind !== 'normal';
  const digits = label.length;
  const size = highlighted ? (digits >= 2 ? 40 : 34) : digits >= 2 ? 34 : 28;
  const fontSize = digits >= 3 ? 12 : digits === 2 ? (highlighted ? 15 : 13) : highlighted ? 16 : 14;
  return {
    label,
    color: STOP_MARKER_COLORS[kind],
    size,
    fontSize,
    border: highlighted ? 3 : 2,
  };
}

/** Tooltip text: the day number, then the name already translated for the locale. */
export function stopMarkerTitle(number: number, label: string): string {
  return `${number}. ${label}`;
}

/** Leaflet marker HTML. The numeral sits inside the dot. */
export function stopMarkerHtml(kind: StopMarkerKind, number: number): { html: string; size: number } {
  const marker = stopMarkerMetrics(kind, number);
  const shadow = kind === 'normal' ? '0 1px 4px rgba(0,0,0,.3)' : '0 2px 8px rgba(0,0,0,.35)';
  const tracking = marker.label.length > 1 ? '-0.04em' : '0';
  const html = `<div style="box-sizing:border-box;width:${marker.size}px;height:${marker.size}px;border-radius:50%;background:${marker.color};border:${marker.border}px solid #ffffff;box-shadow:${shadow};display:flex;align-items:center;justify-content:center;color:#ffffff;font-family:system-ui,sans-serif;font-weight:700;font-size:${marker.fontSize}px;line-height:1;letter-spacing:${tracking};font-variant-numeric:tabular-nums;text-shadow:0 0 2px rgba(15,23,42,.95),0 1px 1px rgba(15,23,42,.8);user-select:none;-webkit-user-select:none;">${marker.label}</div>`;
  return { html, size: marker.size };
}

/**
 * Google Maps marker icon. The numeral is painted into the SVG so it stays
 * on the dot (Maps draws the icon as an image). A dark stroke keeps white
 * digits readable on the pink, blue, and gray fills.
 */
export function stopMarkerIconUrl(kind: StopMarkerKind, number: number): { url: string; size: number } {
  const marker = stopMarkerMetrics(kind, number);
  const cx = marker.size / 2;
  const radius = marker.size / 2 - 2;
  const halo = Math.max(2, Math.round(marker.fontSize / 8));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${marker.size}" height="${marker.size}" viewBox="0 0 ${marker.size} ${marker.size}"><circle cx="${cx}" cy="${cx}" r="${radius}" fill="${marker.color}" stroke="#ffffff" stroke-width="${marker.border}"/><text x="${cx}" y="${cx}" text-anchor="middle" dominant-baseline="central" fill="#ffffff" stroke="#0f172a" stroke-width="${halo}" paint-order="stroke fill" stroke-linejoin="round" font-family="sans-serif" font-size="${marker.fontSize}" font-weight="700">${marker.label}</text></svg>`;
  return {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    size: marker.size,
  };
}
