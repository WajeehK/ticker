/* Ticker v2 */
const BUILD = 't18';
const TABS = ['home', 'markets', 'watch', 'port', 'alerts'];
const TAB_HASH = { home: '#/', markets: '#/markets', watch: '#/watch', port: '#/portfolio', alerts: '#/alerts' };
const DEFAULT_WATCH = ['USAR', 'MP', 'BTC-USD', 'ETH-USD', 'SOL-USD', 'AAPL', 'NVDA', 'TSLA', 'SPY', 'VUSA.L'];
const INDICES = ['^GSPC', '^IXIC', '^DJI', '^FTSE'];
const COMMODITIES = {
  'GC=F': { name: 'Gold', short: 'Gold', unit: 'USD/oz' },
  'SI=F': { name: 'Silver', short: 'Silver', unit: 'USD/oz' },
  'CL=F': { name: 'Crude oil (WTI)', short: 'WTI', unit: 'USD/bbl' },
  'BZ=F': { name: 'Brent crude', short: 'Brent', unit: 'USD/bbl' },
  'NG=F': { name: 'Natural gas', short: 'Nat gas', unit: 'USD/MMBtu' },
  'HG=F': { name: 'Copper', short: 'Copper', unit: 'USD/lb' },
  'PL=F': { name: 'Platinum', short: 'Platinum', unit: 'USD/oz' },
  'PA=F': { name: 'Palladium', short: 'Palladium', unit: 'USD/oz' }
};
const COMMODITY_IDS = Object.keys(COMMODITIES);
const MARKET_PANES = ['stocks', 'crypto', 'commodities', 'etfs'];

const IH = 'https://wajeehk.github.io/congress-trades/';
const KREST = 'https://api.kraken.com/0/public';
const KWS = 'wss://ws.kraken.com/v2';
const RMQ = window.matchMedia ? matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };

const COIN_NAMES = {
  BTC: 'Bitcoin', ETH: 'Ethereum', SOL: 'Solana', XRP: 'XRP', ADA: 'Cardano',
  DOGE: 'Dogecoin', AVAX: 'Avalanche', DOT: 'Polkadot', LINK: 'Chainlink',
  LTC: 'Litecoin', BCH: 'Bitcoin Cash', UNI: 'Uniswap', ATOM: 'Cosmos',
  AAVE: 'Aave', XLM: 'Stellar', NEAR: 'NEAR', APT: 'Aptos', SUI: 'Sui',
  TRX: 'TRON', SHIB: 'Shiba Inu', PEPE: 'Pepe', FIL: 'Filecoin', ARB: 'Arbitrum',
  OP: 'Optimism', POL: 'Polygon', MATIC: 'Polygon', TON: 'Toncoin',
  XMR: 'Monero', ETC: 'Ethereum Classic', ALGO: 'Algorand', ICP: 'Internet Computer',
  RENDER: 'Render', FET: 'Fetch.ai', INJ: 'Injective', SEI: 'Sei', TIA: 'Celestia',
  WIF: 'dogwifhat', BONK: 'Bonk', FLOKI: 'Floki', HBAR: 'Hedera', XTZ: 'Tezos',
  TAO: 'Bittensor', JUP: 'Jupiter', PYTH: 'Pyth', WLD: 'Worldcoin', ENA: 'Ethena'
};

const $ = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const store = {
  get(k, d) { try { const v = JSON.parse(localStorage.getItem('ticker.' + k)); return v == null ? d : v; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('ticker.' + k, JSON.stringify(v)); } catch {} }
};
const vib = n => { if (navigator.vibrate && navigator.userActivation && navigator.userActivation.hasBeenActive) try { navigator.vibrate(n); } catch {} };

function safeHTML(fn) { try { return fn() || ''; } catch (err) { console.warn('section failed', err); return ''; } }
async function fetchWithTimeout(url, opts, ms) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms || 8000);
  try { return await fetch(url, Object.assign({}, opts || {}, { signal: ctl.signal })); }
  finally { clearTimeout(t); }
}

let quotes = {}, logos = {}, news = null, analysis = null, aiAnalysis = null, marketCaps = {}, newsTextIndex = null, histFetchedAt = {};
let meta = { generated_at: null, delay: '', source: '', fx: {}, stockOk: false, stockErr: null };
let pairs = {};
let watchlists = [], activeWatch = 'default';
let holdings = [], alerts = [], snapshots = [];
let ccy = 'GBP';
let tab = 'home', detailId = null, compareId = null;
let chartApi = null, volApi = null, pvApi = null;
let chartKind = 'line', chartInd = 'off', chartRange = '1D', portRange = '1D';
let watchFilter = 'all', watchSort = 'change', marketsPane = 'stocks';
let marketsList = 'mcap', marketsShowAll = false;
let cryptoMarkets = { coins: [], trending: [], newListings: [], asOf: null };
let volumes = {};
let sentiment = null;
let ipos = { upcoming: [], priced: [], filed: [], withdrawn: [], counts: {}, asOf: null };
let ws = null, wsRetry = 0, wsTimer = 0, pollTimer = 0;
let lastFlash = {}, lastHero = null, readerItem = null, fsChartApi = null, newsIndex = {};
let ptr = null;
let instruments = { items: [], byId: {}, asOf: null };
let movers3m = { items: [], asOf: null };
let listState = null;
let quoteFails = {};
const TAB_TITLE = { home: 'Home', markets: 'Markets', watch: 'Watchlist', port: 'Portfolio', alerts: 'Alerts' };

function isCommodityId(id, q) {
  q = q || (id && quotes[id]) || {};
  return q.kind === 'commodity' || (id != null && String(id).endsWith('=F')) || !!COMMODITIES[id];
}
function kindOf(id, q) {
  if (q && q.kind) return q.kind;
  if (isCryptoId(id)) return 'crypto';
  if (isCommodityId(id, q)) return 'commodity';
  return 'equity';
}
function isCryptoId(id) {
  const q = quotes[id];
  if (q) return q.kind === 'crypto';
  return (id.includes('-USD') && !id.includes('.'));
}
function coin(id) { return id.endsWith('-USD') ? id.slice(0, -4) : id; }
function watchSyms() {
  const l = watchlists.find(x => x.id === activeWatch) || watchlists[0];
  return (l && l.symbols) || [];
}

function fxRate(from, to) {
  from = from === 'GBp' ? 'GBP' : from;
  to = to === 'GBp' ? 'GBP' : to;
  if (!from || !to || from === to) return 1;
  const g = meta.fx && meta.fx.GBPUSD;
  const e = meta.fx && meta.fx.EURUSD;
  const toUSD = { USD: 1, GBP: g, EUR: e };
  const a = toUSD[from], b = toUSD[to];
  if (!a || !b) return null;
  return a / b;
}
function convert(amount, from, to) {
  if (amount == null || !isFinite(amount)) return null;
  const r = fxRate(from || 'USD', to || ccy);
  return r == null ? null : amount * r;
}
function fmtNum(n, cur, opts={}) {
  if (n == null || !isFinite(n)) return '—';
  cur = cur === 'GBp' ? 'GBP' : (cur || ccy);
  const abs = Math.abs(n);
  let max = 2;
  if (opts.px) {
    if (abs < 0.0001) max = 8;
    else if (abs < 0.01) max = 6;
    else if (abs < 1) max = 4;
    else max = 2;
  }
  if (opts.max != null) max = opts.max;
  try {
    const loc = cur === 'USD' ? 'en-US' : 'en-GB';
    return new Intl.NumberFormat(loc, { style: 'currency', currency: cur, maximumFractionDigits: max, minimumFractionDigits: Math.min(2, max) }).format(n);
  } catch (e) {
    const s = { USD: '$', GBP: '£', EUR: '€' }[cur] || (cur + ' ');
    return s + n.toFixed(max);
  }
}
function money(n, native, opts={}) {
  if (opts.native) return fmtNum(n, native || 'USD', opts);
  const v = convert(n, native || 'USD', ccy);
  if (v == null) return fmtNum(n, native || 'USD', opts);
  return fmtNum(v, ccy, opts);
}
function isYieldId(id, q) {
  q = q || (id && quotes[id]) || {};
  return q.kind === 'yield' || id === '^TNX' || id === '^IRX';
}
function isIndexId(id, q) {
  q = q || (id && quotes[id]) || {};
  if (isYieldId(id, q)) return false;
  return q.kind === 'index' || (id != null && String(id).startsWith('^'));
}
function fmtPoints(n, opts={}) {
  if (n == null || !isFinite(n)) return '—';
  const max = opts.max != null ? opts.max : 2;
  const body = new Intl.NumberFormat('en-GB', { maximumFractionDigits: max, minimumFractionDigits: Math.min(2, max) }).format(n);
  return (opts.signed && n > 0 ? '+' : '') + body;
}
/* Price/level for a known asset. Indices are points: no currency symbol, no FX conversion. */
function pxText(id, n, opts={}) {
  const q = quotes[id] || {};
  if (isYieldId(id, q)) return fmtPoints(n, opts) + '%';
  if (isIndexId(id, q)) return fmtPoints(n, opts);
  if (isCommodityId(id, q)) {
    const unit = q.unit || (COMMODITIES[id] && COMMODITIES[id].unit) || 'USD';
    const body = fmtNum(n, 'USD', opts);
    const suffix = unit.replace(/^USD\s*/, '').replace(/^USD/, '');
    return suffix ? body + suffix : body;
  }
  return money(n, opts.currency || q.currency || 'USD', opts);
}
function pct(n) {
  if (n == null || !isFinite(n)) return '—';
  return (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
}
function chgClass(n) { return n > 0 ? 'up' : n < 0 ? 'dn' : 'flat'; }
function themeColor() {
  const v = getComputedStyle(document.body).getPropertyValue('--accent').trim();
  return v || '#00C805';
}
function withAlpha(hex, a) {
  hex = (hex || '#00C805').trim();
  if (hex.startsWith('rgb')) return hex;
  const h = hex.replace('#','');
  const n = h.length === 3 ? h.split('').map(c => c+c).join('') : h;
  const r = parseInt(n.slice(0,2),16), g = parseInt(n.slice(2,4),16), b = parseInt(n.slice(4,6),16);
  return 'rgba('+r+','+g+','+b+','+a+')';
}
function applyDayTheme(up) {
  const isUp = up !== false && up !== 0;
  document.body.classList.toggle('up-day', isUp);
  document.body.classList.toggle('dn-day', !isUp);
}
function holdingAvg(id) {
  const held = holdings.filter(h => h.id === id);
  const qty = held.reduce((s, h) => s + (h.qty || 0), 0);
  const cost = held.reduce((s, h) => s + ((h.avg != null && h.qty) ? h.avg * h.qty : 0), 0);
  if (!qty || !held.some(h => h.avg != null)) return null;
  return cost / qty;
}
function fmtChartTime(t) {
  if (!t) return '';
  const d = new Date((t < 1e12 ? t * 1000 : t));
  const opts = (portRange === '1D' || chartRange === '1D')
    ? { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Europe/London' }
    : { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/London' };
  return d.toLocaleString('en-GB', opts);
}

function initials(name, id) {
  if (id && String(id).endsWith('-USD')) return coin(id).slice(0, 4);
  if (id && String(id).startsWith('^')) return String(id).slice(1, 5);
  if (id && !String(id).includes('-USD')) {
    return String(id).replace(/\.L$/, '').replace(/=X$/, '').replace(/=F$/, '').slice(0, 4).toUpperCase();
  }
  return String(name || id || '?').slice(0, 2).toUpperCase();
}
function toUSD(amount, native) { return convert(amount, native, 'USD'); }

function logoRec(id) {
  return logos[id] || logos[coin(id) + '-USD'] || null;
}
function avHTML(id, name, kind, extra) {
  const L = logoRec(id);
  const k = kind || kindOf(id, quotes[id]);
  const chip = (L && L.chip !== false && k !== 'crypto') || (L && L.chip);
  const kindCls = (k === 'crypto' || k === 'etf' || k === 'commodity' || k === 'index' || k === 'fx') ? k : '';
  const dark = !!(L && L.dark);
  const cls = ['av', extra || '', kindCls, chip ? 'chip' : '', dark ? 'dark' : ''].filter(Boolean).join(' ');
  if (L && L.src) return '<div class="' + cls + '"><img src="' + esc(L.src) + '" alt="" onerror="window.__avErr&&__avErr(this)" data-ph="' + esc(initials(name, id)) + '"></div>';
  return '<div class="' + cls + ' ph">' + esc(initials(name, id)) + '</div>';
}


window.__avErr = function(img){
  const p = img.parentNode; if(!p) return;
  p.classList.add('ph');
  const t = img.getAttribute('data-ph') || '?';
  img.remove();
  p.textContent = t;
};

function sparkSVG(arr, up) {
  if (!arr || arr.length < 2) return '';
  const w = 64, h = 28, p = 1;
  const nums = arr.filter(x => x != null && isFinite(x));
  if (nums.length < 2) return '';
  const min = Math.min(...nums), max = Math.max(...nums), span = max - min || 1;
  const pts = nums.map((v, i) => {
    const x = p + (i / (nums.length - 1)) * (w - 2 * p);
    const y = (h - p) - ((v - min) / span) * (h - 2 * p);
    return x.toFixed(1) + ',' + y.toFixed(1);
  }).join(' ');
  const col = up ? 'var(--up)' : 'var(--dn)';
  return '<svg class="spark" viewBox="0 0 ' + w + ' ' + h + '" aria-hidden="true"><polyline fill="none" stroke="' + col + '" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" points="' + pts + '"/></svg>';
}
function when(ts) {
  if (!ts) return '';
  const d = new Date(ts * 1000);
  if (isNaN(d)) return '';
  return d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Europe/London' }) + ' UK';
}
function ago(iso) {
  if (!iso) return '';
  const t = typeof iso === 'number' ? (iso < 1e12 ? iso * 1000 : iso) : Date.parse(iso);
  if (!t) return String(iso);
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.round(s / 60) + ' min ago';
  if (s < 86400) return Math.round(s / 3600) + 'h ago';
  return new Date(t).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/London' }) + ' UK';
}

function loadUser() {
  const saved = store.get('ccy', null);
  ccy = (saved === 'USD' || saved === 'GBP') ? saved : 'GBP';
  let lists = store.get('watchlists', null);
  if (!lists || !lists.length) {
    const old = store.get('watch', null);
    const symbols = Array.isArray(old) ? old : DEFAULT_WATCH.slice();
    lists = [{ id: 'default', name: 'Watchlist', symbols: symbols }];
    store.set('watchlists', lists);
    store.set('seeded', true);
  }
  watchlists = lists;
  activeWatch = store.get('activeWatch', lists[0].id);
  if (!watchlists.find(l => l.id === activeWatch)) activeWatch = watchlists[0].id;
  holdings = store.get('holdings', []);
  alerts = store.get('alerts', []);
  snapshots = store.get('snapshots', []);
  chartKind = store.get('chartKind', 'line');
  chartInd = store.get('chartInd', 'off');
}
function saveLists() { store.set('watchlists', watchlists); store.set('activeWatch', activeWatch); }
function persistHoldings() { store.set('holdings', holdings); }
function saveAlerts() { store.set('alerts', alerts); }
function paintCcy() {
  $$('#ccy button').forEach(b => b.classList.toggle('on', b.dataset.ccy === ccy));
}

function upsert(id, rec) { quotes[id] = Object.assign({}, quotes[id] || {}, rec, { id: id }); }

async function loadLogos() {
  try {
    const r = await fetch('img/manifest.json?t=' + Math.floor(Date.now() / 60_000));
    if (r.ok) logos = await r.json() || {};
  } catch (e) {}
}
async function loadVolumes() {
  try {
    const r = await fetch('data/volumes.json?t=' + Math.floor(Date.now() / 30_000), { cache: 'no-cache' });
    if (r.ok) volumes = await r.json() || {};
  } catch (e) {}
  for (const [id, v] of Object.entries(volumes || {})) {
    if (quotes[id] && quotes[id].volume == null) upsert(id, { volume: v });
  }
}
function applyCryptoMarkets() {
  for (const bag of ['coins', 'trending', 'newListings']) {
    for (const c of (cryptoMarkets && cryptoMarkets[bag]) || []) {
      if (!c || !c.ticker) continue;
      const id = c.ticker;
      const prev = quotes[id] || {};
      const keep = !!(prev.live || (prev.source === 'kraken' && prev.ok && prev.price != null));
      upsert(id, {
        symbol: c.symbol || coin(id),
        name: (prev.name && prev.name !== (c.symbol || coin(id))) ? prev.name : (c.name || prev.name || c.symbol),
        kind: 'crypto', currency: 'USD',
        price: keep ? prev.price : (c.price != null ? c.price : prev.price),
        changePct: keep && prev.changePct != null ? prev.changePct : (c.changePct != null ? c.changePct : prev.changePct),
        change: keep ? prev.change : prev.change,
        marketCap: c.marketCap != null ? c.marketCap : prev.marketCap,
        volume: c.volume != null ? c.volume : prev.volume,
        spark: (prev.spark && prev.spark.length >= 8) ? prev.spark : (c.spark || prev.spark || []),
        ok: keep || c.price != null,
        source: keep ? (prev.source || 'kraken') : (prev.source || 'coingecko'),
        live: !!prev.live,
        kraken: !!c.kraken
      });
      if (c.symbol && c.name) COIN_NAMES[c.symbol] = COIN_NAMES[c.symbol] || c.name;
    }
  }
}
async function loadCryptoMarkets() {
  try {
    const r = await fetch('data/crypto_markets.json?t=' + Math.floor(Date.now() / 30_000), { cache: 'no-cache' });
    if (r.ok) cryptoMarkets = Object.assign({ coins: [], trending: [], newListings: [] }, await r.json());
  } catch (e) {}
  applyCryptoMarkets();
}
async function loadSentiment() {
  try {
    const r = await fetch('data/market_sentiment.json?t=' + Math.floor(Date.now() / 30_000), { cache: 'no-cache' });
    if (r.ok) sentiment = await r.json();
  } catch (e) {}
}
async function loadIpos() {
  try {
    const r = await fetch('data/ipos.json?t=' + Math.floor(Date.now() / 30_000), { cache: 'no-cache' });
    if (r.ok) ipos = Object.assign({ upcoming: [], priced: [], filed: [], withdrawn: [], counts: {} }, await r.json());
  } catch (e) {}
}


async function loadNews() {
  try {
    const r = await fetch('data/news.json?t=' + Math.floor(Date.now() / 30_000), { cache: 'no-cache' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    news = await r.json();
  } catch (e) {
    if (!news) news = { error: e.message || String(e), market: [], bySymbol: {}, fng: null };
  }
}
async function loadAnalysis() {
  try {
    const r = await fetch('data/analysis.json?t=' + Math.floor(Date.now() / 30_000), { cache: 'no-cache' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    analysis = await r.json();
  } catch (e) {
    if (!analysis) analysis = { error: e && e.message, bySymbol: {} };
  }
}
async function loadAiAnalysis() {
  try {
    const r = await fetch('data/ai_analysis.json?t=' + Math.floor(Date.now() / 30_000), { cache: 'no-cache' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    aiAnalysis = await r.json();
  } catch (e) {
    if (!aiAnalysis) aiAnalysis = { error: e && e.message, bySymbol: {} };
  }
}


async function loadStocks() {
  try {
    const r = await fetch('data/quotes.json?t=' + Math.floor(Date.now() / 30_000), { cache: 'no-cache' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const d = await r.json();
    if (!d || !d.quotes) throw new Error('Malformed quotes file');
    meta.generated_at = d.generated_at;
    meta.delay = d.delay || '';
    meta.source = d.source || 'Yahoo Finance';
    meta.fx = d.fx || {};
    meta.stockOk = true;
    meta.stockErr = null;
    for (const [sym, q] of Object.entries(d.quotes)) {
      if (!q || !q.ok || q.price == null) continue;
      if (q.kind === 'fx') continue;
      const cur = quotes[sym];
      const incomingAsOf = asOfSec(q.asOf);
      if (cur && cur.price != null && asOfSec(cur.asOf) > incomingAsOf) continue;
      upsert(sym, {
        symbol: sym, name: q.name || q.shortName || sym, shortName: q.shortName,
        kind: q.kind || 'equity', exchange: q.exchange, currency: q.currency || 'USD',
        price: q.price, prev: q.prev, change: q.change, changePct: q.changePct,
        dayHigh: q.dayHigh, dayLow: q.dayLow, high52: q.high52, low52: q.low52,
        asOf: q.asOf, spark: q.spark || [], lastDiv: q.lastDiv || null, unit: q.unit,
        session: q.session || 'regular',
        regularClose: q.regularClose, regularTime: q.regularTime,
        regularChange: q.regularChange, regularChangePct: q.regularChangePct,
        volume: q.volume, marketCap: q.marketCap,
        ok: true, source: 'yahoo', live: false
      });
    }
  } catch (e) {
    meta.stockOk = false;
    meta.stockErr = e.message || String(e);
  }
}

async function loadPairs() {
  const cached = store.get('pairsAt', 0);
  const cache = store.get('pairs', null);
  if (cache && Date.now() - cached < 12 * 3600 * 1000) { pairs = cache; stampPairs(); return; }
  try {
    const r = await fetchWithTimeout(KREST + '/AssetPairs', { cache: 'no-cache' }, 8000);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const d = await r.json();
    if (d.error && d.error.length) throw new Error(d.error.join(', '));
    const out = {};
    for (const v of Object.values(d.result || {})) {
      const wsname = v.wsname || '';
      if (!wsname.endsWith('/USD')) continue;
      if (v.status && v.status !== 'online') continue;
      let code = wsname.split('/')[0];
      if (code === 'XBT') code = 'BTC';
      const id = code + '-USD';
      if (out[id] && code !== 'BTC') continue;
      out[id] = { id: id, alt: v.altname, ws: code === 'BTC' ? 'BTC/USD' : wsname, name: COIN_NAMES[code] || code, code: code };
    }
    if (out['BTC-USD']) out['BTC-USD'].ws = 'BTC/USD';
    pairs = out;
    store.set('pairs', out);
    store.set('pairsAt', Date.now());
  } catch (e) {
    if (!Object.keys(pairs).length) {
      pairs = {
        'BTC-USD': { id: 'BTC-USD', alt: 'XBTUSD', ws: 'BTC/USD', name: 'Bitcoin', code: 'BTC' },
        'ETH-USD': { id: 'ETH-USD', alt: 'ETHUSD', ws: 'ETH/USD', name: 'Ethereum', code: 'ETH' },
        'SOL-USD': { id: 'SOL-USD', alt: 'SOLUSD', ws: 'SOL/USD', name: 'Solana', code: 'SOL' }
      };
    }
  }
  stampPairs();
}
function stampPairs() {
  for (const p of Object.values(pairs)) {
    if (!quotes[p.id]) upsert(p.id, { symbol: p.code, name: p.name, kind: 'crypto', currency: 'USD', ok: false, source: 'kraken' });
    else upsert(p.id, { kind: 'crypto', name: quotes[p.id].name || p.name, symbol: p.code, currency: 'USD', source: quotes[p.id].source || 'kraken' });
  }
}

function neededCrypto() {
  const ids = new Set(['BTC-USD', 'ETH-USD', 'SOL-USD']);
  for (const l of watchlists) for (const id of l.symbols) if (isCryptoId(id) || pairs[id]) ids.add(id);
  for (const h of holdings) if (isCryptoId(h.id) || pairs[h.id]) ids.add(h.id);
  for (const a of alerts) if (isCryptoId(a.id) || pairs[a.id]) ids.add(a.id);
  if (detailId && (isCryptoId(detailId) || pairs[detailId])) ids.add(detailId);
  if (compareId && (isCryptoId(compareId) || pairs[compareId])) ids.add(compareId);
  for (const bag of ['coins', 'trending', 'newListings']) {
    for (const c of (cryptoMarkets && cryptoMarkets[bag]) || []) {
      if (c && c.kraken && c.ticker) ids.add(c.ticker);
    }
  }
  return [...ids].filter(id => pairs[id] || /USD$/.test(id));
}

async function loadCryptoOnce() {
  const ids = neededCrypto();
  const alts = ids.map(id => (pairs[id] && pairs[id].alt) || (coin(id) === 'BTC' ? 'XBTUSD' : coin(id) + 'USD'));
  if (!alts.length) return;
  try {
    const r = await fetchWithTimeout(KREST + '/Ticker?pair=' + encodeURIComponent(alts.join(',')), { cache: 'no-cache' }, 8000);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const d = await r.json();
    if (d.error && d.error.length) throw new Error(d.error.join(', '));
    const res = d.result || {};
    const num = (v, i) => {
      if (v == null) return null;
      if (Array.isArray(v)) { const x = parseFloat(v[i] != null ? v[i] : v[0]); return isFinite(x) ? x : null; }
      const x = parseFloat(v); return isFinite(x) ? x : null;
    };
    const matchRow = (id) => {
      const alt = (pairs[id] && pairs[id].alt) || '';
      const code = coin(id);
      const keys = Object.keys(res);
      const exact = keys.find(k => k === alt || k === code + 'USD' || k === (code === 'BTC' ? 'XBTUSD' : '') || k === 'X' + code + 'ZUSD' || (k === 'XXBTZUSD' && code === 'BTC'));
      if (exact) return res[exact];
      const hit = keys.filter(k => k.endsWith(code + 'USD') || (code === 'BTC' && (k.endsWith('XBTUSD') || k === 'XXBTZUSD')));
      return hit.length === 1 ? res[hit[0]] : null;
    };
    for (const id of ids) {
      const code = coin(id);
      const row = matchRow(id) || (Object.keys(res).length === 1 && ids.length === 1 ? Object.values(res)[0] : null);
      if (!row) continue;
      const last = num(row.c, 0);
      const open = num(row.o, 1) ?? num(row.o, 0);
      if (!isFinite(last)) continue;
      const change = open ? last - open : null;
      const changePct = change != null && open ? (change / open) * 100 : null;
      upsert(id, {
        symbol: code, name: (pairs[id] && pairs[id].name) || COIN_NAMES[code] || code,
        kind: 'crypto', currency: 'USD', exchange: 'Kraken',
        price: last, prev: open, change: change, changePct: changePct,
        dayHigh: num(row.h, 1) ?? num(row.h, 0),
        dayLow: num(row.l, 1) ?? num(row.l, 0),
        asOf: Math.floor(Date.now() / 1000), ok: true, source: 'kraken', live: false
      });
    }
    meta.cryptoOk = true; meta.cryptoErr = null;
  } catch (e) {
    meta.cryptoOk = false; meta.cryptoErr = e.message || String(e);
  }
}

async function loadCryptoSparks() {
  const ids = neededCrypto();
  await Promise.all(ids.map(async id => {
    try {
      const bars = await cryptoBars(id, '1Y');
      if (!bars || !bars.length) return;
      const vals = bars.map(b => b.value ?? b.c).filter(v => v != null);
      upsert(id, {
        spark: (quotes[id] && quotes[id].spark && quotes[id].spark.length >= 20) ? quotes[id].spark : vals.slice(-30),
        high52: Math.max(...vals), low52: Math.min(...vals)
      });
    } catch (e) {}
  }));
}

function connectWS() {
  const ids = neededCrypto();
  const symbols = ids.map(id => (pairs[id] && pairs[id].ws) || (coin(id) === 'BTC' ? 'BTC/USD' : coin(id) + '/USD'));
  if (!symbols.length) return;
  try { if (ws) { ws.onclose = null; ws.close(); } } catch (e) {}
  ws = new WebSocket(KWS);
  ws.onopen = () => {
    wsRetry = 0; setLive();
    ws.send(JSON.stringify({ method: 'subscribe', params: { channel: 'ticker', symbol: symbols, event_trigger: 'trades' } }));
  };
  ws.onmessage = ev => {
    let msg; try { msg = JSON.parse(ev.data); } catch (e) { return; }
    if (msg.channel !== 'ticker' || !msg.data) return;
    const rows = Array.isArray(msg.data) ? msg.data : [msg.data];
    let changed = false;
    for (const t of rows) {
      let sym = t.symbol || '';
      if (!sym) continue;
      let code = sym.split('/')[0];
      if (code === 'XBT') code = 'BTC';
      const id = code + '-USD';
      const last = parseFloat(t.last);
      if (!isFinite(last)) continue;
      const prevQ = quotes[id] || {};
      const changePct = t.change_pct != null ? parseFloat(t.change_pct) : prevQ.changePct;
      const change = t.change != null ? parseFloat(t.change) : prevQ.change;
      const old = prevQ.price;
      upsert(id, {
        symbol: code, name: prevQ.name || (pairs[id] && pairs[id].name) || COIN_NAMES[code] || code,
        kind: 'crypto', currency: 'USD', exchange: 'Kraken',
        price: last, change: change, changePct: changePct,
        dayHigh: t.high != null ? parseFloat(t.high) : prevQ.dayHigh,
        dayLow: t.low != null ? parseFloat(t.low) : prevQ.dayLow,
        prev: prevQ.prev, asOf: Math.floor(Date.now() / 1000),
        ok: true, source: 'kraken', live: true
      });
      if (old != null && old !== last) lastFlash[id] = last > old ? 'up' : 'dn';
      changed = true;
    }
    if (changed) { updatePrices(); checkAlerts(); }
  };
  ws.onclose = () => {
    ws = null; setLive();
    const wait = Math.min(15_000, 800 * Math.pow(1.7, wsRetry++));
    clearTimeout(wsTimer); wsTimer = setTimeout(connectWS, wait);
  };
  ws.onerror = () => { try { ws.close(); } catch (e) {} };
}

function setLive() {
  const el = $('#live'), txt = $('#liveTxt');
  if (!el) return;
  const live = ws && ws.readyState === 1;
  const stocks = meta.stockOk, crypto = meta.cryptoOk || live;
  el.classList.toggle('on', live || (stocks && crypto));
  el.classList.toggle('warn', !stocks && !crypto);
  txt.textContent = (!stocks && !crypto) ? 'Offline' : (live ? 'Live' : 'Quotes');
}

function rowHTML(id, opts) {
  opts = opts || {};
  const q = quotes[id] || {};
  const name = q.name || (pairs[id] && pairs[id].name) || COIN_NAMES[coin(id)] || id;
  const sym = q.symbol || (isCryptoId(id) ? coin(id) : id);
  const up = (q.changePct == null) ? true : q.changePct >= 0;
  const kind = kindOf(id, q);
  const tag = kind === 'crypto' ? 'Crypto' : kind === 'etf' ? 'ETF' : kind === 'index' ? 'Index' : (String(id).endsWith('.L') ? 'LSE' : '');
  const sparkVals = opts.sparkVals || q.spark;
  const sparkUp = opts.sparkUp != null ? !!opts.sparkUp : up;
  const spark = opts.spark !== false ? sparkSVG(sparkVals, sparkUp) : '';
  const cls = spark ? 'row with-spark' : 'row';
  const sub = opts.sub || ('<span>' + esc(sym) + '</span>' + (tag ? '<span class="tag">' + tag + '</span>' : '') + (q.live ? '<span class="tag">LIVE</span>' : ''));
  const rgt = opts.rgt || ('<div class="px" data-px="' + esc(id) + '">' + (q.ok && q.price != null ? pxText(id, q.price, {px:true}) : '—') + '</div>' +
      '<div class="chg ' + chgClass(q.changePct) + '" data-chg="' + esc(id) + '">' + (q.changePct != null ? pct(q.changePct) : '—') + '</div>');
  return '<a class="' + cls + '" href="#/s/' + encodeURIComponent(id) + '" data-id="' + esc(id) + '">' +
    avHTML(id, name, kind) +
    '<div class="mid"><div class="nm">' + esc(name) + '</div><div class="tk">' + sub + '</div></div>' +
    spark +
    '<div class="rgt">' + rgt + '</div></a>';
}

function creditHTML() {
  const stockBit = meta.stockOk
    ? 'Stock, ETF and index quotes from Yahoo Finance, delayed up to 15 minutes, last refreshed ' + esc(ago(meta.generated_at)) + '.'
    : (meta.stockErr ? 'Stock quotes unavailable (' + esc(meta.stockErr) + ').' : 'Loading stock quotes…');
  const cry = (ws && ws.readyState === 1)
    ? 'Crypto prices are live from Kraken.'
    : (meta.cryptoOk ? 'Crypto prices from Kraken (quote snapshot).' : (meta.cryptoErr ? 'Crypto feed unavailable (' + esc(meta.cryptoErr) + ').' : 'Connecting to Kraken…'));
  return '<footer class="fine">' + cry + ' ' + stockBit + ' Prices shown in ' + esc(ccy) + '. Charts use TradingView Lightweight Charts. Not investment advice. Portfolio and alerts stay on this device.</footer>';
}

function portfolioStats() {
  if (!holdings.length) return null;
  let value = 0, cost = 0, day = 0, missing = 0, known = 0;
  const lines = [];
  for (const h of holdings) {
    const q = quotes[h.id];
    const px = q && q.ok ? q.price : null;
    const native = (q && q.currency) || 'USD';
    const val = px != null ? px * h.qty : null;
    const cst = h.avg != null ? h.avg * h.qty : null;
    const valUSD = val != null ? toUSD(val, native) : null;
    const cstUSD = cst != null ? toUSD(cst, native) : null;
    const chgUSD = (q && q.change != null) ? toUSD(q.change * h.qty, native) : null;
    if (valUSD != null) { value += valUSD; known++; } else missing++;
    if (cstUSD != null) cost += cstUSD;
    if (chgUSD != null) day += chgUSD;
    lines.push({ h: h, q: q, px: px, native: native, val: val, cst: cst, valUSD: valUSD, pnl: (val != null && cst != null) ? val - cst : null, pnlPct: (val != null && cst) ? (val - cst) / cst * 100 : null });
  }
  const ranked = lines.filter(l => l.pnlPct != null).sort((a,b) => b.pnlPct - a.pnlPct);
  return { value: value, cost: cost, day: day, dayPct: value && (value - day) ? day / (value - day) * 100 : null, pnl: (value && cost) ? value - cost : null, pnlPct: (value && cost) ? (value - cost) / cost * 100 : null, missing: missing, known: known, lines: lines, best: ranked[0], worst: ranked[ranked.length-1] };
}

function recordSnapshot(st) {
  if (!st || !st.known) return;
  const now = Math.floor(Date.now() / 1000);
  const last = snapshots[snapshots.length - 1];
  if (last && now - last.t < 30 * 60 && Math.abs((last.usd || 0) - st.value) < 0.5) return;
  snapshots.push({ t: now, usd: st.value, gbp: convert(st.value, 'USD', 'GBP') });
  if (snapshots.length > 400) snapshots = snapshots.slice(-400);
  store.set('snapshots', snapshots);
}

function countUp(el, to, native, fromVal) {
  if (!el) return;
  if (RMQ.matches || fromVal == null) { el.textContent = money(to, native); return; }
  const t0 = performance.now(), dur = 720, from = fromVal;
  const step = now => {
    const p = Math.min(1, (now - t0) / dur);
    const e = 1 - Math.pow(1 - p, 3);
    el.textContent = money(from + (to - from) * e, native);
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function donutSVG(parts) {
  const total = parts.reduce((s, p) => s + p.value, 0) || 1;
  const r = 42, c = 2 * Math.PI * r;
  let off = 0;
  const rings = parts.map(p => {
    const len = (p.value / total) * c;
    const dash = '<circle cx="60" cy="60" r="' + r + '" fill="none" stroke="' + p.color + '" stroke-width="14" stroke-dasharray="' + len.toFixed(2) + ' ' + (c-len).toFixed(2) + '" stroke-dashoffset="' + (-off).toFixed(2) + '" transform="rotate(-90 60 60)"/>';
    off += len;
    return dash;
  }).join('');
  const legend = parts.map(p => '<li><span><i style="background:' + p.color + '"></i> ' + esc(p.label) + '</span><span>' + ((p.value/total)*100).toFixed(0) + '%</span></li>').join('');
  return '<svg viewBox="0 0 120 120">' + rings + '<circle cx="60" cy="60" r="28" fill="var(--bg)"/></svg><ul class="legend">' + legend + '</ul>';
}
function PALETTE() {
  return ['#00C805', '#3d8b5c', '#FF5000', '#f5c542', '#c084fc', '#8d8d8d', '#fb7185', '#a3e635', '#f97316', '#6b8f71'];
}

function isStubHeadline(n) {
  const t = String((n && n.title) || '').toLowerCase();
  return t.includes('stock price, news, quote and history') || t.includes('equity price and quote');
}
function newsSid(n) {
  if (n && n._sid) return n._sid;
  const raw = String((n && (n.url || n.title)) || Math.random());
  let h = 0;
  for (let i = 0; i < raw.length; i++) h = ((h << 5) - h + raw.charCodeAt(i)) | 0;
  const k = 'n' + (h >>> 0).toString(36);
  if (n) n._sid = k;
  return k;
}
function newsItem(n, i) {
  const src = n.thumbnail || n._logo;
  const thumb = src ? '<img class="thumb' + (n.thumbnail ? '' : ' logo-thumb') + '" src="' + esc(src) + '" alt="">' : '';
  const whenBit = n.published ? ago(n.published) : '';
  const metaLine = [n.source, whenBit].filter(Boolean).join(' · ');
  const key = newsSid(n);
  n._key = key;
  return '<button type="button" class="news-item' + (src ? '' : ' no-thumb') + '" data-act="read" data-key="' + esc(key) + '"><span><b>' + esc(n.title) + '</b><span class="meta">' + esc(metaLine) + '</span></span>' + thumb + '</button>';
}
function newsDayBucket(iso) {
  if (!iso) return 'Earlier';
  const t = typeof iso === 'number' ? (iso < 1e12 ? iso * 1000 : iso) : Date.parse(iso);
  if (!t) return 'Earlier';
  const tz = 'Europe/London';
  const day = ts => new Date(ts).toLocaleDateString('en-CA', { timeZone: tz });
  const today = day(Date.now());
  const yest = day(Date.now() - 86400000);
  const d = day(t);
  if (d === today) return 'Today';
  if (d === yest) return 'Yesterday';
  return 'Earlier';
}
function isFinanceHeadline(n) {
  if (!n || !n.title || isStubHeadline(n)) return false;
  const blob = ((n.title || '') + ' ' + (n.summary || n.excerpt || '')).toLowerCase();
  const finance = /\b(shares?|stocks?|investors?|earnings?|revenue|profits?|guidance|analysts?|price target|upgrade|downgrade|ipo|valuation|market cap|nasdaq|nyse|s&p|sp500|sp 500|ftse|\bdow\b|rally|sell-?off|futures?|yields?|the fed|federal reserve|interest rates?|\brates\b|inflation|dividends?|buybacks?|merger|acquisition|\bdeal\b|equit(?:y|ies)|etfs?|wall street|listed|traders?|trading)\b/i;
  const money = /[$£€]\s*\d[\d,.]*(?:\s*(?:bn|billion|mn|m|million|tn|trillion)\b)?|\b\d+(?:\.\d+)?\s*(?:bn|billion|mn|million|tn|trillion)\b/i;
  if (!(finance.test(blob) || money.test(blob))) return false;
  const scandal = /\b(scandal|affair|outage|outages|testify|testimony|espionage|\bspy\b|white house|congress|sex scandal)\b/i;
  if (scandal.test(blob)) {
    const stripped = blob.replace(/\b(etfs?|stocks?|trading|listed|\bdeal\b|traders?)\b/gi, ' ');
    const strong = /\b(earnings?|revenue|profits?|guidance|price target|upgrade|downgrade|ipo|valuation|market cap|buybacks?|dividends?|merger|acquisition|shares?|futures?|yields?|inflation|the fed|federal reserve|interest rates?)\b/i;
    if (!(finance.test(stripped) || money.test(stripped) || strong.test(blob))) return false;
  }
  return true;
}
function newsListHTML(items, emptyText, opts) {
  opts = opts || {};
  const rows = (items || []).filter(n => n && n.title && !isStubHeadline(n) && (opts.finance === false || isFinanceHeadline(n)));
  const seen = new Set();
  const uniq = [];
  rows.forEach(n => {
    const k = String(n.title || '').toLowerCase().replace(/[\s]+/g, ' ').replace(/\s+[-–—]\s+[^-–—]{2,40}$/, '').trim();
    if (!k || seen.has(k)) return;
    seen.add(k);
    n._key = newsSid(n);
    if (opts.logoId) {
      const L = logoRec(opts.logoId);
      if (L && L.src) n._logo = L.src;
    }
    uniq.push(n);
  });
  rememberNews(uniq);
  if (!uniq.length) return '<div class="empty"><p>' + esc(emptyText || 'No headlines in the latest refresh.') + '</p></div>';
  const groups = { Today: [], Yesterday: [], Earlier: [] };
  uniq.forEach(n => { groups[newsDayBucket(n.published)].push(n); });
  return ['Today','Yesterday','Earlier'].filter(g => groups[g].length).map(g =>
    '<div class="news-h">' + g + '</div><div class="list">' + groups[g].map(newsItem).join('') + '</div>'
  ).join('');
}
function newsStore() { return newsIndex || (newsIndex = {}); }
function rememberNews(items) {
  (items || []).forEach(n => {
    const k = newsSid(n);
    if (k) newsStore()[k] = n;
  });
}

function exchName(q, id) {
  const e = String((q && q.exchange) || '').toUpperCase();
  if (['NGM', 'NMS', 'NASDAQ', 'NM', 'NGS'].includes(e)) return 'NASDAQ';
  if (['NYQ', 'NYSE', 'NYS'].includes(e)) return 'NYSE';
  if (['LSE', 'IOB'].includes(e) || String(id || (q && q.id) || '').endsWith('.L')) return 'LSE';
  return (q && q.exchange) || '';
}
function sessionTag(q) {
  if (!q) return '';
  if (q.kind === 'crypto') return q.live ? 'Live' : '';
  if (q.session === 'post') return 'after hours';
  if (q.session === 'pre') return 'pre-market';
  if (!quoteStale(q, 30 * 60)) return '';
  return 'at close';
}
function priceHeadline(id, q) {
  q = q || {};
  const px = q.price != null ? pxText(id, q.price, { px: true }) : '—';
  let chg = '—';
  if (q.change != null) {
    const bit = (isIndexId(id, q) || isYieldId(id, q))
      ? (isYieldId(id, q) ? fmtPoints(Math.abs(q.change)) + '%' : fmtPoints(Math.abs(q.change)))
      : (isCommodityId(id, q) ? fmtNum(Math.abs(q.change), 'USD', { px: true }) : pxText(id, Math.abs(q.change), { px: true }));
    chg = (q.change < 0 ? '▾ ' : '▴ ') + bit + ' (' + (q.changePct != null ? Math.abs(q.changePct).toFixed(2) + '%' : '—') + ')';
  } else if (q.changePct != null) {
    chg = (q.changePct < 0 ? '▾ ' : '▴ ') + Math.abs(q.changePct).toFixed(2) + '%';
  }
  return { px, chg, sess: sessionTag(q) };
}
function analysisRec(id) {
  return (analysis && analysis.bySymbol && analysis.bySymbol[id]) || null;
}
function aiRec(id) {
  return (aiAnalysis && aiAnalysis.bySymbol && aiAnalysis.bySymbol[id]) || null;
}
function asOfSec(v) {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return v > 1e12 ? v / 1000 : v;
  const n = Number(v);
  if (isFinite(n) && String(v).trim() !== '' && !String(v).includes('-')) return n > 1e12 ? n / 1000 : n;
  const t = Date.parse(v);
  return isFinite(t) ? t / 1000 : 0;
}
function quoteStale(q, maxAge) {
  if (!q || q.price == null) return true;
  if (q.kind === 'crypto' || isCryptoId(q.id || q.symbol)) return false;
  const ts = asOfSec(q.asOf);
  if (!ts) return true;
  return (Date.now() / 1000 - ts) > (maxAge || 15 * 60);
}
function yahooScale(meta) {
  const c = (meta && meta.currency) || '';
  return (c === 'GBp' || c === 'GBX') ? 0.01 : 1;
}
function lastExtendedBar(bars, meta, now) {
  const windows = {};
  const ctp = (meta && meta.currentTradingPeriod) || {};
  for (const k of ['pre', 'regular', 'post']) {
    if (ctp[k] && ctp[k].start != null) windows[k] = [ctp[k].start, ctp[k].end];
  }
  const reg = windows.regular;
  if (reg && now >= reg[0] && now < reg[1]) return null;
  const regT = meta && meta.regularMarketTime;
  const inExt = t => ['pre', 'post'].some(k => windows[k] && t >= windows[k][0] && t < windows[k][1]);
  const later = (bars || []).filter(b => {
    const t = b.t || b.time;
    const c = b.c != null ? b.c : b.value;
    if (t == null || c == null) return false;
    if (windows.pre || windows.post) return inExt(t);
    return regT != null && t > regT;
  });
  if (!later.length) return null;
  const b = later[later.length - 1];
  const t = b.t || b.time;
  const sess = (windows.post && t >= windows.post[0]) ? 'post' : 'pre';
  return { price: b.c != null ? b.c : b.value, t, sess };
}
function applyYahooQuote(id, meta, bars) {
  if (!id || !meta || meta.regularMarketPrice == null) return;
  const scale = yahooScale(meta);
  const now = Date.now() / 1000;
  let price = Number(meta.regularMarketPrice) * scale;
  let asOf = meta.regularMarketTime;
  let session = 'regular';
  let prev = meta.previousClose != null ? meta.previousClose : meta.chartPreviousClose;
  if (prev != null) prev = Number(prev) * scale;
  const regularClose = price;
  const regularTime = asOf;
  const ext = lastExtendedBar(bars, meta, now);
  const rec = {
    symbol: id,
    name: meta.longName || meta.shortName || (quotes[id] && quotes[id].name) || id,
    currency: scale !== 1 ? 'GBP' : (meta.currency || (quotes[id] && quotes[id].currency) || 'USD'),
    ok: true,
    source: 'yahoo-live',
    live: false,
    unit: scale !== 1 ? 'pence' : (quotes[id] && quotes[id].unit) || null,
    dayHigh: meta.regularMarketDayHigh != null ? Number(meta.regularMarketDayHigh) * scale : (quotes[id] && quotes[id].dayHigh),
    dayLow: meta.regularMarketDayLow != null ? Number(meta.regularMarketDayLow) * scale : (quotes[id] && quotes[id].dayLow),
    high52: meta.fiftyTwoWeekHigh != null ? Number(meta.fiftyTwoWeekHigh) * scale : (quotes[id] && quotes[id].high52),
    low52: meta.fiftyTwoWeekLow != null ? Number(meta.fiftyTwoWeekLow) * scale : (quotes[id] && quotes[id].low52),
    volume: meta.regularMarketVolume != null ? meta.regularMarketVolume : (quotes[id] && quotes[id].volume),
    exchange: meta.exchangeName || meta.fullExchangeName || (quotes[id] && quotes[id].exchange)
  };
  if (ext) {
    rec.regularClose = regularClose;
    rec.regularTime = regularTime;
    rec.regularChange = (prev != null) ? regularClose - prev : (quotes[id] && quotes[id].change);
    rec.regularChangePct = (prev != null && prev) ? (regularClose - prev) / prev * 100 : (quotes[id] && quotes[id].changePct);
    price = Number(ext.price) * scale;
    asOf = ext.t;
    session = ext.sess;
    rec.change = regularClose ? price - regularClose : null;
    rec.changePct = regularClose ? (price - regularClose) / regularClose * 100 : null;
  } else {
    rec.change = (prev != null) ? price - prev : null;
    rec.changePct = (prev != null && prev) ? (price - prev) / prev * 100 : null;
    session = 'regular';
  }
  rec.price = price;
  rec.prev = prev;
  rec.asOf = asOf;
  rec.session = session;
  upsert(id, rec);
  return quotes[id];
}
const quoteInflight = {};
async function refreshEquityQuote(id) {
  if (!id || isCryptoId(id)) return quotes[id] || null;
  if (quoteInflight[id]) return quoteInflight[id];
  quoteInflight[id] = (async () => {
    const pack = await fetchYahooRange(id, '1d', '1m') || await fetchYahooRange(id, '1d', '5m');
    if (pack && pack.meta) applyYahooQuote(id, pack.meta, pack.bars || []);
    if (pack && pack.bars && pack.bars.length) {
      const d = histCache[id] || { symbol: id, daily: [], intraday: [] };
      d.intraday = pack.bars;
      d.periods = pack.periods || d.periods;
      d.currency = pack.currency || d.currency;
      d.source = pack.source || d.source;
      histCache[id] = d;
      histFetchedAt[id] = Date.now();
    }
    return quotes[id] || null;
  })();
  try { return await quoteInflight[id]; }
  finally { delete quoteInflight[id]; }
}
async function refreshVisibleQuotes() {
  const ids = new Set();
  if (detailId && !isCryptoId(detailId)) ids.add(detailId);
  $$('[data-px], a.row[data-id]').forEach(el => {
    const id = el.dataset.px || el.dataset.id;
    if (id && !isCryptoId(id)) ids.add(id);
  });
  (holdings || []).forEach(h => { if (h && h.id && !isCryptoId(h.id)) ids.add(h.id); });
  let n = 0;
  for (const id of ids) {
    if (!quoteStale(quotes[id], 15 * 60)) continue;
    await refreshEquityQuote(id);
    if (++n >= 8) break;
  }
  if (n) updatePrices();
}


async function holdingHist(id) {
  if (isCryptoId(id) || pairs[id]) {
    try {
      const bars = await cryptoBars(id, portRange || '1M');
      return { currency: 'USD', daily: (bars || []).map(b => ({ t: b.time, c: b.value })), intraday: (portRange === '1D' ? (bars || []).map(b => ({ t: b.time, c: b.value })) : []) };
    } catch (e) { return null; }
  }
  try {
    return await loadHist(id);
  } catch (e) { return null; }
}
function rangeCut(range) {
  const now = Math.floor(Date.now() / 1000);
  if (range === 'YTD') {
    const year = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric' }).format(new Date());
    return Math.floor(Date.parse(year + '-01-01T00:00:00Z') / 1000);
  }
  return { '1W': now - 7 * 86400, '1M': now - 32 * 86400, '3M': now - 95 * 86400, '1Y': now - 370 * 86400, 'YTD': 0, 'MAX': 0 }[range] || 0;
}
function intraSessionStart(periods, intra) {
  const bars = intra || [];
  if (!bars.length) return 0;
  const last = bars[bars.length - 1].t || bars[bars.length - 1].time;
  if (!last) return 0;
  const pick = key => {
    const p = periods && periods[key];
    const a = Array.isArray(p) ? p[0] : (p && p.start);
    if (a == null || a > last) return null;
    if (bars.some(b => (b.t || b.time) >= a)) return a;
    return null;
  };
  return pick('pre') || pick('regular') || (last - 20 * 3600);
}
function clipHist(d, range) {
  const now = Math.floor(Date.now() / 1000);
  const cut = rangeCut(range);
  if (range === '1D') {
    const intra = d.intraday || d.intra || [];
    const start = intraSessionStart(d.periods, intra);
    let rows = intra.filter(b => (b.t || b.time) >= start).map(b => ({ t: b.t || b.time, v: b.c != null ? b.c : b.value })).filter(b => b.t && b.v != null);
    if (rows.length < 2) {
      const daily = d.daily || [];
      rows = daily.filter(b => (b.t || b.time) >= now - 5 * 86400).map(b => ({ t: b.t || b.time, v: b.c != null ? b.c : b.value })).filter(b => b.t && b.v != null);
    }
    return rows;
  }
  const daily = d.daily || [];
  return daily.filter(b => !cut || (b.t || b.time) >= cut).map(b => ({ t: b.t || b.time, v: b.c != null ? b.c : b.value })).filter(b => b.t && b.v != null);
}
async function portfolioSeries(range) {
  if (!holdings.length) return [];
  const parts = [];
  for (const h of holdings) {
    const d = await holdingHist(h.id);
    if (!d) continue;
    const q = quotes[h.id] || {};
    const bars = clipHist(d, range);
    if (bars.length) parts.push({ qty: h.qty, cur: d.currency || q.currency || 'USD', bars: bars });
  }
  if (!parts.length) return [];
  const times = new Set();
  parts.forEach(p => p.bars.forEach(b => times.add(b.t)));
  const ts = [...times].sort((a, b) => a - b);
  const cursors = parts.map(p => ({ qty: p.qty, cur: p.cur, bars: p.bars, i: 0, last: null }));
  const out = [];
  for (const t of ts) {
    let sum = 0, ok = 0;
    for (const p of cursors) {
      while (p.i < p.bars.length && p.bars[p.i].t <= t) { p.last = p.bars[p.i].v; p.i++; }
      if (p.last == null) continue;
      const usd = toUSD(p.last * p.qty, p.cur);
      const v = convert(usd, 'USD', ccy);
      if (v != null && isFinite(v)) { sum += v; ok++; }
    }
    if (ok) out.push({ time: t, value: sum });
  }
  return out;
}
function rangePills(active, kind) {
  return '<div class="rng" data-ranges="' + kind + '">' + ['1D','1W','1M','3M','YTD','1Y','MAX'].map(r =>
    '<button type="button" data-prange="' + r + '" class="' + (r === active ? 'on' : '') + '">' + (r === 'MAX' ? 'All' : r) + '</button>').join('') + '</div>';
}
function ensureTip(host) {
  const wrap = (host && host.parentElement) || host;
  if (!wrap) return null;
  let tip = wrap.querySelector(':scope > .chart-tip');
  if (!tip) {
    tip = document.createElement('div');
    tip.className = 'chart-tip';
    if (getComputedStyle(wrap).position === 'static') wrap.style.position = 'relative';
    wrap.appendChild(tip);
  }
  return tip;
}
function bindCrosshair(chart, series, host, fmtVal) {
  const tip = ensureTip(host);
  if (!tip || !chart || !chart.subscribeCrosshairMove) return;
  chart.subscribeCrosshairMove(param => {
    if (!param || param.time == null || !param.point || param.point.x < 0 || param.point.y < 0) {
      tip.classList.remove('on');
      return;
    }
    let val = null;
    if (param.seriesData && series && param.seriesData.get) {
      const d = param.seriesData.get(series);
      if (d) val = d.value != null ? d.value : (d.close != null ? d.close : null);
    }
    if (val == null) { tip.classList.remove('on'); return; }
    tip.innerHTML = '<div>' + fmtVal(val) + '</div><small>' + esc(fmtChartTime(param.time)) + '</small>';
    const w = host.clientWidth || 1;
    const left = Math.min(w - 8, Math.max(8, param.point.x));
    tip.style.left = left + 'px';
    tip.style.top = Math.max(16, param.point.y) + 'px';
    tip.classList.add('on');
  });
}
function addGuideLine(series, price, title, color) {
  if (!series || price == null || !isFinite(price) || !series.createPriceLine) return;
  try {
    series.createPriceLine({
      price: price, color: color || 'rgba(255,255,255,.45)', lineWidth: 1,
      lineStyle: 2, axisLabelVisible: true, title: title || ''
    });
  } catch (e) {}
}
function includeInScale(series, extras) {
  const vals = (extras || []).filter(v => v != null && isFinite(v));
  if (!series || !vals.length || !series.applyOptions) return;
  try {
    series.applyOptions({
      autoscaleInfoProvider: original => {
        const res = original ? original() : null;
        if (!res || !res.priceRange) return res;
        const lo = Math.min(res.priceRange.minValue, ...vals);
        const hi = Math.max(res.priceRange.maxValue, ...vals);
        if (lo === hi) return res;
        const pad = (hi - lo) * 0.04;
        res.priceRange.minValue = lo - pad;
        res.priceRange.maxValue = hi + pad;
        return res;
      }
    });
  } catch (e) {}
}
function chartTheme(up) {
  applyDayTheme(up);
  const col = themeColor();
  return { col: col, top: withAlpha(col, 0.22), bot: withAlpha(col, 0) };
}

function drawValueChart(host, pts, opts) {
  opts = opts || {};
  if (!host) return;
  try { if (host._api) host._api.remove(); } catch (e) {}
  host._api = null;
  host.innerHTML = '';
  if (!pts || pts.length < 2 || !window.LightweightCharts) {
    host.innerHTML = chartErrHTML(pts && pts.length ? 'Not enough points for this range.' : 'Value history will appear once prices load.', 'port');
    return;
  }
  const dark = document.documentElement.dataset.theme === 'dark';
  const up = (opts.up != null) ? !!opts.up : (pts[pts.length - 1].value >= pts[0].value);
  const th = chartTheme(up);
  const showAxes = !!opts.showAxes;
  const LW = window.LightweightCharts;
  const chart = LW.createChart(host, {
    autoSize: true, height: opts.height || (showAxes ? undefined : 200),
    layout: { background: { color: 'transparent' }, textColor: dark ? '#8e8e93' : '#8e8e93', fontFamily: "Inter Tight, Inter, -apple-system, system-ui", fontSize: 11, attributionLogo: false },
    grid: { vertLines: { visible: false }, horzLines: { visible: false } },
    rightPriceScale: { visible: showAxes, borderVisible: false, scaleMargins: { top: 0.08, bottom: 0.06 } },
    timeScale: { visible: showAxes, borderVisible: false, timeVisible: true, secondsVisible: false, rightOffset: 2, fixLeftEdge: true },
    handleScroll: !!showAxes, handleScale: !!showAxes,
    crosshair: {
      vertLine: { color: dark ? 'rgba(255,255,255,.35)' : 'rgba(16,16,14,.35)', width: 1, style: 3, labelVisible: showAxes },
      horzLine: { visible: true, color: dark ? 'rgba(255,255,255,.35)' : 'rgba(16,16,14,.35)', width: 1, style: 3, labelVisible: showAxes }
    }
  });
  const series = chart.addSeries(LW.AreaSeries, {
    lineColor: th.col, topColor: th.top, bottomColor: th.bot,
    lineWidth: 3, priceLineVisible: false, lastValueVisible: showAxes,
    crosshairMarkerRadius: 6, priceFormat: { type: 'price', precision: 2, minMove: 0.01 }
  });
  series.setData(pts);
  addGuideLine(series, pts[0].value, '', dark ? 'rgba(255,255,255,.35)' : 'rgba(0,0,0,.3)');
  includeInScale(series, [pts[0].value]);
  chart.timeScale().fitContent();
  bindCrosshair(chart, series, host, v => money(v, ccy, { native: true, px: true }));
  host._api = chart;
  pvApi = chart;
}
async function loadPortChart(hostId) {
  const host = $(hostId);
  if (!host) return;
  try {
    const pts = await portfolioSeries(portRange);
    if (!$(hostId)) return;
    const st = portfolioStats();
    const up = (portRange === '1D' && st && st.day != null) ? (st.day >= 0) : (pts.length > 1 && pts[pts.length-1].value >= pts[0].value);
    drawValueChart(host, pts, { up: up });
  } catch (e) {
    host.innerHTML = chartErrHTML('Could not build this chart.', 'port');
  }
}

function fmtQty(n) {
  if (n == null || !isFinite(n)) return '—';
  if (Math.abs(n - Math.round(n)) < 1e-8) return String(Math.round(n));
  return String(parseFloat(Number(n).toFixed(4)));
}
function holdingsListHTML(st) {
  if (!st || !st.lines.length) return '';
  return '<div class="list">' + st.lines.map(ln => {
    const id = ln.h.id, q = ln.q || {};
    const sub = '<span>' + esc(fmtQty(ln.h.qty)) + ' share' + (ln.h.qty === 1 ? '' : 's') + '</span>';
    const rgt = '<div class="px" data-hval="' + esc(id) + '">' + (ln.val != null ? money(ln.val, ln.native) : '—') + '</div>' +
      '<div class="chg ' + chgClass(ln.pnl) + '" data-hpnl="' + esc(id) + '">' + (ln.pnlPct != null ? pct(ln.pnlPct) : '—') + '</div>';
    return rowHTML(id, { spark: true, sub: sub, rgt: rgt });
  }).join('') + '</div>';
}
function heroHTML(st, valId) {
  if (!holdings.length) {
    return '<div class="hero"><div class="lbl">Total Balance</div>' +
      '<div class="val">' + fmtNum(0, ccy) + '</div>' +
      '<p class="note">Add the shares and coins you hold when you are ready. Everything stays on this device.</p>' +
      '<div style="margin-top:14px"><button class="btn" data-act="add-hold">Add a holding</button></div></div>';
  }
  if (!st || !st.known) {
    return '<div class="hero"><div class="lbl">Total Balance</div>' +
      '<div class="val" id="' + valId + '">…</div>' +
      '<p class="note">Valuing your holdings…</p></div>';
  }
  const dayLine = '<div class="day ' + chgClass(st.day) + '" data-day="1">' +
    (st.day >= 0 ? '+' : '−') + money(Math.abs(st.day), 'USD') +
    (st.dayPct != null ? ' (' + (st.dayPct >= 0 ? '+' : '') + st.dayPct.toFixed(2) + '%)' : '') +
    '</div>';
  return '<div class="hero"><div class="lbl">Total Balance</div>' +
    '<div class="val" id="' + valId + '">' + money(st.value, 'USD') + '</div>' + dayLine +
    (st.missing ? '<p class="note"><b>' + st.missing + ' holding' + (st.missing > 1 ? 's' : '') + '</b> could not be valued.</p>' : '') +
    '</div>';
}

function renderHome() {
  const el = $('#homeIn');
  const st = portfolioStats();
  if (st) recordSnapshot(st);
  const newsBits = (news && news.market || []).slice(0, 8);
  rememberNews(newsBits);
  applyDayTheme(!st || st.day == null || st.day >= 0);
  const chart = (st && st.known)
    ? '<div class="port-bleed"><div id="homeChart"></div><button type="button" class="chart-fs-btn" data-act="chart-fs" data-src="home" aria-label="Full-screen chart">' +
      '<svg viewBox="0 0 24 24"><path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5"/></svg></button>' +
      rangePills(portRange, 'home') + '</div>' +
      '<div class="bp-list">' +
        '<div class="bp-row"><span class="k">Total return</span><span class="v ' + chgClass(st.pnl) + '" data-bp="pnl">' +
          (st.pnl != null ? ((st.pnl >= 0 ? '+' : '') + money(st.pnl, 'USD') + (st.pnlPct != null ? '  ' + pct(st.pnlPct) : '')) : '—') + '</span></div>' +
      '</div>'
    : '';
  el.innerHTML = heroHTML(st, 'heroVal') + chart + toolsHTML() +
    (st && st.lines.length ? allocHTML(st) + largestHTML(st) +
      '<div class="sec-h"><h2>Holdings</h2><a class="more" href="#/portfolio">Portfolio</a></div>' + holdingsListHTML(st) : '') +
    up3mSectionHTML('home') +
    '<div class="sec-h"><h2>Watchlist</h2><a class="more" href="#/watch">See all</a></div>' +
    '<div class="list">' + (watchSyms().length ? watchSyms().slice(0, 8).map(id => rowHTML(id, { spark: true })).join('') : '<div class="empty"><p>Add tickers to your watchlist to see them here.</p></div>') + '</div>' +
    (newsBits.length ? '<div class="sec-h"><h2>News</h2><a class="more" href="#/markets">Markets</a></div>' + newsListHTML(newsBits) : '') +
    creditHTML();
  if (st && st.known && lastHero != null && lastHero !== st.value) countUp($('#heroVal'), st.value, 'USD', lastHero);
  if (st && st.known) { lastHero = st.value; loadPortChart('#homeChart'); }
  lastFlash = {};
}


function fmtCap(usd) {
  if (usd == null || !isFinite(usd)) return '—';
  let v = usd;
  if (ccy === 'GBP') {
    const x = typeof convert === 'function' ? convert(usd, 'USD', 'GBP') : null;
    if (x != null && isFinite(x)) v = x;
  }
  const sign = ccy === 'GBP' ? '£' : '$';
  const abs = Math.abs(v);
  if (abs >= 1e12) return sign + (v / 1e12).toFixed(2) + 'T';
  if (abs >= 1e9) return sign + (v / 1e9).toFixed(2) + 'B';
  if (abs >= 1e6) return sign + (v / 1e6).toFixed(1) + 'M';
  return sign + Math.round(v).toLocaleString('en-GB');
}
function volOf(id, q) {
  q = q || quotes[id] || {};
  return q.volume != null ? q.volume : (volumes[id] || 0);
}
function defaultMarketsList(pane) {
  if (pane === 'crypto') return 'mcap';
  if (pane === 'commodities') return 'all';
  return 'volume';
}
function marketChipsFor(pane, extras) {
  const chips = [];
  if (pane === 'crypto') chips.push({ id: 'mcap', label: 'Market cap' });
  else chips.push({ id: 'all', label: pane === 'commodities' ? 'All contracts' : 'All' });
  chips.push({ id: 'gainers', label: 'Top gainers' }, { id: 'losers', label: 'Top losers' }, { id: 'volume', label: 'Most active' });
  if (pane === 'stocks') chips.push({ id: 'ipos', label: 'IPOs' });
  if (extras && extras.newListings) chips.push({ id: 'new', label: 'New listings' });
  if (extras && extras.trending) chips.push({ id: 'trending', label: 'Trending' });
  return chips;
}
function chipBarHTML(chips, current) {
  return '<div class="filters m-chips">' + chips.map(c =>
    '<button type="button" class="' + (current === c.id ? 'on' : '') + '" data-act="m-list" data-id="' + c.id + '">' + esc(c.label) + '</button>'
  ).join('') + '</div>';
}
function sortMarketIds(ids, mode) {
  const arr = ids.slice();
  const chg = id => (quotes[id] && quotes[id].changePct) || 0;
  const cap = id => (quotes[id] && quotes[id].marketCap) || 0;
  const vol = id => volOf(id);
  if (mode === 'gainers') arr.sort((a, b) => chg(b) - chg(a));
  else if (mode === 'losers') arr.sort((a, b) => chg(a) - chg(b));
  else if (mode === 'volume') arr.sort((a, b) => vol(b) - vol(a));
  else if (mode === 'mcap') arr.sort((a, b) => cap(b) - cap(a));
  // 'all' keeps the incoming order (universe / contract list).
  return arr;
}
function marketListHTML(ids, rowOpts, listId) {
  rowOpts = rowOpts || { spark: true };
  const show = ids.slice(0, 10);
  const rows = show.map(id => {
    const o = Object.assign({}, rowOpts);
    if (typeof o.sub === 'function') o.sub = o.sub(id);
    return rowHTML(id, o);
  }).join('');
  let btn = '';
  if (ids.length > 10) {
    const pane = (listId && listId.pane) || marketsPane;
    const list = (listId && listId.list) || marketsList;
    btn = '<button type="button" class="see-all" data-act="open-list" data-pane="' + esc(pane) + '" data-list="' + esc(list) + '">See all ' + ids.length + '</button>';
  }
  return '<div class="list">' + (rows || '<div class="empty"><p>Nothing in this list yet.</p></div>') + '</div>' + btn;
}
function cryptoRowOpts() {
  return {
    spark: true,
    sub: function(id) {
      const q = quotes[id] || {};
      const sym = q.symbol || coin(id);
      return '<span>' + esc(sym) + '</span>' +
        (q.marketCap ? '<span class="tag">' + fmtCap(q.marketCap) + '</span>' : '') +
        (q.live ? '<span class="tag">LIVE</span>' : '');
    }
  };
}


function fgTone(label) {
  const s = String(label || '').toLowerCase();
  if (s.includes('extreme fear')) return 'fear-x';
  if (s.includes('fear')) return 'fear';
  if (s.includes('extreme greed')) return 'greed-x';
  if (s.includes('greed')) return 'greed';
  return 'neutral';
}
function riskTone(label) {
  const s = String(label || '').toLowerCase();
  if (s === 'low') return 'risk-low';
  if (s === 'elevated') return 'risk-elev';
  if (s === 'high') return 'risk-high';
  if (s === 'extreme') return 'risk-x';
  return 'neutral';
}
function gaugeSVG(score, kind) {
  if (score == null || !isFinite(score)) return '';
  const s = Math.max(0, Math.min(100, Number(score)));
  const w = 160, h = 92, cx = 80, cy = 78, r = 62;
  const gid = 'gg-' + kind + '-' + Math.round(s) + '-' + Math.random().toString(36).slice(2, 6);
  const stops = kind === 'risk'
    ? '<stop offset="0%" stop-color="#00C805"/><stop offset="45%" stop-color="#f5c542"/><stop offset="75%" stop-color="#FF5000"/><stop offset="100%" stop-color="#ff2d2d"/>'
    : '<stop offset="0%" stop-color="#FF5000"/><stop offset="30%" stop-color="#ff8a3d"/><stop offset="50%" stop-color="#f5c542"/><stop offset="80%" stop-color="#7dce3f"/><stop offset="100%" stop-color="#00C805"/>';
  const a = Math.PI * (1 - s / 100);
  const nx = cx + r * Math.cos(a);
  const ny = cy - r * Math.sin(a);
  const arc = 'M ' + (cx - r) + ' ' + cy + ' A ' + r + ' ' + r + ' 0 0 1 ' + (cx + r) + ' ' + cy;
  return '<svg class="gauge" viewBox="0 0 ' + w + ' ' + h + '" aria-hidden="true">' +
    '<defs><linearGradient id="' + gid + '" x1="0" y1="0" x2="1" y2="0">' + stops + '</linearGradient></defs>' +
    '<path d="' + arc + '" fill="none" stroke="var(--line)" stroke-width="9" stroke-linecap="round"/>' +
    '<path d="' + arc + '" fill="none" stroke="url(#' + gid + ')" stroke-width="9" stroke-linecap="round"/>' +
    '<line x1="' + cx + '" y1="' + cy + '" x2="' + nx.toFixed(1) + '" y2="' + ny.toFixed(1) + '" stroke="var(--ink)" stroke-width="2.4" stroke-linecap="round"/>' +
    '<circle cx="' + cx + '" cy="' + cy + '" r="3.2" fill="var(--ink)"/></svg>';
}
function sentimentCardsHTML() {
  const fg = sentiment && sentiment.fearGreed;
  const cr = sentiment && sentiment.crashRisk;
  if (!(fg && fg.score != null) && !(cr && cr.score != null)) return '';
  let cards = '';
  if (fg && fg.score != null) {
    cards += '<button type="button" class="sent-card" data-act="sentiment" data-id="fear">' +
      '<div class="lbl">Fear &amp; greed</div>' +
      gaugeSVG(fg.score, 'fg') +
      '<div class="reading ' + fgTone(fg.rating) + '">' + esc(String(Math.round(fg.score))) + ' · ' + esc(fg.rating || '') + '</div>' +
      '<div class="src">' + esc((fg.source || '').replace(/ \\(.*\\)$/, '').replace(' (graphdata)', '')) + '</div>' +
      '</button>';
  }
  if (cr && cr.score != null) {
    cards += '<button type="button" class="sent-card" data-act="sentiment" data-id="crash">' +
      '<div class="lbl">Crash risk</div>' +
      gaugeSVG(cr.score, 'risk') +
      '<div class="reading ' + riskTone(cr.level) + '">' + esc(cr.level || '') + '</div>' +
      '<div class="src">Composite · ' + esc(String((cr.used != null ? cr.used : '') + ' inputs')) + '</div>' +
      '</button>';
  }
  return '<div class="sent-grid">' + cards + '</div>' +
    '<p class="note sent-disc">Indicator, not a prediction, not financial advice.</p>';
}
function closeSentiment() {
  const el = $('#sentiment');
  if (!el) return;
  el.hidden = true;
  el.innerHTML = '';
  document.body.classList.remove('hide-dock');
}
function openSentiment(which) {
  if (!sentiment) return;
  const el = $('#sentiment');
  if (!el) return;
  const isCrash = which === 'crash';
  const block = isCrash ? sentiment.crashRisk : sentiment.fearGreed;
  if (!block) return;
  const title = isCrash ? 'Market crash risk' : 'Fear & greed';
  const headline = isCrash
    ? esc(block.level || '—') + (block.score != null ? ' · ' + Math.round(block.score) : '')
    : (block.score != null ? Math.round(block.score) + ' · ' + esc(block.rating || '') : '—');
  const tone = isCrash ? riskTone(block.level) : fgTone(block.rating);
  const whenBit = block.asOf ? ago(block.asOf) : (sentiment.generated_at ? ago(sentiment.generated_at) : '');
  const sparkVals = (block.spark || []).map(p => p && p.v).filter(v => v != null && isFinite(v));
  const spark = sparkVals.length >= 2 ? sparkSVG(sparkVals, !isCrash) : '';
  let parts = '';
  (block.parts || []).forEach(pt => {
    if (!pt) return;
    if (!pt.available) {
      parts += '<div class="sent-part off"><div class="h"><b>' + esc(pt.label) + '</b><span>Unavailable</span></div>' +
        (pt.reason ? '<p class="detail">' + esc(pt.reason) + '</p>' : '') +
        (pt.threshold ? '<p class="thr">' + esc(pt.threshold) + '</p>' : '') +
        '</div>';
      return;
    }
    const badge = pt.rating || pt.level || (pt.score != null ? String(pt.score) : '');
    const val = pt.detail || (pt.value != null ? String(pt.value) + (pt.unit ? ' ' + pt.unit : '') : '');
    parts += '<div class="sent-part"><div class="h"><b>' + esc(pt.label) + '</b>' +
      (badge ? '<span class="' + (pt.level ? riskTone(pt.level) : fgTone(pt.rating)) + '">' + esc(String(badge)) + (pt.score != null && (pt.rating || pt.level) ? ' · ' + Math.round(pt.score) : '') + '</span>' : '') +
      '</div>' +
      (val ? '<p class="detail">' + esc(val) + '</p>' : '') +
      (pt.threshold ? '<p class="thr">' + esc(pt.threshold) + '</p>' : '') +
      '</div>';
  });
  el.hidden = false;
  document.body.classList.add('hide-dock');
  el.scrollTop = 0;
  el.innerHTML =
    '<div class="d-bar"><button class="ib" data-act="close-sentiment" aria-label="Back"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg></button><h2>' + title + '</h2><span></span></div>' +
    '<div class="sent-in">' +
      '<div class="sent-hero">' + gaugeSVG(block.score, isCrash ? 'risk' : 'fg') +
      '<div class="reading ' + tone + '">' + headline + '</div>' +
      '<p class="src">' + esc(block.source || '') + (whenBit ? ' · ' + esc(whenBit) : '') + '</p>' +
      (spark ? '<div class="sent-spark">' + spark + '<span>History</span></div>' : '') +
      (block.note ? '<p class="note">' + esc(block.note) + '</p>' : '') +
      '</div>' +
      '<div class="sec-h"><h2>Inputs</h2></div>' + parts +
      '<p class="note sent-disc">Indicator, not a prediction, not financial advice.</p>' +
    '</div>';
}


function ipoById(id) {
  if (!id || !ipos) return null;
  const bags = ['upcoming', 'priced', 'filed', 'withdrawn'];
  for (const b of bags) {
    const hit = (ipos[b] || []).find(r => r && r.id === id);
    if (hit) return hit;
  }
  return null;
}
function isIpoQuoteable(rec) {
  if (!rec) return false;
  const sym = rec.quoteSymbol || rec.ticker;
  const q = sym && quotes[sym];
  return !!(rec.quoteable && q && q.ok && q.price != null);
}
function ipoHref(rec) {
  if (isIpoQuoteable(rec)) return '#/s/' + encodeURIComponent(rec.quoteSymbol || rec.ticker);
  return '#/ipo/' + encodeURIComponent(rec.id);
}
function fmtIpoDate(iso) {
  if (!iso) return '';
  const s = String(iso);
  const d = new Date(s.length <= 10 ? s + 'T00:00:00Z' : s);
  if (isNaN(d)) return s;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}
function fmtShares(n, text) {
  if (n != null && isFinite(n)) {
    if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(n >= 1e8 ? 0 : 1) + 'M';
    return Math.round(n).toLocaleString('en-GB');
  }
  return text || '';
}
function ipoAv(rec) {
  const id = rec.quoteSymbol || rec.ticker || rec.id;
  const L = (rec.logo ? { src: rec.logo, chip: String(rec.logo).endsWith('.png') } : null) || logoRec(id);
  const chip = L && L.chip !== false;
  const cls = ['av', chip ? 'chip' : ''].filter(Boolean).join(' ');
  if (L && L.src) return '<div class="' + cls + '"><img src="' + esc(L.src) + '" alt="" onerror="window.__avErr&&__avErr(this)" data-ph="' + esc(initials(rec.company, rec.ticker || rec.id)) + '"></div>';
  return '<div class="' + cls + ' ph">' + esc(initials(rec.company, rec.ticker || rec.id)) + '</div>';
}
function ipoRight(rec) {
  if (rec.status === 'priced') {
    const ret = rec.returnPct;
    const cur = rec.currentPrice != null
      ? money(rec.currentPrice, rec.currentCurrency || 'USD', { px: true })
      : '';
    const ipo = rec.ipoPrice != null
      ? fmtUsdTerms(rec.ipoPrice, rec.ipoPriceText)
      : (rec.ipoPriceText || '');
    if (cur) {
      return '<div class="px">' + esc(cur) + '</div>' +
        (ret != null
          ? '<div class="chg ' + chgClass(ret) + '">' + esc(pct(ret)) + ' since IPO</div>'
          : '');
    }
    return '<div class="px">' + esc(ipo || '—') + '</div><div class="chg">IPO price</div>';
  }
  const range = rec.priceRange || (rec.ipoPrice != null ? fmtUsdTerms(rec.ipoPrice, rec.ipoPriceText) : (rec.ipoPriceText || ''));
  const deal = rec.dealSize != null ? fmtUsdTerms(rec.dealSize, rec.dealSizeText) : (rec.dealSizeText || '');
  return '<div class="px">' + esc(range || '—') + '</div>' +
    (deal ? '<div class="chg">' + esc(deal) + '</div>' : '');
}
function shortExchange(ex) {
  if (!ex) return '';
  const s = String(ex);
  if (/nasdaq/i.test(s)) return 'Nasdaq';
  if (/^nyse/i.test(s)) return 'NYSE';
  return s;
}
function fmtUsdTerms(n, text) {
  if (n != null && isFinite(n)) {
    const sign = n < 0 ? '-' : '';
    const abs = Math.abs(n);
    if (abs >= 1e12) return sign + '$' + (abs / 1e12).toFixed(2) + 'T';
    if (abs >= 1e9) return sign + '$' + (abs / 1e9).toFixed(2) + 'B';
    if (abs >= 1e6) return sign + '$' + (abs / 1e6).toFixed(abs >= 1e8 ? 0 : 1) + 'M';
    return sign + '$' + abs.toLocaleString('en-GB', { minimumFractionDigits: abs >= 100 ? 0 : 2, maximumFractionDigits: 2 });
  }
  return text || '';
}
function ipoMeta(rec) {
  const bits = [];
  if (rec.ticker) bits.push(rec.ticker);
  if (rec.exchange) bits.push(shortExchange(rec.exchange));
  const dt = rec.expectedDate || rec.pricedDate || rec.filedDate || rec.withdrawnDate || rec.date;
  if (dt) bits.push(fmtIpoDate(dt));
  return bits.map(b => '<span>' + esc(b) + '</span>').join('');
}
function ipoRowHTML(rec) {
  if (!rec) return '';
  return '<a class="row ipo-row" href="' + ipoHref(rec) + '" data-act="ipo" data-id="' + esc(rec.id) + '">' +
    ipoAv(rec) +
    '<div class="mid"><div class="nm">' + esc(rec.company || rec.ticker || 'IPO') + '</div><div class="tk">' + ipoMeta(rec) + '</div></div>' +
    '<div class="rgt">' + ipoRight(rec) + '</div></a>';
}
function ipoSectionHTML(title, rows, opts) {
  opts = opts || {};
  const all = rows || [];
  const limit = opts.limit || 0;
  const show = limit && !opts.full && all.length > limit ? all.slice(0, limit) : all;
  const more = (!opts.full && limit && all.length > limit)
    ? '<button type="button" class="see-all" data-act="open-ipos" data-id="' + esc(opts.anchor || '') + '">See all ' + all.length + '</button>'
    : '';
  const empty = all.length ? '' : '<div class="empty"><p>' + esc(opts.empty || 'None in the latest calendar.') + '</p></div>';
  return '<div class="sec-h"' + (opts.anchor ? ' id="' + esc(opts.anchor) + '"' : '') + '><h2>' + esc(title) + '</h2>' +
    (all.length ? '<small class="more">' + all.length + '</small>' : '') + '</div>' +
    '<div class="list">' + (show.map(ipoRowHTML).join('') || empty) + '</div>' + more;
}
function iposAsOfLine() {
  const whenBit = ipos && ipos.asOf ? ago(ipos.asOf) : '';
  const srcs = (ipos && ipos.sources) || [];
  let src = 'Nasdaq IPO calendar';
  if (srcs.some(function(s) { return /stockanalysis/i.test(s || ''); })) src += ' and StockAnalysis';
  return '<p class="note">As of ' + esc(whenBit || 'the latest refresh') + ' · ' + esc(src) + '. Terms are not an offer. Not financial advice.</p>';
}
function iposPreviewHTML() {
  const up = (ipos && ipos.upcoming) || [];
  const pr = (ipos && ipos.priced) || [];
  const fi = (ipos && ipos.filed) || [];
  if (!up.length && !pr.length && !fi.length) {
    return '<div class="sec-h"><h2>IPOs</h2></div><div class="empty"><p>No IPO calendar data in the latest refresh.</p></div>' + iposAsOfLine();
  }
  return iposAsOfLine() +
    ipoSectionHTML('Upcoming', up, { limit: 10, empty: 'No upcoming IPOs in the calendar window.', anchor: 'ipo-up' }) +
    ipoSectionHTML('Recently priced', pr, { limit: 10, empty: 'No recently priced IPOs in the calendar window.', anchor: 'ipo-pr' }) +
    ipoSectionHTML('Filed', fi, { limit: 10, empty: 'No recent filings in the calendar window.', anchor: 'ipo-fi' }) +
    '<button type="button" class="see-all" data-act="open-ipos">See all IPOs</button>';
}
function closeIpoSheets() {
  const a = $('#ipos'), b = $('#ipoDetail');
  let closed = false;
  if (a && !a.hidden) { a.hidden = true; a.innerHTML = ''; closed = true; }
  if (b && !b.hidden) { b.hidden = true; b.innerHTML = ''; closed = true; }
  if (closed) document.body.classList.remove('hide-dock');
}
function closeIpoDetail() {
  const el = $('#ipoDetail');
  if (el) { el.hidden = true; el.innerHTML = ''; }
  if ($('#ipos') && !$('#ipos').hidden) return;
  document.body.classList.remove('hide-dock');
}
function openIposPage() {
  const el = $('#ipos');
  if (!el) return;
  closeIpoDetail();
  const uk = ipos && ipos.uk;
  const ukBit = (uk && !uk.skipped && uk.items && uk.items.length)
    ? ipoSectionHTML('UK / LSE', uk.items, { full: true })
    : '';
  const wd = (ipos && ipos.withdrawn) || [];
  el.hidden = false;
  document.body.classList.add('hide-dock');
  el.scrollTop = 0;
  el.innerHTML =
    '<div class="d-bar"><button class="ib" data-act="close-ipos" aria-label="Back"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg></button><h2>IPOs</h2><span></span></div>' +
    '<div class="ipo-page">' + iposAsOfLine() +
      ipoSectionHTML('Upcoming', (ipos && ipos.upcoming) || [], { full: true, empty: 'No upcoming IPOs in the calendar window.', anchor: 'ipo-up' }) +
      ipoSectionHTML('Recently priced', (ipos && ipos.priced) || [], { full: true, empty: 'No recently priced IPOs in the calendar window.', anchor: 'ipo-pr' }) +
      ipoSectionHTML('Filed', (ipos && ipos.filed) || [], { full: true, empty: 'No recent filings in the calendar window.', anchor: 'ipo-fi' }) +
      (wd.length ? ipoSectionHTML('Withdrawn', wd, { full: true }) : '') +
      ukBit +
    '</div>';
}
function ipoFacts(rec) {
  const rows = [];
  const add = (k, v) => { if (v) rows.push([k, v]); };
  add('Ticker', rec.ticker);
  add('Exchange', rec.exchange);
  if (rec.status === 'upcoming') add('Expected date', fmtIpoDate(rec.expectedDate || rec.date));
  if (rec.status === 'priced') add('Priced', fmtIpoDate(rec.pricedDate || rec.date));
  if (rec.status === 'filed') add('Filed', fmtIpoDate(rec.filedDate || rec.date));
  if (rec.status === 'withdrawn') {
    add('Withdrawn', fmtIpoDate(rec.withdrawnDate || rec.date));
    add('Filed', fmtIpoDate(rec.filedDate));
  }
  add('Price range', rec.priceRange);
  if (rec.ipoPrice != null) add('IPO price', fmtUsdTerms(rec.ipoPrice, rec.ipoPriceText));
  else if (rec.ipoPriceText) add('IPO price', rec.ipoPriceText);
  if (rec.currentPrice != null) add('Current', money(rec.currentPrice, rec.currentCurrency || 'USD', { px: true }));
  if (rec.returnPct != null) add('Since IPO', pct(rec.returnPct));
  if (rec.sharesOffered != null) add('Shares offered', fmtShares(rec.sharesOffered, rec.sharesText));
  else if (rec.sharesText) add('Shares offered', rec.sharesText);
  if (rec.dealSize != null) add('Deal size', fmtUsdTerms(rec.dealSize, rec.dealSizeText));
  else if (rec.dealSizeText) add('Deal size', rec.dealSizeText);
  add('Status', rec.status ? rec.status.charAt(0).toUpperCase() + rec.status.slice(1) : '');
  add('Source', rec.source);
  let html = '<div class="ipo-facts">';
  rows.forEach(function(r) {
    html += '<div><span>' + esc(r[0]) + '</span><b>' + esc(String(r[1])) + '</b></div>';
  });
  html += '</div>';
  return html;
}
function openIpoDetail(id) {
  const rec = ipoById(id);
  const el = $('#ipoDetail');
  if (!el) return;
  if (!rec) {
    el.hidden = false;
    document.body.classList.add('hide-dock');
    el.innerHTML = '<div class="d-bar"><button class="ib" data-act="close-ipo-detail" aria-label="Back"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg></button><h2>IPO</h2><span></span></div>' +
      '<div class="ipo-page"><div class="empty"><p>This deal was not in the latest calendar.</p></div></div>';
    return;
  }
  if (isIpoQuoteable(rec)) {
    closeIpoSheets();
    location.hash = '#/s/' + encodeURIComponent(rec.quoteSymbol || rec.ticker);
    return;
  }
  const newsItems = rec.news || [];
  rememberNews(newsItems);
  // Also pull any later by-symbol / market matches already in memory.
  const extra = [];
  const tickers = [rec.ticker, rec.quoteSymbol].filter(Boolean);
  tickers.forEach(function(tk) {
    ((news && news.bySymbol && news.bySymbol[tk]) || []).forEach(function(n) { extra.push(n); });
  });
  const combined = newsItems.concat(extra);
  el.hidden = false;
  document.body.classList.add('hide-dock');
  el.scrollTop = 0;
  el.innerHTML =
    '<div class="d-bar"><button class="ib" data-act="close-ipo-detail" aria-label="Back"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg></button><h2>IPO</h2><span></span></div>' +
    '<div class="ipo-page">' +
      '<div class="ipo-hero">' + ipoAv(rec) +
        '<div><h3>' + esc(rec.company || rec.ticker || 'IPO') + '</h3>' +
        '<p class="tk">' + ipoMeta(rec) + '</p></div></div>' +
      ipoFacts(rec) +
      iposAsOfLine() +
      '<div class="sec-h"><h2>Related news</h2></div>' +
      newsListHTML(combined, 'No related headlines in the latest refresh.') +
    '</div>';
}

function renderMarkets(opts) {
  opts = opts || {};
  const el = $('#marketsIn');
  const pane = MARKET_PANES.includes(marketsPane) ? marketsPane : 'stocks';
  marketsPane = pane;
  const allowed = pane === 'crypto'
    ? ['mcap','gainers','losers','volume','new','trending']
    : (pane === 'stocks' ? ['all','gainers','losers','volume','ipos'] : ['all','gainers','losers','volume']);
  if (!allowed.includes(marketsList)) marketsList = defaultMarketsList(pane);

  const universe = Object.values(quotes).filter(q => q && q.ok && q.changePct != null && q.kind !== 'fx');
  const tabs = [['stocks','Stocks'],['crypto','Crypto'],['commodities','Commodities'],['etfs','ETFs']]
    .map(pair => '<button type="button" class="' + (pane===pair[0]?'on':'') + '" data-act="m-pane" data-id="' + pair[0] + '">' + pair[1] + '</button>').join('');
  let body = '';
  if (pane === 'stocks') {
    const idxs = INDICES.map(id => quotes[id]).filter(Boolean);
    const eq = universe.filter(q => q.kind === 'equity').map(q => q.id);
    const idxCards = idxs.map(q => {
      const up = (q.changePct || 0) >= 0;
      return '<a class="idx" href="#/s/' + encodeURIComponent(q.id) + '">' +
        '<div class="k">' + avHTML(q.id, q.name, 'index') + ' ' + esc(q.shortName || q.name) + '</div>' +
        '<div class="v">' + (q.price != null ? pxText(q.id, q.price, {px:true}) : '—') + '</div>' +
        '<span class="chip ' + chgClass(q.changePct) + '">' + (q.changePct != null ? pct(q.changePct) : '—') + '</span>' +
        sparkSVG(q.spark, up) + '</a>';
    }).join('');
    const headlines = (news && news.market) || [];
    rememberNews(headlines);
    const chips = marketChipsFor('stocks');
    const ids = sortMarketIds(eq, marketsList === 'ipos' ? 'volume' : marketsList);
    const label = (chips.find(c => c.id === marketsList) || {}).label || 'Stocks';
    const mid = marketsList === 'ipos'
      ? iposPreviewHTML()
      : ('<div class="sec-h"><h2>' + esc(label) + '</h2></div>' + marketListHTML(ids));
    body = sentimentCardsHTML() + '<div class="idx-grid">' + (idxCards || '<div class="empty"><p>Index quotes have not loaded yet.</p></div>') + '</div>' +
      moverStripHTML(eq, 'stocks') +
      up3mSectionHTML('stocks') +
      chipBarHTML(chips, marketsList) + mid +
      '<div class="sec-h"><h2>News</h2></div>' + newsListHTML(headlines, 'No market headlines in the latest refresh.');
  } else if (pane === 'crypto') {
    applyCryptoMarkets();
    const fng = news && news.fng;
    let fngH = '';
    if (fng && fng.value != null) {
      fngH = '<div class="fng compact"><span class="score">' + esc(fng.value) + '</span>' +
        '<span class="fng-meta"><b>Fear &amp; greed</b> · ' + esc(fng.classification || '') + '</span>' +
        '<div class="fng-m"><i style="left:' + Math.max(0,Math.min(100,fng.value)) + '%"></i></div></div>';
    }
    const chead = (news && (news.crypto || [])) || [];
    rememberNews(chead);
    const hasNew = !!(cryptoMarkets.newListings && cryptoMarkets.newListings.length);
    const hasTr = !!(cryptoMarkets.trending && cryptoMarkets.trending.length);
    const chips = marketChipsFor('crypto', { newListings: hasNew, trending: hasTr });
    let ids;
    if (marketsList === 'trending') ids = (cryptoMarkets.trending || []).map(c => c.ticker);
    else if (marketsList === 'new') ids = (cryptoMarkets.newListings || []).map(c => c.ticker);
    else ids = sortMarketIds((cryptoMarkets.coins || []).map(c => c.ticker), marketsList);
    ids = ids.filter(Boolean);
    const label = (chips.find(c => c.id === marketsList) || {}).label || 'Crypto';
    const cryptoIds = (cryptoMarkets.coins || []).map(c => c.ticker).filter(Boolean);
    body = fngH + moverStripHTML(cryptoIds, 'crypto') +
      chipBarHTML(chips, marketsList) +
      '<div class="sec-h"><h2>' + esc(label) + '</h2><small class="more">' + (ids.length ? (ids.length + ' coins') : '') + '</small></div>' +
      marketListHTML(ids, cryptoRowOpts()) +
      '<div class="sec-h"><h2>News</h2></div>' + newsListHTML(chead, 'No crypto headlines in the latest refresh.', { finance: false });
  } else if (pane === 'commodities') {
    const list = COMMODITY_IDS.filter(id => quotes[id] && quotes[id].ok);
    const chips = marketChipsFor('commodities');
    const ids = sortMarketIds(list, marketsList);
    const label = (chips.find(c => c.id === marketsList) || {}).label || 'Contracts';
    body = '<p class="note">Futures last prices from Yahoo Finance, shown in US dollars with the contract unit.</p>' +
      chipBarHTML(chips, marketsList) +
      '<div class="sec-h"><h2>' + esc(label) + '</h2></div>' + marketListHTML(ids);
  } else {
    const etfs = universe.filter(q => q.kind === 'etf').map(q => q.id);
    const chips = marketChipsFor('etfs');
    const ids = sortMarketIds(etfs, marketsList);
    const label = (chips.find(c => c.id === marketsList) || {}).label || 'ETFs';
    body = chipBarHTML(chips, marketsList) +
      '<div class="sec-h"><h2>' + esc(label) + '</h2></div>' + marketListHTML(ids);
  }
  el.innerHTML = '<p class="eyebrow">Today</p><h2 style="font-size:28px;margin-bottom:8px">Markets</h2>' +
    '<div class="m-seg">' + tabs + '</div>' + body + creditHTML();
  if (opts.scroll !== false) {
    const view = document.querySelector('.view[data-tab="markets"]');
    if (view) view.scrollTop = 0;
  }
}

function renderWatch() {
  const el = $('#watchIn');
  const list = watchlists.find(l => l.id === activeWatch) || watchlists[0];
  let ids = (list.symbols || []).slice();
  const f = watchFilter;
  ids = ids.filter(id => {
    const k = kindOf(id, quotes[id]);
    if (f === 'stocks') return k === 'equity';
    if (f === 'etf') return k === 'etf';
    if (f === 'crypto') return k === 'crypto';
    if (f === 'uk') return String(id).endsWith('.L') || id === '^FTSE';
    if (f === 'us') return !String(id).endsWith('.L') && k !== 'crypto';
    return true;
  });
  ids.sort((a, b) => {
    const qa = quotes[a] || {}, qb = quotes[b] || {};
    if (watchSort === 'name') return (qa.name || a).localeCompare(qb.name || b);
    if (watchSort === 'price') return (qb.price || 0) - (qa.price || 0);
    return Math.abs(qb.changePct || 0) - Math.abs(qa.changePct || 0);
  });
  const tabs = watchlists.map(l => '<button class="' + (l.id===activeWatch?'on':'') + '" data-act="pick-wl" data-id="' + esc(l.id) + '">' + esc(l.name) + '</button>').join('') +
    '<button data-act="add-wl" title="New list">+</button>';
  const filters = [['all','All'],['stocks','Stocks'],['etf','ETFs'],['crypto','Crypto'],['uk','UK'],['us','US']]
    .map(pair => '<button class="' + (watchFilter===pair[0]?'on':'') + '" data-act="w-filter" data-id="' + pair[0] + '">' + pair[1] + '</button>').join('');
  el.innerHTML = '<p class="eyebrow">Markets</p><h2 style="font-size:28px;margin-bottom:10px">Watchlists</h2>' +
    '<div class="wl-tabs">' + tabs + '</div>' +
    '<button class="search" data-act="search" style="width:100%;text-align:left;color:var(--mute)">' +
    '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg><span>Search stocks, ETFs and crypto</span></button>' +
    '<div class="filters">' + filters +
    '<button data-act="w-sort" class="' + (watchSort==='change'?'on':'') + '">% change</button>' +
    '<button data-act="w-sort-name" class="' + (watchSort==='name'?'on':'') + '">Name</button>' +
    '<button data-act="watch-compact" class="' + (watchCompact?'on':'') + '">' + (watchCompact ? 'Comfortable' : 'Compact') + '</button></div>' +
    (ids.length ? '<div class="list' + (watchCompact ? ' compact' : '') + '">' + ids.map(id => rowHTML(id, { spark: !watchCompact })).join('') + '</div>'
      : '<div class="empty"><b>Empty list</b><p>Add a ticker or coin to follow live prices.</p><button class="btn sm" data-act="search">Add something</button></div>') +
    '<div style="margin-top:10px;display:flex;gap:8px"><button class="btn ghost sm" data-act="rename-wl">Rename</button>' +
    (watchlists.length>1?'<button class="btn danger sm" data-act="del-wl">Delete list</button>':'') + '</div>' + creditHTML();
  lastFlash = {};
}

function renderPort() {
  const el = $('#portIn');
  const st = portfolioStats();
  if (st) recordSnapshot(st);
  const body = !holdings.length
    ? '<div class="empty"><b>No holdings yet</b><p>When you are ready, add a quantity and average buy price. Nothing is sent anywhere.</p>' +
      '<button class="btn sm" data-act="add-hold">Add a holding</button>' +
      '<button class="btn ghost sm" data-act="import-csv" style="margin-top:8px">Import CSV</button></div>'
    : (st && st.known ? '<div class="port-bleed"><div id="pvChart"></div><button type="button" class="chart-fs-btn" data-act="chart-fs" data-src="port" aria-label="Full-screen chart"><svg viewBox="0 0 24 24"><path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5"/></svg></button>' + rangePills(portRange, 'port') + '</div>' +
      '' : '') +
      (st && st.pnl != null ? '<div class="stats">' +
        stat('Total return', null, null, (st.pnl >= 0 ? '+' : '') + money(st.pnl, 'USD') + (st.pnlPct != null ? ' · ' + pct(st.pnlPct) : '')) +
        stat('Day change', null, null, (st.day != null ? ((st.day >= 0 ? '+' : '') + money(st.day, 'USD')) : '—') + (st.dayPct != null ? ' · ' + pct(st.dayPct) : '')) +
        (st.best ? stat('Best', null, null, esc((st.best.q && st.best.q.symbol) || st.best.h.id) + ' ' + pct(st.best.pnlPct)) : '') +
        (st.worst ? stat('Worst', null, null, esc((st.worst.q && st.worst.q.symbol) || st.worst.h.id) + ' ' + pct(st.worst.pnlPct)) : '') +
        '</div>' : '') +
      (safeHTML(() => allocHTML(st))) + (safeHTML(() => largestHTML(st))) +
      (st && st.known ? perfGridPlaceholder() : '') +
      '<div class="sec-h"><h2>Holdings</h2><button class="more" data-act="export-csv">Export CSV</button></div>' +
      holdingsListHTML(st) +
      safeHTML(() => analyticsHTML(st)) +
      safeHTML(calendarHTML) +
      safeHTML(dividendTrackerHTML) +
      safeHTML(pnlHeatHTML) +
      safeHTML(benchmarkHTML) +
      safeHTML(isaHTML) +
      safeHTML(riskHTML) +
      safeHTML(sectorHeatHTML) +
      '<div style="margin-top:16px;display:flex;gap:8px"><button class="btn ghost" style="flex:1" data-act="add-hold">Add another</button><button class="btn ghost" style="flex:1" data-act="import-csv">Import</button></div>';
  el.innerHTML = heroHTML(st, 'portVal') + body + creditHTML();
  if (st) applyDayTheme(st.day == null || st.day >= 0);
  if (st && st.known) { loadPortChart('#pvChart'); fillPerformanceGrid(st); fillDividendTracker(); fillPnLHeat(); fillBenchmark(); fillRisk(); }
}

function analyticsHTML(st) {
  const pal = PALETTE();
  const byAsset = st.lines.filter(l => l.valUSD != null).map((l, i) => ({
    label: (l.q && (l.q.symbol || l.q.name)) || l.h.id, value: l.valUSD, color: pal[i % pal.length]
  }));
  const byTypeMap = {};
  for (const l of st.lines) {
    if (l.valUSD == null) continue;
    const k = kindOf(l.h.id, l.q);
    const label = k === 'crypto' ? 'Crypto' : k === 'etf' ? 'ETFs' : (String(l.h.id).endsWith('.L') ? 'UK shares' : 'US shares');
    byTypeMap[label] = (byTypeMap[label] || 0) + l.valUSD;
  }
  const byType = Object.entries(byTypeMap).map((ent, i) => ({ label: ent[0], value: ent[1], color: pal[i % pal.length] }));
  const best = st.best ? esc((st.best.q && st.best.q.symbol) || st.best.h.id) + ' ' + pct(st.best.pnlPct) : '—';
  const worst = st.worst ? esc((st.worst.q && st.worst.q.symbol) || st.worst.h.id) + ' ' + pct(st.worst.pnlPct) : '—';
  return '<div class="donuts">' +
    '<div class="donut"><div class="t">By asset</div>' + (byAsset.length ? donutSVG(byAsset.slice(0, 8)) : '') + '</div>' +
    '<div class="donut"><div class="t">By type</div>' + (byType.length ? donutSVG(byType) : '') + '</div></div>';
}

function drawPvChart() {
  const host = $('#pvChart');
  if (!host || snapshots.length < 2 || !window.LightweightCharts) return;
  host.innerHTML = '';
  try { if (pvApi) pvApi.remove(); } catch (e) {}
  const dark = document.documentElement.dataset.theme === 'dark';
  const pts = snapshots.map(s => ({ time: s.t, value: ccy === 'GBP' ? (s.gbp != null ? s.gbp : convert(s.usd, 'USD', 'GBP')) : s.usd })).filter(p => p.value != null);
  if (pts.length < 2) return;
  const up = pts[pts.length-1].value >= pts[0].value;
  const col = up ? (dark ? '#32d074' : '#128a4c') : (dark ? '#ff453a' : '#d11f2a');
  const LW = window.LightweightCharts;
  const chart = LW.createChart(host, {
    autoSize: true, height: 180,
    layout: { background: { color: 'transparent' }, textColor: dark ? '#8e8e93' : '#8e8e93', fontFamily: 'Inter, -apple-system, system-ui', attributionLogo: false },
    grid: { vertLines: { visible: false }, horzLines: { color: dark ? 'rgba(255,255,250,.06)' : 'rgba(16,16,14,.06)' } },
    rightPriceScale: { borderVisible: false }, timeScale: { borderVisible: false, timeVisible: false },
    handleScroll: false, handleScale: false
  });
  const s = chart.addSeries ? chart.addSeries(LW.AreaSeries, { lineColor: col, topColor: col + '55', bottomColor: 'transparent', lineWidth: 2, priceLineVisible: false }) : chart.addAreaSeries({ lineColor: col, topColor: col + '55', bottomColor: 'transparent', lineWidth: 2 });
  s.setData(pts);
  chart.timeScale().fitContent();
  pvApi = chart;
}

function renderAlerts() {
  const el = $('#alertsIn');
  const perm = typeof Notification !== 'undefined' ? Notification.permission : 'denied';
  const list = alerts.length
    ? '<div class="list">' + alerts.map(a => {
        const q = quotes[a.id] || {};
        const name = q.name || a.id;
        const cond = a.op === 'pct-up' ? 'rises ' + a.pct + '% from ' + pxText(a.id, a.ref, {px:true})
          : a.op === 'pct-down' ? 'falls ' + a.pct + '% from ' + pxText(a.id, a.ref, {px:true})
          : esc(a.op) + ' ' + esc(pxText(a.id, a.price, {px:true}));
        const hit = a.fired ? '<span class="tag">Triggered</span>' : '';
        return '<div class="row" data-alert="' + esc(a.key) + '">' + avHTML(a.id, name, kindOf(a.id, q)) +
          '<div class="mid"><div class="nm">' + esc(name) + '</div><div class="tk">Alert when ' + cond + ' ' + hit + '</div></div>' +
          '<div class="rgt"><div class="px" data-px="' + esc(a.id) + '">' + (q.price != null ? pxText(a.id, q.price, {px:true}) : '—') + '</div>' +
          '<button class="more" data-act="del-alert" data-key="' + esc(a.key) + '" style="margin-top:4px">Remove</button></div></div>';
      }).join('') + '</div>'
    : '<div class="empty"><b>No alerts</b><p>Get a banner in the app, and a phone notification if you allow them, when a price crosses a level or moves by a percentage you set.</p></div>';
  el.innerHTML = '<p class="eyebrow">Notifications</p><h2 style="font-size:28px;margin-bottom:10px">Alerts</h2>' +
    '<div class="cta"><p><b>' + (perm === 'granted' ? 'Notifications while Ticker is open' : 'In-app alerts are ready') + '</b> ' +
    (perm === 'granted'
      ? 'You will get a system notification when a price crosses a level or moves by a set percentage, and for new earnings or analyst upgrades and downgrades on holdings and the watchlist. These fire while Ticker is open. True background push needs a paid server, which this GitHub Pages app does not have.'
      : 'Allow notifications to get a banner while Ticker is open. True background push is not available on this free GitHub Pages setup. Alerts still toast in the app.') + '</p>' +
    (perm !== 'granted' ? '<button class="btn sm" data-act="enable-note">' + (perm === 'denied' ? 'Notifications blocked' : 'Enable') + '</button>' : '') + '</div>' +
    '<div style="margin:12px 0"><button class="btn ghost full" data-act="add-alert">New price alert</button></div>' + list + creditHTML();
}

function paintTitle() {
  const el = document.querySelector('.wm');
  if (el) el.textContent = TAB_TITLE[tab] || 'Ticker';
}
function renderAll() {
  paintTitle();
  for (const fn of [renderHome, renderMarkets, renderWatch, renderPort, renderAlerts]) {
    try { fn(); } catch (err) { console.warn('render failed', fn.name, err); }
  }
  if (detailId) { try { renderDetail(detailId, true); } catch (err) { console.warn('renderDetail failed', err); } }
  setLive(); paintCcy();
}

function updatePortfolioLive() {
  const st = portfolioStats();
  if (!st || !st.known) return;
  applyDayTheme(st.day == null || st.day >= 0);
  const val = money(st.value, 'USD');
  ['heroVal', 'portVal'].forEach(id => { const el = $('#' + id); if (el) el.textContent = val; });
  lastHero = st.value;
  $$('[data-day]').forEach(el => {
    el.className = 'day ' + chgClass(st.day);
    el.innerHTML = (st.day >= 0 ? '▴ ' : '▾ ') + money(Math.abs(st.day), 'USD') +
      (st.dayPct != null ? ' (' + Math.abs(st.dayPct).toFixed(2) + '%)' : '') +
      ' <span class="sess">today</span>';
  });
  $$('[data-bp="pnl"]').forEach(el => {
    el.className = 'v ' + chgClass(st.pnl);
    el.textContent = st.pnl != null ? ((st.pnl >= 0 ? '+' : '') + money(st.pnl, 'USD') + (st.pnlPct != null ? '  ' + pct(st.pnlPct) : '')) : '—';
  });
  (st.lines || []).forEach(ln => {
    const id = ln.h.id;
    const valEl = $('[data-hval="' + id + '"]');
    const pnlEl = $('[data-hpnl="' + id + '"]');
    if (valEl && ln.val != null) valEl.textContent = money(ln.val, ln.native);
    if (pnlEl && ln.pnlPct != null) {
      pnlEl.textContent = pct(ln.pnlPct);
      pnlEl.className = 'chg ' + chgClass(ln.pnl);
    }
  });
}
function updatePrices() {
  for (const el of $$('[data-px]')) {
    const q = quotes[el.dataset.px];
    if (!q || q.price == null) continue;
    const t = pxText(el.dataset.px, q.price, { px: true });
    if (el.textContent !== t) {
      el.textContent = t;
      el.classList.remove('tick-up', 'tick-dn');
      if (lastFlash[el.dataset.px]) {
        void el.offsetWidth;
        el.classList.add(lastFlash[el.dataset.px] === 'dn' ? 'tick-dn' : 'tick-up');
      }
    }
  }
  for (const el of $$('[data-chg]')) {
    const q = quotes[el.dataset.chg];
    if (!q) continue;
    el.textContent = q.changePct != null ? pct(q.changePct) : '—';
    el.classList.remove('up', 'dn', 'flat'); const cc = chgClass(q.changePct); if (cc) el.classList.add(cc);
  }
  if (holdings.length && (tab === 'home' || tab === 'port') && !detailId) {
    updatePortfolioLive();
  }
  if (detailId && $('#dPx')) {
    const q = quotes[detailId];
    if (q) {
      const hl = priceHeadline(detailId, q);
      $('#dPx').textContent = hl.px;
      const c = $('#dChg');
      if (c) {
        c.className = 'd-chg ' + chgClass(q.changePct);
        c.innerHTML = hl.chg + (hl.sess ? ' <span class="sess">' + esc(hl.sess) + '</span>' : '');
      }
      applyDayTheme(q.change == null || q.change >= 0);
    }
  }
  lastFlash = {};
}

function stat(k, n, ccy0, text, asPoints) {
  const val = text != null ? text : (asPoints ? fmtPoints(n) : money(n, ccy0 || 'USD', {px:true}));
  return '<div class="stat"><div class="k">' + esc(k) + '</div><div class="v">' + val + '</div></div>';
}

async function cryptoBars(id, range) {
  const alt = (pairs[id] && pairs[id].alt) || (coin(id) === 'BTC' ? 'XBTUSD' : coin(id) + 'USD');
  // Kraken public OHLC interval (minutes) and the time span to keep.
  // 1D and 1W used to share 60-minute bars and looked identical.
  const map = {
    '1D':  [5,    24 * 3600],
    '1W':  [60,    7 * 86400],
    '1M':  [240,  32 * 86400],
    '3M':  [1440, 95 * 86400],
    'YTD': [1440, 0],
    '1Y':  [1440, 370 * 86400],
    'MAX': [1440, 0]
  };
  const [iv, span] = map[range] || map['1M'];
  const r = await fetchWithTimeout(KREST + '/OHLC?pair=' + encodeURIComponent(alt) + '&interval=' + iv, { cache: 'no-cache' }, 10000);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const d = await r.json();
  if (d.error && d.error.length) throw new Error(d.error.join(', '));
  const key = Object.keys(d.result || {}).find(k => k !== 'last');
  const raw = (key && d.result[key]) || [];
  let rows = raw.map(row => ({
    time: row[0], o: parseFloat(row[1]), h: parseFloat(row[2]), l: parseFloat(row[3]), c: parseFloat(row[4]),
    value: parseFloat(row[4]), v: parseFloat(row[6])
  })).filter(b => isFinite(b.value) && isFinite(b.time));
  const now = Math.floor(Date.now() / 1000);
  let cut = 0;
  if (range === 'YTD') cut = rangeCut('YTD');
  else if (span) cut = now - span;
  if (cut) rows = rows.filter(b => b.time >= cut);
  return rows;
}

const histCache = {};
const histFails = {};
function chartErrHTML(msg, src) {
  return '<div class="ph chart-err"><p>' + esc(msg || 'Could not load this chart.') + '</p>' +
    '<button type="button" class="btn sm" data-act="retry-chart"' + (src ? ' data-src="' + esc(src) + '"' : '') + '>Retry</button></div>';
}
function parseYahooChart(json) {
  const res = ((json && json.chart) || {}).result && json.chart.result[0];
  if (!res) return null;
  const ts = res.timestamp || [];
  const q = ((res.indicators || {}).quote || [])[0] || {};
  const bars = [];
  for (let i = 0; i < ts.length; i++) {
    const c = q.close && q.close[i];
    if (c == null || !isFinite(c) || !ts[i]) continue;
    bars.push({
      t: ts[i], c: c,
      o: q.open && q.open[i], h: q.high && q.high[i], l: q.low && q.low[i], v: q.volume && q.volume[i]
    });
  }
  if (!bars.length) return null;
  const metaY = res.meta || {};
  const scale = yahooScale(metaY);
  if (scale !== 1) {
    for (const b of bars) {
      for (const k of ['c', 'o', 'h', 'l']) if (b[k] != null) b[k] *= scale;
    }
  }
  const ctp = metaY.currentTradingPeriod || {};
  const per = {};
  for (const k of ['pre', 'regular', 'post']) {
    if (ctp[k] && ctp[k].start != null) per[k] = [ctp[k].start, ctp[k].end];
  }
  return {
    currency: scale !== 1 ? 'GBP' : (metaY.currency || 'USD'),
    source: 'Yahoo Finance (on demand)',
    periods: per,
    bars: bars,
    meta: metaY
  };
}
async function fetchYahooRange(id, range, interval) {
  const yahoo = 'https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(id) +
    '?range=' + range + '&interval=' + interval + '&includePrePost=true';
  const urls = [yahoo, 'https://r.jina.ai/' + yahoo];
  for (const u of urls) {
    try {
      const r = await fetchWithTimeout(u, { cache: 'no-cache' }, 10000);
      if (!r.ok) continue;
      let raw = await r.text();
      const start = raw.indexOf('{');
      if (start > 0) raw = raw.slice(start);
      const end = raw.lastIndexOf('}');
      if (end > 0) raw = raw.slice(0, end + 1);
      const parsed = parseYahooChart(JSON.parse(raw));
      if (parsed && parsed.bars && parsed.bars.length) return parsed;
    } catch (e) {}
  }
  return null;
}
function lastBarTime(rows) {
  if (!rows || !rows.length) return 0;
  const b = rows[rows.length - 1];
  return b.t || b.time || 0;
}
function intraStale(d, maxAge) {
  const last = lastBarTime(d && (d.intraday || d.intra));
  if (!last) return true;
  return (Date.now() / 1000 - last) > (maxAge || 30 * 60);
}
async function loadHist(id) {
  if (histFails[id] >= 2 && histCache[id]) return histCache[id];
  if (histCache[id] && !intraStale(histCache[id]) && histFetchedAt[id]) return histCache[id];
  if (!histCache[id]) {
    try {
      const r = await fetch('data/hist/' + encodeURIComponent(id) + '.json?t=' + Math.floor(Date.now() / 60_000), { cache: 'no-cache' });
      if (r.ok) {
        const d = await r.json();
        if (d && ((d.daily && d.daily.length) || (d.intraday && d.intraday.length))) {
          histCache[id] = d;
        }
      }
    } catch (e) {}
  }
  let d = histCache[id];
  if (d && !intraStale(d) && histFetchedAt[id]) return d;
  // Fresh 1D/1W data: the committed hist file is often hours behind the session.
  const intraPack = await fetchYahooRange(id, '5d', '15m') || await fetchYahooRange(id, '1d', '1m');
  if (intraPack && intraPack.bars && intraPack.bars.length) {
    d = d || { symbol: id, daily: [], dividends: [] };
    d.intraday = intraPack.bars;
    d.periods = intraPack.periods || d.periods || {};
    d.currency = intraPack.currency || d.currency;
    d.source = intraPack.source || d.source || 'Yahoo Finance (on demand)';
    d.delay = 'On-demand Yahoo chart, delayed up to 15 minutes';
    if (intraPack.meta) applyYahooQuote(id, intraPack.meta, intraPack.bars);
    histCache[id] = d;
    histFetchedAt[id] = Date.now();
  }
  if (d && ((d.daily && d.daily.length) || (d.intraday && d.intraday.length))) return d;
  const dailyPack = await fetchYahooRange(id, '5y', '1d');
  if (!dailyPack && !intraPack) {
    histFails[id] = (histFails[id] || 0) + 1;
    return null;
  }
  d = {
    symbol: id,
    currency: (dailyPack && dailyPack.currency) || (intraPack && intraPack.currency) || 'USD',
    daily: (dailyPack && dailyPack.bars) || [],
    intraday: (intraPack && intraPack.bars) || [],
    periods: (intraPack && intraPack.periods) || (dailyPack && dailyPack.periods) || {},
    source: 'Yahoo Finance (on demand)',
    delay: 'On-demand Yahoo chart, delayed up to 15 minutes'
  };
  if (dailyPack && dailyPack.meta) applyYahooQuote(id, dailyPack.meta, dailyPack.bars || []);
  histCache[id] = d;
  histFetchedAt[id] = Date.now();
  return d;
}
function barsFrom(rows) {
  return (rows || []).map(b => ({ time: b.t || b.time, value: b.c != null ? b.c : b.value, o: b.o, h: b.h, l: b.l, c: b.c != null ? b.c : b.value, v: b.v })).filter(b => b.time && b.value != null);
}
async function stockPack(id, range) {
  if (range === '1D' || range === '1W') {
    const pack = range === '1D'
      ? (await fetchYahooRange(id, '1d', '1m') || await fetchYahooRange(id, '2d', '5m'))
      : (await fetchYahooRange(id, '5d', '15m') || await fetchYahooRange(id, '10d', '15m'));
    if (pack && pack.bars && pack.bars.length >= 2) {
      if (pack.meta) applyYahooQuote(id, pack.meta, pack.bars);
      const d0 = histCache[id] || { symbol: id, daily: [] };
      d0.intraday = pack.bars;
      d0.periods = pack.periods || d0.periods;
      d0.currency = pack.currency || d0.currency;
      histCache[id] = d0;
      histFetchedAt[id] = Date.now();
      let rows = barsFrom(pack.bars);
      if (range === '1D') {
        const start = intraSessionStart(pack.periods, pack.bars);
        const day = rows.filter(b => b.time >= start);
        if (day.length >= 2) rows = day;
      }
      const ohlc = rows.some(b => b.o != null && b.h != null && b.l != null);
      return { bars: rows, delay: 'On-demand Yahoo chart, delayed up to 15 minutes', source: pack.source, currency: pack.currency, dividends: (d0.dividends || []), ohlc };
    }
  }
  const d = await loadHist(id);
  if (!d) throw new Error('History unavailable');
  const intra = barsFrom(d.intraday || d.intra || []);
  const daily = barsFrom(d.daily || []);
  const now = Math.floor(Date.now() / 1000);
  const cut = rangeCut(range);
  let bars;
  if (range === '1D') {
    if (intra.length >= 2) {
      const start = intraSessionStart(d.periods, intra);
      bars = intra.filter(b => b.time >= start);
    }
    if (!bars || bars.length < 2) bars = daily.filter(b => b.time >= now - 5 * 86400);
  } else if (range === '1W') {
    bars = intra.filter(b => !cut || b.time >= cut);
    if (bars.length < 2) bars = daily.filter(b => !cut || b.time >= cut);
  } else {
    bars = daily.filter(b => !cut || b.time >= cut);
    if (bars.length < 2 && intra.length >= 2 && range === '1M') {
      bars = intra.filter(b => !cut || b.time >= cut);
    }
  }
  const ohlc = (bars || []).some(b => b.o != null && b.h != null && b.l != null);
  return { bars: bars || [], delay: d.delay || meta.delay, source: d.source, currency: d.currency, dividends: d.dividends || [], ohlc: ohlc };
}

function sma(bars, n) {
  const out = [];
  let sum = 0;
  for (let i = 0; i < bars.length; i++) {
    sum += bars[i].value;
    if (i >= n) sum -= bars[i - n].value;
    if (i >= n - 1) out.push({ time: bars[i].time, value: sum / n });
  }
  return out;
}
function ema(bars, n) {
  const out = [];
  const k = 2 / (n + 1);
  let prev = null;
  for (let i = 0; i < bars.length; i++) {
    const v = bars[i].value;
    prev = prev == null ? v : v * k + prev * (1 - k);
    if (i >= n - 1) out.push({ time: bars[i].time, value: prev });
  }
  return out;
}


function scaleBars(bars, from, to) {
  const r = fxRate(from === 'GBp' ? 'GBP' : from, to);
  if (r == null || r === 1 || !bars) return bars;
  return bars.map(b => {
    const o = Object.assign({}, b);
    for (const k of ['value', 'o', 'h', 'l', 'c']) if (o[k] != null && isFinite(o[k])) o[k] = o[k] * r;
    return o;
  });
}

function toPct(bars) {
  const base = bars.find(b => b.value != null);
  if (!base || !base.value) return [];
  return bars.map(b => ({ time: b.time, value: ((b.value - base.value) / base.value) * 100 }));
}

function drawChart(host, packA, packB, range, kind, ind, opts) {
  opts = opts || {};
  const LW = window.LightweightCharts;
  if (!LW) { host.innerHTML = '<div class="ph" style="display:grid;place-items:center;color:var(--mute)">Chart library failed to load.</div>'; return; }
  const apiKey = opts.api || 'chartApi';
  try { if (opts.api === 'fs') { if (fsChartApi) fsChartApi.remove(); fsChartApi = null; } else if (chartApi) { chartApi.remove(); chartApi = null; } } catch (e) {}
  if (opts.api !== 'fs') volApi = null;
  host.innerHTML = '';
  const dark = document.documentElement.dataset.theme === 'dark';
  const bars = packA.bars || [];
  if (bars.length < 2) { host.innerHTML = chartErrHTML('Not enough history for this range.'); return; }
  const lastV = bars[bars.length - 1].value, firstV = bars[0].value;
  const up = lastV >= firstV;
  const th = chartTheme(up);
  const packC = opts.packC;
  const comparing = !!(packB && packB.bars && packB.bars.length > 1);
  const wantCandles = kind === 'candles' && !comparing && bars.some(b => b.o != null && b.h != null && b.l != null);
  const showAxes = !!opts.showAxes;
  const volHost = opts.volHost || (opts.api === 'fs' ? null : $('#vol'));
  const hasVol = !comparing && kind === 'candles' && bars.some(b => b.v != null && b.v > 0) && volHost;
  if (volHost) volHost.hidden = !hasVol;
  const chart = LW.createChart(host, {
    autoSize: true,
    layout: { background: { color: 'transparent' }, textColor: dark ? '#8e8e93' : '#8e8e93', fontFamily: "Inter Tight, Inter, -apple-system, system-ui", fontSize: 11, attributionLogo: false },
    grid: { vertLines: { visible: false }, horzLines: { visible: showAxes, color: dark ? 'rgba(255,255,255,.06)' : 'rgba(16,16,14,.06)' } },
    rightPriceScale: { visible: showAxes, borderVisible: false, scaleMargins: { top: 0.1, bottom: 0.08 } },
    timeScale: { visible: showAxes, borderVisible: false, timeVisible: true, secondsVisible: false, rightOffset: 4, fixLeftEdge: true },
    crosshair: {
      vertLine: { color: dark ? 'rgba(255,255,255,.35)' : 'rgba(16,16,14,.35)', width: 1, style: 3, labelVisible: showAxes, labelBackgroundColor: dark ? '#1c1c20' : '#eceae4' },
      horzLine: { visible: true, color: dark ? 'rgba(255,255,255,.35)' : 'rgba(16,16,14,.35)', width: 1, style: 3, labelVisible: showAxes, labelBackgroundColor: dark ? '#1c1c20' : '#eceae4' }
    },
    handleScroll: !!showAxes, handleScale: !!showAxes
  });
  let series;
  if (wantCandles) {
    series = chart.addSeries(LW.CandlestickSeries, {
      upColor: '#00C805', downColor: '#FF5000',
      borderUpColor: '#00C805', borderDownColor: '#FF5000',
      wickUpColor: '#00C805', wickDownColor: '#FF5000'
    });
    series.setData(bars.map(b => ({ time: b.time, open: b.o ?? b.value, high: b.h ?? b.value, low: b.l ?? b.value, close: b.c ?? b.value })));
  } else if (comparing) {
    const a = toPct(bars), b = toPct(packB.bars);
    series = chart.addSeries(LW.LineSeries, { color: th.col, lineWidth: 3, priceLineVisible: false, title: packA.label || 'A' });
    const sb = chart.addSeries(LW.LineSeries, { color: dark ? '#8e8e93' : '#3a3a3c', lineWidth: 2, priceLineVisible: false, title: packB.label || 'B' });
    series.setData(a); sb.setData(b);
    if (packC && packC.bars && packC.bars.length > 1) {
      const sc = chart.addSeries(LW.LineSeries, { color: dark ? '#64d2ff' : '#0a84ff', lineWidth: 2, priceLineVisible: false, title: packC.label || 'C' });
      sc.setData(toPct(packC.bars));
    }
  } else {
    series = chart.addSeries(LW.AreaSeries, {
      lineColor: th.col, topColor: th.top, bottomColor: th.bot,
      lineWidth: 3, priceLineVisible: false, lastValueVisible: showAxes,
      crosshairMarkerRadius: 6, priceFormat: { type: 'price', precision: 2, minMove: 0.01 }
    });
    series.setData(bars.map(b => ({ time: b.time, value: b.value })));
  }
  if (!comparing && ind === 'sma') {
    const m = chart.addSeries(LW.LineSeries, { color: dark ? '#f5c542' : '#b8860b', lineWidth: 1.6, priceLineVisible: false, lastValueVisible: false });
    m.setData(sma(bars, 20));
  } else if (!comparing && ind === 'ema') {
    const m = chart.addSeries(LW.LineSeries, { color: dark ? '#c084fc' : '#7c3aed', lineWidth: 1.6, priceLineVisible: false, lastValueVisible: false });
    m.setData(ema(bars, 20));

  } else if (!comparing && ind === 'bb') {
    const bb = bollinger(bars, 20, 2);
    const upS = chart.addSeries(LW.LineSeries, { color: dark ? 'rgba(255,255,255,.45)' : 'rgba(0,0,0,.35)', lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
    const midS = chart.addSeries(LW.LineSeries, { color: dark ? '#f5c542' : '#b8860b', lineWidth: 1.4, priceLineVisible: false, lastValueVisible: false });
    const loS = chart.addSeries(LW.LineSeries, { color: dark ? 'rgba(255,255,255,.45)' : 'rgba(0,0,0,.35)', lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
    upS.setData(bb.upper); midS.setData(bb.mid); loS.setData(bb.lower);
  }
  const guides = [];
  const prev = opts.prevClose;
  if (!comparing && prev != null) {
    addGuideLine(series, prev, 'Prev close', dark ? 'rgba(255,255,255,.35)' : 'rgba(0,0,0,.3)');
    guides.push(prev);
  }
  const buy = opts.buyPrice;
  const wrap = host.parentElement;
  if (wrap) wrap.querySelectorAll('.buy-edge').forEach(n => n.remove());
  if (!comparing && buy != null) {
    const cur = opts.buyCurrency || 'USD';
    const label = 'Avg buy ' + fmtNum(buy, cur, { px: true });
    const vs = bars.map(b => b.value).filter(v => v != null && isFinite(v));
    const lo = vs.length ? Math.min.apply(null, vs) : buy;
    const hi = vs.length ? Math.max.apply(null, vs) : buy;
    const span = (hi - lo) || Math.abs(hi) || 1;
    const far = buy < lo - 0.12 * span || buy > hi + 0.12 * span;
    if (far && wrap) {
      const tag = document.createElement('div');
      const above = buy > hi;
      tag.className = 'buy-edge' + (above ? '' : ' lo');
      tag.textContent = label + (above ? ' ↑' : ' ↓');
      wrap.appendChild(tag);
    } else {
      addGuideLine(series, buy, label, dark ? 'rgba(255,255,255,.7)' : 'rgba(0,0,0,.55)');
      guides.push(buy);
    }
  }
  includeInScale(series, guides);
  if (hasVol && volHost) {
    volHost.innerHTML = '';
    const vc = LW.createChart(volHost, {
      autoSize: true, height: 72,
      layout: { background: { color: 'transparent' }, textColor: dark ? '#8e8e93' : '#8e8e93', fontFamily: "Inter Tight, Inter, -apple-system, system-ui", fontSize: 10, attributionLogo: false },
      grid: { vertLines: { visible: false }, horzLines: { visible: false } },
      rightPriceScale: { visible: showAxes, borderVisible: false, scaleMargins: { top: 0.15, bottom: 0 } },
      timeScale: { visible: false, borderVisible: false }, handleScroll: false, handleScale: false
    });
    const vs = vc.addSeries(LW.HistogramSeries, { priceLineVisible: false, lastValueVisible: false, priceFormat: { type: 'volume' } });
    vs.setData(bars.map((b, i) => ({ time: b.time, value: b.v || 0, color: (i && b.c < bars[i-1].c) ? '#FF500088' : '#00C80588' })));
    vc.timeScale().setVisibleLogicalRange(chart.timeScale().getVisibleLogicalRange());
    chart.timeScale().subscribeVisibleLogicalRangeChange(r => { try { vc.timeScale().setVisibleLogicalRange(r); } catch (e) {} });
    volApi = vc;
  }
  chart.timeScale().fitContent();
  const fmtVal = v => {
    if (comparing) return (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
    const id = opts.id || detailId;
    const q = quotes[id] || {};
    if (isIndexId(id, q) || isCommodityId(id, q)) return pxText(id, v, { px: true });
    return fmtNum(v, packA.currency || q.currency || ccy || 'USD', { px: true });
  };
  bindCrosshair(chart, series, host, fmtVal);
  if (opts.api === 'fs') {
    fsChartApi = chart;
    paintFsPane(bars, ind, dark, chart);
    drawTrendLines(chart, series, showAxes);
  } else chartApi = chart;
}

function scalePack(pack, from, to) {
  if (!pack) return pack;
  from = from === 'GBp' ? 'GBP' : from;
  to = to === 'GBp' ? 'GBP' : to;
  if (!from || !to || from === to) return Object.assign({}, pack, { currency: to || from });
  const r = fxRate(from, to);
  if (r == null || r === 1) return Object.assign({}, pack, { currency: from });
  const scale = bars => (bars || []).map(b => {
    const o = Object.assign({}, b);
    ['o','h','l','c','value'].forEach(k => { if (o[k] != null && isFinite(o[k])) o[k] = o[k] * r; });
    return o;
  });
  return Object.assign({}, pack, { bars: scale(pack.bars), currency: to });
}
function displayCcyFor(id) {
  const q = quotes[id] || {};
  if (isIndexId(id, q) || isCommodityId(id, q) || isYieldId(id, q)) return q.currency || 'USD';
  return ccy;
}
async function loadDetailChart() {
  if (!detailId) return;
  const host = $('#chart'); if (!host) return;
  host.innerHTML = '<div class="ph">Loading chart…</div>';
  const note = $('#delayNote');
  try {
    let packA = isCryptoId(detailId) || pairs[detailId]
      ? { bars: await cryptoBars(detailId, chartRange), delay: 'Kraken public OHLC', source: 'Kraken', label: coin(detailId), ohlc: true }
      : Object.assign(await stockPack(detailId, chartRange), { label: detailId });
    let packB = null, packC = null;
    if (compareId) {
      packB = isCryptoId(compareId) || pairs[compareId]
        ? { bars: await cryptoBars(compareId, chartRange), label: coin(compareId) }
        : Object.assign(await stockPack(compareId, chartRange), { label: compareId });
    }
    if (compareId2) {
      packC = isCryptoId(compareId2) || pairs[compareId2]
        ? { bars: await cryptoBars(compareId2, chartRange), label: coin(compareId2) }
        : Object.assign(await stockPack(compareId2, chartRange), { label: compareId2 });
    }
    const fromA = packA.currency || ((isCryptoId(detailId) || pairs[detailId]) ? 'USD' : ((quotes[detailId] && quotes[detailId].currency) || 'USD'));
    const toA = displayCcyFor(detailId);
    if (!isIndexId(detailId) && !isCommodityId(detailId) && !isYieldId(detailId)) {
      packA = scalePack(packA, fromA, toA);
      if (packB) {
        const fromB = packB.currency || ((isCryptoId(compareId) || pairs[compareId]) ? 'USD' : ((quotes[compareId] && quotes[compareId].currency) || 'USD'));
        packB = scalePack(packB, fromB, toA);
      }
      if (packC && !isIndexId(compareId2) && !isCommodityId(compareId2) && !isYieldId(compareId2)) {
        const fromC = packC.currency || ((isCryptoId(compareId2) || pairs[compareId2]) ? 'USD' : ((quotes[compareId2] && quotes[compareId2].currency) || 'USD'));
        packC = scalePack(packC, fromC, toA);
      }
    }
    if (note) {
      const cur = isIndexId(detailId) ? 'index points' : (isCommodityId(detailId) ? 'USD' : (packA.currency || toA));
      const bits = [];
      if (isCryptoId(detailId)) bits.push('Kraken public OHLC.');
      else bits.push('Yahoo Finance, delayed up to 15 minutes.');
      const q0 = quotes[detailId] || {};
      if (q0.session === 'post') bits.push('Last price is the extended-hours print; official regular close is listed under Key stats.');
      else if (q0.session === 'pre') bits.push('Last price is a pre-market print; official regular close is listed under Key stats.');
      if (!compareId) bits.push('Chart in ' + cur + '.');
      if (!compareId && !isCryptoId(detailId) && !isIndexId(detailId) && (q0.session === 'post' || q0.session === 'pre')) bits.push('The 1D chart includes the regular session and extended hours.');
      if (compareId) bits.push('Compared as % change from first bar.');
      if (chartKind === 'candles' && (!packA.ohlc || compareId)) bits.push(compareId ? 'Comparison uses lines.' : 'This range has close-only bars, so a line is shown.');
      note.textContent = bits.filter(Boolean).join(' ');
    }
    const q0 = quotes[detailId] || {};
    const buy = holdingAvg(detailId);
    const prev = q0.prev != null ? q0.prev : q0.regularClose;
    const chartCcy = packA.currency || toA;
    const native = q0.currency || fromA || 'USD';
    const conv = v => (v == null || isIndexId(detailId) || isCommodityId(detailId)) ? v : convert(v, native, chartCcy);
    drawChart(host, packA, packB, chartRange, chartKind, chartInd, {
      packC: packC,
      id: detailId, buyPrice: conv(buy), buyCurrency: chartCcy,
      prevClose: (!compareId ? conv(prev) : null), showAxes: false
    });
  } catch (e) {
    host.innerHTML = chartErrHTML((e && e.message) ? ('Could not load this chart. ' + e.message) : 'Could not load this chart.');
    if (note) note.textContent = '';
  }
}



function investHTML(id, q) {
  const held = holdings.filter(h => h.id === id);
  if (!held.length) return '';
  const qty = held.reduce((s, h) => s + (h.qty || 0), 0);
  const costN = held.reduce((s, h) => s + ((h.avg != null && h.qty) ? h.avg * h.qty : 0), 0);
  const hasCost = held.some(h => h.avg != null);
  const native = (q && q.currency) || 'USD';
  const valN = (q && q.price != null) ? q.price * qty : null;
  const pnlN = (valN != null && hasCost) ? valN - costN : null;
  const pnlPct = (pnlN != null && costN) ? pnlN / costN * 100 : null;
  const avgN = (hasCost && qty) ? costN / qty : (held[0] && held[0].avg);
  const valShow = valN != null ? money(valN, native) : '—';
  const pnlShow = pnlN != null ? ((pnlN >= 0 ? '+' : '') + money(pnlN, native)) : '—';
  const avgNative = avgN != null ? fmtNum(avgN, native, { px: true, native: true }) : '—';
  const avgOther = (avgN != null && native !== ccy && fxRate(native, ccy)) ? ' (' + fmtNum(convert(avgN, native, ccy), ccy, { px: true }) + ')' : '';
  const qtyStr = (qty != null && isFinite(qty)) ? fmtQty(qty) : '—';
  return '<div class="invest"><h2>Your investment</h2>' +
    '<div class="kv"><span class="k">Value</span><span class="v">' + valShow + '</span></div>' +
    '<div class="kv"><span class="k">Return</span><span class="v ' + chgClass(pnlN) + '">' + pnlShow + (pnlPct != null ? ' (' + Math.abs(pnlPct).toFixed(2) + '%)' : '') + '</span></div>' +
    '<div class="kv"><span class="k">Shares</span><span class="v">' + esc(qtyStr) + '</span></div>' +
    '<div class="kv"><span class="k">Average price</span><span class="v">' + avgNative + avgOther + '</span></div>' +
    '<div class="trade-btns"><button class="btn" data-act="edit-hold" data-id="' + esc(id) + '">Sell</button>' +
    '<button class="btn" data-act="add-hold" data-id="' + esc(id) + '">Buy</button></div>' +
    '<p class="fine-under">Updates the holding stored on this device. This is not a broker order.</p></div>';
}

function consensusHTML(rec) {
  const c = rec && rec.consensus;
  if (!c || (!c.n && !c.key)) return '<p class="note">No analyst consensus is available from our sources for this asset.</p>';
  const sb = c.strongBuy, b = c.buy || 0, h = c.hold || 0, sl = c.sell || 0, ss = c.strongSell;
  const five = sb != null || ss != null;
  const n = c.n || ((sb || 0) + b + h + sl + (ss || 0));
  const segs = five
    ? [['sb', sb || 0, 'Strong Buy'], ['b', b, 'Buy'], ['h', h, 'Hold'], ['s', sl, 'Sell'], ['ss', ss || 0, 'Strong Sell']]
    : [['b', b, 'Buy'], ['h', h, 'Hold'], ['s', sl, 'Sell']];
  const bar = segs.map(x => x[1] ? '<i class="' + x[0] + '" style="width:' + ((x[1] / (n || 1)) * 100).toFixed(2) + '%"></i>' : '').join('');
  const keys = segs.map(x => '<span><i class="cons-bar" style="display:inline-block;width:8px;height:8px;vertical-align:middle;margin-right:5px;border-radius:2px"></i>' + x[1] + ' ' + x[2] + '</span>');
  // simpler legend
  const legend = segs.map(x => '<span><i class="' + x[0] + '"></i>' + x[1] + ' ' + x[2] + '</span>').join('');
  let changes = '';
  const ups = ((rec && rec.upgradesDowngrades) || []).slice(0, 8);
  const hist = ((rec && rec.ratingChanges) || []).slice(-4);
  if (ups.length) {
    changes = ups.map(u => {
      const bits = [u.firm || u.brokerName, u.action, (u.fromGrade && u.toGrade) ? (u.fromGrade + ' → ' + u.toGrade) : (u.toGrade || ''), u.date].filter(Boolean);
      return '<div class="event"><span class="k">Rating</span><span class="v">' + esc(bits.join(' · ')) + '</span></div>';
    }).join('');
  } else if (hist.length) {
    changes = hist.map(u => '<div class="event"><span class="k">' + esc(u.date || 'Consensus') + '</span><span class="v">' + esc(u.label || ((u.from || '') + ' → ' + (u.to || ''))) + '</span></div>').join('');
  }
  return '<div class="cons-bar">' + bar + '</div>' +
    '<p class="cons-meta"><b>' + esc(c.key || '—') + '</b>' + (n ? ' · ' + n + ' analyst' + (n === 1 ? '' : 's') : '') +
    (c.scheme === 'buy-hold-sell' ? ' · Buy / Hold / Sell (Nasdaq does not split Strong Buy or Strong Sell)' : '') + '</p>' +
    '<div class="cons-keys">' + legend + '</div>' +
    changes +
    (rec.source ? '<p class="note">Source: Nasdaq' + (rec.asOf ? ' · as of ' + esc(ago(rec.asOf)) : '') + '. Mean target is compared with the Yahoo last price in this app.</p>' : '');
}

function targetHTML(rec, q) {
  const t = rec && rec.targets;
  if (!t || (t.mean == null && t.low == null && t.high == null)) {
    return '<p class="note">No published price targets were available from our sources.</p>';
  }
  const cur = (q && q.currency) || t.currency || 'USD';
  const px = q && q.price;
  const nums = [t.low, t.mean, t.high, px].filter(v => v != null && isFinite(v));
  const min = Math.min(...nums), max = Math.max(...nums);
  const span = (max - min) || 1;
  const pad = span * 0.08;
  const lo = min - pad, hi = max + pad, w = hi - lo;
  const pos = v => ((v - lo) / w * 100);
  const lab = v => fmtNum(v, t.currency || cur, { px: true, native: true });
  let marks = '';
  if (t.low != null) marks += '<span class="tgt-lab" style="left:' + pos(t.low) + '%">Low ' + lab(t.low) + '</span><i class="tgt-mark" style="left:' + pos(t.low) + '%"></i>';
  if (t.high != null) marks += '<span class="tgt-lab" style="left:' + pos(t.high) + '%">High ' + lab(t.high) + '</span><i class="tgt-mark" style="left:' + pos(t.high) + '%"></i>';
  if (t.mean != null) marks += '<span class="tgt-lab" style="left:' + pos(t.mean) + '%;top:-32px">Mean ' + lab(t.mean) + '</span><i class="tgt-mark mean" style="left:' + pos(t.mean) + '%"></i>';
  if (px != null) marks += '<span class="tgt-lab now" style="left:' + pos(px) + '%">Now ' + lab(px) + '</span><i class="tgt-mark now" style="left:' + pos(px) + '%"></i>';
  const left = t.low != null ? pos(t.low) : pos(min);
  const right = t.high != null ? pos(t.high) : pos(max);
  const upside = rec.impliedUpsidePct;
  const cap = (t.mean != null && upside != null)
    ? (upside >= 0
      ? 'The mean target is ' + Math.abs(upside).toFixed(0) + '% above the latest Yahoo price.'
      : 'The mean target is ' + Math.abs(upside).toFixed(0) + '% below the latest Yahoo price.')
    : '';
  const mid = (t.median != null) ? ' Median ' + lab(t.median) + '.' : ' Nasdaq does not publish a median target.';
  return '<div class="tgt"><div class="tgt-scale"><div class="tgt-track"><i class="tgt-range" style="left:' + left + '%;width:' + (right - left) + '%"></i>' + marks + '</div></div>' +
    '<p class="tgt-cap">' + cap + mid + (t.low != null && t.high != null ? ' Range ' + lab(t.low) + '–' + lab(t.high) + '.' : '') + '</p></div>';
}

function eventsHTML(rec, q) {
  const rows = [];
  const nxt = rec && rec.nextEarnings;
  if (nxt) {
    const d = nxt.date || nxt.earningsDate || nxt.time;
    rows.push(['Next earnings', String(d)]);
  }
  const last = rec && rec.lastEarnings;
  if (last) {
    const bits = [];
    if (last.dateReported) bits.push(last.dateReported);
    if (last.fiscalQtrEnd) bits.push('FQ ' + last.fiscalQtrEnd);
    if (last.eps != null) bits.push('EPS ' + last.eps);
    if (last.consensusForecast != null) bits.push('est. ' + last.consensusForecast);
    if (last.surprisePct != null) bits.push((last.surprisePct >= 0 ? '+' : '') + last.surprisePct + '% surprise');
    rows.push(['Last earnings', bits.join(' · ') || 'Reported']);
  }
  if (q && q.lastDiv && q.lastDiv.date) {
    const when = new Date((q.lastDiv.date < 1e12 ? q.lastDiv.date * 1000 : q.lastDiv.date)).toLocaleDateString('en-GB', { timeZone: 'Europe/London' });
    const amt = q.lastDiv.amount != null ? fmtNum(q.lastDiv.amount, q.currency || 'USD', { px: true, native: true }) : '';
    rows.push(['Last dividend', (amt ? amt + ' · ' : '') + when]);
  }
  if (!rows.length) return '<p class="note">No upcoming earnings date or dividend was listed in the latest refresh.</p>';
  return rows.map(r => '<div class="event"><span class="k">' + esc(r[0]) + '</span><span class="v">' + esc(r[1]) + '</span></div>').join('');
}

function localizeMoneyText(text, native) {
  if (!text) return text;
  return String(text).replace(/(£|\$|€)\s?(\d{1,3}(?:,\d{3})*(?:\.\d+)?|\d+(?:\.\d+)?)/g, (m, sym, num) => {
    const src = sym === '£' ? 'GBP' : (sym === '€' ? 'EUR' : 'USD');
    if (src === ccy) return m;
    const n = parseFloat(String(num).replace(/,/g, ''));
    if (!isFinite(n)) return m;
    const v = convert(n, src, ccy);
    if (v == null || !isFinite(v)) return m;
    return fmtNum(v, ccy, { px: true });
  });
}
function aiCatHTML(c) {
  const when = c.dateLabel || (c.date ? c.date : '');
  const href = c.url ? '<a href="' + esc(c.url) + '" target="_blank" rel="noopener noreferrer">' + esc(c.title || '') + '</a>' : esc(c.title || '');
  const meta = [when, c.source, c.kind].filter(Boolean).join(' · ');
  return '<li><div class="ai-cat">' + href + (meta ? '<span>' + esc(meta) + '</span>' : '') + '</div></li>';
}
function aiCaseItemHTML(row) {
  const src = row.source && row.url
    ? ' <a class="ai-src" href="' + esc(row.url) + '" target="_blank" rel="noopener noreferrer">' + esc(row.source) + '</a>'
    : (row.source ? ' <span class="ai-src">' + esc(row.source) + '</span>' : '');
  return '<li>' + esc(row.text || row.title || '') + src + '</li>';
}
function aiDisclaimer(rec) {
  const when = rec && rec.asOf ? ago(rec.asOf) : (aiAnalysis && aiAnalysis.generated_at ? ago(aiAnalysis.generated_at) : '');
  return '<p class="ai-lbl">' + esc((rec && rec.label) || 'AI-generated, not financial advice') + (when ? ' · updated ' + esc(when) : '') + '</p>';
}
function aiFullBodyHTML(rec) {
  let html = '<div class="ai-card">';
  if (rec.bull && rec.bull.length) html += '<div class="ai-case bull"><h3>Bull case</h3><ul>' + rec.bull.map(aiCaseItemHTML).join('') + '</ul></div>';
  if (rec.bear && rec.bear.length) html += '<div class="ai-case bear"><h3>Bear case</h3><ul>' + rec.bear.map(aiCaseItemHTML).join('') + '</ul></div>';
  if (rec.catalysts && rec.catalysts.length) html += '<div class="ai-cats"><h3>Catalysts</h3><ul>' + rec.catalysts.map(aiCatHTML).join('') + '</ul></div>';
  html += aiDisclaimer(rec) + '</div>';
  return html;
}
function aiAnalysisHTML(id, kind) {
  if (kind === 'crypto' || kind === 'fx') return '';
  const rec = aiRec(id);
  if (!rec || (!(rec.bull && rec.bull.length) && !(rec.bear && rec.bear.length) && !(rec.catalysts && rec.catalysts.length))) {
    return '<div class="block ai-block"><h2>AI analysis</h2><p class="note">No sourced analysis for this ticker yet. It will appear after the next refresh. AI-generated, not financial advice.</p></div>';
  }
  const outlook = (rec.bull && rec.bull[0] && rec.bull[0].text) || (rec.bear && rec.bear[0] && rec.bear[0].text) || '';
  const cats = (rec.catalysts || []).slice(0, 2);
  let html = '<div class="block ai-block"><h2>AI analysis</h2><div class="ai-card ai-preview">';
  if (outlook) html += '<p class="ai-outlook">' + esc(outlook) + '</p>';
  if (cats.length) html += '<div class="ai-cats"><h3>Catalysts</h3><ul>' + cats.map(aiCatHTML).join('') + '</ul></div>';
  html += '<button type="button" class="see-all" data-act="open-ai" data-id="' + esc(id) + '">See full analysis</button>';
  html += aiDisclaimer(rec);
  html += '</div></div>';
  return html;
}
let aiPageId = null;
function openAiPage(id, opts) {
  opts = opts || {};
  const rec = aiRec(id);
  const el = $('#aiPage');
  if (!el) return;
  if (readerItem) closeReader(true);
  if (listState) closeListPage(true);
  aiPageId = id;
  const q = quotes[id] || {};
  const name = q.name || q.shortName || id;
  const body = rec
    ? aiFullBodyHTML(rec)
    : '<p class="note">No sourced analysis for this ticker yet. AI-generated, not financial advice.</p>';
  el.innerHTML = '<div class="d-bar"><button class="ib" data-act="close-ai" aria-label="Back"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg></button><h2>AI analysis</h2><span style="width:36px"></span></div>' +
    '<div class="d-in ai-page"><p class="ai-page-sub">' + esc(name) + ' · ' + esc(q.symbol || id) + '</p>' + body + '</div>';
  el.hidden = false;
  document.body.classList.add('hide-dock');
  if (!opts.fromHash) history.pushState({ ai: id }, '', '#/ai/' + encodeURIComponent(id));
}
function closeAiPage(fromPop) {
  const el = $('#aiPage');
  if (el) { el.hidden = true; el.innerHTML = ''; }
  aiPageId = null;
  document.body.classList.remove('hide-dock');
  if (!fromPop && location.hash.indexOf('#/ai/') === 0) {
    if (history.length > 1) history.back();
    else history.replaceState(null, '', '#/s/' + encodeURIComponent(detailId || ''));
  }
}
function outlookHTML(rec, kind) {
  if (kind === 'crypto') {
    return '<p class="outlook">No analyst coverage. Crypto prices come from Kraken; there is no broker recommendation set in our sources.</p>';
  }
  const o = rec && rec.outlook;
  if (!o || !o.text) return '<p class="note">No automated outlook has been generated yet for this asset.</p>';
  const native = (rec.targets && rec.targets.currency) || (rec.currency) || 'USD';
  return '<p class="outlook">' + esc(localizeMoneyText(o.text, native)) + '<span class="lbl">' + esc(o.label || 'Automated outlook from analyst data and news, not financial advice') + (o.asOf ? ' · ' + esc(ago(o.asOf)) : '') + '</span></p>';
}


async function renderDetail(id, reuse) {
  const el = $('#detail');
  const q = quotes[id] || {};
  const name = q.name || (pairs[id] && pairs[id].name) || COIN_NAMES[coin(id)] || id;
  const sym = q.symbol || (isCryptoId(id) ? coin(id) : id);
  const kind = kindOf(id, q);
  const saved = watchSyms().includes(id);
  const held = holdings.filter(h => h.id === id);
  const ihOk = kind !== 'crypto' && !String(id).startsWith('^') && !id.includes('=X');
  const stockish = kind !== 'crypto';
  const rec = analysisRec(id);
  const delay = stockish
    ? (meta.delay || 'Stock, ETF and index quotes are delayed up to 15 minutes (Yahoo Finance).')
    : (q.live ? 'Live last trade from Kraken.' : 'Kraken public ticker.');
  const newsBits = ((news && news.bySymbol && news.bySymbol[id]) || []).filter(n => !isStubHeadline(n)).slice(0, 12);
  const range = chartRange || el.dataset.range || (kind === 'crypto' ? '1D' : '1D');
  chartRange = range;
  el.dataset.range = range;
  const ex = exchName(q, id);
  const sess = sessionTag(q);
  const hl = priceHeadline(id, q);
  const pts = kind === 'index';
  applyDayTheme(q.change == null || q.change >= 0);

  let extras = '';
  extras += investHTML(id, q);
  extras += aiAnalysisHTML(id, kind);
  if (kind === 'crypto' || !aiRec(id)) extras += '<div class="block"><h2>Outlook</h2>' + outlookHTML(rec, kind) + '</div>';
  if (kind === 'crypto') {
    extras += '<div class="block"><h2>Analyst consensus</h2><p class="note">No analyst coverage.</p></div>';
    extras += '<div class="block"><h2>Market data</h2><div class="stats">' +
      stat('24h open', q.prev, q.currency, null, false) +
      stat('Day high', q.dayHigh, q.currency) +
      stat('Day low', q.dayLow, q.currency) +
      stat('52-week high', q.high52, q.currency) +
      stat('52-week low', q.low52, q.currency) +
      (q.asOf ? stat('As of', null, null, q.live ? 'Live' : when(q.asOf)) : '') +
      '</div></div>';
  } else {
    extras += '<div class="block"><h2>Analyst consensus</h2>' + consensusHTML(rec) + '</div>';
    extras += '<div class="block"><h2>Price target</h2>' + targetHTML(rec, q) + '</div>';
    extras += '<div class="block"><h2>Key stats</h2><div class="stats">' +
      stat(stockish ? 'Previous close' : '24h open', q.prev, q.currency, null, pts) +
      stat('Day high', q.dayHigh, q.currency, null, pts) +
      stat('Day low', q.dayLow, q.currency, null, pts) +
      stat('52-week high', q.high52, q.currency, null, pts) +
      stat('52-week low', q.low52, q.currency, null, pts) +
      ((q.session === 'post' || q.session === 'pre') && q.regularClose != null ? stat('At close', q.regularClose, q.currency, null, pts) : '') +
      ((rec && rec.sma50 != null) || q.sma50 != null ? stat('50-day average', rec && rec.sma50 != null ? rec.sma50 : q.sma50, q.currency, null, pts) : '') +
      ((rec && rec.sma200 != null) || q.sma200 != null ? stat('200-day average', rec && rec.sma200 != null ? rec.sma200 : q.sma200, q.currency, null, pts) : '') +
      (q.asOf ? stat('As of', null, null, q.live ? 'Live' : (when(q.asOf) + (q.session === 'post' ? ' · after hours' : q.session === 'pre' ? ' · pre-market' : ''))) : '') +
      '<div class="stats-span"><p class="note">' + esc(delay) + (kind === 'index' ? ' Levels are index points, not a currency, and are not converted when you switch GBP/USD.' : '') + '</p></div></div></div>';
    extras += '<div class="block"><h2>Upcoming events</h2>' + eventsHTML(rec, q) + '</div>';
    extras += '<div id="earnHist"></div>';
    extras += politicianHTML(id);
    const inst = instrumentRec(id);
    if (kind === 'etf' || (inst && inst.kind === 'etf')) {
      extras += '<div class="block"><h2>ETF details</h2><div class="stats">' +
        (inst && inst.issuer ? stat('Issuer', null, null, inst.issuer) : '') +
        (inst && inst.expenseRatio != null ? stat('Expense ratio', null, null, inst.expenseRatio.toFixed(2) + '%') : '') +
        (inst && inst.isin ? stat('ISIN', null, null, inst.isin) : '') +
        '<div class="stats-span"><p class="note">Expense ratios are typical published figures and can change. Not financial advice.</p></div></div></div>';
    }
  }
  rememberNews(newsBits);
  extras += '<div class="block"><h2>News</h2>' +
    (newsBits.length ? newsListHTML(newsBits, 'No headlines in the latest refresh for this symbol.', { logoId: id, finance: kind !== 'crypto' }) : '<p class="note">No headlines in the latest refresh for this symbol.</p>') +
    ((news && news.delay) ? '<p class="note">' + esc(news.delay) + '</p>' : '') + '</div>';
  if (ihOk) extras += '<p class="fine-under" style="margin-top:20px"><a href="' + IH + '#t=' + encodeURIComponent(id) + '" target="_blank" rel="noopener">Open in Insider House</a></p>';

  el.hidden = false;
  document.body.classList.add('hide-dock');
  if (!reuse) { el.classList.remove('out'); el.scrollTop = 0; }
  el.innerHTML =
    '<div class="d-bar">' +
      '<button class="ib" data-act="close-detail" aria-label="Back"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg></button>' +
      '<h2></h2>' +
      '<button class="ib" data-act="toggle-watch" data-id="' + esc(id) + '" aria-label="' + (saved ? 'Remove from watchlist' : 'Add to watchlist') + '">' +
        '<svg viewBox="0 0 24 24">' + (saved
          ? '<path d="M12 4l2.4 5 5.6.8-4 3.9.9 5.6L12 16.8 7.1 19.3l.9-5.6-4-3.9 5.6-.8z" fill="currentColor" stroke="none"/>'
          : '<path d="M12 4l2.4 5 5.6.8-4 3.9.9 5.6L12 16.8 7.1 19.3l.9-5.6-4-3.9 5.6-.8z"/>') + '</svg></button>' +
    '</div>' +
    '<div class="d-in">' +
      '<div class="d-head">' + avHTML(id, name, kind, 'lg') +
        '<div class="who"><div class="ex">' + esc(sym) + (ex ? ' · ' + esc(ex) : '') + '</div>' +
        '<div class="nm">' + esc(name) + '</div></div></div>' +
      '<div class="d-px" id="dPx">' + hl.px + '</div>' +
      '<div class="d-chg ' + chgClass(q.changePct) + '" id="dChg">' + hl.chg + (sess ? ' <span class="sess">' + esc(sess) + '</span>' : '') + '</div>' +
      '<div class="chart-bleed"><div id="chart"><div class="ph">Loading chart…</div></div><div id="vol" hidden></div>' +
      '<button type="button" class="chart-fs-btn" data-act="chart-fs" data-src="detail" aria-label="Full-screen chart"><svg viewBox="0 0 24 24"><path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5"/></svg></button></div>' +
      '<div class="rng" id="ranges">' + ['1D','1W','1M','3M','YTD','1Y','MAX'].map(r =>
        '<button type="button" data-range="' + r + '" class="' + (r===range?'on':'') + '">' + (r==='MAX'?'All':r) + '</button>').join('') + '</div>' +
      '<div class="tools">' +
        '<button type="button" data-kind="line" class="' + (chartKind!=='candles'?'on':'') + '">Line</button>' +
        '<button type="button" data-kind="candles" class="' + (chartKind==='candles'?'on':'') + '">Candles</button>' +
        '<button type="button" data-ind="off" class="' + ((chartInd||'off')==='off'?'on':'') + '">No MA</button>' +
        '<button type="button" data-ind="sma" class="' + (chartInd==='sma'?'on':'') + '">SMA 20</button>' +
        '<button type="button" data-ind="ema" class="' + (chartInd==='ema'?'on':'') + '">EMA 20</button>' +
        '<button type="button" data-act="compare" class="' + (compareId?'on':'') + '">' + esc(compareId ? ('vs ' + [compareId, compareId2].filter(Boolean).map(x => (quotes[x] && (quotes[x].symbol || x)) || x).join(', ')) : 'Compare') + '</button>' +
      '</div>' +
      '<p class="note" id="delayNote"></p>' +
      extras +
    '</div>';
  bindDetailTools();
  loadDetailChart();
  if (kind !== 'crypto') {
    earningsHistoryHTML(id).then(html => {
      const el = $('#earnHist');
      if (el && detailId === id) el.innerHTML = html;
    });
  }
}


function bindDetailTools() {
  const ranges = $('#ranges');
  if (ranges) ranges.addEventListener('click', e => {
    const b = e.target.closest('button[data-range]'); if (!b) return;
    chartRange = b.dataset.range;
    $$('#ranges button').forEach(x => x.classList.toggle('on', x === b));
    loadDetailChart();
  });
  const tools = document.querySelector('#detail .tools');
  if (tools) tools.addEventListener('click', e => {
    const k = e.target.closest('button[data-kind]');
    const ind = e.target.closest('button[data-ind]');
    if (k) {
      chartKind = k.dataset.kind; store.set('chartKind', chartKind);
      $$('#detail .tools [data-kind]').forEach(x => x.classList.toggle('on', x === k));
      loadDetailChart();
    }
    if (ind) {
      chartInd = ind.dataset.ind; store.set('chartInd', chartInd);
      $$('#detail .tools [data-ind]').forEach(x => x.classList.toggle('on', x === ind));
      loadDetailChart();
    }
  });
}

function openModal(html) { const m = $('#modal'); m.innerHTML = html; m.hidden = false; }
function closeModal() { $('#modal').hidden = true; $('#modal').innerHTML = ''; }
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(t._t); t._t = setTimeout(() => t.hidden = true, 2800); }

function searchPool() {
  const seen = new Set(), rows = [];
  for (const q of Object.values(quotes)) {
    if (!q || q.kind === 'fx' || seen.has(q.id)) continue;
    seen.add(q.id);
    rows.push({ id: q.id, name: q.name, symbol: q.symbol || q.id, kind: q.kind });
  }
  for (const p of Object.values(pairs)) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    rows.push({ id: p.id, name: p.name, symbol: p.code, kind: 'crypto' });
  }
  for (const it of (instruments.items || [])) {
    if (!it || !it.id || seen.has(it.id) || it.kind === 'fx') continue;
    seen.add(it.id);
    rows.push({ id: it.id, name: it.name, symbol: it.symbol || it.id, kind: it.kind, t212: true });
  }
  return rows;
}
function searchHits(q) {
  q = (q || '').trim().toLowerCase();
  const pool = searchPool();
  if (!q) return pool.slice(0, 16);
  return pool.filter(r =>
    (r.symbol && r.symbol.toLowerCase().includes(q)) ||
    (r.name && r.name.toLowerCase().includes(q)) ||
    r.id.toLowerCase().includes(q)
  ).slice(0, 30);
}

function openSearch(mode) {
  const title = mode === 'compare' ? 'Compare with' : mode === 'hold' ? 'Add a holding' : mode === 'alert' ? 'Alert on' : 'Search';
  openModal('<div class="sheet"><div class="grab"></div><header><h3>' + title + '</h3><button class="x" data-act="close">Close</button></header>' +
    '<div class="field"><label for="q">Search</label><input id="q" type="search" placeholder="AAPL, VUSA.L, bitcoin…" autocomplete="off" enterkeyhint="search"></div>' +
    '<p class="hint">Search covers the S&amp;P 500, Nasdaq-100, FTSE 100 and popular ETFs, plus live Kraken crypto. Quotes for the liquid set are refreshed automatically; others are fetched when you open them.</p>' +
    '<div id="hits" class="list"></div></div>');
  const box = $('#q'), hits = $('#hits');
  const paint = () => {
    const rows = searchHits(box.value);
    hits.innerHTML = rows.length
      ? rows.map(r => '<button class="row" data-act="pick" data-id="' + esc(r.id) + '">' + avHTML(r.id, r.name, r.kind) +
          '<div class="mid"><div class="nm">' + esc(r.name || r.id) + '</div><div class="tk">' + esc(r.symbol) + ' · ' + esc(r.kind) + '</div></div></button>').join('')
      : '<div class="empty"><p>No match in this universe. Custom tickers outside the curated list cannot be quoted from this static site.</p></div>';
  };
  paint();
  box.addEventListener('input', paint);
  box.focus();
  $('#modal')._mode = mode;
}

function pickFromSearch(id) {
  const mode = $('#modal')._mode;
  closeModal();
  if (mode === 'compare') {
    if (compareId && compareId !== id && !compareId2) compareId2 = id;
    else { compareId = id; compareId2 = null; }
    if (detailId) {
      let h = '#/s/' + encodeURIComponent(detailId) + '/vs/' + encodeURIComponent(compareId);
      if (compareId2) h += '/vs/' + encodeURIComponent(compareId2);
      location.hash = h;
    }
    return;
  }
  if (mode === 'hold') return openHold(id);
  if (mode === 'alert') return openAlert(id);
  addToWatch(id);
  location.hash = '#/s/' + encodeURIComponent(id);
}

function addToWatch(id) {
  const l = watchlists.find(x => x.id === activeWatch) || watchlists[0];
  if (!l.symbols.includes(id)) { l.symbols.push(id); saveLists(); }
  if (pairs[id] || isCryptoId(id)) { loadCryptoOnce().then(() => { connectWS(); renderAll(); }); }
  renderWatch();
}

function openHold(id) {
  if (!id) { openSearch('hold'); return; }
  const existing = holdings.find(h => h.id === id);
  const q = quotes[id] || {};
  const name = q.name || id;
  openModal('<div class="sheet"><div class="grab"></div><header><h3>' + (existing ? 'Edit holding' : 'Add holding') + '</h3><button class="x" data-act="close">Close</button></header>' +
    '<div class="row" style="margin-bottom:10px">' + avHTML(id, name, kindOf(id, q)) + '<div class="mid"><div class="nm">' + esc(name) + '</div><div class="tk">' + esc(id) + '</div></div></div>' +
    '<div class="field"><label for="qty">Quantity</label><input id="qty" type="number" inputmode="decimal" step="any" min="0" value="' + (existing ? esc(existing.qty) : '') + '"></div>' +
    '<div class="field"><label for="avg">Average buy price (native' + (q.currency ? ' · ' + esc(q.currency) : '') + ')</label>' +
    '<input id="avg" type="number" inputmode="decimal" step="any" min="0" value="' + (existing && existing.avg != null ? esc(existing.avg) : '') + '"></div>' +
    '<p class="hint">Stored only on this device. Used for P&amp;L — never sent to a server.</p>' +
    '<div class="btns"><button class="btn" data-act="save-hold" data-id="' + esc(id) + '">Save</button>' +
    (existing ? '<button class="btn danger" data-act="del-hold" data-id="' + esc(id) + '">Remove</button>' : '') + '</div></div>');
  const qty = $('#qty'); if (qty) qty.focus();
}
function saveHold(id) {
  const qty = parseFloat($('#qty').value);
  const avg = $('#avg').value === '' ? null : parseFloat($('#avg').value);
  if (!isFinite(qty) || qty <= 0) { toast('Enter a quantity.'); return; }
  if (avg != null && (!isFinite(avg) || avg < 0)) { toast('Average price looks off.'); return; }
  const i = holdings.findIndex(h => h.id === id);
  const rec = { id: id, qty: qty, avg: avg };
  if (i >= 0) holdings[i] = rec; else holdings.push(rec);
  persistHoldings(); closeModal(); renderAll(); toast('Holding saved');
  if (pairs[id] || isCryptoId(id)) { loadCryptoOnce().then(() => connectWS()); }
}
function delHold(id) {
  holdings = holdings.filter(h => h.id !== id);
  persistHoldings(); closeModal(); renderAll(); toast('Holding removed');
}

function openAlert(id) {
  if (!id) { openSearch('alert'); return; }
  const q = quotes[id] || {};
  const px = q.price != null ? q.price : '';
  openModal('<div class="sheet"><div class="grab"></div><header><h3>Price alert</h3><button class="x" data-act="close">Close</button></header>' +
    '<div class="row" style="margin-bottom:10px">' + avHTML(id, q.name || id, kindOf(id, q)) + '<div class="mid"><div class="nm">' + esc(q.name || id) + '</div><div class="tk">Now ' + (q.price != null ? pxText(id, q.price, {px:true}) : '—') + '</div></div></div>' +
    '<div class="seg" id="aOp"><button type="button" class="on" data-op="above">Above</button><button type="button" data-op="below">Below</button><button type="button" data-op="pct-up">% up</button><button type="button" data-op="pct-down">% down</button></div>' +
    '<div class="field"><label for="aVal" id="aLab">' + (isIndexId(id, q) ? 'Level (index points)' : 'Price level (native ' + esc(q.currency || 'USD') + ')') + '</label>' +
    '<input id="aVal" type="number" inputmode="decimal" step="any" value="' + esc(px) + '"></div>' +
    '<p class="hint">Triggers once, in the app and as a browser notification if you have allowed them. Percentage alerts use the current price as the baseline.</p>' +
    '<div class="btns"><button class="btn" data-act="save-alert" data-id="' + esc(id) + '">Save alert</button></div></div>');
  $$('#aOp button').forEach(b => b.addEventListener('click', () => {
    $$('#aOp button').forEach(x => x.classList.remove('on'));
    b.classList.add('on');
    const pctish = b.dataset.op.startsWith('pct');
    const lab = $('#aLab');
    if (lab) lab.textContent = pctish ? 'Percent move from now' : (isIndexId(id, q) ? 'Level (index points)' : 'Price level (native ' + (q.currency || 'USD') + ')');
    if (pctish && (!$('#aVal').value || $('#aVal').value == String(px))) $('#aVal').value = '5';
  }));
}
function saveAlert(id) {
  const op = ($('#aOp .on') || {}).dataset.op || 'above';
  const val = parseFloat($('#aVal').value);
  if (!isFinite(val) || val <= 0) { toast('Enter a number.'); return; }
  const q = quotes[id] || {};
  const rec = { key: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), id: id, op: op, fired: false };
  if (op.startsWith('pct')) { rec.pct = val; rec.ref = q.price; if (rec.ref == null) { toast('Need a current price first.'); return; } }
  else rec.price = val;
  alerts.push(rec); saveAlerts(); closeModal(); renderAlerts(); toast('Alert saved');
  if (typeof Notification !== 'undefined' && Notification.permission === 'default') Notification.requestPermission();
}
function delAlert(key) { alerts = alerts.filter(a => a.key !== key); saveAlerts(); renderAlerts(); }

function checkAlerts() {
  let hit = false;
  for (const a of alerts) {
    if (a.fired) continue;
    const q = quotes[a.id];
    if (!q || q.price == null) continue;
    let ok = false, label = '';
    if (a.op === 'above' && q.price >= a.price) { ok = true; label = 'rose above ' + pxText(a.id, a.price, {px:true}); }
    if (a.op === 'below' && q.price <= a.price) { ok = true; label = 'fell below ' + pxText(a.id, a.price, {px:true}); }
    if (a.op === 'pct-up' && a.ref && ((q.price - a.ref) / a.ref * 100) >= a.pct) { ok = true; label = 'rose ' + a.pct + '% from ' + pxText(a.id, a.ref, {px:true}); }
    if (a.op === 'pct-down' && a.ref && ((a.ref - q.price) / a.ref * 100) >= a.pct) { ok = true; label = 'fell ' + a.pct + '% from ' + pxText(a.id, a.ref, {px:true}); }
    if (!ok) continue;
    a.fired = true; hit = true;
    const title = (q.name || a.id) + ' ' + label;
    toast(title);
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      try {
        const n = new Notification(title, { body: 'Last ' + pxText(a.id, q.price, {px:true}), tag: a.key, icon: 'icons/icon-192.png' });
        n.onclick = () => { location.hash = '#/s/' + encodeURIComponent(a.id); n.close(); };
      } catch (e) {}
    }
  }
  if (hit) saveAlerts();
  checkEventAlerts();
  maybeMorningPush();
}

function exportCSV() {
  const lines = [['symbol','quantity','avg_price']];
  for (const h of holdings) lines.push([h.id, h.qty, h.avg == null ? '' : h.avg]);
  const blob = new Blob([lines.map(r => r.join(',')).join('\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'ticker-portfolio.csv';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function addWatchlist() {
  const name = prompt('Name this list', 'List ' + (watchlists.length + 1));
  if (!name) return;
  const id = 'l' + Date.now().toString(36);
  watchlists.push({ id: id, name: name.trim(), symbols: [] });
  activeWatch = id; saveLists(); renderWatch();
}
function renameWatchlist() {
  const l = watchlists.find(x => x.id === activeWatch);
  if (!l) return;
  const name = prompt('Rename list', l.name);
  if (!name) return;
  l.name = name.trim(); saveLists(); renderWatch();
}
function delWatchlist() {
  if (watchlists.length < 2) return;
  const cur = watchlists.find(l => l.id === activeWatch);
  if (!confirm('Delete “' + (cur && cur.name || 'this list') + '”?')) return;
  watchlists = watchlists.filter(l => l.id !== activeWatch);
  activeWatch = watchlists[0].id; saveLists(); renderWatch();
}

function closeDetail(push) {
  const el = $('#detail');
  detailId = null;
  compareId = null;
  compareId2 = null;
  document.body.classList.remove('hide-dock');
  try { if (chartApi) chartApi.remove(); } catch (e) {}
  try { if (volApi) volApi.remove(); } catch (e) {}
  chartApi = null; volApi = null;
  el.hidden = true;
  el.innerHTML = '';
  if (push) {
    const want = TAB_HASH[tab] || '#/';
    if (location.hash !== want) history.replaceState(null, '', want);
  }
}

function openAsset(id, vs) {
  detailId = id;
  compareId = vs || null;
  const hash = '#/s/' + encodeURIComponent(id) + (vs ? '/vs/' + encodeURIComponent(vs) : '');
  if (location.hash !== hash) history.pushState(null, '', hash);
  renderDetail(id);
  if (isCryptoId(id) || pairs[id]) { connectWS(); loadCryptoOnce(); }
  if (!(quotes[id] && quotes[id].ok)) {
    ensureQuote(id).then(q => { if (q && detailId === id) renderDetail(id, true); });
  }
}

function consumeImport() {
  const h = location.hash || '';
  const m = h.match(/^#\/?import=(.+)$/);
  if (!m) return false;
  try {
    let b64 = decodeURIComponent(m[1]);
    b64 += '='.repeat((4 - (b64.length % 4)) % 4);
    const json = JSON.parse(atob(b64.replace(/-/g, '+').replace(/_/g, '/')));
    const rows = Array.isArray(json) ? json : (json.holdings || []);
    if (!Array.isArray(rows)) throw new Error('bad shape');
    const next = [];
    for (const r of rows) {
      if (!r || typeof r !== 'object') continue;
      const id = String(r.id || r.symbol || '').trim();
      const qty = parseFloat(r.qty ?? r.quantity);
      const avgRaw = r.avg ?? r.avg_price;
      const avg = (avgRaw === '' || avgRaw == null) ? null : parseFloat(avgRaw);
      if (!id || id.length > 24 || !isFinite(qty) || qty <= 0) continue;
      next.push({ id: id, qty: qty, avg: (avg != null && isFinite(avg) && avg >= 0) ? avg : null });
    }
    if (!next.length) throw new Error('no rows');
    holdings = next;
    persistHoldings();
    const l = watchlists.find(x => x.id === activeWatch) || watchlists[0];
    if (l) {
      for (const row of next) if (!l.symbols.includes(row.id)) l.symbols.push(row.id);
      saveLists();
    }
    history.replaceState(null, '', '#/portfolio');
    toast('Imported ' + next.length + ' holding' + (next.length > 1 ? 's' : ''));
    return true;
  } catch (err) {
    history.replaceState(null, '', '#/');
    toast('Could not import those holdings.');
    return false;
  }
}

function applyHash() {
  if (consumeImport()) {
    if (readerItem) closeReader(true);
    if (listState) closeListPage(true);
    if (aiPageId) closeAiPage(true);
    if (detailId) closeDetail(false);
    tab = 'port'; go(TABS.indexOf('port'), { nohash: true, instant: true }); renderAll(); return;
  }
  const h = location.hash || '#/';
  const m = h.match(/^#\/s\/([^/]+)(?:\/vs\/([^/]+))?(?:\/vs\/([^/]+))?/);
  if (m) {
    const id = decodeURIComponent(m[1]);
    const vs = m[2] ? decodeURIComponent(m[2]) : null;
    const vs2 = m[3] ? decodeURIComponent(m[3]) : null;
    if (readerItem) closeReader(true);
    if (listState) closeListPage(true);
    if (aiPageId) closeAiPage(true);
    closeBrief(true);
    closeScreener(true);
    closeIpoSheets();
    if (detailId !== id || compareId !== vs || compareId2 !== vs2) { detailId = id; compareId = vs; compareId2 = vs2; renderDetail(id); }
    return;
  }
  if (h === '#/brief' || h.startsWith('#/brief')) {
    if (readerItem) closeReader(true);
    if (listState) closeListPage(true);
    if (aiPageId) closeAiPage(true);
    closeScreener(true);
    closeIpoSheets();
    openBrief({ fromHash: true });
    return;
  }
  if (h === '#/screener' || h.startsWith('#/screener')) {
    if (readerItem) closeReader(true);
    if (listState) closeListPage(true);
    if (aiPageId) closeAiPage(true);
    closeBrief(true);
    closeIpoSheets();
    openScreener({ fromHash: true });
    return;
  }
  if (h.startsWith('#/ai/')) {
    const id = decodeURIComponent((h.split('/')[2] || '').trim());
    if (readerItem) closeReader(true);
    if (listState) closeListPage(true);
    closeIpoSheets();
    if (id && detailId !== id) { detailId = id; compareId = null; renderDetail(id); }
    if (id) openAiPage(id, { fromHash: true });
    return;
  }
  if (h === '#/ipos' || h.startsWith('#/ipos/')) {
    if (detailId) closeDetail(false);
    if (readerItem) closeReader(true);
    if (aiPageId) closeAiPage(true);
    go(1, { nohash: true });
    marketsPane = 'stocks';
    marketsList = 'ipos';
    openIposPage();
    return;
  }
  const ipoM = h.match(/^#\/ipo\/(.+)$/);
  if (ipoM) {
    if (detailId) closeDetail(false);
    if (readerItem) closeReader(true);
    go(1, { nohash: true });
    marketsPane = 'stocks';
    marketsList = 'ipos';
    openIpoDetail(decodeURIComponent(ipoM[1]));
    return;
  }
  if (h.startsWith('#/read')) {
    const key = decodeURIComponent((h.split('/')[2] || '').trim());
    if (readerItem && newsSid(readerItem) === key) return;
    const item = key && newsStore()[key];
    if (item) { openReader(item); return; }
    if (readerItem) return;
  }
  if (h.startsWith('#/list/')) {
    const parts = h.split('/');
    openListPage(parts[2] || 'stocks', parts[3] || 'all', { fromHash: true });
    return;
  }
  if (listState) closeListPage(true);
  if (readerItem) closeReader(true);
  if (aiPageId) closeAiPage(true);
  closeBrief(true);
  closeScreener(true);
  if (detailId) closeDetail(false);
  closeIpoSheets();
  let i = 0;
  if (h.startsWith('#/markets')) {
    i = 1;
    const part = h.split('/')[2];
    if (MARKET_PANES.includes(part) && part !== marketsPane) { marketsPane = part; marketsList = defaultMarketsList(part); marketsShowAll = false; renderMarkets(); }
  }
  else if (h.startsWith('#/watch')) i = 2;
  else if (h.startsWith('#/port')) i = 3;
  else if (h.startsWith('#/alert')) i = 4;
  go(i, { nohash: true });
}


/* ---------------- dock + pager ---------------- */
const dock = $('#dock'), bub = dock.querySelector('.dpill'), jel = bub.querySelector('i'), tbs = [...dock.querySelectorAll('button')];
const pager = $('#pager'), track = $('#track');
let bw = 0, press = 1, ddrag = null, moved = 0, swipe = null;

function spring(o) {
  const s = { x: 0, v: 0, target: 0, k: o.k, c: o.c, on: o.on, raf: 0, settle: o.settle,
    set(t, instant) {
      s.target = t;
      if (instant || RMQ.matches) {
        if (s.raf) { cancelAnimationFrame(s.raf); s.raf = 0; }
        s.x = t; s.v = 0; s.on(s.x, 0); return;
      }
      if (!s.raf) {
        let last = performance.now();
        const f = now => {
          const dt = Math.min(.032, (now - last) / 1000); last = now;
          const a = -s.k * (s.x - s.target) - s.c * s.v;
          s.v += a * dt; s.x += s.v * dt; s.on(s.x, s.v);
          if (Math.abs(s.v) < 2 && Math.abs(s.x - s.target) < .3) {
            s.x = s.target; s.v = 0; s.on(s.x, 0); s.raf = 0; if (s.settle) s.settle(); return;
          }
          s.raf = requestAnimationFrame(f);
        };
        s.raf = requestAnimationFrame(f);
      }
    }
  };
  return s;
}
const slotX = i => tbs[i] ? tbs[i].offsetLeft : 0;
function dpaint(x, v) {
  const st = RMQ.matches ? 0 : Math.min(.34, Math.abs(v) / 2400);
  moved = Math.max(moved, Math.abs(v));
  bub.style.transform = 'translate3d(' + x.toFixed(2) + 'px,0,0) scale(' + ((1 + st) * press).toFixed(3) + ',' + ((1 - st * .42) * press).toFixed(3) + ')';
  const c = x + bw / 2;
  tbs.forEach(b => b.classList.toggle('on', c >= b.offsetLeft && c < b.offsetLeft + b.offsetWidth));
}
const bs = spring({ k: 380, c: 26, on: dpaint });
bs.settle = () => {
  if (moved > 600 && !RMQ.matches && !ddrag) { jel.classList.remove('jelly'); void jel.offsetWidth; jel.classList.add('jelly'); }
  moved = 0;
};
function sizeBubble() {
  if (!tbs[0]) return;
  bw = tbs[0].offsetWidth;
  bub.style.width = bw + 'px';
  bs.set(slotX(Math.max(0, TABS.indexOf(tab))), true);
}
const rubber = (x, a, b) => x < a ? a - Math.pow(a - x, .7) : x > b ? b + Math.pow(x - b, .7) : x;
const nearest = x => { let best = 0, d = 1e9; tbs.forEach((b, i) => { const dd = Math.abs(b.offsetLeft - x); if (dd < d) { d = dd; best = i; } }); return best; };

function paintTrack(i, instant) {
  const w = pager.clientWidth || window.innerWidth;
  track.classList.toggle('drag', instant === 'drag');
  if (instant === true || RMQ.matches) {
    const prev = track.style.transition;
    track.style.transition = 'none';
    track.style.transform = 'translate3d(' + (-i * w) + 'px,0,0)';
    void track.offsetWidth;
    track.style.transition = prev || '';
  } else if (instant !== 'drag') {
    track.classList.remove('drag');
    track.style.transform = 'translate3d(' + (-i * w) + 'px,0,0)';
  }
}

function go(i, opts={}) {
  i = Math.max(0, Math.min(TABS.length - 1, i));
  const name = TABS[i];
  const prev = tab;
  tab = name;
  bs.set(slotX(i), opts.instant);
  tbs.forEach((b, k) => { if (k === i) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
  paintTrack(i, opts.instant || opts.drag);
  if (prev !== name) {
    vib(6);
    const view = $('.view[data-tab="' + name + '"]');
    if (view && !opts.keepScroll) view.scrollTop = 0;
  }
  const want = TAB_HASH[name];
  if (!opts.nohash && !detailId && !listState && location.hash !== want && !(name === 'home' && (location.hash === '' || location.hash === '#' || location.hash === '#/'))) {
    history.replaceState(null, '', want);
  }
  paintTitle();
}

dock.addEventListener('pointerdown', e => {
  if (e.button > 0) return;
  try { dock.setPointerCapture(e.pointerId); } catch (err) {}
  const r = dock.getBoundingClientRect();
  ddrag = { left: r.left };
  press = 1.08; dock.classList.add('drag');
  bs.set(rubber(e.clientX - r.left - bw / 2, slotX(0), slotX(tbs.length - 1)));
});
dock.addEventListener('pointermove', e => { if (ddrag) bs.set(rubber(e.clientX - ddrag.left - bw / 2, slotX(0), slotX(tbs.length - 1))); });
const endDock = e => {
  if (!ddrag) return;
  const i = nearest(bs.target);
  ddrag = null; press = 1; dock.classList.remove('drag');
  if (e.type === 'pointercancel') { bs.set(slotX(TABS.indexOf(tab))); return; }
  if (TABS[i] !== tab) vib(6);
  go(i);
};
dock.addEventListener('pointerup', endDock);
dock.addEventListener('pointercancel', endDock);
dock.addEventListener('keydown', e => {
  if (e.key === 'Enter' || e.key === ' ') {
    const b = e.target.closest('button');
    if (b) { e.preventDefault(); go(+b.dataset.k); }
  }
});

pager.addEventListener('pointerdown', e => {
  return; // page swipe disabled: only the tab bar changes page
  if (detailId || !$('#modal').hidden || e.button > 0) return;
  if (document.body.classList.contains('hide-dock')) return;
  if (e.target.closest('#chart,#vol,.rng,.tools,input,select,textarea,button,.sheet')) return;
  swipe = { x: e.clientX, y: e.clientY, t: performance.now(), w: pager.clientWidth, i: TABS.indexOf(tab), moved: false };
});
pager.addEventListener('pointermove', e => {
  if (!swipe) return;
  const dx = e.clientX - swipe.x, dy = e.clientY - swipe.y;
  if (!swipe.moved) {
    if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { swipe = null; return; }
    if (Math.abs(dx) < 12) return;
    swipe.moved = true;
    try { pager.setPointerCapture(e.pointerId); } catch (err) {}
    track.classList.add('drag');
    press = 1.04;
  }
  const raw = -swipe.i * swipe.w + dx;
  const min = -(TABS.length - 1) * swipe.w, max = 0;
  const x = raw < min ? min - Math.pow(min - raw, .7) : raw > max ? max + Math.pow(raw - max, .7) : raw;
  track.style.transform = 'translate3d(' + x + 'px,0,0)';
  const frac = Math.max(0, Math.min(TABS.length - 1, -x / swipe.w));
  const i0 = Math.floor(frac), i1 = Math.min(TABS.length - 1, i0 + 1);
  const p = frac - i0;
  bs.set(slotX(i0) + (slotX(i1) - slotX(i0)) * p);
});
function endSwipe(e) {
  if (!swipe) return;
  const dx = e.clientX != null ? e.clientX - swipe.x : 0;
  const dt = Math.max(1, performance.now() - swipe.t);
  const v = dx / dt;
  let i = swipe.i;
  if (swipe.moved) {
    if (Math.abs(dx) > swipe.w * 0.28 || Math.abs(v) > 0.6) i = dx < 0 ? swipe.i + 1 : swipe.i - 1;
  }
  swipe = null; press = 1; track.classList.remove('drag');
  go(i);
}
pager.addEventListener('pointerup', endSwipe);
pager.addEventListener('pointercancel', endSwipe);

window.addEventListener('resize', () => { sizeBubble(); paintTrack(TABS.indexOf(tab), true); });
if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { sizeBubble(); paintTrack(TABS.indexOf(tab), true); });

function setupPTR() {
  $$('.view').forEach(view => {
    const bar = view.querySelector('.ptr');
    if (!bar) return;
    let startY = 0, pulling = false;
    view.addEventListener('pointerdown', e => {
      if (view.scrollTop > 2 || detailId) return;
      startY = e.clientY; pulling = true;
    });
    view.addEventListener('pointermove', e => {
      if (!pulling) return;
      const dy = e.clientY - startY;
      if (dy < 8) { bar.style.height = '0'; bar.classList.remove('show', 'ready'); return; }
      if (view.scrollTop > 2) { pulling = false; bar.style.height = '0'; return; }
      const h = Math.min(88, dy * 0.45);
      bar.style.height = h + 'px';
      bar.classList.add('show');
      bar.classList.toggle('ready', h > 56);
      bar.textContent = h > 56 ? 'Release to refresh' : 'Pull to refresh';
    });
    const end = () => {
      if (!pulling) return;
      pulling = false;
      const ready = bar.classList.contains('ready');
      bar.style.height = '0'; bar.classList.remove('ready', 'show'); bar.textContent = '';
      if (ready) { vib(10); refreshAll(); toast('Refreshing quotes'); }
    };
    view.addEventListener('pointerup', end);
    view.addEventListener('pointercancel', end);
  });
}


function closeReader(fromPop) {
  const el = $('#reader');
  if (!el || el.hidden) { readerItem = null; return; }
  el.hidden = true;
  el.innerHTML = '';
  readerItem = null;
  if (!fromPop && location.hash.indexOf('#/read') === 0) {
    if (history.length > 1) history.back();
    else history.replaceState(null, '', '#/markets');
  }
}
function readerBodyHTML(item) {
  const paras = (item.text || item.excerpt || '').split(/\n+/).map(t => t.trim()).filter(Boolean);
  if (paras.length) return paras.map(t => '<p>' + esc(t) + '</p>').join('');
  return '';
}
async function fillReaderText(item, host) {
  const pref = prefetchedNews(item);
  if (pref) {
    if (pref.text && !item.text) item.text = pref.text;
    if (pref.excerpt && !item.excerpt) item.excerpt = pref.excerpt;
    if (pref.canonical && !item.canonical) item.canonical = pref.canonical;
  }
  if (item.text && item.text.length > 280) {
    host.innerHTML = readerBodyHTML(item);
    return;
  }
  if (item.excerpt || item.summary) {
    host.innerHTML = readerBodyHTML({ text: item.excerpt || item.summary }) + '<p class="empty-read">Loading the full article…</p>';
  } else {
    host.innerHTML = '<p class="empty-read">Loading article…</p>';
  }
  let url = item.url || '';
  try {
    if (/news\.google\.com/i.test(url)) {
      const r = await fetch('https://r.jina.ai/' + url, { mode: 'cors' });
      if (r.ok) {
        const raw = await r.text();
        const m = raw.match(/https?:\/\/(?!news\.google\.com)[^\s)\]>"]+/);
        if (m) url = m[0].replace(/[.,]+$/, '');
      }
    }
  } catch (e) {}
  const proxies = [
    'https://r.jina.ai/' + url,
    'https://r.jina.ai/http://' + url.replace(/^https?:\/\//, '')
  ];
  for (const u of proxies) {
    try {
      const r = await fetch(u, { mode: 'cors' });
      if (!r.ok) continue;
      const txt = await r.text();
      if (!txt || txt.length < 200) continue;
      let clean = txt;
      clean = clean.replace(/^(Title|URL Source|Final URL|Published Time|Markdown Content):\s*.*$/gmi, '');
      clean = clean.replace(/!\[[^\]]*\]\([^)]+\)/g, '');
      clean = clean.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
      clean = clean.replace(/https?:\/\/\S+/g, '');
      const paras = clean.split(/\n+/).map(s => s.replace(/[#*_`]+/g,' ').replace(/\s+/g,' ').trim())
        .filter(s => s.length > 50 && !/^(image \d+|bloomberg via|getty)/i.test(s)).slice(0, 36);
      if (paras.length) {
        item.text = paras.join('\n\n');
        if (readerItem === item) host.innerHTML = readerBodyHTML(item);
        return;
      }
    } catch (e) {}
  }
  if (readerItem !== item) return;
  host.innerHTML = (item.excerpt || item.summary ? readerBodyHTML({ text: item.excerpt || item.summary }) : '') +
    '<p class="empty-read">This publisher blocked an extracted preview. Use Open original to read the full piece, or try an embedded view.</p>' +
    (item.url ? '<p><button type="button" class="btn ghost" data-act="embed-article" data-url="' + esc(item.url) + '">Try embedded view</button></p>' : '');
}
function openReader(item) {
  if (!item) return;
  readerItem = item;
  const el = $('#reader');
  const whenBit = item.published ? ago(item.published) : '';
  const by = [item.source, whenBit].filter(Boolean).join(' · ');
  const img = item.thumbnail ? '<img class="lead" src="' + esc(item.thumbnail) + '" alt="">' : '';
  el.hidden = false;
  el.innerHTML =
    '<div class="d-bar"><button class="ib" data-act="close-reader" aria-label="Back"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg></button><h2>Story</h2><span></span></div>' +
    '<div class="reader-in">' +
      '<p class="eyebrow">Article</p>' +
      '<h1>' + esc(item.title || 'Story') + '</h1>' +
      (by ? '<p class="by">' + esc(by) + '</p>' : '') + img +
      '<div class="body" id="readerBody">' + (readerBodyHTML(item) || '<p class="empty-read">Loading article…</p>') + '</div>' +
      '<div class="actions"><a class="btn full" href="' + esc(item.url) + '" target="_blank" rel="noopener">Open original</a></div>' +
    '</div>';
  const pref0 = prefetchedNews(item);
  if (pref0 && pref0.text && !item.text) item.text = pref0.text;
  if (pref0 && pref0.excerpt && !item.excerpt) item.excerpt = pref0.excerpt;
  if (!item.text || item.text.length < 280) fillReaderText(item, $('#readerBody'));
  const key = newsSid(item);
  if (location.hash.indexOf('#/read/') !== 0) history.pushState({ reader: key }, '', '#/read/' + encodeURIComponent(key));
}

function fsBar(title) {
  return '<div class="fs-bar"><button class="ib" data-act="close-fs" aria-label="Close"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button><h3>' + esc(title || 'Chart') + '</h3></div>' +
    '<div class="fs-chart"><div id="fsChart"></div><div id="fsPane" hidden></div></div>' +
    '<div class="rng" id="fsRanges">' + ['1D','1W','1M','3M','YTD','1Y','MAX'].map(r =>
      '<button type="button" data-fsrange="' + r + '" class="' + (r===chartRange?'on':'') + '">' + (r==='MAX'?'All':r) + '</button>').join('') + '</div>' +
    '<div class="tools" id="fsTools">' +
      '<button type="button" data-fskind="line" class="' + (chartKind!=='candles'?'on':'') + '">Line</button>' +
      '<button type="button" data-fskind="candles" class="' + (chartKind==='candles'?'on':'') + '">Candles</button>' +
      '<button type="button" data-fsind="off" class="' + ((chartInd||'off')==='off'?'on':'') + '">Off</button>' +
      '<button type="button" data-fsind="sma" class="' + (chartInd==='sma'?'on':'') + '">SMA 20</button>' +
      '<button type="button" data-fsind="ema" class="' + (chartInd==='ema'?'on':'') + '">EMA 20</button>' +
      '<button type="button" data-fsind="bb" class="' + (chartInd==='bb'?'on':'') + '">Bollinger</button>' +
      '<button type="button" data-fsind="rsi" class="' + (chartInd==='rsi'?'on':'') + '">RSI</button>' +
      '<button type="button" data-fsind="macd" class="' + (chartInd==='macd'?'on':'') + '">MACD</button>' +
      '<button type="button" data-act="trend-draw" class="' + (trendDraw?'on':'') + '">Trendline</button>' +
    '</div>';
}
async function paintFsChart() {
  const host = $('#fsChart');
  if (!host) return;
  host.innerHTML = '';
  if (fsSource === 'home' || fsSource === 'port' || !detailId) {
    const pts = await portfolioSeries(portRange);
    drawValueChart(host, pts, { showAxes: true, height: host.clientHeight || 320 });
    return;
  }
  let packA = isCryptoId(detailId) || pairs[detailId]
    ? { bars: await cryptoBars(detailId, chartRange), currency: 'USD', label: coin(detailId), ohlc: true }
    : Object.assign(await stockPack(detailId, chartRange), { label: detailId });
  const q0 = quotes[detailId] || {};
  const fromA = packA.currency || q0.currency || 'USD';
  const toA = displayCcyFor(detailId);
  if (!isIndexId(detailId) && !isCommodityId(detailId) && !isYieldId(detailId)) packA = scalePack(packA, fromA, toA);
  const conv = v => (v == null || isIndexId(detailId) || isCommodityId(detailId)) ? v : convert(v, fromA, packA.currency || toA);
  drawChart(host, packA, null, chartRange, chartKind, chartInd, {
    api: 'fs', showAxes: true, id: detailId,
    buyPrice: conv(holdingAvg(detailId)), buyCurrency: packA.currency || toA,
    prevClose: conv(q0.prev != null ? q0.prev : q0.regularClose)
  });
}
let fsSource = 'detail';
async function openFullscreenChart(src) {
  fsSource = src || (detailId ? 'detail' : 'home');
  const fs = $('#chartFs');
  const title = (detailId && fsSource === 'detail')
    ? ((quotes[detailId] && (quotes[detailId].name || quotes[detailId].symbol)) || detailId)
    : 'Investing';
  fs.hidden = false;
  document.body.classList.add('chart-fs-on');
  fs.innerHTML = fsBar(title);
  try { if (fs.requestFullscreen) await fs.requestFullscreen(); } catch (e) {}
  try { if (screen.orientation && screen.orientation.lock) await screen.orientation.lock('landscape'); } catch (e) {}
  await paintFsChart();
}
function closeFullscreenChart() {
  try { if (document.fullscreenElement) document.exitFullscreen(); } catch (e) {}
  try { if (screen.orientation && screen.orientation.unlock) screen.orientation.unlock(); } catch (e) {}
  try { if (fsChartApi) fsChartApi.remove(); } catch (e) {}
  fsChartApi = null;
  const fs = $('#chartFs');
  if (fs) { fs.hidden = true; fs.innerHTML = ''; }
  document.body.classList.remove('chart-fs-on');
}
document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement && $('#chartFs') && !$('#chartFs').hidden) {
    /* user exited via system gesture — keep overlay unless they closed */
  }
});

function onClick(e) {
  const hit = e.target.closest('[data-act],button,[data-range],.row,a.tool-chip');
  if (hit) vib(8);
  const retryC = e.target.closest('[data-act="retry-chart"]');
  if (retryC) {
    if (retryC.dataset.src === 'port') {
      if ($('#pvChart')) loadPortChart('#pvChart');
      if ($('#homeChart')) loadPortChart('#homeChart');
      if ($('#chartFs') && !$('#chartFs').hidden) paintFsChart();
    } else {
      loadDetailChart();
      if ($('#chartFs') && !$('#chartFs').hidden) paintFsChart();
    }
    return;
  }

  const pr = e.target.closest('button[data-prange]');
  if (pr) {
    portRange = pr.dataset.prange;
    document.querySelectorAll('button[data-prange]').forEach(b => b.classList.toggle('on', b.dataset.prange === portRange));
    if ($('#homeChart')) loadPortChart('#homeChart');
    if ($('#pvChart')) loadPortChart('#pvChart');
    if (!$('#chartFs').hidden && (fsSource === 'home' || fsSource === 'port')) paintFsChart();
    return;
  }
  const closeR = e.target.closest('[data-act="close-reader"]');
  if (closeR) { closeReader(); return; }
  const embed = e.target.closest('[data-act="embed-article"]');
  if (embed && embed.dataset.url) {
    const body = $('#readerBody');
    if (body) body.innerHTML = '<iframe class="reader-frame" src="' + esc(embed.dataset.url) + '" title="Article" sandbox="allow-scripts allow-same-origin allow-popups"></iframe>';
    return;
  }
  const readBtn = e.target.closest('[data-act="read"]');
  if (readBtn) {
    e.preventDefault();
    const item = newsStore()[readBtn.dataset.key];
    if (item) openReader(item);
    else toast('Could not open that story in the reader.');
    return;
  }
  const openList = e.target.closest('[data-act="open-list"]');
  if (openList) {
    openListPage(openList.dataset.pane || marketsPane, openList.dataset.list || marketsList);
    return;
  }
  const closeList = e.target.closest('[data-act="close-list"]');
  if (closeList) { closeListPage(); return; }
  const openAi = e.target.closest('[data-act="open-ai"]');
  if (openAi) { openAiPage(openAi.dataset.id || detailId); return; }
  const closeAi = e.target.closest('[data-act="close-ai"]');
  if (closeAi) { closeAiPage(); return; }
  const lsort = e.target.closest('[data-act="list-sort"]');
  if (lsort && listState) { listState.sort = lsort.dataset.id; listState.shown = 40; renderListPage(); return; }
  const lmore = e.target.closest('[data-act="list-more"]');
  if (lmore && listState) { listState.shown = (listState.shown || 40) + 40; renderListPage(); return; }
  const pane = e.target.closest('[data-act="m-pane"]');
  if (pane) {
    marketsPane = pane.dataset.id;
    marketsList = defaultMarketsList(marketsPane);
    marketsShowAll = false;
    history.replaceState(null, '', '#/markets/' + marketsPane);
    renderMarkets();
    return;
  }
  const mlist = e.target.closest('[data-act="m-list"]');
  if (mlist) {
    marketsList = mlist.dataset.id;
    marketsShowAll = false;
    renderMarkets({ scroll: false });
    return;
  }
  const mmore = e.target.closest('[data-act="m-more"]');
  if (mmore) {
    marketsShowAll = mmore.dataset.id === 'more';
    renderMarkets({ scroll: false });
    return;
  }
  const sentBtn = e.target.closest('[data-act="sentiment"]');
  if (sentBtn) { openSentiment(sentBtn.dataset.id); return; }
  const closeSent = e.target.closest('[data-act="close-sentiment"]');
  if (closeSent) { closeSentiment(); return; }
  const openIpos = e.target.closest('[data-act="open-ipos"]');
  if (openIpos) { location.hash = '#/ipos'; return; }
  const closeIposBtn = e.target.closest('[data-act="close-ipos"]');
  if (closeIposBtn) {
    closeIpoSheets();
    if (history.length > 1) history.back();
    else { marketsList = 'ipos'; history.replaceState(null, '', '#/markets/stocks'); renderMarkets(); }
    return;
  }
  const closeIpoD = e.target.closest('[data-act="close-ipo-detail"]');
  if (closeIpoD) {
    closeIpoDetail();
    if (history.length > 1) history.back();
    else location.hash = '#/ipos';
    return;
  }
  const fsBtn = e.target.closest('[data-act="chart-fs"]');
  if (fsBtn) { openFullscreenChart(fsBtn.dataset.src); return; }
  const closeFs = e.target.closest('[data-act="close-fs"]');
  if (closeFs) { closeFullscreenChart(); return; }
  const fsr = e.target.closest('button[data-fsrange]');
  if (fsr) {
    const r = fsr.dataset.fsrange;
    if (fsSource === 'home' || fsSource === 'port') portRange = r; else chartRange = r;
    $$('#fsRanges button').forEach(b => b.classList.toggle('on', b === fsr));
    paintFsChart();
    return;
  }
  const fsk = e.target.closest('button[data-fskind]');
  if (fsk) {
    chartKind = fsk.dataset.fskind; store.set('chartKind', chartKind);
    $$('#fsTools [data-fskind]').forEach(b => b.classList.toggle('on', b === fsk));
    paintFsChart();
    return;
  }
  const fsi = e.target.closest('button[data-fsind]');
  if (fsi) {
    chartInd = fsi.dataset.fsind; store.set('chartInd', chartInd);
    $$('#fsTools [data-fsind]').forEach(b => b.classList.toggle('on', b === fsi));
    paintFsChart();
    return;
  }
  const actEl = e.target.closest('[data-act]');
  if (!actEl) return;
  const act = actEl.dataset.act, id = actEl.dataset.id, key = actEl.dataset.key;
  if (act === 'close') { closeModal(); return; }
  if (act === 'close-detail') { e.preventDefault(); if (history.length > 1) history.back(); else closeDetail(true); return; }
  if (act === 'toggle-watch') {
    e.preventDefault();
    const l = watchlists.find(x => x.id === activeWatch) || watchlists[0];
    const i = l.symbols.indexOf(id);
    if (i >= 0) { l.symbols.splice(i, 1); toast('Removed from watchlist'); }
    else { l.symbols.push(id); toast('Added to watchlist'); }
    saveLists(); renderWatch(); if (detailId) renderDetail(detailId, true); vib(8);
    return;
  }
  if (act === 'compare') {
    e.preventDefault();
    if (compareId && compareId2) {
      compareId = null; compareId2 = null;
      if (detailId) location.hash = '#/s/' + encodeURIComponent(detailId);
    } else openSearch('compare');
    return;
  }
  if (act === 'search') { openSearch('watch'); return; }
  if (act === 'pick') { pickFromSearch(id); return; }
  if (act === 'add-hold') { openHold(id || detailId); return; }
  if (act === 'edit-hold') { openHold(id); return; }
  if (act === 'save-hold') { saveHold(id); return; }
  if (act === 'del-hold') { delHold(id); return; }
  if (act === 'add-alert') { openAlert(id || detailId); return; }
  if (act === 'save-alert') { saveAlert(id); return; }
  if (act === 'del-alert') { delAlert(key); return; }
  if (act === 'enable-note') {
    if (typeof Notification === 'undefined') { toast('Notifications are not supported in this browser'); return; }
    if (Notification.permission === 'denied') { toast('Notifications are blocked in the browser settings'); return; }
    Notification.requestPermission().then(() => renderAlerts());
    return;
  }
  if (act === 'close-brief') { e.preventDefault(); if (history.length > 1) history.back(); else closeBrief(false); return; }
  if (act === 'close-screener') { e.preventDefault(); if (history.length > 1) history.back(); else closeScreener(false); return; }
  if (act === 'watch-compact') {
    watchCompact = !watchCompact; store.set('watchCompact', watchCompact); renderWatch(); return;
  }
  if (act === 'trend-draw') {
    trendDraw = !trendDraw;
    if (trendDraw) { toast('Tap two points on the chart to draw a line'); }
    const b = $('#fsTools [data-act="trend-draw"]');
    if (b) b.classList.toggle('on', trendDraw);
    if ($('#chartFs') && !$('#chartFs').hidden) paintFsChart();
    return;
  }
  if (act === 'open-brief') { openBrief(); return; }
  if (act === 'open-screener') { openScreener(); return; }
  if (act === 'export-csv') { exportCSV(); return; }
  if (act === 'import-csv') { openImport(); return; }
  if (act === 'edit-isa') { openIsaEditor(); return; }
  if (act === 'save-isa') { saveIsaEditor(); return; }
  if (act === 'do-import') { doImport(); return; }
  if (act === 'add-wl') { addWatchlist(); return; }
  if (act === 'rename-wl') { renameWatchlist(); return; }
  if (act === 'del-wl') { delWatchlist(); return; }
  if (act === 'pick-wl') { activeWatch = id; saveLists(); renderWatch(); return; }
  if (act === 'w-filter') { watchFilter = id; renderWatch(); return; }
  if (act === 'w-sort') { watchSort = 'change'; renderWatch(); return; }
  if (act === 'w-sort-name') { watchSort = 'name'; renderWatch(); return; }
}

async function refreshAll() {
  await Promise.all([loadStocks(), loadNews(), loadAnalysis(), loadAiAnalysis(), loadLogos(), loadVolumes(), loadCryptoMarkets(), loadSentiment(), loadIpos(), loadInstruments(), loadMovers3m(), loadMarketCaps(), loadNewsText(), loadPoliticianTrades()]);
  applyCryptoMarkets();
  renderAll();
  setLive();
  loadPairs().then(loadCryptoOnce).then(() => {
    applyCryptoMarkets();
    updatePrices();
    if (tab === 'home' || tab === 'port') updatePortfolioLive();
    if (tab === 'markets') renderMarkets();
    if (tab === 'watch') renderWatch();
    setLive();
  }).catch(() => { setLive(); });
  loadCryptoSparks().then(() => {
    if (tab === 'watch' || tab === 'markets') { renderWatch(); renderMarkets(); }
    if (tab === 'home' || tab === 'port') updatePortfolioLive();
  });
  connectWS();
}

function applyTheme(t, persist) {
  document.documentElement.dataset.theme = t;
  const metaEl = document.querySelector('meta[name="theme-color"]');
  if (metaEl) metaEl.content = t === 'dark' ? '#000000' : '#f5f5f5';
  const btn = $('#themeBtn');
  if (btn) btn.innerHTML = t === 'dark'
    ? '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>'
    : '<svg viewBox="0 0 24 24"><path d="M21 14.5A8.5 8.5 0 1 1 9.5 3 7 7 0 0 0 21 14.5z"/></svg>';
  if (persist !== false) store.set('theme', t);
  if (chartApi && detailId) loadDetailChart();
  if (pvApi && tab === 'port') drawPvChart();
}
function bootTheme() {
  const saved = store.get('theme', null);
  applyTheme(saved === 'light' || saved === 'dark' ? saved : (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'), false);
}


function instrumentRec(id) {
  return (instruments && instruments.byId && instruments.byId[id]) || null;
}
async function loadInstruments() {
  try {
    const r = await fetch('data/instruments.json?t=' + BUILD, { cache: 'no-cache' });
    if (!r.ok) return;
    const d = await r.json();
    const items = d.instruments || d.items || [];
    const byId = {};
    items.forEach(it => { if (it && it.id) byId[it.id] = it; });
    instruments = { items: items, byId: byId, asOf: d.asOf, source: d.source };
  } catch (e) {}
}
async function loadMovers3m() {
  try {
    const r = await fetch('data/movers_3m.json?t=' + BUILD, { cache: 'no-cache' });
    if (!r.ok) return;
    movers3m = await r.json();
  } catch (e) {}
}
async function loadMarketCaps() {
  try {
    const r = await fetch('data/market_caps.json?t=' + BUILD, { cache: 'no-cache' });
    if (!r.ok) return;
    const d = await r.json();
    marketCaps = (d && d.caps) || d || {};
  } catch (e) {}
}
async function loadNewsText() {
  try {
    const r = await fetch('data/news_text/index.json?t=' + BUILD, { cache: 'no-cache' });
    if (!r.ok) return;
    newsTextIndex = await r.json();
  } catch (e) {}
}
function prefetchedNews(item) {
  if (!item || !newsTextIndex) return null;
  const items = newsTextIndex.items || newsTextIndex;
  const sid = newsSid(item);
  if (items[sid] && (items[sid].text || items[sid].excerpt)) return items[sid];
  const u = item.url;
  const alt = newsTextIndex.byUrl && u && newsTextIndex.byUrl[u];
  if (alt && items[alt]) return items[alt];
  return null;
}

function allocHTML(st) {
  if (!st || !st.lines || !st.lines.length) return '';
  const pal = PALETTE();
  const map = {};
  for (const l of st.lines) {
    if (l.valUSD == null) continue;
    const k = kindOf(l.h.id, l.q);
    const label = k === 'crypto' ? 'Crypto' : k === 'etf' ? 'ETFs' : k === 'commodity' ? 'Metals' : 'Stocks';
    map[label] = (map[label] || 0) + l.valUSD;
  }
  const rows = Object.entries(map).sort((a, b) => b[1] - a[1]);
  if (!rows.length) return '';
  const total = rows.reduce((a, b) => a + b[1], 0) || 1;
  const colors = { Stocks: '#00C805', ETFs: '#c8f542', Crypto: '#a855f7', Metals: '#f5c542' };
  return '<div class="sec-h"><h2>Asset breakdown</h2></div><div class="alloc">' +
    rows.map((ent, i) => {
      const pctV = ent[1] / total * 100;
      const col = colors[ent[0]] || pal[i % pal.length];
      return '<div class="alloc-row"><div><div class="lab">' + esc(ent[0]) + '</div><div class="sub">' + money(ent[1], 'USD') + '</div></div><div class="pct">' + pctV.toFixed(0) + '%</div>' +
        '<div class="alloc-bar"><i style="width:' + pctV.toFixed(1) + '%;background:' + col + '"></i></div></div>';
    }).join('') + '</div>';
}
function largestHTML(st) {
  if (!st || !st.lines) return '';
  const rows = st.lines.filter(l => l.valUSD != null).sort((a, b) => b.valUSD - a.valUSD);
  if (!rows.length) return '';
  const total = rows.reduce((s, l) => s + l.valUSD, 0) || 1;
  const top = rows.slice(0, 3);
  const other = rows.slice(3).reduce((s, l) => s + l.valUSD, 0);
  const tiles = top.map(l => {
    const id = l.h.id, q = l.q || quotes[id] || {};
    const share = l.valUSD / total * 100;
    return '<a class="lg-tile" href="#/s/' + encodeURIComponent(id) + '">' + avHTML(id, q.name || id, kindOf(id, q), 'lg') +
      '<div class="k">' + esc(q.symbol || coin(id) || id) + ' ' + share.toFixed(0) + '%</div>' +
      '<div class="v">' + money(l.valUSD, 'USD') + '</div></a>';
  }).join('');
  const otherTile = other > 0 ? '<div class="lg-tile"><div class="av ph lg">+</div><div class="k">Other ' + (other / total * 100).toFixed(0) + '%</div><div class="v">' + money(other, 'USD') + '</div></div>' : '';
  return '<div class="sec-h"><h2>Largest holdings</h2></div><div class="largest">' + tiles + otherTile + '</div>';
}

function up3mIds() { return (movers3m && movers3m.items || []).map(x => x.id).filter(Boolean); }
function up3mSectionHTML(where) {
  const items = (movers3m && movers3m.items) || [];
  if (!items.length) return '';
  const ids = items.slice(0, 10).map(x => x.id);
  const rows = ids.map(id => {
    const rec = (movers3m.items || []).find(x => x.id === id) || {};
    return rowHTML(id, { spark: true, sparkVals: rec.spark, sparkUp: rec.ret >= 0, rgt: '<div class="px">' + (quotes[id] && quotes[id].price != null ? pxText(id, quotes[id].price, { px: true }) : '—') + '</div><div class="chg up">' + pct(rec.ret) + '</div>' });
  }).join('');
  return '<div class="sec-h"><h2>Up 10%+ in 3 months</h2>' +
    (items.length > 10 ? '<button type="button" class="more" data-act="open-list" data-pane="stocks" data-list="up3m">See all</button>' : '') +
    '</div><div class="list">' + rows + '</div>' +
    '<p class="note">About three months of daily closes. Not a prediction, not financial advice.</p>';
}

const REAL_EX = new Set(['NYQ','NMS','NGM','NYS','NYSE','NASDAQ','NGS','NM','LSE','IOB','PCX','ARCA','ASE','AMS','NYM','CMX','FGI','CGI']);
function usdPx(id, q) {
  if (!q || q.price == null) return null;
  const cur = (q.unit === 'pence' || q.currency === 'GBp') ? 'GBP' : (q.currency || 'USD');
  return toUSD(q.price, cur);
}
function capOf(id, q) {
  if (q && q.marketCap != null) return q.marketCap;
  if (marketCaps && marketCaps[id] != null) return (marketCaps[id].marketCap != null ? marketCaps[id].marketCap : marketCaps[id]);
  return null;
}
function isLiquidMover(id) {
  const q = quotes[id];
  if (!q || !q.ok || q.price == null || q.changePct == null) return false;
  const kind = kindOf(id, q);
  if (kind === 'fx' || kind === 'index' || kind === 'yield') return false;
  if (kind === 'crypto') {
    const cap = capOf(id, q);
    if (cap == null || cap < 3e8) return false;
    if (q.volume != null && q.volume < 5e6) return false;
    if (q.price < 0.05) return false;
    return true;
  }
  const ex = String(q.exchange || '').toUpperCase();
  if (ex && !REAL_EX.has(ex) && !String(id).endsWith('.L')) return false;
  const px = usdPx(id, q);
  if (px == null || px < 1) return false;
  const cap = capOf(id, q);
  const inst = instrumentRec(id);
  const major = !!(inst && inst.indices && inst.indices.length);
  const liquid = !!(inst && inst.liquid);
  if (cap != null && cap < 3e8) return false;
  if (cap == null && !major && !liquid) return false;
  const dvol = (q.volume != null && px != null) ? q.volume * px : null;
  if (dvol != null && dvol < 5e5) return false;
  return true;
}
function moverStripHTML(ids, pane) {
  const pool = (ids || []).filter(isLiquidMover);
  const gain = sortMarketIds(pool.slice(), 'gainers').filter(id => (quotes[id] && quotes[id].changePct) > 0).slice(0, 12);
  const lose = sortMarketIds(pool.slice(), 'losers').filter(id => (quotes[id] && quotes[id].changePct) < 0).slice(0, 12);
  function cards(list, title, listId) {
    if (!list.length) return '';
    return '<div class="sec-h"><h2>' + title + '</h2><button type="button" class="h-expand" data-act="open-list" data-pane="' + esc(pane) + '" data-list="' + esc(listId) + '">Expand</button></div>' +
      '<div class="h-scroll">' + list.map(id => {
        const q = quotes[id] || {};
        const name = q.shortName || q.name || id;
        const up = (q.changePct || 0) >= 0;
        return '<a class="h-card" href="#/s/' + encodeURIComponent(id) + '">' + avHTML(id, name, kindOf(id, q)) +
          '<div class="nm">' + esc(name) + '</div><div class="tk">' + esc(q.symbol || coin(id) || id) + '</div>' +
          '<div class="px">' + (q.price != null ? pxText(id, q.price, { px: true }) : '—') + '</div>' +
          '<div class="chg ' + chgClass(q.changePct) + '">' + (q.changePct != null ? pct(q.changePct) : '—') + '</div></a>';
      }).join('') + '</div>';
  }
  return cards(gain, 'Top gainers 24h', 'gainers') + cards(lose, 'Top losers 24h', 'losers');
}

function perfGridPlaceholder() {
  return '<div class="sec-h"><h2>Performance</h2></div><div class="perf-grid" id="perfGrid">' +
    ['1D','1W','1M','3M','YTD','1Y'].map(r => '<div class="perf-cell" data-pr="' + r + '"><div class="k">' + r + '</div><div class="v">…</div></div>').join('') +
    '</div><p class="note">Period returns from your holdings and saved prices. Not a prediction, not financial advice.</p>';
}
async function fillPerformanceGrid(st) {
  const host = $('#perfGrid');
  if (!host) return;
  const cells = {};
  $$('#perfGrid .perf-cell').forEach(el => { cells[el.dataset.pr] = el.querySelector('.v'); });
  if (cells['1D'] && st && st.dayPct != null) {
    cells['1D'].textContent = pct(st.dayPct);
    cells['1D'].className = 'v ' + chgClass(st.dayPct);
  }
  for (const r of ['1W','1M','3M','YTD','1Y']) {
    try {
      const pts = await portfolioSeries(r);
      if (!cells[r] || pts.length < 2) { if (cells[r] && cells[r].textContent === '…') cells[r].textContent = '—'; continue; }
      const a = pts[0].value, b = pts[pts.length - 1].value;
      if (!a) { cells[r].textContent = '—'; continue; }
      const p = (b - a) / a * 100;
      cells[r].textContent = pct(p);
      cells[r].className = 'v ' + chgClass(p);
    } catch (e) { if (cells[r]) cells[r].textContent = '—'; }
  }
}

function calendarHTML() {
  const rows = [];
  const seen = new Set();
  const add = (t, title, sub, href) => {
    if (!t || !isFinite(t)) return;
    const key = title + t;
    if (seen.has(key)) return;
    seen.add(key);
    rows.push({ t: t, title: title, sub: sub, href: href });
  };
  const asTs = v => {
    if (v == null) return null;
    if (typeof v === 'number') return v < 1e12 ? v * 1000 : v;
    const n = Date.parse(v);
    return isFinite(n) ? n : null;
  };
  if (analysis && analysis.bySymbol) {
    for (const [id, rec] of Object.entries(analysis.bySymbol)) {
      const nxt = rec && rec.nextEarnings;
      if (!nxt) continue;
      const t = asTs(nxt.date || nxt.earningsDate || nxt.time);
      const q = quotes[id] || {};
      add(t, (q.symbol || id) + ' earnings', q.name || 'Upcoming report', '#/s/' + encodeURIComponent(id));
    }
  }
  const evs = news && news.earnings;
  const evList = Array.isArray(evs) ? evs : (evs && typeof evs === 'object' ? Object.values(evs) : []);
  for (const ev of evList) {
    if (!ev || typeof ev !== 'object' || Array.isArray(ev)) continue;
    const t = asTs(ev.date || ev.when || ev.published);
    add(t, ev.title || ev.symbol || 'Earnings', ev.source || 'Calendar', ev.symbol ? '#/s/' + encodeURIComponent(ev.symbol) : '');
  }
  for (const h of holdings) {
    const q = quotes[h.id] || {};
    if (q.lastDiv && q.lastDiv.date) add(asTs(q.lastDiv.date), (q.symbol || h.id) + ' dividend', 'Last paid', '#/s/' + encodeURIComponent(h.id));
  }
  const now = Date.now();
  const upcoming = rows.filter(r => r.t >= now - 2 * 86400000).sort((a, b) => a.t - b.t).slice(0, 12);
  if (!upcoming.length) return '';
  return '<div class="sec-h"><h2>Dividends &amp; earnings</h2></div>' +
    upcoming.map(r => {
      const whenStr = new Date(r.t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Europe/London' }) + ' UK';
      const inner = '<div class="when">' + esc(whenStr) + '</div><div class="what"><b>' + esc(r.title) + '</b><span>' + esc(r.sub || '') + '</span></div>';
      return r.href ? '<a class="cal-row" href="' + esc(r.href) + '">' + inner + '</a>' : '<div class="cal-row">' + inner + '</div>';
    }).join('');
}

function sectorHeatHTML() {
  const map = {};
  for (const q of Object.values(quotes)) {
    if (!q || q.kind !== 'equity' || q.changePct == null) continue;
    const inst = instrumentRec(q.id);
    const sector = (inst && inst.sector) || q.sector;
    if (!sector) continue;
    (map[sector] || (map[sector] = [])).push(q.changePct);
  }
  const cells = Object.entries(map).map(([k, arr]) => {
    const avg = arr.reduce((a, b) => a + b, 0) / arr.length;
    return { k: k, avg: avg, n: arr.length };
  }).sort((a, b) => Math.abs(b.avg) - Math.abs(a.avg)).slice(0, 8);
  if (!cells.length) return '';
  return '<div class="sec-h"><h2>Sector heatmap</h2></div><div class="heat">' +
    cells.map(c => '<div class="heat-cell ' + chgClass(c.avg) + '"><div class="k">' + esc(c.k) + '</div><div class="v">' + pct(c.avg) + '</div></div>').join('') +
    '</div><p class="note">Average session move of names in each sector, from the covered universe. Not financial advice.</p>';
}

function listPageIds(pane, list) {
  let ids;
  if (list === 'up3m') ids = up3mIds();
  else if (pane === 'crypto') {
    applyCryptoMarkets();
    if (list === 'trending') ids = (cryptoMarkets.trending || []).map(c => c.ticker).filter(Boolean);
    else if (list === 'new') ids = (cryptoMarkets.newListings || []).map(c => c.ticker).filter(Boolean);
    else ids = sortMarketIds((cryptoMarkets.coins || []).map(c => c.ticker).filter(Boolean), list === 'all' ? 'mcap' : list);
  } else if (pane === 'commodities') ids = sortMarketIds(COMMODITY_IDS.filter(id => quotes[id] && quotes[id].ok), list === 'all' ? 'all' : list);
  else if (pane === 'etfs') {
    const have = Object.values(quotes).filter(q => q && q.ok && q.kind === 'etf').map(q => q.id);
    const extra = (instruments.items || []).filter(it => it.kind === 'etf' && !have.includes(it.id)).map(it => it.id);
    ids = sortMarketIds(have.concat(list === 'all' ? extra : []), list === 'all' ? 'all' : list);
  } else {
    ids = Object.values(quotes).filter(q => q && q.ok && q.kind === 'equity').map(q => q.id);
    if (list === 'all') {
      const extra = (instruments.items || []).filter(it => it.kind === 'equity' && !ids.includes(it.id)).map(it => it.id);
      ids = ids.concat(extra);
    }
    ids = sortMarketIds(ids, list === 'all' ? 'all' : (list === 'up3m' ? 'gainers' : list));
  }
  if (list === 'gainers' || list === 'losers') ids = ids.filter(isLiquidMover);
  return ids;
}
function listTitle(pane, list) {
  const names = { gainers: 'Top gainers 24h', losers: 'Top losers 24h', volume: 'Most active', mcap: 'Market cap', up3m: 'Up 10%+ in 3 months', trending: 'Trending', new: 'New listings', all: (pane === 'crypto' ? 'All crypto' : pane === 'etfs' ? 'All ETFs' : pane === 'commodities' ? 'Commodities' : 'All stocks'), ipos: 'IPOs' };
  return names[list] || 'Markets';
}
function openListPage(pane, list, opts) {
  opts = opts || {};
  pane = MARKET_PANES.includes(pane) || pane === 'stocks' ? pane : 'stocks';
  const sort0 = list === 'losers' ? 'losers'
    : (list === 'gainers' || list === 'up3m') ? 'gainers'
    : (list === 'mcap' || (pane === 'crypto' && (list === 'all' || !list))) ? 'mcap'
    : list === 'volume' ? 'volume'
    : 'name';
  listState = { pane: pane, list: list || 'all', q: '', sort: sort0, shown: 40 };
  const el = $('#listPage');
  if (!el) return;
  if (detailId) closeDetail(false);
  if (readerItem) closeReader(true);
  go(1, { nohash: true });
  el.hidden = false;
  document.body.classList.add('hide-dock');
  if (!opts.fromHash) history.pushState({ list: pane + '/' + list }, '', '#/list/' + encodeURIComponent(pane) + '/' + encodeURIComponent(list));
  renderListPage();
}
function closeListPage(fromPop) {
  const el = $('#listPage');
  if (el) { el.hidden = true; el.innerHTML = ''; }
  listState = null;
  document.body.classList.remove('hide-dock');
  if (!fromPop && location.hash.indexOf('#/list/') === 0) {
    if (history.length > 1) history.back();
    else history.replaceState(null, '', '#/markets');
  }
}
function listFiltered() {
  if (!listState) return [];
  let ids = listPageIds(listState.pane, listState.list);
  const q = (listState.q || '').trim().toLowerCase();
  if (q) {
    ids = ids.filter(id => {
      const rec = quotes[id] || instrumentRec(id) || {};
      return (id + ' ' + (rec.symbol || '') + ' ' + (rec.name || '')).toLowerCase().includes(q);
    });
  }
  const sort = listState.sort;
  if (sort === 'name') ids = ids.slice().sort((a, b) => ((quotes[a] && quotes[a].name) || a).localeCompare((quotes[b] && quotes[b].name) || b));
  else if (sort === 'price') ids = ids.slice().sort((a, b) => ((quotes[b] && quotes[b].price) || 0) - ((quotes[a] && quotes[a].price) || 0));
  else ids = sortMarketIds(ids, sort === 'losers' ? 'losers' : sort === 'volume' ? 'volume' : sort === 'mcap' ? 'mcap' : 'gainers');
  if (listState.list === 'up3m') {
    const rank = {};
    (movers3m.items || []).forEach((x, i) => { rank[x.id] = x.ret; });
    if (sort === 'gainers' || sort === 'losers') ids = ids.slice().sort((a, b) => (rank[b] || 0) - (rank[a] || 0));
  }
  return ids;
}
function renderListPage() {
  const el = $('#listPage');
  if (!el || !listState) return;
  const keepY = el.scrollTop || 0;
  const ids = listFiltered();
  const shown = ids.slice(0, listState.shown || 40);
  const opts = listState.pane === 'crypto' ? cryptoRowOpts() : { spark: true };
  if (listState.list === 'up3m') {
    opts.rgt = null;
    // custom rgt set per row below
  }
  const rows = shown.map(id => {
    if (listState.list === 'up3m') {
      const rec = (movers3m.items || []).find(x => x.id === id) || {};
      return rowHTML(id, { spark: true, sparkVals: rec.spark, sparkUp: rec.ret >= 0, rgt: '<div class="px">' + (quotes[id] && quotes[id].price != null ? pxText(id, quotes[id].price, { px: true }) : '—') + '</div><div class="chg up">' + (rec.ret != null ? pct(rec.ret) : '—') + '</div>' });
    }
    const o = Object.assign({}, opts);
    if (typeof o.sub === 'function') o.sub = o.sub(id);
    return rowHTML(id, o);
  }).join('');
  const chips = [
    ['gainers', 'Gainers'], ['losers', 'Losers'], ['volume', 'Most active'], ['name', 'Name']
  ];
  if (listState.pane === 'crypto') chips.push(['mcap', 'Market cap']);
  el.innerHTML =
    '<div class="d-bar"><button class="ib" data-act="close-list" aria-label="Back"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg></button><h2>' + esc(listTitle(listState.pane, listState.list)) + '</h2><span style="width:36px"></span></div>' +
    '<div class="d-in list-page">' +
      '<div class="search list-search"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>' +
      '<input id="listQ" type="search" placeholder="Search name or symbol" value="' + esc(listState.q || '') + '" autocomplete="off"></div>' +
      '<div class="filters">' + chips.map(c => '<button type="button" class="' + (listState.sort === c[0] ? 'on' : '') + '" data-act="list-sort" data-id="' + c[0] + '">' + c[1] + '</button>').join('') + '</div>' +
      '<p class="list-status">' + ids.length + ' names' + (listState.list === 'up3m' ? ' · up 10% or more over about 3 months. Not financial advice.' : '') + '</p>' +
      '<div class="list">' + (rows || '<div class="empty"><p>Nothing in this list yet.</p></div>') + '</div>' +
      (ids.length > shown.length ? '<button type="button" class="see-all" data-act="list-more">Show more</button>' : '') +
    '</div>';
  const input = $('#listQ');
  if (input) {
    input.addEventListener('input', () => {
      listState.q = input.value;
      listState.shown = 40;
      const pos = input.selectionStart;
      renderListPage();
      const next = $('#listQ');
      if (next) { next.focus(); try { next.setSelectionRange(pos, pos); } catch (e) {} }
    });
    el.onscroll = () => {
      if (!listState) return;
      if (el.scrollTop + el.clientHeight > el.scrollHeight - 240) {
        const all = listFiltered();
        if (listState.shown < all.length) { listState.shown += 40; renderListPage(); }
      }
    };
  }
  el.scrollTop = keepY;
}

async function ensureQuote(id) {
  if (!id || isCryptoId(id)) return quotes[id];
  if (quotes[id] && quotes[id].ok && quotes[id].price != null && !quoteStale(quotes[id], 15 * 60)) return quotes[id];
  if (quoteFails[id] >= 2 && quotes[id] && quotes[id].price != null) return quotes[id];
  const q = await refreshEquityQuote(id);
  if (q && q.price != null) return q;
  quoteFails[id] = (quoteFails[id] || 0) + 1;
  return quotes[id] || null;
}


/* ---- t17+ portfolio tools (dividends, P/L calendar, benchmark, ISA, T212) ---- */
function isaTaxYear(d) {
  d = d || new Date();
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(d);
  const y = +parts.find(p => p.type === 'year').value;
  const m = +parts.find(p => p.type === 'month').value;
  const day = +parts.find(p => p.type === 'day').value;
  const startYear = (m > 4 || (m === 4 && day >= 6)) ? y : y - 1;
  return { startYear: startYear, label: startYear + '/' + String(startYear + 1).slice(-2) };
}
function loadIsa() {
  const yr = isaTaxYear();
  const rec = store.get('isa', null) || {};
  if (rec.year !== yr.label) {
    return { year: yr.label, limit: rec.limit != null ? rec.limit : 20000, used: 0 };
  }
  return { year: yr.label, limit: rec.limit != null ? rec.limit : 20000, used: rec.used != null ? rec.used : 0 };
}
function saveIsa(rec) { store.set('isa', rec); }

function isaHTML() {
  const rec = loadIsa();
  const used = Number(rec.used) || 0;
  const limit = Number(rec.limit) || 20000;
  const left = Math.max(0, limit - used);
  const pctV = limit ? Math.min(100, used / limit * 100) : 0;
  return '<div class="sec-h"><h2>ISA allowance</h2></div><div class="ai-card isa-card">' +
    '<p class="ai-outlook">UK stocks and shares ISA for tax year ' + esc(rec.year) + '. The annual limit starts at £20,000 and is editable. This stays on this device.</p>' +
    '<div class="isa-bar"><span style="width:' + pctV.toFixed(1) + '%"></span></div>' +
    '<div class="stats">' +
      stat('Used', used, 'GBP') +
      stat('Remaining', left, 'GBP') +
      stat('Limit', limit, 'GBP') +
    '</div>' +
    '<button type="button" class="btn ghost sm" data-act="edit-isa">Edit allowance</button>' +
    '</div>';
}
function openIsaEditor() {
  const rec = loadIsa();
  openModal('<div class="sheet"><div class="grab"></div><header><h3>ISA allowance</h3><button class="x" data-act="close">Close</button></header>' +
    '<p class="hint">UK tax year ' + esc(rec.year) + ' (6 April to 5 April). Figures stay on this device and are not uploaded.</p>' +
    '<div class="field"><label for="isaUsed">Used so far (£)</label><input id="isaUsed" type="number" inputmode="decimal" step="any" min="0" value="' + esc(rec.used) + '"></div>' +
    '<div class="field"><label for="isaLimit">Annual limit (£)</label><input id="isaLimit" type="number" inputmode="decimal" step="any" min="0" value="' + esc(rec.limit) + '"></div>' +
    '<div class="btns"><button class="btn" data-act="save-isa">Save</button></div></div>');
}
function saveIsaEditor() {
  const used = parseFloat($('#isaUsed') && $('#isaUsed').value);
  const limit = parseFloat($('#isaLimit') && $('#isaLimit').value);
  if (!isFinite(used) || used < 0 || !isFinite(limit) || limit < 0) { toast('Enter valid pound amounts.'); return; }
  const rec = loadIsa();
  rec.used = used; rec.limit = limit;
  saveIsa(rec); closeModal(); renderPort(); toast('ISA allowance saved on this device');
}

function parseCsvRow(line) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; continue; }
    if (ch === ',' && !q) { out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur.trim());
  return out;
}
function mapImportedTicker(raw) {
  if (!raw) return '';
  let id = String(raw).trim().toUpperCase().replace(/\s+/g, '');
  if (!id) return '';
  if (quotes[id] || instrumentRec(id) || isCryptoId(id)) return id;
  if (quotes[id + '.L'] || instrumentRec(id + '.L')) return id + '.L';
  if (id.endsWith('.US') && (quotes[id.slice(0, -3)] || instrumentRec(id.slice(0, -3)))) return id.slice(0, -3);
  if (id === 'BRK.B' || id === 'BRK/B') return 'BRK-B';
  if (id === 'BRK.A' || id === 'BRK/A') return 'BRK-A';
  return id;
}
function parseT212Csv(text) {
  const lines = String(text || '').split(/\r?\n/).map(s => s.trimEnd()).filter(l => l.trim());
  if (!lines.length) return { ok: false, error: 'Paste a CSV first.' };
  const header = parseCsvRow(lines[0]).map(s => s.toLowerCase().trim());
  const col = name => {
    const i = header.indexOf(name.toLowerCase());
    return i >= 0 ? i : -1;
  };
  const isT212 = col('action') >= 0 && (col('ticker') >= 0 || col('no. of shares') >= 0);
  const lots = {};
  const deposits = [];
  if (!isT212) {
    const start = header.some(h => h.includes('symbol') || h === 'ticker') ? 1 : 0;
    const si = header.findIndex(h => h === 'symbol' || h === 'ticker');
    const qi = header.findIndex(h => h === 'quantity' || h === 'qty' || h === 'shares' || h === 'no. of shares');
    const ai = header.findIndex(h => h === 'avg_price' || h === 'avg' || h === 'price' || h === 'average price' || h === 'price / share');
    let n = 0;
    const holdingsOut = [];
    for (const line of lines.slice(start)) {
      const parts = parseCsvRow(line);
      const id = mapImportedTicker(si >= 0 ? parts[si] : parts[0]);
      const qty = parseFloat(qi >= 0 ? parts[qi] : parts[1]);
      const avgRaw = ai >= 0 ? parts[ai] : parts[2];
      const avg = avgRaw === '' || avgRaw == null ? null : parseFloat(avgRaw);
      if (!id || !isFinite(qty) || qty <= 0) continue;
      holdingsOut.push({ id: id, qty: qty, avg: (avg != null && isFinite(avg) && avg >= 0) ? avg : null });
      n++;
    }
    return { ok: n > 0, kind: 'simple', holdings: holdingsOut, deposits: [], error: n ? null : 'No valid symbol, quantity rows found.' };
  }
  const iAction = col('action'), iTicker = col('ticker'), iShares = col('no. of shares'), iPrice = col('price / share'), iTotal = col('total'), iCcy = col('currency (total)') >= 0 ? col('currency (total)') : col('currency (price / share)'), iTime = col('time');
  for (const line of lines.slice(1)) {
    const parts = parseCsvRow(line);
    const action = (parts[iAction] || '').toLowerCase();
    if (!action) continue;
    if (action === 'deposit' || action.indexOf('deposit') === 0) {
      const amt = parseFloat(parts[iTotal >= 0 ? iTotal : parts.length - 2]);
      const ccy0 = (iCcy >= 0 ? parts[iCcy] : 'GBP') || 'GBP';
      const when = iTime >= 0 ? parts[iTime] : '';
      if (isFinite(amt) && amt > 0) deposits.push({ amount: amt, currency: ccy0, time: when });
      continue;
    }
    if (action.indexOf('withdrawal') === 0) continue;
    const buy = /\bbuy\b/.test(action);
    const sell = /\bsell\b/.test(action);
    if (!buy && !sell) continue;
    const id = mapImportedTicker(iTicker >= 0 ? parts[iTicker] : '');
    const qty = Math.abs(parseFloat(iShares >= 0 ? parts[iShares] : ''));
    const px = parseFloat(iPrice >= 0 ? parts[iPrice] : '');
    if (!id || !isFinite(qty) || qty <= 0) continue;
    if (!lots[id]) lots[id] = { qty: 0, cost: 0 };
    const lot = lots[id];
    if (buy) {
      const pxUse = isFinite(px) ? px : 0;
      lot.cost += pxUse * qty;
      lot.qty += qty;
    } else if (sell) {
      const q = Math.min(qty, lot.qty);
      if (lot.qty > 0 && q > 0) {
        lot.cost *= (lot.qty - q) / lot.qty;
        lot.qty -= q;
      }
    }
  }
  const holdingsOut = Object.entries(lots).filter(([, l]) => l.qty > 1e-10).map(([id, l]) => ({
    id: id, qty: l.qty, avg: l.qty ? (l.cost / l.qty) : null
  }));
  return { ok: holdingsOut.length > 0 || deposits.length > 0, kind: 't212', holdings: holdingsOut, deposits: deposits, error: (holdingsOut.length || deposits.length) ? null : 'No Trading 212 buys, sells or deposits were found.' };
}

function openImport() {
  openModal('<div class="sheet"><div class="grab"></div><header><h3>Import holdings</h3><button class="x" data-act="close">Close</button></header>' +
    '<p class="hint">Paste a simple CSV (symbol, quantity, avg_price) or a Trading 212 transaction export. Parsed in this browser only — nothing is uploaded.</p>' +
    '<div class="field"><label for="csvFile">CSV file</label><input id="csvFile" type="file" accept=".csv,text/csv,text/plain"></div>' +
    '<div class="field"><label for="csv">Or paste CSV</label><textarea id="csv" rows="8" placeholder="symbol,quantity,avg_price&#10;AAPL,10,180"></textarea></div>' +
    '<label class="chk"><input type="checkbox" id="isaFromCsv"> Add T212 deposits to this device’s ISA used amount (only if this export is from an ISA)</label>' +
    '<div class="btns"><button class="btn" data-act="do-import">Import</button></div></div>');
  const file = $('#csvFile');
  if (file) file.addEventListener('change', ev => {
    const f = ev.target.files && ev.target.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => { const ta = $('#csv'); if (ta) ta.value = String(r.result || ''); };
    r.readAsText(f);
  });
}
function doImport() {
  const raw = ($('#csv') && $('#csv').value) || '';
  const parsed = parseT212Csv(raw);
  if (!parsed.ok) { toast(parsed.error || 'No valid rows found.'); return; }
  const next = holdings.slice();
  let n = 0;
  for (const rec of parsed.holdings) {
    const i = next.findIndex(h => h.id === rec.id);
    if (i >= 0) next[i] = rec; else next.push(rec);
    n++;
  }
  if (n) { holdings = next; persistHoldings(); }
  const addIsa = $('#isaFromCsv') && $('#isaFromCsv').checked;
  let depN = 0, depSum = 0;
  if (addIsa && parsed.deposits && parsed.deposits.length) {
    const rec = loadIsa();
    for (const d of parsed.deposits) {
      let amt = d.amount;
      if ((d.currency || 'GBP') !== 'GBP') {
        const v = convert(amt, d.currency, 'GBP');
        if (v == null || !isFinite(v)) continue;
        amt = v;
      }
      rec.used = (Number(rec.used) || 0) + amt;
      depSum += amt;
      depN++;
    }
    saveIsa(rec);
  }
  closeModal(); renderAll();
  const bits = [];
  if (n) bits.push(n + ' holding' + (n > 1 ? 's' : ''));
  if (depN) bits.push(depN + ' ISA deposit' + (depN > 1 ? 's' : '') + ' (' + money(depSum, 'GBP') + ')');
  toast('Imported ' + bits.join(' and ') + '. Saved on this device only.');
}

function dividendTrackerHTML() {
  if (!holdings.length) return '';
  return '<div class="sec-h"><h2>Dividends</h2></div><div class="ai-card" id="divTrack"><p class="note">Working out dividend income from saved history…</p></div>';
}
async function fillDividendTracker() {
  const host = $('#divTrack');
  if (!host || !holdings.length) return;
  const now = Date.now() / 1000;
  const yearAgo = now - 365 * 86400;
  let ttmUSD = 0, rows = [];
  let costUSD = 0, ttmOnCostUSD = 0;
  for (const h of holdings) {
    if (isCryptoId(h.id)) continue;
    let d = null;
    try { d = await loadHist(h.id); } catch (e) { d = null; }
    const q = quotes[h.id] || {};
    const cur = (d && d.currency) || q.currency || 'USD';
    const divs = (d && d.dividends) || [];
    let ttm = 0;
    const last = divs.length ? divs[divs.length - 1] : (q.lastDiv || null);
    for (const dv of divs) {
      const ts = dv.t || dv.date || dv.time;
      const amt = dv.amount;
      if (amt == null || ts == null) continue;
      const t = ts > 1e12 ? ts / 1000 : ts;
      if (t >= yearAgo && t <= now) ttm += amt;
    }
    const ttmCash = ttm * h.qty;
    const usd = toUSD(ttmCash, cur);
    if (usd != null) ttmUSD += usd;
    if (h.avg != null && h.qty) {
      const c = toUSD(h.avg * h.qty, cur);
      if (c != null) { costUSD += c; ttmOnCostUSD += usd || 0; }
    }
    if (ttm > 0 || last) {
      const lastT = last && (last.t || last.date);
      rows.push({
        id: h.id, name: q.name || h.id, ttm: ttmCash, cur: cur,
        yoc: (h.avg && ttm) ? (ttm / h.avg * 100) : null,
        last: last, lastT: lastT
      });
    }
  }
  const yoc = costUSD ? (ttmOnCostUSD / costUSD * 100) : null;
  if (!rows.length && !ttmUSD) {
    host.innerHTML = '<p class="note">No dividend history was found for these holdings in the Yahoo data on this device. Upcoming payout dates are only shown when a future ex-dividend date is in our sources — none are listed right now.</p>';
    return;
  }
  host.innerHTML = '<div class="stats">' +
    stat('Income, last 12 months', ttmUSD, 'USD') +
    (yoc != null ? stat('Yield on cost', null, null, pct(yoc)) : '') +
    stat('Upcoming', null, null, 'None listed in our sources') +
    '</div>' +
    (rows.length ? '<div class="list compact">' + rows.map(r => {
      const lastWhen = r.lastT ? new Date((r.lastT > 1e12 ? r.lastT : r.lastT * 1000)).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/London' }) : '';
      return '<a class="row" href="#/s/' + encodeURIComponent(r.id) + '">' + avHTML(r.id, r.name) +
        '<div class="mid"><div class="nm">' + esc(r.name) + '</div><div class="tk"><span>' + esc(r.id) + (lastWhen ? ' · last ' + lastWhen : '') + '</span></div></div>' +
        '<div class="rgt"><div class="px">' + money(toUSD(r.ttm, r.cur), 'USD') + '</div>' +
        (r.yoc != null ? '<div class="chg ' + chgClass(r.yoc) + '">' + pct(r.yoc) + ' on cost</div>' : '') + '</div></a>';
    }).join('') + '</div>' : '') +
    '<p class="note">Last 12 months of Yahoo dividend history, using your current share count. Purchase dates are not stored, so this is not a personal tax record. Yield on cost is trailing 12-month dividends per share divided by your average buy price. Not financial advice.</p>';
}

function pnlHeatHTML() {
  if (!holdings.length) return '';
  return '<div class="sec-h"><h2>P/L calendar</h2></div><div id="pnlHeat"><p class="note">Building a daily gain and loss calendar from your holdings…</p></div>';
}
function londonYmd(ts) {
  const d = new Date((ts > 1e12 ? ts : ts * 1000));
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
  const g = t => parts.find(p => p.type === t).value;
  return g('year') + '-' + g('month') + '-' + g('day');
}
async function fillPnLHeat() {
  const host = $('#pnlHeat');
  if (!host || !holdings.length) return;
  let pts;
  try { pts = await portfolioSeries('3M'); } catch (e) { pts = []; }
  if (!pts || pts.length < 2) {
    host.innerHTML = '<p class="note">Not enough daily history to draw a P/L calendar yet.</p>';
    return;
  }
  const byDay = {};
  for (let i = 1; i < pts.length; i++) {
    const key = londonYmd(pts[i].time);
    const chg = pts[i].value - pts[i - 1].value;
    byDay[key] = (byDay[key] || 0) + chg;
  }
  const days = Object.keys(byDay).sort();
  if (!days.length) { host.innerHTML = '<p class="note">No daily changes in this window.</p>'; return; }
  // months covering the window
  const months = [];
  const start = days[0].slice(0, 7);
  const end = days[days.length - 1].slice(0, 7);
  let y = +start.slice(0, 4), m = +start.slice(5, 7);
  const ey = +end.slice(0, 4), em = +end.slice(5, 7);
  while (y < ey || (y === ey && m <= em)) {
    months.push({ y: y, m: m });
    m++; if (m > 12) { m = 1; y++; }
  }
  const wd = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  const maxAbs = Math.max(...Object.values(byDay).map(v => Math.abs(v)), 1);
  const html = months.map(({ y, m }) => {
    const first = new Date(Date.UTC(y, m - 1, 1));
    // weekday Mon=0 in UK
    const js = first.getUTCDay(); // Sun=0
    const lead = (js + 6) % 7;
    const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const title = first.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    let cells = '';
    for (let i = 0; i < lead; i++) cells += '<span class="pnl-empty"></span>';
    for (let d = 1; d <= dim; d++) {
      const key = y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
      const v = byDay[key];
      if (v == null) { cells += '<span class="pnl-empty" title="' + key + '"></span>'; continue; }
      const cls = v > 0 ? 'up' : (v < 0 ? 'dn' : 'flat');
      const a = Math.min(1, 0.25 + Math.abs(v) / maxAbs * 0.75);
      cells += '<span class="pnl-day ' + cls + '" style="--a:' + a.toFixed(2) + '" title="' + key + ' · ' + (v >= 0 ? '+' : '') + money(v, ccy) + '"></span>';
    }
    return '<div class="pnl-month"><div class="k">' + esc(title) + '</div><div class="pnl-wd">' + wd.map(x => '<span>' + x + '</span>').join('') + '</div><div class="pnl-grid">' + cells + '</div></div>';
  }).join('');
  host.innerHTML = '<div class="pnl-cal">' + html + '</div><p class="note">Daily change in estimated portfolio value from Yahoo and Kraken history, in ' + esc(ccy) + ', last about 3 months. Weekends with no session are blank. Not a brokerage statement.</p>';
}

function benchmarkHTML() {
  if (!holdings.length) return '';
  return '<div class="sec-h"><h2>Benchmark</h2></div><div id="benchBox"><p class="note">Comparing your portfolio with the S&amp;P 500 and FTSE 100…</p></div>';
}
async function fillBenchmark() {
  const host = $('#benchBox');
  if (!host || !holdings.length) return;
  const range = portRange || '3M';
  const ret = pts => {
    if (!pts || pts.length < 2) return null;
    const a = pts[0].value, b = pts[pts.length - 1].value;
    if (a == null || !a) return null;
    return (b - a) / a * 100;
  };
  let port = [], sp = [], ft = [];
  try { port = await portfolioSeries(range); } catch (e) {}
  try {
    const d = await loadHist('^GSPC');
    sp = clipHist(d, range).map(b => ({ time: b.t || b.time, value: b.v != null ? b.v : b.value }));
  } catch (e) {}
  try {
    const d = await loadHist('^FTSE');
    ft = clipHist(d, range).map(b => ({ time: b.t || b.time, value: b.v != null ? b.v : b.value }));
  } catch (e) {}
  const rows = [
    ['Portfolio', ret(port), 'Your holdings, valued in ' + ccy],
    ['S&P 500', ret(sp), 'Index points, ^GSPC'],
    ['FTSE 100', ret(ft), 'Index points, ^FTSE']
  ];
  if (rows.every(r => r[1] == null)) {
    host.innerHTML = '<p class="note">Not enough overlapping history to compare this period.</p>';
    return;
  }
  host.innerHTML = '<p class="note">Same window as the portfolio chart (' + esc(range === 'MAX' ? 'All' : range) + '). Indices are shown as percentage change in index points, not as currency-converted funds.</p>' +
    '<div class="stats">' + rows.map(r => stat(r[0], null, null, r[1] == null ? '—' : pct(r[1]))).join('') + '</div>' +
    '<div id="benchChart" class="bench-chart"></div>';
  const el = $('#benchChart');
  if (!el || !window.LightweightCharts) return;
  const dark = document.documentElement.dataset.theme === 'dark';
  const LW = window.LightweightCharts;
  try {
    const chart = LW.createChart(el, {
      autoSize: true, height: 180,
      layout: { background: { color: 'transparent' }, textColor: '#8e8e93', fontFamily: 'Inter Tight, Inter, system-ui', fontSize: 11, attributionLogo: false },
      grid: { vertLines: { visible: false }, horzLines: { color: dark ? 'rgba(255,255,255,.06)' : 'rgba(16,16,14,.06)' } },
      rightPriceScale: { borderVisible: false }, timeScale: { borderVisible: false, timeVisible: false },
      handleScroll: false, handleScale: false
    });
    const cols = ['#00C805', dark ? '#e5e5ea' : '#1c1c1e', dark ? '#64d2ff' : '#0a84ff'];
    [port, sp, ft].forEach((pts, i) => {
      const pctPts = toPct((pts || []).map(p => ({ time: p.time || p.t, value: p.value })));
      if (pctPts.length < 2) return;
      const s = chart.addSeries(LW.LineSeries, { color: cols[i], lineWidth: i ? 1.6 : 2.4, priceLineVisible: false, lastValueVisible: false });
      s.setData(pctPts);
    });
    chart.timeScale().fitContent();
  } catch (e) {}
}

function listingCountry(id, q) {
  q = q || {};
  if (isCryptoId(id, q) || q.kind === 'crypto') return 'Crypto';
  if (q.kind === 'commodity' || String(id).indexOf('=F') >= 0) return 'Commodities';
  if (String(id).endsWith('.L') || /LSE|LON|LONDON/i.test(q.exchange || '')) return 'United Kingdom';
  return 'United States';
}
function riskHTML() {
  if (!holdings.length) return '';
  return '<div class="sec-h"><h2>Diversification &amp; risk</h2></div><div id="riskBox"><p class="note">Working out sector, country and beta from listed holdings…</p></div>';
}
async function fillRisk() {
  const host = $('#riskBox');
  if (!host || !holdings.length) return;
  const st = portfolioStats();
  if (!st || !st.lines) { host.innerHTML = ''; return; }
  const sec = {}, cty = {};
  let total = 0;
  for (const l of st.lines) {
    if (l.valUSD == null) continue;
    total += l.valUSD;
    const inst = instrumentRec(l.h.id);
    const sector = (inst && inst.sector) || (isCryptoId(l.h.id) ? 'Crypto' : (kindOf(l.h.id, l.q) === 'etf' ? 'ETF' : 'Unknown sector'));
    const country = listingCountry(l.h.id, l.q);
    sec[sector] = (sec[sector] || 0) + l.valUSD;
    cty[country] = (cty[country] || 0) + l.valUSD;
  }
  const bar = (map, title, note) => {
    const rows = Object.entries(map).sort((a, b) => b[1] - a[1]);
    if (!rows.length || !total) return '';
    return '<h3 class="risk-h">' + title + '</h3>' +
      rows.map(r => {
        const p = r[1] / total * 100;
        return '<div class="risk-row"><div class="k">' + esc(r[0]) + ' · ' + p.toFixed(1) + '%</div><div class="bar"><span style="width:' + p.toFixed(1) + '%;background:var(--accent)"></span></div></div>';
      }).join('') + (note ? '<p class="note">' + note + '</p>' : '');
  };
  let betaStr = '—';
  let betaNote = 'Beta versus the S&amp;P 500 uses overlapping daily returns from the last year. Need at least 20 days.';
  try {
    const port = await portfolioSeries('1Y');
    const d = await loadHist('^GSPC');
    const sp = clipHist(d, '1Y').map(b => ({ time: b.t || b.time, value: b.v != null ? b.v : b.value }));
    const mapP = {}, mapS = {};
    port.forEach(p => { mapP[londonYmd(p.time)] = p.value; });
    sp.forEach(p => { mapS[londonYmd(p.time)] = p.value; });
    const keys = Object.keys(mapP).filter(k => mapS[k] != null).sort();
    const rp = [], rs = [];
    for (let i = 1; i < keys.length; i++) {
      const p0 = mapP[keys[i - 1]], p1 = mapP[keys[i]], s0 = mapS[keys[i - 1]], s1 = mapS[keys[i]];
      if (!p0 || !s0) continue;
      rp.push((p1 - p0) / p0);
      rs.push((s1 - s0) / s0);
    }
    if (rp.length >= 20) {
      const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
      const mp = mean(rp), ms = mean(rs);
      let cov = 0, varS = 0;
      for (let i = 0; i < rp.length; i++) {
        cov += (rp[i] - mp) * (rs[i] - ms);
        varS += (rs[i] - ms) * (rs[i] - ms);
      }
      if (varS) {
        const beta = cov / varS;
        betaStr = beta.toFixed(2);
        betaNote = 'Portfolio beta versus the S&amp;P 500 (^GSPC) over ' + rp.length + ' overlapping daily returns in the last year. A figure near 1 moves with the index. Not a forecast.';
      }
    }
  } catch (e) {}
  host.innerHTML = '<div class="stats">' + stat('Beta vs S&P 500', null, null, betaStr) + '</div>' +
    '<p class="note">' + betaNote + '</p>' +
    bar(sec, 'Sector exposure', 'Sectors come from the instrument file. ETFs and names without a sector are labelled as such.') +
    bar(cty, 'Country exposure', 'This is the listing venue (UK = London, United States = US-listed, plus crypto and commodities), not where the company earns revenue.');
}


/* ---- t18 alerts, brief, screener, trades, earnings, compare, charts ---- */
let politicianTrades = { bySymbol: {} };
let morningBriefShown = store.get('briefDay', '');
let lastEarnSeen = store.get('earnSeen', {});
let lastNewsAlertSeen = store.get('newsAlertSeen', {});
let watchCompact = !!store.get('watchCompact', false);
let compareId2 = null;
let trendDraw = false;
let trendLines = [];
let trendClick = null;

async function loadPoliticianTrades() {
  try {
    const r = await fetch('data/politician_trades.json?t=' + BUILD, { cache: 'no-cache' });
    if (!r.ok) return;
    politicianTrades = await r.json();
  } catch (e) {}
}

function notifyLocal(title, body, tag, href) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return false;
  try {
    const n = new Notification(title, { body: body || '', tag: tag || 'ticker', icon: 'icons/icon-192.png' });
    if (href) n.onclick = () => { try { location.hash = href; n.close(); } catch (e) {} };
    return true;
  } catch (e) { return false; }
}

function checkEventAlerts() {
  const ids = new Set(watchSyms());
  (holdings || []).forEach(h => ids.add(h.id));
  const seenE = Object.assign({}, lastEarnSeen);
  const seenN = Object.assign({}, lastNewsAlertSeen);
  const seedOnly = !store.get('eventAlertsReady', false);
  let changed = false;
  ids.forEach(id => {
    const rec = analysisRec(id);
    const last = rec && rec.lastEarnings;
    if (last && last.dateReported) {
      const key = id + ':' + last.dateReported;
      if (!seenE[key]) {
        const q = quotes[id] || {};
        const name = q.symbol || id;
        const beat = last.surprisePct != null ? (last.surprisePct >= 0 ? 'beat' : 'missed') : 'reported';
        if (!seedOnly) notifyLocal(name + ' earnings', 'Latest report ' + beat + (last.surprisePct != null ? ' (' + (last.surprisePct >= 0 ? '+' : '') + last.surprisePct.toFixed(1) + '% vs consensus)' : ''), 'earn-' + key, '#/s/' + encodeURIComponent(id));
        seenE[key] = 1;
        changed = true;
      }
    }
    const items = (news && news.bySymbol && news.bySymbol[id]) || [];
    items.forEach(n => {
      const title = (n.title || '');
      if (!/\b(upgrad(?:e|ed|es)|downgrad(?:e|ed|es)|initiated|price target)\b/i.test(title)) return;
      const key = (n.url || title).slice(0, 180);
      if (seenN[key]) return;
      if (!seedOnly) notifyLocal((quotes[id] && quotes[id].symbol) || id, title, 'an-' + key.slice(-24), '#/s/' + encodeURIComponent(id));
      seenN[key] = 1;
      changed = true;
    });
  });
  if (changed) {
    lastEarnSeen = seenE;
    lastNewsAlertSeen = seenN;
    store.set('earnSeen', seenE);
    store.set('newsAlertSeen', seenN);
  }
  if (seedOnly) store.set('eventAlertsReady', true);
}

function londonHM() {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const g = t => parts.find(p => p.type === t).value;
  return { hm: g('hour') + ':' + g('minute'), day: g('year') + '-' + g('month') + '-' + g('day') };
}
function maybeMorningPush() {
  const { hm, day } = londonHM();
  if (hm < '07:30' || hm >= '10:00') return;
  if (morningBriefShown === day) return;
  morningBriefShown = day;
  store.set('briefDay', day);
  const st = portfolioStats();
  const dayBit = st && st.day != null ? ((st.day >= 0 ? '+' : '') + money(st.day, 'USD') + (st.dayPct != null ? ' (' + pct(st.dayPct) + ')' : '')) : 'Open Ticker for the morning brief';
  notifyLocal('Morning brief', dayBit, 'brief-' + day, '#/brief');
}

function briefIndexRows() {
  const ids = ['^GSPC', '^DJI', '^IXIC', '^FTSE', 'GC=F', 'CL=F'];
  return ids.map(id => {
    const q = quotes[id];
    if (!q || q.price == null) return null;
    return { id: id, name: q.shortName || q.name || id, px: q.price, chg: q.changePct };
  }).filter(Boolean);
}
function morningBriefHTML() {
  const st = portfolioStats();
  const newsBits = ((news && news.market) || []).filter(n => !isStubHeadline(n)).slice(0, 8);
  rememberNews(newsBits);
  const idx = briefIndexRows();
  let port = '<p class="note">No holdings on this device yet.</p>';
  if (st && st.known) {
    port = '<div class="stats">' +
      stat('Value', st.value, 'USD') +
      stat('Day change', null, null, st.day != null ? ((st.day >= 0 ? '+' : '') + money(st.day, 'USD') + (st.dayPct != null ? ' · ' + pct(st.dayPct) : '')) : '—') +
      (st.pnlPct != null ? stat('Total return', null, null, pct(st.pnlPct)) : '') +
      '</div>';
  }
  const idxHtml = idx.length
    ? '<div class="list compact">' + idx.map(r => rowHTML(r.id, { spark: false })).join('') + '</div>' +
      '<p class="note">These are index and spot levels from Yahoo Finance, not futures contracts. Index futures were not in the quote file.</p>'
    : '<p class="note">Index levels are not in the latest quote file.</p>';
  return '<div class="d-in ai-page">' +
    '<p class="eyebrow">07:30 UK</p><h2 style="font-size:28px;margin-bottom:8px">Morning brief</h2>' +
    '<p class="note">Built from the latest quotes and headlines on this device. Notifications only fire while Ticker is open, because GitHub Pages cannot host a free background push server.</p>' +
    '<div class="sec-h"><h2>Portfolio</h2></div>' + port +
    '<div class="sec-h"><h2>Markets</h2></div>' + idxHtml +
    (newsBits.length ? '<div class="sec-h"><h2>Top news</h2></div>' + newsListHTML(newsBits) : '') +
    creditHTML() + '</div>';
}
function openBrief(opts) {
  opts = opts || {};
  const el = $('#briefPage');
  if (!el) return;
  if (readerItem) closeReader(true);
  if (listState) closeListPage(true);
  if (aiPageId) closeAiPage(true);
  el.innerHTML = '<div class="d-bar"><button class="ib" data-act="close-brief" aria-label="Back"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg></button><h2>Morning brief</h2><span style="width:36px"></span></div>' + morningBriefHTML();
  el.hidden = false;
  document.body.classList.add('hide-dock');
  if (!opts.fromHash) history.pushState({ brief: 1 }, '', '#/brief');
}
function closeBrief(fromPop) {
  const el = $('#briefPage');
  if (el) { el.hidden = true; el.innerHTML = ''; }
  document.body.classList.remove('hide-dock');
  if (!fromPop && location.hash.indexOf('#/brief') === 0) {
    if (history.length > 1) history.back();
    else history.replaceState(null, '', '#/');
  }
}

function screenerUniverse() {
  const ids = new Set();
  (instruments.items || []).forEach(it => { if (it && it.id && it.kind !== 'crypto') ids.add(it.id); });
  Object.keys(quotes).forEach(id => {
    const q = quotes[id];
    if (q && q.ok && (q.kind === 'equity' || q.kind === 'etf')) ids.add(id);
  });
  return [...ids];
}
function tickerPe(id) {
  const q = quotes[id] || {};
  const rec = analysisRec(id);
  const pe = q.pe || q.trailingPE || q.peRatio || (rec && rec.pe);
  return (pe != null && isFinite(pe) && pe > 0) ? +pe : null;
}
function tickerDivYield(id) {
  const q = quotes[id] || {};
  if (!q.price || !q.lastDiv || q.lastDiv.amount == null) return null;
  // Do not assume a quarterly cycle. Only expose "has last dividend".
  return q.lastDiv.amount;
}
function tickerMcap(id) {
  const q = quotes[id] || {};
  if (q.marketCap) return q.marketCap;
  return (marketCaps && (marketCaps[id] || (marketCaps.bySymbol && marketCaps.bySymbol[id]))) || null;
}
function tickerMom(id) {
  const rec = (movers3m && movers3m.items || []).find(x => x.id === id);
  if (rec && rec.ret != null) return rec.ret * (Math.abs(rec.ret) <= 2 ? 100 : 1) && rec.ret; // movers may already be fraction or pct
  const q = quotes[id] || {};
  return q.changePct;
}
function mom3m(id) {
  const rec = (movers3m && movers3m.items || []).find(x => x.id === id);
  if (!rec || rec.ret == null) return null;
  return rec.ret;
}

let screenerState = { q: '', sector: '', mcap: '', pe: '', div: '', mom: '' };

function sectorList() {
  const s = new Set();
  (instruments.items || []).forEach(it => { if (it.sector) s.add(it.sector); });
  return [...s].sort();
}
function screenerFiltered() {
  let ids = screenerUniverse();
  const q = (screenerState.q || '').trim().toLowerCase();
  if (q) ids = ids.filter(id => {
    const rec = quotes[id] || instrumentRec(id) || {};
    return (id + ' ' + (rec.symbol || '') + ' ' + (rec.name || '') + ' ' + (rec.sector || '')).toLowerCase().includes(q);
  });
  if (screenerState.sector) ids = ids.filter(id => {
    const inst = instrumentRec(id);
    return inst && inst.sector === screenerState.sector;
  });
  if (screenerState.div === 'yes') ids = ids.filter(id => tickerDivYield(id) != null);
  if (screenerState.div === 'no') ids = ids.filter(id => tickerDivYield(id) == null);
  if (screenerState.mom === 'up3m') ids = ids.filter(id => { const m = mom3m(id); return m != null && m >= 10; });
  if (screenerState.mom === 'dn3m') ids = ids.filter(id => { const m = mom3m(id); return m != null && m <= -10; });
  if (screenerState.mom === 'up1d') ids = ids.filter(id => { const q = quotes[id]; return q && q.changePct >= 2; });
  // mcap / pe only when data exists
  const hasMcap = ids.some(id => tickerMcap(id));
  const hasPe = ids.some(id => tickerPe(id));
  if (screenerState.mcap && hasMcap) {
    const min = { '2b': 2e9, '10b': 1e10, '50b': 5e10, '200b': 2e11 }[screenerState.mcap];
    if (min) ids = ids.filter(id => (tickerMcap(id) || 0) >= min);
  }
  if (screenerState.pe && hasPe) {
    ids = ids.filter(id => {
      const pe = tickerPe(id);
      if (pe == null) return false;
      if (screenerState.pe === 'lt15') return pe < 15;
      if (screenerState.pe === '15-25') return pe >= 15 && pe <= 25;
      if (screenerState.pe === 'gt25') return pe > 25;
      return true;
    });
  }
  ids.sort((a, b) => {
    const ma = mom3m(a), mb = mom3m(b);
    if (ma != null && mb != null) return mb - ma;
    const qa = quotes[a] && quotes[a].changePct, qb = quotes[b] && quotes[b].changePct;
    return (qb || 0) - (qa || 0);
  });
  return { ids: ids, hasMcap: hasMcap, hasPe: hasPe };
}
function renderScreenerPage() {
  const el = $('#screenerPage');
  if (!el) return;
  const { ids, hasMcap, hasPe } = screenerFiltered();
  const sectors = sectorList();
  const shown = ids.slice(0, 80);
  const sel = (key, opts) => '<select data-act="scr-set" data-key="' + key + '">' +
    opts.map(o => '<option value="' + esc(o[0]) + '"' + (screenerState[key] === o[0] ? ' selected' : '') + '>' + esc(o[1]) + '</option>').join('') + '</select>';
  el.innerHTML = '<div class="d-bar"><button class="ib" data-act="close-screener" aria-label="Back"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg></button><h2>Screener</h2><span style="width:36px"></span></div>' +
    '<div class="d-in list-page">' +
      '<div class="search list-search"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>' +
      '<input id="scrQ" type="search" placeholder="Name or symbol" value="' + esc(screenerState.q) + '" autocomplete="off"></div>' +
      '<div class="scr-filters">' +
        sel('sector', [['', 'Any sector']].concat(sectors.map(s => [s, s]))) +
        (hasMcap ? sel('mcap', [['', 'Any market cap'], ['2b', 'Over $2B'], ['10b', 'Over $10B'], ['50b', 'Over $50B'], ['200b', 'Over $200B']]) : '') +
        (hasPe ? sel('pe', [['', 'Any P/E'], ['lt15', 'P/E under 15'], ['15-25', 'P/E 15–25'], ['gt25', 'P/E over 25']]) : '') +
        sel('div', [['', 'Dividends: any'], ['yes', 'Has a last dividend'], ['no', 'No last dividend']]) +
        sel('mom', [['', 'Any momentum'], ['up3m', 'Up 10%+ in 3 months'], ['dn3m', 'Down 10%+ in 3 months'], ['up1d', 'Up 2%+ today']]) +
      '</div>' +
      (!hasMcap ? '<p class="note">Market cap is not in the latest quote file, so that filter is hidden.</p>' : '') +
      (!hasPe ? '<p class="note">P/E is not in our quote or analyst files, so that filter is hidden rather than filled in.</p>' : '') +
      '<p class="list-status">' + ids.length + ' names · from the covered universe and Yahoo history. Not financial advice.</p>' +
      '<div class="list">' + (shown.map(id => {
        const mom = mom3m(id);
        return rowHTML(id, { spark: true, sparkVals: null, sparkUp: mom != null ? mom >= 0 : undefined });
      }).join('') || '<div class="empty"><p>No names match these filters.</p></div>') + '</div>' +
    '</div>';
  const input = $('#scrQ');
  if (input) {
    input.addEventListener('input', () => { screenerState.q = input.value; renderScreenerPage(); const n = $('#scrQ'); if (n) { n.focus(); try { n.setSelectionRange(input.selectionStart, input.selectionStart); } catch (e) {} } });
  }
  el.querySelectorAll('select[data-act="scr-set"]').forEach(s => {
    s.onchange = () => { screenerState[s.dataset.key] = s.value; renderScreenerPage(); };
  });
  el.hidden = false;
  document.body.classList.add('hide-dock');
}
function openScreener(opts) {
  opts = opts || {};
  if (readerItem) closeReader(true);
  if (listState) closeListPage(true);
  if (aiPageId) closeAiPage(true);
  renderScreenerPage();
  if (!opts.fromHash) history.pushState({ scr: 1 }, '', '#/screener');
}
function closeScreener(fromPop) {
  const el = $('#screenerPage');
  if (el) { el.hidden = true; el.innerHTML = ''; }
  document.body.classList.remove('hide-dock');
  if (!fromPop && location.hash.indexOf('#/screener') === 0) {
    if (history.length > 1) history.back();
    else history.replaceState(null, '', '#/markets');
  }
}

function politicianHTML(id) {
  const items = (politicianTrades && politicianTrades.bySymbol && politicianTrades.bySymbol[id]) || [];
  if (!items.length) {
    return '<div class="block"><h2>Politician trades</h2><p class="note">No recent official US Congress or executive disclosures for this ticker were in The Black House data. Corporate Form 4 insider filings were not in that dataset.</p></div>';
  }
  return '<div class="block"><h2>Politician trades</h2><div class="list compact">' + items.map(t => {
    const side = (t.side || '').toLowerCase();
    const label = side.indexOf('buy') >= 0 || side === 'purchase' ? 'Buy' : (side.indexOf('sell') >= 0 || side === 'sale' ? 'Sell' : (t.side || 'Trade'));
    const when = t.date ? new Date(t.date + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/London' }) : '';
    const href = t.url ? '<a href="' + esc(t.url) + '" target="_blank" rel="noopener noreferrer">' + esc(t.politician) + '</a>' : esc(t.politician || 'Filer');
    return '<div class="cal-row"><div class="when">' + esc(when) + '</div><div class="what"><b>' + href + ' · ' + esc(label) + '</b><span>' + esc([t.chamber, t.party, t.amount].filter(Boolean).join(' · ')) + '</span></div></div>';
  }).join('') + '</div><p class="note">Source: official periodic transaction reports, via The Black House. Amounts are disclosed ranges. Not corporate insider Form 4 filings, and not financial advice.</p></div>';
}

async function earningsHistoryHTML(id) {
  const rec = analysisRec(id);
  const hist = rec && rec.earningsHistory;
  if (!hist || !hist.length) {
    return '<div class="block"><h2>Earnings history</h2><p class="note">No Nasdaq earnings history is in the latest analysis file for this ticker.</p></div>';
  }
  let daily = [];
  try {
    const d = await loadHist(id);
    daily = (d && d.daily) || [];
  } catch (e) {}
  const closeOn = ts => {
    let prev = null;
    for (const b of daily) {
      const t = b.t || b.time;
      if (t >= ts) {
        if (prev) return { prior: prev, next: b };
        return { prior: b, next: null };
      }
      prev = b;
    }
    return { prior: prev, next: null };
  };
  const rows = hist.map(e => {
    const d = e.dateReported;
    let react = null;
    if (d && daily.length) {
      const ts = Date.parse(d + 'T20:00:00Z') / 1000; // date as UTC evening, then find bracketing closes
      // Use report date 00:00 UTC through next session
      const start = Date.parse(d + 'T00:00:00Z') / 1000;
      let prior = null, next = null;
      for (const b of daily) {
        const t = b.t || b.time;
        if (t < start) prior = b;
        else if (!next) next = b;
      }
      if (prior && prior.c && next && next.c) react = (next.c - prior.c) / prior.c * 100;
    }
    const beat = e.surprisePct == null ? null : e.surprisePct >= 0;
    return { e: e, react: react, beat: beat };
  });
  return '<div class="block"><h2>Earnings history</h2><div class="list compact">' + rows.map(r => {
    const e = r.e;
    const when = e.dateReported ? new Date(e.dateReported + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/London' }) : '';
    const eps = (e.eps != null ? 'EPS ' + e.eps : '') + (e.consensusForecast != null ? ' vs ' + e.consensusForecast : '');
    const sur = e.surprisePct != null ? ((e.surprisePct >= 0 ? '+' : '') + e.surprisePct.toFixed(1) + '% surprise') : '';
    const tag = r.beat == null ? '' : (r.beat ? 'Beat' : 'Miss');
    const rx = r.react == null ? 'No daily bar for a price reaction' : ('Close-to-close ' + pct(r.react));
    return '<div class="cal-row"><div class="when">' + esc(when) + '</div><div class="what"><b>' + esc((e.fiscalQtrEnd || 'Quarter') + (tag ? ' · ' + tag : '')) + '</b><span>' + esc([eps, sur, rx].filter(Boolean).join(' · ')) + '</span></div></div>';
  }).join('') + '</div><p class="note">Earnings from Nasdaq. Price reaction is the change from the last Yahoo daily close before the report date to the first close on or after that date. Not financial advice.</p></div>';
}

function rsi(bars, n) {
  n = n || 14;
  const out = [];
  let g = 0, l = 0;
  for (let i = 1; i < bars.length; i++) {
    const ch = bars[i].value - bars[i - 1].value;
    const gain = Math.max(0, ch), loss = Math.max(0, -ch);
    if (i <= n) { g += gain; l += loss; if (i === n) { g /= n; l /= n; } else continue; }
    else { g = (g * (n - 1) + gain) / n; l = (l * (n - 1) + loss) / n; }
    const rs = l === 0 ? 100 : 100 - 100 / (1 + g / l);
    out.push({ time: bars[i].time, value: rs });
  }
  return out;
}
function macd(bars) {
  const e12 = ema(bars, 12), e26 = ema(bars, 26);
  const map12 = {}, map26 = {};
  e12.forEach(p => { map12[p.time] = p.value; });
  e26.forEach(p => { map26[p.time] = p.value; });
  const line = [];
  bars.forEach(b => {
    if (map12[b.time] != null && map26[b.time] != null) line.push({ time: b.time, value: map12[b.time] - map26[b.time] });
  });
  const sig = ema(line, 9);
  const smap = {};
  sig.forEach(p => { smap[p.time] = p.value; });
  const hist = line.filter(p => smap[p.time] != null).map(p => ({ time: p.time, value: p.value - smap[p.time] }));
  return { line: line, signal: sig, hist: hist };
}
function bollinger(bars, n, k) {
  n = n || 20; k = k || 2;
  const mid = sma(bars, n);
  const out = { mid: mid, upper: [], lower: [] };
  for (let i = n - 1; i < bars.length; i++) {
    let s = 0;
    for (let j = i - n + 1; j <= i; j++) s += bars[j].value;
    const m = s / n;
    let v = 0;
    for (let j = i - n + 1; j <= i; j++) v += (bars[j].value - m) ** 2;
    const sd = Math.sqrt(v / n);
    const t = bars[i].time;
    out.upper.push({ time: t, value: m + k * sd });
    out.lower.push({ time: t, value: m - k * sd });
  }
  return out;
}

function paintFsPane(bars, ind, dark, mainChart) {
  const pane = $('#fsPane');
  if (!pane) return;
  const want = ind === 'rsi' || ind === 'macd';
  pane.hidden = !want;
  pane.innerHTML = '';
  if (!want || !bars || bars.length < 5) return;
  const pc = LW.createChart(pane, {
    autoSize: true, height: 120,
    layout: { background: { color: 'transparent' }, textColor: dark ? '#8e8e93' : '#8e8e93', fontFamily: "Inter Tight, Inter, -apple-system, system-ui", fontSize: 10, attributionLogo: false },
    grid: { vertLines: { visible: false }, horzLines: { visible: true, color: dark ? 'rgba(255,255,255,.06)' : 'rgba(16,16,14,.06)' } },
    rightPriceScale: { visible: true, borderVisible: false, scaleMargins: { top: 0.1, bottom: 0.1 } },
    timeScale: { visible: false, borderVisible: false },
    handleScroll: false, handleScale: false
  });
  if (ind === 'rsi') {
    const s = pc.addSeries(LW.LineSeries, { color: '#00C805', lineWidth: 1.6, priceLineVisible: false, lastValueVisible: true, priceFormat: { type: 'price', precision: 1, minMove: 0.1 } });
    s.setData(rsi(bars, 14));
    try { s.createPriceLine({ price: 70, color: 'rgba(255,80,0,.5)', lineWidth: 1, lineStyle: 2, axisLabelVisible: false }); } catch (e) {}
    try { s.createPriceLine({ price: 30, color: 'rgba(0,200,5,.5)', lineWidth: 1, lineStyle: 2, axisLabelVisible: false }); } catch (e) {}
  } else {
    const m = macd(bars);
    const hist = pc.addSeries(LW.HistogramSeries, { priceLineVisible: false, lastValueVisible: false });
    hist.setData(m.hist);
    const mac = pc.addSeries(LW.LineSeries, { color: '#00C805', lineWidth: 1.5, priceLineVisible: false, lastValueVisible: false });
    mac.setData(m.macd);
    const sig = pc.addSeries(LW.LineSeries, { color: dark ? '#f5c542' : '#b8860b', lineWidth: 1.2, priceLineVisible: false, lastValueVisible: false });
    sig.setData(m.signal);
  }
  try {
    pc.timeScale().setVisibleLogicalRange(mainChart.timeScale().getVisibleLogicalRange());
    mainChart.timeScale().subscribeVisibleLogicalRangeChange(r => { try { pc.timeScale().setVisibleLogicalRange(r); } catch (e) {} });
  } catch (e) {}
}
function drawTrendLines(chart, series, showAxes) {
  if (!showAxes) return;
  (trendLines || []).forEach(ln => {
    if (ln.t1 == null || ln.t2 == null) return;
    const s = chart.addSeries(LW.LineSeries, { color: '#00C805', lineWidth: 1.6, priceLineVisible: false, lastValueVisible: false });
    s.setData([
      { time: ln.t1, value: ln.p1 },
      { time: ln.t2, value: ln.p2 }
    ].sort((a, b) => a.time - b.time));
  });
  if (!trendDraw) return;
  let pending = null;
  chart.subscribeClick(param => {
    if (!trendDraw || !param || param.time == null || !param.point) return;
    let price = null;
    try { price = series.coordinateToPrice(param.point.y); } catch (e) {}
    if (price == null || !isFinite(price)) return;
    if (!pending) { pending = { t1: param.time, p1: price }; toast('Tap a second point'); return; }
    trendLines.push({ t1: pending.t1, p1: pending.p1, t2: param.time, p2: price });
    pending = null;
    trendDraw = false;
    if (detailId) loadDetailChart();
    else paintFsChart();
  });
}

function toolsHTML() {
  return '<div class="tool-row">' +
    '<a class="tool-chip" href="#/brief">Morning brief</a>' +
    '<a class="tool-chip" href="#/screener">Screener</a>' +
    '</div>';
}


async function boot() {
  loadUser();
  bootTheme();
  paintCcy();
  $$('#homeIn, #marketsIn, #watchIn, #portIn, #alertsIn').forEach(el => {
    if (el) el.innerHTML = '<div class="sk k"></div><div class="sk" style="height:160px;border-radius:22px;margin-bottom:14px"></div><div class="sk" style="height:72px;border-radius:18px;margin-bottom:8px"></div><div class="sk" style="height:72px;border-radius:18px"></div>';
  });
  sizeBubble();
  setupPTR();
  document.addEventListener('click', onClick);
  $('#themeBtn').addEventListener('click', () => { vib(8); applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'); });
  $('#ccy').addEventListener('click', e => {
    const b = e.target.closest('button[data-ccy]');
    if (!b) return;
    ccy = b.dataset.ccy; store.set('ccy', ccy); paintCcy(); renderAll();
    if (detailId) renderDetail(detailId, true);
  });
  $$('.view').forEach(v => v.addEventListener('scroll', () => {
    if (v.dataset.tab === tab) $('#top').classList.toggle('sc', v.scrollTop > 8);
  }, { passive: true }));
  window.addEventListener('hashchange', applyHash);
  window.addEventListener('popstate', applyHash);
  applyHash();
  paintTrack(TABS.indexOf(tab), true);
  await refreshAll();
  checkAlerts();
  if ('serviceWorker' in navigator) {
    try { await navigator.serviceWorker.register('./sw.js?v=' + BUILD); } catch (err) {}
    navigator.serviceWorker.addEventListener('message', ev => {
      if (ev.data && ev.data.type === 'open' && ev.data.url) location.href = ev.data.url;
    });
  }
  clearInterval(pollTimer);
  pollTimer = setInterval(() => { loadCryptoOnce().then(() => { updatePrices(); checkAlerts(); setLive(); }); }, 20_000);
  refreshVisibleQuotes();
  setInterval(() => { refreshVisibleQuotes(); }, 60_000);
  setInterval(() => { loadStocks().then(() => { refreshVisibleQuotes(); if (!detailId) { if (tab === 'home' || tab === 'port') updatePortfolioLive(); if (tab === 'markets') renderMarkets(); if (tab === 'watch') renderWatch(); } else { const q=quotes[detailId]; if(q){ const hl=priceHeadline(detailId,q); if($('#dPx')) $('#dPx').textContent=hl.px; } } checkAlerts(); }); }, 5 * 60_000);
}

boot();
