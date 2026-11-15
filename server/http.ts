import type { IncomingMessage, ServerResponse } from 'node:http';
import type { z } from 'zod';
import { HttpError } from './projects.ts';

export interface Ctx<Caller = undefined> {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  params: Record<string, string>;
  body: unknown;
  caller: Caller;
}

type Handler<Caller> = (c: Ctx<Caller>) => unknown;

interface Route<Caller> { method: string; pattern: RegExp; keys: string[]; handler: Handler<Caller> }

export class Router<Caller = undefined> {
  private routes: Route<Caller>[] = [];

  on(method: string, path: string, handler: Handler<Caller>): this {
    const keys: string[] = [];
    const source = path.replace(/:(\w+)/g, (_, key: string) => {
      keys.push(key);
      return '([^/]+)';
    });
    this.routes.push({ method, pattern: new RegExp(`^${source}$`), keys, handler });
    return this;
  }

  match(method: string, pathname: string): { handler: Handler<Caller>; params: Record<string, string> } | null {
    for (const route of this.routes) {
      const m = route.method === method ? route.pattern.exec(pathname) : null;
      if (m) return { handler: route.handler, params: Object.fromEntries(route.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) };
    }
    return null;
  }
}

export function sendJson(res: ServerResponse, status: number, value: unknown) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(value));
}

export async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, 'The request body is not valid JSON.');
  }
}

export function parse<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) throw new HttpError(400, result.error.issues.map(i => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '));
  return result.data;
}

// Runs a matched route: parses the body, sends the handler's result as JSON, and reports errors as {error}.
export async function dispatch<Caller>(router: Router<Caller>, req: IncomingMessage, res: ServerResponse, url: URL, caller: Caller) {
  const route = router.match(req.method ?? 'GET', url.pathname);
  if (!route) return sendJson(res, 404, { error: `No route for ${req.method} ${url.pathname}.` });
  const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await readJson(req);
  const result = await route.handler({ req, res, url, params: route.params, body, caller });
  if (!res.headersSent) sendJson(res, 200, result ?? {});
}
