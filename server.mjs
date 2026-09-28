import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number(process.env.PORT || 3000);

const ALLOWED_HOSTS = new Set([
  'www.nseindia.com',
  'nseindia.com',
  'query1.finance.yahoo.com',
  'query2.finance.yahoo.com',
  'news.google.com',
  'economictimes.indiatimes.com',
  'www.business-standard.com',
  'business-standard.com',
  'www.thehindubusinessline.com',
  'thehindubusinessline.com',
  'www.livemint.com',
  'livemint.com',
  'api.rss2json.com'
]);

const USER_AGENT = 'Mozilla/5.0 (Windows NT 11.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.6998.166 Safari/537.36';
const cookies = new Map();
let lastPrime = 0;
let primePromise = null;
let lastNseDiagnostic = { status: null, url: null, at: null, note: 'not requested yet' };
const responseCache = new Map();

function symbolFromUrl(url) {
  try {
    const u = new URL(url);
    return u.searchParams.get('symbol') || 'TCS';
  } catch {
    return 'TCS';
  }
}

function cookieHeader() {
  return [...cookies.entries()].map(([k,v]) => `${k}=${v}`).join('; ');
}

function headersFor(url, isNse = false, navigation = false) {
  if (!isNse) {
    return {
      'User-Agent': USER_AGENT,
      'Accept': 'application/json,text/plain,text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-GB,en-US;q=0.9,en;q=0.8',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache',
      'Referer': url
    };
  }

  const symbol = symbolFromUrl(url);
  const h = navigation ? {
    'User-Agent': USER_AGENT,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'en-GB,en-US;q=0.9,en;q=0.8',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
    'Sec-CH-UA': '"Google Chrome";v="134", "Chromium";v="134", "Not?A_Brand";v="99"',
    'Sec-CH-UA-Mobile': '?0',
    'Sec-CH-UA-Platform': '"Windows"',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1',
    'DNT': '1'
  } : {
    'User-Agent': USER_AGENT,
    'Accept': 'application/json,text/plain,*/*',
    'Accept-Language': 'en-GB,en-US;q=0.9,en;q=0.8',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
    'Referer': `https://www.nseindia.com/get-quotes/equity?symbol=${encodeURIComponent(symbol)}`,
    'X-Requested-With': 'XMLHttpRequest',
    'Sec-CH-UA': '"Google Chrome";v="134", "Chromium";v="134", "Not?A_Brand";v="99"',
    'Sec-CH-UA-Mobile': '?0',
    'Sec-CH-UA-Platform': '"Windows"',
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'same-origin',
    'DNT': '1'
  };
  const cookie = cookieHeader();
  if (cookie) h.Cookie = cookie;
  return h;
}

function splitSetCookie(header) {
  if (!header) return [];
  return header.split(/,(?=\s*[^;,=]+=[^;,]+)/g);
}

function absorbCookies(res) {
  let list = [];
  if (typeof res.headers.getSetCookie === 'function') list = res.headers.getSetCookie();
  else list = splitSetCookie(res.headers.get('set-cookie'));
  for (const raw of list) {
    const first = raw.split(';', 1)[0];
    const i = first.indexOf('=');
    if (i > 0) cookies.set(first.slice(0, i).trim(), first.slice(i + 1).trim());
  }
}

async function primeNse(force = false, symbol = 'TCS') {
  const now = Date.now();
  if (!force && now - lastPrime < 8 * 60 * 1000 && cookies.size) return;
  if (primePromise && !force) return primePromise;
  primePromise = (async () => {
    try {
      if (force) cookies.clear();

      const home = await fetch('https://www.nseindia.com/', {
        headers: headersFor('https://www.nseindia.com/', true, true),
        redirect: 'follow',
        signal: AbortSignal.timeout(15000)
      });
      absorbCookies(home);
      await home.arrayBuffer();

      const pageUrl = `https://www.nseindia.com/get-quotes/equity?symbol=${encodeURIComponent(symbol || 'TCS')}`;
      const page = await fetch(pageUrl, {
        headers: headersFor(pageUrl, true, true),
        redirect: 'follow',
        signal: AbortSignal.timeout(15000)
      });
      absorbCookies(page);
      await page.arrayBuffer();

      if (home.ok || page.ok) lastPrime = Date.now();
    } catch (err) {
      lastPrime = 0;
      console.warn('[Market360] NSE prime failed:', err.message);
    } finally {
      primePromise = null;
    }
  })();
  return primePromise;
}

async function fetchRemote(targetUrl) {
  const cacheKey = targetUrl;
  const cached = responseCache.get(cacheKey);
  if (cached && cached.expires > Date.now()) return { res: cached.res, body: cached.body };

  let parsed;
  try { parsed = new URL(targetUrl); } catch { throw new Error('Invalid target URL'); }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Only http/https URLs are allowed');
  if (!ALLOWED_HOSTS.has(parsed.hostname.toLowerCase())) throw new Error(`Host not allowed: ${parsed.hostname}`);

  const isNse = parsed.hostname.toLowerCase().endsWith('nseindia.com');
  if (isNse) await primeNse(false, parsed.searchParams.get('symbol') || 'TCS');

  const request = async () => {
    const res = await fetch(parsed, {
      headers: headersFor(parsed.href, isNse, false),
      redirect: 'follow',
      signal: AbortSignal.timeout(20000)
    });
    absorbCookies(res);
    const body = Buffer.from(await res.arrayBuffer());
    return { res, body };
  };

  let out = await request();
  if (isNse && [401, 403, 429].includes(out.res.status)) {
    await primeNse(true, parsed.searchParams.get('symbol') || 'TCS');
    out = await request();
  }
  if (isNse) {
    lastNseDiagnostic = {
      status: out.res.status,
      url: parsed.pathname + parsed.search,
      at: new Date().toISOString(),
      note: out.res.ok ? 'ok' : 'upstream rejected request'
    };
  }
  if (isNse && out.res.ok) {
    const h = new Headers(out.res.headers);
    responseCache.set(cacheKey, {
      expires: Date.now() + 8000,
      res: new Response(null, { status: out.res.status, statusText: out.res.statusText, headers: h }),
      body: out.body
    });
  }
  return out;
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon'
};

function json(res, status, value) {
  const body = Buffer.from(JSON.stringify(value));
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*'
  });
  res.end(body);
}

async function serveStatic(pathname, res) {
  let rel = pathname === '/' ? '/index.html' : pathname;
  rel = normalize(rel).replace(/^(\.\.[/\\])+/, '');
  const file = join(__dirname, rel);
  if (!file.startsWith(__dirname)) return json(res, 403, { error: 'Forbidden' });
  try {
    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': MIME[extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': body.length,
      'Cache-Control': pathname === '/' || pathname.endsWith('.html') ? 'no-store' : 'public, max-age=300'
    });
    res.end(body);
  } catch {
    json(res, 404, { error: 'Not found' });
  }
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': '*'
      });
      return res.end();
    }

    if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' });
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    if (url.pathname === '/health') {
      return json(res, 200, {
        ok: true,
        service: 'Market360 Codespaces gateway',
        port: PORT,
        nseCookieCount: cookies.size,
        nseSessionAgeSeconds: lastPrime ? Math.round((Date.now()-lastPrime)/1000) : null,
        lastNseDiagnostic,
        uptimeSeconds: Math.round(process.uptime())
      });
    }

    if (url.pathname === '/proxy') {
      const target = url.searchParams.get('url');
      if (!target) return json(res, 400, { error: 'Missing url parameter' });
      try {
        const { res: upstream, body } = await fetchRemote(target);
        res.writeHead(upstream.status, {
          'Content-Type': upstream.headers.get('content-type') || 'application/octet-stream',
          'Content-Length': body.length,
          'Cache-Control': 'no-store',
          'Access-Control-Allow-Origin': '*'
        });
        return res.end(body);
      } catch (err) {
        return json(res, 502, { error: err.name || 'ProxyError', message: err.message });
      }
    }

    return serveStatic(url.pathname, res);
  } catch (err) {
    console.error('[Market360]', err);
    return json(res, 500, { error: 'Internal error', message: err.message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Market360 running on http://${HOST}:${PORT}`);
  console.log('In GitHub Codespaces, open the forwarded port 3000.');
});
