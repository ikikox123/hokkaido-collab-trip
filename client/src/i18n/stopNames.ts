import type { Locale } from './messages.ts';

/**
 * Display-only names for stops already stored on the trip.
 * Keys are the exact stored title. No trim, no case folding.
 * zh-Hant always returns the stored string. A miss returns it too.
 * This table is never written back to state.json.
 */
export type StopDisplayName = {
  ja: string;
  en: string;
};

export const STOP_DISPLAY_NAMES: Record<string, StopDisplayName> = {
  '新千歲機場 CTS 抵達': { ja: '新千歳空港 CTS 到着', en: 'New Chitose Airport CTS arrival' },
  '3coins車站地下街': { ja: '3COINS 札幌アピア店', en: '3COINS Sapporo Apia' },
  '41PIECES SAPPORO': { ja: '41 PIECES Sapporo', en: '41 PIECES Sapporo' },
  'JR 札幌駅': { ja: '札幌駅', en: 'Sapporo Station' },
  '狸小路商店街': { ja: '狸小路商店街', en: 'Tanukikoji Shopping Street' },
  'すすきの晚餐': { ja: 'すすきの（夕食）', en: 'Dinner in Susukino' },
  'uniqlo札幌三越店': { ja: 'ユニクロ 札幌三越店', en: 'UNIQLO Sapporo Mitsukoshi' },
  'MEGA 唐吉訶德': { ja: 'MEGAドン・キホーテ', en: 'MEGA Don Quijote' },
  '札幌時計台': { ja: '札幌市時計台', en: 'Sapporo Clock Tower' },
  '諏訪神社': { ja: '札幌諏訪神社', en: 'Sapporo Suwa Shrine' },
  '北海道神宮': { ja: '北海道神宮', en: 'Hokkaido Jingu' },
  '北海道大學': { ja: '北海道大学', en: 'Hokkaido University' },
  '白い恋人パーク': { ja: '白い恋人パーク', en: 'Shiroi Koibito Park' },
  '大丸／寶可夢中心': { ja: '大丸札幌店／ポケモンセンターサッポロ', en: 'Daimaru Sapporo / Pokémon Center Sapporo' },
  '湯咖哩 奧芝商店': { ja: 'スープカレー 奥芝商店 駅前創成寺', en: 'Soup Curry Okushiba Shoten Soseiji' },
  'JRタワー夜景': { ja: 'JRタワー展望室 T38', en: 'JR Tower Observation Deck T38' },
  '旭山動物園': { ja: '旭山動物園', en: 'Asahiyama Zoo' },
  '白鬚瀑布': { ja: '白ひげの滝', en: 'Shirahige Falls' },
  '白金青池': { ja: '白金青い池', en: 'Shirogane Blue Pond' },
  '森林精靈露台': { ja: 'ニングルテラス', en: 'Ningle Terrace' },
  '朝里川溫泉滑雪': { ja: '朝里川温泉スキー場', en: 'Asarigawa Onsen Ski Resort' },
  '根室花丸': { ja: '回転寿司 根室花まる ココノススキノ店', en: 'Nemuro Hanamaru Cocono Susukino' },
  '小樽駅': { ja: '小樽駅', en: 'Otaru Station' },
  '三角市場': { ja: '三角市場', en: 'Sankaku Market' },
  '小樽運河': { ja: '小樽運河', en: 'Otaru Canal' },
  '音樂盒堂': { ja: '小樽オルゴール堂', en: 'Otaru Music Box Museum' },
  '六花亭 小樽店': { ja: '六花亭 小樽運河店', en: 'Rokkatei Otaru Canal' },
  'LeTAO 本店': { ja: 'ルタオ 本店', en: 'LeTAO Main Store' },
  '中島公園': { ja: '中島公園', en: 'Nakajima Park' },
  '居酒屋 瑠玖＆魚平': { ja: '海鮮居酒屋 瑠玖＆魚平', en: 'Rukku & Uohei' },
  '市區購物': { ja: '市内ショッピング', en: 'City shopping' },
  '北菓楼 札幌本館': { ja: '北菓楼 札幌本館', en: 'Kitakaro Sapporo Honkan' },
  '三大蟹食べ放題＆しゃぶしゃぶ食べ放題 HANNA ハンナ すすきの店': {
    ja: 'ビュッフェ ハンナ すすきの店',
    en: 'Buffet HANNA Susukino',
  },
  '新千歲機場 CTS': { ja: '新千歳空港 CTS', en: 'New Chitose Airport CTS' },
};

/** Visible stop name. The stored title is not rewritten. */
export function displayStopTitle(locale: Locale, title: string): string {
  if (locale === 'zh-Hant') return title;
  const row = STOP_DISPLAY_NAMES[title];
  if (!row) return title;
  return locale === 'ja' ? row.ja : row.en;
}
