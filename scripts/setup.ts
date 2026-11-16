// Builds the web app and adds a Dango icon to the desktop and app menu, then opens Dango.
// Usage (after `npm install`): npm run setup
import { execFileSync, spawnSync } from 'node:child_process';
import { writeFileSync, readFileSync, mkdirSync, copyFileSync, chmodSync, symlinkSync, existsSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { hubPaths } from '../server/paths.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const node = process.execPath;
const launcher = join(root, 'scripts', 'launch.ts');
const paths = hubPaths();

const [major] = process.versions.node.split('.').map(Number);
if (major < 24) throw new Error(`Dango needs Node.js 24 or later. This is ${process.version}.`);

console.log('Building the web app…');
await build({ configFile: join(root, 'vite.config.ts'), logLevel: 'warn' });
mkdirSync(paths.dir, { recursive: true });

// After an update the running hub still has the old code, so stop it; the launcher below starts the new one.
if (existsSync(paths.hubJson)) {
  const { pid, port } = JSON.parse(readFileSync(paths.hubJson, 'utf8')) as { pid: number; port: number };
  // A killed hub leaves hub.json behind and its PID may be reused, so only stop a PID whose hub still answers.
  const answering = await fetch(`http://127.0.0.1:${port}/api/health`).then(r => r.ok, () => false);
  if (answering && isAlive(pid)) {
    console.log('Stopping the running Dango…');
    // The hub stops its agents on SIGTERM; Windows has no signals, so end the process tree there.
    if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
    else process.kill(pid, 'SIGTERM');
    // Check every 100 ms: a hub exits within a second, and this keeps the wait short without busy-looping.
    while (isAlive(pid)) await new Promise(r => setTimeout(r, 100));
  }
}

function isAlive(pid: number): boolean {
  // Signal 0 only checks that the process exists; ESRCH means it is gone.
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false;
    throw error;
  }
}

if (process.platform === 'win32') {
  // wscript runs the launcher without a console window.
  const vbs = join(paths.dir, 'Dango.vbs');
  writeFileSync(vbs, [
    'Set shell = CreateObject("WScript.Shell")',
    `shell.CurrentDirectory = "${root}"`,
    `shell.Run """${node}"" ""${launcher}""", 0, False`,
    '',
  ].join('\r\n'));
  const script = `
    $shell = New-Object -ComObject WScript.Shell
    $targets = @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'))
    foreach ($dir in $targets) {
      $link = $shell.CreateShortcut((Join-Path $dir 'Dango.lnk'))
      $link.TargetPath = Join-Path $env:WINDIR 'System32\\wscript.exe'
      $link.Arguments = '"${vbs}"'
      $link.WorkingDirectory = '${root}'
      $link.IconLocation = '${join(root, 'assets', 'dango.ico')},0'
      $link.Description = 'Chat with the agents on this computer'
      $link.Save()
    }`;
  execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { stdio: 'inherit' });
  console.log('Added Dango to the desktop and the Start menu.');
} else if (process.platform === 'darwin') {
  const app = join(homedir(), 'Applications', 'Dango.app');
  rmSync(app, { recursive: true, force: true });
  mkdirSync(join(app, 'Contents', 'MacOS'), { recursive: true });
  mkdirSync(join(app, 'Contents', 'Resources'), { recursive: true });
  writeFileSync(join(app, 'Contents', 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleName</key><string>Dango</string>
<key>CFBundleIdentifier</key><string>dev.dango.launcher</string>
<key>CFBundleExecutable</key><string>Dango</string>
<key>CFBundleIconFile</key><string>dango.icns</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>LSUIElement</key><true/>
</dict></plist>
`);
  const exe = join(app, 'Contents', 'MacOS', 'Dango');
  writeFileSync(exe, `#!/bin/sh\ncd "${root}"\nexec "${node}" "${launcher}"\n`);
  chmodSync(exe, 0o755);
  copyFileSync(join(root, 'assets', 'dango.icns'), join(app, 'Contents', 'Resources', 'dango.icns'));
  const desktopLink = join(homedir(), 'Desktop', 'Dango.app');
  if (!existsSync(desktopLink)) symlinkSync(app, desktopLink);
  console.log('Added Dango to ~/Applications and the desktop.');
} else {
  const entry = `[Desktop Entry]
Type=Application
Name=Dango
Comment=Chat with the agents on this computer
Exec="${node}" "${launcher}"
Path=${root}
Icon=${join(root, 'assets', 'icon-256.png')}
Terminal=false
Categories=Development;Chat;
`;
  const apps = join(homedir(), '.local', 'share', 'applications');
  mkdirSync(apps, { recursive: true });
  writeFileSync(join(apps, 'dango.desktop'), entry);
  const desktopDir = join(homedir(), 'Desktop');
  if (existsSync(desktopDir)) {
    const file = join(desktopDir, 'dango.desktop');
    writeFileSync(file, entry);
    chmodSync(file, 0o755);
    // GNOME requires a trusted flag before it runs a desktop launcher; other desktops ignore gio.
    spawnSync('gio', ['set', file, 'metadata::trusted', 'true'], { stdio: 'ignore' });
  }
  console.log('Added Dango to the app menu and the desktop.');
}

console.log('Opening Dango…');
await import('./launch.ts');
