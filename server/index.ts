// Starts the Dango hub. `--dev` serves only the API; Vite serves the web app.
import { rmSync, writeFileSync } from 'node:fs';
import { createHub } from './hub.ts';
import { hubPort } from './paths.ts';

const dev = process.argv.includes('--dev');

async function quit() {
  await hub.close();
  rmSync(hub.paths.hubJson, { force: true });
  process.exit(0);
}

const hub = await createHub({ port: hubPort(), webDist: dev ? null : undefined, onShutdown: () => void quit() });
writeFileSync(hub.paths.hubJson, JSON.stringify({ port: hub.port, pid: process.pid }));
console.log(`Dango hub listening on ${hub.url}${dev ? ' (API only)' : ''}`);
process.on('SIGINT', () => void quit());
process.on('SIGTERM', () => void quit());
