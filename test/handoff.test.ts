import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { Agent, Conversation, Run, StateResponse } from '../shared/types.ts';
import { fakeEntry, startTestHub, textOf, waitFor, type TestHub } from './helpers.ts';

let t: TestHub;
let lead: Agent;
let helper: Agent;
before(async () => {
  // The lead mentions the helper on "chain"; the helper mentions no one.
  t = await startTestHub([fakeEntry('lead', 'Lead', 'Helper'), fakeEntry('helper', 'Helper')]);
  [lead, helper] = (await t.api<StateResponse>('GET', '/api/state')).agents;
});
after(() => t.close());

test('a member the lead asked reports back to the lead, and a blocked handoff is explained', async () => {
  const g = await t.api<Conversation>('POST', '/api/conversations', { kind: 'group', title: 'Crew', memberIds: [lead.id, helper.id] });
  await t.api('PATCH', `/api/conversations/${g.id}`, { hopLimit: 2 });
  await t.api('POST', `/api/conversations/${g.id}/messages`, { text: 'chain' });
  const runs = () => {
    const latest = new Map<string, Run>();
    for (const e of t.events) if (e.type === 'run.upsert' && e.run.conversationId === g.id) latest.set(e.run.id, e.run);
    return [...latest.values()];
  };
  // depth 0: the lead hands off; depth 1: the helper answers; depth 2: the lead reviews.
  await waitFor(() => runs().filter(r => r.status === 'done').length === 3, 'three finished runs');
  assert.deepEqual(runs().map(r => [r.agentId, r.depth]), [[lead.id, 0], [helper.id, 1], [lead.id, 2]]);
  // The review mentions the helper again, which would be depth 3 > 2: the person is told instead.
  await waitFor(() => t.events.some(e => e.type === 'message.upsert' && e.message.conversationId === g.id && e.message.author.type === 'system'
    && textOf(e.message).startsWith('Handoff limit reached, so @Helper was not asked.')), 'limit note');
});
