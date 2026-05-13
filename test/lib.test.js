import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_ENTRIES_PER_URL,
  historyKey,
  getLastEntry,
  recordEntry,
  extractLocs,
  isSitemapUrl,
  fmtMs,
  truncate,
  parseHistory,
  globalStats,
} from '../lib.js';

// ─── historyKey ────────────────────────────────────────────────────────────

describe('historyKey', () => {
  test('combines strategy and url with colon separator', () => {
    assert.equal(historyKey('https://example.com/', 'desktop'), 'desktop:https://example.com/');
  });

  test('handles URLs that themselves contain colons', () => {
    const key = historyKey('https://example.com/path', 'mobile');
    assert.ok(key.startsWith('mobile:'));
    assert.ok(key.endsWith('https://example.com/path'));
  });
});

// ─── isSitemapUrl ──────────────────────────────────────────────────────────

describe('isSitemapUrl', () => {
  test('detects .xml extension', () => {
    assert.equal(isSitemapUrl('https://example.com/sitemap.xml'), true);
  });

  test('detects sitemap in path segment', () => {
    assert.equal(isSitemapUrl('https://example.com/sitemap/'), true);
  });

  test('detects sitemap in filename without .xml', () => {
    assert.equal(isSitemapUrl('https://example.com/news-sitemap'), true);
  });

  test('returns false for a regular page URL', () => {
    assert.equal(isSitemapUrl('https://example.com/'), false);
    assert.equal(isSitemapUrl('https://example.com/about'), false);
    assert.equal(isSitemapUrl('https://example.com/page.html'), false);
  });

  test('detection is case-insensitive', () => {
    assert.equal(isSitemapUrl('https://example.com/SITEMAP.XML'), true);
  });
});

// ─── extractLocs ──────────────────────────────────────────────────────────

describe('extractLocs', () => {
  test('extracts URLs from a standard urlset sitemap', () => {
    const xml = `<?xml version="1.0"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://example.com/</loc></url>
  <url><loc>https://example.com/about</loc></url>
</urlset>`;
    assert.deepEqual(extractLocs(xml), ['https://example.com/', 'https://example.com/about']);
  });

  test('extracts URLs from a sitemap index', () => {
    const xml = `<sitemapindex>
  <sitemap><loc>https://example.com/sitemap1.xml</loc></sitemap>
  <sitemap><loc>https://example.com/sitemap2.xml</loc></sitemap>
</sitemapindex>`;
    assert.deepEqual(extractLocs(xml), [
      'https://example.com/sitemap1.xml',
      'https://example.com/sitemap2.xml',
    ]);
  });

  test('trims whitespace around loc values', () => {
    const xml = '<url><loc>\n  https://example.com/\n</loc></url>';
    assert.deepEqual(extractLocs(xml), ['https://example.com/']);
  });

  test('returns empty array when no loc tags present', () => {
    assert.deepEqual(extractLocs('<urlset></urlset>'), []);
  });
});

// ─── fmtMs ────────────────────────────────────────────────────────────────

describe('fmtMs', () => {
  test('formats sub-second values as ms', () => {
    assert.equal(fmtMs(150), '150ms');
    assert.equal(fmtMs(999), '999ms');
  });

  test('rounds fractional milliseconds', () => {
    assert.equal(fmtMs(150.7), '151ms');
  });

  test('formats values >= 1000 as seconds with one decimal', () => {
    assert.equal(fmtMs(1000), '1.0s');
    assert.equal(fmtMs(2500), '2.5s');
    assert.equal(fmtMs(1234), '1.2s');
  });

  test('returns em-dash for null', () => {
    assert.equal(fmtMs(null), '—');
  });

  test('returns em-dash for undefined', () => {
    assert.equal(fmtMs(undefined), '—');
  });
});

// ─── truncate ─────────────────────────────────────────────────────────────

describe('truncate', () => {
  test('leaves strings shorter than max unchanged', () => {
    assert.equal(truncate('hello', 10), 'hello');
  });

  test('leaves strings exactly at max unchanged', () => {
    assert.equal(truncate('hello', 5), 'hello');
  });

  test('truncates and appends ellipsis', () => {
    const result = truncate('hello world', 8);
    assert.equal(result.length, 8);
    assert.ok(result.endsWith('…'));
  });

  test('truncated string content is the start of the original', () => {
    const result = truncate('abcdefghij', 6);
    assert.ok('abcdefghij'.startsWith(result.slice(0, -1)));
  });
});

// ─── recordEntry ──────────────────────────────────────────────────────────

describe('recordEntry', () => {
  test('adds an entry keyed by strategy:url', () => {
    const history = {};
    recordEntry(history, { url: 'https://example.com/', score: 90, lcp: 1200, cls: 0.05, tbt: 150, fcp: 800 }, 'desktop', '2026-05-13T10:00:00.000Z');
    assert.equal(history['desktop:https://example.com/'].length, 1);
    assert.equal(history['desktop:https://example.com/'][0].score, 90);
  });

  test('stores the timestamp', () => {
    const history = {};
    const ts = '2026-05-13T10:00:00.000Z';
    recordEntry(history, { url: 'https://example.com/', score: 85, lcp: 1000, cls: 0.01, tbt: 100, fcp: 700 }, 'desktop', ts);
    assert.equal(history['desktop:https://example.com/'][0].ts, ts);
  });

  test('rounds lcp, tbt, fcp to integers', () => {
    const history = {};
    recordEntry(history, { url: 'https://example.com/', score: 85, lcp: 1234.7, cls: 0.056789, tbt: 150.3, fcp: 800.9 }, 'desktop', '2026-05-13T00:00:00.000Z');
    const entry = history['desktop:https://example.com/'][0];
    assert.equal(entry.lcp, 1235);
    assert.equal(entry.tbt, 150);
    assert.equal(entry.fcp, 801);
  });

  test('rounds cls to 3 decimal places', () => {
    const history = {};
    recordEntry(history, { url: 'https://example.com/', score: 85, lcp: 1000, cls: 0.056789, tbt: 100, fcp: 700 }, 'desktop', '2026-05-13T00:00:00.000Z');
    assert.equal(history['desktop:https://example.com/'][0].cls, 0.057);
  });

  test('skips entries with null score', () => {
    const history = {};
    recordEntry(history, { url: 'https://example.com/', score: null }, 'desktop', '2026-05-13T00:00:00.000Z');
    assert.deepEqual(history, {});
  });

  test('accumulates multiple entries for the same URL', () => {
    const history = {};
    const url = 'https://example.com/';
    recordEntry(history, { url, score: 80, lcp: 1000, cls: 0.01, tbt: 100, fcp: 700 }, 'desktop', '2026-05-01T00:00:00.000Z');
    recordEntry(history, { url, score: 85, lcp: 900, cls: 0.01, tbt: 90, fcp: 650 }, 'desktop', '2026-05-02T00:00:00.000Z');
    assert.equal(history['desktop:' + url].length, 2);
  });

  test(`trims history to ${MAX_ENTRIES_PER_URL} entries`, () => {
    const history = {};
    const url = 'https://example.com/';
    for (let i = 0; i < MAX_ENTRIES_PER_URL + 10; i++) {
      recordEntry(history, { url, score: 80, lcp: 1000, cls: 0.01, tbt: 100, fcp: 700 }, 'desktop', `2026-05-01T${String(i).padStart(2, '0')}:00:00.000Z`);
    }
    assert.equal(history['desktop:' + url].length, MAX_ENTRIES_PER_URL);
  });

  test('retains the newest entries after trimming', () => {
    const history = {};
    const url = 'https://example.com/';
    for (let i = 0; i < MAX_ENTRIES_PER_URL + 5; i++) {
      recordEntry(history, { url, score: i, lcp: 1000, cls: 0.01, tbt: 100, fcp: 700 }, 'desktop', '2026-05-01T00:00:00.000Z');
    }
    const entries = history['desktop:' + url];
    assert.equal(entries[entries.length - 1].score, MAX_ENTRIES_PER_URL + 4);
  });
});

// ─── getLastEntry ─────────────────────────────────────────────────────────

describe('getLastEntry', () => {
  test('returns the most recent entry', () => {
    const history = {
      'desktop:https://example.com/': [
        { ts: '2026-05-01T00:00:00.000Z', score: 80 },
        { ts: '2026-05-13T00:00:00.000Z', score: 92 },
      ],
    };
    assert.equal(getLastEntry(history, 'https://example.com/', 'desktop').score, 92);
  });

  test('returns null for an unknown URL', () => {
    assert.equal(getLastEntry({}, 'https://example.com/', 'desktop'), null);
  });

  test('returns null for a known URL under a different strategy', () => {
    const history = { 'mobile:https://example.com/': [{ score: 75 }] };
    assert.equal(getLastEntry(history, 'https://example.com/', 'desktop'), null);
  });
});

// ─── parseHistory ─────────────────────────────────────────────────────────

describe('parseHistory', () => {
  test('groups entries by strategy', () => {
    const history = {
      'desktop:https://example.com/': [{ ts: '2026-05-13T00:00:00.000Z', score: 90 }],
      'mobile:https://example.com/':  [{ ts: '2026-05-13T00:00:00.000Z', score: 75 }],
    };
    const result = parseHistory(history);
    assert.ok(result.desktop);
    assert.ok(result.mobile);
    assert.equal(result.desktop[0].url, 'https://example.com/');
    assert.equal(result.mobile[0].url, 'https://example.com/');
  });

  test('sorts pages within each strategy by latest score descending', () => {
    const history = {
      'desktop:https://example.com/low':  [{ ts: '2026-05-13T00:00:00.000Z', score: 55 }],
      'desktop:https://example.com/high': [{ ts: '2026-05-13T00:00:00.000Z', score: 95 }],
      'desktop:https://example.com/mid':  [{ ts: '2026-05-13T00:00:00.000Z', score: 75 }],
    };
    const pages = parseHistory(history).desktop;
    assert.equal(pages[0].url, 'https://example.com/high');
    assert.equal(pages[1].url, 'https://example.com/mid');
    assert.equal(pages[2].url, 'https://example.com/low');
  });

  test('returns an empty object for empty history', () => {
    assert.deepEqual(parseHistory({}), {});
  });
});

// ─── globalStats ──────────────────────────────────────────────────────────

describe('globalStats', () => {
  test('counts totals correctly', () => {
    const byStrategy = {
      desktop: [
        { url: 'https://example.com/',        runs: [{ score: 92 }] },
        { url: 'https://example.com/about',   runs: [{ score: 75 }] },
        { url: 'https://example.com/contact', runs: [{ score: 40 }] },
      ],
    };
    const stats = globalStats(byStrategy);
    assert.equal(stats.total, 3);
    assert.equal(stats.good, 1);
    assert.equal(stats.caution, 1);
    assert.equal(stats.poor, 1);
  });

  test('computes the average score', () => {
    const byStrategy = {
      desktop: [
        { url: 'https://example.com/a', runs: [{ score: 90 }] },
        { url: 'https://example.com/b', runs: [{ score: 70 }] },
      ],
    };
    assert.equal(globalStats(byStrategy).avg, 80);
  });

  test('deduplicates URLs across strategies keeping the highest score', () => {
    const byStrategy = {
      desktop: [{ url: 'https://example.com/', runs: [{ score: 95 }] }],
      mobile:  [{ url: 'https://example.com/', runs: [{ score: 70 }] }],
    };
    const stats = globalStats(byStrategy);
    assert.equal(stats.total, 1);
    assert.equal(stats.good, 1);  // 95 >= 90
  });

  test('returns zeros for empty input', () => {
    const stats = globalStats({});
    assert.equal(stats.total, 0);
    assert.equal(stats.avg, 0);
    assert.equal(stats.good, 0);
  });
});
