import { inHokkaido } from './googleMaps.js';

/** Display names are short labels; reject rather than silently truncate. */
export const LODGING_NAME_MAX = 80;
export const LODGING_ADDRESS_MAX = 160;

/**
 * Replace only `lodging`. Stops, legs, members, expenses, and settlements stay
 * on the same objects. Unknown patch keys are ignored.
 * `inHokkaido` is defined in googleMaps.js; seedGeocode.js imports it and does
 * not re-export it.
 */
export function applyLodgingPatch(state, patch) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    return { ok: false, error: '住宿格式不正確' };
  }
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    return { ok: false, error: '住宿格式不正確' };
  }

  if (typeof patch.name !== 'string') return { ok: false, error: '住宿名稱不可空白' };
  const name = patch.name.trim();
  if (!name) return { ok: false, error: '住宿名稱不可空白' };
  if (name.length > LODGING_NAME_MAX) return { ok: false, error: '住宿名稱過長' };

  let address = '';
  if (patch.address != null && patch.address !== '') {
    if (typeof patch.address !== 'string') return { ok: false, error: '住宿格式不正確' };
    address = patch.address.trim();
    if (address.length > LODGING_ADDRESS_MAX) return { ok: false, error: '住宿地址過長' };
  }

  if (typeof patch.lat !== 'number' || typeof patch.lng !== 'number') {
    return { ok: false, error: '座標不完整' };
  }
  if (!Number.isFinite(patch.lat) || !Number.isFinite(patch.lng)) {
    return { ok: false, error: '座標不完整' };
  }
  if (!inHokkaido(patch.lat, patch.lng)) {
    return { ok: false, error: '座標超出範圍' };
  }

  const lodging = { name, address, lat: patch.lat, lng: patch.lng };
  const prev = state.lodging;
  if (
    prev &&
    typeof prev === 'object' &&
    prev.name === lodging.name &&
    String(prev.address || '') === lodging.address &&
    prev.lat === lodging.lat &&
    prev.lng === lodging.lng
  ) {
    return { ok: true, unchanged: true, state };
  }

  return {
    ok: true,
    unchanged: false,
    state: { ...state, lodging },
  };
}
