import { useEffect, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
import type { Stop } from '../types/trip';

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

function FitBounds({ stops, selectedId }: { stops: Stop[]; selectedId: string | null }) {
  const map = useMap();
  const ids = stops.map((s) => s.id).join(',');
  useEffect(() => {
    if (!stops.length) return;
    const bounds = L.latLngBounds(stops.map((s) => [s.lat, s.lng] as [number, number]));
    map.fitBounds(bounds.pad(0.2), { animate: true, maxZoom: 14 });
  }, [map, ids]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!selectedId) return;
    const s = stops.find((x) => x.id === selectedId);
    if (s) map.panTo([s.lat, s.lng], { animate: true });
  }, [selectedId, map, stops]);

  return null;
}

type Props = {
  stops: Stop[];
  selectedId: string | null;
  onSelect: (id: string) => void;
};

export function MapView({ stops, selectedId, onSelect }: Props) {
  const nextId = stops[0]?.id ?? null;
  const positions = useMemo(
    () => stops.map((s) => [s.lat, s.lng] as [number, number]),
    [stops],
  );
  const center: [number, number] = stops[0]
    ? [stops[0].lat, stops[0].lng]
    : [43.06, 141.35];

  return (
    <div className="relative h-full w-full min-h-[240px]">
      <MapContainer
        center={center}
        zoom={12}
        className="h-full w-full rounded-none md:rounded-xl"
        zoomControl={true}
        dragging={true}
        touchZoom={true}
        doubleClickZoom={true}
        scrollWheelZoom={true}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {positions.length >= 2 && (
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
              <Popup>
                <div className="text-sm">
                  <div className="font-bold">{s.title}</div>
                  {s.time && <div className="text-slate-600">{s.time}</div>}
                  {s.notes && <div className="mt-1 text-slate-500">{s.notes}</div>}
                  {isNext && <div className="mt-1 text-pink-600 font-medium">下一站</div>}
                </div>
              </Popup>
            </Marker>
          );
        })}
        <FitBounds stops={stops} selectedId={selectedId} />
      </MapContainer>
      {stops.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center bg-snow-100/80 text-slate-500 text-sm z-[400]">
          這天還沒有站點
        </div>
      )}
      <div className="absolute bottom-3 left-3 z-[400] rounded-lg bg-white/95 px-2 py-1 text-xs text-slate-600 shadow">
        <span className="inline-block w-2.5 h-2.5 rounded-full bg-sakura-500 mr-1 align-middle" />
        下一站
        <span className="inline-block w-2.5 h-2.5 rounded-full bg-ice-600 mx-1 ml-2 align-middle" />
        選中
      </div>
    </div>
  );
}
