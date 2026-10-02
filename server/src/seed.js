/** 瘋瘋火火北海道冒險記｜種子資料 */

export const ROOM_CODE = (process.env.ROOM_CODE || 'HOKKAIDO2027').toUpperCase();

export const USERS = [
  { id: 'u1', username: 'alice', displayName: 'Alice', passwordHash: '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy' }, // demo1234
  { id: 'u2', username: 'bob', displayName: 'Bob', passwordHash: '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy' },
];

export function createSeedStops() {
  const stops = [
    // D1 2/12
    { id: 's1', day: 1, date: '2027-02-12', title: '新千歲機場 CTS 抵達', time: '15:00', lat: 42.7752, lng: 141.6925, notes: 'RMQ 10:20 → CTS 15:00' },
    { id: 's2', day: 1, date: '2027-02-12', title: 'JR 札幌駅', time: '16:30', lat: 43.0686, lng: 141.3508, notes: '機場 JR 快速 Airport' },
    { id: 's3', day: 1, date: '2027-02-12', title: 'Minn 札幌大通 西14', time: '17:00', lat: 43.0595, lng: 141.3355, notes: '入住／南1条西14丁目1-235' },
    { id: 's4', day: 1, date: '2027-02-12', title: '狸小路商店街', time: '18:00', lat: 43.057, lng: 141.353, notes: '傍晚散步' },
    { id: 's5', day: 1, date: '2027-02-12', title: 'MEGA 唐吉訶德', time: '19:00', lat: 43.0555, lng: 141.3545, notes: '補給日用品' },
    { id: 's6', day: 1, date: '2027-02-12', title: 'すすきの晚餐', time: '20:00', lat: 43.055, lng: 141.353, notes: '拉麵或居酒屋' },
    // D2 2/13
    { id: 's7', day: 2, date: '2027-02-13', title: '札幌時計台', time: '09:30', lat: 43.0621, lng: 141.3535, notes: '' },
    { id: 's8', day: 2, date: '2027-02-13', title: '札幌電視塔', time: '10:30', lat: 43.0610, lng: 141.3564, notes: '大通公園' },
    { id: 's9', day: 2, date: '2027-02-13', title: '北菓楼 札幌本館', time: '11:30', lat: 43.0605, lng: 141.3515, notes: '甜點午餐' },
    { id: 's10', day: 2, date: '2027-02-13', title: '北海道神宮', time: '13:30', lat: 43.0544, lng: 141.3078, notes: '圓山' },
    { id: 's11', day: 2, date: '2027-02-13', title: '北海道大學', time: '15:00', lat: 43.0745, lng: 141.3420, notes: '校園散步' },
    { id: 's12', day: 2, date: '2027-02-13', title: '白い恋人パーク', time: '16:30', lat: 43.0890, lng: 141.2710, notes: '' },
    { id: 's13', day: 2, date: '2027-02-13', title: '大丸／寶可夢中心', time: '18:30', lat: 43.0675, lng: 141.3515, notes: '購物' },
    { id: 's14', day: 2, date: '2027-02-13', title: 'JRタワー夜景', time: '20:00', lat: 43.0687, lng: 141.3508, notes: '晚上夜景' },
    // D3 2/14 旭川／美瑛
    { id: 's15', day: 3, date: '2027-02-14', title: '旭山動物園', time: '09:30', lat: 43.7682, lng: 142.4815, notes: '包車一日' },
    { id: 's16', day: 3, date: '2027-02-14', title: '四季彩の丘', time: '13:00', lat: 43.49, lng: 142.47, notes: '美瑛' },
    { id: 's17', day: 3, date: '2027-02-14', title: 'ファーム富田', time: '14:30', lat: 43.475, lng: 142.45, notes: '薰衣草（冬季可能休息）' },
    { id: 's18', day: 3, date: '2027-02-14', title: '白鬚瀑布', time: '16:00', lat: 43.525, lng: 142.635, notes: '' },
    { id: 's19', day: 3, date: '2027-02-14', title: '青池', time: '16:45', lat: 43.528, lng: 142.62, notes: '美瑛' },
    // D4 2/15
    { id: 's20', day: 4, date: '2027-02-15', title: '朝里川溫泉滑雪', time: '09:00', lat: 43.138, lng: 141.165, notes: '一日滑雪' },
    // D5 2/16 小樽
    { id: 's21', day: 5, date: '2027-02-16', title: '小樽駅', time: '09:30', lat: 43.197, lng: 140.994, notes: 'JR 自札幌' },
    { id: 's22', day: 5, date: '2027-02-16', title: '三角市場', time: '10:00', lat: 43.1965, lng: 140.996, notes: '海鮮丼' },
    { id: 's23', day: 5, date: '2027-02-16', title: '小樽運河', time: '11:30', lat: 43.199, lng: 141.003, notes: '' },
    { id: 's24', day: 5, date: '2027-02-16', title: '音樂盒堂', time: '13:30', lat: 43.191, lng: 140.997, notes: '' },
    { id: 's25', day: 5, date: '2027-02-16', title: 'LeTAO 本店', time: '15:00', lat: 43.1905, lng: 140.9985, notes: '起司蛋糕' },
    // D6 2/17
    { id: 's26', day: 6, date: '2027-02-17', title: '中島公園', time: '11:00', lat: 43.048, lng: 141.355, notes: '彈性／散步' },
    { id: 's27', day: 6, date: '2027-02-17', title: '市區購物', time: '14:00', lat: 43.057, lng: 141.353, notes: '狸小路／大丸彈性' },
    // D7 2/18
    { id: 's28', day: 7, date: '2027-02-18', title: '退房 Minn', time: '10:00', lat: 43.0595, lng: 141.3355, notes: '行李整理' },
    { id: 's29', day: 7, date: '2027-02-18', title: '新千歲機場 CTS', time: '13:30', lat: 42.7752, lng: 141.6925, notes: 'CTS 16:00 → RMQ 19:55' },
  ];
  return stops;
}

export function createSeedState() {
  return {
    roomCode: ROOM_CODE,
    tripName: '瘋瘋火火北海道冒險記｜6 人｜2027-02-12～18',
    lodging: {
      name: 'Minn 札幌大通 西14',
      address: '南1条西14丁目1-235',
      lat: 43.0595,
      lng: 141.3355,
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
