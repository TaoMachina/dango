import type { Message, Part } from '../../../shared/types.ts';
import { unifiedDiff } from '../lib/diff.ts';

// Turns the parts of a Code thread into the rows T3 Code shows: answer text, work-log groups,
// plan, permission and error rows. Also derives the right panel's plan, changes and subagents.

export type ToolPart = Extract<Part, { type: 'tool' }>;
export type PlanPart = Extract<Part, { type: 'plan' }>;
export type PermissionPartData = Extract<Part, { type: 'permission' }>;

export type SubagentStatus = 'running' | 'completed' | 'failed' | 'stopped' | 'unreported';

export interface Subagent {
  key: string;
  name: string;
  status: SubagentStatus;
  parts: ToolPart[]; // the tool calls that started, waited on and completed it
}

export type Entry =
  | { kind: 'tool'; part: ToolPart }
  | { kind: 'thought'; text: string }
  | { kind: 'subagent'; agent: Subagent };

export type Row =
  | { kind: 'text'; text: string }
  | { kind: 'work'; entries: Entry[] }
  | { kind: 'plan'; part: PlanPart }
  | { kind: 'permission'; part: PermissionPartData }
  | { kind: 'image'; part: Extract<Part, { type: 'image' }> }
  | { kind: 'error'; text: string };

// ---------- Subagents ----------

// codex-acp reports a native subagent's lifecycle as `kind: 'other'` tool calls titled by
// SubagentActivityReporter ("Start subagent <name>", ...), and Codex's collab tools as tool calls
// titled by the tool name (CollabAgentReporter: spawnAgent, sendInput, resumeAgent, wait, closeAgent).
const CODEX_ACTIVITY = /^(Start|Interact with|Interrupt|Complete) subagent (.+)$/;
const CODEX_COLLAB: Record<string, string> = {
  spawnAgent: 'Start subagent',
  sendInput: 'Message subagent',
  resumeAgent: 'Resume subagent',
  wait: 'Wait for subagent',
  closeAgent: 'Close subagent',
};

/** A readable title for a tool call; Codex collab tools arrive titled by their tool name. */
export function toolTitle(part: ToolPart, catalogId: string | null) {
  return catalogId === 'codex' && part.kind === 'other' && Object.hasOwn(CODEX_COLLAB, part.title) ? CODEX_COLLAB[part.title] : part.title;
}

function lastText(part: ToolPart) {
  const text = part.content.findLast((c) => c.type === 'text');
  return text && text.type === 'text' ? text.text : null;
}

/** The first line of a subagent's reported result, if its tool calls carry one. */
export function subagentDetail(agent: Subagent) {
  for (const part of [...agent.parts].reverse()) {
    const text = lastText(part)?.trim();
    if (text) return text.split('\n')[0];
  }
  return null;
}

function openStatus(streaming: boolean): SubagentStatus {
  return streaming ? 'running' : 'unreported';
}

/**
 * Finds the subagents in one message. Codex: lifecycle tool calls grouped by subagent name, with
 * collab calls (such as `wait`) attached to every subagent open at that point. Claude Code:
 * claude-agent-acp's AgentReporter reports each Agent or Task call as one `kind: 'think'` tool call
 * titled by its description, so each such call is one subagent.
 */
function findSubagents(parts: Part[], catalogId: string | null, streaming: boolean) {
  const byPart = new Map<number, Subagent>(); // part index -> the subagent it belongs to
  const firstIndex = new Map<Subagent, number>();
  if (catalogId === 'claude-code') {
    parts.forEach((part, index) => {
      if (part.type !== 'tool' || part.kind !== 'think') return;
      const status: SubagentStatus = part.status === 'completed' ? 'completed' : part.status === 'failed' ? 'failed' : openStatus(streaming);
      const agent: Subagent = { key: part.toolCallId, name: part.title, status, parts: [part] };
      byPart.set(index, agent);
      firstIndex.set(agent, index);
    });
    return { byPart, firstIndex };
  }
  if (catalogId !== 'codex') return { byPart, firstIndex };

  const byName = new Map<string, Subagent>();
  const open = new Set<Subagent>();
  parts.forEach((part, index) => {
    if (part.type !== 'tool' || part.kind !== 'other') return;
    const activity = part.title.match(CODEX_ACTIVITY);
    if (activity) {
      const [, verb, name] = activity;
      let agent = byName.get(name);
      if (!agent) {
        agent = { key: part.toolCallId, name, status: openStatus(streaming), parts: [] };
        byName.set(name, agent);
        firstIndex.set(agent, index);
      }
      agent.parts.push(part);
      byPart.set(index, agent);
      if (verb === 'Complete' || verb === 'Interrupt') {
        agent.status = part.status === 'failed' ? 'failed' : verb === 'Complete' ? 'completed' : 'stopped';
        open.delete(agent);
      } else {
        agent.status = openStatus(streaming);
        open.add(agent);
      }
      return;
    }
    if (Object.hasOwn(CODEX_COLLAB, part.title) && open.size > 0) {
      for (const agent of open) agent.parts.push(part);
      byPart.set(index, [...open][0]);
    }
  });
  return { byPart, firstIndex };
}

// ---------- Rows ----------

/** The rows of one agent message. Tool calls and thoughts between other parts form one work-log group. */
export function messageRows(message: Message, catalogId: string | null): Row[] {
  const streaming = message.status === 'streaming';
  const { byPart, firstIndex } = findSubagents(message.parts, catalogId, streaming);
  const rows: Row[] = [];
  const work = () => {
    const last = rows.at(-1);
    if (last?.kind === 'work') return last.entries;
    const entries: Entry[] = [];
    rows.push({ kind: 'work', entries });
    return entries;
  };
  message.parts.forEach((part, index) => {
    switch (part.type) {
      case 'text':
        if (part.text.trim()) rows.push({ kind: 'text', text: part.text });
        return;
      case 'thought':
        work().push({ kind: 'thought', text: part.text });
        return;
      case 'tool': {
        const agent = byPart.get(index);
        if (!agent) work().push({ kind: 'tool', part });
        else if (firstIndex.get(agent) === index) work().push({ kind: 'subagent', agent });
        return;
      }
      case 'plan':
        rows.push({ kind: 'plan', part });
        return;
      case 'permission':
        rows.push({ kind: 'permission', part });
        return;
      case 'image':
        rows.push({ kind: 'image', part });
        return;
      case 'error':
        rows.push({ kind: 'error', text: part.text });
        return;
    }
  });
  return rows;
}

export function isActive(entry: Entry, streaming: boolean) {
  if (!streaming) return false;
  if (entry.kind === 'subagent') return entry.agent.status === 'running';
  if (entry.kind === 'tool') return entry.part.status === 'pending' || entry.part.status === 'in_progress';
  return false;
}

export function hasFailure(entry: Entry) {
  if (entry.kind === 'subagent') return entry.agent.status === 'failed';
  return entry.kind === 'tool' && entry.part.status === 'failed';
}

function plural(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`;
}

/** Files a tool call touched: its diff paths, else its locations, else one unnamed file. */
function fileCount(part: ToolPart) {
  const paths = new Set(part.content.flatMap((c) => (c.type === 'diff' ? [c.path] : [])));
  if (paths.size === 0) for (const location of part.locations) paths.add(location);
  return Math.max(1, paths.size);
}

/** "Ran 6 commands, edited 3 files, 1 failed" for a work-log group; null when it holds only thoughts. */
export function summarize(entries: Entry[]): string | null {
  const counts = { execute: 0, read: 0, edit: 0, delete: 0, move: 0, search: 0, fetch: 0, subagent: 0, other: 0 };
  let failed = 0;
  for (const entry of entries) {
    if (entry.kind === 'thought') continue;
    // A failed call changed nothing, so it is counted as failed rather than as work done.
    if (hasFailure(entry)) {
      failed++;
      continue;
    }
    if (entry.kind === 'subagent') {
      counts.subagent++;
      continue;
    }
    const kind = entry.part.kind;
    if (kind === 'read' || kind === 'edit' || kind === 'delete' || kind === 'move') counts[kind] += fileCount(entry.part);
    else if (kind === 'execute' || kind === 'search' || kind === 'fetch') counts[kind]++;
    else counts.other++;
  }
  const phrases = [
    counts.execute && `ran ${plural(counts.execute, 'command', 'commands')}`,
    counts.read && `read ${plural(counts.read, 'file', 'files')}`,
    counts.edit && `edited ${plural(counts.edit, 'file', 'files')}`,
    counts.delete && `deleted ${plural(counts.delete, 'file', 'files')}`,
    counts.move && `moved ${plural(counts.move, 'file', 'files')}`,
    counts.search && `searched ${plural(counts.search, 'time', 'times')}`,
    counts.fetch && `fetched ${plural(counts.fetch, 'page', 'pages')}`,
    counts.subagent && `ran ${plural(counts.subagent, 'subagent', 'subagents')}`,
    counts.other && `used ${plural(counts.other, 'tool', 'tools')}`,
    failed && `${failed} failed`,
  ].filter((p): p is string => Boolean(p));
  if (phrases.length === 0) return null;
  const text = phrases.join(', ');
  return text[0].toUpperCase() + text.slice(1);
}

// ---------- Right panel ----------

/** The plan the agent reported last in this thread. */
export function latestPlan(messages: Message[]): PlanPart | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const plan = messages[i].parts.findLast((p) => p.type === 'plan');
    if (plan && plan.type === 'plan') return plan;
  }
  return null;
}

export interface FileEdit {
  toolCallId: string;
  oldText: string | null;
  newText: string;
}

export interface FileChange {
  path: string;
  edits: FileEdit[]; // in order; each is the hunk the agent reported, not the whole file
  added: number;
  removed: number;
  created: boolean;
}

/** Files changed in the thread, from the diffs of tool calls that did not fail, in first-change order. */
export function fileChanges(messages: Message[]): FileChange[] {
  const byPath = new Map<string, FileChange>();
  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type !== 'tool' || part.status === 'failed') continue;
      for (const content of part.content) {
        if (content.type !== 'diff') continue;
        let change = byPath.get(content.path);
        if (!change) {
          change = { path: content.path, edits: [], added: 0, removed: 0, created: content.oldText === null };
          byPath.set(content.path, change);
        }
        change.edits.push({ toolCallId: part.toolCallId, oldText: content.oldText, newText: content.newText });
        for (const row of unifiedDiff(content.oldText, content.newText)) {
          if (row.kind === 'add') change.added++;
          else if (row.kind === 'del') change.removed++;
        }
      }
    }
  }
  return [...byPath.values()];
}

/** Subagents across the thread, oldest first. */
export function threadSubagents(messages: Message[], catalogId: string | null): Subagent[] {
  return messages.flatMap((message) => {
    if (message.author.type !== 'agent') return [];
    const { firstIndex } = findSubagents(message.parts, catalogId, message.status === 'streaming');
    return [...firstIndex.keys()];
  });
}

/** A path shown relative to the project folder when it is inside it. */
export function relativePath(path: string, root: string | undefined) {
  if (!root) return path;
  const p = path.replace(/\\/g, '/');
  const r = root.replace(/\\/g, '/').replace(/\/$/, '');
  // Windows paths compare without case; the project folder and the agent's paths can differ in case.
  return p.toLowerCase().startsWith(`${r.toLowerCase()}/`) ? p.slice(r.length + 1) : p;
}
