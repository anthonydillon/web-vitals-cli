# web-vitals-cli

A zero-dependency Node.js CLI that checks [Core Web Vitals](https://web.dev/vitals/) for any URL or sitemap using the [Google PageSpeed Insights API](https://developers.google.com/speed/docs/insights/v5/get-started). Results are persisted locally so you can track scores over time and view trends in a local web dashboard.

## Requirements

- Node.js 18 or later (uses the built-in `fetch` API)
- A Google API key is recommended (free, 25,000 requests/day). Without one the shared quota can be exhausted.

## Setup

```bash
# Get a free API key
# https://developers.google.com/speed/docs/insights/v5/get-started

# Export it so every run picks it up automatically
export PSI_API_KEY=your-key-here

# Or pass it per-run
node index.js https://example.com --key your-key-here
```

No `npm install` is needed — the project has zero runtime dependencies.

---

## Usage

### Analyse a single page

```bash
node index.js https://example.com
```

Prints lab data (Lighthouse) and field data (CrUX real-user metrics) for the URL, followed by a score history trend if the URL has been checked before.

### Analyse all pages in a sitemap

URLs ending in `.xml` or containing `sitemap` in the path are auto-detected as sitemaps. Sitemap index files (nested sitemaps) are resolved recursively.

```bash
node index.js https://example.com/sitemap.xml
```

Outputs a sorted table of every checked page with Score, Δ (change since last run), LCP, CLS, TBT, run count, and URL — plus Top Performers and Needs Attention sections.

### View history in the terminal

```bash
node index.js history            # all strategies
node index.js history --mobile   # mobile only
node index.js history --desktop  # desktop only
```

Shows a compact table of every tracked URL with its latest score, delta from the previous run, a sparkline of the last 10 runs, and run count.

### Open the web dashboard

```bash
node index.js serve              # http://localhost:3000
node index.js serve --port 8080
```

A Vanilla Framework dashboard that reads the history file on every request and auto-refreshes every 60 seconds. Run scans in a separate terminal and refresh the browser to see results update live.

---

## Options

| Flag | Default | Description |
|---|---|---|
| `--desktop` | ✓ default | Simulate a desktop browser |
| `--mobile` | | Simulate a mobile browser |
| `--key <api-key>` | `$PSI_API_KEY` | Google PageSpeed Insights API key |
| `--limit <n>` | `50` | Max pages to check from a sitemap |
| `--top <n>` | `10` | Pages highlighted in Top Performers |
| `--concurrency <n>` | `3` | Parallel PSI requests |
| `--history <path>` | `~/.web-vitals-history.json` | History file location |
| `--no-save` | | Skip writing results to history |
| `--port <n>` | `3000` | Dashboard port (`serve` only) |
| `--help`, `-h` | | Show help |

---

## Scoring thresholds

| Score | Rating |
|---|---|
| 90 – 100 | Good (green) |
| 50 – 89 | Needs Improvement (yellow) |
| 0 – 49 | Poor (red) |

These match the [Lighthouse scoring scale](https://developer.chrome.com/docs/lighthouse/performance/performance-scoring/).

---

## History file

Results are appended to `~/.web-vitals-history.json` after every run. The file is keyed by `strategy:url` so mobile and desktop scores are tracked independently. Up to 50 entries are kept per URL per strategy.

```json
{
  "desktop:https://example.com/": [
    {
      "ts": "2026-05-13T10:00:00.000Z",
      "score": 92,
      "lcp": 1300,
      "cls": 0.01,
      "tbt": 140,
      "fcp": 850
    }
  ]
}
```

Use `--history <path>` to store separate histories for different projects, or `--no-save` to run a one-off check without touching the file.

---

## Metrics reference

| Metric | Full name | Weight |
|---|---|---|
| LCP | Largest Contentful Paint | High |
| CLS | Cumulative Layout Shift | High |
| TBT | Total Blocking Time (lab proxy for INP/FID) | High |
| FCP | First Contentful Paint | Medium |
| SI | Speed Index | Medium |
| TTI | Time to Interactive | Medium |
| INP | Interaction to Next Paint (field data only) | High |
