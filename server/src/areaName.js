/**
 * Area names for saved places: romaji -> Japanese, a canonical city spelling (札幌市), and the rule that a
 * "district" is a real administrative one (区 / 町 / 村). Street addresses and street names never are.
 * Place names are never converted between Traditional and Simplified Chinese or kanji variants (色内 stays 色内).
 * Pure and dependency-free: the Worker, the Express server, the client and the tests all import it.
 */
export const AREA_MAX = 40;

// eslint-disable-next-line no-control-regex
const CONTROLS = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f​‎‏‪-‮⁠-⁤⁦-⁩﻿<>]/g;

function tidy(value) {
  const text = String(value ?? '').replace(CONTROLS, '').replace(/\s+/g, ' ').trim();
  return Array.from(text).slice(0, AREA_MAX).join('');
}

// Romaji / English -> the Japanese spelling the project uses (cities without 市, wards with 区).
const AREA_NAMES = {
  sapporo: '札幌', otaru: '小樽', asahikawa: '旭川', hakodate: '函館', biei: '美瑛', furano: '富良野',
  niseko: 'ニセコ', chitose: '千歳', kushiro: '釧路', obihiro: '帯広', kitami: '北見', abashiri: '網走',
  muroran: '室蘭', tomakomai: '苫小牧', noboribetsu: '登別', toya: '洞爺湖', toyako: '洞爺湖', shakotan: '積丹',
  yoichi: '余市', wakkanai: '稚内', ebetsu: '江別', eniwa: '恵庭', kitahiroshima: '北広島', rusutsu: 'ルスツ',
  tokyo: '東京', osaka: '大阪', kyoto: '京都', nagoya: '名古屋', fukuoka: '福岡', yokohama: '横浜', kobe: '神戸',
  nara: '奈良', hiroshima: '広島', sendai: '仙台', naha: '那覇', okinawa: '沖縄', hokkaido: '北海道', japan: '日本',
  'chuo-ku': '中央区', 'kita-ku': '北区', 'higashi-ku': '東区', 'shiroishi-ku': '白石区', 'toyohira-ku': '豊平区',
  'minami-ku': '南区', 'nishi-ku': '西区', 'atsubetsu-ku': '厚別区', 'teine-ku': '手稲区', 'kiyota-ku': '清田区',
  'shinjuku-ku': '新宿区', 'shibuya-ku': '渋谷区', 'minato-ku': '港区', 'chiyoda-ku': '千代田区',
  'taito-ku': '台東区', 'namba': '難波', susukino: '薄野',
};

/** English / romaji place names become Japanese; anything not in the table is returned unchanged (no 簡繁 conversion). */
export function normalizeAreaName(value) {
  const text = tidy(value);
  if (!text) return '';
  if (!/^[\x20-\x7e\u00c0-\u024f]+$/.test(text)) return text;
  const key = text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/-(city|shi|prefecture)$/, '')
    .replace(/^(.+?)-?(ku|ward)$/, '$1-ku');
  return AREA_NAMES[key] ?? AREA_NAMES[key.replace(/-/g, '')] ?? text;
}

// Municipality type of the cities the project knows (the suffix a full name carries).
const CITY_KIND = {
  札幌: '市', 小樽: '市', 旭川: '市', 函館: '市', 富良野: '市', 千歳: '市', 釧路: '市', 帯広: '市', 北見: '市',
  網走: '市', 室蘭: '市', 苫小牧: '市', 登別: '市', 稚内: '市', 江別: '市', 恵庭: '市', 北広島: '市',
  美瑛: '町', 余市: '町', 積丹: '町',
};

/** "札幌" / "札幌市" / "Sapporo" -> "札幌市". Unknown names are returned as typed. */
export function normalizeCityName(value) {
  const name = normalizeAreaName(value);
  const base = /^(.+)[市町]$/.exec(name)?.[1] ?? name;
  const kind = CITY_KIND[base];
  return kind ? `${base}${kind}` : name;
}

const WARD_PREFIX = /^([一-鿿々ヶぁ-んァ-ヴー]{1,6}?[区區])/;
// Street addresses (番地, 条, 丁目, any digit) and street names (通り, 小路, 商店街 ...).
const STREET_RE = /[0-9０-９]|[条條]|丁目|番地|通り?$|小路|大通|筋$|横丁|商店街|アーケード|駅前|[一二三四五六七八九十]+丁/;

/**
 * An administrative district (ward 区, town 町, village 村) or ''. A ward at the start of a longer address
 * ("中央区北1条西3丁目") gives just the ward; street addresses, street names and neighbourhoods
 * (狸小路, 色内, 薄野) give ''. Dropped text is not kept here.
 */
export function cleanDistrict(value, city = '') {
  const text = normalizeAreaName(value);
  if (!text) return '';
  const ward = WARD_PREFIX.exec(text);
  if (ward) return ward[1];
  if (STREET_RE.test(text)) return '';
  if (!/[町村]$/.test(text)) return '';
  const cityBase = normalizeAreaName(city).replace(/[市町村]$/, '');
  return cityBase && text.replace(/[町村]$/, '') === cityBase ? '' : text;
}
