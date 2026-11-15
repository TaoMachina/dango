import type { Agent, Conversation, ID, Message, MessageAuthor, Part, PermissionOption, Run } from '../shared/types.ts';
import type { Events } from './events.ts';
import { editedPaths, fileList, isInside, projectFolder } from './chat-edits.ts';
import { folderProject } from './projects.ts';
import { existsSync } from 'node:fs';
import { messageText, newId, now, publicMessage, type Store, type StoredMessage } from './store.ts';

export type RunOutcome = { status: 'done' | 'stopped'; note?: string };
export type PermissionAnswer = { optionId: string } | { cancelled: true };
export type StoredRun = Run & { prompt: string | null };

// Runs one agent turn. ACP agents, external (polling) agents and url (OpenAI-compatible API) agents each provide one.
export interface Executor {
  execute(live: LiveRun): Promise<RunOutcome>;
  cancel(live: LiveRun): void;
}

export interface PromptLine { author: string; text: string }

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Finds @Name mentions of the given agents. Names may contain spaces; longer names win,
// so "@Claude Code" does not also count as a mention of an agent named "Claude".
export function findMentions(text: string, agents: Agent[]): ID[] {
  const found: ID[] = [];
  let rest = text;
  for (const agent of [...agents].sort((a, b) => b.name.length - a.name.length)) {
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}_])@${escapeRegExp(agent.name)}(?![\\p{L}\\p{N}_])`, 'giu');
    if (pattern.test(rest)) {
      found.push(agent.id);
      rest = rest.replace(pattern, ' ');
    }
  }
  return found;
}

// A group agent sees who wrote each message; a chat or code agent gets the text as the person wrote it.
export function formatPrompt(conversation: Conversation, lines: PromptLine[]): string {
  if (conversation.kind !== 'group') return lines.map(l => l.text).join('\n\n');
  return lines.map(l => `[${l.author}]: ${l.text}`).join('\n\n');
}

// One active agent turn: owns the agent message it streams into.
export class LiveRun {
  runs: Runs;
  run: StoredRun;
  conversation: Conversation;
  agent: Agent;
  message: StoredMessage | null = null;
  stopped = false;
  finished = false;
  private permissionIds = new Set<string>();

  constructor(runs: Runs, run: StoredRun, conversation: Conversation, agent: Agent) {
    this.runs = runs;
    this.run = run;
    this.conversation = conversation;
    this.agent = agent;
  }

  // Marks the run as running and creates the agent message the reply streams into.
  begin(): StoredMessage {
    const { store } = this.runs;
    this.run = store.updateRun(this.run.id, { status: 'running', startedAt: now() });
    this.message = store.insertMessage({
      conversationId: this.conversation.id, author: { type: 'agent', agentId: this.agent.id }, parts: [], runId: this.run.id, status: 'streaming',
    });
    this.runs.emitMessage(this.message);
    this.runs.emitRun(this.run);
    this.runs.emitAgent(this.agent.id);
    return this.message;
  }

  // Messages this agent has not yet seen in the conversation, in order. Advances its cursor.
  // A reply still streaming from another agent is kept for the next turn instead of being cut off.
  takeUnseen(): PromptLine[] {
    const { store } = this.runs;
    const conversationId = this.conversation.id;
    const upTo = this.message!.seq;
    const cursor = store.getCursor(this.agent.id, conversationId);
    const candidates = [...store.messagesBySeq(conversationId, cursor.skipped), ...store.messagesAfter(conversationId, cursor.seenSeq)]
      .filter(m => m.seq < upTo);
    const skipped: number[] = [];
    const lines: PromptLine[] = [];
    for (const m of candidates) {
      if (m.author.type === 'system' || (m.author.type === 'agent' && m.author.agentId === this.agent.id)) continue;
      if (m.status === 'streaming') {
        skipped.push(m.seq);
        continue;
      }
      const text = messageText(m.parts);
      if (text) lines.push({ author: m.author.type === 'user' ? 'User' : store.authorName(m.author), text });
    }
    store.saveCursor(this.agent.id, conversationId, upTo, skipped);
    if (this.run.prompt) lines.push({ author: 'Routine', text: this.run.prompt });
    return lines;
  }

  get parts(): Part[] {
    return this.message!.parts;
  }

  private textBreak = false;

  // The next text chunk starts a new part instead of continuing the last one.
  breakText() {
    this.textBreak = true;
  }

  appendText(type: 'text' | 'thought', text: string) {
    if (this.finished) return;
    const index = this.parts.length - 1;
    const last = this.parts[index];
    const continues = !this.textBreak;
    this.textBreak = false;
    if (last && last.type === type && continues) {
      last.text += text;
      this.runs.events.emit({ type: 'message.append', conversationId: this.conversation.id, messageId: this.message!.id, partIndex: index, text });
      this.runs.watchers.get(this.run.id)?.onParts(this);
    } else {
      this.pushPart({ type, text });
    }
  }

  pushPart(part: Part): number {
    if (this.finished) return -1;
    this.parts.push(part);
    this.emitPart(this.parts.length - 1);
    return this.parts.length - 1;
  }

  setPart(index: number, part: Part) {
    if (this.finished) return;
    this.parts[index] = part;
    this.emitPart(index);
  }

  private emitPart(index: number) {
    this.runs.store.saveMessage(this.message!);
    this.runs.events.emit({ type: 'message.part', conversationId: this.conversation.id, messageId: this.message!.id, partIndex: index, part: this.parts[index] });
    this.runs.watchers.get(this.run.id)?.onParts(this);
  }

  // Shows the agent's own permission options as a card and waits for the person's choice.
  requestPermission(title: string, options: PermissionOption[]): { requestId: string; answer: Promise<PermissionAnswer> } {
    const requestId = newId();
    if (this.finished) return { requestId, answer: Promise.resolve({ cancelled: true }) };
    const index = this.pushPart({ type: 'permission', requestId, title, options, outcome: null });
    this.permissionIds.add(requestId);
    return { requestId, answer: new Promise(resolve => this.runs.permissions.set(requestId, { live: this, index, resolve })) };
  }

  answerPermission(requestId: string, answer: PermissionAnswer) {
    const pending = this.runs.permissions.get(requestId)!;
    this.runs.permissions.delete(requestId);
    this.permissionIds.delete(requestId);
    const part = this.parts[pending.index];
    if (part.type === 'permission') this.setPart(pending.index, { ...part, outcome: answer });
    pending.resolve(answer);
  }

  stop() {
    if (this.finished) return;
    this.stopped = true;
    this.runs.executorFor(this.agent).cancel(this);
    this.finish('stopped', null);
  }

  finish(status: 'done' | 'stopped' | 'error', note: string | null) {
    if (this.finished) return;
    for (const requestId of [...this.permissionIds]) this.answerPermission(requestId, { cancelled: true });
    this.finished = true;
    const { store } = this.runs;
    const message = this.message;
    let mentions: ID[] = [];
    if (message) {
      if (note) message.parts.push({ type: 'error', text: note });
      message.status = status;
      if (this.conversation.kind === 'group') {
        const others = this.runs.members(this.conversation).filter(a => a.id !== this.agent.id);
        mentions = findMentions(messageText(message.parts), others);
        message.mentions = mentions;
      }
      store.saveMessage(message);
      this.runs.emitMessage(message);
    }
    this.run = store.updateRun(this.run.id, { status, error: status === 'error' ? note : null, endedAt: now() });
    this.runs.lives.delete(this.run.id);
    this.runs.emitRun(this.run);
    this.runs.ended(this.run.id);
    this.runs.emitConversation(this.conversation.id);
    this.runs.emitAgent(this.agent.id);
    this.runs.reportToRequester(this.conversation, this.agent, status);
    // Files edited from a chat or group belong to a project too; whatever the run's outcome, the edits happened.
    if (message && this.conversation.kind !== 'code') this.runs.noteChatEdits(this.conversation, this.agent, message.parts);
    const conversation = store.getConversation(this.conversation.id);
    if (status !== 'done' || !message || !conversation || conversation.kind !== 'group') return;
    const withinLimit = this.run.depth + 1 <= conversation.hopLimit;
    // An agent's @mention hands work to that member, up to the group's hop limit.
    if (mentions.length > 0) {
      if (withinLimit) {
        for (const agentId of mentions) {
          this.runs.startRun({ conversationId: conversation.id, agentId, triggerMessageId: message.id, parentRunId: this.run.id, depth: this.run.depth + 1 });
        }
      } else {
        const names = mentions.map(id => `@${store.getAgent(id)?.name}`).join(', ');
        this.runs.postMessage(conversation.id, { type: 'system' }, `Handoff limit reached, so ${names} was not asked. Send a message to continue.`);
      }
      return;
    }
    // A member the lead asked has answered: once every member from that handoff is done, the lead reviews and replies to the person.
    const parent = this.run.parentRunId ? store.getRun(this.run.parentRunId) : null;
    const lead = conversation.leadId ?? conversation.memberIds[0];
    if (!parent || parent.agentId !== lead || this.agent.id === lead || !withinLimit) return;
    if (store.childRuns(parent.id).some(r => r.status === 'queued' || r.status === 'running')) return;
    this.runs.startRun({ conversationId: conversation.id, agentId: lead, triggerMessageId: message.id, parentRunId: this.run.id, depth: this.run.depth + 1 });
  }
}

// Follows one run: its parts as they stream, and its end. Agentry's delegation shows a helper's run in its parent's reply this way.
export interface RunWatcher {
  onParts(live: LiveRun): void;
  onEnd(run: StoredRun): void;
}

export class Runs {
  store: Store;
  events: Events;
  lives = new Map<ID, LiveRun>();
  watchers = new Map<ID, RunWatcher>();
  permissions = new Map<string, { live: LiveRun; index: number; resolve: (answer: PermissionAnswer) => void }>();
  executors: Record<Agent['source'], Executor> | null = null;
  // Runs for the same agent session run one after another: ACP allows one prompt per session at a time.
  private queues = new Map<string, Promise<void>>();

  home: string;
  scratchDirs: string[]; // chat working folders whose edits are not project work

  constructor(store: Store, events: Events, home: string, scratchDirs: string[]) {
    this.store = store;
    this.events = events;
    this.home = home;
    this.scratchDirs = scratchDirs;
  }

  // Adds the folder an agent edited from a chat to Code (when new) and tells the person which files changed.
  noteChatEdits(conversation: Conversation, agent: Agent, parts: Part[]) {
    const paths = editedPaths(parts, this.scratchDirs);
    if (paths.length === 0) return;
    const files = fileList(paths);
    const folder = projectFolder(paths, this.home);
    // Only a folder that exists becomes a project (an agent may report a path it then removed).
    if (!folder || !existsSync(folder)) {
      this.postMessage(conversation.id, { type: 'system' }, `${agent.name} changed ${files}.`);
      return;
    }
    const existing = this.store.listProjects().find(p => isInside(folder, p.path));
    const project = existing ?? folderProject(this.store, this.events, folder);
    const added = existing ? '' : ' Added to Code.';
    this.postMessage(conversation.id, { type: 'system' }, `${agent.name} changed ${files} in [${project.name}](?m=code&p=${project.id}).${added}`);
  }

  executorFor(agent: Agent): Executor {
    return this.executors![agent.source];
  }

  members(conversation: Conversation): Agent[] {
    return conversation.memberIds.map(id => this.store.getAgent(id)).filter(a => a !== null);
  }

  postUserMessage(conversation: Conversation, text: string, explicitMentions: ID[]): Message {
    const members = this.members(conversation);
    let mentions: ID[] = [];
    let recipients: ID[];
    if (conversation.kind === 'group') {
      const named = new Set([...explicitMentions, ...findMentions(text, members)]);
      mentions = members.filter(m => named.has(m.id)).map(m => m.id);
      const lead = conversation.leadId ?? conversation.memberIds[0];
      recipients = mentions.length > 0 ? mentions : lead ? [lead] : [];
    } else {
      recipients = conversation.memberIds.slice(0, 1);
    }
    const message = this.store.insertMessage({ conversationId: conversation.id, author: { type: 'user' }, parts: [{ type: 'text', text }], mentions, status: 'done' });
    this.emitMessage(message);
    for (const agentId of recipients) {
      this.startRun({ conversationId: conversation.id, agentId, triggerMessageId: message.id, parentRunId: null, depth: 0 });
    }
    this.emitConversation(conversation.id);
    return publicMessage(message);
  }

  // Posts a finished message that starts no run (system notices, agent posts through tools).
  postMessage(conversationId: ID, author: MessageAuthor, text: string): Message {
    const message = this.store.insertMessage({ conversationId, author, parts: [{ type: 'text', text }], status: 'done' });
    this.emitMessage(message);
    this.emitConversation(conversationId);
    return publicMessage(message);
  }

  startRun(r: { conversationId: ID; agentId: ID; triggerMessageId: ID; parentRunId: ID | null; depth: number; prompt?: string }): StoredRun {
    const run = this.store.insertRun({ ...r, prompt: r.prompt ?? null });
    this.emitRun(run);
    this.emitConversation(run.conversationId);
    const key = `${run.agentId}:${run.conversationId}`;
    const tail = (this.queues.get(key) ?? Promise.resolve()).then(() => this.execute(run.id));
    this.queues.set(key, tail);
    tail.then(() => {
      if (this.queues.get(key) === tail) this.queues.delete(key);
    });
    return run;
  }

  private async execute(runId: ID) {
    const run = this.store.getRun(runId);
    // Stopped while queued, or its conversation was deleted.
    if (!run || run.status !== 'queued') return;
    const conversation = this.store.getConversation(run.conversationId)!;
    const agent = this.store.getAgent(run.agentId);
    if (!agent) {
      this.store.updateRun(run.id, { status: 'error', error: 'The agent was removed.', endedAt: now() });
      this.ended(run.id);
      return;
    }
    const live = new LiveRun(this, run, conversation, agent);
    this.lives.set(run.id, live);
    try {
      const outcome = await this.executorFor(agent).execute(live);
      live.finish(outcome.status, outcome.note ?? null);
    } catch (error) {
      live.finish('error', error instanceof Error ? error.message : String(error));
    }
  }

  // A code thread started by an agent tells the conversation that asked for it when a run ends. The note starts no run.
  reportToRequester(conversation: Conversation, agent: Agent, status: 'done' | 'stopped' | 'error') {
    const requester = this.store.requestedFrom(conversation.id);
    if (!requester) return;
    const link = `[${conversation.title}](?m=code&c=${conversation.id})`;
    const text = status === 'done' ? `${agent.name} finished ${link}.` : status === 'stopped' ? `${agent.name} stopped ${link}.` : `${agent.name} hit an error in ${link}.`;
    this.postMessage(requester, { type: 'system' }, text);
  }

  // Tells the run's watcher that the run ended, once.
  ended(runId: ID) {
    const watcher = this.watchers.get(runId);
    if (!watcher) return;
    this.watchers.delete(runId);
    watcher.onEnd(this.store.getRun(runId)!);
  }

  // Stop cancels every queued and active run in the conversation and in the threads it delegated to. A stopped run never resumes.
  stop(conversationId: ID) {
    for (const run of this.store.activeRuns(conversationId)) {
      const live = this.lives.get(run.id);
      if (live) {
        live.stop();
      } else {
        this.emitRun(this.store.updateRun(run.id, { status: 'stopped', endedAt: now() }));
        this.ended(run.id);
      }
    }
    for (const child of this.store.childConversations(conversationId)) this.stop(child);
    this.emitConversation(conversationId);
  }

  stopAll() {
    for (const live of [...this.lives.values()]) live.stop();
  }

  answerPermission(requestId: string, answer: PermissionAnswer): boolean {
    const pending = this.permissions.get(requestId);
    if (!pending) return false;
    pending.live.answerPermission(requestId, answer);
    return true;
  }

  // Pins a message as a chapter, or unpins it. A streaming message's in-memory copy changes too, so its final upsert keeps the label.
  setChapter(message: StoredMessage, chapter: string | null): Message {
    this.store.setChapter(message.id, chapter);
    const live = message.runId ? this.lives.get(message.runId) : undefined;
    if (live?.message?.id === message.id) live.message.chapter = chapter;
    const updated = this.currentMessage(this.store.getMessage(message.id)!);
    this.emitMessage(updated);
    return updated;
  }

  // The in-memory copy of a streaming message is newer than the stored one.
  currentMessage(m: Message): Message {
    const live = m.runId ? this.lives.get(m.runId) : undefined;
    return publicMessage(live?.message?.id === m.id ? live.message : m);
  }

  emitMessage(message: Message) {
    this.events.emit({ type: 'message.upsert', message: publicMessage(message) });
  }

  emitRun(run: StoredRun) {
    this.events.emit({ type: 'run.upsert', run: publicRun(run) });
  }

  emitConversation(id: ID) {
    const conversation = this.store.getConversation(id);
    if (conversation) this.events.emit({ type: 'conversation.upsert', conversation });
  }

  emitAgent(id: ID) {
    const agent = this.store.getAgent(id);
    if (agent) this.events.emit({ type: 'agent.upsert', agent });
  }
}

export function publicRun(run: StoredRun): Run {
  const { prompt: _prompt, ...pub } = run;
  return pub;
}
