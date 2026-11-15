// Agents hosted elsewhere that offer an OpenAI-compatible API. The hub listens on 127.0.0.1, so such an agent
// cannot call in; the hub calls its /v1/chat/completions whenever the agent is asked to work.
import { z } from 'zod';
import type { Agent } from '../shared/types.ts';
import { apiContext } from './acp/context.ts';
import { createAgentWithChat } from './agents/registry.ts';
import type { Events } from './events.ts';
import { HttpError } from './projects.ts';
import type { Executor, LiveRun, RunOutcome, Runs } from './routing.ts';
import { messageText, type Store, type UrlAgentConfig } from './store.ts';

// The latest 40 messages keep a request well inside common context windows while carrying the recent conversation.
// The remote agent keeps its own long-term memory.
const HISTORY_LIMIT = 40;

export const connectSchema = z.object({
  baseUrl: z.string().trim().min(1),
  apiKey: z.string().trim().optional(),
  model: z.string().trim().optional(),
  name: z.string().trim().optional(),
  // An HTTP header name (RFC 9110 token characters).
  sessionHeader: z.string().trim().regex(/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/).optional(),
});

const modelList = z.object({ data: z.array(z.object({ id: z.string() })) });

interface ChatMessage { role: 'system' | 'user' | 'assistant'; content: string }

interface Chunk {
  choices?: { delta?: { content?: string | null; reasoning_content?: string | null; reasoning?: string | null }; finish_reason?: string | null }[];
  error?: string | { message?: string };
}

// Accepts https://host and https://host/v1 alike and stores the part before /v1.
export function normalizeBaseUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new HttpError(400, 'Enter the API URL, for example https://your-agent.example.com/v1.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new HttpError(400, 'The API URL must start with http:// or https://.');
  const path = url.pathname.replace(/\/+$/, '').replace(/\/v1$/, '');
  return `${url.origin}${path}`;
}

// Session headers from each product's docs, matched on the model id it lists by default:
// Hermes Agent lists "hermes-agent" (hermes-agent.nousresearch.com/docs/user-guide/features/api-server);
// OpenClaw lists "openclaw" and "openclaw/<agentId>" (docs.openclaw.ai/gateway/openai-http-api).
function documentedSessionHeader(model: string): string | null {
  if (model === 'hermes-agent') return 'X-Hermes-Session-Id';
  if (/^openclaw([/:]|$)/.test(model)) return 'x-openclaw-session-key';
  return null;
}

function reason(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  return error.cause instanceof Error ? `${error.message}: ${error.cause.message}` : error.message;
}

function authHeaders(apiKey: string | null): Record<string, string> {
  return apiKey ? { authorization: `Bearer ${apiKey}` } : {};
}

// Server-sent events: yields each event's name and joined data lines. Comment lines (": keepalive") are skipped.
async function* sseEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<{ event: string; data: string }> {
  const decoder = new TextDecoder();
  let buffer = '';
  let event = 'message';
  let data: string[] = [];
  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true });
    let end: number;
    while ((end = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, end).replace(/\r$/, '');
      buffer = buffer.slice(end + 1);
      if (line === '') {
        if (data.length) yield { event, data: data.join('\n') };
        event = 'message';
        data = [];
      } else if (!line.startsWith(':')) {
        const colon = line.indexOf(':');
        const field = colon < 0 ? line : line.slice(0, colon);
        const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '');
        if (field === 'data') data.push(value);
        else if (field === 'event') event = value;
      }
    }
  }
}

export class UrlAgents implements Executor {
  private store: Store;
  private events: Events;
  private runs: Runs;
  private requests = new Map<string, AbortController>(); // by run

  constructor(store: Store, events: Events, runs: Runs) {
    this.store = store;
    this.events = events;
    this.runs = runs;
  }

  // Tests the connection with GET /v1/models, then creates the agent and its chat.
  async connect(input: z.infer<typeof connectSchema>): Promise<Agent> {
    const baseUrl = normalizeBaseUrl(input.baseUrl);
    const host = new URL(baseUrl).host;
    const apiKey = input.apiKey || null;
    let response: Response;
    try {
      response = await fetch(`${baseUrl}/v1/models`, { headers: authHeaders(apiKey) });
    } catch (error) {
      throw new HttpError(502, `Could not reach ${host}: ${reason(error)}`);
    }
    let model = input.model || null;
    // A server without /v1/models can still serve chat completions when the person names the model.
    if (!(response.status === 404 && model)) {
      if (!response.ok) throw new HttpError(502, `${baseUrl}/v1/models answered ${response.status}: ${(await response.text()).trim()}`);
      const list = modelList.safeParse(await response.json().catch(() => null));
      if (!list.success) throw new HttpError(502, `${baseUrl}/v1/models did not return a model list.`);
      model ??= list.data.data[0]?.id ?? null;
      if (!model) throw new HttpError(400, `${host} lists no models. Enter the model to use.`);
    }
    const config: UrlAgentConfig = { baseUrl, apiKey, model, sessionHeader: input.sessionHeader || documentedSessionHeader(model) };
    const name = input.name || model;
    const agent = createAgentWithChat(this.store, this.events, { name, source: 'url', catalogId: null, runtimeLabel: model, status: 'ready' }, config);
    this.runs.postMessage(agent.chatId, { type: 'system' }, `${name} is connected at ${host}.`);
    return this.store.getAgent(agent.id)!;
  }

  private messages(live: LiveRun): ChatMessage[] {
    const { store } = this.runs;
    const conversation = live.conversation;
    const group = conversation.kind === 'group';
    const project = conversation.kind === 'code' && conversation.projectId ? store.getProject(conversation.projectId) : null;
    const messages: ChatMessage[] = [{ role: 'system', content: apiContext(conversation, live.agent, this.runs.members(conversation), project) }];
    const line = (author: string, text: string) => (group ? `[${author}]: ${text}` : text);
    for (const m of store.listMessages(conversation.id, live.message!.id, HISTORY_LIMIT).messages) {
      // A reply still streaming from another agent is left out; the next turn carries it.
      if (m.author.type === 'system' || m.status === 'streaming') continue;
      const text = messageText(m.parts);
      if (!text) continue;
      if (m.author.type === 'agent' && m.author.agentId === live.agent.id) messages.push({ role: 'assistant', content: text });
      else messages.push({ role: 'user', content: line(m.author.type === 'user' ? 'User' : store.authorName(m.author), text) });
    }
    if (live.run.prompt) messages.push({ role: 'user', content: line('Routine', live.run.prompt) });
    return messages;
  }

  async execute(live: LiveRun): Promise<RunOutcome> {
    const config = this.store.getUrlAgent(live.agent.id)!;
    const controller = new AbortController();
    this.requests.set(live.run.id, controller);
    live.begin();
    const headers: Record<string, string> = { 'content-type': 'application/json', accept: 'text/event-stream', ...authHeaders(config.apiKey) };
    // One remote session per Agentry conversation, so the agent keeps its own transcript and memory per conversation.
    if (config.sessionHeader) headers[config.sessionHeader] = live.conversation.id;
    try {
      const response = await fetch(`${config.baseUrl}/v1/chat/completions`, {
        method: 'POST', headers, signal: controller.signal, body: JSON.stringify({ model: config.model, stream: true, messages: this.messages(live) }),
      });
      if (!response.ok) throw new Error(`${new URL(config.baseUrl).host} answered ${response.status}: ${(await response.text()).trim()}`);
      let note: string | undefined;
      for await (const { event, data } of sseEvents(response.body!)) {
        // Named events are product extensions (for example Hermes' hermes.tool.progress), not completion chunks.
        if (event !== 'message') continue;
        if (data === '[DONE]') {
          // A successful call clears an earlier failure.
          if (this.store.getAgent(live.agent.id)?.status === 'error') this.setStatus(live.agent, 'ready', null);
          return { status: 'done', note };
        }
        const chunk = JSON.parse(data) as Chunk;
        if (chunk.error) throw new Error(typeof chunk.error === 'string' ? chunk.error : chunk.error.message ?? JSON.stringify(chunk.error));
        const choice = chunk.choices?.[0];
        const thought = choice?.delta?.reasoning_content ?? choice?.delta?.reasoning;
        if (thought) live.appendText('thought', thought);
        if (choice?.delta?.content) live.appendText('text', choice.delta.content);
        if (choice?.finish_reason === 'length') note = 'The agent stopped at its output limit.';
      }
      throw new Error('The connection closed before the reply finished.');
    } catch (error) {
      if (live.stopped) return { status: 'stopped' };
      const detail = reason(error);
      this.setStatus(live.agent, 'error', detail);
      throw new Error(detail);
    } finally {
      this.requests.delete(live.run.id);
    }
  }

  cancel(live: LiveRun) {
    this.requests.get(live.run.id)?.abort();
  }

  private setStatus(agent: Agent, status: 'ready' | 'error', detail: string | null) {
    if (!this.store.getAgent(agent.id)) return;
    this.store.updateAgent(agent.id, { status, statusDetail: detail });
    this.runs.emitAgent(agent.id);
  }
}
