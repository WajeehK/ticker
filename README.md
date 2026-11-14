# Ticker

A mobile-first PWA for watching stocks, ETFs and crypto, with a portfolio, markets overview, news, charts and price alerts. Live at [wajeehk.github.io/ticker](https://wajeehk.github.io/ticker/).

Portfolio, watchlists, alerts and value snapshots stay on your device (localStorage). Nothing is uploaded. The shipped app does not include a sample portfolio.

## What’s in v3

- Cleaner Robinhood / Trading 212-inspired asset page: black theme, large native-currency price with an “at close” change line, full-width cyan line chart with a current-price label, range pills including 3M, and a “Your investment” card (value, return, shares, average in $ and £) when a holding is stored on this device.
- Analyst consensus, price-target range, upcoming events, and a rule-based outlook card on every stock/ETF page, plus per-asset news with source, time and thumbnail. Crypto pages show “No analyst coverage” and market data instead. See [SOURCES.md](SOURCES.md).
- One-tap portfolio import via a URL hash (`#import=<base64url JSON>`), read in the browser, saved to localStorage, then cleared. Holdings are never committed to this repo.
- Local logos for the tracked universe (see [SOURCES.md](SOURCES.md)), 44px row avatars and a larger mark on the asset page, with a light chip behind dark logos and a monogram fallback.
- Markets tab: S&P 500, Nasdaq, Dow, FTSE 100, crypto movers, fear & greed, top gainers/losers, and market news.
- Per-asset news where the refresh job found a feed, plus dividend dates from Yahoo chart events when present.
- Portfolio analytics: allocation donuts by asset and by type, day change, total return, best/worst holding, and a value-over-time chart from on-device snapshots. Import and export holdings as CSV.
- GBP / USD display toggle (default GBP) using the latest committed GBPUSD rate.
- Multiple watchlists, sort and filter.
- Compare two assets on the chart (as percent change). Line or candles, SMA 20 / EMA 20, and a volume pane when the history file includes volume.
- Price alerts: above, below, or a percent move up or down from the current price.
- Richer liquid-glass UI, green up / red down, count-up portfolio value, price flash on a live tick, skeleton loaders, pull-to-refresh, and the same fluid gooey tab bar.

## Data sources

Full licence and fetch notes are in [SOURCES.md](SOURCES.md). In short:

- **Crypto — live.** Public Kraken WebSocket (`wss://ws.kraken.com/v2`) for tick-by-tick USD prices, with the public REST ticker and OHLC as fallback and for charts. No API key. Usually updates within a second.
- **US and UK stocks, ETFs and indices — delayed.** Yahoo Finance has no CORS, so a GitHub Actions job writes `data/quotes.json` and `data/hist/`. Exchange delay is typically **up to 15 minutes**, and the file can be older if Actions runs late. London pence (GBp) is stored and shown in pounds.
- **News and fear & greed.** BBC, Google News and CoinDesk RSS, plus alternative.me, written into `data/news.json` by the same Action. Every equity, ETF and index gets a Google News search feed.
- **Analyst data — delayed.** Nasdaq’s public analyst API is written into `data/analysis.json` by the same Action. Yahoo quoteSummary was dropped after two 429/401 failures. No Finnhub (key required). Outlook text is generated from that data and from headlines, not from a language-model API.
- **Charts.** [TradingView Lightweight Charts](https://github.com/tradingview/lightweight-charts) (Apache-2.0), vendored in `vendor/`.
- **Insider trades (optional).** If The Insider House has a page for a ticker, the asset screen links to it. Not a second market-data feed.

If a feed fails, Ticker shows an error — it never invents a price, earnings date, or catalyst. Next-earnings dates are omitted when Nasdaq’s calendar has no record. Yahoo quoteSummary was skipped after two crumb failures.

## Local development

```bash
python3 pipeline/refresh.py      # Yahoo quotes, history, dividends, news, Nasdaq analysis
python3 pipeline/fetch_logos.py  # rebuild img/ (needs a prior quotes.json and the icon sources documented in SOURCES.md)
python3 -m http.server 8080      # then open http://localhost:8080
```

The service-worker cache name in `sw.js` must be bumped on every release (`ticker-shell-t4` → `t5`, and the `?v=t4` query strings on CSS/JS). Logos are runtime-cached, not precached.

## Disclaimer

Not investment advice. Quotes can be delayed, incomplete or wrong. Crypto prices are from one exchange. Do your own checks before you trade.
