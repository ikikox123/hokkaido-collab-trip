/** WMO weather interpretation codes → emoji + label. Defaults stay Traditional Chinese. */
export type WeatherLabels = {
  unknown: string;
  clear: string;
  cloudy: string;
  fog: string;
  drizzle: string;
  rain: string;
  snow: string;
  showers: string;
  snowShowers: string;
  thunder: string;
};

const TRADITIONAL_CHINESE: WeatherLabels = {
  unknown: '—',
  clear: '晴',
  cloudy: '多雲',
  fog: '霧',
  drizzle: '毛毛雨',
  rain: '雨',
  snow: '雪',
  showers: '陣雨',
  snowShowers: '陣雪',
  thunder: '雷雨',
};

export function weatherLabel(
  code: number | null | undefined,
  labels: WeatherLabels = TRADITIONAL_CHINESE,
): { emoji: string; label: string } {
  if (code == null) return { emoji: '❓', label: labels.unknown };
  if (code === 0) return { emoji: '☀️', label: labels.clear };
  if (code <= 3) return { emoji: '⛅', label: labels.cloudy };
  if (code <= 48) return { emoji: '🌫️', label: labels.fog };
  if (code <= 57) return { emoji: '🌦️', label: labels.drizzle };
  if (code <= 67) return { emoji: '🌧️', label: labels.rain };
  if (code <= 77) return { emoji: '🌨️', label: labels.snow };
  if (code <= 82) return { emoji: '🌧️', label: labels.showers };
  if (code <= 86) return { emoji: '❄️', label: labels.snowShowers };
  return { emoji: '⛈️', label: labels.thunder };
}
