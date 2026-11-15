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
  ThreadInfo,
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
    apiHost: null,
    hidden: false,
    chatId: `c-${id}`,
    subagentModel: null,
    createdAt: ago(60 * 24 * 7),
    ...extra,
  };
}

const agents: Agent[] = [
  agent('claude', 'Claude Code', {
    avatar: { kind: 'blob', color: '#FF8A3D', shape: 3, face: 1 },
    catalogId: 'claude-code',
    description: 'Writes and reviews code in my projects.',
    subagentModel: {
      value: null,
      choices: [
        { value: 'opus', name: 'Opus' },
        { value: 'sonnet', name: 'Sonnet' },
        { value: 'haiku', name: 'Haiku' },
      ],
    },
  }),
  // Codex reports no subagent model setting.
  agent('codex', 'Codex', { avatar: { kind: 'blob', color: '#2B2B2E', shape: 0, face: 2 }, catalogId: 'codex', subagentModel: null }),
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
  conversation('t-links', { kind: 'code', title: 'Fix stale changelog links', memberIds: ['codex'], projectId: 'p-site' }),
  // The child thread of a subagent that Claude Code handed to Codex.
  conversation('t-helper', { kind: 'code', title: 'Review textarea sizing', memberIds: ['codex'], projectId: 'p-agentry' }),
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
  return { id: id('m'), conversationId, author, parts, mentions: [], runId: null, status: 'done', chapter: null, createdAt: ago(minutesAgo), ...extra };
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

const OLD_CHANGELOG = `## 0.2

- Routines and external agents. [0.2](https://example.com/releases/tag/v0.1)
- See the [notes](https://example.com/releases/tag/v0.1.0).`;

const NEW_CHANGELOG = `## 0.2

- Routines and external agents. [0.2](https://example.com/releases/tag/v0.2)
- See the [notes](https://example.com/releases/tag/v0.2.0).`;

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
  message('t-links', user, [text('Two changelog links point at old tags. Fix them.')], 90),
  message(
    't-links',
    by('codex'),
    [
      { type: 'thought', text: 'Find every changelog link first, then check each tag. A subagent can scan the docs folder while I fix the two known links.' },
      { type: 'tool', toolCallId: 'tc-l-grep', title: 'rg "releases/tag" CHANGELOG.md docs', kind: 'execute', status: 'completed', locations: [], content: [{ type: 'text', text: 'CHANGELOG.md:12: [0.2](https://example.com/releases/tag/v0.1)\nCHANGELOG.md:30: [notes](https://example.com/releases/tag/v0.1.0)' }] },
      { type: 'tool', toolCallId: 'tc-l-sub-start', title: 'Start subagent scan_docs', kind: 'other', status: 'completed', locations: [], content: [] },
      { type: 'thought', text: 'While scan_docs runs, fix the two links in CHANGELOG.md.' },
      { type: 'tool', toolCallId: 'tc-l-read', title: 'Read CHANGELOG.md', kind: 'read', status: 'completed', locations: ['D:\\projects\\site\\CHANGELOG.md'], content: [] },
      { type: 'tool', toolCallId: 'tc-l-edit', title: 'Edit CHANGELOG.md', kind: 'edit', status: 'completed', locations: ['D:\\projects\\site\\CHANGELOG.md'], content: [{ type: 'diff', path: 'D:\\projects\\site\\CHANGELOG.md', oldText: OLD_CHANGELOG, newText: NEW_CHANGELOG }] },
      { type: 'tool', toolCallId: 'tc-l-wait', title: 'wait', kind: 'other', status: 'completed', locations: [], content: [] },
      { type: 'tool', toolCallId: 'tc-l-sub-done', title: 'Complete subagent scan_docs', kind: 'other', status: 'completed', locations: [], content: [{ type: 'text', text: 'No other stale links in docs/.' }] },
      { type: 'tool', toolCallId: 'tc-l-test', title: 'npm run check-links', kind: 'execute', status: 'completed', locations: [], content: [{ type: 'text', text: '38 links checked, 0 broken' }] },
      text('Both links now point at the **0.2** tag. The `scan_docs` subagent found no other stale links, and `npm run check-links` passes.'),
    ],
    88,
  ),
  message('t-composer', user, [text('Look at how the composer sizes itself before changing anything.\nKeep it short.')], 30),
  message(
    't-composer',
    by('claude'),
    [
      { type: 'tool', toolCallId: 'tc-a-read', title: 'Read web/src/Composer.tsx', kind: 'read', status: 'completed', locations: ['web/src/Composer.tsx'], content: [{ type: 'text', text: OLD_COMPOSER }] },
      text('The composer is a fixed one-row `textarea`. Nothing measures its content, so long prompts scroll inside one line.'),
    ],
    28,
    { chapter: 'Composer audit' },
  ),
  message('t-composer', user, [text('The composer should grow with the text. Fix it.')], 4),
  message(
    't-composer',
    by('claude'),
    [
      { type: 'thought', text: 'The textarea has rows={1} and never resizes. Setting height from scrollHeight on each change is enough; cap it so the conversation stays visible.' },
      { type: 'tool', toolCallId: 'tc-read', title: 'Read web/src/Composer.tsx', kind: 'read', status: 'completed', locations: ['web/src/Composer.tsx'], content: [{ type: 'text', text: OLD_COMPOSER }] },
      { type: 'tool', toolCallId: 'tc-search', title: 'Search "rows={1}" in web/src', kind: 'search', status: 'completed', locations: [], content: [{ type: 'text', text: 'web/src/Composer.tsx:4\nweb/src/NoteEditor.tsx:9' }] },
      { type: 'tool', toolCallId: 'tc-read-2', title: 'Read web/src/NoteEditor.tsx', kind: 'read', status: 'completed', locations: ['web/src/NoteEditor.tsx'], content: [] },
      { type: 'tool', toolCallId: 'tc-git', title: 'git status --short', kind: 'execute', status: 'completed', locations: [], content: [{ type: 'text', text: ' M web/src/NoteEditor.tsx' }] },
      {
        type: 'tool',
        toolCallId: 'tc-task',
        title: 'Check other textareas for the same issue',
        kind: 'think',
        status: 'completed',
        locations: [],
        content: [{ type: 'text', text: 'NoteEditor.tsx has the same fixed one-row textarea. No other textareas found.' }],
      },
      { type: 'subagent', sessionId: 'sub-find', title: 'Find fixed-height textareas', description: 'Search web/src for one-row textareas', state: 'idle', activity: 'Found 2 matches', model: 'Haiku 4.5', agentId: null, conversationId: null },
      { type: 'subagent', sessionId: 'sub-keyboard', title: 'Check mobile keyboard overlap', description: 'See whether a tall composer hides the last message on phones', state: 'running', activity: 'Reading web/src/app/Shell.tsx', model: 'Sonnet 4.6', agentId: null, conversationId: null },
      { type: 'subagent', sessionId: 'sub-codex', title: null, description: 'Second opinion on the height cap', state: 'running', activity: 'Running npm run check', model: 'GPT-6.1 Sol', agentId: 'codex', conversationId: 't-helper' },
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

messages.push(
  message('t-helper', user, [text('Review the textarea growth cap in web/src/Composer.tsx. Is 40dvh right on phones?')], 2),
  message('t-helper', by('codex'), [{ type: 'tool', toolCallId: 'tc-h-check', title: 'npm run check', kind: 'execute', status: 'in_progress', locations: [], content: [] }], 1, { runId: 'run-helper', status: 'streaming' }),
);
runs.push({ id: 'run-helper', conversationId: 't-helper', agentId: 'codex', parentRunId: null, triggerMessageId: 'x', depth: 0, status: 'running', error: null, startedAt: ago(1), endedAt: null });

// Where each Code thread works; a thread in a new folder outside git has no branch.
const branches: Record<ID, string> = { 't-composer': 'feat/composer-grow', 't-helper': 'feat/composer-grow', 't-links': 'main' };

function threadInfo(c: Conversation): ThreadInfo {
  const project = projects.find((p) => p.id === c.projectId);
  return { environment: 'Workstation', folder: project?.path ?? null, branch: branches[c.id] ?? null };
}

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
conversations.find((c) => c.id === 't-helper')!.activeRuns = 1;

type Options = SessionInfo['options'];

const choices = (list: [string, string, string | null][]) => list.map(([value, name, description]) => ({ value, name, description }));

// Chat and group sessions: the hub sends only model and effort.
const chatOptions: Record<ID, Options> = {
  claude: [
    {
      id: 'model',
      name: 'Model',
      description: null,
      category: 'model',
      type: 'select',
      currentValue: 'opus',
      choices: choices([
        ['opus', 'Opus', 'Most capable for complex work'],
        ['sonnet', 'Sonnet', 'Fast and capable for everyday tasks'],
        ['haiku', 'Haiku', 'Fastest for quick answers'],
      ]),
    },
    {
      id: 'effort',
      name: 'Effort',
      description: null,
      category: 'thought_level',
      type: 'select',
      currentValue: 'high',
      choices: choices([['low', 'Low', null], ['medium', 'Medium', null], ['high', 'High', null], ['max', 'Max', null]]),
    },
  ],
  codex: [
    {
      id: 'model',
      name: 'Model',
      description: null,
      category: 'model',
      type: 'select',
      currentValue: 'gpt-6.1-sol',
      choices: choices([
        ['gpt-6.1-sol', 'GPT-6.1 Sol', 'Frontier model for long agentic work'],
        ['gpt-6.1-sol-mini', 'GPT-6.1 Sol Mini', 'Faster and cheaper'],
      ]),
    },
    {
      id: 'reasoning_effort',
      name: 'Reasoning effort',
      description: null,
      category: 'thought_level',
      type: 'select',
      currentValue: 'high',
      // Lowercase names, as some agents report them; the web app capitalizes for display.
      choices: choices([['low', 'low', null], ['medium', 'medium', null], ['high', 'high', null], ['xhigh', 'Extra high', null]]),
    },
  ],
};

// Code threads add the access mode and the agent's other options.
const codeOptions: Record<ID, Options> = {
  claude: [
    {
      id: 'mode',
      name: 'Mode',
      description: null,
      category: 'mode',
      type: 'select',
      currentValue: 'default',
      choices: choices([
        ['default', 'Default', 'Ask before edits and commands'],
        ['acceptEdits', 'Accept edits', 'Edit files without asking'],
        ['plan', 'Plan', 'Read and plan only'],
        ['bypassPermissions', 'Full access', 'Never ask'],
      ]),
    },
    ...chatOptions.claude,
  ],
  codex: [
    {
      id: 'mode',
      name: 'Access',
      description: null,
      category: 'mode',
      type: 'select',
      currentValue: 'workspace-write',
      choices: choices([
        ['read-only', 'Read only', 'Read files; ask before any change'],
        ['workspace-write', 'Workspace write', 'Edit files in this project; ask before anything else'],
        ['full-access', 'Full access', 'Edit anywhere and use the network without asking'],
      ]),
    },
    ...chatOptions.codex,
    {
      id: 'collaboration_mode',
      name: 'Collaboration mode',
      description: null,
      category: 'collaboration_mode',
      type: 'select',
      currentValue: 'default',
      choices: choices([['default', 'Default', null], ['plan', 'Plan', null]]),
    },
    { id: 'fast_mode', name: 'Fast mode', description: 'Faster replies, less thinking', category: 'speed', type: 'boolean', currentValue: false },
  ],
};

// Context window use from each conversation's last session; null hides the ring.
const usage: Record<ID, SessionInfo['usage']> = {
  'c-claude': { used: 12_400, size: 200_000 },
  't-composer': { used: 191_000, size: 200_000 },
  't-links': { used: 172_400, size: 200_000 },
};

// A visible delay so the not-ready path shows in the fixture; it models no real agent.
const START_MS = 900;

const sessions = new Map<string, SessionInfo>();

function session(conversationId: ID, agentId: ID): SessionInfo {
  const key = `${conversationId}:${agentId}`;
  if (!sessions.has(key)) {
    const code = conversations.find((c) => c.id === conversationId)!.kind === 'code';
    const s: SessionInfo = {
      conversationId,
      agentId,
      options: structuredClone((code ? codeOptions : chatOptions)[agentId] ?? []),
      commands: agentId === 'claude' ? [{ name: 'review', description: 'Review the current changes' }, { name: 'init', description: 'Write CLAUDE.md' }] : [],
      usage: usage[conversationId] ?? null,
      ready: false,
    };
    sessions.set(key, s);
    setTimeout(() => {
      s.ready = true;
      emit({ type: 'session.upsert', session: structuredClone(s) });
    }, START_MS);
  }
  return structuredClone(sessions.get(key)!);
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
    session(m[1], body.agentId as ID);
    const s = sessions.get(`${m[1]}:${body.agentId as ID}`)!;
    const option = s.options.find((o) => o.id === body.optionId)!;
    option.currentValue = body.value as never;
    emit({ type: 'session.upsert', session: structuredClone(s) });
    return json(structuredClone(s));
  }
  if (method === 'GET' && (m = path.match(/^\/api\/conversations\/([^/]+)\/info$/))) {
    return json(threadInfo(conversations.find((x) => x.id === m![1])!));
  }
  if (method === 'POST' && (m = path.match(/^\/api\/conversations\/([^/]+)\/fork$/))) {
    const source = conversations.find((x) => x.id === m![1])!;
    const fork = conversation(id('t'), { kind: 'code', title: `${source.title} (fork)`, memberIds: source.memberIds, projectId: source.projectId });
    const history = messages.filter((x) => x.conversationId === source.id);
    const end = history.findIndex((x) => x.id === body.messageId) + 1;
    for (const x of history.slice(0, end)) messages.push({ ...structuredClone(x), id: id('m'), conversationId: fork.id, chapter: null });
    conversations.push(fork);
    refreshConversation(fork);
    if (branches[source.id]) branches[fork.id] = branches[source.id];
    emit({ type: 'conversation.upsert', conversation: structuredClone(fork) });
    return json(structuredClone(fork));
  }
  if (method === 'PATCH' && (m = path.match(/^\/api\/messages\/([^/]+)$/))) {
    const x = messages.find((y) => y.id === m![1])!;
    x.chapter = body.chapter as string | null;
    emit({ type: 'message.upsert', message: structuredClone(x) });
    return json(structuredClone(x));
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
    return json({
      instruction: `You are invited to join Agentry.\n\nAgentry hub: http://127.0.0.1:7420\nYour token: sample_token\n\n1. Say hello once with your own name:\ncurl -s -X POST http://127.0.0.1:7420/agent-api/hello -H "Authorization: Bearer sample_token" -d '{"name":"<your name>"}'`,
    });
  }
  if ((m = path.match(/^\/api\/agents\/([^/]+)$/))) {
    const a = agents.find((x) => x.id === m![1])!;
    const { subagentModel, ...rest } = body;
    if (subagentModel !== undefined) a.subagentModel = { ...a.subagentModel!, value: subagentModel as string | null };
    Object.assign(a, rest);
    return json(structuredClone(a));
  }
  if (method === 'POST' && path === '/api/fs/pick-folder') return json({ path: 'D:\\projects\\notes' });
  if (method === 'POST' && path === '/api/projects') {
    const p = (body.path as string | undefined) ?? `C:\\Users\\dev\\Agentry\\projects\\${body.name as string}`;
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
