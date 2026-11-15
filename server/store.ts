import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import type {
  Agent, Avatar, Conversation, ConversationKind, ID, Message, MessageAuthor, Part, Project, Routine, Run, Schedule,
} from '../shared/types.ts';

export const newId = () => randomUUID();
export const now = () => new Date().toISOString();

type Row = Record<string, any>;

// A stored message also carries its insertion order, which agent cursors use.
export interface StoredMessage extends Message { seq: number }

export function messageText(parts: Part[]): string {
  // Separate text parts that tool calls split apart, so words never run together.
  return parts.filter(p => p.type === 'text').map(p => p.text).join('\n\n');
}

export class Store {
  db: DatabaseSync;
  constructor(db: DatabaseSync) { this.db = db; }

  // ---------- agents ----------

  private agentFrom(r: Row): Agent {
    const working = r.status === 'ready' && this.count(`SELECT COUNT(*) AS n FROM runs WHERE agent_id = ? AND status = 'running'`, r.id) > 0;
    return {
      id: r.id, name: r.name, avatar: JSON.parse(r.avatar), description: r.description, source: r.source,
      catalogId: r.catalog_id, runtimeLabel: r.runtime_label, environmentId: r.environment_id,
      status: working ? 'working' : r.status, statusDetail: r.status_detail, hidden: !!r.hidden, chatId: r.chat_id,
      createdAt: r.created_at,
    };
  }

  listAgents(): Agent[] {
    return this.db.prepare('SELECT * FROM agents ORDER BY created_at, rowid').all().map(r => this.agentFrom(r as Row));
  }

  getAgent(id: ID): Agent | null {
    const r = this.db.prepare('SELECT * FROM agents WHERE id = ?').get(id) as Row | undefined;
    return r ? this.agentFrom(r) : null;
  }

  insertAgent(a: Omit<Agent, 'createdAt'>): Agent {
    this.db.prepare(`INSERT INTO agents (id, name, avatar, description, source, catalog_id, runtime_label, environment_id, status, status_detail, hidden, chat_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      a.id, a.name, JSON.stringify(a.avatar), a.description, a.source, a.catalogId, a.runtimeLabel, a.environmentId,
      a.status, a.statusDetail, a.hidden ? 1 : 0, a.chatId, now());
    return this.getAgent(a.id)!;
  }

  updateAgent(id: ID, patch: Partial<Pick<Agent, 'name' | 'avatar' | 'description' | 'hidden' | 'status' | 'statusDetail' | 'runtimeLabel'>>): Agent {
    const columns: Record<string, unknown> = {
      name: patch.name, runtime_label: patch.runtimeLabel, avatar: patch.avatar && JSON.stringify(patch.avatar), description: patch.description,
      hidden: patch.hidden === undefined ? undefined : patch.hidden ? 1 : 0, status: patch.status, status_detail: patch.statusDetail,
    };
    this.update('agents', id, columns);
    return this.getAgent(id)!;
  }

  deleteAgent(id: ID) {
    this.db.prepare('DELETE FROM agents WHERE id = ?').run(id);
  }

  // ---------- conversations ----------

  private conversationFrom(r: Row): Conversation {
    const memberIds = this.db.prepare('SELECT agent_id FROM conversation_members WHERE conversation_id = ? ORDER BY position')
      .all(r.id).map(m => (m as Row).agent_id as string);
    return {
      id: r.id, kind: r.kind, title: r.title, avatar: r.avatar ? JSON.parse(r.avatar) : null, memberIds,
      leadId: r.lead_id, projectId: r.project_id, hopLimit: r.hop_limit, lastMessage: this.lastMessage(r.id),
      activeRuns: this.count(`SELECT COUNT(*) AS n FROM runs WHERE conversation_id = ? AND status IN ('queued', 'running')`, r.id),
      createdAt: r.created_at, updatedAt: r.updated_at,
    };
  }

  private lastMessage(conversationId: ID): Conversation['lastMessage'] {
    // Walk back past messages without text (for example a reply that only ran tools).
    for (const r of this.db.prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY seq DESC').iterate(conversationId)) {
      const message = this.messageFrom(r as Row);
      // The preview shows the latest text, which is the agent's answer after any progress notes.
      const text = message.parts.findLast((p): p is Extract<Part, { type: 'text' | 'error' }> => p.type === 'text' || p.type === 'error')?.text ?? '';
      if (text) return { authorName: this.authorName(message.author), text, at: message.createdAt };
    }
    return null;
  }

  authorName(author: MessageAuthor): string {
    if (author.type === 'user') return 'You';
    if (author.type === 'system') return 'Agentry';
    return this.getAgent(author.agentId)?.name ?? 'Agent';
  }

  listConversations(): Conversation[] {
    return this.db.prepare('SELECT * FROM conversations ORDER BY updated_at DESC').all().map(r => this.conversationFrom(r as Row));
  }

  getConversation(id: ID): Conversation | null {
    const r = this.db.prepare('SELECT * FROM conversations WHERE id = ?').get(id) as Row | undefined;
    return r ? this.conversationFrom(r) : null;
  }

  insertConversation(c: { id?: ID; kind: ConversationKind; title: string; avatar: Avatar | null; memberIds: ID[]; leadId: ID | null; projectId: ID | null; hopLimit: number }): Conversation {
    const id = c.id ?? newId();
    const at = now();
    this.db.prepare(`INSERT INTO conversations (id, kind, title, avatar, lead_id, project_id, hop_limit, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, c.kind, c.title, c.avatar && JSON.stringify(c.avatar), c.leadId, c.projectId, c.hopLimit, at, at);
    this.setMembers(id, c.memberIds);
    return this.getConversation(id)!;
  }

  setMembers(conversationId: ID, memberIds: ID[]) {
    this.db.prepare('DELETE FROM conversation_members WHERE conversation_id = ?').run(conversationId);
    const insert = this.db.prepare('INSERT INTO conversation_members (conversation_id, agent_id, position) VALUES (?, ?, ?)');
    memberIds.forEach((agentId, i) => insert.run(conversationId, agentId, i));
  }

  updateConversation(id: ID, patch: Partial<Pick<Conversation, 'title' | 'avatar' | 'leadId' | 'hopLimit'>>): Conversation {
    this.update('conversations', id, {
      title: patch.title, avatar: patch.avatar === undefined ? undefined : patch.avatar && JSON.stringify(patch.avatar),
      lead_id: patch.leadId, hop_limit: patch.hopLimit, updated_at: now(),
    });
    return this.getConversation(id)!;
  }

  touchConversation(id: ID) {
    this.db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(now(), id);
  }

  deleteConversation(id: ID) {
    this.db.prepare('DELETE FROM conversations WHERE id = ?').run(id);
  }

  conversationsWithMember(agentId: ID): ID[] {
    return this.db.prepare('SELECT conversation_id FROM conversation_members WHERE agent_id = ?').all(agentId).map(r => (r as Row).conversation_id);
  }

  // ---------- messages ----------

  private messageFrom(r: Row): StoredMessage {
    return {
      id: r.id, conversationId: r.conversation_id, author: JSON.parse(r.author), parts: JSON.parse(r.parts),
      mentions: JSON.parse(r.mentions), runId: r.run_id, status: r.status, createdAt: r.created_at, seq: r.seq,
    };
  }

  insertMessage(m: { conversationId: ID; author: MessageAuthor; parts: Part[]; mentions?: ID[]; runId?: ID | null; status: Message['status'] }): StoredMessage {
    const id = newId();
    this.db.prepare(`INSERT INTO messages (id, conversation_id, author, parts, mentions, run_id, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, m.conversationId, JSON.stringify(m.author), JSON.stringify(m.parts), JSON.stringify(m.mentions ?? []), m.runId ?? null, m.status, now());
    this.touchConversation(m.conversationId);
    return this.getMessage(id)!;
  }

  getMessage(id: ID): StoredMessage | null {
    const r = this.db.prepare('SELECT * FROM messages WHERE id = ?').get(id) as Row | undefined;
    return r ? this.messageFrom(r) : null;
  }

  saveMessage(m: Message) {
    this.db.prepare('UPDATE messages SET parts = ?, mentions = ?, status = ? WHERE id = ?')
      .run(JSON.stringify(m.parts), JSON.stringify(m.mentions), m.status, m.id);
  }

  // The newest `limit` messages before `beforeId`, oldest first.
  listMessages(conversationId: ID, beforeId: ID | null, limit: number): { messages: StoredMessage[]; hasMore: boolean } {
    const before = beforeId ? this.getMessage(beforeId)?.seq ?? 0 : Number.MAX_SAFE_INTEGER;
    const rows = this.db.prepare('SELECT * FROM messages WHERE conversation_id = ? AND seq < ? ORDER BY seq DESC LIMIT ?')
      .all(conversationId, before, limit + 1) as Row[];
    return { messages: rows.slice(0, limit).reverse().map(r => this.messageFrom(r)), hasMore: rows.length > limit };
  }

  messagesAfter(conversationId: ID, seq: number): StoredMessage[] {
    return this.db.prepare('SELECT * FROM messages WHERE conversation_id = ? AND seq > ? ORDER BY seq').all(conversationId, seq).map(r => this.messageFrom(r as Row));
  }

  messagesBySeq(conversationId: ID, seqs: number[]): StoredMessage[] {
    if (seqs.length === 0) return [];
    return this.db.prepare(`SELECT * FROM messages WHERE conversation_id = ? AND seq IN (${seqs.map(() => '?').join(',')}) ORDER BY seq`)
      .all(conversationId, ...seqs).map(r => this.messageFrom(r as Row));
  }

  // ---------- runs ----------

  private runFrom(r: Row): Run & { prompt: string | null } {
    return {
      id: r.id, conversationId: r.conversation_id, agentId: r.agent_id, parentRunId: r.parent_run_id,
      triggerMessageId: r.trigger_message_id, depth: r.depth, status: r.status, error: r.error,
      startedAt: r.started_at, endedAt: r.ended_at, prompt: r.prompt,
    };
  }

  insertRun(r: { conversationId: ID; agentId: ID; parentRunId: ID | null; triggerMessageId: ID; depth: number; prompt: string | null }) {
    const id = newId();
    this.db.prepare(`INSERT INTO runs (id, conversation_id, agent_id, parent_run_id, trigger_message_id, depth, status, prompt, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?)`).run(id, r.conversationId, r.agentId, r.parentRunId, r.triggerMessageId, r.depth, r.prompt, now());
    return this.getRun(id)!;
  }

  getRun(id: ID) {
    const r = this.db.prepare('SELECT * FROM runs WHERE id = ?').get(id) as Row | undefined;
    return r ? this.runFrom(r) : null;
  }

  updateRun(id: ID, patch: Partial<Pick<Run, 'status' | 'error' | 'startedAt' | 'endedAt'>>) {
    this.update('runs', id, { status: patch.status, error: patch.error, started_at: patch.startedAt, ended_at: patch.endedAt });
    return this.getRun(id)!;
  }

  activeRuns(conversationId: ID) {
    return this.db.prepare(`SELECT * FROM runs WHERE conversation_id = ? AND status IN ('queued', 'running') ORDER BY created_at`)
      .all(conversationId).map(r => this.runFrom(r as Row));
  }

  runsByIds(ids: ID[]) {
    if (ids.length === 0) return [];
    return this.db.prepare(`SELECT * FROM runs WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids).map(r => this.runFrom(r as Row));
  }

  // Runs and streaming messages cannot survive a hub restart: their agent processes are gone.
  failInterruptedWork() {
    const at = now();
    this.db.prepare(`UPDATE runs SET status = 'error', error = 'Agentry restarted before this run finished.', ended_at = ? WHERE status IN ('queued', 'running')`).run(at);
    for (const r of this.db.prepare(`SELECT * FROM messages WHERE status = 'streaming'`).all() as Row[]) {
      const m = this.messageFrom(r);
      m.parts.push({ type: 'error', text: 'Agentry restarted before this reply finished.' });
      m.status = 'error';
      this.saveMessage(m);
    }
  }

  // ---------- agent sessions and cursors ----------

  getAcpSession(agentId: ID, conversationId: ID): { sessionId: string; cwd: string } | null {
    const r = this.db.prepare('SELECT * FROM acp_sessions WHERE agent_id = ? AND conversation_id = ?').get(agentId, conversationId) as Row | undefined;
    return r ? { sessionId: r.session_id, cwd: r.cwd } : null;
  }

  saveAcpSession(agentId: ID, conversationId: ID, sessionId: string, cwd: string) {
    this.db.prepare(`INSERT INTO acp_sessions (agent_id, conversation_id, session_id, cwd) VALUES (?, ?, ?, ?)
      ON CONFLICT (agent_id, conversation_id) DO UPDATE SET session_id = excluded.session_id, cwd = excluded.cwd`).run(agentId, conversationId, sessionId, cwd);
  }

  getCursor(agentId: ID, conversationId: ID): { seenSeq: number; skipped: number[] } {
    const r = this.db.prepare('SELECT * FROM cursors WHERE agent_id = ? AND conversation_id = ?').get(agentId, conversationId) as Row | undefined;
    return r ? { seenSeq: r.seen_seq, skipped: JSON.parse(r.skipped) } : { seenSeq: 0, skipped: [] };
  }

  saveCursor(agentId: ID, conversationId: ID, seenSeq: number, skipped: number[]) {
    this.db.prepare(`INSERT INTO cursors (agent_id, conversation_id, seen_seq, skipped) VALUES (?, ?, ?, ?)
      ON CONFLICT (agent_id, conversation_id) DO UPDATE SET seen_seq = excluded.seen_seq, skipped = excluded.skipped`)
      .run(agentId, conversationId, seenSeq, JSON.stringify(skipped));
  }

  // ---------- projects ----------

  private projectFrom(r: Row): Project {
    return { id: r.id, name: r.name, path: r.path, environmentId: r.environment_id, createdAt: r.created_at };
  }

  listProjects(): Project[] {
    return this.db.prepare('SELECT * FROM projects ORDER BY created_at').all().map(r => this.projectFrom(r as Row));
  }

  getProject(id: ID): Project | null {
    const r = this.db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as Row | undefined;
    return r ? this.projectFrom(r) : null;
  }

  insertProject(p: { name: string; path: string }): Project {
    const id = newId();
    this.db.prepare(`INSERT INTO projects (id, name, path, environment_id, created_at) VALUES (?, ?, ?, 'local', ?)`).run(id, p.name, p.path, now());
    return this.getProject(id)!;
  }

  deleteProject(id: ID) {
    this.db.prepare('DELETE FROM projects WHERE id = ?').run(id);
  }

  // ---------- routines ----------

  private routineFrom(r: Row): Routine {
    return {
      id: r.id, conversationId: r.conversation_id, agentId: r.agent_id, title: r.title, prompt: r.prompt,
      schedule: JSON.parse(r.schedule), enabled: !!r.enabled, nextRunAt: r.next_run_at, lastRunAt: r.last_run_at,
    };
  }

  listRoutines(): Routine[] {
    return this.db.prepare('SELECT * FROM routines ORDER BY created_at').all().map(r => this.routineFrom(r as Row));
  }

  getRoutine(id: ID): Routine | null {
    const r = this.db.prepare('SELECT * FROM routines WHERE id = ?').get(id) as Row | undefined;
    return r ? this.routineFrom(r) : null;
  }

  insertRoutine(r: { conversationId: ID; agentId: ID; title: string; prompt: string; schedule: Schedule; nextRunAt: string | null }): Routine {
    const id = newId();
    this.db.prepare(`INSERT INTO routines (id, conversation_id, agent_id, title, prompt, schedule, enabled, next_run_at, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`)
      .run(id, r.conversationId, r.agentId, r.title, r.prompt, JSON.stringify(r.schedule), r.nextRunAt, now());
    return this.getRoutine(id)!;
  }

  updateRoutine(id: ID, patch: Partial<Omit<Routine, 'id' | 'conversationId' | 'agentId'>>): Routine {
    this.update('routines', id, {
      title: patch.title, prompt: patch.prompt, schedule: patch.schedule && JSON.stringify(patch.schedule),
      enabled: patch.enabled === undefined ? undefined : patch.enabled ? 1 : 0, next_run_at: patch.nextRunAt, last_run_at: patch.lastRunAt,
    });
    return this.getRoutine(id)!;
  }

  deleteRoutine(id: ID) {
    this.db.prepare('DELETE FROM routines WHERE id = ?').run(id);
  }

  // ---------- browser sessions and agent tokens (stored as hashes) ----------

  addBrowserSession(hash: string) {
    this.db.prepare('INSERT INTO browser_sessions (token_hash, created_at) VALUES (?, ?)').run(hash, now());
  }

  hasBrowserSession(hash: string): boolean {
    return !!this.db.prepare('SELECT 1 FROM browser_sessions WHERE token_hash = ?').get(hash);
  }

  replaceAgentToken(agentId: ID, hash: string) {
    this.db.prepare('DELETE FROM agent_tokens WHERE agent_id = ?').run(agentId);
    this.db.prepare('INSERT INTO agent_tokens (token_hash, agent_id, created_at) VALUES (?, ?, ?)').run(hash, agentId, now());
  }

  agentForToken(hash: string): ID | null {
    const r = this.db.prepare('SELECT agent_id FROM agent_tokens WHERE token_hash = ?').get(hash) as Row | undefined;
    return r ? r.agent_id : null;
  }

  // ---------- helpers ----------

  private count(sql: string, ...args: string[]): number {
    return (this.db.prepare(sql).get(...args) as { n: number }).n;
  }

  // Updates the columns whose value is not undefined.
  private update(table: string, id: ID, columns: Record<string, unknown>) {
    const entries = Object.entries(columns).filter(([, v]) => v !== undefined);
    if (entries.length === 0) return;
    this.db.prepare(`UPDATE ${table} SET ${entries.map(([k]) => `${k} = ?`).join(', ')} WHERE id = ?`)
      .run(...entries.map(([, v]) => v as string | number | null), id);
  }
}

// Strips the storage-only sequence number before a message leaves the hub.
export function publicMessage(m: Message): Message {
  const { seq: _seq, ...rest } = m as StoredMessage;
  return rest;
}
