// Agents that cannot be launched over ACP join with a pasted instruction and talk to the hub over HTTP.
import { z } from 'zod';
import type { Agent, ID } from '../shared/types.ts';
import { createAgentWithChat } from './agents/registry.ts';
import { hashToken, randomToken } from './auth.ts';
import type { Events } from './events.ts';
import { HttpError } from './projects.ts';
import type { Executor, LiveRun, PromptLine, RunOutcome, Runs } from './routing.ts';
import type { Store } from './store.ts';

// 25 s keeps a long poll under common HTTP idle timeouts (often 30 s or more).
export const MAX_WAIT_SECONDS = 25;
// Two missed polls: an agent that waits 25 s per poll is late after about 60 s.
const OFFLINE_AFTER_MS = 60_000;
// Placeholder until the agent introduces itself through /agent-api/hello.
export const NEW_AGENT_NAME = 'New agent';

export const helloSchema = z.object({
  name: z.string().trim().min(1).optional(),
  runtime: z.string().trim().min(1).optional(),
  description: z.string().optional(),
  greeting: z.string().trim().min(1).optional(),
});
export const replySchema = z.object({ runId: z.string(), text: z.string() });
export const postSchema = z.object({ conversationId: z.string(), text: z.string().min(1) });

interface Waiting { live: LiveRun; resolve: (outcome: RunOutcome) => void }

export interface InboxItem { runId: ID; conversationId: ID; conversationTitle: string; messages: PromptLine[] }

export class External implements Executor {
  private store: Store;
  private events: Events;
  private runs: Runs;
  private hubUrl: () => string;
  private pickups = new Map<ID, Waiting[]>(); // by agent: queued turns not yet fetched
  private fetched = new Map<ID, Waiting>(); // by run: fetched turns awaiting a reply
  private pollers = new Map<ID, Set<() => void>>();
  private offlineTimers = new Map<ID, NodeJS.Timeout>();

  constructor(store: Store, events: Events, runs: Runs, hubUrl: () => string) {
    this.store = store;
    this.events = events;
    this.runs = runs;
    this.hubUrl = hubUrl;
  }

  // A fresh invitation. No agent exists until it calls the hub, so an unused copy leaves nothing behind.
  invite(): string {
    const token = randomToken();
    this.store.insertInvitation(hashToken(token));
    return this.text(token, null);
  }

  // Issues a new token for a joined agent (replacing the old one).
  instruction(agentId: ID): string {
    const agent = this.store.getAgent(agentId)!;
    const token = randomToken();
    this.store.replaceAgentToken(agentId, hashToken(token));
    return this.text(token, agent.name);
  }

  // Written as plain HTTP so any agent can follow it with whatever client it has (curl, PowerShell, fetch, ...).
  private text(token: string, name: string | null): string {
    const url = this.hubUrl();
    return [
      `You are invited to join Agentry${name ? ` as "${name}"` : ''}. Agentry is an app on this computer where a person chats with all of their AI agents in one place, alone or in groups.`,
      '',
      `Agentry hub: ${url} (reachable only from this computer)`,
      `Your token: ${token}`,
      'Send every request with the headers  Authorization: Bearer <token>  and  Content-Type: application/json',
      'Use any HTTP client. In Windows PowerShell use Invoke-RestMethod; its "curl" is a different command.',
      '',
      '1. Say hello once, using the name the person knows you by:',
      `   POST ${url}/agent-api/hello`,
      `   {"name": "${name ?? '<your name>'}", "runtime": "<your product>", "description": "<one line>", "greeting": "<one short line to the person>"}`,
      '',
      '2. Receive work. Keep this request running in a loop in the background, starting the next call as soon as one returns:',
      `   GET ${url}/agent-api/inbox?wait=${MAX_WAIT_SECONDS}`,
      `   It returns a list of items, or [] after ${MAX_WAIT_SECONDS} seconds. Each item is {"runId", "conversationId", "conversationTitle", "messages": [{"author", "text"}]}.`,
      '',
      '3. Answer each item once. This posts your reply and completes it:',
      `   POST ${url}/agent-api/reply`,
      '   {"runId": "<runId>", "text": "<your reply in Markdown>"}',
      '',
      '4. Post into a conversation without being asked:',
      `   POST ${url}/agent-api/messages`,
      '   {"conversationId": "<id>", "text": "<message>"}',
      '',
      `Agentry shows you as offline when no inbox request arrives for ${OFFLINE_AFTER_MS / 1000} seconds.`,
      'If you cannot keep a background loop running, still say hello, and say in your greeting that you only check Agentry when the person asks you to.',
    ].join('\n');
  }

  // A known token names its agent; an unused invitation creates the agent on its first call.
  authenticate(token: string | null): ID | null {
    if (!token) return null;
    const hash = hashToken(token);
    const known = this.store.agentForToken(hash);
    if (known || !this.store.takeInvitation(hash)) return known;
    const agent = createAgentWithChat(this.store, this.events, { name: NEW_AGENT_NAME, source: 'external', catalogId: null, runtimeLabel: 'External agent', status: 'offline' });
    this.store.replaceAgentToken(agent.id, hash);
    return agent.id;
  }

  hello(agentId: ID, input: z.infer<typeof helloSchema>) {
    // The agent names itself while it still has the placeholder name; after that the person's name and description stay.
    // An agent without a name of its own goes by its product name; with neither it stays "New agent".
    const first = this.store.getAgent(agentId)!.name === NEW_AGENT_NAME;
    const name = first ? input.name ?? input.runtime : undefined;
    let agent = this.store.updateAgent(agentId, { name, runtimeLabel: input.runtime, description: first ? input.description : undefined });
    if (name) this.store.updateConversation(agent.chatId, { title: name });
    this.markPolled(agentId);
    agent = this.store.getAgent(agentId)!;
    this.events.emit({ type: 'agent.upsert', agent });
    if (input.greeting) this.runs.postMessage(agent.chatId, { type: 'agent', agentId }, input.greeting);
    else this.runs.emitConversation(agent.chatId);
    return { agent: { id: agent.id, name: agent.name }, chatId: agent.chatId };
  }

  async inbox(agentId: ID, waitSeconds: number, signal: AbortSignal): Promise<InboxItem[]> {
    this.markPolling(agentId);
    if (!this.pickups.get(agentId)?.length && waitSeconds > 0) {
      await new Promise<void>(resolve => {
        const wake = () => {
          clearTimeout(timer);
          this.pollers.get(agentId)?.delete(wake);
          resolve();
        };
        const timer = setTimeout(wake, waitSeconds * 1000);
        signal.addEventListener('abort', wake);
        if (!this.pollers.has(agentId)) this.pollers.set(agentId, new Set());
        this.pollers.get(agentId)!.add(wake);
      });
    }
    this.markPolled(agentId);
    // A poll whose caller already left takes nothing, so no turn is handed to a closed connection.
    if (signal.aborted) return [];
    const waiting = this.pickups.get(agentId) ?? [];
    this.pickups.delete(agentId);
    return waiting.map(w => {
      w.live.begin();
      this.fetched.set(w.live.run.id, w);
      return { runId: w.live.run.id, conversationId: w.live.conversation.id, conversationTitle: w.live.conversation.title, messages: w.live.takeUnseen() };
    });
  }

  reply(agentId: ID, input: z.infer<typeof replySchema>) {
    const waiting = this.fetched.get(input.runId);
    if (!waiting || waiting.live.agent.id !== agentId) throw new HttpError(404, 'No open run with that runId. It may have been stopped or answered.');
    this.fetched.delete(input.runId);
    waiting.live.appendText('text', input.text);
    waiting.resolve({ status: 'done' });
    return {};
  }

  post(agentId: ID, input: z.infer<typeof postSchema>) {
    const conversation = this.store.getConversation(input.conversationId);
    if (!conversation || !conversation.memberIds.includes(agentId)) throw new HttpError(404, 'You are not a member of that conversation.');
    const message = this.runs.postMessage(conversation.id, { type: 'agent', agentId }, input.text);
    return { messageId: message.id };
  }

  execute(live: LiveRun): Promise<RunOutcome> {
    return new Promise(resolve => {
      const agentId = live.agent.id;
      if (!this.pickups.has(agentId)) this.pickups.set(agentId, []);
      this.pickups.get(agentId)!.push({ live, resolve });
      for (const wake of [...(this.pollers.get(agentId) ?? [])]) wake();
    });
  }

  cancel(live: LiveRun) {
    const agentId = live.agent.id;
    const queue = this.pickups.get(agentId) ?? [];
    const waiting = queue.find(w => w.live === live) ?? this.fetched.get(live.run.id);
    this.pickups.set(agentId, queue.filter(w => w.live !== live));
    this.fetched.delete(live.run.id);
    waiting?.resolve({ status: 'stopped' });
  }

  private markPolling(agentId: ID) {
    clearTimeout(this.offlineTimers.get(agentId));
    const agent = this.store.getAgent(agentId);
    if (agent && agent.status === 'offline') {
      this.store.updateAgent(agentId, { status: 'ready', statusDetail: null });
      this.runs.emitAgent(agentId);
    }
  }

  private markPolled(agentId: ID) {
    this.markPolling(agentId);
    this.offlineTimers.set(agentId, setTimeout(() => {
      if (!this.store.getAgent(agentId)) return;
      this.store.updateAgent(agentId, { status: 'offline', statusDetail: 'Not polling Agentry for work.' });
      this.runs.emitAgent(agentId);
    }, OFFLINE_AFTER_MS));
  }

  stop() {
    for (const timer of this.offlineTimers.values()) clearTimeout(timer);
    for (const pollers of this.pollers.values()) for (const wake of [...pollers]) wake();
  }
}
