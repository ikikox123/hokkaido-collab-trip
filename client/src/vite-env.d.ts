/// <reference types="vite/client" />

declare module 'leaflet/dist/leaflet.css';

interface ImportMetaEnv {
  readonly VITE_TILE_URL?: string;
  readonly VITE_TILE_ATTRIBUTION?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
