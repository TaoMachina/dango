// A small ACP agent for tests. Usage: node fake-agent.ts <name> [mentionTarget] [sessionDelayMs] [restore]
// The last line of the prompt selects behavior, so Dango's context text before it triggers nothing:
//   "tool"       -> reports a tool call with a diff
//   "permission" -> asks for permission and replies with the chosen option id
//   "chain"      -> replies "@<mentionTarget> chain" so the target continues
//   "slow"       -> streams one chunk, waits for cancel, then sends a late chunk
//   "settings"   -> also replies with the session's model and fast values
//   "echo"       -> also replies with the whole prompt on the following lines
//   "subagent"   -> starts a subagent session "<sessionId>-child" and streams its model, a tool call and text
//   "history"    -> also replies with the earlier prompt lines of this session, joined by " | "
//   "env"        -> also replies with FAKE_SUBAGENT_MODEL from the agent's environment
//   "later"      -> finishes after LATER_MS, longer than the wait budget test/delegate.test.ts gives the hub
//   "stuck"      -> starts a tool call and a subagent, waits for cancel, then reports both finished and stops
//   "relay"      -> replies "@<mentionTarget>" on its own line, then the prompt's last line, so a member that echoes it mentions no one
//   "fail-<name>" -> the agent with that name fails its turn after LATER_MS
//   "closed"     -> also replies with the sessions closed with session/close, joined by ","
// session/fork copies a session's settings and history; session/resume reopens a session this process knows.
// restore "load-fails" offers session/load instead of session/resume, and every load fails.
// Each finished turn reports usage_update with 100 more tokens used of 1000.
// Every reply starts with "<name> heard: <last line of the prompt>", so group notes are not echoed.
import { Readable, Writable } from 'node:stream';
import * as acp from '@agentclientprotocol/sdk/unstable';

const [name = 'Fake', target = '', delay = '0', restore = 'resume'] = process.argv.slice(2);
const cancels = new Map<string, () => void>();
const values = new Map<string, Record<string, string | boolean>>();
const turns = new Map<string, number>();
const history = new Map<string, string[]>();
let sessions = 0;
const closed: string[] = [];
// test/delegate.test.ts waits 300 ms for a helper; 1 s is safely longer.
const LATER_MS = 1000;

const select = (id: string, category: string, currentValue: string, choices: string[]) =>
  ({ id, name: id, category, type: 'select' as const, currentValue, options: choices.map(value => ({ value, name: value })) });
const configOptions = (v: Record<string, string | boolean>) => [
  select('model', 'model', String(v.model), ['small', 'large']),
  select('mode', 'mode', String(v.mode), ['default', 'read-only']),
  select('effort', 'thought_level', String(v.effort), ['low', 'high']),
  { id: 'fast', name: 'Fast', category: 'speed', type: 'boolean' as const, currentValue: v.fast === true },
];

const app = acp.agent({ name })
  .onRequest('initialize', () => ({
    protocolVersion: acp.PROTOCOL_VERSION,
    agentCapabilities: restore === 'load-fails'
      ? { loadSession: true, sessionCapabilities: { fork: {}, close: {} } }
      : { loadSession: false, sessionCapabilities: { fork: {}, resume: {}, close: {} } },
  }))
  .onRequest('session/load', ({ params }) => {
    throw new Error(`No session ${params.sessionId}`);
  })
  .onRequest('session/close', ({ params }) => {
    closed.push(params.sessionId);
    return {};
  })
  .onRequest('session/new', async () => {
    await new Promise(resolve => setTimeout(resolve, Number(delay)));
    const sessionId = `${name}-session-${++sessions}`;
    values.set(sessionId, { model: 'small', mode: 'default', effort: 'low', fast: true });
    history.set(sessionId, []);
    return { sessionId, configOptions: configOptions(values.get(sessionId)!) };
  })
  .onRequest('session/fork', ({ params }) => {
    const sessionId = `${name}-session-${++sessions}`;
    values.set(sessionId, { ...values.get(params.sessionId)! });
    history.set(sessionId, [...history.get(params.sessionId)!]);
    return { sessionId, configOptions: configOptions(values.get(sessionId)!) };
  })
  // A restarted process knows no sessions; it reopens the id with default settings.
  .onRequest('session/resume', ({ params }) => {
    if (!values.has(params.sessionId)) {
      values.set(params.sessionId, { model: 'small', mode: 'default', effort: 'low', fast: true });
      history.set(params.sessionId, []);
    }
    return { configOptions: configOptions(values.get(params.sessionId)!) };
  })
  .onRequest('session/set_config_option', ({ params }) => {
    const v = values.get(params.sessionId)!;
    v[params.configId] = params.value;
    return { configOptions: configOptions(v) };
  })
  .onNotification('session/cancel', ({ params }) => cancels.get(params.sessionId)?.())
  .onRequest('session/prompt', async ({ params, client }) => {
    const { sessionId } = params;
    const prompt = params.prompt.map(b => (b.type === 'text' ? b.text : '')).join('');
    const text = prompt.trim().split('\n').at(-1)!;
    const say = (chunk: string) => client.notify('session/update', { sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: chunk } } });

    await say(`${name} heard: ${text}`);
    if (text.includes('echo')) await say(`\n${prompt}`);
    if (text.includes('history')) await say(` history=${history.get(sessionId)!.join(' | ')}`);
    history.get(sessionId)!.push(text);
    if (text.includes('env')) await say(` subagentModel=${process.env.FAKE_SUBAGENT_MODEL ?? 'none'}`);
    if (text.includes('subagent')) {
      const child = `${sessionId}-child`;
      const update = (id: string, u: acp.SessionUpdate) => client.notify('session/update', { sessionId: id, update: u });
      await update(sessionId, { sessionUpdate: 'subagent_update', sessionId: child, title: 'Helper', description: 'Writes a.txt', state: { state: 'running' } });
      await update(child, {
        sessionUpdate: 'config_option_update',
        configOptions: [{ id: 'model', name: 'Model', category: 'model', type: 'select', currentValue: 'small', options: [{ value: 'small', name: 'Small model' }] }],
      });
      await update(child, { sessionUpdate: 'tool_call', toolCallId: 'c1', title: 'Write a.txt', kind: 'edit', status: 'in_progress' });
      await update(child, { sessionUpdate: 'tool_call_update', toolCallId: 'c1', status: 'completed' });
      await update(child, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Checking\nDone wri' } });
      await update(child, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'ting\n' } });
      await update(sessionId, { sessionUpdate: 'subagent_update', sessionId: child, state: { state: 'idle' } });
    }
    if (text.includes('tool')) {
      await client.notify('session/update', { sessionId, update: {
        sessionUpdate: 'tool_call', toolCallId: 't1', title: 'Edit file', kind: 'edit', status: 'in_progress',
        content: [{ type: 'diff', path: '/tmp/a.txt', oldText: 'a', newText: 'b' }],
      } });
      await client.notify('session/update', { sessionId, update: { sessionUpdate: 'tool_call_update', toolCallId: 't1', status: 'completed' } });
    }
    if (text.includes('permission')) {
      const response = await client.request('session/request_permission', {
        sessionId,
        toolCall: { toolCallId: 'p1', title: 'Write file', kind: 'edit', status: 'pending' },
        options: [{ optionId: 'allow', name: 'Allow', kind: 'allow_once' }, { optionId: 'reject', name: 'Reject', kind: 'reject_once' }],
      });
      await say(` chose ${response.outcome.outcome === 'selected' ? response.outcome.optionId : 'cancelled'}`);
    }
    if (text.includes('chain') && target) await say(` @${target} chain`);
    if (text.includes('relay') && target) await say(`\n@${target}\n${text}`);
    if (text.includes('closed')) await say(` closed=${closed.join(',')}`);
    if (text.includes(`fail-${name}`)) {
      await new Promise(resolve => setTimeout(resolve, LATER_MS));
      throw new Error(`${name} failed`);
    }
    if (text.includes('stuck')) {
      const child = `${sessionId}-stuck`;
      const update = (u: acp.SessionUpdate) => client.notify('session/update', { sessionId, update: u });
      await update({ sessionUpdate: 'tool_call', toolCallId: 's1', title: 'Run tests', kind: 'execute', status: 'in_progress' });
      await update({ sessionUpdate: 'subagent_update', sessionId: child, title: 'Checker', state: { state: 'running' } });
      await new Promise<void>(resolve => cancels.set(sessionId, resolve));
      await update({ sessionUpdate: 'tool_call_update', toolCallId: 's1', status: 'completed' });
      await update({ sessionUpdate: 'subagent_update', sessionId: child, state: { state: 'idle' } });
      return { stopReason: 'cancelled' as const };
    }
    if (text.includes('later')) {
      await new Promise(resolve => setTimeout(resolve, LATER_MS));
      await say(' done later');
    }
    if (text.includes('settings')) await say(` model=${values.get(sessionId)!.model} fast=${values.get(sessionId)!.fast}`);
    if (text.includes('slow')) {
      await new Promise<void>(resolve => cancels.set(sessionId, resolve));
      await say(' late');
      return { stopReason: 'cancelled' as const };
    }
    const turn = (turns.get(sessionId) ?? 0) + 1;
    turns.set(sessionId, turn);
    await client.notify('session/update', { sessionId, update: { sessionUpdate: 'usage_update', used: 100 * turn, size: 1000 } });
    return { stopReason: 'end_turn' as const };
  });

app.connect(acp.ndJsonStream(Writable.toWeb(process.stdout) as WritableStream<Uint8Array>, Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>));
