/**
 * Demo server — serves dist/ directories with brotli, zstd, and gzip compression.
 * Zero external dependencies; uses only Node.js built-ins.
 *
 * Usage: node server.js [dir port] ...
 *   Supports multiple [dir] [port] pairs for serving several demos at once.
 *   Defaults to demo-maalata/dist on port 4173 when no args are given.
 *
 * Examples:
 *   node server.js                                          → maalata:4173
 *   node server.js demo-canvas/dist 4174                    → canvas:4174
 *   node server.js demo-maalata/dist 4173 demo-canvas/dist 4174  → both
 */

import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { extname, join, resolve, normalize } from 'node:path';
import { pipeline } from 'node:stream/promises';
import {
  createBrotliCompress,
  createGzip,
  createZstdCompress,
  constants as zlibConstants,
} from 'node:zlib';

// ---------------------------------------------------------------------------
// Parse CLI args into [{ distDir, port }] configs
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const configs = [];

for (let i = 0; i < args.length; i += 2) {
  const dir = resolve(args[i]);
  const port = Number(args[i + 1]);
  if (!args[i + 1] || isNaN(port)) {
    console.error(`Usage: node server.js [dir port] ...\nMissing port for directory: ${args[i]}`);
    process.exit(1);
  }
  configs.push({ distDir: dir, port });
}

// Default: serve demo-maalata/dist on 4173
if (configs.length === 0) {
  configs.push({
    distDir: resolve(import.meta.dirname, '../demo-maalata/dist'),
    port: 4173,
  });
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.ico':  'image/x-icon',
  '.woff': 'font/woff',
  '.woff2':'font/woff2',
};

// Only compress text-based types
const COMPRESSIBLE = new Set(['.html', '.js', '.css', '.json', '.svg']);

function pickEncoding(acceptEncoding = '') {
  if (acceptEncoding.includes('zstd')) return 'zstd';
  if (acceptEncoding.includes('br'))   return 'br';
  if (acceptEncoding.includes('gzip')) return 'gzip';
  return null;
}

function makeCompressor(encoding) {
  switch (encoding) {
    case 'zstd': return createZstdCompress({
      params: { [zlibConstants.ZSTD_c_compressionLevel]: 3 },
    });
    case 'br': return createBrotliCompress({
      params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 4 },
    });
    case 'gzip': return createGzip({ level: 6 });
  }
}

function stat(p) {
  try { return statSync(p); } catch { return null; }
}

function createDemoServer(distDir) {
  return createServer(async (req, res) => {
    try {
      const urlPath = new URL(req.url, 'http://x').pathname;

      // Prevent directory traversal
      const safePath = normalize(urlPath).replace(/^(\.\.[/\\])+/, '');

      let filePath = join(distDir, safePath);
      let s = stat(filePath);

      if (s?.isDirectory()) {
        filePath = join(filePath, 'index.html');
        s = stat(filePath);
      }

      // SPA fallback
      if (!s) {
        filePath = join(distDir, 'index.html');
        s = stat(filePath);
        if (!s) { res.writeHead(404); res.end('Not Found'); return; }
      }

      const ext = extname(filePath);
      const mime = MIME[ext] ?? 'application/octet-stream';
      const isAsset = safePath.startsWith('/assets/');

      const headers = {
        'Content-Type':  mime,
        'Cache-Control': isAsset ? 'public, max-age=31536000, immutable' : 'no-cache',
      };

      const encoding = COMPRESSIBLE.has(ext)
        ? pickEncoding(req.headers['accept-encoding'])
        : null;

      if (encoding) {
        headers['Content-Encoding'] = encoding;
        headers['Vary'] = 'Accept-Encoding';
      }

      res.writeHead(200, headers);

      const src = createReadStream(filePath);
      if (encoding) {
        await pipeline(src, makeCompressor(encoding), res);
      } else {
        await pipeline(src, res);
      }
    } catch {
      if (!res.headersSent) { res.writeHead(500); res.end('Internal Server Error'); }
    }
  });
}

// ---------------------------------------------------------------------------
// Start all servers
// ---------------------------------------------------------------------------

for (const { distDir, port } of configs) {
  const server = createDemoServer(distDir);
  server.listen(port, () => console.log(`http://localhost:${port} → ${distDir}`));
}
