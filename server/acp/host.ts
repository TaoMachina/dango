// Drives ACP agents: one process per agent, one ACP session per (agent, conversation).
import { mkdirSync } from 'node:fs';
import * as acp from '@agentclientprotocol/sdk';
import type { Agent, AgentStatus, Conversation, ConversationKind, ID, SessionInfo } from '../../shared/types.ts';
import type { CatalogEntry } from '../agents/catalog.ts';
import type { Events } from '../events.ts';
import type { ToolTokens } from '../mcp/tools.ts';
import { HttpError } from '../projects.ts';
import { membershipKey, membershipUpdate, sessionContext } from './context.ts';
import { formatPrompt, type Executor, type LiveRun, type RunOutcome, type Runs } from '../routing.ts';
import type { Store } from '../store.ts';
import {
  applyUpdate, changes, chatDefaults, LEGACY_MODE_ID, sessionInfo, stateFrom, upsertTool, withChoices, type Choice, type SessionState,
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
  // An agent without a session system prompt gets the Agentry context before its first prompt.
  needsContext: boolean;
  // The group facts the agent last heard; a change is announced with the next prompt.
  membership: string;
  // Set once the conversation's chosen options are applied; session.upsert is sent from then on.
  ready: boolean;
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
    if (!entry) throw new Error(`${agent.runtimeLabel} is not in Agentry's agent catalog.`);
    this.setStatus(agent.id, 'starting', null);
    const proc = new AgentProcess(entry, {
      onUpdate: n => this.onUpdate(n),
      onPermission: (request, signal) => this.onPermission(request, signal),
      onExit: detail => this.onExit(agent.id, proc, detail),
    });
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
      name: 'agentry',
      command: process.execPath,
      args: [this.o.bridgePath],
      env: [{ name: 'AGENTRY_URL', value: this.o.hubUrl() }, { name: 'AGENTRY_TOOL_TOKEN', value: token }],
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
    return sessionContext(conversation, agent, this.o.runs.members(conversation), project);
  }

  // What goes before the conversation text: the Agentry context once per new session, or a group change since the last prompt.
  private preface(session: Session, live: LiveRun): string[] {
    const key = membershipKey(live.conversation);
    const changed = key !== session.membership;
    session.membership = key;
    if (session.needsContext) {
      session.needsContext = false;
      // Built again so it states the group as it is now.
      return [this.context(live.agent, live.conversation)];
    }
    return changed ? [membershipUpdate(live.conversation, live.agent, this.o.runs.members(live.conversation))] : [];
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
        session.state = stateFrom(await proc.connection.agent.request('session/load', { sessionId: stored.sessionId, cwd: stored.cwd, mcpServers, systemPrompt }));
        session.loading = false;
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
      if (notice && this.o.store.hasRuns(conversation.id, agent.id)) this.o.runs.postMessage(conversation.id, { type: 'system' }, notice);
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
    this.o.store.saveSessionCache(session.agentId, session.state);
    if (!session.ready) return;
    this.o.events.emit({ type: 'session.upsert', session: sessionInfo({ id: session.conversationId, kind: session.kind }, session.agentId, session.state, true) });
  }

  private onUpdate(notification: acp.SessionNotification) {
    const session = this.bySessionId.get(notification.sessionId);
    if (!session) return;
    const update = notification.update;
    switch (update.sessionUpdate) {
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

  private async onPermission(request: acp.RequestPermissionRequest, signal: AbortSignal): Promise<acp.RequestPermissionResponse> {
    const live = this.bySessionId.get(request.sessionId)?.live;
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

  async stopAll() {
    const procs = await Promise.allSettled([...this.processes.values()]);
    await Promise.all(procs.flatMap(p => (p.status === 'fulfilled' ? [p.value.stop()] : [])));
  }
}
