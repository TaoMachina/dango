import { accessSync, constants, existsSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { delimiter, dirname, isAbsolute, join } from 'node:path';

export interface Launch {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export interface CatalogEntry {
  id: string;
  runtimeLabel: string;
  // Binary names whose presence on PATH means the agent is installed. Absolute paths are checked directly.
  detect: string[];
  // How to start the agent as an ACP server over stdio. Resolved when the agent starts.
  launch: () => Launch;
}

const require = createRequire(import.meta.url);

// The Claude Code and Codex adapters are pinned dependencies of Agentry; run their entry scripts with this Node.
function adapter(pkg: string): Launch {
  return { command: process.execPath, args: [join(dirname(require.resolve(`${pkg}/package.json`)), 'dist', 'index.js')] };
}

// npx's own script, run with this Node, avoids the npx.cmd shim on Windows.
function npx(pkg: string): Launch {
  const cli = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npx-cli.js');
  return existsSync(cli) ? { command: process.execPath, args: [cli, '-y', pkg] } : { command: 'npx', args: ['-y', pkg] };
}

// On Windows the Claude Code SDK needs Git Bash. Git for Windows keeps it at <git root>\bin\bash.exe.
function gitBashEnv(): Record<string, string> {
  if (process.platform !== 'win32' || process.env.CLAUDE_CODE_GIT_BASH_PATH) return {};
  const git = findOnPath('git');
  for (let dir = git && dirname(git); dir && dirname(dir) !== dir; dir = dirname(dir)) {
    const bash = join(dir, 'bin', 'bash.exe');
    if (existsSync(bash)) return { CLAUDE_CODE_GIT_BASH_PATH: bash };
  }
  return {};
}

const bin = (command: string, ...args: string[]) => () => ({ command, args });

export const builtInCatalog: CatalogEntry[] = [
  { id: 'claude-code', runtimeLabel: 'Claude Code', detect: ['claude'], launch: () => ({ ...adapter('@agentclientprotocol/claude-agent-acp'), env: gitBashEnv() }) },
  { id: 'codex', runtimeLabel: 'Codex', detect: ['codex'], launch: () => adapter('@agentclientprotocol/codex-acp') },
  // Antigravity CLI replaced Gemini CLI on 2026-06-18; 'agy acp' is its ACP server (release 1.5.0).
  { id: 'antigravity', runtimeLabel: 'Antigravity', detect: ['agy'], launch: bin('agy', 'acp') },
  { id: 'opencode', runtimeLabel: 'OpenCode', detect: ['opencode'], launch: bin('opencode', 'acp') },
  { id: 'goose', runtimeLabel: 'Goose', detect: ['goose'], launch: bin('goose', 'acp') },
  { id: 'openclaw', runtimeLabel: 'OpenClaw', detect: ['openclaw'], launch: bin('openclaw', 'acp') },
  { id: 'hermes', runtimeLabel: 'Hermes', detect: ['hermes'], launch: bin('hermes', 'acp') },
  { id: 'qwen', runtimeLabel: 'Qwen Code', detect: ['qwen'], launch: bin('qwen', '--experimental-acp') },
  { id: 'pi', runtimeLabel: 'Pi', detect: ['pi'], launch: () => npx('pi-acp@0.0.34') },
];

// Windows runs a bare name through PATHEXT; npm installs CLIs as .cmd and .ps1 shims.
function candidates(name: string): string[] {
  if (process.platform !== 'win32') return [name];
  const exts = (process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean).map(e => e.toLowerCase());
  return [...exts, '.ps1'].map(ext => name + ext);
}

function isExecutable(file: string): boolean {
  if (!existsSync(file) || !statSync(file).isFile()) return false;
  if (process.platform === 'win32') return true;
  try {
    accessSync(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function findOnPath(name: string): string | null {
  if (isAbsolute(name)) return isExecutable(name) ? name : null;
  for (const dir of (process.env.PATH ?? '').split(delimiter).filter(Boolean)) {
    for (const file of candidates(name)) {
      const full = join(dir, file);
      if (isExecutable(full)) return full;
    }
  }
  return null;
}

export function isInstalled(entry: CatalogEntry): boolean {
  return entry.detect.some(name => findOnPath(name) !== null);
}

// Turns a launch into something spawn can start without a shell where possible.
// Windows cannot spawn .cmd files directly, and a shell in between hides the real process from kill.
// npm's .cmd shims name the script or executable they run, so Agentry runs that target itself.
export function resolveLaunch(launch: Launch): Launch & { shell: boolean } {
  const resolved = findOnPath(launch.command) ?? launch.command;
  if (process.platform !== 'win32' || /\.(exe|com)$/i.test(resolved)) return { ...launch, command: resolved, shell: false };
  if (/\.cmd$/i.test(resolved)) {
    // The shim checks for a bundled node.exe first; the file it runs is the last path it names.
    const target = [...readFileSync(resolved, 'utf8').matchAll(/"%dp0%\\([^"]+\.(js|mjs|cjs|exe))"/gi)].at(-1);
    if (target) {
      const file = join(dirname(resolved), target[1]);
      return target[2].toLowerCase() === 'exe'
        ? { ...launch, command: file, shell: false }
        : { ...launch, command: process.execPath, args: [file, ...launch.args], shell: false };
    }
  }
  // Other scripts (.bat, hand-written .cmd) need cmd.exe; the process tree is killed with taskkill.
  return { ...launch, command: resolved.includes(' ') ? `"${resolved}"` : resolved, shell: true };
}
