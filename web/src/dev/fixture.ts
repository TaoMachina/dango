// Dev-only sample hub for visual checks: open the dev server with `?fixture=1`.
// Imported only behind `import.meta.env.DEV`, so production builds drop it.
import type {
  Agent,
  Conversation,
  HubEvent,
  ID,
  Message,
  Part,
  Project,
  Routine,
  Run,
  SessionInfo,
  StateResponse,
} from '../../../shared/types.ts';

const now = Date.now();
const ago = (minutes: number) => new Date(now - minutes * 60_000).toISOString();

function agent(id: ID, name: string, extra: Partial<Agent>): Agent {
  return {
    id,
    name,
    avatar: { kind: 'blob', color: '#2B2B2E', shape: 0, face: 0 },
    description: '',
    source: 'acp',
    catalogId: null,
    runtimeLabel: name,
    environmentId: 'local',
    status: 'ready',
    statusDetail: null,
    hidden: false,
    chatId: `c-${id}`,
    createdAt: ago(60 * 24 * 7),
    ...extra,
  };
}

const agents: Agent[] = [
  agent('claude', 'Claude Code', {
    avatar: { kind: 'blob', color: '#FF8A3D', shape: 3, face: 1 },
    catalogId: 'claude-code',
    description: 'Writes and reviews code in my projects.',
  }),
  agent('codex', 'Codex', { avatar: { kind: 'blob', color: '#2B2B2E', shape: 0, face: 2 }, catalogId: 'codex' }),
  agent('antigravity', 'Antigravity', {
    avatar: { kind: 'blob', color: '#4C8DF6', shape: 2, face: 0 },
    catalogId: 'antigravity',
    runtimeLabel: 'Antigravity',
    status: 'needs-auth',
    statusDetail: 'Run `agy acp --login` in a terminal once to sign in.',
  }),
  agent('goose', 'Goose', { avatar: { kind: 'blob', color: '#3CC48F', shape: 4, face: 4 }, hidden: true, status: 'available' }),
];

function conversation(id: ID, extra: Partial<Conversation>): Conversation {
  return {
    id,
    kind: 'chat',
    title: '',
    avatar: null,
    memberIds: [],
    leadId: null,
    projectId: null,
    hopLimit: 3,
    lastMessage: null,
    activeRuns: 0,
    createdAt: ago(60 * 24 * 7),
    updatedAt: ago(60 * 24 * 7),
    ...extra,
  };
}

const conversations: Conversation[] = [
  ...agents.map((a) => conversation(a.chatId, { title: a.name, memberIds: [a.id] })),
  conversation('g-launch', { kind: 'group', title: 'Launch crew', memberIds: ['claude', 'codex'], leadId: 'claude' }),
  conversation('t-composer', { kind: 'code', title: 'Grow the composer with its text', memberIds: ['claude'], projectId: 'p-agentry' }),
];

const projects: Project[] = [
  { id: 'p-agentry', name: 'agentry', path: 'D:\\projects\\agentry', environmentId: 'local', createdAt: ago(60 * 24 * 3) },
  { id: 'p-site', name: 'site', path: 'D:\\projects\\site', environmentId: 'local', createdAt: ago(60 * 24 * 2) },
];

const routines: Routine[] = [
  {
    id: 'r-morning',
    conversationId: 'c-claude',
    agentId: 'claude',
    title: 'Morning review',
    prompt: 'Summarize yesterday’s commits and open questions.',
    schedule: { kind: 'daily', time: '09:00' },
    enabled: true,
    nextRunAt: ago(-600),
    lastRunAt: ago(800),
  },
];

let seq = 0;
const id = (prefix: string) => `${prefix}-${++seq}`;

function message(conversationId: ID, author: Message['author'], parts: Part[], minutesAgo: number, extra: Partial<Message> = {}): Message {
  return { id: id('m'), conversationId, author, parts, mentions: [], runId: null, status: 'done', createdAt: ago(minutesAgo), ...extra };
}

const user = { type: 'user' } as const;
const by = (agentId: ID) => ({ type: 'agent', agentId }) as const;
const text = (t: string): Part => ({ type: 'text', text: t });

const OLD_COMPOSER = `export function Composer() {
  const [text, setText] = useState('');
  return (
    <textarea
      rows={1}
      value={text}
      onChange={(e) => setText(e.target.value)}
    />
  );
}`;

const NEW_COMPOSER = `export function Composer() {
  const [text, setText] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    ref.current!.style.height = 'auto';
    ref.current!.style.height = \`\${ref.current!.scrollHeight}px\`;
  }, [text]);
  return (
    <textarea
      ref={ref}
      rows={1}
      value={text}
      onChange={(e) => setText(e.target.value)}
      className="max-h-[40dvh]"
    />
  );
}`;

const runs: Run[] = [
  { id: 'run-1', conversationId: 'g-launch', agentId: 'claude', parentRunId: null, triggerMessageId: 'x', depth: 0, status: 'done', error: null, startedAt: ago(40), endedAt: ago(38) },
  { id: 'run-2', conversationId: 'g-launch', agentId: 'codex', parentRunId: 'run-1', triggerMessageId: 'x', depth: 1, status: 'done', error: null, startedAt: ago(38), endedAt: ago(36) },
  { id: 'run-3', conversationId: 't-composer', agentId: 'claude', parentRunId: null, triggerMessageId: 'x', depth: 0, status: 'running', error: null, startedAt: ago(3), endedAt: null },
];

const messages: Message[] = [
  message('c-claude', user, [text('Can you summarize what changed in the hub this week?')], 180),
  message(
    'c-claude',
    by('claude'),
    [
      text(`## Hub changes this week

The scheduler and the external agent API both landed. Highlights:

- **Routines** now fire on time after sleep, using \`nextRunAt\`.
- External agents join with a pasted *instruction* and a per-agent token.
- Groups respect the hop limit:
  1. a person's message starts depth 0
  2. each agent mention adds one

> Stop cancels every active run in the conversation.

\`\`\`ts
const next = schedule.kind === 'daily' ? nextDaily(schedule.time) : null;
\`\`\`

| Area | Status |
| --- | :---: |
| Scheduler | Done |
| External API | Done |
| Remote environments | Planned |

Details are in [the architecture notes](https://agentclientprotocol.com).`),
    ],
    178,
  ),
  message('c-claude', user, [text('Thanks. Keep an eye on the scheduler.')], 30),
  message('c-claude', by('claude'), [text('Will do. I set a routine for 9:00 every morning.')], 29),
  message('c-codex', user, [text('Is the test suite green?')], 60 * 26),
  message('c-codex', by('codex'), [text('Yes. 42 tests passed in 3.1s.')], 60 * 26 - 1),
  message('c-goose', user, [text('Hello')], 60 * 24 * 5),
  message('g-launch', { type: 'system' }, [text('Claude Code and Codex joined the group.')], 60),
  message('g-launch', user, [text('@Claude Code draft the release notes for 0.2, then have Codex check the links.')], 41, { mentions: ['claude'] }),
  message('g-launch', by('claude'), [text('Draft is ready: routines, external agents, and group hop limits.')], 39, { runId: 'run-1' }),
  message('g-launch', by('claude'), [text('@Codex can you check the changelog links?')], 38, { runId: 'run-1', mentions: ['codex'] }),
  message('g-launch', by('codex'), [text('Checked. Two links were stale; both now point at the 0.2 tag.')], 36, { runId: 'run-2' }),
  message('t-composer', user, [text('The composer should grow with the text. Fix it.')], 4),
  message(
    't-composer',
    by('claude'),
    [
      { type: 'thought', text: 'The textarea has rows={1} and never resizes. Setting height from scrollHeight on each change is enough; cap it so the conversation stays visible.' },
      { type: 'tool', toolCallId: 'tc-read', title: 'Read web/src/Composer.tsx', kind: 'read', status: 'completed', locations: ['web/src/Composer.tsx'], content: [{ type: 'text', text: OLD_COMPOSER }] },
      {
        type: 'plan',
        entries: [
          { content: 'Measure scrollHeight after each change', status: 'completed', priority: 'high' },
          { content: 'Cap the height at 40% of the viewport', status: 'completed', priority: 'medium' },
          { content: 'Run the type check', status: 'in_progress', priority: 'medium' },
        ],
      },
      { type: 'tool', toolCallId: 'tc-edit', title: 'Edit web/src/Composer.tsx', kind: 'edit', status: 'completed', locations: ['web/src/Composer.tsx'], content: [{ type: 'diff', path: 'web/src/Composer.tsx', oldText: OLD_COMPOSER, newText: NEW_COMPOSER }] },
      { type: 'tool', toolCallId: 'tc-new', title: 'Write web/src/lib/grow.ts', kind: 'edit', status: 'failed', locations: [], content: [{ type: 'diff', path: 'web/src/lib/grow.ts', oldText: null, newText: 'export const MAX = "40dvh";' }] },
      text('The textarea now grows with its content and stops at 40% of the window.'),
      { type: 'tool', toolCallId: 'tc-check', title: 'npm run check', kind: 'execute', status: 'in_progress', locations: [], content: [] },
      {
        type: 'permission',
        requestId: 'perm-1',
        title: 'Allow **Claude Code** to run `npm run build`?',
        options: [
          { optionId: 'allow', name: 'Allow once', kind: 'allow_once' },
          { optionId: 'always', name: 'Always allow', kind: 'allow_always' },
          { optionId: 'reject', name: 'Reject', kind: 'reject_once' },
        ],
        outcome: null,
      },
    ],
    3,
    { runId: 'run-3', status: 'streaming' },
  ),
];

function refreshConversation(c: Conversation) {
  const last = messages.filter((m) => m.conversationId === c.id).at(-1);
  if (!last) return;
  const t = last.parts.find((p) => p.type === 'text');
  const author = last.author.type === 'agent' ? (agents.find((a) => a.id === (last.author as { agentId: ID }).agentId)?.name ?? '') : 'You';
  c.lastMessage = { authorName: author, text: t && t.type === 'text' ? t.text.replace(/[#*`>|]/g, '').trim().split('\n')[0] : '…', at: last.createdAt };
  c.updatedAt = last.createdAt;
}
conversations.forEach(refreshConversation);
conversations.find((c) => c.id === 't-composer')!.activeRuns = 1;

const claudeOptions: SessionInfo['options'] = [
  {
    id: 'mode',
    name: 'Mode',
    description: null,
    category: 'mode',
    type: 'select',
    currentValue: 'default',
    choices: [
      { value: 'default', name: 'Default', description: 'Ask before edits and commands' },
      { value: 'acceptEdits', name: 'Accept edits', description: 'Edit files without asking' },
      { value: 'plan', name: 'Plan', description: 'Read and plan only' },
      { value: 'auto', name: 'Auto', description: null },
      { value: 'bypassPermissions', name: 'Bypass permissions', description: 'Never ask' },
    ],
  },
  {
    id: 'model',
    name: 'Model',
    description: null,
    category: 'model',
    type: 'select',
    currentValue: 'opus',
    choices: [
      { value: 'opus', name: 'Opus', description: 'Most capable' },
      { value: 'sonnet', name: 'Sonnet', description: 'Fast and capable' },
    ],
  },
  {
    id: 'effort',
    name: 'Effort',
    description: null,
    category: 'thought_level',
    type: 'select',
    currentValue: 'high',
    choices: ['low', 'medium', 'high'].map((v) => ({ value: v, name: v, description: null })),
  },
];

const codexOptions: SessionInfo['options'] = [
  {
    id: 'mode',
    name: 'Mode',
    description: null,
    category: 'mode',
    type: 'select',
    currentValue: 'workspace-write',
    choices: ['read-only', 'workspace-write', 'agent', 'agent-full-access'].map((v) => ({ value: v, name: v, description: null })),
  },
  {
    id: 'model',
    name: 'Model',
    description: null,
    category: 'model',
    type: 'select',
    currentValue: 'gpt-6.1',
    choices: [
      { value: 'gpt-6.1', name: 'GPT-6.1', description: null },
      { value: 'gpt-6.1-mini', name: 'GPT-6.1 mini', description: null },
    ],
  },
  {
    id: 'reasoning_effort',
    name: 'Reasoning effort',
    description: null,
    category: 'thought_level',
    type: 'select',
    currentValue: 'high',
    choices: ['minimal', 'low', 'medium', 'high'].map((v) => ({ value: v, name: v, description: null })),
  },
  { id: 'fast-mode', name: 'Fast mode', description: 'Faster replies, less thinking', category: 'speed', type: 'boolean', currentValue: false },
];

const sessions = new Map<string, SessionInfo>();

function session(conversationId: ID, agentId: ID): SessionInfo {
  const key = `${conversationId}:${agentId}`;
  if (!sessions.has(key)) {
    const options = agentId === 'claude' ? claudeOptions : agentId === 'codex' ? codexOptions : [];
    sessions.set(key, {
      conversationId,
      agentId,
      options: structuredClone(options),
      commands: agentId === 'claude' ? [{ name: 'review', description: 'Review the current changes' }, { name: 'init', description: 'Write CLAUDE.md' }] : [],
    });
  }
  return sessions.get(key)!;
}

// ---------- Events ----------

const listeners = new Set<(event: HubEvent) => void>();

function emit(event: HubEvent) {
  for (const listener of listeners) listener(event);
}

export function fixtureEvents(listener: (event: HubEvent) => void) {
  listeners.add(listener);
}

const stopped = new Set<ID>();

// The fake agent streams one word per tick so the streaming path is visible.
const TICK_MS = 60;

function reply(conversationId: ID, agentId: ID, words: string[]) {
  const c = conversations.find((x) => x.id === conversationId)!;
  const run: Run = { id: id('run'), conversationId, agentId, parentRunId: null, triggerMessageId: '', depth: 0, status: 'running', error: null, startedAt: new Date().toISOString(), endedAt: null };
  const m = message(conversationId, by(agentId), [], 0, { runId: run.id, status: 'streaming', createdAt: new Date().toISOString() });
  messages.push(m);
  c.activeRuns++;
  stopped.delete(conversationId);
  emit({ type: 'run.upsert', run });
  emit({ type: 'conversation.upsert', conversation: { ...c } });
  emit({ type: 'message.upsert', message: structuredClone(m) });
  let i = 0;
  const timer = setInterval(() => {
    const done = i >= words.length || stopped.has(conversationId);
    if (done) {
      clearInterval(timer);
      m.status = stopped.has(conversationId) ? 'stopped' : 'done';
      run.status = m.status === 'stopped' ? 'stopped' : 'done';
      c.activeRuns--;
      refreshConversation(c);
      emit({ type: 'message.upsert', message: structuredClone(m) });
      emit({ type: 'run.upsert', run: { ...run } });
      emit({ type: 'conversation.upsert', conversation: { ...c } });
      return;
    }
    const word = (i === 0 ? '' : ' ') + words[i++];
    if (m.parts.length === 0) {
      m.parts.push(text(word));
      emit({ type: 'message.part', conversationId, messageId: m.id, partIndex: 0, part: text(word) });
    } else {
      (m.parts[0] as { text: string }).text += word;
      emit({ type: 'message.append', conversationId, messageId: m.id, partIndex: 0, text: word });
    }
  }, TICK_MS);
}

// ---------- HTTP ----------

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function folders(path: string | null) {
  if (path === null) return { path: null, parent: null, entries: [{ name: 'Home', path: 'C:\\Users\\dev' }, { name: 'D:', path: 'D:\\' }] };
  const base = path.endsWith('\\') ? path : `${path}\\`;
  const depth = path.split('\\').filter(Boolean).length;
  const names = depth >= 4 ? [] : ['projects', 'notes', 'sandbox'];
  return { path, parent: depth > 1 ? path.split('\\').slice(0, -1).join('\\') : null, entries: names.map((name) => ({ name, path: base + name })) };
}

export async function fixtureFetch(url: string, init: RequestInit): Promise<Response> {
  const method = init.method ?? 'GET';
  const body = init.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : {};
  const path = url.split('?')[0];
  const query = new URLSearchParams(url.split('?')[1] ?? '');
  let m: RegExpMatchArray | null;

  if (method === 'GET' && path === '/api/state') {
    const state: StateResponse = {
      environments: [{ id: 'local', name: 'Workstation', kind: 'local', online: true }],
      agents: structuredClone(agents),
      conversations: structuredClone(conversations),
      projects: structuredClone(projects),
      routines: structuredClone(routines),
    };
    return json(state);
  }
  if ((m = path.match(/^\/api\/conversations\/([^/]+)\/messages$/))) {
    const cid = m[1];
    if (method === 'GET') {
      const all = messages.filter((x) => x.conversationId === cid);
      const before = query.get('before');
      const end = before ? all.findIndex((x) => x.id === before) : all.length;
      return json({ messages: structuredClone(all.slice(0, end)), runs: runs.filter((r) => r.conversationId === cid), hasMore: false });
    }
    const c = conversations.find((x) => x.id === cid)!;
    const sent = message(cid, user, [text(body.text as string)], 0, { mentions: (body.mentions as ID[]) ?? [], createdAt: new Date().toISOString() });
    messages.push(sent);
    refreshConversation(c);
    emit({ type: 'conversation.upsert', conversation: { ...c } });
    const targets = c.kind === 'group' ? (sent.mentions.length ? sent.mentions : [c.leadId!]) : [c.memberIds[0]];
    for (const target of targets) {
      if (agents.find((a) => a.id === target)?.status === 'needs-auth') continue;
      setTimeout(() => reply(cid, target, `Got it. This is a sample reply from the fixture, streamed word by word so you can watch it arrive.`.split(' ')), 400);
    }
    return json(sent);
  }
  if (method === 'POST' && (m = path.match(/^\/api\/conversations\/([^/]+)\/stop$/))) {
    stopped.add(m[1]);
    return json({});
  }
  if ((m = path.match(/^\/api\/conversations\/([^/]+)\/session$/))) {
    const agentId = body.agentId as ID;
    if (agents.find((a) => a.id === agentId)?.status === 'needs-auth') return json({ error: 'Antigravity needs a sign-in before it can start.' }, 409);
    return json(session(m[1], agentId));
  }
  if ((m = path.match(/^\/api\/conversations\/([^/]+)\/session\/option$/))) {
    const s = session(m[1], body.agentId as ID);
    const option = s.options.find((o) => o.id === body.optionId)!;
    option.currentValue = body.value as never;
    emit({ type: 'session.upsert', session: structuredClone(s) });
    return json(structuredClone(s));
  }
  if ((m = path.match(/^\/api\/conversations\/([^/]+)$/))) {
    const index = conversations.findIndex((x) => x.id === m![1]);
    if (method === 'DELETE') {
      conversations.splice(index, 1);
      return json({});
    }
    Object.assign(conversations[index], body);
    return json(structuredClone(conversations[index]));
  }
  if (method === 'POST' && path === '/api/conversations') {
    const c =
      body.kind === 'group'
        ? conversation(id('g'), { kind: 'group', title: body.title as string, memberIds: body.memberIds as ID[], leadId: (body.leadId as ID) ?? null })
        : conversation(id('t'), { kind: 'code', title: 'New thread', memberIds: [body.agentId as ID], projectId: body.projectId as ID });
    conversations.push(c);
    return json(c);
  }
  if ((m = path.match(/^\/api\/permissions\/([^/]+)$/))) {
    const owner = messages.find((x) => x.parts.some((p) => p.type === 'permission' && p.requestId === m![1]))!;
    const index = owner.parts.findIndex((p) => p.type === 'permission');
    const part = { ...(owner.parts[index] as Extract<Part, { type: 'permission' }>), outcome: { optionId: body.optionId as string } };
    owner.parts[index] = part;
    setTimeout(() => emit({ type: 'message.part', conversationId: owner.conversationId, messageId: owner.id, partIndex: index, part }), 300);
    return json({});
  }
  if (method === 'POST' && path === '/api/agents/rescan') return json({ agents: structuredClone(agents) });
  if (method === 'POST' && path === '/api/agents/external') {
    const a = agent(id('ext'), body.name as string, { source: 'external', runtimeLabel: 'External agent', status: 'offline', avatar: { kind: 'blob', color: '#7B6CF6', shape: 5, face: 3 } });
    agents.push(a);
    conversations.push(conversation(a.chatId, { title: a.name, memberIds: [a.id] }));
    emit({ type: 'conversation.upsert', conversation: structuredClone(conversations.at(-1)!) });
    return json({
      agent: a,
      instruction: `You are joining Agentry as "${a.name}".\n\n1. Read your inbox: GET http://127.0.0.1:7420/api/external/inbox\n2. Post replies: POST http://127.0.0.1:7420/api/external/messages\n\nUse this header on every request:\nAuthorization: Bearer agentry_sample_token\n\nSay hello in your chat when you are connected.`,
    });
  }
  if ((m = path.match(/^\/api\/agents\/([^/]+)$/))) {
    const a = agents.find((x) => x.id === m![1])!;
    Object.assign(a, body);
    return json(structuredClone(a));
  }
  if (method === 'POST' && path === '/api/fs/list') return json(folders(body.path as string | null));
  if (method === 'POST' && path === '/api/projects') {
    const p = body.path as string;
    const project: Project = { id: id('p'), name: p.split(/[\\/]/).filter(Boolean).pop()!, path: p, environmentId: 'local', createdAt: new Date().toISOString() };
    projects.push(project);
    return json(project);
  }
  if (method === 'POST' && path === '/api/routines') {
    const r: Routine = { id: id('r'), ...(body as Pick<Routine, 'conversationId' | 'agentId' | 'title' | 'prompt' | 'schedule'>), enabled: true, nextRunAt: null, lastRunAt: null };
    routines.push(r);
    return json(r);
  }
  if ((m = path.match(/^\/api\/routines\/([^/]+)\/run$/))) {
    const r = routines.find((x) => x.id === m![1])!;
    setTimeout(() => reply(r.conversationId, r.agentId, `Running "${r.title}" now.`.split(' ')), 200);
    return json({});
  }
  if ((m = path.match(/^\/api\/routines\/([^/]+)$/))) {
    const index = routines.findIndex((x) => x.id === m![1]);
    if (method === 'DELETE') {
      routines.splice(index, 1);
      return json({});
    }
    Object.assign(routines[index], body);
    return json(structuredClone(routines[index]));
  }
  if (method === 'POST' && path === '/api/shutdown') return json({});
  return json({ error: `Fixture has no route for ${method} ${path}` }, 404);
}
