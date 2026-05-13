# Architecture

## File structure

```
web-vitals-cli/
├── index.js          CLI entry point — all scanning, history, and terminal output
├── server.js         HTTP server — HTML rendering and dashboard
├── package.json      ES module config, bin entry, Node ≥18 engine constraint
└── ~/.web-vitals-history.json   Persistent history (outside the project dir)
```

The project has zero runtime dependencies. Everything uses Node built-ins: `fetch` (18+), `fs`, `http`, `os`, `path`.

---

## Data flow

### Single URL scan

```
CLI args
  └─ analyzeUrl(url, strategy, apiKey)
       └─ PSI API  →  raw JSON
            └─ extract score, lcp, cls, tbt, fcp, *Score fields
                 ├─ recordEntry(history, result, strategy, ts)  →  save to disk
                 └─ printSingle(result, history, strategy)      →  terminal
```

### Sitemap scan

```
CLI args
  └─ resolveSitemapUrls(sitemapUrl)
       └─ fetch XML  →  extractLocs()
            │  if <sitemapindex>: recurse into child sitemaps
            └─ flat list of page URLs
                 └─ pool(urls, concurrency, analyzeUrl)
                      ├─ recordEntry() × N  →  save to disk
                      └─ printReport(results, strategy, topN, history)  →  terminal
```

### Dashboard

```
browser GET /
  └─ loadHistory(path)  →  JSON file
       └─ parseHistory()  →  group by strategy, sort by score
            └─ renderDashboard()  →  HTML string  →  HTTP response

browser GET /api/history
  └─ loadHistory(path)  →  raw JSON  →  HTTP response
```

The server reads the file on **every request** — no in-memory caching. This means running a scan in a separate terminal is reflected immediately on the next browser refresh without restarting the server.

---

## Key modules

### `index.js`

| Function | Purpose |
|---|---|
| `analyzeUrl` | Calls PSI API, returns normalised result object |
| `resolveSitemapUrls` | Recursively fetches and parses sitemap XML |
| `isSitemapUrl` | Heuristic: path ends in `.xml` or contains `sitemap` |
| `pool` | Work-stealing concurrency pool — N workers share a cursor over the items array |
| `printSingle` | Terminal output for a single URL result |
| `printReport` | Terminal output for a sitemap batch result |
| `printHistoryReport` | Terminal output for the `history` subcommand |
| `recordEntry` | Appends a timestamped entry to history, trims to 50 |
| `loadHistory` / `saveHistory` | Read/write `~/.web-vitals-history.json` |
| `sparkline` | Maps scores to `▁▂▃▄▅▆▇█` block chars with ANSI colour |
| `formatDelta` | Formats score change as `+5`, `-3`, `─`, or `new` |

### `server.js`

| Function | Purpose |
|---|---|
| `parseHistory` | Splits `strategy:url` keys, groups pages by strategy, sorts by latest score |
| `globalStats` | Computes totals across all strategies (deduplicates by URL) |
| `scoreLabel` | Returns a Vanilla Framework `p-label--positive/caution/negative` span |
| `sparkHtml` | Same block-char sparkline as the CLI but using inline CSS colours |
| `deltaHtml` | Score change with ▲/▼ arrows in Canonical brand colours |
| `statCard` | `p-rule--highlight` stat block (VF highlighted rule pattern) |
| `strategyTable` | Full `p-table` for one strategy tab |
| `renderDashboard` | Assembles the full HTML page |
| `startServer` | Creates the `http.Server`, handles `/` and `/api/history` |

---

## History file format

Keys are `"strategy:url"` — a colon-delimited prefix. This avoids a nested object while still allowing separate mobile and desktop histories for the same URL. The colon is safe as a delimiter because URLs always start with `https://` (the first colon is at index 5 of the full key).

```json
{
  "desktop:https://example.com/": [
    { "ts": "ISO-8601", "score": 92, "lcp": 1300, "cls": 0.01, "tbt": 140, "fcp": 850 }
  ]
}
```

Scores are stored as integers (0–100). The PSI API returns scores as floats (0–1); `analyzeUrl` multiplies and rounds before returning so the normalisation happens in one place.

---

## Concurrency pool

`pool(items, concurrency, fn)` is a minimal work-stealing implementation. Each worker runs a `while` loop and claims the next unclaimed index via a shared `cursor`. This naturally balances load when individual PSI requests vary in latency — faster workers pick up more items rather than waiting for the slowest request in a batch.

```js
async function pool(items, concurrency, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const idx = cursor++;
      results[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}
```

---

## Scoring thresholds

The same three-band thresholds are used in both modules:

| Score | Terminal (ANSI) | Dashboard (CSS) |
|---|---|---|
| ≥ 90 | `\x1b[32m` (green) | `#0e8420` / `p-label--positive` |
| 50–89 | `\x1b[33m` (yellow) | `#c98d00` / `p-label--caution` |
| < 50 | `\x1b[31m` (red) | `#c7162b` / `p-label--negative` |

Colours match the [Canonical brand palette](https://vanillaframework.io/docs/settings/color-settings) used by Vanilla Framework.

---

## Sitemap detection

`isSitemapUrl` uses a URL pathname heuristic — no network request needed:

```js
path.endsWith('.xml') || path.includes('sitemap')
```

This correctly identifies `sitemap.xml`, `sitemap_index.xml`, `news-sitemap.xml`, `/sitemap/`, and similar. For atypical URLs, pass the URL to a normal single-page scan; the PSI API will simply return page results for the XML file itself, which will fail gracefully.
