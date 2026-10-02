import type { TravelMode } from '../types/trip';

export const TRAVEL_MODES: TravelMode[] = ['walk', 'subway', 'jr', 'bus', 'taxi', 'car', 'charter'];

export const MODE_LABELS: Record<TravelMode, string> = {
  walk: '步行',
  subway: '地鐵',
  jr: 'JR',
  bus: '巴士',
  taxi: '計程車',
  car: '自駕',
  charter: '包車',
};

export const MODE_COLORS: Record<TravelMode, string> = {
  walk: '#16a34a',
  subway: '#2563eb',
  jr: '#dc2626',
  bus: '#d97706',
  taxi: '#ca8a04',
  car: '#7c3aed',
  charter: '#0f766e',
};

export function isTravelMode(value: string): value is TravelMode {
  return (TRAVEL_MODES as string[]).includes(value);
}
