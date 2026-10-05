import type { Stop } from '../types/trip';

/**
 * Fallback map center used only when the trip has no lodging coordinates.
 * Values stay at Minn 札幌大通 西14（南1条西14） and are not a live lodging rewrite.
 */
export const SAPPORO_BASE = { lat: 43.057291, lng: 141.336603 };

export type LodgingPoint = { lat: number; lng: number };

/** Padding fraction passed to LatLngBounds.pad before fitBounds. */
export const DAY_FIT_PADDING = 0.2;

export type DayCamera =
  | { kind: 'point'; center: [number, number]; zoom: number }
  | { kind: 'bounds'; positions: [number, number][]; padding: number; maxZoom: number };

/**
 * Camera for one day.
 * 0 stops → lodging zoom 13. If lodging is missing, SAPPORO_BASE is the fallback.
 * 1 stop → that point zoom 15 (fitBounds on one point zooms out too far).
 * 2+ stops → fit all of them.
 */
export function dayCamera(stops: Stop[], lodging?: LodgingPoint | null): DayCamera {
  const baseLat = Number.isFinite(lodging?.lat) ? lodging!.lat : SAPPORO_BASE.lat;
  const baseLng = Number.isFinite(lodging?.lng) ? lodging!.lng : SAPPORO_BASE.lng;
  if (stops.length === 0) {
    return { kind: 'point', center: [baseLat, baseLng], zoom: 13 };
  }
  if (stops.length === 1) {
    return { kind: 'point', center: [stops[0].lat, stops[0].lng], zoom: 15 };
  }
  return {
    kind: 'bounds',
    positions: stops.map((s) => [s.lat, s.lng] as [number, number]),
    padding: DAY_FIT_PADDING,
    maxZoom: 16,
  };
}

export function fitKeyFor(stops: Stop[]): string {
  return stops.map((s) => `${s.id}:${s.lat}:${s.lng}`).join('|');
}
