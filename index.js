#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { startServer } from './server.js';
import {
  MAX_ENTRIES_PER_URL,
  historyKey, getLastEntry, recordEntry,
  extractLocs, isSitemapUrl,
  fmtMs, truncate,
} from './lib.js';

const API_BASE = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';
const DEFAULT_HISTORY_PATH = join(homedir(), '.web-vitals-history.json');

const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
};

// ─── Formatting helpers ────────────────────────────────────────────────────

function scoreColor(score) {
  if (score >= 90) return c.green;
  if (score >= 50) return c.yellow;
  return c.red;
}

function formatScore(score) {
  const label = score >= 90 ? 'Good' : score >= 50 ? 'Needs Improvement' : 'Poor';
  return `${scoreColor(score)}${score}${c.reset} ${c.dim}(${label})${c.reset}`;
}

function scoreTag(score) {
  return `${scoreColor(score)}${c.bold}${String(score).padStart(3)}${c.reset}`;
}

function formatDelta(current, prev) {
  if (prev === null) return c.dim + ' new'.padEnd(5) + c.reset;
  const diff = current - prev;
  if (diff === 0) return c.dim + '   ─ '.padEnd(5) + c.reset;
  const sign = diff > 0 ? '+' : '';
  const col = diff > 0 ? c.green : c.red;
  return `${col}${(sign + diff).padStart(4)} ${c.reset}`;
}

function categoryColor(cat) {
  if (cat === 'FAST') return c.green;
  if (cat === 'AVERAGE') return c.yellow;
  return c.red;
}

function categoryLabel(cat) {
  if (cat === 'FAST') return 'Good';
  if (cat === 'AVERAGE') return 'Needs Improvement';
  return 'Poor';
}


function formatTs(isoString) {
  const d = new Date(isoString);
  return d.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
}

const SPARK_BARS = '▁▂▃▄▅▆▇█';

function sparkline(scores) {
  const chars = scores.map(s => {
    const bar = SPARK_BARS[Math.min(7, Math.floor(s / 100 * 8))];
    return scoreColor(s) + bar + c.reset;
  });
  // pad to fixed 10-char visual width for table alignment
  const pad = ' '.repeat(Math.max(0, 10 - scores.length));
  return chars.join('') + pad;
}

// ─── History I/O ──────────────────────────────────────────────────────────

function loadHistory(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return {};
  }
}

function saveHistory(filePath, history) {
  writeFileSync(filePath, JSON.stringify(history, null, 2), 'utf8');
}

// ─── Sitemap parsing ───────────────────────────────────────────────────────

async function fetchText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'web-vitals-cli/1.0' } });
  if (!res.ok) throw new Error(`Failed to fetch ${url}: HTTP ${res.status}`);
  return res.text();
}

async function resolveSitemapUrls(url, visited = new Set()) {
  if (visited.has(url)) return [];
  visited.add(url);
  const xml = await fetchText(url);
  if (xml.includes('<sitemapindex')) {
    const childUrls = extractLocs(xml);
    const nested = await Promise.all(childUrls.map(u => resolveSitemapUrls(u, visited)));
    return nested.flat();
  }
  return extractLocs(xml);
}

// ─── PSI analysis ──────────────────────────────────────────────────────────

async function analyzeUrl(url, strategy, apiKey) {
  const apiUrl = `${API_BASE}?url=${encodeURIComponent(url)}&strategy=${strategy}${apiKey ? `&key=${apiKey}` : ''}`;
  const res = await fetch(apiUrl);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `HTTP ${res.status}`);
  }
  const data = await res.json();
  const lh = data.lighthouseResult;
  const audits = lh?.audits ?? {};
  const get = key => audits[key]?.numericValue ?? null;
  const getScore = key => audits[key]?.score ?? null;
  return {
    url,
    score: lh?.categories?.performance?.score !== null ? Math.round((lh?.categories?.performance?.score ?? 0) * 100) : null,
    lcp: get('largest-contentful-paint'),
    cls: get('cumulative-layout-shift'),
    tbt: get('total-blocking-time'),
    fcp: get('first-contentful-paint'),
    lcpScore: getScore('largest-contentful-paint'),
    clsScore: getScore('cumulative-layout-shift'),
    tbtScore: getScore('total-blocking-time'),
    fcpScore: getScore('first-contentful-paint'),
    raw: data,
  };
}

// ─── Concurrency pool ──────────────────────────────────────────────────────

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

// ─── Single-URL output ─────────────────────────────────────────────────────

function printSingle(result, history, strategy) {
  const data = result.raw;
  const lh = data.lighthouseResult;
  const field = data.loadingExperience;
  const prev = getLastEntry(history, result.url, strategy);

  if (result.score !== null) {
    const delta = prev ? formatDelta(result.score, prev.score) : '';
    console.log(`${c.bold}Performance Score:${c.reset} ${formatScore(result.score)}${prev ? `  ${delta}` : ''}`);
    console.log();
  }

  console.log(`${c.bold}${c.cyan}Lab Data (Lighthouse)${c.reset}`);
  console.log('─'.repeat(52));

  const audits = lh?.audits ?? {};
  const labMetrics = [
    { key: 'largest-contentful-paint', label: 'LCP (Largest Contentful Paint)', isCls: false },
    { key: 'cumulative-layout-shift',  label: 'CLS (Cumulative Layout Shift)',  isCls: true  },
    { key: 'total-blocking-time',      label: 'TBT (Total Blocking Time)',      isCls: false },
    { key: 'first-contentful-paint',   label: 'FCP (First Contentful Paint)',   isCls: false },
    { key: 'speed-index',              label: 'SI  (Speed Index)',              isCls: false },
    { key: 'interactive',              label: 'TTI (Time to Interactive)',      isCls: false },
  ];

  for (const { key, label, isCls } of labMetrics) {
    const audit = audits[key];
    if (!audit) continue;
    const value = isCls ? audit.numericValue.toFixed(3) : fmtMs(audit.numericValue);
    const scorePart = audit.score !== null ? ` — ${formatScore(Math.round(audit.score * 100))}` : '';
    console.log(`  ${label.padEnd(36)} ${value}${scorePart}`);
  }

  if (field?.metrics && Object.keys(field.metrics).length > 0) {
    console.log();
    console.log(`${c.bold}${c.cyan}Field Data (Real Users · CrUX)${c.reset}`);
    console.log('─'.repeat(52));

    const fieldMetrics = [
      { key: 'LARGEST_CONTENTFUL_PAINT_MS',   label: 'LCP (Largest Contentful Paint)',  isCls: false },
      { key: 'CUMULATIVE_LAYOUT_SHIFT_SCORE',  label: 'CLS (Cumulative Layout Shift)',   isCls: true  },
      { key: 'INTERACTION_TO_NEXT_PAINT',      label: 'INP (Interaction to Next Paint)', isCls: false },
      { key: 'FIRST_CONTENTFUL_PAINT_MS',      label: 'FCP (First Contentful Paint)',    isCls: false },
    ];

    for (const { key, label, isCls } of fieldMetrics) {
      const metric = field.metrics[key];
      if (!metric) continue;
      const value = isCls ? (metric.percentile / 100).toFixed(3) : fmtMs(metric.percentile);
      const col = categoryColor(metric.category);
      console.log(`  ${label.padEnd(36)} ${value} — ${col}${categoryLabel(metric.category)}${c.reset}`);
    }

    if (field.overall_category) {
      console.log();
      console.log(`  Overall Field Experience: ${categoryColor(field.overall_category)}${c.bold}${categoryLabel(field.overall_category)}${c.reset}`);
    }
  } else {
    console.log();
    console.log(`${c.dim}  No field data available — CrUX requires sufficient real-user traffic.${c.reset}`);
  }

  // History trend
  const entries = history[historyKey(result.url, strategy)];
  if (entries && entries.length > 1) {
    // entries includes the one we just pushed, so show the previous ones
    const past = entries.slice(0, -1).slice(-5).reverse();
    console.log();
    console.log(`${c.bold}${c.cyan}Score History (${strategy})${c.reset}`);
    console.log('─'.repeat(52));
    for (const e of past) {
      const lcpStr = e.lcp !== null ? ms(e.lcp).padEnd(7) : 'n/a    ';
      const clsStr = e.cls !== null ? String(e.cls).padEnd(6) : 'n/a   ';
      const tbtStr = e.tbt !== null ? ms(e.tbt) : 'n/a';
      console.log(`  ${scoreTag(e.score)}  ${c.dim}${formatTs(e.ts)}  LCP ${lcpStr}  CLS ${clsStr}  TBT ${tbtStr}${c.reset}`);
    }
  }

  console.log();
}

// ─── Sitemap report ────────────────────────────────────────────────────────

function printReport(results, strategy, topN, history) {
  const succeeded = results.filter(r => r.score !== null);
  const failed = results.filter(r => r.error);

  if (succeeded.length === 0) {
    console.log(`\n${c.red}No results to report — all requests failed.${c.reset}\n`);
    return;
  }

  const sorted = [...succeeded].sort((a, b) => b.score - a.score);
  const scores = sorted.map(r => r.score);
  const avg = Math.round(scores.reduce((s, v) => s + v, 0) / scores.length);
  const good = scores.filter(s => s >= 90).length;
  const needsWork = scores.filter(s => s >= 50 && s < 90).length;
  const poor = scores.filter(s => s < 50).length;

  const sep = '─'.repeat(76);
  const URL_WIDTH = 44;

  console.log();
  console.log(`${c.bold}${'═'.repeat(76)}${c.reset}`);
  console.log(`${c.bold}  Web Vitals Report  ·  ${strategy}  ·  ${succeeded.length} pages checked${c.reset}`);
  console.log(`${c.bold}${'═'.repeat(76)}${c.reset}`);

  // Full sorted table
  console.log();
  console.log(`${c.bold}  All pages — sorted by performance score${c.reset}`);
  console.log(`  ${c.dim}${'Score'.padEnd(6)}${'Δ'.padEnd(6)}${'LCP'.padEnd(8)}${'CLS'.padEnd(7)}${'TBT'.padEnd(8)}URL${c.reset}`);
  console.log(`  ${sep}`);

  for (const r of sorted) {
    const prev = getLastEntry(history, r.url, strategy);
    const prevScore = prev?.score ?? null;
    const delta = formatDelta(r.score, prevScore);
    const score = scoreTag(r.score);
    const lcp = r.lcp !== null
      ? `${scoreColor(Math.round(r.lcpScore * 100))}${ms(r.lcp).padEnd(7)}${c.reset}`
      : c.dim + 'n/a    ' + c.reset;
    const cls = r.cls !== null
      ? `${scoreColor(Math.round(r.clsScore * 100))}${r.cls.toFixed(3).padEnd(6)}${c.reset}`
      : c.dim + 'n/a   ' + c.reset;
    const tbt = r.tbt !== null
      ? `${scoreColor(Math.round(r.tbtScore * 100))}${ms(r.tbt).padEnd(7)}${c.reset}`
      : c.dim + 'n/a    ' + c.reset;
    const url = c.dim + truncate(r.url, URL_WIDTH) + c.reset;
    console.log(`  ${score}  ${delta} ${lcp} ${cls} ${tbt} ${url}`);
  }

  // Changes section
  const withHistory = succeeded.filter(r => getLastEntry(history, r.url, strategy) !== null);
  if (withHistory.length > 0) {
    const changed = withHistory
      .map(r => ({ ...r, delta: r.score - getLastEntry(history, r.url, strategy).score }))
      .filter(r => r.delta !== 0)
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

    const improved = changed.filter(r => r.delta > 0).slice(0, 5);
    const degraded = changed.filter(r => r.delta < 0).slice(0, 5);

    if (improved.length > 0 || degraded.length > 0) {
      console.log();
      console.log(`${c.bold}  Changes since last run${c.reset}`);
      console.log(`  ${sep}`);
      for (const r of improved) {
        console.log(`  ${scoreTag(r.score)}  ${c.green}+${r.delta}${c.reset}  ${r.url}`);
      }
      for (const r of degraded) {
        console.log(`  ${scoreTag(r.score)}  ${c.red}${r.delta}${c.reset}  ${r.url}`);
      }
    }
  }

  // Top performers
  const top = sorted.slice(0, topN);
  console.log();
  console.log(`${c.bold}${c.green}  Top ${top.length} Performers${c.reset}`);
  console.log(`  ${sep}`);
  for (const r of top) {
    console.log(`  ${scoreTag(r.score)}  ${r.url}`);
  }

  // Pages needing attention
  const attention = sorted.filter(r => r.score < 50);
  if (attention.length > 0) {
    console.log();
    console.log(`${c.bold}${c.red}  Needs Attention (score < 50)${c.reset}`);
    console.log(`  ${sep}`);
    for (const r of attention) {
      console.log(`  ${scoreTag(r.score)}  ${r.url}`);
    }
  }

  // Failed URLs
  if (failed.length > 0) {
    console.log();
    console.log(`${c.bold}${c.dim}  Errors (${failed.length})${c.reset}`);
    console.log(`  ${sep}`);
    for (const r of failed) {
      console.log(`  ${c.red}ERR${c.reset}  ${c.dim}${r.url}${c.reset}`);
      console.log(`       ${c.dim}${r.error}${c.reset}`);
    }
  }

  // Summary
  console.log();
  console.log(`${c.bold}${'═'.repeat(76)}${c.reset}`);
  console.log(`${c.bold}  Summary${c.reset}`);
  console.log(`  Average score:        ${c.bold}${avg}${c.reset}`);
  console.log(`  ${c.green}Good (≥90):${c.reset}           ${good} page${good !== 1 ? 's' : ''}`);
  console.log(`  ${c.yellow}Needs Improvement:${c.reset}    ${needsWork} page${needsWork !== 1 ? 's' : ''}`);
  console.log(`  ${c.red}Poor (<50):${c.reset}           ${poor} page${poor !== 1 ? 's' : ''}`);
  if (failed.length > 0) {
    console.log(`  ${c.dim}Errors:               ${failed.length}${c.reset}`);
  }
  console.log(`${c.bold}${'═'.repeat(76)}${c.reset}`);
  console.log();
}

// ─── History report ────────────────────────────────────────────────────────

function printHistoryReport(historyPath, strategyFilter) {
  const history = loadHistory(historyPath);
  const keys = Object.keys(history);

  if (keys.length === 0) {
    console.log(`\n${c.dim}No history found at ${historyPath}${c.reset}`);
    console.log(`Run web-vitals on some URLs first.\n`);
    return;
  }

  // Parse "strategy:url" keys
  const entries = keys.map(key => {
    const sep = key.indexOf(':');
    return { strategy: key.slice(0, sep), url: key.slice(sep + 1), runs: history[key] };
  });

  const strategies = [...new Set(entries.map(e => e.strategy))].sort();
  const visible = strategyFilter ? strategies.filter(s => s === strategyFilter) : strategies;

  if (visible.length === 0) {
    console.log(`\n${c.yellow}No history for strategy "${strategyFilter}".${c.reset}\n`);
    return;
  }

  const totalUrls = new Set(entries.map(e => e.url)).size;
  const allTs = entries.flatMap(e => e.runs.map(r => r.ts));
  const since = allTs.reduce((a, b) => (a < b ? a : b), allTs[0]).slice(0, 10);

  const SEP = '─'.repeat(76);
  const URL_WIDTH = 44;

  console.log();
  console.log(`${c.bold}${'═'.repeat(76)}${c.reset}`);
  console.log(`${c.bold}  History Report  ·  ${totalUrls} URL${totalUrls !== 1 ? 's' : ''}  ·  since ${since}${c.reset}`);
  console.log(`${c.bold}${'═'.repeat(76)}${c.reset}`);

  for (const strategy of visible) {
    const pages = entries
      .filter(e => e.strategy === strategy)
      .sort((a, b) => (b.runs.at(-1)?.score ?? 0) - (a.runs.at(-1)?.score ?? 0));

    console.log();
    console.log(`${c.bold}  ${strategy}  ·  ${pages.length} URL${pages.length !== 1 ? 's' : ''}${c.reset}`);
    console.log(`  ${c.dim}${'Score'.padEnd(7)}${'Δ'.padEnd(6)}${'Trend (last 10)'.padEnd(14)}${'Runs'.padEnd(6)}URL${c.reset}`);
    console.log(`  ${SEP}`);

    for (const { url, runs } of pages) {
      const latest = runs.at(-1);
      const prev   = runs.length > 1 ? runs.at(-2) : null;
      const score  = scoreTag(latest.score);
      const delta  = formatDelta(latest.score, prev?.score ?? null);
      const spark  = sparkline(runs.slice(-10).map(r => r.score));
      const count  = String(runs.length).padEnd(5);
      const urlStr = c.dim + truncate(url, URL_WIDTH) + c.reset;
      console.log(`  ${score}  ${delta} ${spark}  ${count} ${urlStr}`);
    }
  }

  console.log();
  console.log(`${c.bold}${'═'.repeat(76)}${c.reset}`);
  console.log(`  ${c.dim}File: ${historyPath}${c.reset}`);
  console.log(`${c.bold}${'═'.repeat(76)}${c.reset}`);
  console.log();
}

// ─── Help ──────────────────────────────────────────────────────────────────

function printHelp() {
  console.log(`
Usage:
  web-vitals <url>             Analyse a single page
  web-vitals <sitemap-url>     Analyse all pages in a sitemap
  web-vitals history           Show a CLI report of all tracked URLs
  web-vitals serve             Start the local web dashboard

Options:
  --desktop           Simulate a desktop device (default)
  --mobile            Simulate a mobile device
  --limit <n>         Max pages to check from sitemap (default: 50)
  --top <n>           Pages to highlight in Top Performers (default: 10)
  --concurrency <n>   Parallel PSI requests (default: 3)
  --key <api-key>     Google API key (or set PSI_API_KEY env var)
  --history <path>    History file path (default: ~/.web-vitals-history.json)
  --no-save           Don't save results to history
  --help, -h          Show this help message

Dashboard subcommand:
  web-vitals serve                  Start the dashboard on http://localhost:3000
  web-vitals serve --port 8080      Use a custom port
  web-vitals serve --history <path> Use a custom history file

  The dashboard reads the history file on each request so it stays live
  as new scans complete in another terminal. Auto-refreshes every 60s.

History subcommand:
  web-vitals history              Show all tracked URLs (mobile + desktop)
  web-vitals history --mobile     Show mobile results only
  web-vitals history --desktop    Show desktop results only
  web-vitals history --history <path>   Use a custom history file

  Results are saved to ~/.web-vitals-history.json after each run.
  Re-running a URL shows score deltas. Up to ${MAX_ENTRIES_PER_URL} entries per URL per strategy.

API Key:
  Get a free key at https://developers.google.com/speed/docs/insights/v5/get-started
  With a key you get 25,000 free requests/day.

Examples:
  web-vitals https://example.com
  web-vitals https://example.com/sitemap.xml --limit 100 --desktop
  PSI_API_KEY=your-key web-vitals https://example.com/sitemap.xml
  web-vitals history
  web-vitals history --desktop
`);
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    printHelp();
    process.exit(0);
  }

  const historyIdx = args.indexOf('--history');
  const historyPath = historyIdx !== -1 ? args[historyIdx + 1] : DEFAULT_HISTORY_PATH;

  // ── Serve subcommand ──────────────────────────────────────────────────────
  if (args[0] === 'serve') {
    const portIdx = args.indexOf('--port');
    const port = portIdx !== -1 ? parseInt(args[portIdx + 1], 10) : 3000;
    startServer({ historyPath, port });
    return;
  }

  // ── History subcommand ────────────────────────────────────────────────────
  if (args[0] === 'history') {
    const strategyFilter = args.includes('--desktop') ? 'desktop' : args.includes('--mobile') ? 'mobile' : null;
    printHistoryReport(historyPath, strategyFilter);
    return;
  }

  const url = args.find(a => !a.startsWith('-'));
  const strategy = args.includes('--mobile') ? 'mobile' : 'desktop';
  const keyIdx = args.indexOf('--key');
  const apiKey = keyIdx !== -1 ? args[keyIdx + 1] : process.env.PSI_API_KEY;
  const limitIdx = args.indexOf('--limit');
  const limit = limitIdx !== -1 ? parseInt(args[limitIdx + 1], 10) : 50;
  const topIdx = args.indexOf('--top');
  const topN = topIdx !== -1 ? parseInt(args[topIdx + 1], 10) : 10;
  const concurrencyIdx = args.indexOf('--concurrency');
  const concurrency = concurrencyIdx !== -1 ? parseInt(args[concurrencyIdx + 1], 10) : 3;
  const noSave = args.includes('--no-save');

  if (!url) {
    console.error(`${c.red}Error:${c.reset} A URL is required.`);
    process.exit(1);
  }

  const history = loadHistory(historyPath);
  const ts = new Date().toISOString();

  // ── Sitemap mode ──────────────────────────────────────────────────────────
  if (isSitemapUrl(url)) {
    console.log(`\n${c.bold}Sitemap:${c.reset} ${url}`);
    console.log(`${c.dim}Strategy: ${strategy}${apiKey ? '' : ' · no API key, using shared quota'}${c.reset}`);

    let urls;
    try {
      process.stdout.write('Fetching sitemap…');
      urls = await resolveSitemapUrls(url);
      process.stdout.write(`\r${c.dim}Found ${urls.length} URL${urls.length !== 1 ? 's' : ''}${c.reset}          \n`);
    } catch (err) {
      console.error(`\n${c.red}Error reading sitemap:${c.reset} ${err.message}`);
      process.exit(1);
    }

    if (urls.length === 0) {
      console.error(`${c.red}Error:${c.reset} No URLs found in sitemap.`);
      process.exit(1);
    }

    const capped = urls.slice(0, limit);
    if (capped.length < urls.length) {
      console.log(`${c.yellow}Checking first ${capped.length} of ${urls.length} URLs (--limit to change)${c.reset}`);
    }
    console.log();

    const total = capped.length;
    const padWidth = String(total).length;

    const results = await pool(capped, concurrency, async (pageUrl, idx) => {
      const num = `[${String(idx + 1).padStart(padWidth)}/${total}]`;
      process.stdout.write(`${c.dim}${num}${c.reset} ${truncate(pageUrl, 60)}\n`);
      try {
        return await analyzeUrl(pageUrl, strategy, apiKey);
      } catch (err) {
        return { url: pageUrl, score: null, error: err.message };
      }
    });

    // Save before printing so single-URL history section works if called later
    if (!noSave) {
      for (const r of results) recordEntry(history, r, strategy, ts);
      saveHistory(historyPath, history);
    }

    printReport(results, strategy, Math.min(topN, results.filter(r => r.score !== null).length), history);

    if (!noSave) {
      console.log(`${c.dim}History saved → ${historyPath}${c.reset}\n`);
    }
    return;
  }

  // ── Single URL mode ───────────────────────────────────────────────────────
  console.log(`\n${c.bold}Analysing:${c.reset} ${url}`);
  console.log(`${c.dim}Strategy: ${strategy}${apiKey ? '' : ' · no API key, using shared quota'} — fetching from PageSpeed Insights…${c.reset}\n`);

  try {
    const result = await analyzeUrl(url, strategy, apiKey);

    if (!noSave) {
      recordEntry(history, result, strategy, ts);
      saveHistory(historyPath, history);
    }

    printSingle(result, history, strategy);

    if (!noSave) {
      console.log(`${c.dim}History saved → ${historyPath}${c.reset}\n`);
    }
  } catch (err) {
    console.error(`${c.red}Error:${c.reset} ${err.message}`);
    process.exit(1);
  }
}

main();
