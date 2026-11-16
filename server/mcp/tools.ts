// The hub side of the Dango tools that agents call through server/mcp/bridge.ts.
import { randomBytes } from 'node:crypto';
import { isAbsolute } from 'node:path';
import { z } from 'zod';
import type { Conversation, ID, Part, RunStatus } from '../../shared/types.ts';
import { currentModelName } from '../acp/mapping.ts';
import type { Events } from '../events.ts';
import { describeHelpers } from '../helpers.ts';
import { folderProject, HttpError } from '../projects.ts';
import { scheduleSchema, type Routines } from '../routines.ts';
import type { LiveRun, Runs, StoredRun } from '../routing.ts';
import type { Store } from '../store.ts';

// Each ACP session gets its own token, so a tool call always knows which agent and conversation it came from.
// Tokens live in memory: agent processes, and the bridges they start, end with the hub.
export class ToolTokens {
  private tokens = new Map<string, { agentId: ID; conversationId: ID }>();

  issue(agentId: ID, conversationId: ID): string {
    const token = randomBytes(32).toString('hex');
    this.tokens.set(token, { agentId, conversationId });
    return token;
  }

  resolve(token: string) {
    return this.tokens.get(token) ?? null;
  }
}

export const codeTaskSchema = z.object({ project: z.string().min(1), agent: z.string().optional(), prompt: z.string().min(1), title: z.string().optional() });
export const routineToolSchema = z.object({ title: z.string().min(1), prompt: z.string().min(1), schedule: scheduleSchema });
export const messageToolSchema = z.object({ text: z.string().min(1) });
export const readThreadSchema = z.object({ conversation: z.string().min(1) });
export const delegateSchema = z.object({ helper: z.string().min(1), task: z.string().min(1), title: z.string().optional() });
export const waitSchema = z.object({ delegationId: z.string().min(1) });

// Agents end an MCP tool call that runs too long, so dango_delegate and dango_wait_for_helper wait at most this long.
// Codex: mcp_servers.<id>.tool_timeout_sec defaults to 60 s (Codex configuration reference,
// https://learn.chatgpt.com/docs/config-file/config-reference), and codex-acp 2.6.0 passes the servers it is given without
// a tool_timeout_sec (toCodexMcpServerConfig in its dist/index.js). Claude Code (claude.exe of @anthropic-ai/claude-agent-sdk 0.3.323)
// limits a call to MCP_TOOL_TIMEOUT, default 1e8 ms, and a stdio server's call to CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT, default
// 1,800,000 ms. The smaller limit is Codex's 60 s; 50 s leaves 10 s of it for the bridge's HTTP round trip and the agent's handling of the answer.
export const DELEGATE_WAIT_MS = 50_000;

type SubagentPart = Extract<Part, { type: 'subagent' }>;

// A helper's run that a main agent started with dango_delegate, shown live as a subagent part of the main agent's reply.
interface Delegation {
  parent: LiveRun;
  partIndex: number;
  part: SubagentPart;
  end: Promise<StoredRun>;
}

const firstLine = (text: string) => text.trim().split('\n')[0].trim();

// The latest step of a helper's run: its last tool's title or the last line of its text.
function activityOf(parts: Part[]): string | null {
  const last = parts.findLast(p => p.type === 'tool' || p.type === 'text');
  if (last?.type === 'tool') return last.title || null;
  if (last?.type === 'text') return last.text.split('\n').map(l => l.trim()).filter(Boolean).at(-1) ?? null;
  return null;
}

// 20 messages give enough recent context for a status check without flooding the caller's context window.
const READ_MESSAGES = 20;

const threadStatus = (status: RunStatus | undefined) => (status === 'queued' || status === 'running' ? 'running' : status ?? null);

// Text as written; tool calls and other activity as one line each. Thoughts stay out.
function summary(parts: Part[]): string {
  return parts.flatMap(p => {
    switch (p.type) {
      case 'text': return [p.text];
      case 'tool': return [`[tool] ${p.title || p.kind} (${p.status})`];
      case 'permission': return [`[permission] ${p.title}${p.outcome ? '' : ' (waiting for the person)'}`];
      case 'error': return [`[error] ${p.text}`];
      case 'image': return ['[image]'];
      default: return [];
    }
  }).join('\n');
}

export class Tools {
  private store: Store;
  private events: Events;
  private runs: Runs;
  private routines: Routines;
  private waitMs: number;
  // Keyed by the helper's run id, which is also the delegationId; removed when that run ends.
  private delegations = new Map<ID, Delegation>();

  constructor(store: Store, events: Events, runs: Runs, routines: Routines, waitMs = DELEGATE_WAIT_MS) {
    this.store = store;
    this.events = events;
    this.runs = runs;
    this.routines = routines;
    this.waitMs = waitMs;
  }

  conversation(caller: { agentId: ID; conversationId: ID }) {
    const conversation = this.store.getConversation(caller.conversationId)!;
    const members = this.runs.members(conversation);
    const self = this.store.getAgent(caller.agentId)!;
    const lead = conversation.kind === 'group' ? members.find(m => m.id === (conversation.leadId ?? conversation.memberIds[0])) : null;
    return {
      conversationId: conversation.id, kind: conversation.kind, title: conversation.title,
      you: { id: self.id, name: self.name },
      lead: lead ? { id: lead.id, name: lead.name } : null,
      members: members.map(m => ({ id: m.id, name: m.name, runtime: m.runtimeLabel })),
    };
  }

  private codeThreads(): Conversation[] {
    return this.store.listConversations().filter(c => c.kind === 'code');
  }

  projects() {
    const threads = this.codeThreads();
    return {
      projects: this.store.listProjects().map(p => ({
        id: p.id, name: p.name, path: p.path,
        threads: threads.filter(c => c.projectId === p.id).map(c => ({
          id: c.id, title: c.title, lastActivity: c.updatedAt, status: threadStatus(this.store.latestRun(c.id)?.status),
        })),
      })),
    };
  }

  readCodeThread(input: z.infer<typeof readThreadSchema>) {
    const wanted = input.conversation.trim();
    // Conversations come newest first, so a repeated title finds the latest thread.
    const thread = this.codeThreads().find(c => c.id === wanted || c.title.toLowerCase() === wanted.toLowerCase());
    if (!thread) throw new HttpError(404, `No Code thread "${wanted}". dango_list_projects lists them.`);
    const project = thread.projectId ? this.store.getProject(thread.projectId) : null;
    const agent = this.store.getAgent(thread.memberIds[0]);
    return {
      title: thread.title,
      project: project && { name: project.name, path: project.path },
      agent: agent?.name ?? null,
      status: threadStatus(this.store.latestRun(thread.id)?.status),
      messages: this.store.listMessages(thread.id, null, READ_MESSAGES).messages.map(m => this.runs.currentMessage(m))
        .map(m => ({ author: this.store.authorName(m.author), text: summary(m.parts) })),
    };
  }

  startCodeTask(caller: { agentId: ID; conversationId: ID }, input: z.infer<typeof codeTaskSchema>) {
    const requester = this.store.getAgent(caller.agentId)!;
    const wanted = input.project.trim();
    const projects = this.store.listProjects();
    const project = projects.find(p => p.id === wanted || p.name.toLowerCase() === wanted.toLowerCase())
      ?? (isAbsolute(wanted) ? folderProject(this.store, this.events, wanted) : null);
    if (!project) throw new HttpError(404, `No project named "${wanted}". Pass a project id, name or absolute folder path.`);
    const agentName = input.agent?.trim().toLowerCase();
    const agent = agentName
      ? this.store.listAgents().find(a => a.id === input.agent || a.name.toLowerCase() === agentName)
      : requester;
    if (!agent) throw new HttpError(404, `No agent named "${input.agent}".`);
    const title = input.title?.trim() || project.name;
    const conversation = this.store.insertConversation({
      kind: 'code', title, avatar: null, memberIds: [agent.id], leadId: null, projectId: project.id, hopLimit: 0, requestedFrom: caller.conversationId,
    });
    this.events.emit({ type: 'conversation.upsert', conversation });
    this.runs.postUserMessage(conversation, `From ${requester.name}: ${input.prompt}`, []);
    this.runs.postMessage(caller.conversationId, { type: 'system' }, `${requester.name} started the code task [${title}](?m=code&c=${conversation.id}) for ${agent.name} in ${project.name}.`);
    return { conversationId: conversation.id };
  }

  listHelpers(caller: { agentId: ID; conversationId: ID }) {
    const conversation = this.store.getConversation(caller.conversationId)!;
    return { helpers: describeHelpers(this.store, conversation).map(({ agentId: _id, ...h }) => h) };
  }

  // Starts the helper in a child Code thread of the caller's thread, in the same project, with the person's chosen options,
  // and waits for its answer up to the wait budget.
  async delegate(caller: { agentId: ID; conversationId: ID }, input: z.infer<typeof delegateSchema>) {
    const conversation = this.store.getConversation(caller.conversationId)!;
    if (conversation.kind !== 'code' || conversation.parentId) throw new HttpError(400, 'Delegation works in Code threads that the person started.');
    const wanted = input.helper.trim().toLowerCase();
    const agent = this.store.listAgents().find(a => a.id === input.helper || a.name.toLowerCase() === wanted);
    const helper = agent && conversation.helpers.find(h => h.agentId === agent.id);
    if (!agent || !helper?.enabled) {
      const enabled = describeHelpers(this.store, conversation).filter(h => h.enabled).map(h => h.name);
      throw new HttpError(403, `"${input.helper}" is not an enabled helper in this thread. Enabled helpers: ${enabled.join(', ') || 'none'}.`);
    }
    const parent = [...this.runs.lives.values()].find(l => l.conversation.id === conversation.id && l.agent.id === caller.agentId && !l.finished);
    if (!parent) throw new HttpError(409, 'dango_delegate works during your own turn in this thread.');
    const requester = this.store.getAgent(caller.agentId)!;
    // The first line names the thread; 60 characters fit a sidebar row, as for threads the person starts.
    const title = input.title?.trim() || firstLine(input.task).slice(0, 60);
    const child = this.store.insertConversation({
      kind: 'code', title, avatar: null, memberIds: [agent.id], leadId: null, projectId: conversation.projectId, hopLimit: 0, parentId: conversation.id,
    });
    for (const choice of helper.options) this.store.saveChoice(agent.id, child.id, choice);
    this.events.emit({ type: 'conversation.upsert', conversation: child });
    this.runs.postUserMessage(child, `From ${requester.name}: ${input.task}`, []);
    // The run is queued; it starts after this call returns to the event loop, so the watcher sees all of it.
    const run = this.store.activeRuns(child.id)[0];

    const info = describeHelpers(this.store, conversation).find(h => h.agentId === agent.id)!;
    const part: SubagentPart = {
      type: 'subagent', sessionId: child.id, title, description: firstLine(input.task), state: 'running', activity: null,
      model: info.model ?? currentModelName(this.store.getSessionCache(agent.id)?.configOptions ?? []), agentId: agent.id, conversationId: child.id,
    };
    let resolve!: (run: StoredRun) => void;
    const delegation: Delegation = { parent, partIndex: parent.pushPart({ ...part }), part, end: new Promise(r => (resolve = r)) };
    this.delegations.set(run.id, delegation);
    this.runs.watchers.set(run.id, {
      onParts: live => {
        const activity = activityOf(live.parts) ?? part.activity;
        const state = live.parts.some(p => p.type === 'permission' && p.outcome === null) ? 'requires_action' : 'running';
        if (activity === part.activity && state === part.state) return;
        Object.assign(part, { activity, state });
        this.showDelegation(delegation);
      },
      onEnd: ended => {
        part.state = 'idle';
        if (ended.status === 'stopped') part.activity = 'Stopped';
        if (ended.status === 'error') part.activity = ended.error;
        this.showDelegation(delegation);
        this.delegations.delete(ended.id);
        resolve(ended);
      },
    });
    return this.waitFor(run.id, delegation);
  }

  async waitForHelper(caller: { agentId: ID; conversationId: ID }, input: z.infer<typeof waitSchema>) {
    const run = this.store.getRun(input.delegationId);
    const child = run && this.store.getConversation(run.conversationId);
    if (!run || child?.parentId !== caller.conversationId) throw new HttpError(404, `No delegation "${input.delegationId}" in this thread.`);
    const delegation = this.delegations.get(run.id);
    return delegation ? this.waitFor(run.id, delegation) : this.result(run);
  }

  private async waitFor(runId: ID, delegation: Delegation) {
    let timer: NodeJS.Timeout | undefined;
    const ended = await Promise.race([delegation.end, new Promise<null>(r => (timer = setTimeout(() => r(null), this.waitMs)))]);
    clearTimeout(timer);
    if (ended) return this.result(ended);
    return {
      status: 'running', delegationId: runId, thread: delegation.part.title,
      note: 'The helper is still working. Call dango_wait_for_helper with this delegationId to keep waiting.',
    };
  }

  // The helper's answer: the last text of its reply, which ends with its final message.
  private result(run: StoredRun) {
    const child = this.store.getConversation(run.conversationId)!;
    const parts = this.store.runMessage(run.id)?.parts ?? [];
    const text = parts.findLast(p => p.type === 'text' && p.text.trim());
    return {
      status: run.status, helper: this.store.getAgent(run.agentId)?.name ?? null, thread: child.title,
      result: text?.type === 'text' ? text.text : null, error: run.error,
    };
  }

  // The parent's reply shows the helper's progress; once that reply has finished, its stored copy is updated instead.
  private showDelegation(d: Delegation) {
    if (!d.parent.finished) return d.parent.setPart(d.partIndex, { ...d.part });
    const message = this.store.getMessage(d.parent.message!.id)!;
    message.parts[d.partIndex] = { ...d.part };
    this.store.saveMessage(message);
    this.runs.emitMessage(message);
  }

  createRoutine(caller: { agentId: ID; conversationId: ID }, input: z.infer<typeof routineToolSchema>) {
    return this.routines.create({ conversationId: caller.conversationId, agentId: caller.agentId, ...input });
  }

  sendMessage(caller: { agentId: ID; conversationId: ID }, input: z.infer<typeof messageToolSchema>) {
    const message = this.runs.postMessage(caller.conversationId, { type: 'agent', agentId: caller.agentId }, input.text);
    return { messageId: message.id };
  }
}
