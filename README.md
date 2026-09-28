# Market360

Market360 is a single-page Indian stock research terminal designed to run inside **GitHub Codespaces**.

The dashboard itself is one `index.html` file. A small Node.js server in the Codespace provides a same-origin gateway for NSE and RSS requests so the browser does not need to call NSE directly.

## Run in GitHub Codespaces

1. Open this repository on GitHub.
2. Click **Code → Codespaces → Create codespace on main**.
3. Wait for the Codespace to finish starting.
4. The devcontainer starts Market360 on port **3000** automatically.
5. If the browser does not open automatically, open the **Ports** tab, find port `3000`, then choose **Open in Browser**.
6. Search an NSE symbol such as `RELIANCE`, `TCS`, `INFY`, `HDFCBANK`, or `ONGC` and click **Analyze**.

If the server is not running:

```bash
npm start
```

For Node auto-reload while editing the gateway:

```bash
npm run dev
```

## Architecture

```text
Browser
  |
  | index.html (single-page dashboard)
  | same-origin /proxy requests
  v
Node server in GitHub Codespaces
  |
  +--> NSE website APIs with server-side session cookies
  +--> RSS / Google News RSS feeds
  +--> clearly labelled fallback market-data source when NSE is unavailable
```

## Dashboard coverage

- Live NSE equity quote and trading overview
- NIFTY 50, NIFTY Bank and India VIX context
- FII/DII cash-flow context
- NIFTY 50 breadth
- Intraday chart
- Daily history
- 20 / 50 / 200 DMA
- RSI 14
- MACD
- ATR
- 20-day support and resistance
- NSE valuation metadata such as P/E, sector P/E and P/B where returned
- NSE quarterly results-comparison data
- Multi-source RSS aggregation
- Stock-specific Google News RSS
- Economic Times Markets RSS
- Business Standard Markets RSS
- BusinessLine Markets RSS
- Mint Markets RSS
- Headline keyword sentiment
- NSE corporate announcements
- Corporate actions
- Shareholding filings
- NSE option-chain snapshot for eligible F&O stocks
- PCR, max Call OI strike and max Put OI strike
- Automatic live refresh

## Important NSE limitation

NSE can change endpoints, cookies, bot controls, rate limits and cloud-IP access without notice. The Codespaces gateway refreshes the NSE session and retries blocked requests, but NSE can still block a GitHub Codespaces egress IP. When that happens, Market360 labels unavailable or fallback data instead of inventing values.

Market360 is a research dashboard, not an investment recommendation. Verify important numbers using the original exchange or company filing before acting.
