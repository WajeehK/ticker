/* Ticker v2 */
const BUILD = 't8';
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

let quotes = {}, logos = {}, news = null, analysis = null;
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
let ws = null, wsRetry = 0, wsTimer = 0, pollTimer = 0;
let lastFlash = {}, lastHero = null, readerItem = null, fsChartApi = null, newsIndex = {};
let ptr = null;

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
function isIndexId(id, q) {
  q = q || (id && quotes[id]) || {};
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
  const cls = ['av', extra || '', kindCls, chip ? 'chip' : ''].filter(Boolean).join(' ');
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
    const r = await fetch(KREST + '/AssetPairs');
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
    const r = await fetch(KREST + '/Ticker?pair=' + encodeURIComponent(alts.join(',')));
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
  const spark = opts.spark !== false ? sparkSVG(q.spark, up) : '';
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
function newsItem(n, i) {
  const src = n.thumbnail || n._logo;
  const thumb = src ? '<img class="thumb' + (n.thumbnail ? '' : ' logo-thumb') + '" src="' + esc(src) + '" alt="">' : '';
  const whenBit = n.published ? ago(n.published) : '';
  const meta = [n.source, whenBit].filter(Boolean).join(' · ');
  const key = n._key || n.url || String(i || '');
  return '<button type="button" class="news-item' + (src ? '' : ' no-thumb') + '" data-act="read" data-key="' + esc(key) + '"><span><b>' + esc(n.title) + '</b><span class="meta">' + esc(meta) + '</span></span>' + thumb + '</button>';
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
    n._key = n.url || k;
    if (opts.logoId) {
      const L = logoRec(opts.logoId);
      if (L && L.src) n._logo = L.src;
    }
    uniq.push(n);
  });
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
    const k = n._key || n.url;
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
  return 'at close';
}
function priceHeadline(id, q) {
  q = q || {};
  const native = q.currency || 'USD';
  const px = q.price != null
    ? (isIndexId(id, q) ? fmtPoints(q.price) : fmtNum(q.price, native, { px: true }))
    : '—';
  let chg = '—';
  if (q.change != null) {
    const bit = isIndexId(id, q) ? fmtPoints(Math.abs(q.change)) : fmtNum(Math.abs(q.change), native, { px: true });
    chg = (q.change < 0 ? '▾ ' : '▴ ') + bit + ' (' + (q.changePct != null ? Math.abs(q.changePct).toFixed(2) + '%' : '—') + ')';
  } else if (q.changePct != null) {
    chg = (q.changePct < 0 ? '▾ ' : '▴ ') + Math.abs(q.changePct).toFixed(2) + '%';
  }
  return { px, chg, sess: sessionTag(q) };
}
function analysisRec(id) {
  return (analysis && analysis.bySymbol && analysis.bySymbol[id]) || null;
}


async function holdingHist(id) {
  if (isCryptoId(id) || pairs[id]) {
    try {
      const bars = await cryptoBars(id, portRange || '1M');
      return { currency: 'USD', daily: (bars || []).map(b => ({ t: b.time, c: b.value })), intraday: (portRange === '1D' ? (bars || []).map(b => ({ t: b.time, c: b.value })) : []) };
    } catch (e) { return null; }
  }
  try {
    const r = await fetch('data/hist/' + encodeURIComponent(id) + '.json?t=' + Math.floor(Date.now() / 60_000), { cache: 'no-cache' });
    if (!r.ok) return null;
    return await r.json();
  } catch (e) { return null; }
}
function clipHist(d, range) {
  const now = Math.floor(Date.now() / 1000);
  const cut = { '1W': now - 7 * 86400, '1M': now - 32 * 86400, '3M': now - 95 * 86400, '1Y': now - 370 * 86400, 'MAX': 0 }[range] || 0;
  if (range === '1D') {
    const intra = d.intraday || d.intra || [];
    const last = intra.length ? (intra[intra.length - 1].t || intra[intra.length - 1].time) : 0;
    const start = (d.periods && d.periods.regular && d.periods.regular[0]) || (last ? last - 20 * 3600 : 0);
    return intra.filter(b => (b.t || b.time) >= start).map(b => ({ t: b.t || b.time, v: b.c != null ? b.c : b.value })).filter(b => b.t && b.v != null);
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
  return '<div class="rng" data-ranges="' + kind + '">' + ['1D','1W','1M','3M','1Y','MAX'].map(r =>
    '<button type="button" data-prange="' + r + '" class="' + (r === active ? 'on' : '') + '">' + r + '</button>').join('') + '</div>';
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
    host.innerHTML = '<div class="ph" style="height:200px;display:grid;place-items:center;color:var(--mute);font-size:13px">' + (pts && pts.length ? 'Not enough points for this range.' : 'Value history will appear once prices load.') + '</div>';
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
    host.innerHTML = '<div class="ph" style="height:200px;display:grid;place-items:center;color:var(--mute);font-size:13px;padding:16px;text-align:center">Could not build this chart.</div>';
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
  if (!st || !st.known) {
    return '<div class="hero"><div class="lbl">Investing</div>' +
      '<div class="val" style="font-size:32px">Nothing here yet</div>' +
      '<p class="note">Add the shares and coins you hold when you are ready. Everything stays on this device.</p>' +
      '<div style="margin-top:14px"><button class="btn" data-act="add-hold">Add a holding</button></div></div>';
  }
  const dayLine = '<div class="day ' + chgClass(st.day) + '" data-day="1">' +
    (st.day >= 0 ? '▴ ' : '▾ ') + money(Math.abs(st.day), 'USD') +
    (st.dayPct != null ? ' (' + Math.abs(st.dayPct).toFixed(2) + '%)' : '') +
    ' <span class="sess">today</span></div>';
  return '<div class="hero"><div class="lbl">Investing</div>' +
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
  el.innerHTML = heroHTML(st, 'heroVal') + chart +
    (st && st.lines.length ? '<div class="sec-h"><h2>Holdings</h2><a class="more" href="#/portfolio">Portfolio</a></div>' + holdingsListHTML(st) : '') +
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
function marketListHTML(ids, rowOpts) {
  rowOpts = rowOpts || { spark: true };
  const show = marketsShowAll ? ids : ids.slice(0, 10);
  const rows = show.map(id => {
    const o = Object.assign({}, rowOpts);
    if (typeof o.sub === 'function') o.sub = o.sub(id);
    return rowHTML(id, o);
  }).join('');
  let btn = '';
  if (ids.length > 10) {
    btn = marketsShowAll
      ? '<button type="button" class="see-all" data-act="m-more" data-id="less">Show less</button>'
      : '<button type="button" class="see-all" data-act="m-more" data-id="more">See all ' + ids.length + '</button>';
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

function renderMarkets(opts) {
  opts = opts || {};
  const el = $('#marketsIn');
  const pane = MARKET_PANES.includes(marketsPane) ? marketsPane : 'stocks';
  marketsPane = pane;
  const allowed = pane === 'crypto'
    ? ['mcap','gainers','losers','volume','new','trending']
    : ['all','gainers','losers','volume'];
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
    const ids = sortMarketIds(eq, marketsList);
    const label = (chips.find(c => c.id === marketsList) || {}).label || 'Stocks';
    body = '<div class="idx-grid">' + (idxCards || '<div class="empty"><p>Index quotes have not loaded yet.</p></div>') + '</div>' +
      chipBarHTML(chips, marketsList) +
      '<div class="sec-h"><h2>' + esc(label) + '</h2></div>' + marketListHTML(ids) +
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
    body = fngH + chipBarHTML(chips, marketsList) +
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
    '<button data-act="w-sort-name" class="' + (watchSort==='name'?'on':'') + '">Name</button></div>' +
    (ids.length ? '<div class="list">' + ids.map(id => rowHTML(id, { spark: true })).join('') + '</div>'
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
      '<div class="bp-list"><div class="bp-row"><span class="k">Total return</span><span class="v ' + chgClass(st.pnl) + '" data-bp="pnl">' +
        (st.pnl != null ? ((st.pnl >= 0 ? '+' : '') + money(st.pnl, 'USD') + (st.pnlPct != null ? '  ' + pct(st.pnlPct) : '')) : '—') + '</span></div></div>' : '') +
      (st && st.pnl != null ? '<div class="stats">' +
        stat('Total return', null, null, (st.pnl >= 0 ? '+' : '') + money(st.pnl, 'USD') + (st.pnlPct != null ? ' · ' + pct(st.pnlPct) : '')) +
        stat('Day change', null, null, (st.day != null ? ((st.day >= 0 ? '+' : '') + money(st.day, 'USD')) : '—') + (st.dayPct != null ? ' · ' + pct(st.dayPct) : '')) +
        (st.best ? stat('Best', null, null, esc((st.best.q && st.best.q.symbol) || st.best.h.id) + ' ' + pct(st.best.pnlPct)) : '') +
        (st.worst ? stat('Worst', null, null, esc((st.worst.q && st.worst.q.symbol) || st.worst.h.id) + ' ' + pct(st.worst.pnlPct)) : '') +
        '</div>' : '') +
      '<div class="sec-h"><h2>Holdings</h2><button class="more" data-act="export-csv">Export CSV</button></div>' +
      holdingsListHTML(st) +
      analyticsHTML(st) +
      '<div style="margin-top:16px;display:flex;gap:8px"><button class="btn ghost" style="flex:1" data-act="add-hold">Add another</button><button class="btn ghost" style="flex:1" data-act="import-csv">Import</button></div>';
  el.innerHTML = heroHTML(st, 'portVal') + body + creditHTML();
  if (st) applyDayTheme(st.day == null || st.day >= 0);
  if (st && st.known) loadPortChart('#pvChart');
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
    '<div class="cta"><p><b>' + (perm === 'granted' ? 'Browser notifications on' : 'In-app alerts are ready') + '</b> ' +
    (perm === 'granted' ? 'You will also get a system notification when a level is hit.' : 'Turn on browser notifications if you want a banner when Ticker is in the background.') + '</p>' +
    (perm !== 'granted' ? '<button class="btn sm" data-act="enable-note">' + (perm === 'denied' ? 'Notifications blocked' : 'Enable') + '</button>' : '') + '</div>' +
    '<div style="margin:12px 0"><button class="btn ghost full" data-act="add-alert">New price alert</button></div>' + list + creditHTML();
}

function renderAll() {
  renderHome(); renderMarkets(); renderWatch(); renderPort(); renderAlerts();
  if (detailId) renderDetail(detailId, true);
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
  const val = text != null ? text : (asPoints ? fmtPoints(n) : fmtNum(n, ccy0 || 'USD', {px:true}));
  return '<div class="stat"><div class="k">' + esc(k) + '</div><div class="v">' + val + '</div></div>';
}

async function cryptoBars(id, range) {
  const alt = (pairs[id] && pairs[id].alt) || (coin(id) === 'BTC' ? 'XBTUSD' : coin(id) + 'USD');
  const map = { '1D': [60, 1440], '1W': [60, 10080], '1M': [240, 1860], '3M': [1440, 200], '1Y': [1440, 400], 'MAX': [1440, 720] };
  const [iv, count] = map[range] || map['1M'];
  const r = await fetch(KREST + '/OHLC?pair=' + encodeURIComponent(alt) + '&interval=' + iv);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const d = await r.json();
  if (d.error && d.error.length) throw new Error(d.error.join(', '));
  const key = Object.keys(d.result || {}).find(k => k !== 'last');
  const rows = (key && d.result[key]) || [];
  return rows.slice(-count).map(row => ({
    time: row[0], o: parseFloat(row[1]), h: parseFloat(row[2]), l: parseFloat(row[3]), c: parseFloat(row[4]),
    value: parseFloat(row[4]), v: parseFloat(row[6])
  })).filter(b => isFinite(b.value) && isFinite(b.time));
}

async function stockPack(id, range) {
  const file = 'data/hist/' + encodeURIComponent(id) + '.json';
  const r = await fetch(file + '?t=' + Math.floor(Date.now() / 60_000), { cache: 'no-cache' });
  if (!r.ok) throw new Error('History file missing');
  const d = await r.json();
  const intra = (d.intraday || d.intra || []).map(b => ({ time: b.t, value: b.c, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v })).filter(b => b.time && b.value != null);
  const daily = (d.daily || []).map(b => ({ time: b.t, value: b.c, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v })).filter(b => b.time && b.value != null);
  const now = Math.floor(Date.now() / 1000);
  const cut = { '1W': now - 7 * 86400, '1M': now - 32 * 86400, '3M': now - 95 * 86400, '1Y': now - 370 * 86400, 'MAX': 0 }[range] || 0;
  const periods = d.periods || {};
  const regularStart = periods.regular && periods.regular[0];
  let bars;
  if (range === '1D') {
    if (intra.length >= 2) {
      const last = intra[intra.length - 1].time;
      const start = regularStart || (last - 20 * 3600);
      bars = intra.filter(b => b.time >= start);
    } else {
      bars = daily.filter(b => b.time >= now - 5 * 86400);
    }
  } else {
    bars = daily.filter(b => !cut || b.time >= cut);
  }
  const ohlc = bars.some(b => b.o != null && b.h != null && b.l != null);
  return { bars: bars, delay: d.delay || meta.delay, source: d.source, currency: d.currency, dividends: d.dividends || [], ohlc: ohlc };
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
  if (bars.length < 2) { host.innerHTML = '<div class="ph" style="display:grid;place-items:center;color:var(--mute)">Not enough history for this range.</div>'; return; }
  const lastV = bars[bars.length - 1].value, firstV = bars[0].value;
  const up = lastV >= firstV;
  const th = chartTheme(up);
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
    return fmtNum(v, q.currency || packA.currency || 'USD', { px: true });
  };
  bindCrosshair(chart, series, host, fmtVal);
  if (opts.api === 'fs') fsChartApi = chart;
  else chartApi = chart;
}

async function loadDetailChart() {
  if (!detailId) return;
  const host = $('#chart'); if (!host) return;
  host.innerHTML = '<div class="ph"></div>';
  const note = $('#delayNote');
  try {
    const packA = isCryptoId(detailId) || pairs[detailId]
      ? { bars: await cryptoBars(detailId, chartRange), delay: 'Kraken public OHLC', source: 'Kraken', label: coin(detailId), ohlc: true }
      : Object.assign(await stockPack(detailId, chartRange), { label: detailId });
    let packB = null;
    if (compareId) {
      packB = isCryptoId(compareId) || pairs[compareId]
        ? { bars: await cryptoBars(compareId, chartRange), label: coin(compareId) }
        : Object.assign(await stockPack(compareId, chartRange), { label: compareId });
    }
    const fromA = packA.currency || ((isCryptoId(detailId) || pairs[detailId]) ? 'USD' : ((quotes[detailId] && quotes[detailId].currency) || 'USD'));
    /* Asset chart stays in the native quote currency, matching the large last price. */
    if (note) {
      const cur = isCryptoId(detailId) ? 'USD' : (isIndexId(detailId) ? 'index points' : (fromA === 'GBp' ? 'GBP' : fromA));
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
    drawChart(host, packA, packB, chartRange, chartKind, chartInd, {
      id: detailId, buyPrice: buy, buyCurrency: q0.currency || packA.currency || 'USD',
      prevClose: (!compareId ? prev : null), showAxes: false
    });
  } catch (e) {
    host.innerHTML = '<div class="ph" style="display:grid;place-items:center;padding:20px;color:var(--mute);text-align:center">Could not load this chart. ' + esc(e.message || e) + '</div>';
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

function outlookHTML(rec, kind) {
  if (kind === 'crypto') {
    return '<p class="outlook">No analyst coverage. Crypto prices come from Kraken; there is no broker recommendation set in our sources.</p>';
  }
  const o = rec && rec.outlook;
  if (!o || !o.text) return '<p class="note">No automated outlook has been generated yet for this asset.</p>';
  return '<p class="outlook">' + esc(o.text) + '<span class="lbl">' + esc(o.label || 'Automated outlook from analyst data and news, not financial advice') + (o.asOf ? ' · ' + esc(ago(o.asOf)) : '') + '</span></p>';
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
  extras += '<div class="block"><h2>Outlook</h2>' + outlookHTML(rec, kind) + '</div>';
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
      '<div class="rng" id="ranges">' + ['1D','1W','1M','3M','1Y','MAX'].map(r =>
        '<button type="button" data-range="' + r + '" class="' + (r===range?'on':'') + '">' + (r==='MAX'?'MAX':r) + '</button>').join('') + '</div>' +
      '<div class="tools">' +
        '<button type="button" data-kind="line" class="' + (chartKind!=='candles'?'on':'') + '">Line</button>' +
        '<button type="button" data-kind="candles" class="' + (chartKind==='candles'?'on':'') + '">Candles</button>' +
        '<button type="button" data-ind="off" class="' + ((chartInd||'off')==='off'?'on':'') + '">No MA</button>' +
        '<button type="button" data-ind="sma" class="' + (chartInd==='sma'?'on':'') + '">SMA 20</button>' +
        '<button type="button" data-ind="ema" class="' + (chartInd==='ema'?'on':'') + '">EMA 20</button>' +
        '<button type="button" data-act="compare" class="' + (compareId?'on':'') + '">' + esc(compareId ? ('vs ' + ((quotes[compareId] && (quotes[compareId].symbol || compareId)) || compareId)) : 'Compare') + '</button>' +
      '</div>' +
      '<p class="note" id="delayNote"></p>' +
      extras +
    '</div>';
  bindDetailTools();
  loadDetailChart();
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
    '<p class="hint">Stocks and ETFs come from the Yahoo universe Ticker already tracks. Any Kraken USD crypto pair works live. Custom tickers outside this list cannot be quoted from this static site.</p>' +
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
  if (mode === 'compare') { compareId = id; if (detailId) location.hash = '#/s/' + encodeURIComponent(detailId) + '/vs/' + encodeURIComponent(id); return; }
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
function openImport() {
  openModal('<div class="sheet"><div class="grab"></div><header><h3>Import holdings</h3><button class="x" data-act="close">Close</button></header>' +
    '<p class="hint">CSV with columns symbol, quantity, avg_price. Existing rows for the same symbol are replaced. Nothing is uploaded.</p>' +
    '<div class="field"><label for="csv">CSV</label><textarea id="csv" rows="8" placeholder="symbol,quantity,avg_price&#10;AAPL,10,180&#10;BTC-USD,0.05,60000"></textarea></div>' +
    '<div class="btns"><button class="btn" data-act="do-import">Import</button></div></div>');
}
function doImport() {
  const raw = ($('#csv') && $('#csv').value) || '';
  const rows = raw.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  if (!rows.length) { toast('Paste a CSV first.'); return; }
  const start = rows[0].toLowerCase().includes('symbol') ? 1 : 0;
  const next = holdings.slice();
  let n = 0;
  for (const line of rows.slice(start)) {
    const parts = line.split(',').map(s => s.trim());
    if (parts.length < 2) continue;
    const id = parts[0];
    const qty = parseFloat(parts[1]);
    const avg = parts[2] === '' || parts[2] == null ? null : parseFloat(parts[2]);
    if (!id || !isFinite(qty) || qty <= 0) continue;
    const rec = { id: id, qty: qty, avg: (avg != null && isFinite(avg)) ? avg : null };
    const i = next.findIndex(h => h.id === id);
    if (i >= 0) next[i] = rec; else next.push(rec);
    n++;
  }
  if (!n) { toast('No valid rows found.'); return; }
  holdings = next; persistHoldings(); closeModal(); renderAll(); toast('Imported ' + n + ' holding' + (n>1?'s':''));
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
  if (consumeImport()) { tab = 'port'; go(TABS.indexOf('port'), { nohash: true, instant: true }); renderAll(); return; }
  const h = location.hash || '#/';
  const m = h.match(/^#\/s\/([^/]+)(?:\/vs\/([^/]+))?/);
  if (m) {
    const id = decodeURIComponent(m[1]);
    const vs = m[2] ? decodeURIComponent(m[2]) : null;
    if (detailId !== id || compareId !== vs) { detailId = id; compareId = vs; renderDetail(id); }
    return;
  }
  if (h.startsWith('#/read')) {
    /* stay; reader is opened from a click. Back closes it. */
    if (readerItem) return;
  }
  if (readerItem) closeReader(true);
  if (detailId) closeDetail(false);
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
  if (!opts.nohash && !detailId && location.hash !== want && !(name === 'home' && (location.hash === '' || location.hash === '#' || location.hash === '#/'))) {
    history.replaceState(null, '', want);
  }
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
  if (detailId || !$('#modal').hidden || e.button > 0) return;
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
  if (item.text && item.text.length > 280) {
    host.innerHTML = readerBodyHTML(item);
    return;
  }
  host.innerHTML = '<p class="empty-read">Loading article…</p>';
  // Same idea as Frontline's reader sheet: try a text proxy, then fall back to the original.
  const proxies = [
    'https://r.jina.ai/' + item.url,
    'https://r.jina.ai/http://' + item.url.replace(/^https?:\/\//, '')
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
      const paras = clean.split(/\n+/).map(t => t.replace(/[#*_`]+/g,' ').replace(/\s+/g,' ').trim())
        .filter(t => t.length > 50 && !/^(image \d+|bloomberg via|getty)/i.test(t)).slice(0, 36);
      if (paras.length) {
        item.text = paras.join('\n\n');
        if (readerItem === item) host.innerHTML = readerBodyHTML(item);
        return;
      }
    } catch (e) {}
  }
  if (readerItem !== item) return;
  host.innerHTML = '<p class="empty-read">This publisher blocked an extracted preview. Use Open original to read the full piece, or try an embedded view.</p>' +
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
  if (!item.text || item.text.length < 280) fillReaderText(item, $('#readerBody'));
  if (location.hash.indexOf('#/read') !== 0) history.pushState({ reader: item._key || item.url }, '', '#/read');
}

function fsBar(title) {
  return '<div class="fs-bar"><button class="ib" data-act="close-fs" aria-label="Close"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button><h3>' + esc(title || 'Chart') + '</h3></div>' +
    '<div class="fs-chart"><div id="fsChart"></div></div>' +
    '<div class="rng" id="fsRanges">' + ['1D','1W','1M','3M','1Y','MAX'].map(r =>
      '<button type="button" data-fsrange="' + r + '" class="' + (r===chartRange?'on':'') + '">' + r + '</button>').join('') + '</div>' +
    '<div class="tools" id="fsTools">' +
      '<button type="button" data-fskind="line" class="' + (chartKind!=='candles'?'on':'') + '">Line</button>' +
      '<button type="button" data-fskind="candles" class="' + (chartKind==='candles'?'on':'') + '">Candles</button>' +
      '<button type="button" data-fsind="off" class="' + ((chartInd||'off')==='off'?'on':'') + '">No MA</button>' +
      '<button type="button" data-fsind="sma" class="' + (chartInd==='sma'?'on':'') + '">SMA 20</button>' +
      '<button type="button" data-fsind="ema" class="' + (chartInd==='ema'?'on':'') + '">EMA 20</button>' +
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
  const packA = isCryptoId(detailId) || pairs[detailId]
    ? { bars: await cryptoBars(detailId, chartRange), currency: 'USD', label: coin(detailId), ohlc: true }
    : Object.assign(await stockPack(detailId, chartRange), { label: detailId });
  const q0 = quotes[detailId] || {};
  drawChart(host, packA, null, chartRange, chartKind, chartInd, {
    api: 'fs', showAxes: true, id: detailId,
    buyPrice: holdingAvg(detailId), buyCurrency: q0.currency || packA.currency || 'USD',
    prevClose: q0.prev != null ? q0.prev : q0.regularClose
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
  const readBtn = e.target.closest('[data-act="read"]');
  if (readBtn) {
    const item = newsStore()[readBtn.dataset.key];
    if (item) openReader(item);
    return;
  }
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
    if (compareId) { compareId = null; if (detailId) location.hash = '#/s/' + encodeURIComponent(detailId); }
    else openSearch('compare');
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
  if (act === 'export-csv') { exportCSV(); return; }
  if (act === 'import-csv') { openImport(); return; }
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
  await Promise.all([loadStocks(), loadNews(), loadAnalysis(), loadLogos(), loadVolumes(), loadCryptoMarkets(), loadPairs().then(loadCryptoOnce)]); applyCryptoMarkets();
  renderAll();
  loadCryptoSparks().then(() => { if (tab === 'watch' || tab === 'markets') { renderWatch(); renderMarkets(); } if (tab === 'home') updatePortfolioLive(); });
  connectWS();
  setLive();
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
  $('#themeBtn').addEventListener('click', () => applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));
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
  setInterval(() => { loadStocks().then(() => { if (!detailId) { if (tab === 'home' || tab === 'port') updatePortfolioLive(); if (tab === 'markets') renderMarkets(); if (tab === 'watch') renderWatch(); } else { const q=quotes[detailId]; if(q){ const hl=priceHeadline(detailId,q); if($('#dPx')) $('#dPx').textContent=hl.px; } } checkAlerts(); }); }, 5 * 60_000);
}

boot();
