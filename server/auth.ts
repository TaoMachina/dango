import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { IncomingMessage } from 'node:http';
import type { Store } from './store.ts';

export const SESSION_COOKIE = 'rea_session';

export function randomToken(): string {
  return randomBytes(32).toString('hex');
}

// Tokens are stored as hashes so a copied database cannot sign anyone in.
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function loadOrCreateKey(file: string): string {
  if (existsSync(file)) return readFileSync(file, 'utf8').trim();
  const key = randomToken();
  writeFileSync(file, key, { mode: 0o600 });
  return key;
}

export function bearer(req: IncomingMessage): string | null {
  const header = req.headers.authorization ?? '';
  return header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : null;
}

function cookie(req: IncomingMessage, name: string): string | null {
  for (const pair of (req.headers.cookie ?? '').split(';')) {
    const [k, ...v] = pair.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}

// Only loopback names are accepted, which stops DNS-rebinding pages from reaching the hub.
export function hostAllowed(host: string | undefined, port: number): boolean {
  return host === `127.0.0.1:${port}` || host === `localhost:${port}`;
}

export function originAllowed(origin: string | undefined, port: number): boolean {
  return origin === undefined || origin === `http://127.0.0.1:${port}` || origin === `http://localhost:${port}`;
}

export class Auth {
  private store: Store;
  private key: Buffer;
  // One-time sign-in codes live in memory, so a restart invalidates unused ones.
  private codes = new Set<string>();

  constructor(store: Store, key: string) {
    this.store = store;
    this.key = Buffer.from(key);
  }

  issueCode(presented: string | null): string | null {
    const given = Buffer.from(presented ?? '');
    if (given.length !== this.key.length || !timingSafeEqual(given, this.key)) return null;
    const code = randomToken();
    this.codes.add(code);
    return code;
  }

  // Exchanges a code for a new browser session token.
  redeemCode(code: string): string | null {
    if (!this.codes.delete(code)) return null;
    const session = randomToken();
    this.store.addBrowserSession(hashToken(session));
    return session;
  }

  signedIn(req: IncomingMessage): boolean {
    const session = cookie(req, SESSION_COOKIE);
    return session !== null && this.store.hasBrowserSession(hashToken(session));
  }
}
