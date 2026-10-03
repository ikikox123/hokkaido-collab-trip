/** Compact copy for the collapsed weather / warning / JR card. */

export type AlertPhrases = {
  listSep: string;
  more: (shown: string, rest: number) => string;
  jrUnavailable: string;
  jrLoading: string;
  jrImpact: (names: string) => string;
  jrUnknown: string;
};

const TRADITIONAL_CHINESE: AlertPhrases = {
  listSep: '、',
  more: (shown, rest) => `${shown}等 ${rest} 項`,
  jrUnavailable: 'JR 暫時無法更新',
  jrLoading: 'JR 運行資訊載入中',
  jrImpact: (names) => `JR 有影響：${names}`,
  jrUnknown: '狀態不明',
};

export type SummaryCity = {
  name: string;
  temperature: number | null;
};

export type SummaryWarningArea = {
  name: string;
  active: { name: string }[];
};

export type SummaryJrArea = {
  name: string;
  status: number | null;
  label: string;
};

export function weatherTempLine(cities: SummaryCity[]): string {
  return cities
    .map((city) => {
      const temp = city.temperature != null ? `${Math.round(city.temperature)}°` : '—';
      return `${city.name} ${temp}`;
    })
    .join(' · ');
}

/** Area + official warning name, capped so the collapsed row stays one or two lines. */
export function activeWarningSummary(
  areas: SummaryWarningArea[],
  phrases: AlertPhrases = TRADITIONAL_CHINESE,
): { count: number; label: string } {
  const names: string[] = [];
  let count = 0;
  for (const area of areas) {
    for (const kind of area.active) {
      count += 1;
      const piece = `${area.name}${kind.name}`;
      if (piece && !names.includes(piece)) names.push(piece);
    }
  }
  const shown = names.slice(0, 3);
  const rest = names.length - shown.length;
  const joined = shown.join(phrases.listSep);
  const label = rest > 0 ? phrases.more(joined, rest) : joined;
  return { count, label };
}

export function jrOneLiner(
  areas: SummaryJrArea[],
  ok: boolean | undefined,
  phrases: AlertPhrases = TRADITIONAL_CHINESE,
): string {
  if (ok === false) return phrases.jrUnavailable;
  if (!areas.length) return phrases.jrLoading;
  const disrupted = areas.filter((area) => area.status === 1);
  if (disrupted.length > 0) {
    return phrases.jrImpact(disrupted.map((area) => area.name).join(phrases.listSep));
  }
  const labels = [...new Set(areas.map((area) => area.label).filter(Boolean))];
  if (labels.length === 1) return `JR ${labels[0]}`;
  return areas.map((area) => `${area.name} ${area.label || phrases.jrUnknown}`).join(' · ');
}
