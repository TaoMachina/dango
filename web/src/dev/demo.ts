// Dev-only scripted hub for the promo video: open the dev server with `?fixture=demo&m=chat&c=g-crew`.
// It plays one story on a fixed timeline: Codex finds a bug in Claude Code's work, Claude Code fixes it
// in a Code thread, asks for permission to run the tests, and Codex checks the fix as a helper.
// The person's three clicks (the thread link, Allow once, Open helper) come from whoever drives the page;
// the timings below expect them at 4.0 s, 8.4 s and 11.0 s after the first state load.
// Imported only behind `import.meta.env.DEV`, so production builds drop it.
import type { Agent, Conversation, HubEvent, ID, Message, Part, Project, Run, SessionInfo, StateResponse } from '../../../shared/types.ts';

const start = Date.now();
const ago = (minutes: number) => new Date(start - minutes * 60_000).toISOString();
const at = () => new Date().toISOString();

function agent(id: ID, name: string, color: string, shape: number, face: number, catalogId: string): Agent {
  return {
    id, name, avatar: { kind: 'blob', color, shape, face }, description: '', source: 'acp', catalogId, runtimeLabel: name,
    environmentId: 'local', status: 'ready', statusDetail: null, apiHost: null, hidden: false, chatId: `c-${id}`,
    subagentModel: null, createdAt: ago(60 * 24 * 7),
  };
}

const agents: Agent[] = [
  agent('claude', 'Claude Code', '#FF8A3D', 3, 1, 'claude-code'),
  agent('codex', 'Codex', '#2B2B2E', 0, 2, 'codex'),
  agent('antigravity', 'Antigravity', '#4C8DF6', 2, 0, 'antigravity'),
  agent('openclaw', 'OpenClaw', '#E5484D', 1, 3, 'openclaw'),
  agent('hermes', 'Hermes', '#8E6CEF', 4, 4, 'hermes'),
];

function conversation(id: ID, extra: Partial<Conversation>): Conversation {
  return {
    id, kind: 'chat', title: '', avatar: null, memberIds: [], leadId: null, projectId: null, helpers: [], parentId: null,
    hopLimit: 3, lastMessage: null, activeRuns: 0, createdAt: ago(60 * 24 * 7), updatedAt: ago(60 * 24 * 7), ...extra,
  };
}

const conversations: Conversation[] = [
  ...agents.map((a) => conversation(a.chatId, { title: a.name, memberIds: [a.id] })),
  conversation('g-crew', { kind: 'group', title: 'Ship dark mode', avatar: { kind: 'blob', color: '#F06FB0', shape: 0, face: 0 }, memberIds: ['claude', 'codex'], leadId: 'claude' }),
  conversation('t-search', { kind: 'code', title: 'Add search to the notes list', memberIds: ['codex'], projectId: 'p-notes' }),
  conversation('t-sync', { kind: 'code', title: 'Fix the flaky sync test', memberIds: ['claude'], projectId: 'p-notes' }),
  conversation('t-rate', { kind: 'code', title: 'Rate-limit the login route', memberIds: ['codex'], projectId: 'p-api' }),
];

const projects: Project[] = [
  { id: 'p-notes', name: 'notes-app', path: '/Users/dev/projects/notes-app', environmentId: 'local', createdAt: ago(60 * 24 * 3) },
  { id: 'p-api', name: 'api', path: '/Users/dev/projects/api', environmentId: 'local', createdAt: ago(60 * 24 * 2) },
];

let seq = 0;
const id = (prefix: string) => `${prefix}-${++seq}`;
const user = { type: 'user' } as const;
const by = (agentId: ID) => ({ type: 'agent', agentId }) as const;
const text = (t: string): Part => ({ type: 'text', text: t });

function message(conversationId: ID, author: Message['author'], parts: Part[], createdAt: string, extra: Partial<Message> = {}): Message {
  return { id: id('m'), conversationId, author, parts, mentions: [], runId: null, status: 'done', chapter: null, createdAt, ...extra };
}

const runs: Run[] = [];
function run(conversationId: ID, agentId: ID, parentRunId: ID | null, startedAt = at(), status: Run['status'] = 'running'): Run {
  const r: Run = { id: id('run'), conversationId, agentId, parentRunId, triggerMessageId: 'x', depth: parentRunId ? 1 : 0, status, error: null, startedAt, endedAt: null };
  runs.push(r);
  return r;
}

// ---------- The story's starting point ----------

const leadRun = run('g-crew', 'claude', null, ago(6), 'done');
const messages: Message[] = [
  message('c-claude', user, [text('What changed in the sync code this week?')], ago(60 * 3)),
  message('c-claude', by('claude'), [text('Two fixes landed: retries back off now, and deleted notes stop syncing back.')], ago(60 * 3 - 1)),
  message('c-codex', by('codex'), [text('All 24 tests pass.')], ago(60 * 20)),
  message('c-antigravity', by('antigravity'), [text('The landing page draft is in /site.')], ago(60 * 26)),
  message('c-openclaw', by('openclaw'), [text('Your flight to Lisbon is confirmed.')], ago(60 * 30)),
  message('c-hermes', by('hermes'), [text('Inbox summary: 3 replies need you today.')], ago(60 * 50)),
  message('g-crew', { type: 'system' }, [text('Claude Code and Codex joined the group.')], ago(30)),
  message('g-crew', user, [text('Add a dark mode toggle to settings, then have Codex review it.')], ago(7)),
  message('g-crew', by('claude'), [text('Done. The toggle is in **Settings → Appearance**.')], ago(5), { runId: leadRun.id }),
  message('g-crew', by('claude'), [text('@Codex can you review it?')], ago(5), { runId: leadRun.id, mentions: ['codex'] }),
  message('t-search', user, [text('Add a search box above the notes list. Match titles and bodies.')], ago(4)),
  message('t-search', by('codex'), [{ type: 'tool', toolCallId: 's1', title: 'Edit src/notes/NotesList.tsx', kind: 'edit', status: 'in_progress', locations: [], content: [] }], ago(1), { status: 'streaming', runId: run('t-search', 'codex', null, ago(4)).id }),
  message('t-sync', user, [text('The sync test fails one run in ten. Find out why.')], ago(3)),
  message('t-sync', by('claude'), [{ type: 'tool', toolCallId: 'y1', title: 'npm test -- sync.spec.ts', kind: 'execute', status: 'in_progress', locations: [], content: [] }], ago(1), { status: 'streaming', runId: run('t-sync', 'claude', null, ago(3)).id }),
  message('t-rate', user, [text('Limit login attempts to 5 a minute per address.')], ago(60)),
  message('t-rate', by('codex'), [text('Done. The sixth attempt within a minute gets a 429, and tests cover it.')], ago(52)),
];
conversations.find((c) => c.id === 't-search')!.activeRuns = 1;
conversations.find((c) => c.id === 't-sync')!.activeRuns = 1;

function refresh(c: Conversation) {
  const last = messages.filter((m) => m.conversationId === c.id && m.author.type !== 'system').at(-1);
  if (!last) return;
  const t = last.parts.find((p) => p.type === 'text');
  const author = last.author.type === 'agent' ? (agents.find((a) => a.id === (last.author as { agentId: ID }).agentId)?.name ?? '') : 'You';
  c.lastMessage = { authorName: author, text: t && t.type === 'text' ? t.text.replace(/[#*`>|]/g, '').trim().split('\n')[0] : '…', at: last.createdAt };
  c.updatedAt = last.createdAt;
}
conversations.forEach(refresh);

// ---------- Sessions ----------

const choices = (list: [string, string][]) => list.map(([value, name]) => ({ value, name, description: null }));
const select = (id: string, name: string, category: string, currentValue: string, list: [string, string][]) =>
  ({ id, name, description: null, category, type: 'select' as const, currentValue, choices: choices(list) });

const options: Record<ID, SessionInfo['options']> = {
  claude: [select('model', 'Model', 'model', 'opus', [['opus', 'Opus'], ['sonnet', 'Sonnet']]), select('effort', 'Effort', 'thought_level', 'high', [['high', 'High']])],
  codex: [select('model', 'Model', 'model', 'gpt', [['gpt', 'GPT-6.1 Sol']]), select('reasoning_effort', 'Reasoning effort', 'thought_level', 'high', [['high', 'High']])],
};
const modes: Record<ID, SessionInfo['options'][number]> = {
  claude: select('mode', 'Mode', 'mode', 'default', [['default', 'Default']]),
  codex: select('mode', 'Access', 'mode', 'workspace-write', [['workspace-write', 'Workspace write']]),
};

function session(conversationId: ID, agentId: ID): SessionInfo {
  const code = conversations.find((c) => c.id === conversationId)?.kind === 'code';
  const list = options[agentId] ?? [];
  return { conversationId, agentId, options: code ? [modes[agentId], ...list] : list, commands: [], usage: code ? { used: 38_000, size: 200_000 } : null, ready: true };
}

// ---------- Events ----------

const listeners = new Set<(event: HubEvent) => void>();
const emit = (event: HubEvent) => listeners.forEach((listener) => listener(structuredClone(event)));

export function fixtureEvents(listener: (event: HubEvent) => void) {
  listeners.add(listener);
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const conv = (cid: ID) => conversations.find((c) => c.id === cid)!;

function upsertConversation(c: Conversation) {
  refresh(c);
  emit({ type: 'conversation.upsert', conversation: c });
}

function post(cid: ID, author: Message['author'], parts: Part[], extra: Partial<Message> = {}) {
  const m = message(cid, author, parts, at(), extra);
  messages.push(m);
  emit({ type: 'message.upsert', message: m });
  upsertConversation(conv(cid));
  return m;
}

function setPart(m: Message, index: number, part: Part) {
  m.parts[index] = part;
  emit({ type: 'message.part', conversationId: m.conversationId, messageId: m.id, partIndex: index, part });
}

function addPart(m: Message, part: Part) {
  setPart(m, m.parts.length, part);
  return m.parts.length - 1;
}

// Agents stream a few words at a time; 45 ms per word reads as fast typing on video.
const WORD_MS = 45;

async function stream(m: Message, words: string) {
  const index = addPart(m, text(''));
  for (const [i, word] of words.split(' ').entries()) {
    const piece = (i === 0 ? '' : ' ') + word;
    (m.parts[index] as { text: string }).text += piece;
    emit({ type: 'message.append', conversationId: m.conversationId, messageId: m.id, partIndex: index, text: piece });
    await wait(WORD_MS);
  }
  upsertConversation(conv(m.conversationId));
}

async function tool(m: Message, title: string, kind: string, ms: number, content: Extract<Part, { type: 'tool' }>['content'] = []) {
  const toolCallId = id('tool');
  const index = addPart(m, { type: 'tool', toolCallId, title, kind, status: 'in_progress', locations: [], content: [] });
  await wait(ms);
  setPart(m, index, { type: 'tool', toolCallId, title, kind, status: 'completed', locations: [], content });
}

function startRun(cid: ID, agentId: ID, parentRunId: ID | null) {
  const r = run(cid, agentId, parentRunId);
  conv(cid).activeRuns++;
  emit({ type: 'run.upsert', run: r });
  upsertConversation(conv(cid));
  return r;
}

function finish(m: Message, r: Run) {
  m.status = 'done';
  r.status = 'done';
  r.endedAt = at();
  conv(m.conversationId).activeRuns--;
  emit({ type: 'message.upsert', message: m });
  emit({ type: 'run.upsert', run: r });
  upsertConversation(conv(m.conversationId));
}

// ---------- The story ----------

const THEME_OLD = `export function ThemeToggle() {
  const [theme, setTheme] = useState('light');
  return <Switch checked={theme === 'dark'} onChange={(dark) => setTheme(dark ? 'dark' : 'light')} />;
}`;
const THEME_NEW = `export function ThemeToggle() {
  const [theme, setTheme] = useState(savedTheme);
  useEffect(() => localStorage.setItem('theme', theme), [theme]);
  return <Switch checked={theme === 'dark'} onChange={(dark) => setTheme(dark ? 'dark' : 'light')} />;
}`;
const MAIN_OLD = `createRoot(document.getElementById('root')!).render(<App />);`;
const MAIN_NEW = `document.documentElement.dataset.theme = savedTheme();
createRoot(document.getElementById('root')!).render(<App />);`;

let allowed: () => void = () => {};

async function story() {
  // Group: Codex reviews and finds the bug.
  const codexRun = startRun('g-crew', 'codex', leadRun.id);
  const review = post('g-crew', by('codex'), [], { runId: codexRun.id, status: 'streaming', mentions: ['claude'] });
  await wait(300);
  await stream(review, '@Claude Code one bug: the theme resets on reload. Nothing saves the choice.');
  finish(review, codexRun);

  // Claude Code answers and starts a Code thread. The pause leaves time to read Codex's review.
  await wait(1200);
  const fixRun = startRun('g-crew', 'claude', codexRun.id);
  const ack = post('g-crew', by('claude'), [], { runId: fixRun.id, status: 'streaming' });
  await stream(ack, 'Good catch. I’ll fix it in a Code thread.');
  finish(ack, fixRun);
  const thread = conversation('t-theme', {
    kind: 'code', title: 'Remember the theme choice', memberIds: ['claude'], projectId: 'p-notes',
    helpers: [{ agentId: 'codex', enabled: true, options: [] }],
  });
  conversations.push(thread);
  emit({ type: 'conversation.upsert', conversation: thread });
  post('t-theme', user, [text('From Claude Code: The dark mode choice resets on reload. Save it and restore it on start.')]);
  post('g-crew', { type: 'system' }, [text('Claude Code started the code task [Remember the theme choice](?m=code&c=t-theme) for Claude Code in notes-app.')]);

  // The Code thread: read, plan, edit, then ask to run the tests.
  const workRun = startRun('t-theme', 'claude', null);
  const work = post('t-theme', by('claude'), [], { runId: workRun.id, status: 'streaming' });
  await wait(400);
  addPart(work, { type: 'thought', text: 'The toggle keeps the theme in state only. Save it to localStorage and apply it before the first render.' });
  await wait(900);
  await tool(work, 'Read src/settings/ThemeToggle.tsx', 'read', 400, [{ type: 'text', text: THEME_OLD }]);
  await tool(work, 'Search "theme" in src', 'search', 300, [{ type: 'text', text: 'src/settings/ThemeToggle.tsx:2\nsrc/main.tsx:1' }]);
  const planIndex = addPart(work, { type: 'plan', entries: [
    { content: 'Save the choice when it changes', status: 'in_progress', priority: 'high' },
    { content: 'Restore it before the first render', status: 'pending', priority: 'high' },
    { content: 'Run the tests', status: 'pending', priority: 'medium' },
  ] });
  await wait(600);
  await tool(work, 'Edit src/settings/ThemeToggle.tsx', 'edit', 500, [{ type: 'diff', path: 'src/settings/ThemeToggle.tsx', oldText: THEME_OLD, newText: THEME_NEW }]);
  setPart(work, planIndex, { type: 'plan', entries: [
    { content: 'Save the choice when it changes', status: 'completed', priority: 'high' },
    { content: 'Restore it before the first render', status: 'in_progress', priority: 'high' },
    { content: 'Run the tests', status: 'pending', priority: 'medium' },
  ] });
  await wait(400);
  await tool(work, 'Edit src/main.tsx', 'edit', 500, [{ type: 'diff', path: 'src/main.tsx', oldText: MAIN_OLD, newText: MAIN_NEW }]);
  setPart(work, planIndex, { type: 'plan', entries: [
    { content: 'Save the choice when it changes', status: 'completed', priority: 'high' },
    { content: 'Restore it before the first render', status: 'completed', priority: 'high' },
    { content: 'Run the tests', status: 'in_progress', priority: 'medium' },
  ] });
  await wait(400);
  const testIndex = addPart(work, { type: 'tool', toolCallId: 'npm-test', title: 'npm test', kind: 'execute', status: 'pending', locations: [], content: [] });
  addPart(work, {
    type: 'permission', requestId: 'perm-test', title: 'Allow **Claude Code** to run `npm test`?', outcome: null,
    options: [
      { optionId: 'allow', name: 'Allow once', kind: 'allow_once' },
      { optionId: 'always', name: 'Always allow', kind: 'allow_always' },
      { optionId: 'reject', name: 'Reject', kind: 'reject_once' },
    ],
  });
  await new Promise<void>((resolve) => (allowed = resolve));

  // Allowed: the tests run, then Codex checks the fix as a helper.
  setPart(work, testIndex, { type: 'tool', toolCallId: 'npm-test', title: 'npm test', kind: 'execute', status: 'in_progress', locations: [], content: [] });
  await wait(900);
  setPart(work, testIndex, { type: 'tool', toolCallId: 'npm-test', title: 'npm test', kind: 'execute', status: 'completed', locations: [], content: [{ type: 'text', text: '26 passed' }] });
  setPart(work, planIndex, { type: 'plan', entries: [
    { content: 'Save the choice when it changes', status: 'completed', priority: 'high' },
    { content: 'Restore it before the first render', status: 'completed', priority: 'high' },
    { content: 'Run the tests', status: 'completed', priority: 'medium' },
  ] });
  await wait(300);
  const helper = conversation('t-review', { kind: 'code', title: 'Check the theme survives a reload', memberIds: ['codex'], projectId: 'p-notes', parentId: 't-theme', hopLimit: 0 });
  conversations.push(helper);
  emit({ type: 'conversation.upsert', conversation: helper });
  post('t-review', user, [text('From Claude Code: Reload the app in each theme and confirm the choice sticks.')]);
  const sub = { type: 'subagent', sessionId: 't-review', title: 'Check the theme survives a reload', description: 'Reload the app in each theme and confirm the choice sticks.', state: 'running', activity: null, model: 'GPT-6.1 Sol', agentId: 'codex', conversationId: 't-review' } as const;
  const subIndex = addPart(work, { ...sub });
  const helperRun = startRun('t-review', 'codex', null);
  const check = post('t-review', by('codex'), [], { runId: helperRun.id, status: 'streaming' });
  await wait(300);
  setPart(work, subIndex, { ...sub, activity: 'npm run e2e -- theme.spec.ts' });
  await tool(check, 'npm run e2e -- theme.spec.ts', 'execute', 2200, [{ type: 'text', text: '3 passed (light, dark, system)' }]);
  await wait(200);
  await stream(check, 'Reloaded in light, dark and system. The choice sticks every time. **Approved.**');
  finish(check, helperRun);
  setPart(work, subIndex, { ...sub, state: 'idle', activity: 'Approved' });

  // Meanwhile another thread in the list finishes.
  const sync = messages.find((m) => m.conversationId === 't-sync' && m.status === 'streaming')!;
  await stream(sync, 'Found it: the test raced the save timer. It now waits for the save.');
  finish(sync, runs.find((r) => r.id === sync.runId)!);

  await wait(400);
  await stream(work, 'Fixed. The theme is saved and restored before the first render. Tests pass, and Codex approved.');
  finish(work, workRun);
}

// ---------- HTTP ----------

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

let started = false;

export async function fixtureFetch(url: string, init: RequestInit): Promise<Response> {
  const method = init.method ?? 'GET';
  const body = init.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : {};
  const path = url.split('?')[0];
  let m: RegExpMatchArray | null;

  if (method === 'GET' && path === '/api/state') {
    // The story starts with the first state load, so the recorder's clock and the story share one origin.
    if (!started) {
      started = true;
      void story();
    }
    const state: StateResponse = {
      environments: [{ id: 'local', name: 'Workstation', kind: 'local', online: true }],
      agents, conversations, projects, routines: [],
    };
    return json(structuredClone(state));
  }
  if (method === 'GET' && (m = path.match(/^\/api\/conversations\/([^/]+)\/messages$/))) {
    const cid = m[1];
    return json(structuredClone({ messages: messages.filter((x) => x.conversationId === cid), runs: runs.filter((r) => r.conversationId === cid), hasMore: false }));
  }
  if ((m = path.match(/^\/api\/conversations\/([^/]+)\/session$/))) return json(session(m[1], body.agentId as ID));
  if (method === 'GET' && (m = path.match(/^\/api\/conversations\/([^/]+)\/info$/))) {
    const project = projects.find((p) => p.id === conv(m![1]).projectId);
    return json({ environment: 'Workstation', folder: project?.path ?? null, branch: 'fix/theme' });
  }
  if ((m = path.match(/^\/api\/agents\/([^/]+)\/options$/))) return json({ agentId: m[1], options: options[m[1]] ?? [], ready: true });
  if (method === 'POST' && path === '/api/agents/rescan') return json({ agents });
  if ((m = path.match(/^\/api\/permissions\/([^/]+)$/))) {
    const owner = messages.find((x) => x.parts.some((p) => p.type === 'permission' && p.requestId === m![1]))!;
    const index = owner.parts.findIndex((p) => p.type === 'permission');
    setPart(owner, index, { ...(owner.parts[index] as Extract<Part, { type: 'permission' }>), outcome: { optionId: body.optionId as string } });
    allowed();
    return json({});
  }
  throw new Error(`Demo fixture has no route for ${method} ${path}`);
}
