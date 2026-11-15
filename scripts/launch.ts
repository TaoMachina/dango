// Opens Agentry: starts the hub in the background if it is not running,
// then opens the default browser already signed in.
// The desktop icon runs this file.
import { spawn } from 'node:child_process';
import { openSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hubPaths, hubPort } from '../server/paths.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const paths = hubPaths();
const port = hubPort();
const origin = `http://127.0.0.1:${port}`;

async function running(): Promise<boolean> {
  // A refused connection means the hub is not running yet.
  return fetch(`${origin}/api/health`).then(r => r.ok, () => false);
}

function openBrowser(url: string) {
  const [command, args] =
    process.platform === 'win32' ? ['rundll32', ['url.dll,FileProtocolHandler', url]] :
    process.platform === 'darwin' ? ['open', [url]] :
    ['xdg-open', [url]];
  spawn(command, args, { stdio: 'ignore', detached: true, windowsHide: true }).unref();
}

async function startHub() {
  if (!existsSync(join(root, 'web', 'dist', 'index.html'))) {
    throw new Error('The web app is not built. Run `npm run setup` in the Agentry folder.');
  }
  mkdirSync(paths.dir, { recursive: true });
  const log = openSync(paths.log, 'a');
  const child = spawn(process.execPath, [join(root, 'server', 'index.ts')], {
    cwd: root,
    detached: true,
    windowsHide: true,
    stdio: ['ignore', log, log],
  });
  let exited: number | null = null;
  child.on('exit', code => { exited = code ?? 1; });
  // Poll at a short interval until the hub answers or its process ends.
  while (!(await running())) {
    if (exited !== null) throw new Error(`Agentry stopped while starting (exit ${exited}). See ${paths.log}`);
    await new Promise(r => setTimeout(r, 200));
  }
  child.unref();
}

if (!(await running())) await startHub();

// Exchange the local key for a one-time sign-in code so the key never enters browser history.
const key = readFileSync(paths.key, 'utf8').trim();
const response = await fetch(`${origin}/auth/code`, { method: 'POST', headers: { authorization: `Bearer ${key}` } });
if (!response.ok) throw new Error(`Agentry refused the local key (${response.status}). See ${paths.log}`);
const { code } = await response.json() as { code: string };
openBrowser(`${origin}/auth?code=${code}`);
