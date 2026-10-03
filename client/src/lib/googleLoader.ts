import { mapsLanguage } from '../i18n/messages';
import { readLocale } from '../i18n/storage';
import { googleMapsBrowserKey } from './mapProvider';

type LatLng = { lat: number; lng: number };

export type GoogleMapsNS = {
  maps: {
    Map: new (el: HTMLElement, opts?: Record<string, unknown>) => GoogleMap;
    Marker: new (opts?: Record<string, unknown>) => GoogleMarker;
    Polyline: new (opts?: Record<string, unknown>) => { setMap: (map: GoogleMap | null) => void };
    InfoWindow: new (opts?: { content?: Node | string }) => GoogleInfoWindow;
    LatLngBounds: new (sw?: LatLng, ne?: LatLng) => GoogleBounds;
    Size: new (w: number, h: number) => object;
    Point: new (x: number, y: number) => object;
    event: {
      trigger: (instance: object, eventName: string) => void;
      addListenerOnce: (instance: object, eventName: string, handler: () => void) => void;
      clearInstanceListeners: (instance: object) => void;
    };
    places: {
      Autocomplete: new (input: HTMLInputElement, opts?: Record<string, unknown>) => GoogleAutocomplete;
    };
  };
};

export type GoogleMap = {
  setCenter: (c: LatLng) => void;
  setZoom: (z: number) => void;
  getZoom: () => number | undefined;
  fitBounds: (b: GoogleBounds, padding?: number) => void;
  panTo: (c: LatLng) => void;
};

type GoogleMarker = {
  setMap: (map: GoogleMap | null) => void;
  addListener: (eventName: string, handler: () => void) => void;
};

type GoogleInfoWindow = {
  setContent: (node: Node | string) => void;
  open: (opts: { map: GoogleMap; anchor?: GoogleMarker }) => void;
  close: () => void;
};

type GoogleBounds = { extend: (point: LatLng) => void };

export type GoogleAutocomplete = {
  addListener: (eventName: string, handler: () => void) => { remove: () => void };
  getPlace: () => {
    name?: string;
    formatted_address?: string;
    geometry?: { location?: { lat: () => number; lng: () => number } };
  };
  /** MVCObject method. Present on the live widget; used to detach it. */
  unbindAll?: () => void;
};

let loading: Promise<GoogleMapsNS> | null = null;

export function loadGoogleMaps(): Promise<GoogleMapsNS> {
  const key = googleMapsBrowserKey();
  if (!key) return Promise.reject(new Error('缺少瀏覽器地圖金鑰'));
  const existing = (window as unknown as { google?: GoogleMapsNS }).google;
  if (existing?.maps?.places) return Promise.resolve(existing);
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      const params = new URLSearchParams({
        key,
        libraries: 'places',
        v: 'weekly',
        language: mapsLanguage(readLocale()),
        region: 'JP',
      });
      script.src = `https://maps.googleapis.com/maps/api/js?${params.toString()}`;
      script.async = true;
      script.onerror = () => {
        loading = null;
        reject(new Error('Google 地圖無法載入'));
      };
      script.onload = () => {
        const g = (window as unknown as { google?: GoogleMapsNS }).google;
        if (!g?.maps) {
          loading = null;
          reject(new Error('Google 地圖無法載入'));
          return;
        }
        resolve(g);
      };
      document.head.appendChild(script);
    });
  }
  return loading;
}

export function markerIconUrl(color: string, size: number): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2 - 2}" fill="${color}" stroke="#ffffff" stroke-width="3"/></svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}
