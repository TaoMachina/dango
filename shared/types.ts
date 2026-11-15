// The contract between the hub (server/) and the web app (web/).
// Both sides import these types. Change them here first.

export type ID = string;
export type ISODate = string;

// ---------- Avatars ----------

export type Avatar =
  | { kind: 'blob'; color: string; shape: number; face: number } // drawn by the web app
  | { kind: 'emoji'; emoji: string; color: string }
  | { kind: 'image'; dataUrl: string }; // uploaded by the person, stored inline

// ---------- Environments and agents ----------

export interface Environment {
  id: ID; // 'local' for this computer
  name: string; // e.g. the computer's host name
  kind: 'local' | 'remote';
  online: boolean;
}

export type AgentStatus =
  | 'available' // detected, process not started
  | 'starting'
  | 'ready' // process running
  | 'working' // at least one active run
  | 'needs-auth' // the agent reported it needs a login
  | 'error'
  | 'offline'; // external agent not polling, or binary missing after rescan

export interface Agent {
  id: ID;
  name: string; // person-chosen display name
  avatar: Avatar;
  description: string;
  source: 'acp' | 'external';
  catalogId: string | null; // built-in catalog entry, e.g. 'claude-code', 'codex', 'antigravity'
  runtimeLabel: string; // product name, e.g. 'Claude Code'
  environmentId: ID;
  status: AgentStatus;
  statusDetail: string | null; // human-readable reason for needs-auth / error
  hidden: boolean;
  chatId: ID; // the agent's own persistent chat
  createdAt: ISODate;
}

// ---------- Projects and conversations ----------

export interface Project {
  id: ID;
  name: string;
  path: string; // absolute folder path in its environment
  environmentId: ID;
  createdAt: ISODate;
}

export type ConversationKind = 'chat' | 'group' | 'code';

export interface Conversation {
  id: ID;
  kind: ConversationKind; // chat: one agent; group: several agents; code: one agent in a project
  title: string;
  avatar: Avatar | null; // groups only; chats use the agent's avatar
  memberIds: ID[]; // agent IDs
  leadId: ID | null; // group: receives messages without mentions
  projectId: ID | null; // code threads
  hopLimit: number; // group: agent-to-agent mention depth
  lastMessage: { authorName: string; text: string; at: ISODate } | null;
  activeRuns: number;
  createdAt: ISODate;
  updatedAt: ISODate;
}

// ---------- Messages ----------

export type ToolStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

export type ToolContent =
  | { type: 'text'; text: string }
  | { type: 'diff'; path: string; oldText: string | null; newText: string }
  | { type: 'image'; mimeType: string; data: string } // base64
  | { type: 'terminal'; terminalId: string };

export interface PermissionOption {
  optionId: string;
  name: string;
  kind: 'allow_once' | 'allow_always' | 'reject_once' | 'reject_always';
}

export type Part =
  | { type: 'text'; text: string } // Markdown
  | { type: 'thought'; text: string }
  | {
      type: 'tool';
      toolCallId: string;
      title: string;
      kind: string; // ACP tool kind: read, edit, delete, move, search, execute, think, fetch, other
      status: ToolStatus;
      locations: string[];
      content: ToolContent[];
    }
  | { type: 'plan'; entries: { content: string; status: 'pending' | 'in_progress' | 'completed'; priority: 'high' | 'medium' | 'low' }[] }
  | {
      type: 'permission';
      requestId: ID;
      title: string;
      options: PermissionOption[];
      outcome: { optionId: string } | { cancelled: true } | null; // null while waiting for the person
    }
  | { type: 'image'; mimeType: string; data: string } // base64
  | { type: 'error'; text: string };

export type MessageAuthor = { type: 'user' } | { type: 'agent'; agentId: ID } | { type: 'system' };

export interface Message {
  id: ID;
  conversationId: ID;
  author: MessageAuthor;
  parts: Part[];
  mentions: ID[]; // agent IDs mentioned by a user or agent message
  runId: ID | null; // agent messages: the run that produced them
  status: 'streaming' | 'done' | 'stopped' | 'error';
  createdAt: ISODate;
}

// ---------- Runs (one agent turn) ----------

export type RunStatus = 'queued' | 'running' | 'done' | 'stopped' | 'error';

export interface Run {
  id: ID;
  conversationId: ID;
  agentId: ID;
  parentRunId: ID | null; // set when another agent's mention triggered this run
  triggerMessageId: ID;
  depth: number; // 0 for a person's request
  status: RunStatus;
  error: string | null;
  startedAt: ISODate | null;
  endedAt: ISODate | null;
}

// ---------- Native session settings ----------

// Mirrors ACP session config options. The agent decides which exist:
// Claude Code reports mode, model and effort; Codex reports mode, model, reasoning effort and fast mode.
export interface SessionOptionChoice { value: string; name: string; description: string | null }

export type SessionOption =
  | {
      id: string; // ACP configId
      name: string;
      description: string | null;
      category: string | null; // 'mode' | 'model' | 'thought_level' | 'model_config' | 'speed' | agent-specific
      type: 'select';
      currentValue: string;
      choices: SessionOptionChoice[];
    }
  | {
      id: string;
      name: string;
      description: string | null;
      category: string | null;
      type: 'boolean';
      currentValue: boolean;
    };

export interface SessionInfo {
  conversationId: ID;
  agentId: ID;
  options: SessionOption[]; // show 'model' first, then 'mode', then the rest
  commands: { name: string; description: string }[]; // agent slash commands
}

// ---------- Routines ----------

export type Schedule =
  | { kind: 'daily'; time: string } // 'HH:MM' local time
  | { kind: 'weekly'; day: number; time: string } // day 0 = Sunday
  | { kind: 'interval'; minutes: number }
  | { kind: 'once'; at: ISODate };

export interface Routine {
  id: ID;
  conversationId: ID;
  agentId: ID;
  title: string;
  prompt: string;
  schedule: Schedule;
  enabled: boolean;
  nextRunAt: ISODate | null;
  lastRunAt: ISODate | null;
}

// ---------- REST API (all JSON, all under /api, cookie-authenticated) ----------

export interface StateResponse {
  environments: Environment[];
  agents: Agent[];
  conversations: Conversation[];
  projects: Project[];
  routines: Routine[];
}

// GET    /api/state                                   -> StateResponse
// GET    /api/conversations/:id/messages?before=ID    -> { messages: Message[]; runs: Run[]; hasMore: boolean } (newest 100 before `before`, ascending)
// POST   /api/conversations/:id/messages              { text, mentions?: ID[] } -> Message
// POST   /api/conversations/:id/stop                  -> {}
// POST   /api/conversations                           CreateConversationRequest -> Conversation
// PATCH  /api/conversations/:id                       { title?, avatar?, memberIds?, leadId?, hopLimit? } -> Conversation
// DELETE /api/conversations/:id                       -> {} (groups and code threads only)
// POST   /api/conversations/:id/session               { agentId } -> SessionInfo (starts the agent and its session if needed)
// POST   /api/conversations/:id/session/option        { agentId, optionId, value: string | boolean } -> SessionInfo
// POST   /api/permissions/:requestId                  { optionId } | { cancel: true } -> {}
// PATCH  /api/agents/:id                              { name?, avatar?, description?, hidden? } -> Agent
// POST   /api/agents/rescan                           -> { agents: Agent[] }
// POST   /api/agents/external                         { name } -> { agent: Agent; instruction: string }
// POST   /api/agents/:id/instruction                  -> { instruction: string } (external agents; issues a new token)
// DELETE /api/agents/:id                              -> {} (external agents only)
// POST   /api/projects                                { path, name? } -> Project (creates the folder if missing)
// DELETE /api/projects/:id                            -> {}
// POST   /api/fs/list                                 { path: string | null } -> FsListResponse (null = home and drives)
// POST   /api/routines                                { conversationId, agentId, title, prompt, schedule } -> Routine
// PATCH  /api/routines/:id                            { title?, prompt?, schedule?, enabled? } -> Routine
// DELETE /api/routines/:id                            -> {}
// POST   /api/routines/:id/run                        -> {} (run now)
// POST   /api/shutdown                                -> {} (stops agents, then the hub exits)
// GET    /api/events                                  -> text/event-stream of HubEvent (data: JSON per event)
// When a run ends the hub sends a full message.upsert for its message, so clients that
// missed appends while loading history still end with the complete text.

export type CreateConversationRequest =
  | { kind: 'group'; title: string; memberIds: ID[]; leadId?: ID }
  | { kind: 'code'; projectId: ID; agentId: ID; title?: string };

export interface FsListResponse {
  path: string | null;
  parent: string | null;
  entries: { name: string; path: string }[]; // folders only
}

export interface ApiError { error: string }

// ---------- Server-sent events ----------

export type HubEvent =
  | { type: 'hello' } // sent on connect; the client then reloads /api/state
  | { type: 'agent.upsert'; agent: Agent }
  | { type: 'agent.removed'; agentId: ID }
  | { type: 'conversation.upsert'; conversation: Conversation }
  | { type: 'conversation.removed'; conversationId: ID }
  | { type: 'project.upsert'; project: Project }
  | { type: 'project.removed'; projectId: ID }
  | { type: 'message.upsert'; message: Message } // full message; replaces any local copy
  | { type: 'message.append'; conversationId: ID; messageId: ID; partIndex: number; text: string } // append to a text or thought part
  | { type: 'message.part'; conversationId: ID; messageId: ID; partIndex: number; part: Part } // set or add a part
  | { type: 'run.upsert'; run: Run }
  | { type: 'session.upsert'; session: SessionInfo }
  | { type: 'routine.upsert'; routine: Routine }
  | { type: 'routine.removed'; routineId: ID };
