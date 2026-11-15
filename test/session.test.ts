import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import type { Agent, Conversation, Project, SessionInfo, StateResponse } from '../shared/types.ts';
import { fakeEntry, finishedReply, startTestHub, textOf, waitFor, type TestHub } from './helpers.ts';

// 300 ms keeps session/new open well past the loopback requests a test sends right after opening a session.
const SESSION_DELAY_MS = 300;

let t: TestHub;
let one: Agent;
let project: Project;
before(async () => {
  t = await startTestHub([fakeEntry('one', 'One', '', SESSION_DELAY_MS)]);
  one = (await t.api<StateResponse>('GET', '/api/state')).agents[0];
});
after(() => t.close());

const open = (conversationId: string) => t.api<SessionInfo>('POST', `/api/conversations/${conversationId}/session`, { agentId: one.id });
const readyUpsert = (conversationId: string) => waitFor(() => {
  const e = t.events.findLast(e => e.type === 'session.upsert' && e.session.conversationId === conversationId && e.session.ready);
  return e?.type === 'session.upsert' ? e.session : undefined;
}, `ready session in ${conversationId}`);
const ids = (info: SessionInfo) => info.options.map(o => o.id);
const value = (info: SessionInfo, id: string) => info.options.find(o => o.id === id)?.currentValue;

test('projects by name are created under ~/Agentry/projects; picked folders must exist', async () => {
  const dir = join(t.hub.paths.dir, 'Agentry', 'projects', 'demo');
  project = await t.api<Project>('POST', '/api/projects', { name: 'demo' });
  assert.equal(project.path, dir);
  assert.equal(project.name, 'demo');
  assert.ok(existsSync(dir));
  assert.equal((await t.raw('POST', '/api/projects', { cookie: t.cookie }, { name: 'demo' })).status, 409);
  assert.equal((await t.raw('POST', '/api/projects', { cookie: t.cookie }, { name: '../escape' })).status, 400);
  assert.equal((await t.raw('POST', '/api/projects', { cookie: t.cookie }, { path: join(t.hub.paths.dir, 'missing') })).status, 400);
  const picked = join(t.hub.paths.dir, 'picked');
  mkdirSync(picked);
  assert.equal((await t.api<Project>('POST', '/api/projects', { path: picked })).name, 'picked');
});

test('the session endpoint answers before the agent is ready, then from the last session', async () => {
  const first = await open(one.chatId);
  assert.equal(first.ready, false);
  assert.deepEqual(first.options, []);
  // A chat shows only model and effort, model first.
  assert.deepEqual(ids(await readyUpsert(one.chatId)), ['model', 'effort']);

  const group = await t.api<Conversation>('POST', '/api/conversations', { kind: 'group', title: 'Room', memberIds: [one.id] });
  const cached = await open(group.id);
  assert.equal(cached.ready, false);
  assert.deepEqual(ids(cached), ['model', 'effort']);
  await readyUpsert(group.id);
});

test('an option chosen before the session is ready is applied before the first prompt', async () => {
  const thread = await t.api<Conversation>('POST', '/api/conversations', { kind: 'code', projectId: project.id, agentId: one.id, title: 'Settings' });
  const opening = await open(thread.id);
  assert.equal(opening.ready, false);
  // Code threads show model, effort and mode first, then the rest.
  assert.deepEqual(ids(opening), ['model', 'effort', 'mode', 'fast']);
  const chosen = await t.api<SessionInfo>('POST', `/api/conversations/${thread.id}/session/option`, { agentId: one.id, optionId: 'model', value: 'large' });
  assert.equal(chosen.ready, false);
  assert.equal(value(chosen, 'model'), 'large');
  assert.equal(value(await readyUpsert(thread.id), 'model'), 'large');
  await t.api('POST', `/api/conversations/${thread.id}/messages`, { text: 'settings' });
  // The code thread keeps the agent's own fast mode.
  assert.match(textOf(await finishedReply(t, thread.id, one.id)), /model=large fast=true$/);
});

test('a new task picks its model up front and, without a project, gets its own folder', async () => {
  const offered = await t.api<{ options: SessionInfo['options']; ready: boolean }>('POST', `/api/agents/${one.id}/options`);
  assert.equal(offered.ready, true);
  assert.deepEqual(ids(offered as SessionInfo), ['model', 'effort', 'mode', 'fast']);
  const body = { kind: 'code', projectId: null, agentId: one.id, title: 'Fix the login page!', options: [{ optionId: 'model', value: 'large' }] };
  const thread = await t.api<Conversation>('POST', '/api/conversations', body);
  const state = await t.api<StateResponse>('GET', '/api/state');
  assert.equal(state.projects.find(p => p.id === thread.projectId)!.path, join(t.hub.paths.dir, 'Agentry', 'projects', 'fix-the-login-page'));
  // The same title again gets the next free folder name.
  const again = await t.api<Conversation>('POST', '/api/conversations', { ...body, options: [] });
  assert.ok((await t.api<StateResponse>('GET', '/api/state')).projects.find(p => p.id === again.projectId)!.path.endsWith('fix-the-login-page-2'));
  assert.equal((await t.raw('POST', '/api/conversations', { cookie: t.cookie }, { ...body, options: [{ optionId: 'model', value: 'nope' }] })).status, 400);
  await t.api('POST', `/api/conversations/${thread.id}/messages`, { text: 'settings' });
  assert.match(textOf(await finishedReply(t, thread.id, one.id)), /model=large/);
});

test('a chat turns fast mode off and refuses hidden options', async () => {
  await t.api('POST', `/api/conversations/${one.chatId}/messages`, { text: 'settings' });
  assert.match(textOf(await finishedReply(t, one.chatId, one.id)), /model=small fast=false$/);
  const refused = await t.raw('POST', `/api/conversations/${one.chatId}/session/option`, { cookie: t.cookie }, { agentId: one.id, optionId: 'mode', value: 'read-only' });
  assert.equal(refused.status, 400);
});

test('usage_update reaches the session and is kept for the next session info', async () => {
  const usage = await waitFor(() => {
    const e = t.events.findLast(e => e.type === 'session.upsert' && e.session.conversationId === one.chatId && e.session.usage);
    return e?.type === 'session.upsert' ? e.session.usage : undefined;
  }, 'usage');
  assert.deepEqual(usage, { used: 100, size: 1000 });
  assert.deepEqual((await open(one.chatId)).usage, { used: 100, size: 1000 });
});
