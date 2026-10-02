/** 瘋瘋火火北海道冒險記｜種子資料 */

import { reconcileLegs } from './legs.js';

export const ROOM_CODE = (process.env.ROOM_CODE || 'HOKKAIDO2027').toUpperCase();

export const USERS = [
  { id: 'u1', username: 'alice', displayName: 'Alice', passwordHash: '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy' }, // demo1234
  { id: 'u2', username: 'bob', displayName: 'Bob', passwordHash: '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy' },
];

/**
 * Published coordinates (Wikipedia / OSM / public lodging listings).
 * Not Google API output. When GOOGLE_MAPS_SERVER_KEY is set, boot-time
 * Places/Geocoding may replace these in memory — see seedGeocode.js.
 * The marker block below is rewritten by `node src/seedGeocode.js --write`.
 */
// SEED_COORDINATES_START
export const SEED_COORDINATES = {
  s1: { lat: 42.787808, lng: 141.680869 },
  s2: { lat: 43.068611, lng: 141.350778 },
  s3: { lat: 43.057291, lng: 141.336603 },
  s4: { lat: 43.056976, lng: 141.350583 },
  s5: { lat: 43.056989, lng: 141.352497 },
  s6: { lat: 43.055357, lng: 141.353346 },
  s7: { lat: 43.0625, lng: 141.353611 },
  s8: { lat: 43.061092, lng: 141.356433 },
  s9: { lat: 43.061905, lng: 141.348831 },
  s10: { lat: 43.054333, lng: 141.3075 },
  s11: { lat: 43.074722, lng: 141.340833 },
  s12: { lat: 43.088611, lng: 141.271667 },
  s13: { lat: 43.067487, lng: 141.349482 },
  s14: { lat: 43.068611, lng: 141.351944 },
  s15: { lat: 43.768028, lng: 142.479778 },
  s16: { lat: 43.528087, lng: 142.46605 },
  s17: { lat: 43.418894, lng: 142.426581 },
  s18: { lat: 43.474667, lng: 142.639194 },
  s19: { lat: 43.493583, lng: 142.614028 },
  s20: { lat: 43.143611, lng: 141.036667 },
  s21: { lat: 43.197556, lng: 140.993861 },
  s22: { lat: 43.198542, lng: 140.993869 },
  s23: { lat: 43.2, lng: 141 },
  s24: { lat: 43.190579, lng: 141.007837 },
  s25: { lat: 43.191307, lng: 141.00744 },
  s26: { lat: 43.044167, lng: 141.355 },
  s27: { lat: 43.0565, lng: 141.351 },
  s28: { lat: 43.057291, lng: 141.336603 },
  s29: { lat: 42.787808, lng: 141.680869 },
  lodging: { lat: 43.057291, lng: 141.336603 },
};
// SEED_COORDINATES_END

function at(id) {
  const point = SEED_COORDINATES[id];
  if (!point) throw new Error(`missing seed coordinate ${id}`);
  return { lat: point.lat, lng: point.lng };
}

export function createSeedStops() {
  const stops = [
    // D1 2/12 — CTS terminal (not the runway reference point)
    { id: 's1', day: 1, date: '2027-02-12', title: '新千歲機場 CTS 抵達', time: '15:00', ...at('s1'), notes: 'RMQ 10:20 → CTS 15:00' },
    { id: 's2', day: 1, date: '2027-02-12', title: 'JR 札幌駅', time: '16:30', ...at('s2'), notes: '機場 JR 快速 Airport' },
    { id: 's3', day: 1, date: '2027-02-12', title: 'Minn 札幌大通 西14', time: '17:00', ...at('s3'), notes: '入住／南1条西14丁目1-235' },
    { id: 's4', day: 1, date: '2027-02-12', title: '狸小路商店街', time: '18:00', ...at('s4'), notes: '傍晚散步' },
    { id: 's5', day: 1, date: '2027-02-12', title: 'MEGA 唐吉訶德', time: '19:00', ...at('s5'), notes: '補給日用品' },
    { id: 's6', day: 1, date: '2027-02-12', title: 'すすきの晚餐', time: '20:00', ...at('s6'), notes: '拉麵或居酒屋' },
    // D2 2/13
    { id: 's7', day: 2, date: '2027-02-13', title: '札幌時計台', time: '09:30', ...at('s7'), notes: '' },
    { id: 's8', day: 2, date: '2027-02-13', title: '札幌電視塔', time: '10:30', ...at('s8'), notes: '大通公園' },
    { id: 's9', day: 2, date: '2027-02-13', title: '北菓楼 札幌本館', time: '11:30', ...at('s9'), notes: '甜點午餐' },
    { id: 's10', day: 2, date: '2027-02-13', title: '北海道神宮', time: '13:30', ...at('s10'), notes: '圓山' },
    { id: 's11', day: 2, date: '2027-02-13', title: '北海道大學', time: '15:00', ...at('s11'), notes: '校園散步' },
    { id: 's12', day: 2, date: '2027-02-13', title: '白い恋人パーク', time: '16:30', ...at('s12'), notes: '' },
    { id: 's13', day: 2, date: '2027-02-13', title: '大丸／寶可夢中心', time: '18:30', ...at('s13'), notes: '購物' },
    { id: 's14', day: 2, date: '2027-02-13', title: 'JRタワー夜景', time: '20:00', ...at('s14'), notes: '晚上夜景' },
    // D3 2/14 旭川／美瑛／中富良野
    { id: 's15', day: 3, date: '2027-02-14', title: '旭山動物園', time: '09:30', ...at('s15'), notes: '包車一日' },
    { id: 's16', day: 3, date: '2027-02-14', title: '四季彩の丘', time: '13:00', ...at('s16'), notes: '美瑛' },
    { id: 's17', day: 3, date: '2027-02-14', title: 'ファーム富田', time: '14:30', ...at('s17'), notes: '薰衣草（冬季可能休息）' },
    { id: 's18', day: 3, date: '2027-02-14', title: '白鬚瀑布', time: '16:00', ...at('s18'), notes: '' },
    { id: 's19', day: 3, date: '2027-02-14', title: '青池', time: '16:45', ...at('s19'), notes: '美瑛' },
    // D4 2/15
    { id: 's20', day: 4, date: '2027-02-15', title: '朝里川溫泉滑雪', time: '09:00', ...at('s20'), notes: '一日滑雪' },
    // D5 2/16 小樽
    { id: 's21', day: 5, date: '2027-02-16', title: '小樽駅', time: '09:30', ...at('s21'), notes: 'JR 自札幌' },
    { id: 's22', day: 5, date: '2027-02-16', title: '三角市場', time: '10:00', ...at('s22'), notes: '海鮮丼' },
    { id: 's23', day: 5, date: '2027-02-16', title: '小樽運河', time: '11:30', ...at('s23'), notes: '' },
    { id: 's24', day: 5, date: '2027-02-16', title: '音樂盒堂', time: '13:30', ...at('s24'), notes: '' },
    { id: 's25', day: 5, date: '2027-02-16', title: 'LeTAO 本店', time: '15:00', ...at('s25'), notes: '起司蛋糕' },
    // D6 2/17
    { id: 's26', day: 6, date: '2027-02-17', title: '中島公園', time: '11:00', ...at('s26'), notes: '彈性／散步' },
    { id: 's27', day: 6, date: '2027-02-17', title: '市區購物', time: '14:00', ...at('s27'), notes: '狸小路／大丸彈性' },
    // D7 2/18
    { id: 's28', day: 7, date: '2027-02-18', title: '退房 Minn', time: '10:00', ...at('s28'), notes: '行李整理' },
    { id: 's29', day: 7, date: '2027-02-18', title: '新千歲機場 CTS', time: '13:30', ...at('s29'), notes: 'CTS 16:00 → RMQ 19:55' },
  ];
  return stops;
}

function createSeedStateWithoutLegs() {
  return {
    roomCode: ROOM_CODE,
    tripName: '瘋瘋火火北海道冒險記｜6 人｜2027-02-12～18',
    lodging: {
      name: 'Minn 札幌大通 西14',
      address: '南1条西14丁目1-235',
      ...at('lodging'),
    },
    flights: {
      outbound: 'RMQ 10:20 → CTS 15:00',
      inbound: 'CTS 16:00 → RMQ 19:55',
    },
    days: [
      { day: 1, date: '2027-02-12', label: 'D1 抵達' },
      { day: 2, date: '2027-02-13', label: 'D2 札幌' },
      { day: 3, date: '2027-02-14', label: 'D3 旭川' },
      { day: 4, date: '2027-02-15', label: 'D4 滑雪' },
      { day: 5, date: '2027-02-16', label: 'D5 小樽' },
      { day: 6, date: '2027-02-17', label: 'D6 彈性' },
      { day: 7, date: '2027-02-18', label: 'D7 起飛' },
    ],
    stops: createSeedStops(),
    updatedAt: new Date().toISOString(),
  };
}

export function createSeedState() {
  const state = createSeedStateWithoutLegs();
  return { ...state, legs: reconcileLegs(state) };
}
