import { mkdtempSync, rmSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { HubEvent } from '../shared/types.ts';
import type { CatalogEntry } from '../server/agents/catalog.ts';
import { createHub, type Hub } from '../server/hub.ts';

const fakeAgent = fileURLToPath(new URL('./fixtures/fake-agent.ts', import.meta.url));

// Fake ACP agents: each runs test/fixtures/fake-agent.ts and mentions `target` when told to chain.
// sessionDelayMs holds session/new open, so a test can act while the session is starting.
// restore 'load-fails' makes the agent offer session/load instead of session/resume, and fail every load.
export function fakeEntry(id: string, name: string, target = '', sessionDelayMs = 0, restore: 'resume' | 'load-fails' = 'resume'): CatalogEntry {
  return { id, runtimeLabel: name, detect: [process.execPath], launch: () => ({ command: process.execPath, args: [fakeAgent, name, target, String(sessionDelayMs), restore] }) };
}

// Fake agents answer in milliseconds; 10 s only bounds a broken test.
const WAIT_MS = 10_000;

export async function waitFor<T>(check: () => T | undefined | null | false, what: string): Promise<T> {
  const deadline = Date.now() + WAIT_MS;
  for (;;) {
    const value = check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await new Promise(r => setTimeout(r, 20));
  }
}

export interface TestHub {
  hub: Hub;
  events: HubEvent[];
  api: <T = any>(method: string, path: string, body?: unknown) => Promise<T>;
  raw: (method: string, path: string, headers?: Record<string, string>, body?: unknown) => Promise<{ status: number; body: any; headers: Record<string, string | string[] | undefined> }>;
  cookie: string;
  close: () => Promise<void>;
}

// node:http lets a test send any Host or Origin header, which fetch does not.
export function rawRequest(port: number, method: string, path: string, headers: Record<string, string> = {}, body?: unknown) {
  return new Promise<{ status: number; body: any; headers: Record<string, string | string[] | undefined> }>((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, method, path, headers: { host: `127.0.0.1:${port}`, ...headers } }, res => {
      let text = '';
      res.on('data', c => (text += c));
      res.on('end', () => resolve({ status: res.statusCode!, body: text && res.headers['content-type']?.includes('json') ? JSON.parse(text) : text, headers: res.headers }));
    });
    req.on('error', reject);
    if (body !== undefined) req.write(JSON.stringify(body));
    req.end();
  });
}

export async function startTestHub(catalog: CatalogEntry[], options: { delegateWaitMs?: number } = {}): Promise<TestHub> {
  const home = mkdtempSync(join(tmpdir(), 'agentry-test-'));
  const hub = await createHub({ home, port: 0, catalog, userHome: home, webDist: null, ...options });
  const raw = (method: string, path: string, headers?: Record<string, string>, body?: unknown) => rawRequest(hub.port, method, path, headers, body);

  const { body: { code } } = await raw('POST', '/auth/code', { authorization: `Bearer ${hub.key}` });
  const signIn = await raw('GET', `/auth?code=${code}`);
  const cookie = String(signIn.headers['set-cookie']).split(';')[0];

  const api = async (method: string, path: string, body?: unknown) => {
    const response = await raw(method, path, { cookie, 'content-type': 'application/json' }, body);
    if (response.status !== 200) throw new Error(`${method} ${path} -> ${response.status} ${JSON.stringify(response.body)}`);
    return response.body;
  };

  const events: HubEvent[] = [];
  const stream = new AbortController();
  const response = await fetch(`${hub.url}/api/events`, { headers: { cookie }, signal: stream.signal });
  (async () => {
    const decoder = new TextDecoder();
    let buffer = '';
    for await (const chunk of response.body!) {
      buffer += decoder.decode(chunk, { stream: true });
      let end: number;
      while ((end = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (block.startsWith('data: ')) events.push(JSON.parse(block.slice(6)));
      }
    }
  })().catch(() => {});

  const close = async () => {
    stream.abort();
    await hub.close();
    rmSync(home, { recursive: true, force: true });
  };
  return { hub, events, api, raw, cookie, close };
}

// Text of the finished agent message produced by a run, read back through the API.
export async function finishedReply(t: TestHub, conversationId: string, agentId: string, index = 0) {
  return waitFor(() => {
    const done = t.events.filter(e => e.type === 'message.upsert' && e.message.conversationId === conversationId
      && e.message.author.type === 'agent' && e.message.author.agentId === agentId && e.message.status !== 'streaming');
    const event = done[index];
    return event && event.type === 'message.upsert' ? event.message : undefined;
  }, `reply ${index} from ${agentId}`);
}

export const textOf = (m: { parts: { type: string; text?: string }[] }) => m.parts.filter(p => p.type === 'text').map(p => p.text).join('');
