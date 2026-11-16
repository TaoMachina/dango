// Drives ACP agents: one process per agent, one ACP session per (agent, conversation).
import { mkdirSync } from 'node:fs';
import * as acp from '@agentclientprotocol/sdk/unstable';
import type { Agent, AgentOptions, AgentStatus, Conversation, ConversationKind, ID, Part, SessionInfo } from '../../shared/types.ts';
import type { CatalogEntry } from '../agents/catalog.ts';
import type { Events } from '../events.ts';
import type { ToolTokens } from '../mcp/tools.ts';
import { describeHelpers } from '../helpers.ts';
import { HttpError } from '../projects.ts';
import { membershipKey, membershipUpdate, sessionContext } from './context.ts';
import { formatPrompt, type Executor, type LiveRun, type RunOutcome, type Runs } from '../routing.ts';
import type { Store } from '../store.ts';
import {
  applyUpdate, blockText, changes, chatDefaults, currentModelName, LEGACY_MODE_ID, sessionInfo, stateFrom, upsertTool, withChoices,
  type Choice, type SessionState,
} from './mapping.ts';
import { AgentProcess } from './process.ts';

interface Session {
  agentId: ID;
  conversationId: ID;
  kind: ConversationKind;
  sessionId: string;
  process: AgentProcess;
  state: SessionState;
  live: LiveRun | null;
  // session/load replays history as updates; those are already in the conversation.
  loading: boolean;
  // An agent without a session system prompt gets the Dango context before its first prompt.
  needsContext: boolean;
  // The group facts the agent last heard; a change is announced with the next prompt.
  membership: string;
  // Set once the conversation's chosen options are applied; session.upsert is sent from then on.
  ready: boolean;
}

type SubagentPart = Extract<Part, { type: 'subagent' }>;

// A subagent session the agent announced with subagent_update. Its updates arrive under its own session id.
interface Child {
  // The conversation's session; its active run shows the subagent, also for a subagent's own subagents.
  root: Session;
  part: SubagentPart;
  // The end of the subagent's streamed text, enough to find its latest line.
  text: string;
}

function subagentState(state: acp.StateUpdate | null): SubagentPart['state'] {
  // null clears the reported state without claiming one.
  if (state === null) return 'unknown';
  return state.state === 'running' || state.state === 'idle' || state.state === 'requires_action' ? state.state : 'unknown';
}

// ACP reserves -32000 for "authentication required".
const AUTH_REQUIRED = -32000;

export interface AcpHostOptions {
  store: Store;
  events: Events;
  runs: Runs;
  catalog: CatalogEntry[];
  tools: ToolTokens;
  workDir: string;
  bridgePath: string;
  hubUrl: () => string;
}

function errorText(error: unknown): string {
  if (error instanceof acp.RequestError) {
    const details = (error.data as { details?: unknown } | undefined)?.details;
    return details ? `${error.message}: ${String(details)}` : error.message;
  }
  return error instanceof Error ? error.message : String(error);
}

export class AcpHost implements Executor {
  private o: AcpHostOptions;
  private processes = new Map<ID, Promise<AgentProcess>>();
  private sessions = new Map<string, Promise<Session>>();
  private readySessions = new Map<string, Session>();
  private bySessionId = new Map<string, Session>();
  private children = new Map<string, Child>();

  constructor(options: AcpHostOptions) {
    this.o = options;
  }

  private setStatus(agentId: ID, status: AgentStatus, statusDetail: string | null) {
    if (!this.o.store.getAgent(agentId)) return;
    this.o.store.updateAgent(agentId, { status, statusDetail });
    this.o.runs.emitAgent(agentId);
  }

  private ensureProcess(agent: Agent): Promise<AgentProcess> {
    const running = this.processes.get(agent.id);
    if (running) return running;
    const entry = this.o.catalog.find(e => e.id === agent.catalogId);
    if (!entry) throw new Error(`${agent.runtimeLabel} is not in Dango's agent catalog.`);
    this.setStatus(agent.id, 'starting', null);
    const subagentModel = this.o.store.getAgent(agent.id)?.subagentModel?.value;
    const env = subagentModel && entry.subagentModelEnv ? entry.subagentModelEnv(subagentModel) : {};
    const proc = new AgentProcess(entry, {
      onUpdate: n => this.onUpdate(n),
      onPermission: (request, signal) => this.onPermission(request, signal),
      onExit: detail => this.onExit(agent.id, proc, detail),
    }, env);
    const started = proc.initialize().then(
      () => {
        this.setStatus(agent.id, 'ready', null);
        return proc;
      },
      error => {
        this.processes.delete(agent.id);
        proc.stop();
        const detail = `${entry.runtimeLabel} did not start: ${errorText(error)} ${proc.lastStderrLine()}`.trim();
        this.setStatus(agent.id, 'error', detail);
        throw new Error(detail);
      },
    );
    this.processes.set(agent.id, started);
    return started;
  }

  private onExit(agentId: ID, proc: AgentProcess, detail: string | null) {
    this.processes.delete(agentId);
    for (const [key, session] of this.bySessionId) {
      if (session.process !== proc) continue;
      this.bySessionId.delete(key);
      this.sessions.delete(`${session.agentId}:${session.conversationId}`);
      this.readySessions.delete(`${session.agentId}:${session.conversationId}`);
    }
    for (const [key, child] of this.children) {
      if (child.root.process === proc) this.children.delete(key);
    }
    // A failed start or a sign-in request already set a more specific status.
    const agent = this.o.store.getAgent(agentId);
    if (agent && ['starting', 'ready', 'working'].includes(agent.status)) this.setStatus(agentId, detail ? 'error' : 'available', detail);
  }

  private needsAuth(agent: Agent): Error {
    const detail = `${agent.runtimeLabel} needs you to sign in. Open ${agent.runtimeLabel} in a terminal, sign in with its own login, then send your message again.`;
    this.setStatus(agent.id, 'needs-auth', detail);
    return new Error(detail);
  }

  private mcpServers(agentId: ID, conversationId: ID): acp.McpServer[] {
    const token = this.o.tools.issue(agentId, conversationId);
    return [{
      name: 'dango',
      command: process.execPath,
      args: [this.o.bridgePath],
      env: [{ name: 'DANGO_URL', value: this.o.hubUrl() }, { name: 'DANGO_TOOL_TOKEN', value: token }],
    }];
  }

  private cwdFor(conversation: Conversation): string {
    if (conversation.kind === 'code' && conversation.projectId) {
      const project = this.o.store.getProject(conversation.projectId);
      if (!project) throw new Error('This code thread\'s project was removed.');
      return project.path;
    }
    mkdirSync(this.o.workDir, { recursive: true });
    return this.o.workDir;
  }

  private context(agent: Agent, conversation: Conversation): string {
    const project = conversation.kind === 'code' && conversation.projectId ? this.o.store.getProject(conversation.projectId) : null;
    return sessionContext(conversation, agent, this.o.runs.members(conversation), project, describeHelpers(this.o.store, conversation));
  }

  // What goes before the conversation text: the Dango context once per new session, or a group change since the last prompt.
  private preface(session: Session, live: LiveRun): string[] {
    const key = membershipKey(live.conversation);
    const changed = key !== session.membership;
    session.membership = key;
    if (session.needsContext) {
      session.needsContext = false;
      // Built again so it states the group as it is now.
      return [this.context(live.agent, live.conversation)];
    }
    return changed ? [membershipUpdate(live.conversation, live.agent, this.o.runs.members(live.conversation), describeHelpers(this.o.store, live.conversation))] : [];
  }

  ensureSession(agent: Agent, conversation: Conversation): Promise<Session> {
    const key = `${agent.id}:${conversation.id}`;
    let session = this.sessions.get(key);
    if (!session) {
      session = this.openSession(agent, conversation);
      this.sessions.set(key, session);
      session.catch(() => this.sessions.delete(key));
    }
    return session;
  }

  private async openSession(agent: Agent, conversation: Conversation): Promise<Session> {
    const proc = await this.ensureProcess(agent);
    const mcpServers = this.mcpServers(agent.id, conversation.id);
    const stored = this.o.store.getAcpSession(agent.id, conversation.id);
    const caps = proc.init?.agentCapabilities ?? {};
    const context = this.context(agent, conversation);
    // Appended to the agent's own instructions, never replacing them.
    const systemPrompt: acp.SystemPrompt | undefined = caps.sessionCapabilities?.systemPrompt ? { mode: 'append', content: [{ type: 'text', text: context }] } : undefined;
    const session: Session = {
      agentId: agent.id, conversationId: conversation.id, kind: conversation.kind, sessionId: '', process: proc, state: stateFrom({}),
      live: null, loading: false, needsContext: false, membership: membershipKey(conversation), ready: false,
    };
    let notice: string | null = null;
    // A stored session is restored in the folder it was created in; agents keep their sessions per folder.
    try {
      if (stored && caps.sessionCapabilities?.resume) {
        session.sessionId = stored.sessionId;
        session.state = stateFrom(await proc.connection.agent.request('session/resume', { sessionId: stored.sessionId, cwd: stored.cwd, mcpServers, systemPrompt }));
      } else if (stored && caps.loadSession) {
        session.sessionId = stored.sessionId;
        session.loading = true;
        this.bySessionId.set(stored.sessionId, session);
        try {
          session.state = stateFrom(await proc.connection.agent.request('session/load', { sessionId: stored.sessionId, cwd: stored.cwd, mcpServers, systemPrompt }));
        } finally {
          // A failed load falls back to a new session below, whose updates must reach the conversation.
          session.loading = false;
        }
      } else if (stored) {
        notice = `${agent.name} started a new session and does not remember earlier messages here.`;
      }
      if (session.sessionId) session.state.usage = stored!.usage;
    } catch (error) {
      if (error instanceof acp.RequestError && error.code === AUTH_REQUIRED) throw this.needsAuth(agent);
      this.bySessionId.delete(stored!.sessionId);
      session.sessionId = '';
      // The reason goes to the hub log; the person only needs to know whether context was lost.
      console.error(`${agent.runtimeLabel} could not restore session ${stored!.sessionId}: ${errorText(error)}`);
      notice = `${agent.name} started a new session and does not remember earlier messages here.`;
    }
    if (!session.sessionId) {
      const cwd = this.cwdFor(conversation);
      try {
        const response = await proc.connection.agent.request('session/new', { cwd, mcpServers, systemPrompt });
        session.sessionId = response.sessionId;
        session.state = stateFrom(response);
        session.needsContext = !systemPrompt;
      } catch (error) {
        if (error instanceof acp.RequestError && error.code === AUTH_REQUIRED) throw this.needsAuth(agent);
        const detail = `${agent.runtimeLabel} could not open a session: ${errorText(error)}`;
        this.setStatus(agent.id, 'error', detail);
        throw new Error(detail);
      }
      this.o.store.saveAcpSession(agent.id, conversation.id, session.sessionId, cwd);
      // A session that never had a turn holds nothing to lose (Codex does not even keep it), so stay quiet.
      if (notice && this.o.store.hasEndedRuns(conversation.id, agent.id)) this.o.runs.postMessage(conversation.id, { type: 'system' }, notice);
    }
    this.bySessionId.set(session.sessionId, session);
    this.changed(session);
    await this.applyChoices(session);
    const status = this.o.store.getAgent(agent.id)?.status;
    if (status === 'needs-auth' || status === 'error') this.setStatus(agent.id, 'ready', null);
    session.ready = true;
    this.readySessions.set(`${agent.id}:${conversation.id}`, session);
    this.changed(session);
    return session;
  }

  // Chats and groups first get the hub's defaults, then every conversation gets the person's stored choices.
  private async applyChoices(session: Session) {
    const defaults = session.kind === 'code' ? [] : chatDefaults(session.state);
    for (const choice of [...defaults, ...this.o.store.listChoices(session.agentId, session.conversationId)]) {
      if (changes(session.state, choice)) await this.apply(session, choice);
    }
  }

  private async apply(session: Session, choice: Choice) {
    const agentContext = session.process.connection.agent;
    if (choice.optionId === LEGACY_MODE_ID) {
      await agentContext.request('session/set_mode', { sessionId: session.sessionId, modeId: String(choice.value) });
      session.state.modes!.currentModeId = String(choice.value);
    } else {
      const params: acp.SetSessionConfigOptionRequest = typeof choice.value === 'boolean'
        ? { sessionId: session.sessionId, configId: choice.optionId, type: 'boolean', value: choice.value }
        : { sessionId: session.sessionId, configId: choice.optionId, value: choice.value };
      session.state.configOptions = (await agentContext.request('session/set_config_option', params)).configOptions;
    }
    this.changed(session);
  }

  // Keeps the agent's last settings so the next session shows them at once, and tells clients once the session is ready.
  private changed(session: Session) {
    const before = JSON.stringify(this.o.store.getAgent(session.agentId)?.subagentModel?.choices);
    this.o.store.saveSessionCache(session.agentId, session.state);
    const agent = this.o.store.getAgent(session.agentId);
    // The subagent model choices come from the agent's reported models.
    if (agent?.subagentModel && JSON.stringify(agent.subagentModel.choices) !== before) this.o.events.emit({ type: 'agent.upsert', agent });
    if (agent) this.o.events.emit({ type: 'agent.options', options: this.draftOptions(agent) });
    if (!session.ready) return;
    this.o.events.emit({ type: 'session.upsert', session: sessionInfo({ id: session.conversationId, kind: session.kind }, session.agentId, session.state, true) });
  }

  private onUpdate(notification: acp.SessionNotification) {
    const update = notification.update;
    const session = this.bySessionId.get(notification.sessionId);
    if (!session) {
      const child = this.children.get(notification.sessionId);
      if (child) this.onChildUpdate(child, update);
      return;
    }
    switch (update.sessionUpdate) {
      case 'subagent_update':
        return this.onSubagentUpdate(session, update);
      case 'available_commands_update':
        session.state.commands = update.availableCommands.map(c => ({ name: c.name, description: c.description }));
        return this.changed(session);
      case 'current_mode_update': {
        if (session.state.modes) session.state.modes.currentModeId = update.currentModeId;
        const mode = session.state.configOptions.find(o => o.category === 'mode' && o.type === 'select');
        if (mode && mode.type === 'select') mode.currentValue = update.currentModeId;
        return this.changed(session);
      }
      case 'config_option_update':
        session.state.configOptions = update.configOptions;
        return this.changed(session);
      case 'usage_update':
        session.state.usage = { used: update.used, size: update.size };
        this.o.store.saveUsage(session.agentId, session.conversationId, session.state.usage);
        return this.changed(session);
    }
    if (session.loading || !session.live) return;
    applyUpdate(session.live, update);
  }

  // Announces a subagent or changes its title, description or state. Omitted fields stay as they were.
  private onSubagentUpdate(root: Session, update: acp.SubagentUpdate) {
    let child = this.children.get(update.sessionId);
    if (!child) {
      child = {
        root, text: '',
        part: {
          type: 'subagent', sessionId: update.sessionId, title: null, description: null, state: 'unknown', activity: null, model: null,
          agentId: null, conversationId: null,
        },
      };
      this.children.set(update.sessionId, child);
    }
    if (update.title !== undefined) child.part.title = update.title;
    if (update.description !== undefined) child.part.description = update.description;
    if (update.state !== undefined) child.part.state = subagentState(update.state);
    this.showChild(child);
  }

  // A subagent's own session updates become its part's latest activity and model; they start no run and no message.
  private onChildUpdate(child: Child, update: acp.SessionUpdate) {
    const part = child.part;
    switch (update.sessionUpdate) {
      case 'subagent_update':
        return this.onSubagentUpdate(child.root, update);
      case 'tool_call':
      case 'tool_call_update':
        if (!update.title || update.title === part.activity) return;
        part.activity = update.title;
        child.text = '';
        break;
      case 'agent_message_chunk': {
        const text = blockText(update.content);
        if (!text) return;
        // The last two lines hold the latest non-empty one even when the text ends with a line break.
        child.text = (child.text + text).split('\n').slice(-2).join('\n');
        const line = child.text.split('\n').map(l => l.trim()).filter(Boolean).at(-1);
        if (!line || line === part.activity) return;
        part.activity = line;
        break;
      }
      case 'config_option_update': {
        const model = currentModelName(update.configOptions);
        if (model === null || model === part.model) return;
        part.model = model;
        break;
      }
      default:
        return;
    }
    this.showChild(child);
  }

  // Shows the subagent in the conversation's active run. A subagent that reports while no run is active appears in the next one.
  private showChild(child: Child) {
    const live = child.root.live;
    if (!live || child.root.loading) return;
    const index = live.parts.findIndex(p => p.type === 'subagent' && p.sessionId === child.part.sessionId);
    // Agents repeat unchanged fields, such as the working directory this part does not show.
    if (index >= 0 && JSON.stringify(live.parts[index]) === JSON.stringify(child.part)) return;
    if (index >= 0) live.setPart(index, { ...child.part });
    else live.pushPart({ ...child.part });
  }

  private async onPermission(request: acp.RequestPermissionRequest, signal: AbortSignal): Promise<acp.RequestPermissionResponse> {
    // A subagent's request is shown in the run of the conversation that started it.
    const live = (this.bySessionId.get(request.sessionId) ?? this.children.get(request.sessionId)?.root)?.live;
    if (!live || live.finished) return { outcome: { outcome: 'cancelled' } };
    const tool = upsertTool(live, request.toolCall);
    const title = tool.type === 'tool' && tool.title ? tool.title : 'Permission requested';
    const { requestId, answer } = live.requestPermission(title, request.options.map(o => ({ optionId: o.optionId, name: o.name, kind: o.kind })));
    signal.addEventListener('abort', () => this.o.runs.answerPermission(requestId, { cancelled: true }));
    const result = await answer;
    return 'optionId' in result ? { outcome: { outcome: 'selected', optionId: result.optionId } } : { outcome: { outcome: 'cancelled' } };
  }

  async execute(live: LiveRun): Promise<RunOutcome> {
    live.begin();
    const session = await this.ensureSession(live.agent, live.conversation);
    if (live.finished) return { status: 'stopped' };
    const text = [...this.preface(session, live), formatPrompt(live.conversation, live.takeUnseen())].join('\n\n');
    session.live = live;
    try {
      const response = await session.process.connection.agent.request('session/prompt', { sessionId: session.sessionId, prompt: [{ type: 'text', text }] });
      switch (response.stopReason) {
        case 'cancelled': return { status: 'stopped' };
        case 'max_tokens': return { status: 'done', note: 'The agent stopped at its output limit.' };
        case 'max_turn_requests': return { status: 'done', note: 'The agent stopped at its turn limit.' };
        case 'refusal': return { status: 'done', note: 'The agent declined this request.' };
        default: return { status: 'done' };
      }
    } catch (error) {
      if (error instanceof acp.RequestError && error.code === AUTH_REQUIRED) throw this.needsAuth(live.agent);
      throw new Error(errorText(error));
    } finally {
      if (session.live === live) session.live = null;
    }
  }

  cancel(live: LiveRun) {
    for (const session of this.bySessionId.values()) {
      if (session.live === live) session.process.connection.agent.notify('session/cancel', { sessionId: session.sessionId });
    }
  }

  // Answers at once: the live session when it is ready, otherwise the agent's last settings while the session starts.
  // Choices for a Code thread that does not exist yet: the agent's last session settings, seen as Code sees them.
  // An agent that never ran starts in its own chat, so the picker fills in once it reports its options.
  draftOptions(agent: Agent): AgentOptions {
    const cache = this.o.store.getSessionCache(agent.id);
    if (!cache) {
      const chat = this.o.store.getConversation(agent.chatId);
      if (chat) this.ensureSession(agent, chat).catch(() => {}); // openSession reports failures on the agent's status.
    }
    const state = cache ? { ...cache, usage: null } : stateFrom({});
    return { agentId: agent.id, options: sessionInfo({ id: '', kind: 'code' }, agent.id, state, false).options, ready: cache !== null };
  }

  info(agent: Agent, conversation: Conversation): SessionInfo {
    const live = this.readySessions.get(`${agent.id}:${conversation.id}`);
    if (live) return sessionInfo(conversation, agent.id, live.state, true);
    // openSession reports its own failure on the agent's status, and the next prompt tries again.
    this.ensureSession(agent, conversation).catch(() => {});
    return this.cachedInfo(agent, conversation);
  }

  private cachedInfo(agent: Agent, conversation: Conversation): SessionInfo {
    const cache = this.o.store.getSessionCache(agent.id);
    const usage = this.o.store.getAcpSession(agent.id, conversation.id)?.usage ?? null;
    const state = cache ? withChoices({ ...cache, usage }, this.o.store.listChoices(agent.id, conversation.id)) : { ...stateFrom({}), usage };
    return sessionInfo(conversation, agent.id, state, false);
  }

  async setOption(agent: Agent, conversation: Conversation, optionId: string, value: string | boolean): Promise<SessionInfo> {
    const option = this.info(agent, conversation).options.find(o => o.id === optionId);
    if (!option) throw new HttpError(400, `This conversation has no option "${optionId}".`);
    const valid = option.type === 'boolean' ? typeof value === 'boolean' : option.choices.some(c => c.value === value);
    if (!valid) throw new HttpError(400, `${JSON.stringify(value)} is not a choice for ${option.name}.`);
    const choice = { optionId, value };
    this.o.store.saveChoice(agent.id, conversation.id, choice);
    const live = this.readySessions.get(`${agent.id}:${conversation.id}`);
    if (live) {
      if (changes(live.state, choice)) await this.apply(live, choice);
      return sessionInfo(conversation, agent.id, live.state, true);
    }
    // openSession applies stored choices before it is ready; this also covers a choice saved while it was applying them.
    this.ensureSession(agent, conversation).then(
      session => this.applyChoices(session).catch(error => {
        this.o.runs.postMessage(conversation.id, { type: 'system' }, `${agent.runtimeLabel} did not accept ${option.name}: ${errorText(error)}`);
      }),
      () => {}, // openSession reports its own failure on the agent's status.
    );
    return this.cachedInfo(agent, conversation);
  }

  // Copies the agent's native session of `source` into a new session for `target`, a conversation the caller then creates.
  // The new session stays in the source session's folder.
  async forkSession(agent: Agent, source: Conversation, target: Conversation): Promise<{ sessionId: string; cwd: string }> {
    const proc = await this.ensureProcess(agent);
    const caps = proc.init?.agentCapabilities ?? {};
    if (!caps.sessionCapabilities?.fork) throw new HttpError(400, `${agent.name} cannot fork a session.`);
    const stored = this.o.store.getAcpSession(agent.id, source.id);
    if (!stored) throw new HttpError(400, `${agent.name} has no session in this thread yet.`);
    const systemPrompt: acp.SystemPrompt | undefined = caps.sessionCapabilities.systemPrompt
      ? { mode: 'append', content: [{ type: 'text', text: this.context(agent, target) }] }
      : undefined;
    try {
      const response = await proc.connection.agent.request('session/fork', {
        sessionId: stored.sessionId, cwd: stored.cwd, mcpServers: this.mcpServers(agent.id, target.id), systemPrompt,
      });
      return { sessionId: response.sessionId, cwd: stored.cwd };
    } catch (error) {
      if (error instanceof acp.RequestError && error.code === AUTH_REQUIRED) throw this.needsAuth(agent);
      throw new Error(`${agent.runtimeLabel} could not fork the session: ${errorText(error)}`);
    }
  }

  // A deleted conversation's sessions: the agent closes them when it supports session/close, and the hub drops its references.
  forget(conversationId: ID) {
    for (const [key, opening] of this.sessions) {
      if (!key.endsWith(`:${conversationId}`)) continue;
      this.sessions.delete(key);
      this.readySessions.delete(key);
      opening.then(
        session => {
          // A session still opening was marked ready after the deletion.
          this.readySessions.delete(key);
          this.bySessionId.delete(session.sessionId);
          for (const [id, child] of this.children) if (child.root === session) this.children.delete(id);
          if (!session.process.init?.agentCapabilities?.sessionCapabilities?.close) return;
          session.process.connection.agent.request('session/close', { sessionId: session.sessionId }).catch(error => {
            console.error(`${this.o.store.getAgent(session.agentId)?.runtimeLabel ?? 'The agent'} could not close session ${session.sessionId}: ${errorText(error)}`);
          });
        },
        () => {}, // openSession reports its own failure on the agent's status.
      );
    }
  }

  // The runtime reads its subagent model when it starts. An idle agent restarts now (its sessions resume on the next prompt);
  // an agent with an active run keeps its process until its next start.
  async restartForSettings(agent: Agent) {
    const running = this.processes.get(agent.id);
    if (!running || [...this.o.runs.lives.values()].some(live => live.agent.id === agent.id)) return;
    await (await running).stop();
  }

  async stopAll() {
    const procs = await Promise.allSettled([...this.processes.values()]);
    await Promise.all(procs.flatMap(p => (p.status === 'fulfilled' ? [p.value.stop()] : [])));
  }
}
