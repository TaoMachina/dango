import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { Agent, Conversation, Message, Project, StateResponse } from '../shared/types.ts';
import { sessionContext } from '../server/acp/context.ts';
import { fakeEntry, finishedReply, startTestHub, textOf, waitFor, type TestHub } from './helpers.ts';

let t: TestHub;
let one: Agent;
let two: Agent;
before(async () => {
  t = await startTestHub([fakeEntry('one', 'One'), fakeEntry('two', 'Two')]);
  [one, two] = (await t.api<StateResponse>('GET', '/api/state')).agents;
});
after(() => t.close());

const group = (leadId: string): Conversation => ({
  id: 'g', kind: 'group', title: 'Room', avatar: null, memberIds: [one.id, two.id], leadId, projectId: null, hopLimit: 3,
  lastMessage: null, activeRuns: 0, createdAt: '', updatedAt: '',
});

test('the context tells a chat agent its Agentry tools and a code agent its project', async () => {
  const chat = (await t.api<StateResponse>('GET', '/api/state')).conversations.find(c => c.id === one.chatId)!;
  const text = sessionContext(chat, one, [one], null);
  assert.match(text, /^You are One in Agentry/);
  for (const tool of ['agentry_start_code_task', 'agentry_list_projects', 'agentry_read_code_thread', 'agentry_create_routine']) assert.ok(text.includes(tool), tool);
  const project: Project = { id: 'p', name: 'demo', path: '/work/demo', environmentId: 'local', createdAt: '' };
  assert.match(sessionContext({ ...chat, kind: 'code', projectId: 'p' }, one, [one], project), /working in project demo at \/work\/demo\./);
});

test('the context tells the lead it takes unmentioned messages and a member how to pass work on', () => {
  const lead = sessionContext(group(one.id), one, [one, two], null);
  assert.match(lead, /Members: @One \(One\), @Two \(Two\)\./);
  assert.match(lead, /You are the lead\. Messages without an @mention come to you\./);
  assert.match(lead, /stop after 3 in a row/);
  const member = sessionContext(group(one.id), two, [one, two], null);
  assert.match(member, /The lead is @One\. You were asked by @mention\. Write @Name to pass work on\./);
  assert.doesNotMatch(member, /You are the lead/);
});

test('an agent without a session system prompt gets the context once, then a note when the group changes', async () => {
  const g = await t.api<Conversation>('POST', '/api/conversations', { kind: 'group', title: 'Room', memberIds: [one.id, two.id] });
  await t.api('POST', `/api/conversations/${g.id}/messages`, { text: 'echo first' });
  assert.match(textOf(await finishedReply(t, g.id, one.id)), /You are One in Agentry[\s\S]*You are the lead/);
  await t.api('POST', `/api/conversations/${g.id}/messages`, { text: 'echo second' });
  const second = textOf(await finishedReply(t, g.id, one.id, 1));
  assert.doesNotMatch(second, /You are One in Agentry|Group update/);
  await t.api('PATCH', `/api/conversations/${g.id}`, { leadId: two.id });
  await t.api('POST', `/api/conversations/${g.id}/messages`, { text: 'echo @One third' });
  assert.match(textOf(await finishedReply(t, g.id, one.id, 2)), /Group update: members are now @One \(One\), @Two \(Two\)\. The lead is @Two\./);
});

test('a code task reports back to its requester and can be read as a thread', async () => {
  const caller = { agentId: one.id, conversationId: one.chatId };
  await t.api('POST', '/api/projects', { name: 'demo' });
  const { conversationId } = t.hub.tools.startCodeTask(caller, { project: 'demo', prompt: 'tool please', title: 'Fix it' });
  await finishedReply(t, conversationId, one.id);
  const notice = await waitFor(() => {
    const e = t.events.find(e => e.type === 'message.upsert' && e.message.conversationId === one.chatId && e.message.author.type === 'system'
      && textOf(e.message).includes('finished'));
    return e?.type === 'message.upsert' ? e.message as Message : undefined;
  }, 'finish notice');
  assert.equal(textOf(notice), `One finished [Fix it](?m=code&c=${conversationId}).`);
  // The notice starts no run in the requesting chat.
  assert.equal((await t.api<StateResponse>('GET', '/api/state')).conversations.find(c => c.id === one.chatId)!.activeRuns, 0);

  const thread = t.hub.tools.readCodeThread({ conversation: 'fix it' });
  assert.equal(thread.status, 'done');
  assert.equal(thread.agent, 'One');
  assert.equal(thread.project?.name, 'demo');
  assert.deepEqual(thread.messages.map(m => m.author), ['You', 'One']);
  assert.equal(thread.messages[1].text, 'One heard: From One: tool please\n[tool] Edit file (completed)');
  const listed = t.hub.tools.projects().projects.find(p => p.name === 'demo')!;
  assert.deepEqual(listed.threads.map(c => [c.id, c.title, c.status]), [[conversationId, 'Fix it', 'done']]);
});
