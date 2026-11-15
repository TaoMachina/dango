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

test('removing a member stops its runs and routines there, and a handoff to it afterwards starts nothing', async () => {
  const g = await group('Shrink');
  await t.api('POST', '/api/routines', { conversationId: g.id, agentId: two.id, title: 'Report', prompt: 'report', schedule: { kind: 'daily', time: '09:00' } });
  // Two's turn stays open until it is stopped; One mentions Two at once and finishes its turn later.
  await t.api('POST', `/api/conversations/${g.id}/messages`, { text: '@Two Bot slow' });
  await t.api('POST', `/api/conversations/${g.id}/messages`, { text: 'chain later' });
  await waitFor(() => t.events.some(e => e.type === 'message.append' && e.conversationId === g.id && e.text.includes('@Two Bot chain')), 'One mentions Two');
  await waitFor(() => runsIn(g.id).some(r => r.agentId === two.id && r.status === 'running'), 'Two running');
  await t.api('PATCH', `/api/conversations/${g.id}`, { memberIds: [one.id] });

  await waitFor(() => runsIn(g.id).some(r => r.agentId === two.id && r.status === 'stopped'), 'Two stopped');
  assert.equal(t.hub.store.listRoutines().filter(r => r.conversationId === g.id).length, 0);
  await waitFor(() => runsIn(g.id).some(r => r.agentId === one.id && r.status === 'done'), 'One done');
  // One's reply mentions Two, who is no longer a member. Its run's end has been handled once its event arrived.
  assert.deepEqual(t.hub.store.activeRuns(g.id), []);
  assert.deepEqual(runsIn(g.id).filter(r => r.agentId === two.id).map(r => r.status), ['stopped']);
});

test('deleting a group closes its agent sessions', async () => {
  const g = await group('Gone');
  await t.api('POST', `/api/conversations/${g.id}/messages`, { text: 'hello' });
  await finishedReply(t, g.id, one.id);
  await t.api('DELETE', `/api/conversations/${g.id}`);
  await t.api('POST', `/api/conversations/${one.chatId}/messages`, { text: 'closed' });
  // The session/close request reaches the agent before this later prompt.
  assert.match(textOf(await finishedReply(t, one.chatId, one.id)), /closed=One-session-\d+$/);
});
