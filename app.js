/* Ticker v1 — stocks, ETFs and crypto. No fabricated prices. */
const BUILD = 't1';
const TABS = ['home', 'watch', 'port', 'alerts'];
const TAB_HASH = { home: '#/', watch: '#/watch', port: '#/portfolio', alerts: '#/alerts' };
const DEFAULT_WATCH = ['BTC-USD', 'ETH-USD', 'SOL-USD', 'AAPL', 'NVDA', 'TSLA', 'SPY', 'VUSA.L'];
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
  EOS: 'EOS', SAND: 'The Sandbox', MANA: 'Decentraland', CRV: 'Curve',
  LDO: 'Lido', MKR: 'Maker', SNX: 'Synthetix', GRT: 'The Graph',
  IMX: 'Immutable', RUNE: 'THORChain', KAS: 'Kaspa', TAO: 'Bittensor',
  ONDO: 'Ondo', JUP: 'Jupiter', PYTH: 'Pyth', WLD: 'Worldcoin',
  ENA: 'Ethena', PENGU: 'Pudgy Penguins', TRUMP: 'OFFICIAL TRUMP'
};

const $ = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const store = {
  get(k, d) { try { const v = JSON.parse(localStorage.getItem('ticker.' + k)); return v == null ? d : v; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('ticker.' + k, JSON.stringify(v)); } catch {} }
};
const vib = n => { if (navigator.vibrate && navigator.userActivation && navigator.userActivation.hasBeenActive) try { navigator.vibrate(n); } catch {} };

let quotes = {};
let meta = { generated_at: null, delay: '', source: '', fx: {}, stockOk: false, stockErr: null };
let pairs = {};          // 'BTC-USD' -> {id, alt, ws, name}
let watch = [];
let holdings = [];
let alerts = [];
let tab = 'home';
let detailId = null;
let chartApi = null;
let ws = null, wsRetry = 0, wsTimer = 0, pollTimer = 0;
let lastFlash = {};

/* ---------------- formatting ---------------- */
function kindOf(id, q) { return (q && q.kind) || (isCrypto(id) ? 'crypto' : 'equity'); }
function isCrypto(id) { return /-[A-Z]{3,4}$/.test(id) && !id.includes('.') && !quotes[id]?.kind?.match(/equity|etf|fund|index|fx/); }
function isCryptoId(id) { const q = quotes[id]; if (q) return q.kind === 'crypto'; return /^(BTC|ETH|SOL|XRP|ADA|DOGE|AVAX|DOT|LINK|LTC)/.test(id) || (id.includes('-USD') && !id.includes('.')); }
function coin(id) { return id.endsWith('-USD') ? id.slice(0, -4) : id; }

function money(n, ccy, opts={}) {
  if (n == null || !isFinite(n)) return '—';
  let cur = ccy === 'GBp' ? 'GBP' : (ccy || 'USD');
  const abs = Math.abs(n);
  let max = 2;
  if (opts.px) {
    if (abs < 0.0001) max = 8;
    else if (abs < 0.01) max = 6;
    else if (abs < 1) max = 4;
    else if (abs < 1000) max = 2;
    else max = 2;
  }
  try {
    const loc = cur === 'USD' ? 'en-US' : 'en-GB';
    return new Intl.NumberFormat(loc, { style: 'currency', currency: cur, maximumFractionDigits: max, minimumFractionDigits: Math.min(2, max) }).format(n);
  } catch {
    const s = { USD: '$', GBP: '£', EUR: '€' }[cur] || (cur + ' ');
    return s + n.toFixed(max);
  }
}
function pct(n) {
  if (n == null || !isFinite(n)) return '—';
  const s = (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
  return s;
}
function chgClass(n) { return n > 0 ? 'up' : n < 0 ? 'dn' : ''; }
function initials(name, id) {
  if (id && String(id).endsWith('-USD')) return coin(id).slice(0, 4);
  if (id && !String(id).includes('-USD')) {
    const p = String(id).replace(/\.L$/, '').replace(/=X$/, '');
    return p.slice(0, 4).toUpperCase();
  }
  const s = name || id || '?';
  return String(s).slice(0, 2).toUpperCase();
}
function toUSD(amount, ccy) {
  if (amount == null || !isFinite(amount)) return null;
  const c = ccy === 'GBp' ? 'GBP' : (ccy || 'USD');
  if (c === 'USD') return amount;
  const rate = meta.fx && meta.fx[c + 'USD'];
  if (rate) return amount * rate;
  return null;
}

function sparkSVG(arr, up) {
  if (!arr || arr.length < 2) return '';
  const w = 64, h = 28, p = 1;
  const nums = arr.filter(x => x != null && isFinite(x));
  if (nums.length < 2) return '';
  const min = Math.min(...nums), max = Math.max(...nums);
  const span = max - min || 1;
  const pts = nums.map((v, i) => {
    const x = p + (i / (nums.length - 1)) * (w - 2 * p);
    const y = (h - p) - ((v - min) / span) * (h - 2 * p);
    return x.toFixed(1) + ',' + y.toFixed(1);
  }).join(' ');
  const col = up ? 'var(--up)' : 'var(--dn)';
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" aria-hidden="true"><polyline fill="none" stroke="${col}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" points="${pts}"/></svg>`;
}

function when(ts) {
  if (!ts) return '';
  const d = new Date(ts * 1000);
  if (isNaN(d)) return '';
  return d.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/London' }) + ' UK';
}
function ago(iso) {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (!t) return iso;
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.round(s / 60) + ' min ago';
  if (s < 86400) return Math.round(s / 3600) + 'h ago';
  return new Date(t).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/London' }) + ' UK';
}

/* ---------------- user data ---------------- */
function loadUser() {
  if (store.get('seeded', false)) watch = store.get('watch', []);
  else { watch = DEFAULT_WATCH.slice(); store.set('watch', watch); store.set('seeded', true); }
  holdings = store.get('holdings', []);
  alerts = store.get('alerts', []);
}
function saveWatch() { store.set('watch', watch); }
function saveHold() { store.set('holdings', holdings); }
function saveAlerts() { store.set('alerts', alerts); }

/* ---------------- quotes ---------------- */
function upsert(id, rec) {
  const prev = quotes[id] || {};
  quotes[id] = { ...prev, ...rec, id };
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
        asOf: q.asOf, spark: q.spark || [], ok: true, source: 'yahoo', live: false
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
  if (cache && Date.now() - cached < 12 * 3600 * 1000) { pairs = cache; return; }
  try {
    const r = await fetch(KREST + '/AssetPairs');
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const d = await r.json();
    if (d.error && d.error.length) throw new Error(d.error.join(', '));
    const out = {};
    for (const v of Object.values(d.result || {})) {
      const ws = v.wsname || '';
      if (!ws.endsWith('/USD')) continue;
      if (v.status && v.status !== 'online') continue;
      let code = ws.split('/')[0];
      if (code === 'XBT') code = 'BTC';
      const id = code + '-USD';
      if (out[id] && code !== 'BTC') continue;
      out[id] = { id, alt: v.altname, ws: code === 'BTC' ? 'BTC/USD' : ws, name: COIN_NAMES[code] || code, code };
    }
    // Ensure BTC uses BTC/USD for v2 WS
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
  for (const p of Object.values(pairs)) {
    if (!quotes[p.id]) upsert(p.id, { symbol: p.code, name: p.name, kind: 'crypto', currency: 'USD', ok: false, source: 'kraken' });
    else upsert(p.id, { kind: 'crypto', name: quotes[p.id].name || p.name, symbol: p.code, currency: 'USD', source: 'kraken' });
  }
}

function neededCrypto() {
  const ids = new Set();
  for (const id of watch) if (isCryptoId(id) || pairs[id]) ids.add(id);
  for (const h of holdings) if (isCryptoId(h.id) || pairs[h.id]) ids.add(h.id);
  for (const a of alerts) if (isCryptoId(a.id) || pairs[a.id]) ids.add(a.id);
  if (detailId && (isCryptoId(detailId) || pairs[detailId])) ids.add(detailId);
  // always the defaults so home isn't empty before watch hydrates
  for (const id of ['BTC-USD', 'ETH-USD', 'SOL-USD']) ids.add(id);
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
      if (Array.isArray(v)) {
        const x = parseFloat(v[i] != null ? v[i] : v[0]);
        return isFinite(x) ? x : null;
      }
      const x = parseFloat(v);
      return isFinite(x) ? x : null;
    };
    const matchRow = (id) => {
      const alt = (pairs[id] && pairs[id].alt) || '';
      const code = coin(id);
      const keys = Object.keys(res);
      const exact = keys.find(k => k === alt || k === code + 'USD' || k === (code === 'BTC' ? 'XBTUSD' : '') || k === 'X' + code + 'ZUSD' || k === 'XXBTZUSD' && code === 'BTC');
      if (exact) return res[exact];
      // last resort: unique suffix match, never a loose substring (avoids WBTC, ETHBTC, etc.)
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
        symbol: code,
        name: (pairs[id] && pairs[id].name) || COIN_NAMES[code] || code,
        kind: 'crypto', currency: 'USD', exchange: 'Kraken',
        price: last, prev: open, change, changePct,
        dayHigh: num(row.h, 1) ?? num(row.h, 0),
        dayLow: num(row.l, 1) ?? num(row.l, 0),
        asOf: Math.floor(Date.now() / 1000), ok: true, source: 'kraken', live: false
      });
    }
    meta.cryptoOk = true;
    meta.cryptoErr = null;
  } catch (e) {
    meta.cryptoOk = false;
    meta.cryptoErr = e.message || String(e);
  }
}

async function loadCryptoSparks() {
  const ids = neededCrypto();
  await Promise.all(ids.map(async id => {
    try {
      const bars = await cryptoBars(id, '1Y');
      if (!bars.length) return;
      const vals = bars.map(b => b.value);
      upsert(id, {
        spark: quotes[id] && quotes[id].spark && quotes[id].spark.length >= 20 ? quotes[id].spark : vals.slice(-30),
        high52: Math.max(...vals),
        low52: Math.min(...vals)
      });
    } catch {}
  }));
}

function connectWS() {
  const ids = neededCrypto().filter(id => quotes[id] && quotes[id].ok !== false || pairs[id]);
  const symbols = ids.map(id => (pairs[id] && pairs[id].ws) || (coin(id) === 'BTC' ? 'BTC/USD' : coin(id) + '/USD'));
  if (!symbols.length) return;
  try { if (ws) { ws.onclose = null; ws.close(); } } catch {}
  ws = new WebSocket(KWS);
  ws.onopen = () => {
    wsRetry = 0;
    setLive();
    ws.send(JSON.stringify({ method: 'subscribe', params: { channel: 'ticker', symbol: symbols, event_trigger: 'trades' } }));
  };
  ws.onmessage = ev => {
    let msg; try { msg = JSON.parse(ev.data); } catch { return; }
    if (msg.method === 'pong' || msg.method === 'heartbeat' || msg.channel === 'heartbeat' || msg.channel === 'status') return;
    if (msg.channel !== 'ticker' || !msg.data) return;
    const rows = Array.isArray(msg.data) ? msg.data : [msg.data];
    let changed = false;
    for (const t of rows) {
      let sym = t.symbol || ''; // BTC/USD
      if (!sym) continue;
      let code = sym.split('/')[0];
      if (code === 'XBT') code = 'BTC';
      const id = code + '-USD';
      const last = parseFloat(t.last);
      if (!isFinite(last)) continue;
      const prevQ = quotes[id] || {};
      const changePct = t.change_pct != null ? parseFloat(t.change_pct) : prevQ.changePct;
      const change = t.change != null ? parseFloat(t.change) : (isFinite(changePct) && prevQ.prev ? prevQ.prev * changePct / 100 : prevQ.change);
      const old = prevQ.price;
      upsert(id, {
        symbol: code, name: prevQ.name || (pairs[id] && pairs[id].name) || COIN_NAMES[code] || code,
        kind: 'crypto', currency: 'USD', exchange: 'Kraken',
        price: last, change, changePct,
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
    ws = null;
    setLive();
    const wait = Math.min(15_000, 800 * Math.pow(1.7, wsRetry++));
    clearTimeout(wsTimer);
    wsTimer = setTimeout(connectWS, wait);
  };
  ws.onerror = () => { try { ws.close(); } catch {} };
}

function setLive() {
  const el = $('#live'), txt = $('#liveTxt');
  if (!el) return;
  const live = ws && ws.readyState === 1;
  const stocks = meta.stockOk;
  const crypto = meta.cryptoOk || live;
  el.classList.toggle('on', live || (stocks && crypto));
  el.classList.toggle('warn', !stocks && !crypto);
  if (!stocks && !crypto) txt.textContent = 'Offline';
  else if (live) txt.textContent = 'Live';
  else txt.textContent = 'Quotes';
}

/* ---------------- render ---------------- */
function rowHTML(id, opts={}) {
  const q = quotes[id] || {};
  const name = q.name || (pairs[id] && pairs[id].name) || COIN_NAMES[coin(id)] || id;
  const sym = q.symbol || (isCryptoId(id) ? coin(id) : id);
  const up = (q.changePct == null) ? true : q.changePct >= 0;
  const kind = kindOf(id, q);
  const avCls = kind === 'crypto' ? 'crypto' : kind === 'etf' ? 'etf' : '';
  const tag = kind === 'crypto' ? 'Crypto' : kind === 'etf' ? 'ETF' : (String(id).endsWith('.L') ? 'LSE' : '');
  const spark = opts.spark !== false ? sparkSVG(q.spark, up) : '';
  const cls = spark ? 'row with-spark' : 'row';
  const flash = lastFlash[id] ? ` flash ${lastFlash[id] === 'dn' ? 'dn' : ''}` : '';
  const sub = opts.sub || `<span>${esc(sym)}</span>${tag ? `<span class="tag">${tag}</span>` : ''}${q.live ? `<span class="tag">LIVE</span>` : ''}`;
  const rgt = opts.rgt || `<div class="px" data-px="${esc(id)}">${q.ok && q.price != null ? money(q.price, q.currency || 'USD', {px:true}) : '—'}</div>
      <div class="chg ${chgClass(q.changePct)}" data-chg="${esc(id)}">${q.changePct != null ? pct(q.changePct) : '—'}</div>`;
  return `<a class="${cls}${flash}" href="#/s/${encodeURIComponent(id)}" data-id="${esc(id)}">
    <div class="av ${avCls}">${esc(initials(name, id))}</div>
    <div class="mid"><div class="nm">${esc(name)}</div><div class="tk">${sub}</div></div>
    ${spark}
    <div class="rgt">${rgt}</div>
  </a>`;
}

function creditHTML() {
  const stockBit = meta.stockOk
    ? `Stock and ETF quotes from Yahoo Finance, delayed up to 15 minutes, last refreshed ${esc(ago(meta.generated_at))}.`
    : (meta.stockErr ? `Stock quotes unavailable (${esc(meta.stockErr)}).` : 'Loading stock quotes…');
  const cry = (ws && ws.readyState === 1)
    ? 'Crypto prices are live from Kraken.'
    : (meta.cryptoOk ? 'Crypto prices from Kraken (quote snapshot).' : (meta.cryptoErr ? `Crypto feed unavailable (${esc(meta.cryptoErr)}).` : 'Connecting to Kraken…'));
  return `<footer class="fine">${cry} ${stockBit} Charts use TradingView Lightweight Charts. Not investment advice. Portfolio and alerts stay on this device.</footer>`;
}

function portfolioStats() {
  if (!holdings.length) return null;
  let value = 0, cost = 0, day = 0, missing = 0, known = 0;
  const lines = [];
  for (const h of holdings) {
    const q = quotes[h.id];
    const px = q && q.ok ? q.price : null;
    const ccy = (q && q.currency) || 'USD';
    const val = px != null ? px * h.qty : null;
    const cst = h.avg != null ? h.avg * h.qty : null;
    const valUSD = val != null ? toUSD(val, ccy) : null;
    const cstUSD = cst != null ? toUSD(cst, ccy) : null;
    const chgUSD = (q && q.change != null) ? toUSD(q.change * h.qty, ccy) : null;
    if (valUSD != null) { value += valUSD; known++; } else missing++;
    if (cstUSD != null) cost += cstUSD;
    if (chgUSD != null) day += chgUSD;
    lines.push({ h, q, px, ccy, val, cst, pnl: (val != null && cst != null) ? val - cst : null, pnlPct: (val != null && cst) ? (val - cst) / cst * 100 : null });
  }
  return { value, cost, day, dayPct: value && (value - day) ? day / (value - day) * 100 : null, pnl: value && cost ? value - cost : null, pnlPct: value && cost ? (value - cost) / cost * 100 : null, missing, known, lines };
}

function renderHome() {
  const el = $('#homeIn');
  const st = portfolioStats();
  const movers = watch.map(id => quotes[id]).filter(q => q && q.changePct != null).sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct)).slice(0, 5);
  let hero;
  if (st && st.known) {
    hero = `<div class="glass hero">
      <div class="lbl">Portfolio value</div>
      <div class="val">${money(st.value, 'USD')}</div>
      <div class="row">
        <span class="chip ${chgClass(st.day)}">${st.day >= 0 ? '+' : ''}${money(st.day, 'USD')}  day${st.dayPct != null ? ' · ' + pct(st.dayPct) : ''}</span>
        ${st.pnl != null ? `<span class="chip ${chgClass(st.pnl)}">P&amp;L ${st.pnl >= 0 ? '+' : ''}${money(st.pnl, 'USD')} (${pct(st.pnlPct)})</span>` : ''}
      </div>
      <p class="note">${st.missing ? `<b>${st.missing} holding${st.missing>1?'s':''}</b> could not be valued. ` : ''}Totals in USD. Sterling converted with the latest GBPUSD rate${meta.fx.GBPUSD ? ' (' + meta.fx.GBPUSD.toFixed(4) + ')' : ''}.</p>
    </div>`;
  } else {
    hero = `<div class="glass hero">
      <div class="lbl">Your portfolio</div>
      <div class="val" style="font-size:28px;letter-spacing:-.03em">Nothing here yet</div>
      <p class="note">Add the shares and coins you hold when you are ready. Everything stays on this device.</p>
      <div style="margin-top:12px"><button class="btn sm" data-act="add-hold">Add a holding</button></div>
    </div>`;
  }
  el.innerHTML = `
    <p class="eyebrow">Overview</p>
    ${hero}
    <div class="sec-h"><h2>Top movers</h2><a class="more" href="#/watch">Watchlist</a></div>
    <div class="glass list">${movers.length ? movers.map(q => rowHTML(q.id, { spark: true })).join('') : '<div class="empty"><p>Prices will show here once quotes load.</p></div>'}</div>
    <div class="sec-h"><h2>Watchlist</h2><a class="more" href="#/watch">See all</a></div>
    <div class="glass list">${watch.slice(0, 8).map(id => rowHTML(id)).join('')}</div>
    ${creditHTML()}`;
  lastFlash = {};
}

function renderWatch() {
  const el = $('#watchIn');
  el.innerHTML = `
    <p class="eyebrow">Markets</p>
    <h2 style="font-size:28px;margin-bottom:10px">Watchlist</h2>
    <button class="glass search" data-act="search" style="width:100%;text-align:left;color:var(--mute)">
      <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>
      <span>Search stocks, ETFs and crypto</span>
    </button>
    ${watch.length
      ? `<div class="glass list">${watch.map(id => rowHTML(id)).join('')}</div>`
      : `<div class="glass empty"><b>Empty watchlist</b><p>Add a ticker or coin to follow live prices.</p><button class="btn sm" data-act="search">Add something</button></div>`}
    ${creditHTML()}`;
  lastFlash = {};
}

function renderPort() {
  const el = $('#portIn');
  const st = portfolioStats();
  const body = !holdings.length
    ? `<div class="glass empty"><b>No holdings yet</b><p>When you are ready, add a quantity and average buy price. Nothing is sent anywhere.</p><button class="btn sm" data-act="add-hold">Add a holding</button></div>`
    : `<div class="glass list">${(st ? st.lines : holdings.map(h => ({h, q: quotes[h.id], px: quotes[h.id]?.price, ccy: quotes[h.id]?.currency, val: null, pnl: null, pnlPct: null}))).map(ln => {
        const id = ln.h.id;
        const q = ln.q || {};
        const sub = `<span>${esc(ln.h.qty)} × ${ln.h.avg != null ? money(ln.h.avg, q.currency || 'USD', {px:true}) : '—'}</span>`;
        const rgt = `<div class="px" data-val="${esc(id)}">${ln.val != null ? money(ln.val, ln.ccy || q.currency || 'USD') : '—'}</div>
          <div class="chg ${chgClass(ln.pnl)}" data-pnl="${esc(id)}">${ln.pnl != null ? ((ln.pnl>=0?'+':'') + money(ln.pnl, ln.ccy || 'USD') + (ln.pnlPct!=null?' · '+pct(ln.pnlPct):'')) : '—'}</div>`;
        return rowHTML(id, { spark: false, sub, rgt });
      }).join('')}</div>
      <div style="margin-top:12px"><button class="btn ghost full" data-act="add-hold">Add another holding</button></div>`;
  let hero = '';
  if (st && st.known) {
    hero = `<div class="glass hero">
      <div class="lbl">Portfolio value</div>
      <div class="val">${money(st.value, 'USD')}</div>
      <div class="row">
        <span class="chip ${chgClass(st.day)}">${st.day >= 0 ? '+' : ''}${money(st.day, 'USD')} day</span>
        ${st.pnl != null ? `<span class="chip ${chgClass(st.pnl)}">P&amp;L ${st.pnl >= 0 ? '+' : ''}${money(st.pnl, 'USD')}</span>` : ''}
      </div>
    </div>`;
  }
  el.innerHTML = `<p class="eyebrow">Holdings</p><h2 style="font-size:28px;margin-bottom:10px">Portfolio</h2>${hero}${body}${creditHTML()}`;
}

function renderAlerts() {
  const el = $('#alertsIn');
  const perm = typeof Notification !== 'undefined' ? Notification.permission : 'denied';
  const list = alerts.length
    ? `<div class="glass list">${alerts.map(a => {
        const q = quotes[a.id] || {};
        const name = q.name || a.id;
        const hit = a.fired ? '<span class="tag">Triggered</span>' : '';
        return `<div class="row" data-alert="${esc(a.key)}">
          <div class="av ${kindOf(a.id, q)==='crypto'?'crypto':''}">${esc(initials(name, a.id))}</div>
          <div class="mid"><div class="nm">${esc(name)}</div><div class="tk">Alert when ${esc(a.op)} ${esc(money(a.price, q.currency || 'USD', {px:true}))} ${hit}</div></div>
          <div class="rgt"><div class="px" data-px="${esc(a.id)}">${q.price != null ? money(q.price, q.currency || 'USD', {px:true}) : '—'}</div>
            <button class="more" data-act="del-alert" data-key="${esc(a.key)}" style="margin-top:4px">Remove</button></div>
        </div>`;
      }).join('')}</div>`
    : `<div class="glass empty"><b>No alerts</b><p>Get a banner in the app, and a phone notification if you allow them, when a price crosses a level you set.</p></div>`;
  el.innerHTML = `
    <p class="eyebrow">Notifications</p>
    <h2 style="font-size:28px;margin-bottom:10px">Alerts</h2>
    <div class="glass cta">
      <p><b>${perm === 'granted' ? 'Browser notifications on' : 'In-app alerts are ready'}</b>
      ${perm === 'granted' ? 'You will also get a system notification when a level is hit.' : 'Turn on browser notifications if you want a banner when Ticker is in the background.'}</p>
      ${perm !== 'granted' ? `<button class="btn sm" data-act="enable-note">${perm === 'denied' ? 'Notifications blocked' : 'Enable'}</button>` : ''}
    </div>
    <div style="margin:12px 0"><button class="btn ghost full" data-act="add-alert">New price alert</button></div>
    ${list}
    ${creditHTML()}`;
}

function renderAll() {
  renderHome(); renderWatch(); renderPort(); renderAlerts();
  if (detailId) renderDetail(detailId, true);
  setLive();
}

function updatePrices() {
  for (const el of $$('[data-px]')) {
    const q = quotes[el.dataset.px];
    if (!q || q.price == null) continue;
    const t = money(q.price, q.currency || 'USD', { px: true });
    if (el.textContent !== t) el.textContent = t;
    if (lastFlash[el.dataset.px]) {
      const row = el.closest('.row');
      if (row) {
        row.classList.remove('flash', 'dn');
        void row.offsetWidth;
        row.classList.add('flash');
        if (lastFlash[el.dataset.px] === 'dn') row.classList.add('dn');
      }
    }
  }
  for (const el of $$('[data-chg]')) {
    const q = quotes[el.dataset.chg];
    if (!q) continue;
    el.textContent = q.changePct != null ? pct(q.changePct) : '—';
    el.classList.remove('up', 'dn');
    el.classList.add(chgClass(q.changePct));
  }
  // Hero values — cheaper to re-render the active tab only when holdings exist and prices tick
  if (holdings.length && (tab === 'home' || tab === 'port') && !detailId) {
    if (tab === 'home') renderHome();
    else renderPort();
  }
  if (detailId) {
    const q = quotes[detailId];
    if (q && $('#dPx')) {
      $('#dPx').textContent = q.price != null ? money(q.price, q.currency || 'USD', { px: true }) : '—';
      const c = $('#dChg');
      if (c) { c.textContent = (q.change != null ? (q.change >= 0 ? '+' : '') + money(q.change, q.currency || 'USD', { px: true }) + ' · ' : '') + (q.changePct != null ? pct(q.changePct) : '—'); c.className = 'chip ' + chgClass(q.changePct); }
    }
  }
  lastFlash = {};
}

/* ---------------- detail + charts ---------------- */
async function renderDetail(id, reuse) {
  const el = $('#detail');
  const q = quotes[id] || {};
  const name = q.name || (pairs[id] && pairs[id].name) || COIN_NAMES[coin(id)] || id;
  const kind = kindOf(id, q);
  const inWatch = watch.includes(id);
  const held = holdings.filter(h => h.id === id);
  el.hidden = false;
  document.body.classList.add('hide-dock');
  if (!reuse) el.classList.remove('out');
  const range = el.dataset.range || (kind === 'crypto' ? '1D' : '1M');
  el.dataset.range = range;
  el.innerHTML = `
    <div class="d-bar">
      <button class="ib" data-act="close-detail" aria-label="Back"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg></button>
      <h2>${esc(name)}</h2>
      <button class="ib" data-act="toggle-watch" data-id="${esc(id)}" aria-label="${inWatch ? 'Remove from watchlist' : 'Add to watchlist'}">
        <svg viewBox="0 0 24 24">${inWatch ? '<path d="M12 4l2.4 5 5.6.8-4 3.9.9 5.6L12 16.8 7.1 19.3l.9-5.6-4-3.9 5.6-.8z" fill="currentColor" stroke="none"/>' : '<path d="M12 4l2.4 5 5.6.8-4 3.9.9 5.6L12 16.8 7.1 19.3l.9-5.6-4-3.9 5.6-.8z"/>'}</svg>
      </button>
    </div>
    <div class="d-in">
      <div class="d-head">
        <div class="av ${kind==='crypto'?'crypto':kind==='etf'?'etf':''}">${esc(initials(name, id))}</div>
        <div><div class="nm">${esc(q.symbol || (isCryptoId(id) ? coin(id) : id))} ${q.exchange ? '· ' + esc(q.exchange) : ''} ${q.live ? '· Live' : ''}</div>
        <div class="d-px" id="dPx">${q.price != null ? money(q.price, q.currency || 'USD', {px:true}) : '—'}</div>
        <span class="chip ${chgClass(q.changePct)}" id="dChg">${q.change != null ? (q.change>=0?'+':'') + money(q.change, q.currency || 'USD', {px:true}) + ' · ' : ''}${q.changePct != null ? pct(q.changePct) : '—'}</span>
        </div>
      </div>
      <div class="rng" id="rng">${['1D','1W','1M','1Y','All'].map(r => `<button data-range="${r}" class="${r===range?'on':''}">${r}</button>`).join('')}</div>
      <div id="chart"><div class="ph">Loading chart…</div></div>
      <div class="stats">
        ${stat('Day high', q.dayHigh, q.currency)}${stat('Day low', q.dayLow, q.currency)}
        ${stat('52-week high', q.high52, q.currency)}${stat('52-week low', q.low52, q.currency)}
        ${stat(kind === 'crypto' ? '24h open' : 'Previous close', q.prev, q.currency)}${stat('As of', null, null, q.live ? 'Live' : (q.source === 'yahoo' ? when(q.asOf) : (q.asOf ? when(q.asOf) : '—')))}
      </div>
      <div class="actions">
        <button class="btn ghost" data-act="add-hold" data-id="${esc(id)}">${held.length ? 'Edit holding' : 'Add holding'}</button>
        <button class="btn ghost" data-act="add-alert" data-id="${esc(id)}">Set alert</button>
      </div>
      ${held.length ? `<div class="glass stat" style="margin-bottom:16px"><div class="k">Your position</div><div class="v">${held.map(h => esc(h.qty) + ' @ ' + money(h.avg, q.currency || 'USD', {px:true})).join(' · ')}</div></div>` : ''}
      <div id="ihBox"></div>
      <p class="note">${kind === 'crypto' ? 'Live price from Kraken.' : 'Stock and ETF quotes from Yahoo Finance, delayed up to 15 minutes.'} Not investment advice.</p>
    </div>`;
  bindDetail(id);
  loadChart(id, range);
  if (kind !== 'crypto') loadInsider(id);
}

function stat(k, n, ccy, text) {
  return `<div class="glass stat"><div class="k">${esc(k)}</div><div class="v">${text != null ? esc(text) : money(n, ccy || 'USD', {px:true})}</div></div>`;
}

function bindDetail(id) {
  const el = $('#detail');
  $('#rng', el)?.addEventListener('click', e => {
    const b = e.target.closest('button[data-range]');
    if (!b) return;
    el.dataset.range = b.dataset.range;
    $$('#rng button', el).forEach(x => x.classList.toggle('on', x === b));
    loadChart(id, b.dataset.range);
  });
}

async function loadChart(id, range) {
  const host = $('#chart');
  if (!host) return;
  destroyChart();
  host.innerHTML = '<div class="ph">Loading chart…</div>';
  let points = [];
  try {
    if (isCryptoId(id) || (quotes[id] && quotes[id].kind === 'crypto')) {
      points = await cryptoBars(id, range);
    } else {
      points = await stockBars(id, range);
    }
  } catch (e) {
    host.innerHTML = `<div class="ph">Could not load this chart${e && e.message ? ' — ' + esc(e.message) : ''}.</div>`;
    return;
  }
  if (!points.length) {
    host.innerHTML = '<div class="ph">No chart data for this range.</div>';
    return;
  }
  host.innerHTML = '';
  const LW = window.LightweightCharts;
  if (!LW || !LW.createChart) {
    host.innerHTML = '<div class="ph">Chart library failed to load.</div>';
    return;
  }
  const dark = document.documentElement.dataset.theme === 'dark';
  const up = points[points.length - 1].value >= points[0].value;
  const col = up ? (dark ? '#34c77b' : '#0f9d58') : (dark ? '#ff8a4c' : '#d9590f');
  const chart = LW.createChart(host, {
    autoSize: true,
    layout: { background: { type: (LW.ColorType && LW.ColorType.Solid) || 'solid', color: 'transparent' }, textColor: dark ? '#bdbab3' : '#45433e', fontFamily: "Geist, ui-sans-serif, system-ui" },
    grid: { vertLines: { color: dark ? 'rgba(255,255,250,.05)' : 'rgba(16,16,14,.06)' }, horzLines: { color: dark ? 'rgba(255,255,250,.05)' : 'rgba(16,16,14,.06)' } },
    rightPriceScale: { borderVisible: false },
    timeScale: { borderVisible: false, timeVisible: range === '1D' || range === '1W', secondsVisible: false },
    crosshair: { horzLine: { labelBackgroundColor: col }, vertLine: { color: dark ? 'rgba(255,255,255,.2)' : 'rgba(0,0,0,.2)' } },
    handleScroll: { vertTouchDrag: false }
  });
  const opts = { lineColor: col, topColor: up ? (dark ? 'rgba(52,199,123,.28)' : 'rgba(15,157,88,.25)') : (dark ? 'rgba(255,138,76,.28)' : 'rgba(217,89,15,.25)'), bottomColor: 'transparent', lineWidth: 2, priceLineVisible: false };
  let series;
  if (LW.AreaSeries && chart.addSeries) series = chart.addSeries(LW.AreaSeries, opts);
  else if (chart.addAreaSeries) series = chart.addAreaSeries(opts);
  else { host.innerHTML = '<div class="ph">Chart API not supported.</div>'; return; }
  series.setData(points);
  chart.timeScale().fitContent();
  chartApi = chart;
}

function destroyChart() {
  try { if (chartApi) chartApi.remove(); } catch {}
  chartApi = null;
}

async function stockBars(id, range) {
  const r = await fetch('data/hist/' + encodeURIComponent(id) + '.json?t=' + Math.floor(Date.now() / 60_000), { cache: 'no-cache' });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const d = await r.json();
  const daily = (d.daily || []).map(b => ({ time: b.t, value: b.c })).filter(p => p.value != null);
  const intra = (d.intraday || []).map(b => ({ time: b.t, value: b.c })).filter(p => p.value != null);
  if (range === '1D') return intra.length ? intra : daily.slice(-2);
  const days = range === '1W' ? 7 : range === '1M' ? 32 : range === '1Y' ? 370 : 1e9;
  const cut = Date.now() / 1000 - days * 86400;
  return daily.filter(p => p.time >= cut);
}

async function cryptoBars(id, range) {
  const interval = { '1D': 5, '1W': 60, '1M': 240, '1Y': 1440, 'All': 10080 }[range] || 1440;
  const alt = (pairs[id] && pairs[id].alt) || (coin(id) === 'BTC' ? 'XBTUSD' : coin(id) + 'USD');
  const r = await fetch(KREST + '/OHLC?pair=' + encodeURIComponent(alt) + '&interval=' + interval);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const d = await r.json();
  if (d.error && d.error.length) throw new Error(d.error.join(', '));
  const res = d.result || {};
  const rows = Object.entries(res).find(([k]) => k !== 'last');
  if (!rows) return [];
  return rows[1].map(b => ({ time: b[0], value: parseFloat(b[4]) })).filter(p => isFinite(p.value));
}

async function loadInsider(id) {
  const box = $('#ihBox');
  if (!box) return;
  const file = String(id).replace(/[^A-Za-z0-9.\-]/g, '_');
  try {
    const r = await fetch(IH + 'data/stock/' + encodeURIComponent(file) + '.json');
    if (!r.ok) return;
    const d = await r.json();
    const n = (d.holders && d.holders.length) || (d.px ? 1 : 0);
    if (!n && !(d.holders || d.ticker)) return;
    box.innerHTML = `<a class="glass ih-link" href="${IH}#t=${encodeURIComponent(d.ticker || id)}" target="_blank" rel="noopener">
      <b>See insider and politician trades</b>
      <span>Opens The Insider House for ${esc(d.ticker || id)} — disclosed trades by Congress, insiders and funds.</span>
    </a>`;
  } catch {}
}

function closeDetail(toHash) {
  const el = $('#detail');
  destroyChart();
  const finish = () => { el.hidden = true; el.innerHTML = ''; document.body.classList.remove('hide-dock'); detailId = null; };
  if (RMQ.matches) finish();
  else { el.classList.add('out'); setTimeout(finish, 260); }
  if (toHash !== false) {
    const want = TAB_HASH[tab] || '#/';
    if (location.hash !== want) history.replaceState(null, '', want);
  }
  requestAnimationFrame(() => { sizeBubble(); paintTrack(TABS.indexOf(tab), true); });
}

/* ---------------- search / sheets ---------------- */
function openModal(html) {
  const m = $('#modal');
  m.hidden = false;
  m.innerHTML = `<div class="sheet"><div class="grab"></div>${html}</div>`;
  m.onclick = e => { if (e.target === m) closeModal(); };
}
function closeModal() { const m = $('#modal'); m.hidden = true; m.innerHTML = ''; m.onclick = null; }

function searchIndex() {
  const items = [];
  const seen = new Set();
  for (const [id, q] of Object.entries(quotes)) {
    if (q.kind === 'fx') continue;
    items.push({ id, name: q.name || id, symbol: q.symbol || id, kind: q.kind || 'equity' });
    seen.add(id);
  }
  for (const p of Object.values(pairs)) {
    if (seen.has(p.id)) continue;
    items.push({ id: p.id, name: p.name, symbol: p.code, kind: 'crypto' });
  }
  return items;
}
function runSearch(q) {
  const s = q.trim().toLowerCase();
  if (!s) return [];
  return searchIndex().filter(it =>
    it.id.toLowerCase().includes(s) ||
    (it.symbol && it.symbol.toLowerCase().includes(s)) ||
    (it.name && it.name.toLowerCase().includes(s))
  ).slice(0, 40);
}

function openSearch(onPick) {
  openModal(`<h3>Search</h3>
    <div class="field"><input id="sq" type="search" placeholder="AAPL, VUSA.L, Bitcoin…" autocomplete="off"></div>
    <div id="sres"></div>`);
  const input = $('#sq'), res = $('#sres');
  const paint = () => {
    const hits = runSearch(input.value);
    res.innerHTML = !input.value.trim() ? '<p class="note">Try a ticker, a company, or a coin. Stocks cover a curated US + UK list. Crypto is any USD pair on Kraken.</p>'
      : (hits.length ? `<div class="glass list">${hits.map(it => `<button class="row" data-pick="${esc(it.id)}" style="width:100%;text-align:left">
          <div class="av ${it.kind==='crypto'?'crypto':it.kind==='etf'?'etf':''}">${esc(initials(it.name, it.id))}</div>
          <div class="mid"><div class="nm">${esc(it.name)}</div><div class="tk">${esc(it.symbol)} · ${esc(it.kind)}</div></div>
        </button>`).join('')}</div>`
        : `<div class="empty"><p>No match for “${esc(input.value)}”. If it is a US or UK stock not in the universe, it cannot be quoted from this static app yet.</p></div>`);
    res.onclick = e => {
      const b = e.target.closest('[data-pick]');
      if (!b) return;
      const id = b.dataset.pick;
      closeModal();
      (onPick || defaultPick)(id);
    };
  };
  input.addEventListener('input', paint);
  paint();
  setTimeout(() => input.focus(), 50);
}
function defaultPick(id) {
  if (!watch.includes(id)) { watch.unshift(id); saveWatch(); renderWatch(); connectWS(); loadCryptoOnce(); }
  openAsset(id);
}

function openHoldForm(id) {
  const existing = holdings.find(h => h.id === (id || h.id)) && id ? holdings.filter(h => h.id === id) : [];
  const seed = id || '';
  const q = quotes[seed] || {};
  openModal(`<h3>${existing.length ? 'Edit holding' : 'Add holding'}</h3>
    <div class="field"><label>Asset</label><input id="h-id" value="${esc(seed)}" placeholder="AAPL or BTC-USD" ${seed ? 'readonly' : ''}></div>
    ${seed ? '' : '<p class="note" style="margin-top:-6px"><button class="more" data-act="search-hold">Search</button></p>'}
    <div class="field"><label>Quantity</label><input id="h-qty" type="number" inputmode="decimal" step="any" value="${existing[0] ? esc(existing[0].qty) : ''}"></div>
    <div class="field"><label>Average buy price ${q.currency ? '(' + esc(q.currency) + ')' : ''}</label><input id="h-avg" type="number" inputmode="decimal" step="any" value="${existing[0] && existing[0].avg != null ? esc(existing[0].avg) : ''}"></div>
    <div class="btns">
      ${existing.length ? '<button class="btn danger" data-act="del-hold" data-id="'+esc(seed)+'">Delete</button>' : '<button class="btn ghost" data-act="cancel">Cancel</button>'}
      <button class="btn" data-act="save-hold" data-id="${esc(seed)}">Save</button>
    </div>`);
  const bindSearch = () => {
    const b = $('[data-act=search-hold]');
    if (b) b.onclick = ev => { ev.preventDefault(); closeModal(); openSearch(picked => { openHoldForm(picked); }); };
  };
  bindSearch();
  $('[data-act=cancel]') && ($('[data-act=cancel]').onclick = closeModal);
  $('[data-act=del-hold]') && ($('[data-act=del-hold]').onclick = () => {
    holdings = holdings.filter(h => h.id !== seed);
    saveHold(); closeModal(); renderAll(); toast('Holding removed');
  });
  $('[data-act=save-hold]').onclick = () => {
    const hid = ($('#h-id').value || seed).trim().toUpperCase().replace('/', '-');
    const qty = parseFloat($('#h-qty').value);
    const avg = parseFloat($('#h-avg').value);
    if (!hid || !isFinite(qty) || qty <= 0 || !isFinite(avg) || avg < 0) { toast('Enter a quantity and average price'); return; }
    const idNorm = pairs[hid] ? hid : (pairs[hid + '-USD'] ? hid + '-USD' : hid);
    holdings = holdings.filter(h => h.id !== idNorm);
    holdings.push({ id: idNorm, qty, avg });
    saveHold();
    if (!watch.includes(idNorm)) { watch.unshift(idNorm); saveWatch(); }
    closeModal(); renderAll(); connectWS(); loadCryptoOnce(); toast('Holding saved');
  };
}

function openAlertForm(id) {
  const q = quotes[id] || {};
  openModal(`<h3>Price alert</h3>
    <div class="field"><label>Asset</label><input id="a-id" value="${esc(id || '')}" placeholder="AAPL or BTC-USD"></div>
    ${id ? '' : '<p class="note" style="margin-top:-6px"><button class="more" id="a-search">Search</button></p>'}
    <div class="field"><label>Condition</label>
      <select id="a-op"><option value="above">Goes above</option><option value="below">Goes below</option></select>
    </div>
    <div class="field"><label>Price ${q.currency ? '(' + esc(q.currency) + ')' : ''}</label>
      <input id="a-px" type="number" inputmode="decimal" step="any" value="${q.price != null ? esc(q.price) : ''}">
    </div>
    <div class="btns"><button class="btn ghost" data-act="cancel">Cancel</button><button class="btn" id="a-save">Save alert</button></div>`);
  $('[data-act=cancel]').onclick = closeModal;
  const ss = $('#a-search');
  if (ss) ss.onclick = ev => { ev.preventDefault(); closeModal(); openSearch(picked => openAlertForm(picked)); };
  $('#a-save').onclick = () => {
    let hid = $('#a-id').value.trim().toUpperCase().replace('/', '-');
    if (pairs[hid + '-USD']) hid = hid + '-USD';
    const op = $('#a-op').value;
    const price = parseFloat($('#a-px').value);
    if (!hid || !isFinite(price) || price <= 0) { toast('Enter a ticker and a price'); return; }
    const key = hid + '-' + op + '-' + price + '-' + Date.now();
    alerts.push({ key, id: hid, op, price, fired: false });
    saveAlerts();
    closeModal(); renderAlerts(); connectWS(); loadCryptoOnce(); toast('Alert saved');
  };
}

/* ---------------- alerts engine ---------------- */
function checkAlerts() {
  for (const a of alerts) {
    const q = quotes[a.id];
    if (!q || q.price == null) continue;
    const hit = a.op === 'above' ? q.price >= a.price : q.price <= a.price;
    if (hit && !a.fired) {
      a.fired = true;
      saveAlerts();
      const name = q.name || a.id;
      const msg = `${name} is ${a.op} ${money(a.price, q.currency || 'USD', {px:true})} · now ${money(q.price, q.currency || 'USD', {px:true})}`;
      toast(msg);
      notify(name + ' alert', msg, '#/s/' + encodeURIComponent(a.id));
      renderAlerts();
    } else if (!hit && a.fired) {
      a.fired = false;
      saveAlerts();
    }
  }
}

function toast(msg) {
  const t = $('#toast');
  t.hidden = false; t.textContent = msg;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { t.hidden = true; }, 3600);
}

async function notify(title, body, url) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const opts = { body, icon: 'icons/icon-192.png', badge: 'icons/favicon-32.png', data: { url: url || './' } };
    if (reg && reg.showNotification) await reg.showNotification(title, opts);
    else new Notification(title, opts);
  } catch {}
}

async function enableNotes() {
  if (typeof Notification === 'undefined') { toast('Notifications are not supported in this browser'); return; }
  if (Notification.permission === 'denied') { toast('Notifications are blocked in the browser settings'); return; }
  const p = await Notification.requestPermission();
  renderAlerts();
  if (p === 'granted') toast('Notifications enabled');
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
  bub.style.transform = `translate3d(${x.toFixed(2)}px,0,0) scale(${((1 + st) * press).toFixed(3)},${((1 - st * .42) * press).toFixed(3)})`;
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
    track.style.transform = `translate3d(${-i * w}px,0,0)`;
    void track.offsetWidth;
    track.style.transition = prev || '';
  } else if (instant !== 'drag') {
    track.classList.remove('drag');
    track.style.transform = `translate3d(${-i * w}px,0,0)`;
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
    const view = $(`.view[data-tab="${name}"]`);
    if (view && !opts.keepScroll) view.scrollTop = 0;
  }
  const want = TAB_HASH[name];
  if (!opts.nohash && !detailId && location.hash !== want && !(name === 'home' && (location.hash === '' || location.hash === '#'))) {
    history.replaceState(null, '', want);
  }
}

dock.addEventListener('pointerdown', e => {
  if (e.button > 0) return;
  try { dock.setPointerCapture(e.pointerId); } catch {}
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

/* swipe between tabs */
pager.addEventListener('pointerdown', e => {
  if (detailId || !$('#modal').hidden || e.button > 0) return;
  if (e.target.closest('#chart,.rng,input,select,textarea,button,.sheet')) return;
  swipe = { x: e.clientX, y: e.clientY, t: performance.now(), w: pager.clientWidth, i: TABS.indexOf(tab), moved: false };
});
pager.addEventListener('pointermove', e => {
  if (!swipe) return;
  const dx = e.clientX - swipe.x, dy = e.clientY - swipe.y;
  if (!swipe.moved) {
    if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { swipe = null; return; }
    if (Math.abs(dx) < 12) return;
    swipe.moved = true;
    try { pager.setPointerCapture(e.pointerId); } catch {}
    track.classList.add('drag');
    press = 1.04;
  }
  const raw = -swipe.i * swipe.w + dx;
  const min = -(TABS.length - 1) * swipe.w, max = 0;
  const x = raw < min ? min - Math.pow(min - raw, .7) : raw > max ? max + Math.pow(raw - max, .7) : raw;
  track.style.transform = `translate3d(${x}px,0,0)`;
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

/* ---------------- routing + events ---------------- */
function openAsset(id) {
  detailId = id;
  const hash = '#/s/' + encodeURIComponent(id);
  if (location.hash !== hash) history.pushState(null, '', hash);
  renderDetail(id);
  if (isCryptoId(id) || pairs[id]) { connectWS(); loadCryptoOnce(); }
}

function applyHash() {
  const h = location.hash || '#/';
  const m = h.match(/^#\/s\/(.+)$/);
  if (m) {
    const id = decodeURIComponent(m[1]);
    if (detailId !== id) openAsset(id);
    return;
  }
  if (detailId) closeDetail(false);
  let i = 0;
  if (h.startsWith('#/watch')) i = 1;
  else if (h.startsWith('#/port')) i = 2;
  else if (h.startsWith('#/alert')) i = 3;
  go(i, { nohash: true, instant: false });
}

document.addEventListener('click', e => {
  const act = e.target.closest('[data-act]');
  if (act) {
    const a = act.dataset.act;
    if (a === 'search') { e.preventDefault(); openSearch(); }
    else if (a === 'add-hold') { e.preventDefault(); openHoldForm(act.dataset.id || detailId || ''); }
    else if (a === 'add-alert') { e.preventDefault(); openAlertForm(act.dataset.id || detailId || ''); }
    else if (a === 'enable-note') { e.preventDefault(); enableNotes(); }
    else if (a === 'close-detail') { e.preventDefault(); history.back(); }
    else if (a === 'toggle-watch') {
      e.preventDefault();
      const id = act.dataset.id;
      const i = watch.indexOf(id);
      if (i >= 0) { watch.splice(i, 1); toast('Removed from watchlist'); }
      else { watch.unshift(id); toast('Added to watchlist'); }
      saveWatch(); renderAll();
    }
    else if (a === 'del-alert') {
      e.preventDefault();
      alerts = alerts.filter(x => x.key !== act.dataset.key);
      saveAlerts(); renderAlerts();
    }
    return;
  }
  // hash links for rows work natively
});

function paintThemeIcon() {
  const dark = document.documentElement.dataset.theme === 'dark';
  const btn = $('#themeBtn');
  if (!btn) return;
  btn.innerHTML = dark
    ? '<svg viewBox="0 0 24 24"><path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/></svg>'
    : '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M5 12H3M21 12h-2M6.2 6.2l1.4 1.4M16.4 16.4l1.4 1.4M6.2 17.8l1.4-1.4M16.4 7.6l1.4-1.4"/></svg>';
}
$('#themeBtn').addEventListener('click', () => {
  const cur = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = cur;
  store.set('theme', cur);
  const m = document.querySelector('meta[name=theme-color]');
  if (m) m.content = cur === 'dark' ? '#0a0a0a' : '#fafaf8';
  paintThemeIcon();
  if (detailId) renderDetail(detailId);
});
paintThemeIcon();

$$('.view').forEach(v => v.addEventListener('scroll', () => {
  if (v.dataset.tab === tab) $('#top').classList.toggle('sc', v.scrollTop > 8);
}, { passive: true }));

window.addEventListener('hashchange', applyHash);
window.addEventListener('popstate', applyHash);

/* ---------------- boot ---------------- */
async function boot() {
  loadUser();
  sizeBubble();
  applyHash();
  paintTrack(TABS.indexOf(tab), true);
  const jobs = [loadStocks(), loadPairs().then(loadCryptoOnce)];
  await Promise.all(jobs);
  renderAll();
  connectWS();
  checkAlerts();
  loadCryptoSparks().then(() => { if (!detailId) renderAll(); });
  clearInterval(pollTimer);
  pollTimer = setInterval(() => { loadCryptoOnce().then(() => { updatePrices(); checkAlerts(); setLive(); }); }, 20_000);
  // refresh stock file occasionally while the app is open
  setInterval(() => { loadStocks().then(() => { renderAll(); checkAlerts(); }); }, 5 * 60_000);
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
  navigator.serviceWorker.addEventListener('message', e => {
    if (e.data && e.data.type === 'open' && e.data.url) location.href = e.data.url;
  });
}

boot();
