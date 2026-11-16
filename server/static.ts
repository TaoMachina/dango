import { createReadStream, existsSync, statSync } from 'node:fs';
import type { ServerResponse } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

// Serves the built web app. Unknown paths get index.html so the app's own routes load directly.
export function serveStatic(root: string, pathname: string, res: ServerResponse) {
  const base = resolve(root);
  const requested = resolve(join(base, decodeURIComponent(pathname)));
  const inside = requested === base || requested.startsWith(base + sep);
  const file = inside && existsSync(requested) && statSync(requested).isFile() ? requested : join(base, 'index.html');
  if (!existsSync(file)) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('The web app is not built. Run `npm run build` in the Dango folder.');
    return;
  }
  // Vite writes content-hashed files to /assets/, so they never change; one year is the conventional maximum.
  const cache = file === requested && pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache';
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': cache });
  createReadStream(file).pipe(res);
}
