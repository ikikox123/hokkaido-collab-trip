/** WMO weather interpretation codes → emoji + label */
export function weatherLabel(code: number | null | undefined): { emoji: string; label: string } {
  if (code == null) return { emoji: '❓', label: '—' };
  if (code === 0) return { emoji: '☀️', label: '晴' };
  if (code <= 3) return { emoji: '⛅', label: '多雲' };
  if (code <= 48) return { emoji: '🌫️', label: '霧' };
  if (code <= 57) return { emoji: '🌦️', label: '毛毛雨' };
  if (code <= 67) return { emoji: '🌧️', label: '雨' };
  if (code <= 77) return { emoji: '🌨️', label: '雪' };
  if (code <= 82) return { emoji: '🌧️', label: '陣雨' };
  if (code <= 86) return { emoji: '❄️', label: '陣雪' };
  return { emoji: '⛈️', label: '雷雨' };
}
