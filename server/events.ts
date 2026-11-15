import type { IncomingMessage, ServerResponse } from 'node:http';
import type { HubEvent } from '../shared/types.ts';

// Proxies and some browsers close a stream that stays silent; a comment every 15 s keeps it open.
const HEARTBEAT_MS = 15_000;

export class Events {
  private clients = new Set<ServerResponse>();

  emit(event: HubEvent) {
    const data = `data: ${JSON.stringify(event)}\n\n`;
    for (const res of this.clients) res.write(data);
  }

  attach(req: IncomingMessage, res: ServerResponse) {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    res.write(`data: ${JSON.stringify({ type: 'hello' } satisfies HubEvent)}\n\n`);
    this.clients.add(res);
    const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), HEARTBEAT_MS);
    req.on('close', () => {
      clearInterval(heartbeat);
      this.clients.delete(res);
    });
  }

  closeAll() {
    for (const res of this.clients) res.end();
    this.clients.clear();
  }
}
