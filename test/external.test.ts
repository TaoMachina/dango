import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { Agent } from '../shared/types.ts';
import { finishedReply, startTestHub, textOf, waitFor, type TestHub } from './helpers.ts';

let t: TestHub;
before(async () => { t = await startTestHub([]); });
after(() => t.close());

test('an invited agent joins under its own name, fetches its inbox and replies', async () => {
  const agentsBefore = (await t.api<{ agents: Agent[] }>('GET', '/api/state')).agents.length;
  const { instruction } = await t.api<{ instruction: string }>('POST', '/api/agents/external', {});
  // An unused invitation leaves nothing in the agent list.
  assert.equal((await t.api<{ agents: Agent[] }>('GET', '/api/state')).agents.length, agentsBefore);
  const token = instruction.match(/Your token: ([0-9a-f]+)/)![1];
  assert.match(instruction, new RegExp(`${t.hub.url}/agent-api/inbox\\?wait=25`));
  const auth = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };

  assert.equal((await t.raw('GET', '/agent-api/inbox', { authorization: 'Bearer nope' })).status, 401);
  const hello = await t.raw('POST', '/agent-api/hello', auth, { name: 'Scout Prime', runtime: 'Custom', greeting: 'Hi, Scout here.' });
  assert.equal(hello.status, 200);
  const agent = (await t.api<{ agents: Agent[] }>('GET', '/api/state')).agents.find(a => a.id === hello.body.agent.id)!;
  assert.equal(agent.source, 'external');
  assert.equal(agent.name, 'Scout Prime');
  const greeting = await finishedReply(t, agent.chatId, agent.id);
  assert.equal(textOf(greeting), 'Hi, Scout here.');
  await waitFor(() => t.events.some(e => e.type === 'agent.upsert' && e.agent.id === agent.id && e.agent.name === 'Scout Prime' && e.agent.status === 'ready'), 'renamed and ready');

  // Start a long poll first; the person's message wakes it.
  const poll = t.raw('GET', '/agent-api/inbox?wait=5', auth);
  await t.api('POST', `/api/conversations/${agent.chatId}/messages`, { text: 'find the docs' });
  const inbox = (await poll).body;
  assert.equal(inbox.length, 1);
  assert.equal(inbox[0].conversationId, agent.chatId);
  assert.deepEqual(inbox[0].messages, [{ author: 'User', text: 'find the docs' }]);

  assert.equal((await t.raw('POST', '/agent-api/reply', auth, { runId: inbox[0].runId, text: 'Found them.' })).status, 200);
  const reply = await finishedReply(t, agent.chatId, agent.id, 1);
  assert.equal(reply.status, 'done');
  assert.equal(textOf(reply), 'Found them.');
  assert.equal((await t.raw('POST', '/agent-api/reply', auth, { runId: inbox[0].runId, text: 'again' })).status, 404);
});
