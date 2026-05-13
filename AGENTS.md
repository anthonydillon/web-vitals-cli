# Agents

Guidance for AI agents working on this codebase.

## What this project does

`web-vitals-cli` is a Node.js CLI that fetches [PageSpeed Insights](https://developers.google.com/speed/docs/insights/v5/get-started) scores for one URL or every URL in a sitemap, persists results to `~/.web-vitals-history.json`, and surfaces them via a terminal report or a local Vanilla Framework web dashboard.

## File map

```
index.js   — CLI entry, PSI calls, sitemap parsing, history I/O, terminal rendering
server.js  — HTTP server, HTML generation, Vanilla Framework dashboard
package.json — type: "module", no runtime dependencies
```

Read `ARCHITECTURE.md` for data-flow diagrams and a full function reference.

---

## Conventions to follow

**Scores are integers (0–100) everywhere except the raw PSI response.** `analyzeUrl` in `index.js` multiplies the PSI float by 100 and rounds before returning. Never store or compare the raw 0–1 float.

**History keys are `"strategy:url"`.** Parse with `key.indexOf(':')` — not `split(':')` — because URLs contain colons.

**Thresholds are ≥90 good / ≥50 caution / <50 poor.** This is applied in `scoreColor` (ANSI, `index.js`) and `scoreLabel`/`sparkHtml` (CSS, `server.js`). If you change the thresholds, update both files.

**Zero runtime dependencies.** Use only Node built-ins (`fetch`, `fs`, `http`, `os`, `path`). Do not add packages to `package.json` without a compelling reason.

**ES modules throughout.** `package.json` sets `"type": "module"`. Use `import`/`export`, not `require`.

---

## How to add a new metric

1. In `analyzeUrl` (`index.js`), add `myMetric: get('audit-key')` and `myMetricScore: getScore('audit-key')` to the returned object.
2. In `recordEntry`, add `myMetric: result.myMetric !== null ? Math.round(result.myMetric) : null` to the saved entry if you want it in history.
3. In `printSingle`, add a row to `labMetrics`.
4. In `printReport`, add a column to the table and format it like the existing LCP/CLS/TBT columns.
5. In `server.js`, add a `<th>` and `<td>` to `strategyTable` / `tableRows`.

---

## How to add a new CLI subcommand

1. In `main()` (`index.js`), add an `if (args[0] === 'mycommand')` block **before** the URL parsing section. Parse any subcommand-specific flags there and return early.
2. Add the subcommand to the `printHelp()` usage block and to the relevant section in the options prose.
3. If the subcommand needs the history path, it is already resolved at the top of `main()` — use `historyPath`.

---

## How to change the dashboard UI

The entire page is generated as a template literal in `renderDashboard` (`server.js`). It uses [Vanilla Framework 4.19](https://vanillaframework.io/docs) loaded from the Ubuntu assets CDN.

- **Stat cards** — `statCard()` renders the `p-rule--highlight` pattern. The first card uses `is-accent` for the orange Canonical accent line.
- **Tables** — `strategyTable()` / `tableRows()`. Columns widths are set with inline `style="width:…"` on `<th>` elements.
- **Tabs** — generated from `Object.keys(byStrategy).sort()`. Adding a new strategy (e.g. a third PSI strategy) is automatic.
- **Favicons and logo** — served from `assets.ubuntu.com`. The Circle of Friends SVG (`CoF_white.svg`) is used as the nav logo tag.

The server re-reads the history file on every HTTP request, so no restart is needed after a scan.

---

## Things that are intentionally absent

- **No test suite.** The PSI API response shape is the main external contract; tests would need heavy mocking. Prefer manual end-to-end testing with `--no-save` and a fixture history file.
- **No argument-parsing library.** Flags are parsed manually with `args.indexOf` / `args.includes`. Keep it that way unless the flag surface grows significantly.
- **No watcher / `--watch` mode.** The dashboard auto-refreshes by reloading the page every 60 seconds. A file watcher would require Node's `fs.watch` and push updates via SSE or WebSocket — out of scope for a local monitoring tool.
- **No authentication on the dashboard.** It binds to `127.0.0.1` only and is not intended to be exposed publicly.
