/**
 * verify-demo.js — End-to-end browser test via Playwright
 *
 * Tests the canvas-ultrafast demo.
 * Always builds the library + demo in development mode first (sourcemaps,
 * no mangling, console.* calls preserved), then serves and verifies.
 *
 * Usage: node scripts/verify-demo.js
 * Exit code 0 = clean, 1 = errors found or script failed.
 *
 * Requires: npm install (playwright in devDependencies), npx playwright install chromium
 */

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const SERVER_SCRIPT = resolve(import.meta.dirname, 'server.js');

// Button center coordinates matching demo src/main.ts layout:
//   buttons at x=20..170, y-ranges: 60-100 / 120-160 / 180-220
const BUTTONS = {
  drawStatic:     { x: 95, y: 80  },
  startAnimation: { x: 95, y: 140 },
  stopAnimation:  { x: 95, y: 200 },
};

// Visual verification: sample canvas pixels during animation
const VISUAL_SAMPLE_COUNT    = 10;  // number of snapshots to take
const VISUAL_SAMPLE_INTERVAL = 300; // ms between snapshots
// At least this fraction of samples must contain real animation content
const VISUAL_MIN_CONTENT_RATIO = 0.6;

const DEMO = {
  name: 'canvas',
  distDir: resolve(import.meta.dirname, '../demo/dist'),
  port: 4174,
  cpuThreshold: 15.0,
  settleMs: 1000,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * Sample the canvas pixel data via Playwright screenshot and return a color breakdown.
 */
async function sampleCanvasPixels(page) {
  const screenshotBuffer = await page.locator('#canvas').screenshot({ type: 'png' });
  const base64 = screenshotBuffer.toString('base64');

  /* eslint-disable no-undef -- entire callback runs inside Playwright browser context */
  return page.evaluate(async (b64) => {
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = `data:image/png;base64,${b64}`;
    });
    const tmp = document.createElement('canvas');
    tmp.width = img.width;
    tmp.height = img.height;
    const ctx = tmp.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const { data } = ctx.getImageData(0, 0, tmp.width, tmp.height);
    const total = tmp.width * tmp.height;
    let dark = 0, green = 0, magenta = 0, orange = 0, blue = 0;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      if (r < 30 && g < 30 && b < 50)                          dark++;
      else if (g > 100 && g > r * 1.5 && g > b * 1.5)          green++;
      else if (r > 100 && b > 100 && g < 80)                    magenta++;
      else if (r > 150 && g > 80 && b < 80)                     orange++;
      else if (b > 150 && r < 100 && g < 180)                   blue++;
    }
    return { total, dark, green, magenta, orange, blue };
  }, base64);
  /* eslint-enable no-undef */
}

function spawnServer(distDir, port) {
  const proc = spawn('node', [SERVER_SCRIPT, distDir, String(port)], { stdio: ['ignore', 'pipe', 'pipe'] });
  proc.stdout.on('data', d => process.stdout.write(`[server] ${d}`));
  proc.stderr.on('data', d => process.stderr.write(`[server] ${d}`));
  proc.on('error', err => process.stderr.write(`[server] spawn error: ${err.message}\n`));
  return proc;
}

async function waitForUrl(url, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (r.ok) return;
    } catch { /* not ready yet */ }
    await sleep(300);
  }
  throw new Error(`${url} did not respond within ${timeoutMs}ms`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const errors = [];
  let browser = null;
  let serverProc = null;
  const appUrl = `http://localhost:${DEMO.port}`;
  const tag = `[${DEMO.name}]`;

  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--use-gl=angle', '--use-angle=swiftshader'],
    });

    // Start server
    console.log(`${tag} Starting demo server on port ${DEMO.port}...`);
    serverProc = spawnServer(DEMO.distDir, DEMO.port);
    await waitForUrl(appUrl);
    console.log(`${tag} Server up at ${appUrl}\n`);

    const page = await browser.newPage();

    // Wire up error collectors
    page.on('pageerror', err => {
      const msg = `[JS Exception] ${err.message}`;
      errors.push(msg);
      console.error(`${tag} ${msg}`);
    });

    page.on('console', msg => {
      const type = msg.type();
      if (type === 'error' || type === 'warning') {
        const text = `[console.${type}] ${msg.text()}`;
        errors.push(text);
        console.warn(`${tag} ${text}`);
      }
    });

    page.on('requestfailed', req => {
      const url = req.url();
      if (url.startsWith('data:') || url.startsWith('chrome-extension:')) return;
      const reason = req.failure()?.errorText ?? 'unknown';
      const msg = `[requestfailed] ${url} — ${reason}`;
      errors.push(msg);
      console.error(`${tag} ${msg}`);
    });

    // Navigate and settle
    console.log(`${tag} Navigating to ${appUrl}...`);
    await page.goto(appUrl, { waitUntil: 'load' });
    await page.waitForTimeout(DEMO.settleMs);
    console.log(`${tag} Page settled after load\n`);

    const canvas = page.locator('#canvas');

    // Click "Draw Static"
    console.log(`${tag} Clicking "Draw Static"...`);
    await canvas.click({ position: BUTTONS.drawStatic });
    await page.waitForTimeout(500);

    // Click "Start Animation", sample frames visually
    console.log(`${tag} Clicking "Start Animation"...`);
    await canvas.click({ position: BUTTONS.startAnimation });
    await page.waitForTimeout(500);

    // Start CDP profiler
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.setSamplingInterval', { interval: 100 });
    await cdp.send('Profiler.start');

    console.log(`${tag} Sampling ${VISUAL_SAMPLE_COUNT} animation frames...`);
    const frameSamples = [];
    for (let i = 0; i < VISUAL_SAMPLE_COUNT; i++) {
      const sample = await sampleCanvasPixels(page);
      if (sample) frameSamples.push(sample);
      if (i < VISUAL_SAMPLE_COUNT - 1) await page.waitForTimeout(VISUAL_SAMPLE_INTERVAL);
    }

    // Analyse visual results
    const contentFrames = frameSamples.filter(s => {
      const nonDark = s.total - s.dark;
      return nonDark > s.total * 0.02;
    });
    const framesWithAnimation = frameSamples.filter(s => {
      return (s.green + s.magenta + s.orange) > 20;
    });

    console.log(`${tag} Visual results: ${contentFrames.length}/${frameSamples.length} frames have content, ` +
      `${framesWithAnimation.length}/${frameSamples.length} frames have animated elements`);
    for (let i = 0; i < frameSamples.length; i++) {
      const s = frameSamples[i];
      const pct = n => ((n / s.total) * 100).toFixed(1);
      console.log(`  frame ${i}: dark=${pct(s.dark)}% green=${pct(s.green)}% magenta=${pct(s.magenta)}% orange=${pct(s.orange)}% blue=${pct(s.blue)}%`);
    }

    if (contentFrames.length < frameSamples.length * VISUAL_MIN_CONTENT_RATIO) {
      const msg = `[visual] Flickering detected: only ${contentFrames.length}/${frameSamples.length} frames had visible content (>2% non-dark pixels)`;
      errors.push(msg);
      console.error(`${tag} ${msg}`);
    }
    if (framesWithAnimation.length < frameSamples.length * VISUAL_MIN_CONTENT_RATIO) {
      const msg = `[visual] Animation not rendering: only ${framesWithAnimation.length}/${frameSamples.length} frames contained animated elements (green/magenta/orange)`;
      errors.push(msg);
      console.error(`${tag} ${msg}`);
    }
    console.log(`${tag} Animation visual sampling complete`);

    // Stop CDP profiler
    const { profile } = await cdp.send('Profiler.stop');
    await cdp.send('Profiler.disable');
    await cdp.detach();

    const nodeMap = new Map(profile.nodes.map(n => [n.id, n]));
    let activeUs = 0;
    for (let i = 0; i < profile.samples.length; i++) {
      const node = nodeMap.get(profile.samples[i]);
      if (node?.callFrame?.functionName !== '(idle)') {
        activeUs += profile.timeDeltas[i];
      }
    }
    const wallUs = profile.endTime - profile.startTime;
    const cpuPct = (activeUs / wallUs) * 100;
    console.log(`${tag} CPU usage: ${cpuPct.toFixed(1)}% (threshold: ${DEMO.cpuThreshold}%)`);
    if (cpuPct > DEMO.cpuThreshold) {
      errors.push(`[perf] CPU usage ${cpuPct.toFixed(1)}% exceeds ${DEMO.cpuThreshold}% threshold`);
    }

    // Top 50 functions by self time
    const selfByNode = new Map();
    for (let i = 0; i < profile.samples.length; i++) {
      const nodeId = profile.samples[i];
      const delta = profile.timeDeltas[i];
      const prev = selfByNode.get(nodeId);
      if (prev) { prev.time += delta; prev.hits++; }
      else selfByNode.set(nodeId, { time: delta, hits: 1 });
    }

    const fnStats = new Map();
    for (const [nodeId, stats] of selfByNode) {
      const node = nodeMap.get(nodeId);
      if (!node) continue;
      const cf = node.callFrame;
      const file = cf.url ? cf.url.replace(/^.*\//, '') : '';
      const loc = file ? `${file}:${cf.lineNumber + 1}:${cf.columnNumber + 1}` : '';
      const name = cf.functionName || '(anonymous)';
      const key = loc ? `${name} (${loc})` : name;

      const prev = fnStats.get(key);
      if (prev) { prev.time += stats.time; prev.hits += stats.hits; }
      else fnStats.set(key, { time: stats.time, hits: stats.hits });
    }

    const sorted = [...fnStats.entries()]
      .sort((a, b) => b[1].time - a[1].time)
      .slice(0, 50);

    const wallMs = wallUs / 1000;
    console.log(`\n${tag} Top 50 functions by self time (wall ${wallMs.toFixed(0)}ms):`);
    console.log('  ' + 'Self ms'.padStart(10) + '  ' + '% wall'.padStart(7) + '  ' + 'Hits'.padStart(6) + '  Function');
    console.log('  ' + '─'.repeat(10) + '  ' + '─'.repeat(7) + '  ' + '─'.repeat(6) + '  ' + '─'.repeat(50));
    for (const [name, { time: us, hits }] of sorted) {
      const ms = (us / 1000).toFixed(1);
      const pct = ((us / wallUs) * 100).toFixed(1);
      console.log('  ' + ms.padStart(10) + '  ' + (pct + '%').padStart(7) + '  ' + String(hits).padStart(6) + '  ' + name);
    }

    // Click "Stop Animation"
    console.log(`${tag} Clicking "Stop Animation"...`);
    await canvas.click({ position: BUTTONS.stopAnimation });
    await page.waitForTimeout(500);

    await page.close();

  } finally {
    if (serverProc) { serverProc.kill('SIGTERM'); await sleep(300); }
    if (browser) await browser.close().catch(() => {});
  }

  // Final report
  console.log(`\n${'='.repeat(70)}`);
  if (errors.length === 0) {
    console.log('[verify] \u2713 Demo clean. No errors found.');
  } else {
    console.error(`[verify] \u2717 ${errors.length} error(s) found:`);
    for (const e of errors) console.error(`  \u2022 ${e}`);
  }

  process.exit(errors.length > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('[verify] Fatal error:', err);
  process.exit(1);
});
