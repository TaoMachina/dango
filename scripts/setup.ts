// Builds the web app and adds an Agentry icon to the desktop and app menu, then opens Agentry.
// Usage (after `npm install`): npm run setup
import { execFileSync, spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync, copyFileSync, chmodSync, symlinkSync, existsSync, rmSync } from 'node:fs';
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
if (major < 24) throw new Error(`Agentry needs Node.js 24 or later. This is ${process.version}.`);

console.log('Building the web app…');
await build({ configFile: join(root, 'vite.config.ts'), logLevel: 'warn' });
mkdirSync(paths.dir, { recursive: true });

if (process.platform === 'win32') {
  // wscript runs the launcher without a console window.
  const vbs = join(paths.dir, 'Agentry.vbs');
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
      $link = $shell.CreateShortcut((Join-Path $dir 'Agentry.lnk'))
      $link.TargetPath = Join-Path $env:WINDIR 'System32\\wscript.exe'
      $link.Arguments = '"${vbs}"'
      $link.WorkingDirectory = '${root}'
      $link.IconLocation = '${join(root, 'assets', 'agentry.ico')},0'
      $link.Description = 'Chat with the agents on this computer'
      $link.Save()
    }`;
  execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { stdio: 'inherit' });
  console.log('Added Agentry to the desktop and the Start menu.');
} else if (process.platform === 'darwin') {
  const app = join(homedir(), 'Applications', 'Agentry.app');
  rmSync(app, { recursive: true, force: true });
  mkdirSync(join(app, 'Contents', 'MacOS'), { recursive: true });
  mkdirSync(join(app, 'Contents', 'Resources'), { recursive: true });
  writeFileSync(join(app, 'Contents', 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleName</key><string>Agentry</string>
<key>CFBundleIdentifier</key><string>dev.agentry.launcher</string>
<key>CFBundleExecutable</key><string>Agentry</string>
<key>CFBundleIconFile</key><string>agentry.icns</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>LSUIElement</key><true/>
</dict></plist>
`);
  const exe = join(app, 'Contents', 'MacOS', 'Agentry');
  writeFileSync(exe, `#!/bin/sh\ncd "${root}"\nexec "${node}" "${launcher}"\n`);
  chmodSync(exe, 0o755);
  copyFileSync(join(root, 'assets', 'agentry.icns'), join(app, 'Contents', 'Resources', 'agentry.icns'));
  const desktopLink = join(homedir(), 'Desktop', 'Agentry.app');
  if (!existsSync(desktopLink)) symlinkSync(app, desktopLink);
  console.log('Added Agentry to ~/Applications and the desktop.');
} else {
  const entry = `[Desktop Entry]
Type=Application
Name=Agentry
Comment=Chat with the agents on this computer
Exec="${node}" "${launcher}"
Path=${root}
Icon=${join(root, 'assets', 'icon-256.png')}
Terminal=false
Categories=Development;Chat;
`;
  const apps = join(homedir(), '.local', 'share', 'applications');
  mkdirSync(apps, { recursive: true });
  writeFileSync(join(apps, 'agentry.desktop'), entry);
  const desktopDir = join(homedir(), 'Desktop');
  if (existsSync(desktopDir)) {
    const file = join(desktopDir, 'agentry.desktop');
    writeFileSync(file, entry);
    chmodSync(file, 0o755);
    // GNOME requires a trusted flag before it runs a desktop launcher; other desktops ignore gio.
    spawnSync('gio', ['set', file, 'metadata::trusted', 'true'], { stdio: 'ignore' });
  }
  console.log('Added Agentry to the app menu and the desktop.');
}

console.log('Opening Agentry…');
await import('./launch.ts');
