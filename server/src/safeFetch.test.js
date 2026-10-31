import test from 'node:test';
import assert from 'node:assert/strict';
import { checkFetchUrl, fetchPage, isBlockedHostname, MAX_REDIRECTS } from './safeFetch.js';

const html = (body = '<html></html>', headers = {}) =>
  new Response(body, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', ...headers } });
const redirect = (location, status = 302) => new Response(null, { status, headers: { location } });

/** A fetch that answers from a script and records every URL asked for. */
function scripted(...responses) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    const next = responses.shift();
    return typeof next === 'function' ? next() : next;
  };
  return { fetchImpl, calls };
}

test('allow-listed https URLs pass', () => {
  for (const host of ['threads.net', 'www.threads.net', 'threads.com', 'www.threads.com', 'instagram.com', 'www.instagram.com']) {
    assert.equal(checkFetchUrl(`https://${host}/p/abc`).ok, true, host);
  }
});

test('refuses http, other hosts, ports, credentials, and look-alikes', () => {
  const cases = {
    'http://www.threads.net/p/1': 'scheme',
    'ftp://www.threads.net/': 'scheme',
    'https://example.com/': 'host_not_allowed',
    'https://threads.net.evil.com/': 'host_not_allowed',
    'https://evilthreads.net/': 'host_not_allowed',
    'https://www.threads.net:8443/': 'port',
    'https://user:pw@www.threads.net/': 'credentials',
    'not a url': 'invalid_url',
  };
  for (const [input, reason] of Object.entries(cases)) {
    const r = checkFetchUrl(input);
    assert.equal(r.ok, false, input);
    assert.equal(r.reason, reason, input);
  }
});

test('refuses internal and reserved addresses in every spelling', () => {
  for (const host of [
    '127.0.0.1', '10.0.0.5', '192.168.1.1', '172.16.0.1', '169.254.169.254', '0.0.0.0',
    '2130706433', '0x7f000001', '0177.0.0.1', '127.1', '[::1]', '[::ffff:127.0.0.1]', '[fd00::1]', '[2001:db8::1]',
    'localhost', 'LOCALHOST', 'foo.localhost', 'printer.local', 'db.internal',
  ]) {
    const r = checkFetchUrl(`https://${host}/`);
    assert.equal(r.ok, false, host);
    assert.equal(r.reason, 'blocked_host', host);
  }
  assert.equal(isBlockedHostname('www.threads.net'), false);
});

test('a refused URL is never requested', async () => {
  const { fetchImpl, calls } = scripted(html());
  for (const url of ['https://example.com/', 'http://www.threads.net/', 'https://127.0.0.1/', 'https://[::1]/']) {
    assert.equal((await fetchPage(url, { fetchImpl })).ok, false);
  }
  assert.equal(calls.length, 0);
});

test('fetches html manually with a user agent and no cookies', async () => {
  const { fetchImpl, calls } = scripted(html('<title>Hi</title>'));
  const r = await fetchPage('https://www.threads.net/@a/post/1', { fetchImpl });
  assert.equal(r.ok, true);
  assert.match(r.html, /Hi/);
  assert.equal(calls[0].init.redirect, 'manual');
  assert.match(calls[0].init.headers['User-Agent'], /hokkaido/);
  assert.equal(calls[0].init.headers.Cookie, undefined);
});

test('follows a redirect between allowed hosts and re-checks each hop', async () => {
  const { fetchImpl, calls } = scripted(redirect('https://www.instagram.com/p/x/'), html());
  const r = await fetchPage('https://instagram.com/p/x', { fetchImpl });
  assert.equal(r.ok, true);
  assert.equal(calls.length, 2);
  assert.equal(r.finalUrl, 'https://www.instagram.com/p/x/');
});

test('relative redirects resolve against the current URL', async () => {
  const { fetchImpl, calls } = scripted(redirect('/p/final'), html());
  assert.equal((await fetchPage('https://www.instagram.com/p/start', { fetchImpl })).ok, true);
  assert.equal(calls[1].url, 'https://www.instagram.com/p/final');
});

test('a redirect to a non-allowed host, http, or an internal address is blocked without a second request', async () => {
  for (const target of [
    'https://evil.example.com/', 'http://www.threads.net/', 'https://169.254.169.254/latest/meta-data/',
    'https://[::1]/', 'https://localhost/', 'https://2130706433/', 'https://www.threads.net:444/',
  ]) {
    const { fetchImpl, calls } = scripted(redirect(target), html('SECRET'));
    const r = await fetchPage('https://www.threads.net/p/1', { fetchImpl });
    assert.equal(r.ok, false, target);
    assert.match(r.reason, /^redirect_/, target);
    assert.equal(calls.length, 1, target);
  }
});

test('too many redirects stop the chain', async () => {
  const hops = Array.from({ length: MAX_REDIRECTS + 2 }, () => redirect('https://www.threads.net/loop'));
  const { fetchImpl, calls } = scripted(...hops);
  const r = await fetchPage('https://www.threads.net/start', { fetchImpl });
  assert.deepEqual([r.ok, r.reason], [false, 'too_many_redirects']);
  assert.equal(calls.length, MAX_REDIRECTS + 1);
});

test('exactly MAX_REDIRECTS redirects still succeed', async () => {
  const hops = [...Array.from({ length: MAX_REDIRECTS }, () => redirect('https://www.threads.net/next')), html()];
  const { fetchImpl } = scripted(...hops);
  assert.equal((await fetchPage('https://www.threads.net/start', { fetchImpl })).ok, true);
});

test('only text/html is read', async () => {
  for (const type of ['application/json', 'image/png', 'application/octet-stream']) {
    const { fetchImpl } = scripted(new Response('{}', { status: 200, headers: { 'content-type': type } }));
    assert.equal((await fetchPage('https://www.threads.net/p/1', { fetchImpl })).reason, 'not_html', type);
  }
});

test('error statuses are reported, not parsed', async () => {
  const { fetchImpl } = scripted(new Response('login', { status: 403, headers: { 'content-type': 'text/html' } }));
  assert.equal((await fetchPage('https://www.threads.net/p/1', { fetchImpl })).reason, 'http_status');
});

test('a huge body is cut at the cap and flagged', async () => {
  const chunk = new Uint8Array(64 * 1024).fill(97);
  let sent = 0;
  const body = new ReadableStream({
    pull(controller) {
      sent += chunk.length;
      controller.enqueue(chunk); // never ends
    },
  });
  const { fetchImpl } = scripted(new Response(body, { status: 200, headers: { 'content-type': 'text/html' } }));
  const r = await fetchPage('https://www.threads.net/p/1', { fetchImpl, maxBytes: 200 * 1024 });
  assert.equal(r.ok, true);
  assert.equal(r.truncated, true);
  assert.equal(r.html.length, 200 * 1024);
  assert.ok(sent < 1024 * 1024, `stopped reading early (${sent})`);
});

test('the default cap is 1 MB', async () => {
  const big = 'x'.repeat(1024 * 1024 + 500);
  const { fetchImpl } = scripted(html(big));
  const r = await fetchPage('https://www.threads.net/p/1', { fetchImpl });
  assert.equal(r.html.length, 1024 * 1024);
  assert.equal(r.truncated, true);
});

test('a slow server times out', async () => {
  const fetchImpl = (url, { signal }) =>
    new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason)));
  const keepAlive = setTimeout(() => {}, 1000); // AbortSignal.timeout timers do not hold the loop open
  const r = await fetchPage('https://www.threads.net/p/1', { fetchImpl, timeoutMs: 30 });
  clearTimeout(keepAlive);
  assert.deepEqual([r.ok, r.reason], [false, 'timeout']);
});

test('network errors become a reason, never a throw', async () => {
  const r = await fetchPage('https://www.threads.net/p/1', { fetchImpl: async () => { throw new Error('boom'); } });
  assert.deepEqual([r.ok, r.reason], [false, 'network']);
});
