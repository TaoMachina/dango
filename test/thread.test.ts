import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import type { Agent, Conversation, Message, Part, Project, StateResponse, ThreadInfo } from '../shared/types.ts';
import { findOnPath, type CatalogEntry } from '../server/agents/catalog.ts';
import { fakeEntry, finishedReply, startTestHub, textOf, waitFor, type TestHub } from './helpers.ts';

// The fake agent reports the subagent model it was started with, so the test sees the launch environment.
const withSubagentModel: CatalogEntry = { ...fakeEntry('one', 'One'), subagentModelEnv: model => ({ FAKE_SUBAGENT_MODEL: model }) };

let t: TestHub;
let one: Agent;
let two: Agent;
let project: Project;
before(async () => {
  t = await startTestHub([withSubagentModel, fakeEntry('two', 'Two')]);
  [one, two] = (await t.api<StateResponse>('GET', '/api/state')).agents;
  project = await t.api<Project>('POST', '/api/projects', { name: 'work' });
});
after(() => t.close());

const thread = (title: string) =>
  t.api<Conversation>('POST', '/api/conversations', { kind: 'code', projectId: project.id, agentId: one.id, title });
const send = (conversationId: string, text: string) => t.api('POST', `/api/conversations/${conversationId}/messages`, { text });
const messages = async (conversationId: string) => (await t.api<{ messages: Message[] }>('GET', `/api/conversations/${conversationId}/messages`)).messages;
type Subagent = Extract<Part, { type: 'subagent' }>;

test('a subagent and its own session updates become one live part of the reply', async () => {
  const c = await thread('Subagent');
  await send(c.id, 'subagent');
  const reply = await finishedReply(t, c.id, one.id);
  const parts = reply.parts.filter((p): p is Subagent => p.type === 'subagent');
  assert.deepEqual(parts, [{
    type: 'subagent', sessionId: parts[0].sessionId, title: 'Helper', description: 'Writes a.txt', state: 'idle',
    activity: 'Done writing', model: 'Small model', agentId: null, conversationId: null,
  }]);
  const live = t.events.flatMap(e => (e.type === 'message.part' && e.messageId === reply.id && e.part.type === 'subagent' ? [e.part] : []));
  assert.ok(live.some(p => p.state === 'running' && p.activity === 'Write a.txt'));
  // The child session starts no run or message of its own.
  assert.equal((await messages(c.id)).filter(m => m.author.type === 'agent').length, 1);
});

test('a code thread forks from its latest reply into a new thread that continues the native session', async () => {
  const c = await thread('Fix bug');
  await send(c.id, 'first');
  const firstReply = await finishedReply(t, c.id, one.id);
  await send(c.id, 'second');
  const latest = await finishedReply(t, c.id, one.id, 1);

  const stale = await t.raw('POST', `/api/conversations/${c.id}/fork`, { cookie: t.cookie }, { messageId: firstReply.id });
  assert.equal(stale.status, 400);
  assert.match(stale.body.error, /latest reply/);

  await t.api('PATCH', `/api/messages/${latest.id}`, { chapter: 'Second step' });
  const fork = await t.api<Conversation>('POST', `/api/conversations/${c.id}/fork`, { messageId: latest.id });
  assert.equal(fork.title, 'Fix bug (fork)');
  assert.equal(fork.kind, 'code');
  assert.equal(fork.projectId, project.id);
  await waitFor(() => t.events.some(e => e.type === 'conversation.upsert' && e.conversation.id === fork.id), 'fork upsert');
  const copied = await messages(fork.id);
  assert.deepEqual(copied.map(textOf), (await messages(c.id)).map(textOf));
  assert.ok(copied.every(m => m.chapter === null && m.runId === null && m.conversationId === fork.id));

  await send(fork.id, 'history');
  // The forked session remembers the source thread, and the copied messages are not sent again.
  assert.equal(textOf(await finishedReply(t, fork.id, one.id, 2)), 'One heard: history history=first | second');
});

test('a message is pinned as a chapter and unpinned', async () => {
  const c = await thread('Chapters');
  await send(c.id, 'hello');
  const reply = await finishedReply(t, c.id, one.id);
  const pinned = await t.api<Message>('PATCH', `/api/messages/${reply.id}`, { chapter: '  Set up the page  ' });
  assert.equal(pinned.chapter, 'Set up the page');
  await waitFor(() => t.events.some(e => e.type === 'message.upsert' && e.message.id === reply.id && e.message.chapter === 'Set up the page'), 'chapter upsert');
  assert.equal((await messages(c.id)).find(m => m.id === reply.id)!.chapter, 'Set up the page');
  assert.equal((await t.raw('PATCH', `/api/messages/${reply.id}`, { cookie: t.cookie }, { chapter: 'x'.repeat(81) })).status, 400);
  assert.equal((await t.api<Message>('PATCH', `/api/messages/${reply.id}`, { chapter: null })).chapter, null);
});

test('thread info names the computer, the folder and its git branch', async () => {
  const c = await thread('Info');
  const info = await t.api<ThreadInfo>('GET', `/api/conversations/${c.id}/info`);
  assert.equal(info.folder, project.path);
  assert.equal(info.branch, null);
  assert.ok(info.environment);

  // Creating a repository needs git; without it on PATH the branch case cannot be set up.
  if (!findOnPath('git')) return;
  const repo = join(t.hub.paths.dir, 'repo');
  mkdirSync(repo);
  const git = (...args: string[]) => execFileSync('git', ['-C', repo, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args]);
  git('init', '-b', 'feature-x');
  git('commit', '--allow-empty', '-m', 'start');
  const repoProject = await t.api<Project>('POST', '/api/projects', { path: repo });
  const inRepo = await t.api<Conversation>('POST', '/api/conversations', { kind: 'code', projectId: repoProject.id, agentId: one.id, title: 'Repo' });
  assert.equal((await t.api<ThreadInfo>('GET', `/api/conversations/${inRepo.id}/info`)).branch, 'feature-x');
});

test('the subagent model is chosen from the agent\'s models and reaches its process at the next start', async () => {
  // The choices come from the session the earlier tests opened.
  const agent = (await t.api<StateResponse>('GET', '/api/state')).agents.find(a => a.id === one.id)!;
  assert.deepEqual(agent.subagentModel, { value: null, choices: [{ value: 'small', name: 'small' }, { value: 'large', name: 'large' }] });
  assert.equal((await t.api<StateResponse>('GET', '/api/state')).agents.find(a => a.id === two.id)!.subagentModel, null);
  assert.equal((await t.raw('PATCH', `/api/agents/${one.id}`, { cookie: t.cookie }, { subagentModel: 'huge' })).status, 400);
  assert.equal((await t.raw('PATCH', `/api/agents/${two.id}`, { cookie: t.cookie }, { subagentModel: 'small' })).status, 400);

  const c = await thread('Env');
  await send(c.id, 'env');
  assert.match(textOf(await finishedReply(t, c.id, one.id)), /subagentModel=none$/);
  // The agent was idle, so it restarts before the request returns.
  const updated = await t.api<Agent>('PATCH', `/api/agents/${one.id}`, { subagentModel: 'large' });
  assert.equal(updated.subagentModel!.value, 'large');
  await send(c.id, 'env');
  assert.match(textOf(await finishedReply(t, c.id, one.id, 1)), /subagentModel=large$/);
});
