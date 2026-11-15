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

  create(name: string): { agent: Agent; instruction: string } {
    const agent = createAgentWithChat(this.store, this.events, { name, source: 'external', catalogId: null, runtimeLabel: 'External agent', status: 'offline' });
    return { agent, instruction: this.instruction(agent.id) };
  }

  // Issues a new token (replacing the old one) and returns the text to paste into the agent.
  instruction(agentId: ID): string {
    const agent = this.store.getAgent(agentId)!;
    const token = randomToken();
    this.store.replaceAgentToken(agentId, hashToken(token));
    const url = this.hubUrl();
    const auth = `-H "Authorization: Bearer ${token}"`;
    const json = '-H "Content-Type: application/json"';
    return [
      `You are invited to join Rea${agent.name === NEW_AGENT_NAME ? '' : ` as "${agent.name}"`}. Rea is an app on this computer where a person chats with all of their AI agents in one place, alone or in groups.`,
      '',
      `Rea hub: ${url}`,
      `Your token: ${token}`,
      'Send it on every call as the header: Authorization: Bearer <token>',
      '',
      '1. Say hello once. Set your name, your product, a one-line description, and greet the person in one short line:',
      `curl -s -X POST ${url}/agent-api/hello ${auth} ${json} -d '{"name":"${agent.name === NEW_AGENT_NAME ? '<your name>' : agent.name}","runtime":"<your product>","description":"<one line>","greeting":"<one short line>"}'`,
      '',
      `2. Wait for work. This call returns pending prompts, or [] after ${MAX_WAIT_SECONDS} seconds. Call it again right away and keep polling:`,
      `curl -s "${url}/agent-api/inbox?wait=${MAX_WAIT_SECONDS}" ${auth}`,
      'Each item is {"runId","conversationId","conversationTitle","messages":[{"author","text"}]}.',
      '',
      '3. Answer each item once. This posts your reply and completes the item:',
      `curl -s -X POST ${url}/agent-api/reply ${auth} ${json} -d '{"runId":"<runId>","text":"<your reply in Markdown>"}'`,
      '',
      '4. To post into a conversation without being asked:',
      `curl -s -X POST ${url}/agent-api/messages ${auth} ${json} -d '{"conversationId":"<id>","text":"<message>"}'`,
      '',
      `Rea shows you as offline when you stop polling for ${OFFLINE_AFTER_MS / 1000} seconds.`,
    ].join('\n');
  }

  authenticate(token: string | null): ID | null {
    return token ? this.store.agentForToken(hashToken(token)) : null;
  }

  hello(agentId: ID, input: z.infer<typeof helloSchema>) {
    let agent = this.store.updateAgent(agentId, { name: input.name, runtimeLabel: input.runtime, description: input.description });
    if (input.name) this.store.updateConversation(agent.chatId, { title: input.name });
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
      this.store.updateAgent(agentId, { status: 'offline', statusDetail: 'Not polling Rea for work.' });
      this.runs.emitAgent(agentId);
    }, OFFLINE_AFTER_MS));
  }

  stop() {
    for (const timer of this.offlineTimers.values()) clearTimeout(timer);
    for (const pollers of this.pollers.values()) for (const wake of [...pollers]) wake();
  }
}
