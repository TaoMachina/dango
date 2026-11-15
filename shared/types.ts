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
// 'url' agents are 'ready' after a successful connection test and 'error' (with statusDetail) when a call fails.

export interface Agent {
  id: ID;
  name: string; // person-chosen display name
  avatar: Avatar;
  description: string;
  // acp: launched on this computer; external: polls the hub with a token;
  // url: the hub calls its OpenAI-compatible API (for agents hosted elsewhere).
  source: 'acp' | 'external' | 'url';
  catalogId: string | null; // built-in catalog entry, e.g. 'claude-code', 'codex', 'antigravity'
  runtimeLabel: string; // product name, e.g. 'Claude Code'
  environmentId: ID;
  status: AgentStatus;
  statusDetail: string | null; // human-readable reason for needs-auth / error
  apiHost: string | null; // url agents: the host of their API (never the key); null for others
  hidden: boolean;
  chatId: ID; // the agent's own persistent chat
  // The model this agent's own subagents use, set through the agent's native mechanism.
  // null when the agent offers no such setting; value null means the agent's own default.
  subagentModel: { value: string | null; choices: { value: string; name: string }[] } | null;
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

// Another coding agent the main agent of a Code thread may hand work to through Agentry (agentry_delegate).
// options: the helper's own session options (model, effort, ...) applied to the child thread before its first prompt;
// empty keeps the helper's defaults. Values are validated against the helper's draft options.
export interface Helper {
  agentId: ID;
  enabled: boolean;
  options: { optionId: string; value: string | boolean }[];
}

export interface Conversation {
  id: ID;
  kind: ConversationKind; // chat: one agent; group: several agents; code: one agent in a project
  title: string;
  avatar: Avatar | null; // groups only; chats use the agent's avatar
  memberIds: ID[]; // agent IDs
  leadId: ID | null; // group: receives messages without mentions
  projectId: ID | null; // code threads
  // Code threads: one entry per other installed coding agent. Empty for chats, groups and delegated threads.
  helpers: Helper[];
  parentId: ID | null; // a delegated Code thread: the thread whose agent started it (hidden from the Code list)
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
  | { type: 'error'; text: string }
  | {
      // A subagent the agent started, from ACP subagent_update and the child session's own updates.
      type: 'subagent';
      sessionId: string; // the child ACP session
      title: string | null;
      description: string | null;
      state: 'running' | 'idle' | 'requires_action' | 'unknown';
      activity: string | null; // the child's latest step, e.g. its current tool title or a line of its text
      model: string | null; // the child's model when it reports one
      // Set when the subagent is another agent that Agentry runs for this one (cross-agent delegation);
      // both null for the agent's own native subagents.
      agentId: ID | null;
      conversationId: ID | null; // the child thread, openable from the parent
    };

export type MessageAuthor = { type: 'user' } | { type: 'agent'; agentId: ID } | { type: 'system' };

export interface Message {
  id: ID;
  conversationId: ID;
  author: MessageAuthor;
  parts: Part[];
  mentions: ID[]; // agent IDs mentioned by a user or agent message
  runId: ID | null; // agent messages: the run that produced them
  status: 'streaming' | 'done' | 'stopped' | 'error';
  chapter: string | null; // set when the person pins the message as a chapter of the thread
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
  // The options this conversation exposes, already filtered by the hub:
  // chat and group conversations get only 'model' and 'thought_level' (chats are read-only;
  // coding work goes to Code). Code threads get model, thought_level, mode and the rest.
  options: SessionOption[];
  commands: { name: string; description: string }[]; // agent slash commands
  usage: { used: number; size: number } | null; // context window tokens from ACP usage_update
  ready: boolean; // false while the agent process or session is still starting; options then come from the agent's last session
}

export interface ThreadInfo {
  environment: string; // the computer's name
  folder: string | null; // the project folder
  branch: string | null; // the git branch checked out in that folder, null outside a git repository
}

// What a new Code thread can choose for an agent: its model, effort, mode and other options from its last session.
export interface AgentOptions {
  agentId: ID;
  options: SessionOption[];
  ready: boolean; // false until the agent has run once and reported its options
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
// PATCH  /api/conversations/:id                       { title?, avatar?, memberIds?, leadId?, hopLimit?, helpers?: Helper[] } -> Conversation
//                                                     helpers (code threads): entries replace those for the same agents; they also become
//                                                     the starting helpers of new Code threads
// DELETE /api/conversations/:id                       -> {} (groups and code threads only)
// GET    /api/conversations/:id/info                  -> ThreadInfo (code threads: where the work happens)
// POST   /api/conversations/:id/fork                  { messageId } -> Conversation (code threads; messageId must be the latest agent message: the native session is copied whole)
// PATCH  /api/messages/:id                            { chapter: string | null } -> Message (pin as a chapter, or unpin)
// POST   /api/conversations/:id/session               { agentId } -> SessionInfo (answers at once; starts the agent and its session in the background and sends session.upsert when ready)
// POST   /api/conversations/:id/session/option        { agentId, optionId, value: string | boolean } -> SessionInfo
// POST   /api/permissions/:requestId                  { optionId } | { cancel: true } -> {}
// PATCH  /api/agents/:id                              { name?, avatar?, description?, hidden?, subagentModel?: string | null } -> Agent
// POST   /api/agents/rescan                           -> { agents: Agent[] }
// POST   /api/agents/:id/options                      -> AgentOptions (for a new Code thread; starts an agent never run before and sends agent.options when known)
// POST   /api/agents/external                         -> { instruction: string } (the agent appears when it first calls the hub)
// POST   /api/agents/:id/instruction                  -> { instruction: string } (external agents; issues a new token)
// POST   /api/agents/url                              { baseUrl, apiKey?, model?, name?, sessionHeader? } -> { agent: Agent }
//                                                     tests GET {baseUrl}/v1/models first; baseUrl may end in /v1 or not
//                                                     the key stays in the hub database and is never sent to the browser
// DELETE /api/agents/:id                              -> {} (external and url agents only)
// POST   /api/projects                                { path } | { name } -> Project
//                                                     path: an existing folder (from /api/fs/pick-folder)
//                                                     name: creates ~/Agentry/projects/<name>
// DELETE /api/projects/:id                            -> {}
// POST   /api/fs/pick-folder                          -> { path: string | null } (opens the operating system's folder dialog on this computer; null when cancelled)
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
  // projectId null: the hub makes a new folder for the thread under ~/Agentry/projects, named from the title.
  // options: the model, effort and mode picked before the thread exists, applied before its first prompt.
  | { kind: 'code'; projectId: ID | null; agentId: ID; title: string; options?: { optionId: string; value: string | boolean }[] };


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
  | { type: 'agent.options'; options: AgentOptions }
  | { type: 'routine.upsert'; routine: Routine }
  | { type: 'routine.removed'; routineId: ID };
