import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { Agent, Message, Part, StateResponse } from '../shared/types.ts';
import { fakeEntry, finishedReply, startTestHub, textOf, waitFor, type TestHub } from './helpers.ts';

let t: TestHub;
let one: Agent;
before(async () => {
  t = await startTestHub([fakeEntry('one', 'One')]);
  one = (await t.api<StateResponse>('GET', '/api/state')).agents[0];
});
after(() => t.close());

test('an installed agent appears with its chat and greeting', async () => {
  const state = await t.api<StateResponse>('GET', '/api/state');
  assert.equal(one.name, 'One');
  assert.equal(one.status, 'available');
  const chat = state.conversations.find(c => c.id === one.chatId)!;
  assert.equal(chat.kind, 'chat');
  assert.deepEqual(chat.memberIds, [one.id]);
  assert.equal(chat.lastMessage?.text, 'One is connected on this computer.');
});

test('a chat message runs the agent, streams the reply and finishes', async () => {
  await t.api('POST', `/api/conversations/${one.chatId}/messages`, { text: 'hi tool' });
  const reply = await finishedReply(t, one.chatId, one.id);
  assert.equal(reply.status, 'done');
  assert.equal(textOf(reply), 'One heard: hi tool');
  const tool = reply.parts.find(p => p.type === 'tool') as Extract<Part, { type: 'tool' }>;
  assert.equal(tool.status, 'completed');
  assert.deepEqual(tool.content, [{ type: 'diff', path: '/tmp/a.txt', oldText: 'a', newText: 'b' }]);
  assert.ok(t.events.some(e => e.type === 'message.part' && e.messageId === reply.id));
  const run = await waitFor(() => t.events.findLast(e => e.type === 'run.upsert' && e.run.id === reply.runId && e.run.status === 'done'), 'run done');
  assert.ok(run);
  const page = await t.api<{ messages: Message[] }>('GET', `/api/conversations/${one.chatId}/messages`);
  assert.equal(textOf(page.messages.at(-1)!), 'One heard: hi tool');
});

test('session options come from the agent and can be changed', async () => {
  const info = await t.api('POST', `/api/conversations/${one.chatId}/session`, { agentId: one.id });
  assert.equal(info.options[0].id, 'model');
  assert.equal(info.options[0].currentValue, 'small');
  const changed = await t.api('POST', `/api/conversations/${one.chatId}/session/option`, { agentId: one.id, optionId: 'model', value: 'large' });
  assert.equal(changed.options[0].currentValue, 'large');
});

test('a permission request waits for the person and returns the chosen option', async () => {
  await t.api('POST', `/api/conversations/${one.chatId}/messages`, { text: 'permission please' });
  const request = await waitFor(() => {
    const e = t.events.find(e => e.type === 'message.part' && e.part.type === 'permission');
    return e && e.type === 'message.part' && e.part.type === 'permission' ? e.part : undefined;
  }, 'permission card');
  assert.deepEqual(request.options.map(o => o.optionId), ['allow', 'reject']);
  await t.api('POST', `/api/permissions/${request.requestId}`, { optionId: 'allow' });
  const reply = await finishedReply(t, one.chatId, one.id, 1);
  assert.match(textOf(reply), /chose allow$/);
  const card = reply.parts.find(p => p.type === 'permission');
  assert.deepEqual(card && card.type === 'permission' && card.outcome, { optionId: 'allow' });
});

test('stop cancels the run and ignores chunks that arrive afterwards', async () => {
  await t.api('POST', `/api/conversations/${one.chatId}/messages`, { text: 'slow' });
  const streaming = await waitFor(() => {
    const e = t.events.findLast(e => e.type === 'message.append' && e.conversationId === one.chatId);
    return e?.type === 'message.append' ? e : t.events.findLast(e => e.type === 'message.part' && e.conversationId === one.chatId && e.part.type === 'text' && e.part.text.includes('slow'));
  }, 'first chunk');
  assert.ok(streaming);
  await t.api('POST', `/api/conversations/${one.chatId}/stop`);
  const reply = await finishedReply(t, one.chatId, one.id, 2);
  assert.equal(reply.status, 'stopped');
  const state = await t.api<StateResponse>('GET', '/api/state');
  assert.equal(state.conversations.find(c => c.id === one.chatId)!.activeRuns, 0);

  // The next turn waits for the agent to end the cancelled one, which sends " late" first.
  await t.api('POST', `/api/conversations/${one.chatId}/messages`, { text: 'again' });
  assert.equal(textOf(await finishedReply(t, one.chatId, one.id, 3)), 'One heard: again');
  const page = await t.api<{ messages: Message[] }>('GET', `/api/conversations/${one.chatId}/messages`);
  const stored = page.messages.find(m => m.id === reply.id)!;
  assert.equal(stored.status, 'stopped');
  assert.equal(textOf(stored), 'One heard: slow');
});
