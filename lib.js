// Pure, side-effect-free utilities shared between index.js and server.js.
// All functions here are exported so they can be unit-tested directly.

export const MAX_ENTRIES_PER_URL = 50;

// ─── History ───────────────────────────────────────────────────────────────

export function historyKey(url, strategy) {
  return `${strategy}:${url}`;
}

export function getLastEntry(history, url, strategy) {
  const entries = history[historyKey(url, strategy)];
  return entries?.[entries.length - 1] ?? null;
}

export function recordEntry(history, result, strategy, ts) {
  if (result.score === null) return;
  const key = historyKey(result.url, strategy);
  if (!history[key]) history[key] = [];
  history[key].push({
    ts,
    score: result.score,
    lcp: result.lcp !== null ? Math.round(result.lcp) : null,
    cls: result.cls !== null ? parseFloat(result.cls.toFixed(3)) : null,
    tbt: result.tbt !== null ? Math.round(result.tbt) : null,
    fcp: result.fcp !== null ? Math.round(result.fcp) : null,
  });
  if (history[key].length > MAX_ENTRIES_PER_URL) {
    history[key] = history[key].slice(-MAX_ENTRIES_PER_URL);
  }
}

// ─── Sitemap ───────────────────────────────────────────────────────────────

export function extractLocs(xml) {
  return [...xml.matchAll(/<loc[^>]*>\s*([^<\s]+)\s*<\/loc>/gi)].map(m => m[1]);
}

export function isSitemapUrl(url) {
  const path = new URL(url).pathname.toLowerCase();
  return path.endsWith('.xml') || path.includes('sitemap');
}

// ─── Formatting ────────────────────────────────────────────────────────────

export function fmtMs(value) {
  if (value === null || value === undefined) return '—';
  if (value >= 1000) return `${(value / 1000).toFixed(1)}s`;
  return `${Math.round(value)}ms`;
}

export function truncate(str, max) {
  return str.length > max ? str.slice(0, max - 1) + '…' : str;
}

// ─── Dashboard data ────────────────────────────────────────────────────────

export function parseHistory(history) {
  const entries = Object.entries(history).map(([key, runs]) => {
    const sep = key.indexOf(':');
    return { strategy: key.slice(0, sep), url: key.slice(sep + 1), runs };
  });
  const byStrategy = {};
  for (const e of entries) {
    (byStrategy[e.strategy] ??= []).push(e);
  }
  for (const pages of Object.values(byStrategy)) {
    pages.sort((a, b) => (b.runs.at(-1)?.score ?? 0) - (a.runs.at(-1)?.score ?? 0));
  }
  return byStrategy;
}

export function globalStats(byStrategy) {
  const seen = new Map();
  for (const pages of Object.values(byStrategy)) {
    for (const { url, runs } of pages) {
      const s = runs.at(-1)?.score ?? 0;
      if (!seen.has(url) || seen.get(url) < s) seen.set(url, s);
    }
  }
  const scores = [...seen.values()];
  const total = seen.size;
  const avg = scores.length ? Math.round(scores.reduce((a, b) => a + b) / scores.length) : 0;
  return {
    total,
    avg,
    good:    scores.filter(s => s >= 90).length,
    caution: scores.filter(s => s >= 50 && s < 90).length,
    poor:    scores.filter(s => s < 50).length,
  };
}
