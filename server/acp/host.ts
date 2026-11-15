// Drives ACP agents: one process per agent, one ACP session per (agent, conversation).
import { mkdirSync } from 'node:fs';
import * as acp from '@agentclientprotocol/sdk';
import type { Agent, AgentStatus, Conversation, ID, SessionInfo } from '../../shared/types.ts';
import type { CatalogEntry } from '../agents/catalog.ts';
import type { Events } from '../events.ts';
import type { ToolTokens } from '../mcp/tools.ts';
import { formatPrompt, type Executor, type LiveRun, type RunOutcome, type Runs } from '../routing.ts';
import type { Store } from '../store.ts';
import { applyUpdate, LEGACY_MODE_ID, sessionInfo, stateFrom, upsertTool, type SessionState } from './mapping.ts';
import { AgentProcess } from './process.ts';

interface Session {
  agentId: ID;
  conversationId: ID;
  sessionId: string;
  process: AgentProcess;
  state: SessionState;
  live: LiveRun | null;
  // session/load replays history as updates; those are already in the conversation.
  loading: boolean;
  // A fresh group session first gets a short note on who is in the room.
  needsIntro: boolean;
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
    const cwd = this.cwdFor(conversation);
    const mcpServers = this.mcpServers(agent.id, conversation.id);
    const stored = this.o.store.getAcpSession(agent.id, conversation.id);
    const caps = proc.init?.agentCapabilities ?? {};
    const session: Session = {
      agentId: agent.id, conversationId: conversation.id, sessionId: '', process: proc, state: stateFrom({}), live: null, loading: false, needsIntro: false,
    };
    let notice: string | null = null;
    try {
      if (stored && caps.sessionCapabilities?.resume) {
        session.sessionId = stored.sessionId;
        session.state = stateFrom(await proc.connection.agent.request('session/resume', { sessionId: stored.sessionId, cwd, mcpServers }));
      } else if (stored && caps.loadSession) {
        session.sessionId = stored.sessionId;
        session.loading = true;
        this.bySessionId.set(stored.sessionId, session);
        session.state = stateFrom(await proc.connection.agent.request('session/load', { sessionId: stored.sessionId, cwd, mcpServers }));
        session.loading = false;
      } else if (stored) {
        notice = 'New session started.';
      }
    } catch (error) {
      if (error instanceof acp.RequestError && error.code === AUTH_REQUIRED) throw this.needsAuth(agent);
      this.bySessionId.delete(stored!.sessionId);
      session.sessionId = '';
      notice = `The previous session could not be restored (${errorText(error)}). New session started.`;
    }
    if (!session.sessionId) {
      try {
        const response = await proc.connection.agent.request('session/new', { cwd, mcpServers });
        session.sessionId = response.sessionId;
        session.state = stateFrom(response);
        session.needsIntro = conversation.kind === 'group';
      } catch (error) {
        if (error instanceof acp.RequestError && error.code === AUTH_REQUIRED) throw this.needsAuth(agent);
        throw new Error(`${agent.runtimeLabel} could not open a session: ${errorText(error)}`);
      }
      this.o.store.saveAcpSession(agent.id, conversation.id, session.sessionId, cwd);
      if (notice) this.o.runs.postMessage(conversation.id, { type: 'system' }, notice);
    }
    this.bySessionId.set(session.sessionId, session);
    if (this.o.store.getAgent(agent.id)?.status === 'needs-auth') this.setStatus(agent.id, 'ready', null);
    this.emitSession(session);
    return session;
  }

  private emitSession(session: Session) {
    this.o.events.emit({ type: 'session.upsert', session: sessionInfo(session.conversationId, session.agentId, session.state) });
  }

  private onUpdate(notification: acp.SessionNotification) {
    const session = this.bySessionId.get(notification.sessionId);
    if (!session) return;
    const update = notification.update;
    switch (update.sessionUpdate) {
      case 'available_commands_update':
        session.state.commands = update.availableCommands.map(c => ({ name: c.name, description: c.description }));
        return this.emitSession(session);
      case 'current_mode_update': {
        if (session.state.modes) session.state.modes.currentModeId = update.currentModeId;
        const mode = session.state.configOptions.find(o => o.category === 'mode' && o.type === 'select');
        if (mode && mode.type === 'select') mode.currentValue = update.currentModeId;
        return this.emitSession(session);
      }
      case 'config_option_update':
        session.state.configOptions = update.configOptions;
        return this.emitSession(session);
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
    const intro = session.needsIntro;
    session.needsIntro = false;
    const text = formatPrompt(live.conversation, live.agent, this.o.runs.members(live.conversation), live.takeUnseen(), intro);
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

  async info(agent: Agent, conversation: Conversation): Promise<SessionInfo> {
    const session = await this.ensureSession(agent, conversation);
    return sessionInfo(conversation.id, agent.id, session.state);
  }

  async setOption(agent: Agent, conversation: Conversation, optionId: string, value: string | boolean): Promise<SessionInfo> {
    const session = await this.ensureSession(agent, conversation);
    const agentContext = session.process.connection.agent;
    if (optionId === LEGACY_MODE_ID) {
      await agentContext.request('session/set_mode', { sessionId: session.sessionId, modeId: String(value) });
      session.state.modes!.currentModeId = String(value);
    } else {
      const params: acp.SetSessionConfigOptionRequest = typeof value === 'boolean'
        ? { sessionId: session.sessionId, configId: optionId, type: 'boolean', value }
        : { sessionId: session.sessionId, configId: optionId, value };
      session.state.configOptions = (await agentContext.request('session/set_config_option', params)).configOptions;
    }
    this.emitSession(session);
    return sessionInfo(conversation.id, agent.id, session.state);
  }

  async stopAll() {
    const procs = await Promise.allSettled([...this.processes.values()]);
    await Promise.all(procs.flatMap(p => (p.status === 'fulfilled' ? [p.value.stop()] : [])));
  }
}
