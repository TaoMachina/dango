import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { Agent, Conversation, Run, StateResponse } from '../shared/types.ts';
import { fakeEntry, finishedReply, startTestHub, textOf, waitFor, type TestHub } from './helpers.ts';

let t: TestHub;
let one: Agent;
let two: Agent;
before(async () => {
  // One mentions Two and Two mentions One when told to "chain".
  t = await startTestHub([fakeEntry('one', 'One', 'Two Bot'), fakeEntry('two', 'Two Bot', 'One')]);
  [one, two] = (await t.api<StateResponse>('GET', '/api/state')).agents;
});
after(() => t.close());

const group = (title: string) => t.api<Conversation>('POST', '/api/conversations', { kind: 'group', title, memberIds: [one.id, two.id] });
const runsIn = (conversationId: string) => {
  const latest = new Map<string, Run>();
  for (const e of t.events) if (e.type === 'run.upsert' && e.run.conversationId === conversationId) latest.set(e.run.id, e.run);
  return [...latest.values()];
};

test('a group message without a mention goes to the lead only', async () => {
  const g = await group('Plain');
  assert.equal(g.leadId, one.id);
  await t.api('POST', `/api/conversations/${g.id}/messages`, { text: 'hello room' });
  const reply = await finishedReply(t, g.id, one.id);
  assert.equal(textOf(reply), 'One heard: [User]: hello room');
  assert.deepEqual(runsIn(g.id).map(r => r.agentId), [one.id]);
});

test('an @mention with a spaced name reaches only that member', async () => {
  const g = await group('Mention');
  const message = await t.api('POST', `/api/conversations/${g.id}/messages`, { text: 'hey @two bot, take this' });
  assert.deepEqual(message.mentions, [two.id]);
  const reply = await finishedReply(t, g.id, two.id);
  assert.match(textOf(reply), /\[User\]: hey @two bot, take this$/);
  assert.deepEqual(runsIn(g.id).map(r => r.agentId), [two.id]);
});

test('agent mentions hand work on until the hop limit', async () => {
  const g = await group('Chain');
  await t.api('PATCH', `/api/conversations/${g.id}`, { hopLimit: 2 });
  await t.api('POST', `/api/conversations/${g.id}/messages`, { text: 'chain' });
  // depth 0: One, depth 1: Two, depth 2: One. Its mention of Two would be depth 3 > 2.
  await waitFor(() => runsIn(g.id).filter(r => r.status === 'done').length === 3, 'three finished runs');
  await waitFor(() => (t.events.findLast(e => e.type === 'conversation.upsert' && e.conversation.id === g.id) as any)?.conversation.activeRuns === 0, 'idle group');
  const runs = runsIn(g.id);
  assert.deepEqual(runs.map(r => [r.agentId, r.depth]), [[one.id, 0], [two.id, 1], [one.id, 2]]);
  assert.equal(runs[1].parentRunId, runs[0].id);
  assert.equal(runs[2].parentRunId, runs[1].id);
  const last = await finishedReply(t, g.id, one.id, 1);
  // One's second turn sees Two's reply with its author prefix.
  assert.match(textOf(last), /\[Two Bot\]: Two Bot heard: .*chain/);
});
