// The hub side of the Agentry tools that agents call through server/mcp/bridge.ts.
import { randomBytes } from 'node:crypto';
import { isAbsolute, resolve } from 'node:path';
import { z } from 'zod';
import type { ID } from '../../shared/types.ts';
import type { Events } from '../events.ts';
import { createProject, HttpError } from '../projects.ts';
import { scheduleSchema, type Routines } from '../routines.ts';
import type { Runs } from '../routing.ts';
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

export class Tools {
  private store: Store;
  private events: Events;
  private runs: Runs;
  private routines: Routines;

  constructor(store: Store, events: Events, runs: Runs, routines: Routines) {
    this.store = store;
    this.events = events;
    this.runs = runs;
    this.routines = routines;
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

  projects() {
    return { projects: this.store.listProjects().map(p => ({ id: p.id, name: p.name, path: p.path })) };
  }

  startCodeTask(caller: { agentId: ID; conversationId: ID }, input: z.infer<typeof codeTaskSchema>) {
    const requester = this.store.getAgent(caller.agentId)!;
    const wanted = input.project.trim();
    const projects = this.store.listProjects();
    const project = projects.find(p => p.id === wanted || p.name.toLowerCase() === wanted.toLowerCase())
      ?? (isAbsolute(wanted) ? projects.find(p => p.path === resolve(wanted)) ?? createProject(this.store, this.events, wanted) : null);
    if (!project) throw new HttpError(404, `No project named "${wanted}". Pass a project id, name or absolute folder path.`);
    const agentName = input.agent?.trim().toLowerCase();
    const agent = agentName
      ? this.store.listAgents().find(a => a.id === input.agent || a.name.toLowerCase() === agentName)
      : requester;
    if (!agent) throw new HttpError(404, `No agent named "${input.agent}".`);
    const title = input.title?.trim() || project.name;
    const conversation = this.store.insertConversation({ kind: 'code', title, avatar: null, memberIds: [agent.id], leadId: null, projectId: project.id, hopLimit: 0 });
    this.events.emit({ type: 'conversation.upsert', conversation });
    this.runs.postUserMessage(conversation, `From ${requester.name}: ${input.prompt}`, []);
    this.runs.postMessage(caller.conversationId, { type: 'system' }, `${requester.name} started the code task [${title}](?m=code&c=${conversation.id}) for ${agent.name} in ${project.name}.`);
    return { conversationId: conversation.id };
  }

  createRoutine(caller: { agentId: ID; conversationId: ID }, input: z.infer<typeof routineToolSchema>) {
    return this.routines.create({ conversationId: caller.conversationId, agentId: caller.agentId, ...input });
  }

  sendMessage(caller: { agentId: ID; conversationId: ID }, input: z.infer<typeof messageToolSchema>) {
    const message = this.runs.postMessage(caller.conversationId, { type: 'agent', agentId: caller.agentId }, input.text);
    return { messageId: message.id };
  }
}
