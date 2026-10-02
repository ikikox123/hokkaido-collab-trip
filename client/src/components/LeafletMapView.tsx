import { useRef, useState, useEffect, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { Leg, Stop, TravelMode } from '../types/trip';
import { dayCamera, fitKeyFor, SAPPORO_BASE, type LodgingPoint } from '../lib/dayView';
import { MODE_COLORS, MODE_LABELS } from '../lib/travel';
import { StopName } from './StopName';

L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

const nextIcon = new L.DivIcon({
  className: '',
  html: `<div style="width:28px;height:28px;border-radius:50%;background:#ec4899;border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.35)"></div>`,
  iconSize: [28, 28],
  iconAnchor: [14, 14],
});

const selectedIcon = new L.DivIcon({
  className: '',
  html: `<div style="width:28px;height:28px;border-radius:50%;background:#2563a8;border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.35)"></div>`,
  iconSize: [28, 28],
  iconAnchor: [14, 14],
});

const normalIcon = new L.DivIcon({
  className: '',
  html: `<div style="width:20px;height:20px;border-radius:50%;background:#64748b;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.3)"></div>`,
  iconSize: [20, 20],
  iconAnchor: [10, 10],
});

function mapHasSize(map: L.Map) {
  const size = map.getSize();
  return Boolean(size && size.x >= 40 && size.y >= 40);
}

function applyDayView(map: L.Map, stops: Stop[], lodging?: LodgingPoint | null) {
  if (!mapHasSize(map)) return false;
  const camera = dayCamera(stops, lodging);
  if (camera.kind === 'point') {
    map.setView(camera.center, camera.zoom, { animate: false });
    return true;
  }
  const bounds = L.latLngBounds(camera.positions);
  map.fitBounds(bounds.pad(camera.padding), { animate: false, maxZoom: camera.maxZoom });
  return true;
}

type FitArgs = {
  active: boolean;
  stops: Stop[];
  lodging?: LodgingPoint | null;
  fitKey: string;
};

/**
 * On mount, resize, and when the map tab is visible: invalidateSize after rAF
 * and a short timeout. Fitting is separate and only runs once the pane has a real size
 * (a 0×0 fitBounds jumps out to a world view).
 */
function InvalidateSize({ active, onSized }: { active: boolean; onSized: () => void }) {
  const map = useMap();
  const onSizedRef = useRef(onSized);
  onSizedRef.current = onSized;

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const run = () => {
      if (cancelled) return;
      map.invalidateSize({ animate: false });
      if (mapHasSize(map)) onSizedRef.current();
    };
    const raf = requestAnimationFrame(run);
    const timers = [40, 160, 360].map((ms) => window.setTimeout(run, ms));
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      timers.forEach((id) => window.clearTimeout(id));
    };
  }, [map, active]);

  useEffect(() => {
    let lastW = 0;
    let lastH = 0;
    const run = () => {
      const prevW = lastW;
      const prevH = lastH;
      map.invalidateSize({ animate: false });
      const size = map.getSize();
      lastW = size?.x || 0;
      lastH = size?.y || 0;
      const gainedSize = (prevW < 40 || prevH < 40) && lastW >= 40 && lastH >= 40;
      if (gainedSize) onSizedRef.current();
    };
    const onOrient = () => {
      window.setTimeout(() => {
        map.invalidateSize({ animate: false });
        onSizedRef.current();
      }, 80);
    };
    window.addEventListener('resize', run);
    window.addEventListener('orientationchange', onOrient);
    const ro = new ResizeObserver(() => run());
    ro.observe(map.getContainer());
    const parent = map.getContainer().parentElement;
    if (parent) ro.observe(parent);
    return () => {
      window.removeEventListener('resize', run);
      window.removeEventListener('orientationchange', onOrient);
      ro.disconnect();
    };
  }, [map]);

  return null;
}

function FitDayBounds({ active, stops, lodging, fitKey }: FitArgs) {
  const map = useMap();
  const stopsRef = useRef(stops);
  const lodgingRef = useRef(lodging);
  stopsRef.current = stops;
  lodgingRef.current = lodging;

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const fit = () => {
      if (cancelled) return;
      map.invalidateSize({ animate: false });
      applyDayView(map, stopsRef.current, lodgingRef.current);
    };
    const raf = requestAnimationFrame(fit);
    const timers = [50, 180, 420].map((ms) => window.setTimeout(fit, ms));
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      timers.forEach((id) => window.clearTimeout(id));
    };
  }, [map, active, fitKey]);

  return (
    <InvalidateSize
      active={active}
      onSized={() => {
        if (!active) return;
        applyDayView(map, stopsRef.current, lodgingRef.current);
      }}
    />
  );
}

function lineFor(leg: Leg, stops: Stop[]): { positions: [number, number][]; estimated: boolean } | null {
  if (leg.geometry && leg.geometry.length >= 2) {
    return {
    positions: leg.geometry,
    estimated: Boolean(leg.approximate) || leg.geometry.length < 3,
  };
  }
  const from = stops.find((s) => s.id === leg.fromStopId);
  const to = stops.find((s) => s.id === leg.toStopId);
  if (!from || !to) return null;
  return {
    positions: [
      [from.lat, from.lng],
      [to.lat, to.lng],
    ],
    estimated: true,
  };
}

/**
 * CARTO's anonymous raster CDN (basemaps.cartocdn.com) now returns a 200
 * watermark tile ("API KEY REQUIRED") instead of streets. Esri World Street Map
 * is the no-key default. Set VITE_TILE_URL at build time for Carto/Mapbox/etc.
 * If the primary host errors, fall back to OSM.
 */
const DEFAULT_TILE_URL =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}';
const DEFAULT_TILE_ATTRIBUTION =
  '&copy; <a href="https://www.esri.com/">Esri</a> &mdash; Esri, NAVTEQ, TomTom';
const OSM_FALLBACK_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const OSM_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

function BaseTiles() {
  const customUrl = import.meta.env.VITE_TILE_URL as string | undefined;
  const customAttr = import.meta.env.VITE_TILE_ATTRIBUTION as string | undefined;
  const [url, setUrl] = useState(customUrl || DEFAULT_TILE_URL);
  const fellBack = useRef(false);
  const errorCount = useRef(0);
  const attribution =
    url === OSM_FALLBACK_URL
      ? OSM_ATTRIBUTION
      : customUrl
        ? customAttr || '© map tiles'
        : DEFAULT_TILE_ATTRIBUTION;

  return (
    <TileLayer
      key={url}
      attribution={attribution}
      url={url}
      subdomains="abcd"
      maxZoom={19}
      eventHandlers={{
        tileerror: () => {
          errorCount.current += 1;
          if (fellBack.current || url === OSM_FALLBACK_URL || errorCount.current < 4) return;
          fellBack.current = true;
          setUrl(OSM_FALLBACK_URL);
        },
      }}
    />
  );
}

type Props = {
  stops: Stop[];
  legs: Leg[];
  selectedId: string | null;
  /** True when this pane is on screen (mobile map tab, or any desktop width). */
  active: boolean;
  lodging?: LodgingPoint | null;
  canEdit?: boolean;
  onSelect: (id: string) => void;
  onRename?: (id: string, title: string) => void;
};

export function LeafletMapView({
  stops,
  legs,
  selectedId,
  active,
  lodging,
  canEdit = false,
  onSelect,
  onRename,
}: Props) {
  const nextId = stops[0]?.id ?? null;
  const fitKey = fitKeyFor(stops);
  const seed = useRef<{ center: [number, number]; zoom: number } | null>(null);
  if (!seed.current) {
    const camera = dayCamera(stops, lodging);
    if (camera.kind === 'point') {
      seed.current = { center: camera.center, zoom: camera.zoom };
    } else {
      const lat = camera.positions.reduce((sum, p) => sum + p[0], 0) / camera.positions.length;
      const lng = camera.positions.reduce((sum, p) => sum + p[1], 0) / camera.positions.length;
      seed.current = { center: [lat, lng], zoom: 12 };
    }
  }

  const positions = useMemo(
    () => stops.map((s) => [s.lat, s.lng] as [number, number]),
    [stops],
  );

  const legLines = useMemo(
    () =>
      legs
        .map((leg) => {
          const line = lineFor(leg, stops);
          return line ? { leg, ...line } : null;
        })
        .filter((row): row is { leg: Leg; positions: [number, number][]; estimated: boolean } => Boolean(row)),
    [legs, stops],
  );

  const modesInView = useMemo(() => {
    const seen: TravelMode[] = [];
    for (const leg of legs) {
      if (!seen.includes(leg.mode)) seen.push(leg.mode);
    }
    return seen;
  }, [legs]);

  return (
    <div className="map-pane relative w-full">
      <MapContainer
        center={seed.current?.center || [SAPPORO_BASE.lat, SAPPORO_BASE.lng]}
        zoom={seed.current?.zoom ?? 13}
        minZoom={4}
        maxZoom={19}
        preferCanvas
        className="h-full w-full"
        zoomControl
        dragging
        touchZoom
        doubleClickZoom
        scrollWheelZoom
      >
        <BaseTiles />
        <FitDayBounds active={active} stops={stops} lodging={lodging} fitKey={fitKey} />
        {legLines.length > 0
          ? legLines.map(({ leg, positions: line, estimated }) => (
              <Polyline
                key={leg.id}
                positions={line}
                pathOptions={{
                  color: MODE_COLORS[leg.mode] || '#2563a8',
                  weight: estimated ? 3 : 5,
                  opacity: estimated ? 0.55 : 0.9,
                  dashArray: estimated ? '6 8' : undefined,
                }}
              />
            ))
          : positions.length >= 2 && (
              <Polyline positions={positions} pathOptions={{ color: '#2563a8', weight: 4, opacity: 0.75 }} />
            )}
        {stops.map((s) => {
          const isNext = s.id === nextId;
          const isSel = s.id === selectedId;
          const icon = isSel ? selectedIcon : isNext ? nextIcon : normalIcon;
          return (
            <Marker
              key={s.id}
              position={[s.lat, s.lng]}
              icon={icon}
              eventHandlers={{ click: () => onSelect(s.id) }}
            >
              <Popup minWidth={220}>
                <div className="text-sm">
                  <StopName
                    title={s.title}
                    canEdit={canEdit}
                    onRename={(title) => onRename?.(s.id, title)}
                  />
                  {s.time && <div className="text-slate-600">{s.time}</div>}
                  {s.notes && <div className="mt-1 text-slate-500">{s.notes}</div>}
                  {isNext && <div className="mt-1 font-medium text-pink-600">下一站</div>}
                </div>
              </Popup>
            </Marker>
          );
        })}
      </MapContainer>
      {stops.length === 0 && (
        <div className="pointer-events-none absolute left-1/2 top-3 z-[400] -translate-x-1/2 rounded-full bg-white/95 px-3 py-1.5 text-sm text-slate-500 shadow">
          這天還沒有站點
        </div>
      )}
      <div className="pointer-events-none absolute bottom-2 left-2 z-[400] max-w-[70%] rounded-lg bg-white/95 px-2 py-1 text-[10px] leading-snug text-slate-600 shadow">
        <div>
          <span className="mr-1 inline-block h-2.5 w-2.5 rounded-full bg-sakura-500 align-middle" />
          下一站
          <span className="ml-2 mr-1 inline-block h-2.5 w-2.5 rounded-full bg-ice-600 align-middle" />
          選中
        </div>
        {modesInView.length > 0 && (
          <div className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5">
            {modesInView.map((mode) => (
              <span key={mode}>
                <span
                  className="mr-1 inline-block h-1.5 w-3 align-middle"
                  style={{ background: MODE_COLORS[mode] }}
                />
                {MODE_LABELS[mode]}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
