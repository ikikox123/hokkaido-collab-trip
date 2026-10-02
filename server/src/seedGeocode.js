/**
 * Correct seed-stop coordinates with Geocoding, then Places API (New)
 * and legacy Find Place, when GOOGLE_MAPS_SERVER_KEY is set.
 *
 * Boot: index.js calls correctSeedState() and updates in-memory trip state.
 * One-shot: `node src/seedGeocode.js` prints corrections (no key).
 *           `node src/seedGeocode.js --write` rewrites SEED_COORDINATES in seed.js.
 */

import './loadEnv.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { SEED_COORDINATES, createSeedState, createSeedStops } from './seed.js';
import { haversineMeters } from './legs.js';
import { inHokkaido, lookupPlace, round6, serverMapsKey } from './googleMaps.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEED_FILE = path.join(__dirname, 'seed.js');
const CACHE_FILE = path.resolve(__dirname, '../../data/geocode-cache.json');

/** Name + city context. Bias keeps a bad worldwide match from sticking. */
export const SEED_LOOKUPS = [
  { id: 's1', query: '新千歳空港 旅客ターミナル 千歳 北海道', bias: 'circle:12000@42.787,141.681' },
  { id: 's2', query: '札幌駅 JR 札幌', bias: 'circle:8000@43.068,141.351' },
  { id: 's3', query: 'Minn 札幌大通 西14 南1条西14丁目 札幌', bias: 'circle:2500@43.057,141.337' },
  { id: 's4', query: '狸小路商店街 札幌', bias: 'circle:4000@43.057,141.351' },
  { id: 's5', query: 'MEGAドン・キホーテ 札幌 狸小路 すすきの', bias: 'circle:4000@43.056,141.352' },
  { id: 's6', query: 'すすきの交差点 札幌', bias: 'circle:3000@43.055,141.353' },
  { id: 's7', query: '札幌市時計台 札幌', bias: 'circle:2000@43.062,141.354' },
  { id: 's8', query: 'さっぽろテレビ塔 大通公園 札幌', bias: 'circle:2000@43.061,141.356' },
  { id: 's9', query: '北菓楼札幌本館 北1条西5丁目 札幌', bias: 'circle:2000@43.062,141.349' },
  { id: 's10', query: '北海道神宮 円山 札幌', bias: 'circle:4000@43.054,141.308' },
  { id: 's11', query: '北海道大学 札幌キャンパス', bias: 'circle:5000@43.075,141.341' },
  { id: 's12', query: '白い恋人パーク 札幌', bias: 'circle:4000@43.089,141.272' },
  { id: 's13', query: '大丸札幌店 ポケモンセンターサッポロ', bias: 'circle:2500@43.067,141.350' },
  { id: 's14', query: 'JRタワー 札幌駅', bias: 'circle:2000@43.068,141.352' },
  { id: 's15', query: '旭山動物園 旭川', bias: 'circle:8000@43.768,142.480' },
  { id: 's16', query: '展望花畑 四季彩の丘 美瑛', bias: 'circle:8000@43.528,142.466' },
  { id: 's17', query: 'ファーム富田 中富良野', bias: 'circle:8000@43.419,142.427' },
  { id: 's18', query: '白ひげの滝 美瑛 白金', bias: 'circle:8000@43.475,142.639' },
  { id: 's19', query: '白金青い池 美瑛', bias: 'circle:6000@43.494,142.614' },
  { id: 's20', query: '朝里川温泉スキー場 小樽', bias: 'circle:8000@43.144,141.037' },
  { id: 's21', query: '小樽駅 JR 小樽', bias: 'circle:3000@43.198,140.994' },
  { id: 's22', query: '小樽三角市場', bias: 'circle:2000@43.198,140.994' },
  { id: 's23', query: '小樽運河 小樽', bias: 'circle:4000@43.200,141.001' },
  { id: 's24', query: '小樽オルゴール堂 本館', bias: 'circle:2500@43.191,141.008' },
  { id: 's25', query: 'ルタオ本店 小樽 堺町', bias: 'circle:2500@43.191,141.007' },
  { id: 's26', query: '中島公園 札幌', bias: 'circle:3000@43.044,141.355' },
  { id: 's27', query: '狸小路商店街 札幌', bias: 'circle:4000@43.057,141.351' },
  { id: 's28', query: 'Minn 札幌大通 西14 南1条西14丁目 札幌', bias: 'circle:2500@43.057,141.337' },
  { id: 's29', query: '新千歳空港 旅客ターミナル 千歳 北海道', bias: 'circle:12000@42.787,141.681' },
  { id: 'lodging', query: 'Minn 札幌大通 西14 南1条西14丁目 札幌', bias: 'circle:2500@43.057,141.337', lodging: true },
];

const MOVE_METERS = 40;

function biasCenter(bias) {
  const match = String(bias || '').match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if (!match) return null;
  return { lat: Number(match[1]), lng: Number(match[2]) };
}

export function acceptFix(fix, bias) {
  if (!fix || !inHokkaido(fix.lat, fix.lng)) return false;
  const center = biasCenter(bias);
  if (!center) return true;
  return haversineMeters(center, fix) <= 40000;
}

export function applySeedFixes(state, fixesById) {
  const seeds = new Map(createSeedStops().map((s) => [s.id, s]));
  const movedIds = [];
  const stops = (state.stops || []).map((stop) => {
    const fix = fixesById[stop.id];
    const seed = seeds.get(stop.id);
    if (!fix || !seed || seed.title !== stop.title) return stop;
    if (!inHokkaido(fix.lat, fix.lng)) return stop;
    if (haversineMeters(stop, fix) < MOVE_METERS) return stop;
    movedIds.push(stop.id);
    return { ...stop, lat: round6(fix.lat), lng: round6(fix.lng) };
  });
  let lodging = state.lodging;
  const lodgingFix = fixesById.lodging;
  const seedLodging = createSeedState().lodging;
  if (
    lodgingFix &&
    lodging &&
    lodging.name === seedLodging.name &&
    inHokkaido(lodgingFix.lat, lodgingFix.lng) &&
    haversineMeters(lodging, lodgingFix) >= MOVE_METERS
  ) {
    lodging = { ...lodging, lat: round6(lodgingFix.lat), lng: round6(lodgingFix.lng) };
    movedIds.push('lodging');
  }
  return {
    state: { ...state, stops, lodging },
    changed: movedIds.length > 0,
    movedIds,
  };
}

function readCache() {
  try {
    if (!fs.existsSync(CACHE_FILE)) return {};
    const parsed = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeCache(cache) {
  try {
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
  } catch (err) {
    console.warn('[geocode] cache write failed', err?.message || err);
  }
}

export async function resolveSeedFixes(key, { lookup = lookupPlace, pauseMs = 120 } = {}) {
  const cache = readCache();
  const fixes = {};
  let cacheDirty = false;
  for (const row of SEED_LOOKUPS) {
    const cacheKey = `${row.query}|${row.bias || ''}`;
    const cached = cache[cacheKey];
    if (cached && acceptFix(cached, row.bias)) {
      fixes[row.id] = cached;
      continue;
    }
    try {
      const found = await lookup(row.query, key, { bias: row.bias });
      if (found && acceptFix(found, row.bias)) {
        const fix = { lat: found.lat, lng: found.lng, name: found.name || '' };
        fixes[row.id] = fix;
        cache[cacheKey] = fix;
        cacheDirty = true;
        console.log(`[geocode] ${row.id} ${found.source} ${fix.lat},${fix.lng}`);
      } else {
        console.warn(`[geocode] ${row.id} no Hokkaido match`);
      }
    } catch (err) {
      console.warn(`[geocode] ${row.id} failed: ${err?.message || err}`);
    }
    if (pauseMs) await new Promise((r) => setTimeout(r, pauseMs));
  }
  if (cacheDirty) writeCache(cache);
  return fixes;
}

export async function correctSeedState(state, options = {}) {
  const key = options.key ?? serverMapsKey();
  if (!key) return { state, changed: false, movedIds: [], skipped: 'no-key' };
  const fixes = await resolveSeedFixes(key, options);
  const applied = applySeedFixes(state, fixes);
  return { ...applied, skipped: null };
}

export function formatCoordinateBlock(coords) {
  const lines = Object.entries(coords).map(([id, point]) => {
    return `  ${id}: { lat: ${round6(point.lat)}, lng: ${round6(point.lng)} },`;
  });
  return `// SEED_COORDINATES_START\nexport const SEED_COORDINATES = {\n${lines.join('\n')}\n};\n// SEED_COORDINATES_END`;
}

export function writeSeedCoordinates(fixesById) {
  const next = { ...SEED_COORDINATES };
  for (const [id, fix] of Object.entries(fixesById)) {
    if (!Object.prototype.hasOwnProperty.call(next, id)) continue;
    if (!inHokkaido(fix.lat, fix.lng)) continue;
    next[id] = { lat: round6(fix.lat), lng: round6(fix.lng) };
  }
  const source = fs.readFileSync(SEED_FILE, 'utf8');
  const pattern = /\/\/ SEED_COORDINATES_START[\s\S]*?\/\/ SEED_COORDINATES_END/;
  if (!pattern.test(source)) throw new Error('SEED_COORDINATES block not found');
  const updated = source.replace(pattern, formatCoordinateBlock(next));
  fs.writeFileSync(SEED_FILE, updated);
  return next;
}

async function main() {
  const key = serverMapsKey();
  if (!key) {
    console.log('[geocode] GOOGLE_MAPS_SERVER_KEY is not set; nothing to correct.');
    process.exit(0);
  }
  const fixes = await resolveSeedFixes(key, { pauseMs: 150 });
  const printable = Object.fromEntries(
    Object.entries(fixes).map(([id, fix]) => [id, { lat: fix.lat, lng: fix.lng, name: fix.name || '' }]),
  );
  console.log(JSON.stringify(printable, null, 2));
  if (process.argv.includes('--write')) {
    writeSeedCoordinates(fixes);
    console.log('[geocode] wrote SEED_COORDINATES in seed.js');
  }
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  main().catch((err) => {
    console.error('[geocode]', err?.message || err);
    process.exit(1);
  });
}
