import test from 'node:test';
import assert from 'node:assert/strict';
import { distanceMeters, findDuplicate, sameShop, shopNameKey, sourceKey } from './savedDedupe.js';
import { runIngest } from './savedIngest.js';

test('link level: tracking parameters, www, threads.com / threads.net and trailing slash do not matter', () => {
  const same = [
    'https://www.instagram.com/p/abc/?igsh=1&utm_source=ig',
    'https://instagram.com/p/abc',
    'https://www.instagram.com/p/abc/?igshid=zz&fbclid=1&xmt=2&si=3#top',
    'HTTPS://WWW.INSTAGRAM.COM/p/abc/',
  ];
  assert.equal(new Set(same.map(sourceKey)).size, 1);
  assert.equal(sourceKey('https://www.threads.net/@u/post/XYZ?xmt=1'), sourceKey('https://threads.com/@u/post/XYZ/'));
  assert.notEqual(sourceKey('https://www.instagram.com/p/abc'), sourceKey('https://www.instagram.com/p/abd'));
  assert.equal(sourceKey(''), '');
  assert.equal(sourceKey('javascript:1'), '');
  assert.equal(findDuplicate({ source_url: 'https://instagram.com/p/abc?igsh=1' }, [{ source_url: 'https://www.instagram.com/p/abc/' }]).by, 'link');
});

test('link level: a short link is expanded with the safe fetcher; a failure keeps the original', async () => {
  const hops = [];
  const fetchImpl = async (url) => {
    hops.push(String(url));
    if (String(url).includes('/share/')) return new Response(null, { status: 302, headers: { location: 'https://www.instagram.com/p/REAL/?igsh=9' } });
    return new Response('<html><title>x</title></html>', { status: 200, headers: { 'content-type': 'text/html' } });
  };
  const out = await runIngest({ url: 'https://www.instagram.com/share/AbC', text: '店', fetchImpl });
  assert.equal(out.sourceUrl, 'https://www.instagram.com/p/REAL');
  assert.equal(sourceKey(out.sourceUrl), sourceKey('https://instagram.com/p/real/'.replace('real', 'REAL')));
  assert.equal(hops.length, 2);

  const down = await runIngest({ url: 'https://www.instagram.com/share/AbC', text: '店', fetchImpl: async () => { throw new Error('down'); } });
  assert.equal(down.sourceUrl, 'https://www.instagram.com/share/AbC');
  // a redirect to a host outside the allow-list is never followed; the original stays
  const evil = await runIngest({ url: 'https://www.instagram.com/share/x', text: '店', fetchImpl: async () => new Response(null, { status: 302, headers: { location: 'https://evil.test/p/1' } }) });
  assert.equal(evil.sourceUrl, 'https://www.instagram.com/share/x');
});

const shop = (over) => ({ name: 'すみれ 札幌本店', lat: 43.0553, lng: 141.3412, address: '', ...over });

test('shop level: same name and close -> same; same name but far -> not; different name but close -> not', () => {
  assert.ok(distanceMeters({ lat: 43.0553, lng: 141.3412 }, { lat: 43.0553, lng: 141.3425 }) > 90, 'sanity: about 105 m');
  assert.equal(sameShop(shop(), shop({ lat: 43.0556 })), true, '~33 m');
  assert.equal(sameShop(shop(), shop({ lat: 43.0553, lng: 141.3425 })), false, '~105 m');
  assert.equal(sameShop(shop(), shop({ lat: 43.2, lng: 141.5 })), false, 'same name, far away');
  assert.equal(sameShop(shop(), shop({ name: '白樺山荘', lat: 43.0554 })), false, 'different name, close');
});

test('shop level: names compare without category word, spaces, case and width', () => {
  assert.equal(shopNameKey('味の時計台 拉麵'), shopNameKey('味の時計台'));
  assert.equal(shopNameKey('ＳＵＭＩＲＥ ラーメン'), shopNameKey('sumire'));
  assert.equal(sameShop(shop({ name: 'すみれ　札幌本店' }), shop({ name: 'すみれ札幌本店', lat: 43.0554 })), true);
  assert.equal(shopNameKey('麺屋 彩未'), '麺屋彩未');
});

test('shop level: same address also counts; no position and no address never merges; unnamed never merges', () => {
  const a = shop({ lat: null, lng: null, address: '北1条西3丁目, 中央区, 札幌市' });
  assert.equal(sameShop(a, shop({ lat: 43.5, lng: 141.5, address: '北1条西3丁目,中央区,札幌市' })), true);
  assert.equal(sameShop(shop({ lat: null, lng: null }), shop({ lat: null, lng: null })), false);
  assert.equal(sameShop(shop({ name: '（未命名）' }), shop({ name: '（未命名）' })), false);
});
