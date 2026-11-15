import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { Part, StateResponse } from '../shared/types.ts';
import { createHub } from '../server/hub.ts';
import { fakeEntry, finishedReply, startTestHub, textOf } from './helpers.ts';

test('a session that fails to load gives way to a new session whose reply reaches the conversation', async () => {
  const t = await startTestHub([fakeEntry('one', 'One', '', 0, 'load-fails')]);
  try {
    const one = (await t.api<StateResponse>('GET', '/api/state')).agents[0];
    t.hub.store.saveAcpSession(one.id, one.chatId, 'lost-session', t.hub.paths.dir);
    await t.api('POST', `/api/conversations/${one.chatId}/messages`, { text: 'hi' });
    assert.equal(textOf(await finishedReply(t, one.chatId, one.id)), 'One heard: hi');
  } finally {
    await t.close();
  }
});

test('a restart closes the open steps of a reply it interrupted', async () => {
  const home = mkdtempSync(join(tmpdir(), 'agentry-test-'));
  const options = { home, port: 0, catalog: [fakeEntry('one', 'One')], userHome: home, webDist: null };
  const first = await createHub(options);
  const one = first.store.listAgents()[0];
  const run = first.store.insertRun({ conversationId: one.chatId, agentId: one.id, parentRunId: null, triggerMessageId: 'none', depth: 0, prompt: null });
  const parts: Part[] = [
    { type: 'tool', toolCallId: 't1', title: 'Run tests', kind: 'execute', status: 'in_progress', locations: [], content: [] },
    { type: 'subagent', sessionId: 's1', title: 'Checker', description: null, state: 'running', activity: null, model: null, agentId: null, conversationId: null },
    { type: 'permission', requestId: 'r1', title: 'Write file', options: [], outcome: null },
  ];
  const message = first.store.insertMessage({ conversationId: one.chatId, author: { type: 'agent', agentId: one.id }, parts, runId: run.id, status: 'streaming' });
  await first.close();

  const second = await createHub(options);
  try {
    const stored = second.store.getMessage(message.id)!;
    assert.equal(stored.status, 'error');
    assert.deepEqual(stored.parts.slice(0, 3), [
      { ...parts[0], status: 'failed' },
      { ...parts[1], state: 'idle', activity: 'Interrupted' },
      { ...parts[2], outcome: { cancelled: true } },
    ]);
  } finally {
    await second.close();
    rmSync(home, { recursive: true, force: true });
  }
});

test('a second hub on a port in use exits without touching the running hub\'s work', async () => {
  const t = await startTestHub([fakeEntry('one', 'One')]);
  try {
    const store = t.hub.store;
    const one = store.listAgents()[0];
    const run = store.insertRun({ conversationId: one.chatId, agentId: one.id, parentRunId: null, triggerMessageId: 'none', depth: 0, prompt: null });
    store.updateAgent(one.id, { status: 'ready' });
    const second = createHub({ home: t.hub.paths.dir, port: t.hub.port, catalog: [fakeEntry('one', 'One')], userHome: t.hub.paths.dir, webDist: null });
    await assert.rejects(second, { code: 'EADDRINUSE' });
    assert.equal(store.getRun(run.id)!.status, 'queued');
    assert.equal(store.getAgent(one.id)!.status, 'ready');
  } finally {
    await t.close();
  }
});
