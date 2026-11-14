# Ticker data and image sources

Nothing in the app is invented. If a feed or logo is missing, Ticker shows a gap, an error, or a coloured monogram — never a made-up price or a hotlinked image.

All logo files are stored in this repo under `img/` and served from GitHub Pages. The live site does not fetch logos from third-party hosts at runtime.

## Market data

| What | Source | When it updates | Notes |
| --- | --- | --- | --- |
| Crypto last, 24h change, OHLC, volume | [Kraken public REST](https://docs.kraken.com/api/) and WebSocket `wss://ws.kraken.com/v2` | Live in the browser (usually under a second). REST ticker used on first load and as fallback. | USD pairs only. No API key. 24h open is Kraken’s `o` field, not a previous daily close. |
| US and UK stocks, ETFs, and indices | Yahoo Finance chart API, fetched by `.github/workflows/refresh.yml` into `data/quotes.json` and `data/hist/` | About every 15 minutes. Exchange delay is typically up to 15 minutes on top, and Actions can run late. | No CORS, so the browser never calls Yahoo. London pence (GBp) is stored and displayed as pounds. For US listings the Action also requests `includePrePost=true` 5-minute bars. If a print exists after the official regular close, that extended-hours last is stored as `price` with `session` set to `post` or `pre`, `asOf` set to that print’s time, and the official regular close kept as `regularClose`. Yahoo’s `postMarketPrice` field is often empty, so the last pre/post bar is used. The change shown after hours is versus the regular close. |
| FX (GBP/USD, EUR/USD) | Yahoo `GBPUSD=X` and `EURUSD=X`, stored in `data/quotes.json` as `fx` | Same refresh as stocks | Used to show portfolio totals and the GBP/USD display toggle. If the rate is missing, amounts stay in the native currency. |
| Fear & greed index | [alternative.me](https://api.alternative.me/fng/) | Written into `data/news.json` by the same Action | Snapshot, not a live tick. alternative.me allows cross-origin reads, but the committed file is the reliable path. |
| Market and per-asset news | BBC Business RSS, Google News Business RSS, CoinDesk RSS, and Google News search RSS per equity/ETF/index (company name + ticker; rare-earth keywords for USAR and MP) | Written into `data/news.json` by `pipeline/market_extras.py` during the Action | Fetched server-side (RSS has no CORS). Headlines can be delayed until the next refresh. Yahoo RSS returned 403 and is not used. Thumbnails are kept when the feed includes them. |
| Dividends | Yahoo chart `events.dividends`, last twelve, stored on each history file and as `lastDiv` on the quote | Same refresh as stocks | Dates and amounts can be delayed or incomplete. |
| Earnings dates | Nasdaq `company/{symbol}/earnings-surprise` (past reports). Next-earnings calendar on Nasdaq often returns no record. Yahoo `quoteSummary` `calendarEvents` was **skipped** after two crumb failures (HTTP 429). | Past EPS vs consensus when Nasdaq returns it. No date is invented when the calendar is empty. | US listings only. |
| Analyst consensus, price targets, rating history | Nasdaq public website API: `api.nasdaq.com/api/analyst/{symbol}/targetprice`, `/ratings`, and `/company/{symbol}/earnings-surprise`. Fetched by `pipeline/analysis.py` during the Action into `data/analysis.json`. | Same refresh as quotes. | Yahoo `quoteSummary` (financialData, recommendationTrend, upgradeDowngradeHistory, calendarEvents, earningsTrend, defaultKeyStatistics) was tried twice and dropped: crumb endpoint returned HTTP 429, then quoteSummary returned 401 Invalid Crumb. Finnhub was skipped (API key required). Nasdaq does not split Strong Buy / Strong Sell, does not publish a median target, and `/analyst/{symbol}/estimate` returned 404 (no forward EPS or revenue growth). London-listed (.L) and index symbols are not covered. Implied upside uses the Yahoo last price in this app versus the Nasdaq mean target. |
| Automated outlook | Rule-based sentences in `pipeline/analysis.py` from consensus, target upside, 50/200-day averages, recent rating changes, last earnings, dividends, and fetched headlines. | Written into `data/analysis.json` with the analyst refresh. | Labelled “Automated outlook from analyst data and news, not financial advice.” Claims are only made from fetched fields or linked headlines — numbers and catalysts are never invented. |

Index symbols: `^GSPC` (S&P 500), `^IXIC` (Nasdaq Composite), `^DJI` (Dow Jones), `^FTSE` (FTSE 100, GBP).

## Logos (`img/`)

Built by `pipeline/fetch_logos.py`. A manifest at `img/manifest.json` maps each ticker to a local path, a source string, and whether a light chip should sit behind the mark (`chip`).

| Kind | Source | Licence / terms | Where it lives |
| --- | --- | --- | --- |
| Crypto colour icons | [spothq/cryptocurrency-icons](https://github.com/spothq/cryptocurrency-icons) colour SVG set | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) (the repo also notes MIT) | `img/crypto/{code}.svg` |
| Crypto icons not in that set | CoinGecko `coins/markets` image URLs, **downloaded at build time** | CoinGecko brand assets; stored locally, not hotlinked | `img/crypto/{code}.png` |
| Stock and ETF logos | [Financial Modeling Prep](https://financialmodelingprep.com/image-stock/{SYMBOL}.png) image-stock PNGs, **downloaded at build time** | FMP image endpoint; stored locally, not hotlinked | `img/stocks/{SYMBOL}.png` (caret in index symbols becomes `_`) |
| Index badges | Original circular marks drawn for Ticker (`pipeline/make_asset_marks.py`): S&P 500 gold rising bars and star ring, Nasdaq teal arch, Dow pyramid over flag stripes, FTSE Union Jack | Original to this repo (flag geometries are public-domain); not official exchange wordmarks | `img/indices/sp500.svg`, `nasdaq.svg`, `dow.svg`, `ftse.svg` |
| Commodity icons | Original circular illustrations (gold/silver bars, oil barrels, gas flame, copper coil, platinum/palladium ingots) | Original to this repo | `img/commodities/{gold,silver,wti,brent,gas,copper,platinum,palladium}.svg` |
| FX pair badges | Split circular Union Jack / EU / US flag badges | Original to this repo; flag geometries are public-domain | `img/fx/gbpusd.svg`, `eurusd.svg` |

ETF marks are whatever FMP serves for that ticker — often the issuer wordmark (Vanguard, iShares, SPDR).

Stocks and ETFs always sit on a light chip (`--chip`, off-white) so a dark mark (Apple, Vanguard, HSBC) stays visible on the dark theme. Crypto colour icons already have a filled disc, so they are not chipped. If a file is missing or the image fails to load, the row falls back to a coloured monogram.

Coverage is rebuilt by `pipeline/fetch_logos.py`, `pipeline/make_asset_marks.py`, `pipeline/crypto_markets.py` and `pipeline/upgrade_logos.py`. Stocks and ETFs prefer a 256px locally stored mark (CompaniesMarketCap or Financial Modeling Prep). Undersized or ultra-wide FMP wordmarks are replaced or padded to a 256×256 square. Crypto icons use the CC0 SVG set where available, otherwise a CoinGecko **large** PNG (≈250px), stored locally. Commodities, major indices and the two FX pairs use the original SVG marks above — they are not monograms. The Markets crypto tab is driven by `data/crypto_markets.json` (CoinGecko top 100 by market cap, 7-day sparkline, volume, trending; Kraken USD pairs are flagged for live ticks).

## Charts

[TradingView Lightweight Charts](https://github.com/tradingview/lightweight-charts) v5.3.0, Apache-2.0, vendored at `vendor/lightweight-charts.js`. No call is made to TradingView’s servers.


## Stock Fear & Greed and crash risk (`data/market_sentiment.json`)

Built by `pipeline/market_sentiment.py` during the quotes refresh. Nothing is invented: an input that cannot be fetched is marked unavailable and dropped from the average.

**Fear & Greed.** The Action first requests CNN's public Fear & Greed `graphdata` endpoint (`https://production.dataviz.cnn.io/index/fearandgreed/graphdata`). That host returns HTTP 418 to a non-browser user agent, so the script retries this one feed with a documented browser-like UA and a CNN referrer. When the score comes back, Ticker uses CNN's reading, rating, history and sub-indicators, and labels the source "CNN Fear & Greed Index". If the endpoint fails, Ticker falls back to a transparent, equal-weighted composite from Yahoo data already in the repo: VIX versus its 50-day average, S&P 500 versus its 125-day average, breadth (share of Ticker's US stock universe above their 50-day average — not official exchange breadth), TLT versus SPY 20-day return, and HYG versus LQD 20-day return.

**Crash risk.** Always Ticker's Yahoo composite, never a CNN figure: VIX versus VIX3M term structure, S&P 500 drawdown from the 52-week high, S&P 500 versus its 200-day average, the same breadth measure, HYG versus LQD, and the 10-year minus 3-month Treasury slope (`^TNX` − `^IRX`). Each input is shown with its value and the threshold used. The overall level is Low / Elevated / High / Extreme. The on-screen disclaimer is "Indicator, not a prediction, not financial advice."

## Crypto market list (`data/crypto_markets.json`)

Built by `pipeline/crypto_markets.py` during the quotes refresh. Snapshot of the CoinGecko `/coins/markets` top 100 (USD), `/search/trending`, and recently-added when that category is available, plus 7-day sparklines, market cap and 24h volume. The app overlays live Kraken WebSocket prices on coins that have a Kraken USD pair. CoinGecko is not called from the browser at runtime.

## App typography and icons

Inter is loaded from Google Fonts. The Ticker app icon is generated by `pipeline/make_icons.py` (original).


## Holdings and import links

Holdings live only in the browser (`localStorage`). They are not committed to this repository. A one-tap import URL uses a client-side hash (`#import=<base64url JSON>`). The app reads the payload, saves it locally, and then clears the hash from the address bar. Do not put real holdings in git.

## Commodities
Gold, silver, WTI, Brent, natural gas, copper, platinum and palladium last prices come from Yahoo Finance futures (`GC=F`, `SI=F`, `CL=F`, `BZ=F`, `NG=F`, `HG=F`, `PL=F`, `PA=F`). They are shown in USD with the contract unit and are not converted when you switch display currency.

## News
Market headlines must include a finance signal (shares, earnings, IPO, valuation, Fed, $1bn, etc.); a company name is not enough. Scandal, politics and outage-only stories are dropped. Sources prefer Reuters, CNBC, MarketWatch, FT Markets and Yahoo Finance / Google News market queries. Crypto wires are listed on the Crypto tab only. Identical titles are deduped. The refresh job tries to store `og:image` and extracted article text for an in-app reader; if a publisher blocks that, the reader offers the original link.


## IPOs (`data/ipos.json`)

Built by `pipeline/ipos.py` during the quotes refresh. The Action first requests the Nasdaq public IPO calendar (`https://api.nasdaq.com/api/ipo/calendar?date=YYYY-MM`) for the previous, current and next month, covering upcoming, priced, filed and withdrawn deals. The same browser-like user agent already used for Nasdaq analyst endpoints is required; a short timeout can stall. When a section is empty or the API fails, Ticker falls back to the public [StockAnalysis IPO pages](https://stockanalysis.com/ipos/calendar/) (calendar, recent, filings) and merges any deal that is not already on the Nasdaq list, labelled with its source.

Each row keeps company, ticker, exchange, dates, price range or IPO price, shares offered and deal size exactly as published. Current price and the percentage move since IPO are added only when Yahoo Finance returns a quote for that ticker (recently priced names are added to the refresh universe dynamically). Missing quotes are left blank — figures are never invented. A generated-at / as-of timestamp is stored on the file.

Logos prefer [Financial Modeling Prep](https://financialmodelingprep.com/image-stock/{SYMBOL}.png) image-stock, then a CompaniesMarketCap 256px PNG, stored locally under `img/ipos/` and indexed in `img/manifest.json`. If neither has a mark, Ticker draws an original circular badge from the ticker. UK / LSE notable IPOs are attempted from free sources and omitted when no structured public calendar is available.
