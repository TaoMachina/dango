// Browser API routes (/api/*). The contract is in shared/types.ts.
import { hostname } from 'node:os';
import { z } from 'zod';
import type { Agent, Conversation, ID, SessionInfo, StateResponse, ThreadInfo } from '../shared/types.ts';
import type { AcpHost } from './acp/host.ts';
import type { CatalogEntry } from './agents/catalog.ts';
import { defaultAvatar, rescan } from './agents/registry.ts';
import type { Events } from './events.ts';
import type { External } from './external.ts';
import { connectSchema, type UrlAgents } from './url-agent.ts';
import { parse, Router } from './http.ts';
import { pickFolder } from './folder-picker.ts';
import { gitBranch } from './git.ts';
import { checkChoices } from './helpers.ts';
import { addFolder, createNamed, HttpError, newTaskFolder } from './projects.ts';
import { scheduleSchema, type Routines } from './routines.ts';
import { publicRun, type Runs } from './routing.ts';
import { newId, publicMessage, type Store } from './store.ts';

export interface ApiDeps {
  store: Store;
  events: Events;
  runs: Runs;
  acp: AcpHost;
  external: External;
  urlAgents: UrlAgents;
  routines: Routines;
  catalog: CatalogEntry[];
  projectsDir: string;
  shutdown: () => void;
}

// ARCHITECTURE.md: agent-to-agent mentions stop after 3 hops by default, following Codync's group rounds.
const DEFAULT_HOP_LIMIT = 3;
// shared/types.ts: a message page holds the newest 100 messages.
const MESSAGE_PAGE = 100;
// A chapter label is one line in the thread's chapter list. 80 characters is the traditional width of one line of text;
// a longer label would wrap there instead of reading as a heading.
const CHAPTER_MAX_LENGTH = 80;

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
    // Delegated threads belong to their parent and go with it.
    for (const child of store.childConversations(id)) removeConversation(child);
    const routineIds = store.listRoutines().filter(r => r.conversationId === id).map(r => r.id);
    store.deleteConversation(id);
    d.acp.forget(id);
    for (const routineId of routineIds) events.emit({ type: 'routine.removed', routineId });
    events.emit({ type: 'conversation.removed', conversationId: id });
    d.routines.arm();
  };
  // External and url agents have no native session to configure.
  const noSession = (c: Conversation, a: Agent): SessionInfo => ({ conversationId: c.id, agentId: a.id, options: [], commands: [], usage: null, ready: true });

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
        z.object({
          kind: z.literal('code'), projectId: z.string().nullable(), agentId: z.string(), title: name,
          options: z.array(z.object({ optionId: z.string(), value: z.union([z.string(), z.boolean()]) })).optional(),
        }),
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
        const worker = agent(body.agentId);
        // A url agent has no access to this computer's folders.
        if (worker.source === 'url') throw new HttpError(400, 'Agents connected by URL cannot work in a project on this computer.');
        checkChoices(worker.source === 'acp' ? d.acp.draftOptions(worker).options : [], body.options ?? []);
        const project = body.projectId === null ? newTaskFolder(store, events, d.projectsDir, body.title) : store.getProject(body.projectId);
        if (!project) throw new HttpError(404, 'Project not found.');
        created = store.insertConversation({
          kind: 'code', title: body.title, avatar: null, memberIds: [worker.id], leadId: null, projectId: project.id, hopLimit: 0,
        });
        for (const choice of body.options ?? []) store.saveChoice(worker.id, created.id, choice);
      }
      emitConversation(created);
      return created;
    })

    .on('PATCH', '/api/conversations/:id', c => {
      const conv = conversation(c.params.id);
      const body = parse(z.object({
        title: name.optional(), avatar: avatarSchema.nullable().optional(), memberIds: z.array(z.string()).min(1).optional(),
        leadId: z.string().nullable().optional(), hopLimit: z.number().int().min(0).optional(),
        helpers: z.array(z.object({
          agentId: z.string(), enabled: z.boolean(), options: z.array(z.object({ optionId: z.string(), value: z.union([z.string(), z.boolean()]) })),
        })).optional(),
      }), c.body);
      if (conv.kind !== 'group' && (body.memberIds || body.leadId !== undefined)) throw new HttpError(400, 'Only groups change members or lead.');
      if (body.helpers) {
        if (conv.kind !== 'code' || conv.parentId) throw new HttpError(400, 'Only Code threads the person started have helpers.');
        const allowed = store.helperAgentIds(conv.memberIds[0]);
        for (const helper of body.helpers) {
          if (!allowed.includes(helper.agentId)) throw new HttpError(400, 'A helper must be another coding agent on this computer.');
          checkChoices(d.acp.draftOptions(agent(helper.agentId)).options, helper.options);
        }
        store.setHelpers(conv.id, body.helpers);
      }
      const memberIds = body.memberIds ? [...new Set(body.memberIds)] : conv.memberIds;
      memberIds.forEach(agent);
      let leadId = body.leadId === undefined ? conv.leadId : body.leadId;
      if (leadId && !memberIds.includes(leadId)) {
        if (body.leadId) throw new HttpError(400, 'The lead must be a member.');
        leadId = memberIds[0];
      }
      if (body.memberIds) store.setMembers(conv.id, memberIds);
      // A member who leaves takes its work in this group with it: its queued and active runs stop and its routines here go.
      for (const agentId of conv.memberIds.filter(id => !memberIds.includes(id))) {
        runs.stopAgent(conv.id, agentId);
        for (const r of store.listRoutines().filter(r => r.conversationId === conv.id && r.agentId === agentId)) d.routines.delete(r.id);
      }
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

    .on('GET', '/api/conversations/:id/info', async (c): Promise<ThreadInfo> => {
      const conv = conversation(c.params.id);
      const folder = conv.projectId ? store.getProject(conv.projectId)?.path ?? null : null;
      return { environment: hostname(), folder, branch: folder ? await gitBranch(folder) : null };
    })

    // The agent copies its native session whole, so only the thread as it stands after its latest reply can be forked.
    .on('POST', '/api/conversations/:id/fork', async c => {
      const source = conversation(c.params.id);
      const { messageId } = parse(z.object({ messageId: z.string() }), c.body);
      if (source.kind !== 'code') throw new HttpError(400, 'Only code threads can be forked.');
      const latest = store.latestAgentMessage(source.id);
      if (!latest || latest.id !== messageId) throw new HttpError(400, 'Only the latest reply can be forked: the agent copies its whole session.');
      if (latest.status === 'streaming') throw new HttpError(400, 'Wait for this reply to finish before forking.');
      const worker = agent(source.memberIds[0]);
      if (worker.source !== 'acp') throw new HttpError(400, `${worker.name} cannot fork a session.`);
      const draft: Conversation = { ...source, id: newId(), title: `${source.title} (fork)` };
      const forked = await d.acp.forkSession(worker, source, draft);
      store.insertConversation({
        id: draft.id, kind: 'code', title: draft.title, avatar: null, memberIds: [worker.id], leadId: null, projectId: source.projectId, hopLimit: 0,
        helpers: source.helpers,
      });
      store.saveAcpSession(worker.id, draft.id, forked.sessionId, forked.cwd);
      store.saveUsage(worker.id, draft.id, store.getAcpSession(worker.id, source.id)!.usage);
      for (const choice of store.listChoices(worker.id, source.id)) store.saveChoice(worker.id, draft.id, choice);
      let seenSeq = 0;
      for (const m of store.messagesAfter(source.id, 0)) {
        const copy = store.insertMessage({
          conversationId: draft.id, author: m.author, parts: m.parts, mentions: m.mentions, status: m.status, createdAt: m.createdAt,
        });
        if (m.id === latest.id) seenSeq = copy.seq;
        events.emit({ type: 'message.upsert', message: publicMessage(copy) });
      }
      // The forked session holds the thread up to the latest reply; anything after it reaches the agent with the next prompt.
      store.saveCursor(worker.id, draft.id, seenSeq, []);
      const created = conversation(draft.id);
      emitConversation(created);
      return created;
    })

    .on('PATCH', '/api/messages/:id', c => {
      const message = store.getMessage(c.params.id);
      if (!message) throw new HttpError(404, 'Message not found.');
      const { chapter } = parse(z.object({ chapter: z.string().trim().min(1).max(CHAPTER_MAX_LENGTH).nullable() }), c.body);
      return runs.setChapter(message, chapter);
    })

    .on('POST', '/api/conversations/:id/session', c => {
      const conv = conversation(c.params.id);
      const a = member(conv, parse(z.object({ agentId: z.string() }), c.body).agentId);
      return a.source === 'acp' ? d.acp.info(a, conv) : noSession(conv, a);
    })

    .on('POST', '/api/conversations/:id/session/option', c => {
      const conv = conversation(c.params.id);
      const body = parse(z.object({ agentId: z.string(), optionId: z.string(), value: z.union([z.string(), z.boolean()]) }), c.body);
      const a = member(conv, body.agentId);
      if (a.source !== 'acp') throw new HttpError(400, 'Only agents on this computer have session options.');
      return d.acp.setOption(a, conv, body.optionId, body.value);
    })

    .on('POST', '/api/permissions/:requestId', c => {
      const body = parse(z.union([z.object({ optionId: z.string() }), z.object({ cancel: z.literal(true) })]), c.body);
      const answered = runs.answerPermission(c.params.requestId, 'optionId' in body ? { optionId: body.optionId } : { cancelled: true });
      if (!answered) throw new HttpError(404, 'This permission request is no longer waiting.');
      return {};
    })

    // ---------- agents ----------

    .on('PATCH', '/api/agents/:id', async c => {
      const a = agent(c.params.id);
      const { subagentModel, ...fields } = parse(z.object({
        name: name.optional(), avatar: avatarSchema.optional(), description: z.string().optional(), hidden: z.boolean().optional(),
        subagentModel: z.string().nullable().optional(),
      }), c.body);
      if (subagentModel !== undefined) {
        if (!a.subagentModel) throw new HttpError(400, `${a.name} has no subagent model setting.`);
        if (subagentModel !== null && !a.subagentModel.choices.some(choice => choice.value === subagentModel)) {
          throw new HttpError(400, `${JSON.stringify(subagentModel)} is not one of ${a.name}'s models.`);
        }
        store.setSubagentModel(a.id, subagentModel);
      }
      const updated = store.updateAgent(a.id, fields);
      events.emit({ type: 'agent.upsert', agent: updated });
      if (fields.name) emitConversation(store.updateConversation(a.chatId, { title: fields.name }));
      if (subagentModel !== undefined && subagentModel !== a.subagentModel!.value) await d.acp.restartForSettings(updated);
      return updated;
    })

    .on('POST', '/api/agents/rescan', () => ({ agents: rescan(store, events, d.catalog) }))

    .on('POST', '/api/agents/:id/options', c => {
      const a = agent(c.params.id);
      return a.source === 'acp' ? d.acp.draftOptions(a) : { agentId: a.id, options: [], ready: true };
    })

    .on('POST', '/api/agents/external', () => ({ instruction: d.external.invite() }))

    .on('POST', '/api/agents/url', async c => ({ agent: await d.urlAgents.connect(parse(connectSchema, c.body)) }))

    .on('POST', '/api/agents/:id/instruction', c => {
      const a = agent(c.params.id);
      if (a.source !== 'external') throw new HttpError(400, 'Only external agents join with an instruction.');
      return { instruction: d.external.instruction(a.id) };
    })

    .on('DELETE', '/api/agents/:id', c => {
      const a = agent(c.params.id);
      if (a.source === 'acp') throw new HttpError(400, 'Installed agents leave when they are uninstalled.');
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
      const body = parse(z.union([z.object({ path: z.string().min(1) }), z.object({ name: z.string().min(1) })]), c.body);
      return 'path' in body ? addFolder(store, events, body.path) : createNamed(store, events, d.projectsDir, body.name);
    })

    .on('DELETE', '/api/projects/:id', c => {
      store.deleteProject(c.params.id);
      events.emit({ type: 'project.removed', projectId: c.params.id });
      return {};
    })

    .on('POST', '/api/fs/pick-folder', async () => ({ path: await pickFolder() }))

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
