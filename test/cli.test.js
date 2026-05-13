import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const CLI  = new URL('../index.js', import.meta.url).pathname;
const NODE = process.execPath;

function run(...args) {
  return spawnSync(NODE, [CLI, ...args], { encoding: 'utf8', timeout: 10_000 });
}

function tmpHistory(data = {}) {
  const path = join(tmpdir(), `wv-test-${Date.now()}.json`);
  writeFileSync(path, JSON.stringify(data));
  return { path, cleanup: () => rmSync(path, { force: true }) };
}

const FIXTURE = {
  'desktop:https://example.com/': [
    { ts: '2026-05-01T09:00:00.000Z', score: 80, lcp: 2800, cls: 0.12, tbt: 450, fcp: 1800 },
    { ts: '2026-05-13T09:00:00.000Z', score: 92, lcp: 1300, cls: 0.01, tbt: 140, fcp: 850  },
  ],
  'desktop:https://example.com/about': [
    { ts: '2026-05-13T09:10:00.000Z', score: 75, lcp: 2000, cls: 0.05, tbt: 300, fcp: 1200 },
  ],
  'mobile:https://example.com/': [
    { ts: '2026-05-13T09:00:00.000Z', score: 68, lcp: 3100, cls: 0.08, tbt: 620, fcp: 2100 },
  ],
};

// ─── --help ───────────────────────────────────────────────────────────────

describe('--help', () => {
  test('exits 0 and prints usage', () => {
    const { status, stdout } = run('--help');
    assert.equal(status, 0);
    assert.ok(stdout.includes('Usage:'));
    assert.ok(stdout.includes('web-vitals'));
  });

  test('no args also prints help', () => {
    const { status, stdout } = run();
    assert.equal(status, 0);
    assert.ok(stdout.includes('Usage:'));
  });
});

// ─── argument errors ──────────────────────────────────────────────────────

describe('argument errors', () => {
  test('exits 1 when no URL is given', () => {
    const { status, stderr } = run('--desktop');
    assert.equal(status, 1);
    assert.ok(stderr.includes('URL is required'));
  });
});

// ─── history subcommand ───────────────────────────────────────────────────

describe('history subcommand', () => {
  test('reports no-history message for an empty file', () => {
    const { path, cleanup } = tmpHistory({});
    const { status, stdout } = run('history', '--history', path);
    cleanup();
    assert.equal(status, 0);
    assert.ok(stdout.includes('No history found'));
  });

  test('reports no-history message when the file does not exist', () => {
    const path = join(tmpdir(), 'wv-nonexistent.json');
    const { status, stdout } = run('history', '--history', path);
    assert.equal(status, 0);
    assert.ok(stdout.includes('No history found'));
  });

  test('renders a table with fixture data', () => {
    const { path, cleanup } = tmpHistory(FIXTURE);
    const { status, stdout } = run('history', '--history', path);
    cleanup();
    assert.equal(status, 0);
    assert.ok(stdout.includes('https://example.com/'));
    assert.ok(stdout.includes('92'));
  });

  test('--desktop filters to desktop strategy only', () => {
    const { path, cleanup } = tmpHistory(FIXTURE);
    const { status, stdout } = run('history', '--desktop', '--history', path);
    cleanup();
    assert.equal(status, 0);
    assert.ok(stdout.includes('desktop'));
    assert.ok(!stdout.includes('mobile'));
  });

  test('--mobile filters to mobile strategy only', () => {
    const { path, cleanup } = tmpHistory(FIXTURE);
    const { status, stdout } = run('history', '--mobile', '--history', path);
    cleanup();
    assert.equal(status, 0);
    assert.ok(stdout.includes('mobile'));
    assert.ok(!stdout.includes('desktop'));
  });

  test('shows a delta for a URL with multiple runs', () => {
    const { path, cleanup } = tmpHistory(FIXTURE);
    const { stdout } = run('history', '--desktop', '--history', path);
    cleanup();
    // example.com/ went from 80 → 92, delta should show +12
    assert.ok(stdout.includes('+12'));
  });
});
