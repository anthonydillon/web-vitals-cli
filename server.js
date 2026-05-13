import { createServer } from 'http';
import { readFileSync } from 'fs';

const VANILLA_CSS = 'https://assets.ubuntu.com/v1/vanilla-framework-version-4.19.0.min.css';

// Canonical brand palette used by Vanilla Framework
const CLR = {
  good:    '#0e8420',
  caution: '#c98d00',
  poor:    '#c7162b',
  muted:   '#6c757d',
};

// ─── Data helpers ──────────────────────────────────────────────────────────

function loadHistory(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); }
  catch { return {}; }
}

function parseHistory(history) {
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

function globalStats(byStrategy) {
  const seen = new Map();
  for (const pages of Object.values(byStrategy)) {
    for (const { url, runs } of pages) {
      const s = runs.at(-1)?.score ?? 0;
      if (!seen.has(url) || seen.get(url) < s) seen.set(url, s);
    }
  }
  const scores = [...seen.values()];
  const total  = seen.size;
  const avg    = scores.length ? Math.round(scores.reduce((a, b) => a + b) / scores.length) : 0;
  return {
    total,
    avg,
    good:    scores.filter(s => s >= 90).length,
    caution: scores.filter(s => s >= 50 && s < 90).length,
    poor:    scores.filter(s => s < 50).length,
  };
}

// ─── HTML fragments ────────────────────────────────────────────────────────

function fmtMs(ms) {
  if (ms === null || ms === undefined) return '—';
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

function scoreLabel(score) {
  const cls = score >= 90 ? 'positive' : score >= 50 ? 'caution' : 'negative';
  return `<span class="p-label--${cls}">${score}</span>`;
}

function deltaHtml(current, prev) {
  if (prev == null) return `<span style="color:${CLR.muted}">new</span>`;
  const d = current - prev;
  if (d === 0) return `<span style="color:${CLR.muted}">—</span>`;
  const col  = d > 0 ? CLR.good : CLR.poor;
  const sign = d > 0 ? '+' : '';
  const arrow = d > 0 ? '&#9650;' : '&#9660;';
  return `<span style="color:${col}">${sign}${d}&nbsp;${arrow}</span>`;
}

function sparkHtml(scores) {
  const bars = '▁▂▃▄▅▆▇█';
  return scores.map(s => {
    const bar = bars[Math.min(7, Math.floor(s / 100 * 8))];
    const col = s >= 90 ? CLR.good : s >= 50 ? CLR.caution : CLR.poor;
    return `<span style="color:${col}">${bar}</span>`;
  }).join('');
}

function statCard(label, value, color, accent = false) {
  const numStyle = color ? ` style="color:${color}"` : '';
  return `
    <div class="col-2 col-medium-2 col-small-3">
      <hr class="p-rule--highlight${accent ? ' is-accent' : ''}">
      <h4 class="p-heading--4 u-no-margin--top"><strong${numStyle}>${value}</strong><br>
        ${label}
      </h4>
    </div>`;
}

function statsRow(stats) {
  return `
    <div class="row">
      <hr class="p-rule u-no-margin--bottom">
    </div>
    <div class="row">
      ${statCard('URLs tracked', stats.total, null, true)}
      ${statCard('Avg score',    stats.avg)}
      ${statCard('Good ≥90',     stats.good,    CLR.good)}
      ${statCard('Needs work',   stats.caution, CLR.caution)}
      ${statCard('Poor &lt;50',  stats.poor,    CLR.poor)}
    </div>`;
}

function tableRows(pages) {
  return pages.map(({ url, runs }) => {
    const latest = runs.at(-1);
    const prev   = runs.length > 1 ? runs.at(-2) : null;
    return `
      <tr>
        <td data-heading="Score">${scoreLabel(latest.score)}</td>
        <td data-heading="Change">${deltaHtml(latest.score, prev?.score ?? null)}</td>
        <td data-heading="Trend" style="font-family:monospace;font-size:1.1em;letter-spacing:2px;white-space:nowrap">${sparkHtml(runs.slice(-10).map(r => r.score))}</td>
        <td data-heading="LCP"   style="font-variant-numeric:tabular-nums;white-space:nowrap">${fmtMs(latest.lcp)}</td>
        <td data-heading="CLS"   style="font-variant-numeric:tabular-nums">${latest.cls != null ? latest.cls.toFixed(3) : '—'}</td>
        <td data-heading="TBT"   style="font-variant-numeric:tabular-nums;white-space:nowrap">${fmtMs(latest.tbt)}</td>
        <td data-heading="Runs">${runs.length}</td>
        <td data-heading="Last checked" style="white-space:nowrap">${latest.ts.slice(0, 10)}</td>
        <td data-heading="URL" style="word-break:break-all">
          <a href="${url}" target="_blank" rel="noreferrer">${url}</a>
        </td>
      </tr>`;
  }).join('');
}

function strategyTable(pages) {
  if (!pages?.length) return `<p style="color:${CLR.muted}">No data for this strategy yet.</p>`;
  return `
    <div style="overflow-x:auto">
      <table class="p-table" style="width:100%;min-width:720px">
        <thead>
          <tr>
            <th scope="col" style="width:72px">Score</th>
            <th scope="col" style="width:84px">Change</th>
            <th scope="col" style="width:120px">Trend</th>
            <th scope="col" style="width:70px">LCP</th>
            <th scope="col" style="width:60px">CLS</th>
            <th scope="col" style="width:70px">TBT</th>
            <th scope="col" style="width:52px">Runs</th>
            <th scope="col" style="width:110px">Last checked</th>
            <th scope="col">URL</th>
          </tr>
        </thead>
        <tbody>${tableRows(pages)}</tbody>
      </table>
    </div>`;
}

// ─── Full page render ──────────────────────────────────────────────────────

function renderDashboard(history, historyPath) {
  const byStrategy  = parseHistory(history);
  const stats       = globalStats(byStrategy);
  const strategies  = Object.keys(byStrategy).sort();
  const now         = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';

  const tabButtons = strategies.map((s, i) => `
    <li class="p-tabs__item" role="presentation">
      <button class="p-tabs__link${i === 0 ? ' is-active' : ''}"
        role="tab" aria-selected="${i === 0 ? 'true' : 'false'}"
        aria-controls="${s}-panel" id="${s}-tab">
        ${s.charAt(0).toUpperCase() + s.slice(1)}
      </button>
    </li>`).join('');

  const tabPanels = strategies.map((s, i) => `
    <div role="tabpanel" id="${s}-panel" aria-labelledby="${s}-tab" ${i !== 0 ? 'hidden' : ''}>
      ${strategyTable(byStrategy[s])}
    </div>`).join('');

  const emptyState = strategies.length === 0 ? `
    <div class="p-notification--information">
      <div class="p-notification__content">
        <h5 class="p-notification__title">No history yet</h5>
        <p class="p-notification__message">
          Run <code>web-vitals &lt;url&gt;</code> to start tracking pages.
        </p>
      </div>
    </div>` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Web Vitals Dashboard</title>
  <link rel="apple-touch-icon" sizes="180x180" href="https://assets.ubuntu.com/v1/f38b9c7e-COF%20apple-touch-icon.png">
  <link rel="icon" type="image/png" sizes="32x32" href="https://assets.ubuntu.com/v1/be7e4cc6-COF-favicon-32x32.png">
  <link rel="icon" type="image/png" sizes="16x16" href="https://assets.ubuntu.com/v1/16c27f81-COF%20favicon-16x16.png">
  <link rel="stylesheet" href="${VANILLA_CSS}">
  <style>
    .p-navigation__logo-icon { width: 1.5rem; height: 1.5rem; }
  </style>
</head>
<body>

<header class="p-navigation is-dark" id="navigation">
  <div class="p-navigation__row--25-75">
    <div class="p-navigation__banner">
      <div class="p-navigation__tagged-logo">
        <a class="p-navigation__link" href="/">
          <div class="p-navigation__logo-tag">
            <img class="p-navigation__logo-icon" src="https://assets.ubuntu.com/v1/82818827-CoF_white.svg" alt="">
          </div>
          <span class="p-navigation__logo-title">Web Vitals Dashboard</span>
        </a>
      </div>
    </div>
    <nav class="p-navigation__nav" aria-label="Main">
      <ul class="p-navigation__items">
        <li class="p-navigation__item">
          <span id="refresh-msg" class="p-navigation__link"
            style="cursor:default;font-size:.8125rem;opacity:.6">
            Updated: ${now}
          </span>
        </li>
        <li class="p-navigation__item">
          <a class="p-navigation__link" href="/" style="font-size:.8125rem">Refresh</a>
        </li>
      </ul>
    </nav>
  </div>
</header>

<section class="p-strip is-shallow">
  <div class="u-fixed-width">
    ${statsRow(stats)}
  </div>
</section>

<section class="p-strip u-no-padding--top">
  <div class="u-fixed-width">
    ${emptyState}
    ${strategies.length > 0 ? `
    <div class="p-tabs">
      <ul class="p-tabs__list" role="tablist">${tabButtons}</ul>
    </div>
    ${tabPanels}` : ''}

    <hr class="u-sv3">
    <p style="font-size:.8125rem;color:${CLR.muted}">
      History file: <code>${historyPath}</code>
      &nbsp;·&nbsp; Auto-refreshes every 60&nbsp;s
      &nbsp;·&nbsp; <span id="countdown">60</span>s until next refresh
    </p>
  </div>
</section>

<script>
  // Tab switching
  var tablist = document.querySelector('[role="tablist"]');
  if (tablist) {
    tablist.querySelectorAll('[role="tab"]').forEach(function (tab) {
      tab.addEventListener('click', function () {
        tablist.querySelectorAll('[role="tab"]').forEach(function (t) {
          t.setAttribute('aria-selected', 'false');
          t.classList.remove('is-active');
          var panel = document.getElementById(t.getAttribute('aria-controls'));
          if (panel) panel.hidden = true;
        });
        tab.setAttribute('aria-selected', 'true');
        tab.classList.add('is-active');
        var active = document.getElementById(tab.getAttribute('aria-controls'));
        if (active) active.hidden = false;
      });
    });
  }

  // Countdown + auto-refresh
  var seconds = 60;
  var countdownEl = document.getElementById('countdown');
  setInterval(function () {
    if (--seconds <= 0) { window.location.reload(); }
    if (countdownEl) countdownEl.textContent = seconds;
  }, 1000);
</script>
</body>
</html>`;
}

// ─── Server ────────────────────────────────────────────────────────────────

export function startServer({ historyPath, port }) {
  const server = createServer((req, res) => {
    if (req.url === '/api/history') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
      res.end(JSON.stringify(loadHistory(historyPath)));
      return;
    }
    const history = loadHistory(historyPath);
    const html    = renderDashboard(history, historyPath);
    res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-cache' });
    res.end(html);
  });

  server.listen(port, '127.0.0.1', () => {
    console.log(`\nDashboard → http://localhost:${port}`);
    console.log(`History   → ${historyPath}`);
    console.log('\nPress Ctrl+C to stop.\n');
  });

  server.on('error', err => {
    if (err.code === 'EADDRINUSE') {
      console.error(`Port ${port} is already in use. Try --port <n>`);
    } else {
      console.error('Server error:', err.message);
    }
    process.exit(1);
  });
}
