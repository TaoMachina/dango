import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { after, before, test } from 'node:test';
import type { Agent, Conversation, Run } from '../shared/types.ts';
import { finishedReply, startTestHub, textOf, waitFor, type TestHub } from './helpers.ts';

// A stand-in for a hosted agent's OpenAI-compatible API. The model name picks its behavior.
interface Recorded { headers: IncomingMessage['headers']; body: { model: string; stream: boolean; messages: { role: string; content: string }[] } }
const requests: Recorded[] = [];
const aborted: string[] = [];
let server: Server;
let apiUrl = '';
let t: TestHub;

const chunk = (delta: object) => `data: ${JSON.stringify({ object: 'chat.completion.chunk', choices: [{ index: 0, delta }] })}\n\n`;

// Group members tell themselves apart by the Dango context in the system message.
function answer(body: Recorded['body']): string {
  const system = body.messages[0].content;
  const last = body.messages.at(-1)!.content;
  if (system.startsWith('You are Scout') && !last.startsWith('[Writer]')) return '@Writer please draft';
  return 'Hello there';
}

before(async () => {
  server = createServer((req, res) => {
    if (req.headers.authorization !== 'Bearer secret') {
      res.writeHead(401, { 'content-type': 'application/json' });
      return res.end('{"error":"bad key"}');
    }
    if (req.method === 'GET' && req.url === '/v1/models') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ object: 'list', data: [{ id: 'fake-agent', object: 'model' }] }));
    }
    // Under /bare the API has chat completions but no model list.
    if (req.method === 'GET') {
      res.writeHead(404, { 'content-type': 'text/plain' });
      return res.end('not found');
    }
    let text = '';
    req.on('data', c => (text += c));
    req.on('end', () => {
      const body = JSON.parse(text) as Recorded['body'];
      requests.push({ headers: req.headers, body });
      if (body.model === 'fail') {
        res.writeHead(500, { 'content-type': 'text/plain' });
        return res.end('model overloaded');
      }
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      if (body.model === 'hang') {
        res.write(chunk({ content: 'partial' }));
        res.on('close', () => aborted.push(body.messages.at(-1)!.content));
        return;
      }
      const reply = answer(body);
      const half = Math.ceil(reply.length / 2);
      res.write(': keepalive\n\n');
      res.write('event: hermes.tool.progress\ndata: {"tool":"search"}\n\n');
      res.write(chunk({ reasoning_content: 'thinking' }));
      res.write(chunk({ content: reply.slice(0, half) }));
      res.write(chunk({ content: reply.slice(half) }));
      res.end('data: [DONE]\n\n');
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  apiUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  t = await startTestHub([]);
});
after(async () => {
  await t.close();
  server.close();
});

const connect = async (body: Record<string, string>) => (await t.api<{ agent: Agent }>('POST', '/api/agents/url', { apiKey: 'secret', ...body })).agent;
const lastRun = (conversationId: string, agentId: string) => waitFor(() => t.events.findLast(e => e.type === 'run.upsert' && e.run.conversationId === conversationId
  && e.run.agentId === agentId && (e.run.status === 'done' || e.run.status === 'stopped' || e.run.status === 'error')), 'run end') as Promise<{ run: Run }>;

test('connecting tests /v1/models, accepts a /v1 URL and never shows the key', async () => {
  assert.equal((await t.raw('POST', '/api/agents/url', { cookie: t.cookie }, { baseUrl: 'ftp://example.com' })).status, 400);
  const wrongKey = await t.raw('POST', '/api/agents/url', { cookie: t.cookie }, { baseUrl: apiUrl, apiKey: 'nope' });
  assert.equal(wrongKey.status, 502);
  assert.match(wrongKey.body.error, /answered 401: \{"error":"bad key"\}/);

  const agent = await connect({ baseUrl: `${apiUrl}/v1/` });
  assert.equal(agent.source, 'url');
  assert.equal(agent.name, 'fake-agent');
  assert.equal(agent.status, 'ready');
  assert.equal(agent.apiHost, new URL(apiUrl).host);
  assert.doesNotMatch(JSON.stringify(await t.api('GET', '/api/state')), /secret/);

  // Without /v1/models the person names the model.
  assert.match((await t.raw('POST', '/api/agents/url', { cookie: t.cookie }, { baseUrl: `${apiUrl}/bare`, apiKey: 'secret' })).body.error, /answered 404/);
  assert.equal((await connect({ baseUrl: `${apiUrl}/bare/v1`, model: 'fake-agent' })).runtimeLabel, 'fake-agent');
});

test('a chat message streams the reply from the API into the agent message', async () => {
  const agent = await connect({ baseUrl: apiUrl, name: 'Remote' });
  await t.api('POST', `/api/conversations/${agent.chatId}/messages`, { text: 'hi' });
  const reply = await finishedReply(t, agent.chatId, agent.id);
  assert.equal(reply.status, 'done');
  assert.equal(textOf(reply), 'Hello there');
  assert.deepEqual(reply.parts[0], { type: 'thought', text: 'thinking' });

  const sent = requests.at(-1)!;
  assert.equal(sent.body.model, 'fake-agent');
  assert.equal(sent.body.stream, true);
  assert.equal(sent.body.messages[0].role, 'system');
  assert.match(sent.body.messages[0].content, /^You are Remote in Dango/);
  assert.doesNotMatch(sent.body.messages[0].content, /dango_/);
  assert.deepEqual(sent.body.messages.slice(1), [{ role: 'user', content: 'hi' }]);
  assert.equal(sent.headers['x-hermes-session-id'], undefined);
});

test('in a group the lead hands work to a URL member and reviews its answer', async () => {
  const scout = await connect({ baseUrl: apiUrl, name: 'Scout' });
  const writer = await connect({ baseUrl: apiUrl, name: 'Writer' });
  const group = await t.api<Conversation>('POST', '/api/conversations', { kind: 'group', title: 'Crew', memberIds: [scout.id, writer.id], leadId: scout.id });
  const start = requests.length;
  await t.api('POST', `/api/conversations/${group.id}/messages`, { text: 'plan the launch' });

  const review = await finishedReply(t, group.id, scout.id, 1);
  assert.equal(textOf(review), 'Hello there');
  const sent = requests.slice(start);
  assert.deepEqual(sent.map(r => r.body.messages[0].content.split(' ')[2]), ['Scout', 'Writer', 'Scout']);
  assert.match(sent[0].body.messages[0].content, /You are the lead/);
  assert.deepEqual(sent[1].body.messages.slice(1), [
    { role: 'user', content: '[User]: plan the launch' },
    { role: 'user', content: '[Scout]: @Writer please draft' },
  ]);
  assert.deepEqual(sent[2].body.messages.slice(-2), [
    { role: 'assistant', content: '@Writer please draft' },
    { role: 'user', content: '[Writer]: Hello there' },
  ]);
});

test('a configured session header carries the conversation id', async () => {
  const agent = await connect({ baseUrl: apiUrl, name: 'Hermes', sessionHeader: 'X-Hermes-Session-Id' });
  await t.api('POST', `/api/conversations/${agent.chatId}/messages`, { text: 'remember this' });
  await finishedReply(t, agent.chatId, agent.id);
  assert.equal(requests.at(-1)!.headers['x-hermes-session-id'], agent.chatId);
});

test('stop aborts the request and the run ends stopped', async () => {
  const agent = await connect({ baseUrl: apiUrl, model: 'hang', name: 'Slow' });
  await t.api('POST', `/api/conversations/${agent.chatId}/messages`, { text: 'take your time' });
  await waitFor(() => t.events.some(e => e.type === 'message.part' && e.conversationId === agent.chatId), 'first streamed text');
  await t.api('POST', `/api/conversations/${agent.chatId}/stop`);
  const reply = await finishedReply(t, agent.chatId, agent.id);
  assert.equal(reply.status, 'stopped');
  assert.equal(textOf(reply), 'partial');
  await waitFor(() => aborted.includes('take your time'), 'the API to see the request closed');
});

test('a failing endpoint ends the run with the HTTP status and marks the agent', async () => {
  const agent = await connect({ baseUrl: apiUrl, model: 'fail', name: 'Broken' });
  await t.api('POST', `/api/conversations/${agent.chatId}/messages`, { text: 'hello?' });
  const { run } = await lastRun(agent.chatId, agent.id);
  assert.equal(run.status, 'error');
  assert.match(run.error!, /answered 500: model overloaded/);
  const state = await t.api<{ agents: Agent[] }>('GET', '/api/state');
  const after = state.agents.find(a => a.id === agent.id)!;
  assert.equal(after.status, 'error');
  assert.match(after.statusDetail!, /500/);
});
