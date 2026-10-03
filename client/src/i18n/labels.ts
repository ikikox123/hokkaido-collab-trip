import type { SplitMode } from '../../../server/src/split.js';
import type { TravelMode } from '../types/trip';
import type { MessageKey } from './messages.ts';
import type { WeatherLabels } from '../lib/weather.ts';

type PickText = (key: MessageKey) => string;

const TRAVEL: Record<TravelMode, MessageKey> = {
  walk: 'modeWalk',
  subway: 'modeSubway',
  jr: 'modeJr',
  bus: 'modeBus',
  taxi: 'modeTaxi',
  car: 'modeCar',
  charter: 'modeCharter',
};

const SPLIT: Record<SplitMode, MessageKey> = {
  equal: 'modeEqual',
  custom: 'modeCustom',
  ratio: 'modeRatio',
  exclude: 'modeExclude',
};

export function travelLabel(pick: PickText, mode: TravelMode) {
  return pick(TRAVEL[mode]);
}

export function splitModeLabel(pick: PickText, mode: SplitMode) {
  return pick(SPLIT[mode]);
}

export function weatherNames(pick: PickText): WeatherLabels {
  return {
    unknown: '—',
    clear: pick('weatherClear'),
    cloudy: pick('weatherCloudy'),
    fog: pick('weatherFog'),
    drizzle: pick('weatherDrizzle'),
    rain: pick('weatherRain'),
    snow: pick('weatherSnow'),
    showers: pick('weatherShowers'),
    snowShowers: pick('weatherSnowShowers'),
    thunder: pick('weatherThunder'),
  };
}
