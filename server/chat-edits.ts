// Agents sometimes edit files from a chat instead of starting a Code thread. Those files still belong to a project,
// so the hub finds the project folder, adds it to Code when it is new, and tells the person what changed.
import { existsSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, parse, resolve, sep } from 'node:path';
import type { Part } from '../shared/types.ts';

// ACP tool kinds that change files on disk.
const WRITE_KINDS = new Set(['edit', 'delete', 'move']);

// Windows paths are case-insensitive, so D:\Work and d:\work are one folder.
const key = (path: string) => (process.platform === 'win32' ? path.toLowerCase() : path);

export const isInside = (path: string, dir: string) => key(path) === key(dir) || key(path).startsWith(key(dir.endsWith(sep) ? dir : dir + sep));

/** Absolute paths of files that finished tool calls wrote, outside the given scratch folders. */
export function editedPaths(parts: Part[], ignore: string[]): string[] {
  const paths = new Map<string, string>();
  for (const part of parts) {
    if (part.type !== 'tool' || part.status === 'failed') continue;
    const diffs = part.content.flatMap(c => (c.type === 'diff' ? [c.path] : []));
    const files = diffs.length > 0 ? diffs : WRITE_KINDS.has(part.kind) ? part.locations : [];
    for (const file of files) {
      if (!isAbsolute(file)) continue;
      const full = resolve(file);
      if (!ignore.some(dir => isInside(full, dir))) paths.set(key(full), full);
    }
  }
  return [...paths.values()];
}

function gitRoot(dir: string): string | null {
  for (let d = dir; ; d = dirname(d)) {
    if (existsSync(join(d, '.git'))) return d;
    if (d === parse(d).root) return null;
  }
}

function commonDir(dirs: string[]): string {
  const split = dirs.map(d => d.split(sep).filter((s, i) => s !== '' || i === 0));
  const first = split[0];
  let n = 0;
  while (n < first.length && split.every(s => s[n] !== undefined && key(s[n]) === key(first[n]))) n++;
  const joined = first.slice(0, n).join(sep);
  return joined.endsWith(':') ? joined + sep : joined || sep;
}

/**
 * The project folder for the edited files: their git repository, else their common folder.
 * Null when that would be a drive root or the home folder (or above it): too broad to be one project.
 */
export function projectFolder(paths: string[], home: string): string | null {
  const dirs = paths.map(p => gitRoot(dirname(p)) ?? dirname(p));
  const folder = commonDir(dirs);
  if (folder === parse(folder).root || isInside(home, folder)) return null;
  return folder;
}

/** A one-line list of changed files; past five it counts the rest so the note stays one line. */
export function fileList(paths: string[]): string {
  const names = paths.map(p => basename(p));
  return names.length <= 5 ? names.join(', ') : `${names.slice(0, 5).join(', ')} and ${names.length - 5} more`;
}
