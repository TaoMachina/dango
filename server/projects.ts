import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import type { FsListResponse, Project } from '../shared/types.ts';
import type { Events } from './events.ts';
import type { Store } from './store.ts';

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function createProject(store: Store, events: Events, path: string, name?: string): Project {
  if (!isAbsolute(path)) throw new HttpError(400, 'Project path must be absolute.');
  const full = resolve(path);
  mkdirSync(full, { recursive: true });
  const project = store.insertProject({ name: name?.trim() || basename(full) || full, path: full });
  events.emit({ type: 'project.upsert', project });
  return project;
}

// Windows has one root per drive letter; listing the ones that exist lets the person pick any of them.
function driveRoots(): string[] {
  if (process.platform !== 'win32') return [];
  return [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].map(letter => `${letter}:\\`).filter(root => existsSync(root));
}

export function listFolders(path: string | null): FsListResponse {
  if (path === null) {
    const home = homedir();
    return { path: null, parent: null, entries: [{ name: basename(home) || home, path: home }, ...driveRoots().map(root => ({ name: root, path: root }))] };
  }
  if (!isAbsolute(path)) throw new HttpError(400, 'Path must be absolute.');
  const full = resolve(path);
  const entries = readdirSync(full, { withFileTypes: true })
    .filter(e => e.isDirectory() && !e.name.startsWith('.'))
    .map(e => ({ name: e.name, path: join(full, e.name) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const parent = dirname(full);
  return { path: full, parent: parent === full ? null : parent, entries };
}
