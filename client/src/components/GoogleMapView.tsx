import { useEffect, useMemo, useRef, useState } from 'react';
import type { Leg, Stop, TravelMode } from '../types/trip';
import { dayCamera, fitKeyFor, SAPPORO_BASE, type LodgingPoint } from '../lib/dayView';
import { useI18n } from '../i18n/I18nProvider';
import { displayStopTitle } from '../i18n/stopNames';
import { stopMarkerIconUrl, stopMarkerKind, stopMarkerTitle } from '../lib/stopMarker';
import { stopNumberById } from '../lib/stopNumbers';
import { MODE_COLORS } from '../lib/travel';
import { loadGoogleMaps, type GoogleMap, type GoogleMapsNS } from '../lib/googleLoader';
import { MapChrome } from './MapChrome';

type Props = {
  stops: Stop[];
  legs: Leg[];
  selectedId: string | null;
  active: boolean;
  lodging?: LodgingPoint | null;
  canEdit?: boolean;
  onSelect: (id: string) => void;
  onRename?: (id: string, title: string) => void;
  onUnavailable: () => void;
};

function lineFor(leg: Leg, stops: Stop[]) {
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
    ] as [number, number][],
    estimated: true,
  };
}

const STOP_TITLE_MAX = 80;

type PopupCopy = {
  rename: string;
  editName: (title: string) => string;
  placeName: string;
  nameBlank: string;
  nameTooLong: string;
  nextStop: string;
};

function popupNode(
  stop: Stop,
  isNext: boolean,
  copy: PopupCopy,
  labelFor: (stored: string) => string,
  edit?: { canEdit: boolean; onRename: (title: string) => void },
) {
  const root = document.createElement('div');
  root.style.fontSize = '14px';
  root.style.minWidth = '180px';
  const shown = labelFor(stop.title);
  const title = document.createElement('div');
  title.style.fontWeight = '700';
  title.textContent = shown;
  root.appendChild(title);

  function showError(message: string) {
    let alert = root.querySelector('[data-rename-error]');
    if (!alert) {
      alert = document.createElement('p');
      alert.setAttribute('data-rename-error', '');
      (alert as HTMLElement).style.margin = '4px 0 0';
      (alert as HTMLElement).style.color = '#dc2626';
      (alert as HTMLElement).style.fontSize = '12px';
      title.insertAdjacentElement('afterend', alert);
    }
    alert.textContent = message;
  }

  if (edit?.canEdit) {
    const renameBtn = document.createElement('button');
    renameBtn.type = 'button';
    renameBtn.textContent = copy.rename;
    renameBtn.setAttribute('aria-label', copy.editName(shown));
    renameBtn.style.cssText =
      'margin-top:6px;min-height:44px;padding:0 12px;border:0;border-radius:8px;background:#e8f1fa;color:#1e4f8a;font:inherit;font-size:14px;font-weight:600;';

    const openEditor = (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!renameBtn.isConnected) return;
      const form = document.createElement('form');
      form.style.marginTop = '6px';
      const input = document.createElement('input');
      input.setAttribute('aria-label', copy.placeName);
      input.enterKeyHint = 'done';
      input.autocomplete = 'off';
      input.maxLength = STOP_TITLE_MAX;
      input.value = stop.title;
      input.style.cssText =
        'box-sizing:border-box;width:100%;min-height:44px;padding:6px 8px;border:1px solid #2563a8;border-radius:8px;font:inherit;font-size:16px;font-weight:600;';
      form.appendChild(input);
      const save = (raw: string) => {
        const next = raw.trim();
        if (!next) {
          showError(copy.nameBlank);
          input.value = stop.title;
          return;
        }
        if (next.length > STOP_TITLE_MAX) {
          showError(copy.nameTooLong);
          return;
        }
        root.querySelector('[data-rename-error]')?.remove();
        if (next !== stop.title) edit.onRename(next);
        const savedLabel = labelFor(next);
        title.textContent = savedLabel;
        title.setAttribute('aria-label', copy.editName(savedLabel));
        form.replaceWith(renameBtn);
      };
      form.addEventListener('submit', (submitEvent) => {
        submitEvent.preventDefault();
        save(input.value);
      });
      input.addEventListener('keydown', (keyEvent) => {
        if (keyEvent.key === 'Escape') {
          keyEvent.preventDefault();
          root.querySelector('[data-rename-error]')?.remove();
          form.replaceWith(renameBtn);
        }
      });
      renameBtn.replaceWith(form);
      input.focus();
      input.select();
    };

    renameBtn.addEventListener('click', openEditor);
    title.style.cursor = 'pointer';
    title.setAttribute('role', 'button');
    title.tabIndex = 0;
    title.setAttribute('aria-label', copy.editName(shown));
    title.addEventListener('click', openEditor);
    title.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') openEditor(event);
    });
    title.insertAdjacentElement('afterend', renameBtn);
  }

  if (stop.time) {
    const time = document.createElement('div');
    time.style.color = '#475569';
    time.textContent = stop.time;
    root.appendChild(time);
  }
  if (stop.notes) {
    const notes = document.createElement('div');
    notes.style.marginTop = '4px';
    notes.style.color = '#64748b';
    notes.textContent = stop.notes;
    root.appendChild(notes);
  }
  if (isNext) {
    const next = document.createElement('div');
    next.style.marginTop = '4px';
    next.style.fontWeight = '600';
    next.style.color = '#db2777';
    next.textContent = copy.nextStop;
    root.appendChild(next);
  }
  return root;
}

export function GoogleMapView({
  stops,
  legs,
  selectedId,
  active,
  lodging,
  canEdit = false,
  onSelect,
  onRename,
  onUnavailable,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<GoogleMap | null>(null);
  const googleRef = useRef<GoogleMapsNS | null>(null);
  const overlaysRef = useRef<Array<{ setMap: (map: GoogleMap | null) => void }>>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const fitKey = fitKeyFor(stops);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const onRenameRef = useRef(onRename);
  onRenameRef.current = onRename;
  const canEditRef = useRef(canEdit);
  canEditRef.current = canEdit;
  const { t, locale } = useI18n();
  const copyRef = useRef<PopupCopy>({
    rename: '',
    editName: (title) => title,
    placeName: '',
    nameBlank: '',
    nameTooLong: '',
    nextStop: '',
  });
  copyRef.current = {
    rename: t('rename'),
    editName: (title) => t('editPlaceName', { title }),
    placeName: t('placeName'),
    nameBlank: t('nameBlank'),
    nameTooLong: t('nameTooLong'),
    nextStop: t('nextStop'),
  };
  const onUnavailableRef = useRef(onUnavailable);
  onUnavailableRef.current = onUnavailable;

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

  useEffect(() => {
    let cancelled = false;
    loadGoogleMaps()
      .then((g) => {
        if (cancelled || !containerRef.current || mapRef.current) return;
        googleRef.current = g;
        const camera = dayCamera(stops, lodging);
        const center =
          camera.kind === 'point'
            ? { lat: camera.center[0], lng: camera.center[1] }
            : {
                lat: camera.positions.reduce((sum, p) => sum + p[0], 0) / camera.positions.length,
                lng: camera.positions.reduce((sum, p) => sum + p[1], 0) / camera.positions.length,
              };
        mapRef.current = new g.maps.Map(containerRef.current, {
          center,
          zoom: camera.kind === 'point' ? camera.zoom : 12,
          minZoom: 4,
          maxZoom: 19,
          gestureHandling: 'greedy',
          clickableIcons: false,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
          zoomControl: false,
          keyboardShortcuts: true,
        }) as GoogleMap;
        setStatus('ready');
      })
      .catch(() => {
        if (!cancelled) {
          setStatus('error');
          onUnavailableRef.current();
        }
      });
    return () => {
      cancelled = true;
    };
    // Map instance is created once; camera updates are a separate effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const g = googleRef.current;
    if (!map || !g || status !== 'ready' || !active) return;
    let cancelled = false;
    const fit = () => {
      if (cancelled) return;
      g.maps.event.trigger(map, 'resize');
      const camera = dayCamera(stops, lodging);
      if (camera.kind === 'point') {
        const [lat, lng] = camera.center;
        const point = {
          lat: Number.isFinite(lat) ? lat : SAPPORO_BASE.lat,
          lng: Number.isFinite(lng) ? lng : SAPPORO_BASE.lng,
        };
        map.setCenter(point);
        map.setZoom(camera.zoom);
        return;
      }
      const bounds = new g.maps.LatLngBounds();
      camera.positions.forEach(([lat, lng]) => bounds.extend({ lat, lng }));
      map.fitBounds(bounds, 56);
      g.maps.event.addListenerOnce(map, 'idle', () => {
        const zoom = map.getZoom();
        if (zoom != null && zoom > camera.maxZoom) map.setZoom(camera.maxZoom);
      });
    };
    const raf = requestAnimationFrame(fit);
    const timers = [60, 200, 450].map((ms) => window.setTimeout(fit, ms));
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      timers.forEach((id) => window.clearTimeout(id));
    };
  }, [active, fitKey, lodging, status, stops]);

  useEffect(() => {
    const map = mapRef.current;
    const g = googleRef.current;
    if (!map || !g || status !== 'ready') return;
    overlaysRef.current.forEach((overlay) => overlay.setMap(null));
    overlaysRef.current = [];
    const info = new g.maps.InfoWindow();
    const nextId = stops[0]?.id ?? null;
    const numbers = stopNumberById(stops);
    const labelFor = (stored: string) => displayStopTitle(locale, stored);

    const lines =
      legLines.length > 0
        ? legLines
        : stops.length >= 2
          ? [
              {
                leg: { id: 'straight', mode: 'walk' as TravelMode },
                positions: stops.map((s) => [s.lat, s.lng] as [number, number]),
                estimated: true,
              },
            ]
          : [];

    for (const { leg, positions, estimated } of lines) {
      const color = MODE_COLORS[leg.mode] || '#2563a8';
      const path = positions.map(([lat, lng]) => ({ lat, lng }));
      const line = new g.maps.Polyline({
        map,
        path,
        strokeColor: color,
        strokeWeight: estimated ? 3 : 5,
        strokeOpacity: estimated ? 0 : 0.9,
        geodesic: true,
        icons: estimated
          ? [
              {
                icon: {
                  path: 'M 0,-1 0,1',
                  strokeOpacity: 0.85,
                  strokeWeight: 3,
                  scale: 3,
                  strokeColor: color,
                },
                offset: '0',
                repeat: '14px',
              },
            ]
          : undefined,
      });
      overlaysRef.current.push(line);
    }

    stops.forEach((stop, index) => {
      const isNext = stop.id === nextId;
      const isSel = stop.id === selectedId;
      const number = numbers.get(stop.id) ?? index + 1;
      const kind = stopMarkerKind(stop.id, selectedId, nextId);
      const { url, size } = stopMarkerIconUrl(kind, number);
      const marker = new g.maps.Marker({
        map,
        position: { lat: stop.lat, lng: stop.lng },
        title: stopMarkerTitle(number, labelFor(stop.title)),
        zIndex: isSel ? 3 : isNext ? 2 : 1,
        // Keep each icon as its own image so the numeral painted into the SVG stays visible.
        optimized: false,
        icon: {
          url,
          scaledSize: new g.maps.Size(size, size),
          anchor: new g.maps.Point(size / 2, size / 2),
        },
      });
      marker.addListener('click', () => {
        onSelectRef.current(stop.id);
        info.setContent(
          popupNode(stop, isNext, copyRef.current, labelFor, {
            canEdit: canEditRef.current,
            onRename: (title) => onRenameRef.current?.(stop.id, title),
          }),
        );
        info.open({ map, anchor: marker });
      });
      overlaysRef.current.push(marker);
    });

    return () => {
      info.close();
      overlaysRef.current.forEach((overlay) => overlay.setMap(null));
      overlaysRef.current = [];
    };
  }, [legLines, locale, selectedId, status, stops]);

  function zoomBy(delta: number) {
    const map = mapRef.current;
    if (!map) return;
    const current = map.getZoom() ?? 13;
    map.setZoom(Math.min(19, Math.max(4, current + delta)));
  }

  return (
    <div className="map-pane relative w-full">
      <div ref={containerRef} className="google-map-canvas h-full w-full" />
      <div className="absolute right-2 top-2 z-[400] flex flex-col gap-1">
        <button
          type="button"
          className="flex h-11 w-11 items-center justify-center rounded-lg bg-white text-xl font-bold text-slate-800 shadow"
          aria-label={t('zoomIn')}
          onClick={() => zoomBy(1)}
        >
          +
        </button>
        <button
          type="button"
          className="flex h-11 w-11 items-center justify-center rounded-lg bg-white text-xl font-bold text-slate-800 shadow"
          aria-label={t('zoomOut')}
          onClick={() => zoomBy(-1)}
        >
          −
        </button>
      </div>
      {status === 'loading' && (
        <div className="absolute inset-0 z-[300] flex items-center justify-center bg-snow-100/80 text-sm text-ice-700">
          {t('loadingGoogle')}
        </div>
      )}
      <MapChrome empty={stops.length === 0} modes={modesInView} providerLabel={t('googleMaps')} />
    </div>
  );
}
