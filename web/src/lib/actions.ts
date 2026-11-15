import type {
  Agent,
  AgentOptions,
  Avatar,
  Conversation,
  CreateConversationRequest,
  ID,
  Message,
  Project,
  Routine,
  Run,
  Schedule,
  SessionInfo,
  SessionOption,
  StateResponse,
  ThreadInfo,
} from '../../../shared/types.ts';
import { api } from './api.ts';
import { byId, getState, sessionKey, setState, updateThread, updateUI, upsert, type Module } from './store.ts';

// ---------- Navigation ----------

function writeUrl(push: boolean) {
  const { module, selected } = getState().ui;
  const params = new URLSearchParams(location.search);
  params.set('m', module);
  const id = selected[module];
  if (id) params.set('c', id);
  else params.delete('c');
  const url = `${location.pathname}?${params}`;
  if (url === location.pathname + location.search) return;
  if (push) history.pushState(null, '', url);
  else history.replaceState(null, '', url);
}

export function select(module: Module, id: ID | null) {
  const ui = getState().ui;
  updateUI({ module, selected: { ...ui.selected, [module]: id }, newThreadProjectId: null, drawer: null });
  writeUrl(true);
}

export function selectModule(module: Module) {
  updateUI({ module, newThreadProjectId: null });
  writeUrl(true);
}

export function openNewThread(projectId: ID) {
  const ui = getState().ui;
  updateUI({ module: 'code', selected: { ...ui.selected, code: null }, newThreadProjectId: projectId, drawer: null });
  writeUrl(true);
}

export function restoreFromUrl() {
  const params = new URLSearchParams(location.search);
  const module: Module = params.get('m') === 'code' ? 'code' : 'chat';
  const ui = getState().ui;
  updateUI({ module, selected: { ...ui.selected, [module]: params.get('c') }, newThreadProjectId: null });
}

export function toggleList(wide: boolean) {
  const ui = getState().ui;
  if (!wide) return updateUI({ drawer: ui.drawer === 'list' ? null : 'list' });
  localStorage.setItem('agentry.listCollapsed', ui.listCollapsed ? '0' : '1');
  updateUI({ listCollapsed: !ui.listCollapsed });
}

export function togglePanel(wide: boolean) {
  const ui = getState().ui;
  if (!wide) return updateUI({ drawer: ui.drawer === 'panel' ? null : 'panel' });
  localStorage.setItem('agentry.panelOpen', ui.panelOpen ? '0' : '1');
  updateUI({ panelOpen: !ui.panelOpen });
}

// ---------- State ----------

export async function loadState() {
  const data = await api<StateResponse>('GET', '/api/state');
  setState(() => ({
    auth: 'ok',
    environments: data.environments,
    agents: byId(data.agents),
    conversations: byId(data.conversations),
    projects: byId(data.projects),
    routines: byId(data.routines),
  }));
}

export async function shutdown() {
  await api('POST', '/api/shutdown');
  setState(() => ({ auth: 'closed' }));
}

// ---------- Messages ----------

interface MessagesResponse {
  messages: Message[];
  runs: Run[];
  hasMore: boolean;
}

export async function openThread(conversationId: ID) {
  const data = await api<MessagesResponse>('GET', `/api/conversations/${conversationId}/messages`);
  setState((s) => {
    // Keep messages that arrived over SSE while the request was in flight.
    const live = s.threads[conversationId]?.messages ?? [];
    const ids = new Set(data.messages.map((m) => m.id));
    const messages = data.messages.map((m) => live.find((l) => l.id === m.id) ?? m);
    for (const m of live) if (!ids.has(m.id)) messages.push(m);
    return {
      threads: {
        ...s.threads,
        [conversationId]: { messages, runs: byId(data.runs), hasMore: data.hasMore },
      },
    };
  });
}

export async function loadEarlier(conversationId: ID) {
  const thread = getState().threads[conversationId];
  const first = thread.messages[0];
  const data = await api<MessagesResponse>(
    'GET',
    `/api/conversations/${conversationId}/messages?before=${encodeURIComponent(first.id)}`,
  );
  updateThread(conversationId, (t) => ({
    messages: [...data.messages, ...t.messages],
    runs: { ...byId(data.runs), ...t.runs },
    hasMore: data.hasMore,
  }));
}

export function upsertMessage(message: Message) {
  updateThread(message.conversationId, (t) => {
    const index = t.messages.findIndex((m) => m.id === message.id);
    if (index >= 0) {
      const messages = t.messages.slice();
      messages[index] = message;
      return { ...t, messages };
    }
    const messages = [...t.messages, message];
    const prev = t.messages[t.messages.length - 1];
    if (prev && prev.createdAt > message.createdAt) messages.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return { ...t, messages };
  });
}

export async function sendMessage(conversationId: ID, text: string, mentions: ID[]) {
  const message = await api<Message>('POST', `/api/conversations/${conversationId}/messages`, { text, mentions });
  upsertMessage(message);
}

export function stop(conversationId: ID) {
  return api('POST', `/api/conversations/${conversationId}/stop`);
}

/** Pins a message as a chapter of its thread, or unpins it with null. */
export async function setChapter(messageId: ID, chapter: string | null) {
  upsertMessage(await api<Message>('PATCH', `/api/messages/${messageId}`, { chapter }));
}

/** Scrolls the open timeline to a message and highlights it briefly. */
export function focusMessage(messageId: ID) {
  updateUI({ drawer: null, highlight: messageId });
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  document.getElementById(`message-${messageId}`)!.scrollIntoView({ block: 'start', behavior: reduced ? 'auto' : 'smooth' });
}

export function answerPermission(requestId: ID, optionId: string) {
  return api('POST', `/api/permissions/${requestId}`, { optionId });
}

// ---------- Sessions ----------

export function storeSession(session: SessionInfo) {
  setState((s) => ({ sessions: { ...s.sessions, [sessionKey(session.conversationId, session.agentId)]: session } }));
}

export function storeAgentOptions(options: AgentOptions) {
  setState((s) => ({ agentOptions: { ...s.agentOptions, [options.agentId]: options } }));
}

/** Model, effort and mode choices for a new Code thread; an agent that never ran starts and reports them through agent.options. */
export async function loadAgentOptions(agentId: ID) {
  storeAgentOptions(await api<AgentOptions>('POST', `/api/agents/${agentId}/options`));
}

export async function openSession(conversationId: ID, agentId: ID) {
  storeSession(await api<SessionInfo>('POST', `/api/conversations/${conversationId}/session`, { agentId }));
}

/** Shows the new value at once, then stores the hub's answer; a rejected change restores the previous session. */
export async function setSessionOption(conversationId: ID, agentId: ID, optionId: string, value: string | boolean) {
  const previous = getState().sessions[sessionKey(conversationId, agentId)];
  storeSession({ ...previous, options: previous.options.map((o) => (o.id === optionId ? ({ ...o, currentValue: value } as SessionOption) : o)) });
  try {
    storeSession(await api<SessionInfo>('POST', `/api/conversations/${conversationId}/session/option`, { agentId, optionId, value }));
  } catch (error) {
    storeSession(previous);
    throw error;
  }
}

// ---------- Agents ----------

export async function patchAgent(id: ID, body: { name?: string; avatar?: Avatar; description?: string; hidden?: boolean; subagentModel?: string | null }) {
  upsert('agents', await api<Agent>('PATCH', `/api/agents/${id}`, body));
}

export async function rescan() {
  const { agents } = await api<{ agents: Agent[] }>('POST', '/api/agents/rescan');
  setState((s) => ({ agents: { ...s.agents, ...byId(agents) } }));
  return agents;
}

// The agent itself appears (through agent.upsert) when it pastes the instruction and says hello.
export async function inviteAgent() {
  return api<{ instruction: string }>('POST', '/api/agents/external', {});
}

/** Tests the API and creates the agent; a failed test throws with the hub's reason and shows no toast. */
export async function connectUrlAgent(body: { baseUrl: string; apiKey?: string; model?: string }) {
  const { agent } = await api<{ agent: Agent }>('POST', '/api/agents/url', body, true);
  upsert('agents', agent);
  return agent;
}

// ---------- Conversations ----------

export async function createConversation(body: CreateConversationRequest) {
  const conversation = await api<Conversation>('POST', '/api/conversations', body);
  upsert('conversations', conversation);
  return conversation;
}

export async function patchConversation(
  id: ID,
  body: { title?: string; avatar?: Avatar; memberIds?: ID[]; leadId?: ID | null; hopLimit?: number },
) {
  upsert('conversations', await api<Conversation>('PATCH', `/api/conversations/${id}`, body));
}

/** Where a Code thread works: the computer, its folder and the git branch checked out there. */
export function threadInfo(conversationId: ID) {
  return api<ThreadInfo>('GET', `/api/conversations/${conversationId}/info`);
}

/** Forks a Code thread at its latest agent message into a new thread with the same native session, then opens it. */
export async function forkThread(conversationId: ID, messageId: ID) {
  const conversation = await api<Conversation>('POST', `/api/conversations/${conversationId}/fork`, { messageId });
  upsert('conversations', conversation);
  select('code', conversation.id);
}

// Removes a pasted-in or URL agent with its chat; the hub's agent.removed and conversation.removed events update the lists.
export async function removeAgent(agent: Agent) {
  await api('DELETE', `/api/agents/${agent.id}`);
  const ui = getState().ui;
  if (ui.selected.chat === agent.chatId) select('chat', null);
}

export async function deleteConversation(id: ID) {
  await api('DELETE', `/api/conversations/${id}`);
  const ui = getState().ui;
  setState((s) => {
    const conversations = { ...s.conversations };
    delete conversations[id];
    return { conversations };
  });
  if (ui.selected[ui.module] === id) select(ui.module, null);
}

// ---------- Projects ----------

/** Opens the operating system's folder dialog on this computer. Null when the person cancels. */
export async function pickFolder() {
  return (await api<{ path: string | null }>('POST', '/api/fs/pick-folder')).path;
}

/** `path` adds an existing folder; `name` creates ~/Agentry/projects/<name>. */
export async function createProject(body: { path: string } | { name: string }) {
  const project = await api<Project>('POST', '/api/projects', body);
  upsert('projects', project);
  return project;
}

// ---------- Routines ----------

export async function createRoutine(body: { conversationId: ID; agentId: ID; title: string; prompt: string; schedule: Schedule }) {
  upsert('routines', await api<Routine>('POST', '/api/routines', body));
}

export async function patchRoutine(id: ID, body: { title?: string; prompt?: string; schedule?: Schedule; enabled?: boolean }) {
  upsert('routines', await api<Routine>('PATCH', `/api/routines/${id}`, body));
}

export async function deleteRoutine(id: ID) {
  await api('DELETE', `/api/routines/${id}`);
  setState((s) => {
    const routines = { ...s.routines };
    delete routines[id];
    return { routines };
  });
}

export function runRoutine(id: ID) {
  return api('POST', `/api/routines/${id}/run`);
}
