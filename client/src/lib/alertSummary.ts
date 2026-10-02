/** Compact copy for the collapsed weather / warning / JR card. */

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
export function activeWarningSummary(areas: SummaryWarningArea[]): { count: number; label: string } {
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
  const label = rest > 0 ? `${shown.join('、')}等 ${rest} 項` : shown.join('、');
  return { count, label };
}

export function jrOneLiner(areas: SummaryJrArea[], ok: boolean | undefined): string {
  if (ok === false) return 'JR 暫時無法更新';
  if (!areas.length) return 'JR 運行資訊載入中';
  const disrupted = areas.filter((area) => area.status === 1);
  if (disrupted.length > 0) {
    return `JR 有影響：${disrupted.map((area) => area.name).join('、')}`;
  }
  const labels = [...new Set(areas.map((area) => area.label).filter(Boolean))];
  if (labels.length === 1) return `JR ${labels[0]}`;
  return areas.map((area) => `${area.name} ${area.label || '狀態不明'}`).join(' · ');
}
