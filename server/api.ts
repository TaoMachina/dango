// Browser API routes (/api/*). The contract is in shared/types.ts.
import { hostname } from 'node:os';
import { z } from 'zod';
import type { Agent, Conversation, ID, SessionInfo, StateResponse } from '../shared/types.ts';
import type { AcpHost } from './acp/host.ts';
import type { CatalogEntry } from './agents/catalog.ts';
import { defaultAvatar, rescan } from './agents/registry.ts';
import type { Events } from './events.ts';
import { NEW_AGENT_NAME, type External } from './external.ts';
import { parse, Router } from './http.ts';
import { createProject, HttpError, listFolders } from './projects.ts';
import { scheduleSchema, type Routines } from './routines.ts';
import { publicRun, type Runs } from './routing.ts';
import type { Store } from './store.ts';

export interface ApiDeps {
  store: Store;
  events: Events;
  runs: Runs;
  acp: AcpHost;
  external: External;
  routines: Routines;
  catalog: CatalogEntry[];
  shutdown: () => void;
}

// ARCHITECTURE.md: agent-to-agent mentions stop after 3 hops by default, following Codync's group rounds.
const DEFAULT_HOP_LIMIT = 3;
// shared/types.ts: a message page holds the newest 100 messages.
const MESSAGE_PAGE = 100;

const avatarSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('blob'), color: z.string(), shape: z.number().int(), face: z.number().int() }),
  z.object({ kind: z.literal('emoji'), emoji: z.string(), color: z.string() }),
  z.object({ kind: z.literal('image'), dataUrl: z.string().startsWith('data:image/') }),
]);
const name = z.string().trim().min(1);

export function apiRoutes(d: ApiDeps): Router {
  const { store, events, runs } = d;

  const conversation = (id: ID): Conversation => {
    const c = store.getConversation(id);
    if (!c) throw new HttpError(404, 'Conversation not found.');
    return c;
  };
  const agent = (id: ID): Agent => {
    const a = store.getAgent(id);
    if (!a) throw new HttpError(404, 'Agent not found.');
    return a;
  };
  const member = (c: Conversation, agentId: ID): Agent => {
    if (!c.memberIds.includes(agentId)) throw new HttpError(400, 'That agent is not in this conversation.');
    return agent(agentId);
  };
  const emitConversation = (c: Conversation) => events.emit({ type: 'conversation.upsert', conversation: c });
  const removeConversation = (id: ID) => {
    runs.stop(id);
    const routineIds = store.listRoutines().filter(r => r.conversationId === id).map(r => r.id);
    store.deleteConversation(id);
    for (const routineId of routineIds) events.emit({ type: 'routine.removed', routineId });
    events.emit({ type: 'conversation.removed', conversationId: id });
    d.routines.arm();
  };
  const sessionFor = async (c: Conversation, a: Agent, action: () => Promise<SessionInfo>): Promise<SessionInfo> =>
    a.source === 'external' ? { conversationId: c.id, agentId: a.id, options: [], commands: [] } : action();

  return new Router()
    .on('GET', '/api/state', (): StateResponse => ({
      environments: [{ id: 'local', name: hostname(), kind: 'local', online: true }],
      agents: store.listAgents(),
      conversations: store.listConversations(),
      projects: store.listProjects(),
      routines: store.listRoutines(),
    }))

    .on('GET', '/api/events', c => events.attach(c.req, c.res))

    // ---------- conversations ----------

    .on('GET', '/api/conversations/:id/messages', c => {
      const conv = conversation(c.params.id);
      const page = store.listMessages(conv.id, c.url.searchParams.get('before'), MESSAGE_PAGE);
      const runIds = new Set([...page.messages.flatMap(m => (m.runId ? [m.runId] : [])), ...store.activeRuns(conv.id).map(r => r.id)]);
      return { messages: page.messages.map(m => runs.currentMessage(m)), runs: store.runsByIds([...runIds]).map(publicRun), hasMore: page.hasMore };
    })

    .on('POST', '/api/conversations/:id/messages', c => {
      const body = parse(z.object({ text: z.string().trim().min(1), mentions: z.array(z.string()).optional() }), c.body);
      return runs.postUserMessage(conversation(c.params.id), body.text, body.mentions ?? []);
    })

    .on('POST', '/api/conversations/:id/stop', c => {
      runs.stop(conversation(c.params.id).id);
      return {};
    })

    .on('POST', '/api/conversations', c => {
      const body = parse(z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('group'), title: name, memberIds: z.array(z.string()).min(1), leadId: z.string().optional() }),
        z.object({ kind: z.literal('code'), projectId: z.string(), agentId: z.string(), title: z.string().optional() }),
      ]), c.body);
      let created: Conversation;
      if (body.kind === 'group') {
        const memberIds = [...new Set(body.memberIds)];
        memberIds.forEach(agent);
        if (body.leadId && !memberIds.includes(body.leadId)) throw new HttpError(400, 'The lead must be a member.');
        created = store.insertConversation({
          kind: 'group', title: body.title, avatar: defaultAvatar(null, [...store.listAgents().map(a => a.avatar), ...store.listConversations().flatMap(c => (c.avatar ? [c.avatar] : []))]), memberIds, leadId: body.leadId ?? memberIds[0], projectId: null, hopLimit: DEFAULT_HOP_LIMIT,
        });
      } else {
        const project = store.getProject(body.projectId);
        if (!project) throw new HttpError(404, 'Project not found.');
        agent(body.agentId);
        created = store.insertConversation({
          kind: 'code', title: body.title?.trim() || project.name, avatar: null, memberIds: [body.agentId], leadId: null, projectId: project.id, hopLimit: 0,
        });
      }
      emitConversation(created);
      return created;
    })

    .on('PATCH', '/api/conversations/:id', c => {
      const conv = conversation(c.params.id);
      const body = parse(z.object({
        title: name.optional(), avatar: avatarSchema.nullable().optional(), memberIds: z.array(z.string()).min(1).optional(),
        leadId: z.string().nullable().optional(), hopLimit: z.number().int().min(0).optional(),
      }), c.body);
      if (conv.kind !== 'group' && (body.memberIds || body.leadId !== undefined)) throw new HttpError(400, 'Only groups change members or lead.');
      const memberIds = body.memberIds ? [...new Set(body.memberIds)] : conv.memberIds;
      memberIds.forEach(agent);
      let leadId = body.leadId === undefined ? conv.leadId : body.leadId;
      if (leadId && !memberIds.includes(leadId)) {
        if (body.leadId) throw new HttpError(400, 'The lead must be a member.');
        leadId = memberIds[0];
      }
      if (body.memberIds) store.setMembers(conv.id, memberIds);
      const updated = store.updateConversation(conv.id, { title: body.title, avatar: body.avatar, leadId, hopLimit: body.hopLimit });
      emitConversation(updated);
      return updated;
    })

    .on('DELETE', '/api/conversations/:id', c => {
      const conv = conversation(c.params.id);
      if (conv.kind === 'chat') throw new HttpError(400, 'An agent\'s own chat cannot be deleted.');
      removeConversation(conv.id);
      return {};
    })

    .on('POST', '/api/conversations/:id/session', c => {
      const conv = conversation(c.params.id);
      const a = member(conv, parse(z.object({ agentId: z.string() }), c.body).agentId);
      return sessionFor(conv, a, () => d.acp.info(a, conv));
    })

    .on('POST', '/api/conversations/:id/session/option', c => {
      const conv = conversation(c.params.id);
      const body = parse(z.object({ agentId: z.string(), optionId: z.string(), value: z.union([z.string(), z.boolean()]) }), c.body);
      const a = member(conv, body.agentId);
      if (a.source === 'external') throw new HttpError(400, 'External agents have no session options.');
      return d.acp.setOption(a, conv, body.optionId, body.value);
    })

    .on('POST', '/api/permissions/:requestId', c => {
      const body = parse(z.union([z.object({ optionId: z.string() }), z.object({ cancel: z.literal(true) })]), c.body);
      const answered = runs.answerPermission(c.params.requestId, 'optionId' in body ? { optionId: body.optionId } : { cancelled: true });
      if (!answered) throw new HttpError(404, 'This permission request is no longer waiting.');
      return {};
    })

    // ---------- agents ----------

    .on('PATCH', '/api/agents/:id', c => {
      const a = agent(c.params.id);
      const body = parse(z.object({ name: name.optional(), avatar: avatarSchema.optional(), description: z.string().optional(), hidden: z.boolean().optional() }), c.body);
      const updated = store.updateAgent(a.id, body);
      events.emit({ type: 'agent.upsert', agent: updated });
      if (body.name) emitConversation(store.updateConversation(a.chatId, { title: body.name }));
      return updated;
    })

    .on('POST', '/api/agents/rescan', () => ({ agents: rescan(store, events, d.catalog) }))

    .on('POST', '/api/agents/external', c => d.external.create(parse(z.object({ name: z.string().trim().optional() }), c.body).name || NEW_AGENT_NAME))

    .on('POST', '/api/agents/:id/instruction', c => {
      const a = agent(c.params.id);
      if (a.source !== 'external') throw new HttpError(400, 'Only external agents join with an instruction.');
      return { instruction: d.external.instruction(a.id) };
    })

    .on('DELETE', '/api/agents/:id', c => {
      const a = agent(c.params.id);
      if (a.source !== 'external') throw new HttpError(400, 'Only external agents can be removed. Installed agents leave when they are uninstalled.');
      const groups = store.conversationsWithMember(a.id).filter(id => id !== a.chatId);
      removeConversation(a.chatId);
      for (const id of groups) runs.stop(id);
      for (const r of store.listRoutines().filter(r => r.agentId === a.id)) d.routines.delete(r.id);
      store.deleteAgent(a.id);
      for (const id of groups) {
        const conv = conversation(id);
        emitConversation(conv.leadId === a.id ? store.updateConversation(id, { leadId: conv.memberIds[0] ?? null }) : conv);
      }
      events.emit({ type: 'agent.removed', agentId: a.id });
      return {};
    })

    // ---------- projects and folders ----------

    .on('POST', '/api/projects', c => {
      const body = parse(z.object({ path: z.string().min(1), name: z.string().optional() }), c.body);
      return createProject(store, events, body.path, body.name);
    })

    .on('DELETE', '/api/projects/:id', c => {
      store.deleteProject(c.params.id);
      events.emit({ type: 'project.removed', projectId: c.params.id });
      return {};
    })

    .on('POST', '/api/fs/list', c => listFolders(parse(z.object({ path: z.string().nullable() }), c.body).path))

    // ---------- routines ----------

    .on('POST', '/api/routines', c => {
      const body = parse(z.object({ conversationId: z.string(), agentId: z.string(), title: name, prompt: z.string().min(1), schedule: scheduleSchema }), c.body);
      member(conversation(body.conversationId), body.agentId);
      return d.routines.create(body);
    })

    .on('PATCH', '/api/routines/:id', c => {
      if (!store.getRoutine(c.params.id)) throw new HttpError(404, 'Routine not found.');
      const body = parse(z.object({ title: name.optional(), prompt: z.string().min(1).optional(), schedule: scheduleSchema.optional(), enabled: z.boolean().optional() }), c.body);
      return d.routines.update(c.params.id, body);
    })

    .on('DELETE', '/api/routines/:id', c => {
      d.routines.delete(c.params.id);
      return {};
    })

    .on('POST', '/api/routines/:id/run', c => {
      if (!store.getRoutine(c.params.id)) throw new HttpError(404, 'Routine not found.');
      d.routines.runNow(c.params.id);
      return {};
    })

    .on('POST', '/api/shutdown', c => {
      c.res.on('finish', d.shutdown);
      return {};
    });
}
