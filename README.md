# Ticker

A mobile-first PWA for watching stocks, ETFs and crypto, with a portfolio and price alerts. Live at [wajeehk.github.io/ticker](https://wajeehk.github.io/ticker/).

Portfolio, watchlist and alerts stay on your device (localStorage). Nothing is uploaded.

## Data sources

- **Crypto — live.** Public Kraken WebSocket (`wss://ws.kraken.com/v2`) for tick-by-tick USD prices, with the public REST ticker and OHLC as fallback and for charts. No API key. Usually updates within a second.
- **US and UK stocks and ETFs — delayed.** Yahoo Finance does not allow browser calls (no CORS), so a GitHub Actions job fetches official Yahoo chart quotes about every 15 minutes and writes `data/quotes.json` plus `data/hist/`. Exchange delay is typically **up to 15 minutes**, and the file can be a little older if Actions runs late. The app always shows when the file was last refreshed. London stocks quoted in pence (GBp) are stored and shown in pounds.
- **Charts.** [TradingView Lightweight Charts](https://github.com/tradingview/lightweight-charts) (Apache-2.0), vendored in `vendor/`. Ranges: 1D, 1W, 1M, 1Y, All.
- **Insider trades (optional).** If The Insider House has a page for a ticker, the asset screen links to it. Not a second market-data feed.

If a feed fails, Ticker shows an error — it never invents a price.

## Local development

```bash
python3 pipeline/refresh.py   # writes data/ from Yahoo (optional; committed data is enough to run)
python3 -m http.server 8080   # then open http://localhost:8080
```

The service-worker cache name in `sw.js` must be bumped on every release (`ticker-shell-t1` → `t2`, and the `?v=t1` query strings on CSS/JS).

## Disclaimer

Not investment advice. Quotes can be delayed, incomplete or wrong. Crypto prices are from one exchange. Do your own checks before you trade.
