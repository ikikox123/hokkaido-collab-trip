import { useState } from 'react';
import type { Leg, Stop } from '../types/trip';
import type { LodgingPoint } from '../lib/dayView';
import { usesGoogleMaps } from '../lib/mapProvider';
import { LeafletMapView } from './LeafletMapView';
import { GoogleMapView } from './GoogleMapView';

type Props = {
  stops: Stop[];
  legs: Leg[];
  selectedId: string | null;
  active: boolean;
  lodging?: LodgingPoint | null;
  canEdit?: boolean;
  onSelect: (id: string) => void;
  onRename?: (id: string, title: string) => void;
};

export function MapView(props: Props) {
  const wantGoogle = usesGoogleMaps();
  const [googleFailed, setGoogleFailed] = useState(false);

  if (wantGoogle && !googleFailed) {
    return <GoogleMapView {...props} onUnavailable={() => setGoogleFailed(true)} />;
  }

  return (
    <div className="relative flex h-full min-h-0 w-full flex-1 flex-col">
      {googleFailed && (
        <div className="shrink-0 bg-amber-50 px-3 py-2 text-center text-sm text-amber-950">
          Google 地圖無法載入，已改用備援地圖
        </div>
      )}
      <LeafletMapView {...props} />
    </div>
  );
}
