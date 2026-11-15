import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { Agent, Conversation, Message, Part, Project, StateResponse } from '../shared/types.ts';
import { HttpError } from '../server/projects.ts';
import { fakeEntry, finishedReply, startTestHub, textOf, waitFor, type TestHub } from './helpers.ts';

// The hub waits 300 ms for a helper: long enough for a warm fake agent's answer, shorter than its "later" reply (1 s).
const WAIT_MS = 300;

let t: TestHub;
let one: Agent;
let two: Agent;
let three: Agent;
let project: Project;
before(async () => {
  t = await startTestHub([fakeEntry('one', 'One'), fakeEntry('two', 'Two'), fakeEntry('three', 'Three')], { delegateWaitMs: WAIT_MS });
  [one, two, three] = (await t.api<StateResponse>('GET', '/api/state')).agents;
  project = await t.api<Project>('POST', '/api/projects', { name: 'work' });
  // Helper options are validated against what each agent reported, so let both report once.
  for (const a of [two, three]) {
    await t.api('POST', `/api/agents/${a.id}/options`);
    await waitFor(() => t.events.some(e => e.type === 'agent.options' && e.options.agentId === a.id && e.options.ready), `${a.name} options`);
  }
});
after(() => t.close());

type Subagent = Extract<Part, { type: 'subagent' }>;
const thread = (agentId: string, title: string) => t.api<Conversation>('POST', '/api/conversations', { kind: 'code', projectId: project.id, agentId, title });
const send = (conversationId: string, text: string) => t.api('POST', `/api/conversations/${conversationId}/messages`, { text });
const patchHelpers = (conversationId: string, helpers: unknown) => t.raw('PATCH', `/api/conversations/${conversationId}`, { cookie: t.cookie }, { helpers });
// The main agent's turn stays open on "slow" until it is stopped, as a real agent's turn does while its tool call waits.
async function openTurn(c: Conversation) {
  await send(c.id, 'slow');
  return waitFor(() => [...t.hub.runs.lives.values()].find(l => l.conversation.id === c.id && l.message), 'main agent turn');
}
const caller = (c: Conversation) => ({ agentId: one.id, conversationId: c.id });

test('helpers start as every other coding agent, and a valid change becomes the start of new threads', async () => {
  const c = await thread(one.id, 'Defaults');
  assert.deepEqual(c.helpers, [
    { agentId: two.id, enabled: true, options: [] },
    { agentId: three.id, enabled: true, options: [] },
  ]);
  assert.equal(c.parentId, null);
  assert.equal((await patchHelpers(c.id, [{ agentId: one.id, enabled: true, options: [] }])).status, 400, 'the thread\'s own agent');
  assert.equal((await patchHelpers(c.id, [{ agentId: two.id, enabled: true, options: [{ optionId: 'model', value: 'huge' }] }])).status, 400, 'an unknown model');
  const chat = (await t.api<StateResponse>('GET', '/api/state')).conversations.find(x => x.id === one.chatId)!;
  assert.equal((await patchHelpers(chat.id, [])).status, 400, 'a chat has no helpers');

  const patched = await patchHelpers(c.id, [
    { agentId: two.id, enabled: true, options: [{ optionId: 'model', value: 'large' }] },
    { agentId: three.id, enabled: false, options: [] },
  ]);
  assert.equal(patched.status, 200);
  const expected = [
    { agentId: two.id, enabled: true, options: [{ optionId: 'model', value: 'large' }] },
    { agentId: three.id, enabled: false, options: [] },
  ];
  assert.deepEqual(patched.body.helpers, expected);
  assert.deepEqual((await thread(one.id, 'Next')).helpers, expected);
  // Another main agent starts from the same settings for the agents it can use.
  assert.deepEqual((await thread(two.id, 'Two leads')).helpers, [{ agentId: one.id, enabled: true, options: [] }, expected[1]]);
});

test('the context lists the enabled helpers, and an open session hears a change', async () => {
  const c = await thread(one.id, 'Context');
  await send(c.id, 'echo first');
  const first = textOf(await finishedReply(t, c.id, one.id));
  assert.match(first, /Helpers: Two \(Two; model: large; effort: its default\)\. They are other coding agents/);
  assert.match(first, /agentry_delegate/);
  assert.doesNotMatch(first, /Three \(/);
  await patchHelpers(c.id, [{ agentId: three.id, enabled: true, options: [{ optionId: 'effort', value: 'high' }] }]);
  await send(c.id, 'echo second');
  assert.match(textOf(await finishedReply(t, c.id, one.id, 1)), /Helper update: Helpers: Two \(Two; model: large; effort: its default\), Three \(Three; model: its default; effort: high\)\./);
  await patchHelpers(c.id, [{ agentId: three.id, enabled: false, options: [] }]);
});

test('a delegated task runs the helper in the same project with its chosen options and returns its answer', async () => {
  const c = await thread(one.id, 'Delegate');
  const turn = await openTurn(c);
  const answer = await t.hub.tools.delegate(caller(c), { helper: 'two', task: 'settings', title: 'Check settings' });
  assert.equal(answer.status, 'done');
  assert.ok('result' in answer);
  // The task reached the helper as coming from the main agent, with the helper's model applied before its first prompt.
  assert.equal(answer.result, 'Two heard: From One: settings model=large fast=true');

  const child = (await t.api<StateResponse>('GET', '/api/state')).conversations.find(x => x.parentId === c.id)!;
  assert.equal(child.title, 'Check settings');
  assert.equal(child.projectId, project.id);
  assert.deepEqual(child.memberIds, [two.id]);
  assert.deepEqual(child.helpers, []);
  assert.equal(t.hub.store.getAcpSession(two.id, child.id)!.cwd, project.path);

  const part = turn.parts.find((p): p is Subagent => p.type === 'subagent')!;
  assert.deepEqual(part, {
    type: 'subagent', sessionId: child.id, title: 'Check settings', description: 'settings', state: 'idle',
    activity: 'Two heard: From One: settings model=large fast=true', model: 'large', agentId: two.id, conversationId: child.id,
  });
  await t.api('POST', `/api/conversations/${c.id}/stop`);
});

test('a helper that outlasts the wait answers running, and wait_for_helper returns its answer later', async () => {
  const c = await thread(one.id, 'Long task');
  await openTurn(c);
  const first = await t.hub.tools.delegate(caller(c), { helper: 'Two', task: 'later' });
  assert.equal(first.status, 'running');
  assert.ok('delegationId' in first);
  // Each call waits up to the budget; the helper answers within a few.
  let done = await t.hub.tools.waitForHelper(caller(c), { delegationId: first.delegationId });
  while (done.status === 'running') done = await t.hub.tools.waitForHelper(caller(c), { delegationId: first.delegationId });
  assert.equal(done.status, 'done');
  assert.ok('result' in done);
  assert.equal(done.result, 'Two heard: From One: later done later');
  // Another thread cannot wait on it.
  const other = await thread(one.id, 'Other');
  await assert.rejects(t.hub.tools.waitForHelper(caller(other), { delegationId: first.delegationId }), (e: HttpError) => e.status === 404);
  await t.api('POST', `/api/conversations/${c.id}/stop`);
});

test('a disabled or unknown helper is refused', async () => {
  const c = await thread(one.id, 'Refused');
  await openTurn(c);
  await assert.rejects(t.hub.tools.delegate(caller(c), { helper: 'Three', task: 'settings' }),
    (e: HttpError) => e.status === 403 && e.message === '"Three" is not an enabled helper in this thread. Enabled helpers: Two.');
  await assert.rejects(t.hub.tools.delegate(caller(c), { helper: 'Nobody', task: 'settings' }), (e: HttpError) => e.status === 403);
  assert.equal((await t.api<StateResponse>('GET', '/api/state')).conversations.filter(x => x.parentId === c.id).length, 0);
  await t.api('POST', `/api/conversations/${c.id}/stop`);
});

test('Stop in the main thread stops the helper\'s thread', async () => {
  const c = await thread(one.id, 'Stop both');
  await openTurn(c);
  const first = await t.hub.tools.delegate(caller(c), { helper: 'Two', task: 'slow' });
  assert.equal(first.status, 'running');
  assert.ok('delegationId' in first);
  await t.api('POST', `/api/conversations/${c.id}/stop`);
  const stopped = await t.hub.tools.waitForHelper(caller(c), { delegationId: first.delegationId });
  assert.equal(stopped.status, 'stopped');
  // The main agent's reply had already ended when the helper stopped, so its stored copy shows the outcome.
  const { messages } = await t.api<{ messages: Message[] }>('GET', `/api/conversations/${c.id}/messages`);
  const reply = messages.find(m => m.author.type === 'agent')!;
  assert.equal(reply.status, 'stopped');
  const part = reply.parts.find((p): p is Subagent => p.type === 'subagent')!;
  assert.equal(part.state, 'idle');
  assert.equal(part.activity, 'Stopped');
});
