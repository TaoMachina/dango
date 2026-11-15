// Builds and starts one hub: storage, agents, routing, routines and the HTTP server.
import { homedir } from 'node:os';
import { mkdirSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AcpHost } from './acp/host.ts';
import { builtInCatalog, type CatalogEntry } from './agents/catalog.ts';
import { rescan } from './agents/registry.ts';
import { apiRoutes } from './api.ts';
import { Auth, bearer, hostAllowed, loadOrCreateKey, originAllowed, SESSION_COOKIE } from './auth.ts';
import { openDb } from './db.ts';
import { Events } from './events.ts';
import { External, helloSchema, MAX_WAIT_SECONDS, postSchema, replySchema } from './external.ts';
import { UrlAgents } from './url-agent.ts';
import { dispatch, parse, Router, sendJson } from './http.ts';
import { codeTaskSchema, delegateSchema, messageToolSchema, readThreadSchema, routineToolSchema, ToolTokens, Tools, waitSchema } from './mcp/tools.ts';
import { defaultWorkDir, hubPaths, projectsDir } from './paths.ts';
import { HttpError } from './projects.ts';
import { Routines } from './routines.ts';
import { Runs } from './routing.ts';
import { serveStatic } from './static.ts';
import { Store } from './store.ts';

const serverDir = fileURLToPath(new URL('.', import.meta.url));

export interface HubOptions {
  home?: string;
  port: number;
  catalog?: CatalogEntry[];
  // The folder that holds Agentry/chat and Agentry/projects; tests pass a temporary one.
  userHome?: string;
  // null: serve only the API (development, where Vite serves the web app).
  webDist?: string | null;
  // How long agentry_delegate waits for a helper before answering 'running'; tests pass a short one. Default: DELEGATE_WAIT_MS.
  delegateWaitMs?: number;
  onShutdown?: () => void;
}

export async function createHub(options: HubOptions) {
  const paths = hubPaths(options.home);
  mkdirSync(paths.dir, { recursive: true });
  const key = loadOrCreateKey(paths.key);
  const db = openDb(paths.db);
  const catalog = options.catalog ?? builtInCatalog;
  const store = new Store(db, catalog);
  const webDist = options.webDist === undefined ? join(serverDir, '..', 'web', 'dist') : options.webDist;

  // No agent process survives a restart: installed agents start idle, external ones until they poll again.
  // A url agent runs elsewhere, so it keeps the status of its last call.
  store.failInterruptedWork();
  for (const agent of store.listAgents()) {
    if (agent.source === 'acp') store.updateAgent(agent.id, { status: 'available', statusDetail: null });
    if (agent.source === 'external') store.updateAgent(agent.id, { status: 'offline', statusDetail: null });
  }

  let port = options.port;
  const hubUrl = () => `http://127.0.0.1:${port}`;
  const events = new Events();
  const home = options.userHome ?? homedir();
  // Edits in the chat folder or Agentry's own data are scratch work, not a project.
  const runs = new Runs(store, events, home, [defaultWorkDir(home), paths.dir]);
  const tokens = new ToolTokens();
  const routines = new Routines(store, events, runs);
  const tools = new Tools(store, events, runs, routines, options.delegateWaitMs);
  const external = new External(store, events, runs, hubUrl);
  const acp = new AcpHost({
    store, events, runs, catalog, tools: tokens, workDir: defaultWorkDir(options.userHome), bridgePath: join(serverDir, 'mcp', 'bridge.ts'), hubUrl,
  });
  const urlAgents = new UrlAgents(store, events, runs);
  runs.executors = { acp, external, url: urlAgents };
  rescan(store, events, catalog);

  const auth = new Auth(store, key);
  let closing: Promise<void> | null = null;
  const close = () => {
    closing ??= (async () => {
      routines.stop();
      external.stop();
      runs.stopAll();
      await acp.stopAll();
      events.closeAll();
      await new Promise<void>(resolve => server.close(() => resolve()));
      db.close();
    })();
    return closing;
  };

  const api = apiRoutes({ store, events, runs, acp, external, urlAgents, routines, catalog, projectsDir: projectsDir(options.userHome), shutdown: options.onShutdown ?? (() => void close()) });

  type ToolCaller = { agentId: string; conversationId: string };
  const toolApi = new Router<ToolCaller>()
    .on('GET', '/tool-api/conversation', c => tools.conversation(c.caller))
    .on('GET', '/tool-api/projects', () => tools.projects())
    .on('POST', '/tool-api/code-task', c => tools.startCodeTask(c.caller, parse(codeTaskSchema, c.body)))
    .on('POST', '/tool-api/code-thread', c => tools.readCodeThread(parse(readThreadSchema, c.body)))
    .on('POST', '/tool-api/routines', c => tools.createRoutine(c.caller, parse(routineToolSchema, c.body)))
    .on('POST', '/tool-api/messages', c => tools.sendMessage(c.caller, parse(messageToolSchema, c.body)))
    .on('GET', '/tool-api/helpers', c => tools.listHelpers(c.caller))
    .on('POST', '/tool-api/delegate', c => tools.delegate(c.caller, parse(delegateSchema, c.body)))
    .on('POST', '/tool-api/wait-for-helper', c => tools.waitForHelper(c.caller, parse(waitSchema, c.body)));

  const agentApi = new Router<string>()
    .on('POST', '/agent-api/hello', c => external.hello(c.caller, parse(helloSchema, c.body)))
    .on('GET', '/agent-api/inbox', c => {
      const wait = Math.min(Math.max(Number(c.url.searchParams.get('wait') ?? 0) || 0, 0), MAX_WAIT_SECONDS);
      const left = new AbortController();
      c.res.on('close', () => left.abort());
      return external.inbox(c.caller, wait, left.signal);
    })
    .on('POST', '/agent-api/reply', c => external.reply(c.caller, parse(replySchema, c.body)))
    .on('POST', '/agent-api/messages', c => external.post(c.caller, parse(postSchema, c.body)));

  async function handle(req: IncomingMessage, res: ServerResponse) {
    if (!hostAllowed(req.headers.host, port)) return sendJson(res, 403, { error: 'Agentry only answers requests addressed to 127.0.0.1 or localhost.' });
    const url = new URL(req.url ?? '/', hubUrl());
    const path = url.pathname;
    const method = req.method ?? 'GET';

    if (path === '/api/health') return sendJson(res, 200, { ok: true });
    if (path === '/auth/code' && method === 'POST') {
      const code = auth.issueCode(bearer(req));
      return code ? sendJson(res, 200, { code }) : sendJson(res, 401, { error: 'Wrong key.' });
    }
    if (path === '/auth' && method === 'GET') {
      const session = auth.redeemCode(url.searchParams.get('code') ?? '');
      if (!session) return sendJson(res, 401, { error: 'This sign-in link was already used or has expired. Open Agentry from its icon again.' });
      // One year keeps the browser signed in across restarts; the session row stays revocable in the database.
      res.writeHead(302, { 'set-cookie': `${SESSION_COOKIE}=${session}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000`, location: '/' });
      return res.end();
    }
    if (path.startsWith('/api/')) {
      if (!auth.signedIn(req)) return sendJson(res, 401, { error: 'Not signed in. Open Agentry from its icon.' });
      if (method !== 'GET' && method !== 'HEAD' && !originAllowed(req.headers.origin, port)) return sendJson(res, 403, { error: 'Cross-origin request refused.' });
      return dispatch(api, req, res, url, undefined);
    }
    if (path.startsWith('/tool-api/')) {
      const caller = tokens.resolve(bearer(req) ?? '');
      if (!caller) return sendJson(res, 401, { error: 'Unknown tool token.' });
      return dispatch(toolApi, req, res, url, caller);
    }
    if (path.startsWith('/agent-api/')) {
      const agentId = external.authenticate(bearer(req));
      if (!agentId) return sendJson(res, 401, { error: 'Unknown agent token. Ask the person for a new invitation.' });
      return dispatch(agentApi, req, res, url, agentId);
    }
    if (webDist && (method === 'GET' || method === 'HEAD')) return serveStatic(webDist, path, res);
    sendJson(res, 404, { error: 'Not found.' });
  }

  const server = createServer((req, res) => {
    handle(req, res).catch(error => {
      const status = error instanceof HttpError ? error.status : 500;
      if (status === 500) console.error(error);
      if (!res.headersSent) sendJson(res, status, { error: error instanceof Error ? error.message : String(error) });
      else res.end();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, '127.0.0.1', () => resolve());
  });
  port = (server.address() as { port: number }).port;
  routines.arm();

  return { url: hubUrl(), port, key, paths, store, runs, tools, close };
}

export type Hub = Awaited<ReturnType<typeof createHub>>;
