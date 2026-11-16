import { existsSync, mkdirSync, statSync } from 'node:fs';
import { basename, isAbsolute, join, resolve } from 'node:path';
import type { Project } from '../shared/types.ts';
import type { Events } from './events.ts';
import type { Store } from './store.ts';

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// Windows paths are case-insensitive, so D:\Work and d:\work are one folder.
const key = (path: string) => (process.platform === 'win32' ? path.toLowerCase() : path);

export function projectAt(store: Store, path: string): Project | null {
  return store.listProjects().find(p => key(p.path) === key(path)) ?? null;
}

function register(store: Store, events: Events, path: string, name: string): Project {
  if (projectAt(store, path)) throw new HttpError(409, `A project already uses ${path}.`);
  const project = store.insertProject({ name, path });
  events.emit({ type: 'project.upsert', project });
  return project;
}

function absolute(path: string): string {
  if (!isAbsolute(path)) throw new HttpError(400, 'Project path must be absolute.');
  return resolve(path);
}

// POST /api/projects {path}: a folder the person picked, which must already exist.
export function addFolder(store: Store, events: Events, path: string): Project {
  const full = absolute(path);
  if (!existsSync(full) || !statSync(full).isDirectory()) throw new HttpError(400, `${full} is not a folder.`);
  return register(store, events, full, basename(full) || full);
}

// POST /api/projects {name}: a new folder under ~/Dango/projects.
export function createNamed(store: Store, events: Events, dir: string, name: string): Project {
  const trimmed = name.trim();
  // "." would name the projects folder itself.
  if (!trimmed || trimmed === '.' || /[\/\\]/.test(trimmed) || trimmed.includes('..')) throw new HttpError(400, 'A project name cannot be "." or contain /, \\ or "..".');
  const full = join(dir, trimmed);
  if (projectAt(store, full)) throw new HttpError(409, `A project already uses ${full}.`);
  mkdirSync(full, { recursive: true });
  return register(store, events, full, trimmed);
}

// A Code thread started without a project gets its own new folder, named from its title.
export function newTaskFolder(store: Store, events: Events, dir: string, title: string): Project {
  // A short readable folder name: up to 40 characters keeps paths and the sidebar row tidy, cut at a whole word.
  // Letters and digits of any script stay, so a Chinese or Japanese title keeps a readable name.
  const full = title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '');
  const atWord = full.slice(0, 41).match(/^(.*)-[^-]*$/)?.[1];
  const slug = (full.length <= 40 ? full : atWord || full.slice(0, 40)) || 'task';
  let name = slug;
  for (let n = 2; projectAt(store, join(dir, name)) || existsSync(join(dir, name)); n++) name = `${slug}-${n}`;
  return createNamed(store, events, dir, name);
}

// dango_start_code_task: an absolute path becomes a project, creating the folder when missing.
export function folderProject(store: Store, events: Events, path: string): Project {
  const full = absolute(path);
  const existing = projectAt(store, full);
  if (existing) return existing;
  mkdirSync(full, { recursive: true });
  return register(store, events, full, basename(full) || full);
}
