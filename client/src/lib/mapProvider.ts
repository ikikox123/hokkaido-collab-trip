/** google only when the operator asked for it and a browser key is inlined at build time. */
export function usesGoogleMaps(): boolean {
  const provider = String(import.meta.env.VITE_MAP_PROVIDER || '').trim().toLowerCase();
  return provider === 'google' && Boolean(googleMapsBrowserKey());
}

export function googleMapsBrowserKey(): string {
  return String(import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '').trim();
}
